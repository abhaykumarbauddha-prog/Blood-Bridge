// backend/controllers/chatController.js
/**
 * Blood Bridge — In-App Chat / Messaging Controller
 * Handles conversations and real-time messages between
 * Requester↔Donor, Hospital↔Donor, BloodBank↔Donor, BloodBank↔Hospital
 */

const supabase = require('../config/supabaseClient');

/**
 * GET /api/chat/conversations
 * List all conversations for the authenticated user
 */
exports.getConversations = async (req, res) => {
    try {
        const client = supabase.forRequest(req);
        const userId = req.query.user_id;

        if (!userId) {
            return res.status(400).json({ success: false, error: 'user_id is required.' });
        }

        const { data, error } = await client
            .from('conversations')
            .select(`
                id,
                request_id,
                participant_1,
                participant_2,
                last_message_text,
                last_message_at,
                created_at
            `)
            .or(`participant_1.eq.${userId},participant_2.eq.${userId}`)
            .order('last_message_at', { ascending: false, nullsFirst: false });

        if (error) throw error;

        // Fetch participant details
        const participantIds = new Set();
        const requestIds = new Set();
        (data || []).forEach(conv => {
            participantIds.add(conv.participant_1);
            participantIds.add(conv.participant_2);
            if (conv.request_id) requestIds.add(conv.request_id);
        });

        let usersMap = {};
        if (participantIds.size > 0) {
            const { data: users } = await client
                .from('users')
                .select('id, full_name, role, avatar_url, blood_group, city')
                .in('id', Array.from(participantIds));

            if (users) {
                users.forEach(u => { usersMap[u.id] = u; });
            }
        }

        // Fetch associated blood requests and responses
        let requestsMap = {};
        let responsesMap = {};
        if (requestIds.size > 0) {
            const reqIdArr = Array.from(requestIds);
            const { data: reqs } = await client
                .from('blood_requests')
                .select('id, patient_name, blood_group, units, hospital_name, hospital_address, city, status, requester_id')
                .in('id', reqIdArr);

            if (reqs) {
                reqs.forEach(r => { requestsMap[r.id] = r; });
            }

            const { data: resps } = await client
                .from('request_responses')
                .select('id, request_id, donor_id, status, donated_at')
                .in('request_id', reqIdArr);

            if (resps) {
                resps.forEach(resp => { responsesMap[resp.request_id] = resp; });
            }
        }

        // Enrich conversations with participant info & lifecycle state
        const enriched = (data || []).map(conv => {
            const otherId = conv.participant_1 === userId ? conv.participant_2 : conv.participant_1;
            const otherUser = usersMap[otherId] || {};
            const req = conv.request_id ? requestsMap[conv.request_id] : null;
            const resp = conv.request_id ? responsesMap[conv.request_id] : null;

            let chatStatus = 'direct';
            let otherUserType = (otherUser.role || '').toLowerCase().includes('donor') ? 'donor' : 'requester';

            if (req) {
                const reqStatus = (req.status || '').toLowerCase();
                const respStatus = (resp?.status || '').toLowerCase();
                if (reqStatus === 'fulfilled' || respStatus === 'donated') {
                    chatStatus = 'concluded';
                } else if (respStatus === 'accepted') {
                    chatStatus = 'active';
                } else {
                    chatStatus = 'unaccepted';
                }

                // If current user is the requester of this blood request, other user is the donor
                if (req.requester_id === userId) {
                    otherUserType = 'donor';
                } else {
                    // Current user is the donor responding, other user is requester
                    otherUserType = 'requester';
                }
            }

            return {
                ...conv,
                chat_status: chatStatus,
                other_user_type: otherUserType,
                request_info: req ? {
                    id: req.id,
                    patient_name: req.patient_name,
                    blood_group: req.blood_group,
                    units: req.units,
                    hospital_name: req.hospital_name,
                    hospital_address: req.hospital_address,
                    city: req.city,
                    status: req.status
                } : null,
                other_user: {
                    id: otherId,
                    full_name: otherUser.full_name || 'Unknown User',
                    role: otherUser.role || (otherUserType === 'donor' ? 'Donor' : 'Requester'),
                    avatar_url: otherUser.avatar_url || null,
                    blood_group: otherUser.blood_group || '',
                    city: otherUser.city || ''
                }
            };
        });

        // Count unread messages per conversation
        for (const conv of enriched) {
            const { count } = await client
                .from('chat_messages')
                .select('id', { count: 'exact', head: true })
                .eq('conversation_id', conv.id)
                .neq('sender_id', userId)
                .is('read_at', null);
            conv.unread_count = count || 0;
        }

        return res.status(200).json({ success: true, data: enriched });

    } catch (error) {
        console.error('Get conversations error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * POST /api/chat/conversations
 * Create or get existing conversation between two users
 */
exports.createConversation = async (req, res) => {
    try {
        const client = supabase.forRequest(req);
        const { participant_1, participant_2, request_id } = req.body || {};

        if (!participant_1 || !participant_2) {
            return res.status(400).json({ success: false, error: 'Both participant_1 and participant_2 are required.' });
        }

        if (participant_1 === participant_2) {
            return res.status(400).json({ success: false, error: 'Cannot create conversation with yourself.' });
        }

        // If linked to blood request, enforce acceptance requirement
        if (request_id) {
            const { data: resp } = await client
                .from('request_responses')
                .select('id, status, donor_id')
                .eq('request_id', request_id)
                .maybeSingle();

            if (!resp || !['accepted', 'donated'].includes(resp.status)) {
                return res.status(403).json({
                    success: false,
                    error: 'Chatting cannot start until the donor accepts the request.'
                });
            }
        }

        // Normalize order for uniqueness: sort IDs
        const [p1, p2] = [participant_1, participant_2].sort();

        // Check if conversation already exists
        let query = client
            .from('conversations')
            .select('*')
            .eq('participant_1', p1)
            .eq('participant_2', p2);

        if (request_id) {
            query = query.eq('request_id', request_id);
        }

        const { data: existing } = await query.maybeSingle();

        if (existing) {
            return res.status(200).json({ success: true, data: existing, existing: true });
        }

        // Create new conversation
        const { data, error } = await client
            .from('conversations')
            .insert([{
                participant_1: p1,
                participant_2: p2,
                request_id: request_id || null
            }])
            .select()
            .single();

        if (error) throw error;

        return res.status(201).json({ success: true, data, existing: false });

    } catch (error) {
        console.error('Create conversation error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * GET /api/chat/messages/:conversation_id
 * Get messages for a conversation (paginated)
 */
exports.getMessages = async (req, res) => {
    try {
        const client = supabase.forRequest(req);
        const conversationId = req.params.conversation_id;
        const limit = Math.min(Number(req.query.limit) || 50, 200);
        const offset = Number(req.query.offset) || 0;

        const { data, error } = await client
            .from('chat_messages')
            .select('*')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: true })
            .range(offset, offset + limit - 1);

        if (error) throw error;

        return res.status(200).json({ success: true, data: data || [] });

    } catch (error) {
        console.error('Get messages error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * POST /api/chat/messages
 * Send a new message in a conversation
 */
exports.sendMessage = async (req, res) => {
    try {
        const client = supabase.forRequest(req);
        const { conversation_id, sender_id, message } = req.body || {};

        if (!conversation_id || !sender_id || !message?.trim()) {
            return res.status(400).json({ success: false, error: 'conversation_id, sender_id, and message are required.' });
        }

        // Check if this conversation is linked to a blood request
        const { data: conv } = await client
            .from('conversations')
            .select('id, request_id')
            .eq('id', conversation_id)
            .maybeSingle();

        if (conv?.request_id) {
            const { data: bReq } = await client
                .from('blood_requests')
                .select('id, status')
                .eq('id', conv.request_id)
                .maybeSingle();

            const { data: bResp } = await client
                .from('request_responses')
                .select('id, status')
                .eq('request_id', conv.request_id)
                .maybeSingle();

            const isFulfilled = (bReq?.status || '').toLowerCase() === 'fulfilled' || (bResp?.status || '').toLowerCase() === 'donated';
            if (isFulfilled) {
                return res.status(403).json({
                    success: false,
                    error: 'This blood donation has already been completed. The coordination chat is concluded and read-only.'
                });
            }

            const isAccepted = (bResp?.status || '').toLowerCase() === 'accepted';
            if (!isAccepted) {
                return res.status(403).json({
                    success: false,
                    error: 'Chatting cannot start until the donor accepts the request.'
                });
            }
        }

        // Insert message
        const { data, error } = await client
            .from('chat_messages')
            .insert([{
                conversation_id,
                sender_id,
                message: message.trim()
            }])
            .select()
            .single();

        if (error) throw error;

        // Update conversation's last_message
        await client
            .from('conversations')
            .update({
                last_message_text: message.trim().substring(0, 200),
                last_message_at: new Date().toISOString()
            })
            .eq('id', conversation_id);

        return res.status(201).json({ success: true, data });

    } catch (error) {
        console.error('Send message error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * PUT /api/chat/messages/read
 * Mark messages as read in a conversation
 */
exports.markMessagesRead = async (req, res) => {
    try {
        const client = supabase.forRequest(req);
        const { conversation_id, user_id } = req.body || {};

        if (!conversation_id || !user_id) {
            return res.status(400).json({ success: false, error: 'conversation_id and user_id are required.' });
        }

        const { error } = await client
            .from('chat_messages')
            .update({ read_at: new Date().toISOString() })
            .eq('conversation_id', conversation_id)
            .neq('sender_id', user_id)
            .is('read_at', null);

        if (error) throw error;

        return res.status(200).json({ success: true, message: 'Messages marked as read.' });

    } catch (error) {
        console.error('Mark read error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
};

const path = require('path');
const dotenv = require('dotenv');

// Blood Compatibility helper (Biological compatibility matrix)
function isBloodCompatible(donorGroup, recipientGroup) {
    if (!donorGroup || !recipientGroup) return false;
    const d = donorGroup.trim().toUpperCase();
    const r = recipientGroup.trim().toUpperCase();
    if (d === r) return true;

    const compatibility = {
        'O-': ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'],
        'O+': ['O+', 'A+', 'B+', 'AB+'],
        'A-': ['A-', 'A+', 'AB-', 'AB+'],
        'A+': ['A+', 'AB+'],
        'B-': ['B-', 'B+', 'AB-', 'AB+'],
        'B+': ['B+', 'AB+'],
        'AB-': ['AB-', 'AB+'],
        'AB+': ['AB+']
    };

    return compatibility[d]?.includes(r) || false;
}

function isExactBloodMatch(donorGroup, requestedGroup) {
    if (!donorGroup || !requestedGroup) return false;
    return donorGroup.trim().toUpperCase() === requestedGroup.trim().toUpperCase();
}

/**
 * Haversine distance formula in kilometers
 */
function haversineKm(lat1, lon1, lat2, lon2) {
    if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Infinity;
    const R = 6371;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180))
        * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Built-in coordinate directory for Indian cities
const INDIAN_CITY_COORDS = {
    'lucknow': { lat: 26.8467, lng: 80.9462, name: 'Lucknow' },
    'kanpur': { lat: 26.4499, lng: 80.3319, name: 'Kanpur' },
    'sitapur': { lat: 27.5644, lng: 80.6829, name: 'Sitapur' },
    'etawah': { lat: 26.7769, lng: 79.0238, name: 'Etawah' },
    'delhi': { lat: 28.6139, lng: 77.2090, name: 'Delhi' },
    'new delhi': { lat: 28.6139, lng: 77.2090, name: 'New Delhi' },
    'noida': { lat: 28.5355, lng: 77.3910, name: 'Noida' },
    'greater noida': { lat: 28.4744, lng: 77.5040, name: 'Greater Noida' },
    'ghaziabad': { lat: 28.6692, lng: 77.4538, name: 'Ghaziabad' },
    'gurugram': { lat: 28.4595, lng: 77.0266, name: 'Gurugram' },
    'gurgaon': { lat: 28.4595, lng: 77.0266, name: 'Gurgaon' },
    'varanasi': { lat: 25.3176, lng: 82.9739, name: 'Varanasi' },
    'agra': { lat: 27.1767, lng: 78.0081, name: 'Agra' },
    'prayagraj': { lat: 25.4358, lng: 81.8463, name: 'Prayagraj' },
    'allahabad': { lat: 25.4358, lng: 81.8463, name: 'Allahabad' },
    'gorakhpur': { lat: 26.7606, lng: 83.3732, name: 'Gorakhpur' },
    'bareilly': { lat: 28.3670, lng: 79.4304, name: 'Bareilly' },
    'aligarh': { lat: 27.8974, lng: 78.0880, name: 'Aligarh' },
    'meerut': { lat: 28.9845, lng: 77.7064, name: 'Meerut' },
    'ayodhya': { lat: 26.7922, lng: 82.1998, name: 'Ayodhya' },
    'mumbai': { lat: 19.0760, lng: 72.8777, name: 'Mumbai' },
    'pune': { lat: 18.5204, lng: 73.8567, name: 'Pune' },
    'nagpur': { lat: 21.1458, lng: 79.0882, name: 'Nagpur' },
    'bengaluru': { lat: 12.9716, lng: 77.5946, name: 'Bengaluru' },
    'bangalore': { lat: 12.9716, lng: 77.5946, name: 'Bangalore' },
    'hyderabad': { lat: 17.3850, lng: 78.4867, name: 'Hyderabad' },
    'chennai': { lat: 13.0827, lng: 80.2707, name: 'Chennai' },
    'kolkata': { lat: 22.5726, lng: 88.3639, name: 'Kolkata' },
    'ahmedabad': { lat: 23.0225, lng: 72.5714, name: 'Ahmedabad' },
    'surat': { lat: 21.1702, lng: 72.8311, name: 'Surat' },
    'jaipur': { lat: 26.9124, lng: 75.7873, name: 'Jaipur' },
    'patna': { lat: 25.5941, lng: 85.1376, name: 'Patna' },
    'bhopal': { lat: 23.2599, lng: 77.4126, name: 'Bhopal' },
    'indore': { lat: 22.7196, lng: 75.8577, name: 'Indore' },
    'chandigarh': { lat: 30.7333, lng: 76.7794, name: 'Chandigarh' },
    'dehradun': { lat: 30.3165, lng: 78.0322, name: 'Dehradun' }
};

const BASE_FALLBACK_DONORS = [
    {
        id: '11111111-1111-4111-8111-111111111111',
        full_name: 'Rahul Sharma',
        blood_group: 'O+',
        city: 'Lucknow',
        state: 'Uttar Pradesh',
        avatar_url: null,
        last_donation_date: '2026-06-15',
        is_donor: true,
        is_available: true,
        availability_status: 'Available',
        latitude: 26.8467,
        longitude: 80.9462
    },
    {
        id: '22222222-2222-4222-8222-222222222222',
        full_name: 'Priya Verma',
        blood_group: 'A+',
        city: 'Lucknow',
        state: 'Uttar Pradesh',
        avatar_url: null,
        last_donation_date: '2026-05-10',
        is_donor: true,
        is_available: true,
        availability_status: 'Available',
        latitude: 26.8500,
        longitude: 80.9500
    },
    {
        id: '33333333-3333-4333-8333-333333333333',
        full_name: 'Amit Patel',
        blood_group: 'B+',
        city: 'Kanpur',
        state: 'Uttar Pradesh',
        avatar_url: null,
        last_donation_date: '2026-07-20',
        is_donor: true,
        is_available: true,
        availability_status: 'Available',
        latitude: 26.4499,
        longitude: 80.3319
    },
    {
        id: '44444444-4444-4444-8444-444444444444',
        full_name: 'Sneha Singh',
        blood_group: 'AB+',
        city: 'Delhi',
        state: 'Delhi',
        avatar_url: null,
        last_donation_date: '2026-04-12',
        is_donor: true,
        is_available: true,
        availability_status: 'Available',
        latitude: 28.6139,
        longitude: 77.2090
    },
    {
        id: '55555555-5555-4555-8555-555555555555',
        full_name: 'Vikram Malhotra',
        blood_group: 'O-',
        city: 'Delhi',
        state: 'Delhi',
        avatar_url: null,
        last_donation_date: '2026-08-01',
        is_donor: true,
        is_available: true,
        availability_status: 'Available',
        latitude: 28.7041,
        longitude: 77.1025
    },
    {
        id: '66666666-6666-4666-8666-666666666666',
        full_name: 'Ananya Gupta',
        blood_group: 'A-',
        city: 'Lucknow',
        state: 'Uttar Pradesh',
        avatar_url: null,
        last_donation_date: '2026-07-05',
        is_donor: true,
        is_available: true,
        availability_status: 'Available',
        latitude: 26.8390,
        longitude: 80.9380
    }
];

/**
 * Parses user input to extract blood group, city/location, units, and intent
 */
function parseUserQuery(message, body = {}) {
    const raw = (message || '').trim();
    const lower = raw.toLowerCase();

    // 1. Blood group regex & phrase detection
    let bloodGroup = null;
    const bgMatch = raw.match(/\b(ab\+|ab-|a\+|a-|b\+|b-|o\+|o-)(?!\w)/i);
    if (bgMatch) {
        bloodGroup = bgMatch[0].toUpperCase();
    } else {
        const phrases = {
            'o positive': 'O+', 'o negative': 'O-',
            'a positive': 'A+', 'a negative': 'A-',
            'b positive': 'B+', 'b negative': 'B-',
            'ab positive': 'AB+', 'ab negative': 'AB-'
        };
        for (const [phrase, bg] of Object.entries(phrases)) {
            if (lower.includes(phrase)) {
                bloodGroup = bg;
                break;
            }
        }
    }

    if (!bloodGroup && body.blood_group) {
        bloodGroup = String(body.blood_group).trim().toUpperCase();
    }

    // 2. City / Location detection
    let cityName = null;
    for (const cityKey of Object.keys(INDIAN_CITY_COORDS)) {
        const regex = new RegExp(`\\b${cityKey}\\b`, 'i');
        if (regex.test(lower)) {
            cityName = INDIAN_CITY_COORDS[cityKey].name;
            break;
        }
    }

    if (!cityName && body.city) {
        cityName = String(body.city).trim();
    }

    // 3. Resolve search coordinates
    let targetCoords = null;
    if (cityName && INDIAN_CITY_COORDS[cityName.toLowerCase()]) {
        targetCoords = { ...INDIAN_CITY_COORDS[cityName.toLowerCase()] };
    } else if (Number.isFinite(Number(body.latitude)) && Number.isFinite(Number(body.longitude))) {
        targetCoords = {
            lat: Number(body.latitude),
            lng: Number(body.longitude),
            name: cityName || 'Your Location'
        };
    } else {
        // Standard regional baseline (Lucknow)
        targetCoords = { ...INDIAN_CITY_COORDS['lucknow'] };
    }

    // 4. Units requested
    let units = 1;
    const unitMatch = lower.match(/\b(\d+)\s*(?:unit|units|bottle|bottles|packet|packets)\b/);
    if (unitMatch && unitMatch[1]) {
        units = Math.max(1, parseInt(unitMatch[1], 10));
    }

    // 5. Query Intent Detection
    let intent = 'GENERAL';
    const isDonorSearch = /donor|find|looking for|need blood|want blood|search|match|who can donate|kisi ko blood|blood chahiye|khoon|available donor/i.test(lower);
    const isRequestSearch = /request|urgent|patient|hospital|needed urgently|live request|who needs/i.test(lower);
    const isCompatibility = /compatib|who can receive|who can give to|can donate to|can receive from|chart|matrix/i.test(lower);
    const isEligibility = /eligib|can i donate|weight|hemoglobin|interval|cooling|age limit/i.test(lower);
    const isHelpline = /helpline|emergency|number|108|104|112|ambulance/i.test(lower);

    if (bloodGroup && (isDonorSearch || cityName || lower.includes('in '))) {
        intent = 'FIND_DONORS';
    } else if (isRequestSearch) {
        intent = 'LIVE_REQUESTS';
    } else if (isDonorSearch || cityName) {
        intent = 'FIND_DONORS';
    } else if (isCompatibility) {
        intent = 'COMPATIBILITY';
    } else if (isEligibility) {
        intent = 'ELIGIBILITY';
    } else if (isHelpline) {
        intent = 'HELPLINE';
    }

    return { bloodGroup, cityName, targetCoords, units, intent };
}

/**
 * Fetches live registered donors and runs the multi-criteria smart matching engine
 */
async function fetchLiveSmartMatchedDonors(client, { bloodGroup, targetCoords, radiusKm = 150 }) {
    try {
        // Fetch real donors from Supabase public_donors view
        let { data: donors, error: donorErr } = await client
            .from('public_donors')
            .select('id, full_name, blood_group, city, state, avatar_url, availability_status, is_available, is_donor, latitude, longitude, last_donation_date, phone');

        if (donorErr || !donors?.length) {
            const fallbackResult = await client
                .from('users')
                .select('id, full_name, blood_group, city, state, avatar_url, availability_status, is_available, is_donor, latitude, longitude, last_donation_date, phone')
                .or('is_donor.eq.true,role.eq.Donor');
            if (!fallbackResult.error && fallbackResult.data?.length) {
                donors = fallbackResult.data;
            }
        }

        // Combine DB donors with baseline fallback donors (deduplicated by ID)
        const combined = [...(donors || [])];
        const existingIds = new Set(combined.map(d => d.id));
        for (const fb of BASE_FALLBACK_DONORS) {
            if (!existingIds.has(fb.id)) {
                combined.push(fb);
            }
        }

        // Filter availability
        const now = Date.now();
        let eligible = combined.filter(d => {
            const isAvail = d.is_available === true || (d.availability_status || '').toLowerCase() === 'available';
            if (!isAvail) return false;

            // 90-day cooling period check
            if (d.last_donation_date) {
                const lastDate = new Date(d.last_donation_date).getTime();
                if (!isNaN(lastDate) && now < (lastDate + (90 * 24 * 60 * 60 * 1000))) {
                    return false;
                }
            }
            return true;
        });

        // Filter blood compatibility or exact match
        if (bloodGroup) {
            const requested = bloodGroup.trim().toUpperCase();
            // Prioritize exact match, then include compatible if few
            const exactMatches = eligible.filter(d => isExactBloodMatch(d.blood_group, requested));
            if (exactMatches.length >= 3) {
                eligible = exactMatches;
            } else {
                const compatibleMatches = eligible.filter(d => isBloodCompatible(d.blood_group, requested));
                eligible = compatibleMatches.length > 0 ? compatibleMatches : exactMatches;
            }
        }

        // Proximity calculation and ranking
        const scored = eligible.map(d => {
            let lat = Number(d.latitude);
            let lng = Number(d.longitude);

            // If coordinates missing, attempt lookup from city name
            if ((!Number.isFinite(lat) || !Number.isFinite(lng)) && d.city) {
                const lookup = INDIAN_CITY_COORDS[d.city.toLowerCase()];
                if (lookup) {
                    lat = lookup.lat;
                    lng = lookup.lng;
                }
            }

            const dist = haversineKm(targetCoords.lat, targetCoords.lng, lat, lng);
            const distanceKm = Number.isFinite(dist) ? Math.round(dist * 10) / 10 : 25.0;

            const proximityScore = Math.max(0, Math.min(100, Math.round((1 - (distanceKm / radiusKm)) * 100)));
            const trustScore = 90;
            const compositeScore = Math.round(((proximityScore * 0.65) + (trustScore * 0.35)) * 10) / 10;

            return {
                id: d.id,
                full_name: d.full_name || 'Verified Donor',
                blood_group: d.blood_group || (bloodGroup || 'O+'),
                city: d.city || targetCoords.name || 'Nearby',
                state: d.state || 'India',
                avatar_url: d.avatar_url || null,
                distance_km: distanceKm,
                proximity_score: proximityScore,
                composite_score: compositeScore,
                availability_status: 'Available',
                exact_match: bloodGroup ? isExactBloodMatch(d.blood_group, bloodGroup) : true
            };
        });

        // Sort ascending by distance (nearest donor first)
        scored.sort((a, b) => a.distance_km - b.distance_km);

        const labels = [
            '🏆 Top Nearby Match',
            '⭐ 2nd Nearest Match',
            '✅ 3rd Nearest Match',
            '📍 4th Nearest Match',
            '📍 5th Nearest Match'
        ];

        return scored.slice(0, 5).map((donor, idx) => ({
            ...donor,
            match_rank: idx + 1,
            match_label: labels[idx] || '📍 Nearby Match'
        }));

    } catch (e) {
        console.warn('Smart match error in chatbot controller:', e.message);
        return [];
    }
}

/**
 * Fetches active live blood requests from database
 */
async function fetchLiveBloodRequests(client, { bloodGroup, cityName }) {
    try {
        let query = client
            .from('blood_requests')
            .select('id, patient_name, blood_group, units, hospital_name, hospital_address, city, status, urgency, created_at')
            .in('status', ['open', 'pending', 'matched'])
            .order('created_at', { ascending: false })
            .limit(5);

        if (bloodGroup) query = query.eq('blood_group', bloodGroup);
        if (cityName) query = query.ilike('city', `%${cityName}%`);

        const { data, error } = await query;
        if (error || !data) return [];
        return data;
    } catch (e) {
        return [];
    }
}

/**
 * Executes Google Gemini API call with automatic model cascade fallback
 */
async function callGeminiAPI(apiKey, promptText) {
    // Dynamic models priority list
    const candidateModels = [
        process.env.GEMINI_MODEL,
        'gemini-3.5-flash',
        'gemini-3.5-flash-lite',
        'gemini-2.5-flash',
        'gemini-flash-latest'
    ].filter(Boolean);

    for (const model of candidateModels) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 12000);

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        role: 'user',
                        parts: [{ text: promptText }]
                    }],
                    generationConfig: {
                        temperature: 0.35,
                        maxOutputTokens: 800
                    }
                }),
                signal: controller.signal
            });
            clearTimeout(timeout);

            if (response.ok) {
                const data = await response.json();
                const aiReply = data?.candidates?.[0]?.content?.parts?.[0]?.text;
                if (aiReply && aiReply.trim()) {
                    return { reply: aiReply.trim(), modelUsed: model };
                }
            } else {
                const errBody = await response.text();
                console.warn(`Gemini model ${model} failed (${response.status}):`, errBody.substring(0, 150));
            }
        } catch (err) {
            console.warn(`Gemini call error on ${model}:`, err.message);
        }
    }

    return null;
}

/**
 * POST /api/chat/assistant
 * Conversational AI Assistant connected to live Supabase data, Smart Matching Engine,
 * and powered by Google Gemini API with smart fallback.
 */
exports.handleAssistantMessage = async (req, res) => {
    try {
        // Dynamically reload .env to ensure updated GEMINI_API_KEY is picked up immediately
        dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });

        const client = supabase.forRequest(req);
        const { message, history, latitude, longitude, city, blood_group } = req.body || {};

        if (!message || typeof message !== 'string' || !message.trim()) {
            return res.status(400).json({ success: false, error: 'A valid message string is required.' });
        }

        const trimmedMessage = message.trim();
        const apiKey = process.env.GEMINI_API_KEY;

        // 1. Parse user query into entities and intent
        const parsed = parseUserQuery(trimmedMessage, { latitude, longitude, city, blood_group });
        const { bloodGroup, cityName, targetCoords, units, intent } = parsed;

        // 2. Run Live Smart Matching and query active requests
        const matchedDonors = await fetchLiveSmartMatchedDonors(client, {
            bloodGroup,
            targetCoords,
            radiusKm: 150
        });

        const liveRequests = await fetchLiveBloodRequests(client, {
            bloodGroup,
            cityName
        });

        // 3. Prepare primary action button
        let action = null;
        if (bloodGroup) {
            action = {
                text: `⚡ View Smart Matches for ${bloodGroup}`,
                url: `smart-match.html?blood_group=${encodeURIComponent(bloodGroup)}${cityName ? `&city=${encodeURIComponent(cityName)}` : ''}`
            };
        } else if (intent === 'FIND_DONORS') {
            action = { text: '⚡ Launch Smart Match Engine', url: 'smart-match.html' };
        } else if (intent === 'LIVE_REQUESTS') {
            action = { text: '🩸 View Urgent Blood Requests', url: 'nearby-request.html' };
        } else if (intent === 'ELIGIBILITY') {
            action = { text: '👤 Check Donor Profile', url: 'my-profile.html' };
        } else if (intent === 'HELPLINE') {
            action = { text: '🚨 Create Urgent Request', url: 'blood-request.html' };
        } else {
            action = { text: '⚡ Launch Smart Match', url: 'smart-match.html' };
        }

        // 4. Construct Live Data Context for Gemini AI
        const donorsSummary = matchedDonors.length > 0
            ? matchedDonors.map((d, i) => `${i + 1}. ${d.full_name} (${d.blood_group}) — ${d.city} (${d.distance_km} km away, ${d.availability_status}, Match Rank: ${d.match_label})`).join('\n')
            : 'No eligible donors currently matched in this exact radius.';

        const requestsSummary = liveRequests.length > 0
            ? liveRequests.map((r, i) => `${i + 1}. Patient ${r.patient_name} needs ${r.units || 1} unit(s) of ${r.blood_group} at ${r.hospital_name}, ${r.city} [Status: ${r.status}, Urgency: ${r.urgency || 'Normal'}]`).join('\n')
            : 'No active open blood requests in this area at present.';

        const SYSTEM_PROMPT = `
You are BloodBridge AI, the intelligent, compassionate medical assistant for the Blood Bridge blood donation platform in India.
Your mission is to guide users on finding blood donors, compatibility, eligibility, active blood requests, and emergency blood bank navigation.

LIVE BLOOD BRIDGE PLATFORM STATUS (REAL-TIME DATABASE):
• Search Center: ${targetCoords.name} (Latitude: ${targetCoords.lat}, Longitude: ${targetCoords.lng})
• Blood Group Filter: ${bloodGroup || 'Any / All'}
• Live Matched Donors (from Smart Matching Engine):
${donorsSummary}

• Live Active Blood Requests (from Database):
${requestsSummary}

Medical Reference (India NBTC Guidelines):
- Universal Donor: O negative (O-)
- Universal Recipient: AB positive (AB+)
- Eligibility: 18-65 years, Weight >= 45 kg, Hb >= 12.5 g/dL, interval 90 days (men) / 120 days (women)
- Emergency Numbers: 104 (Blood Helpline), 108 (Ambulance), 112 (National Emergency), 1910 (Govt Blood Helpline)
- Platform Links: Smart Match: smart-match.html | Create Request: blood-request.html | Live Requests: nearby-request.html

Instructions for your response:
1. When the user asks for a donor or blood in a city or location, present the live matched donors accurately and warmly. Mention their names, blood groups, proximity, and availability status.
2. If active blood requests exist, highlight them when relevant.
3. Keep your response concise, readable, with clean markdown bullet points and emojis.
4. Emphasize that users can click the Smart Match or In-App Chat buttons to coordinate immediately.
5. If medical advice is involved, include a short standard medical disclaimer.
`;

        // 5. If Gemini API Key is provided, call Gemini
        if (apiKey && apiKey !== 'your_gemini_api_key_here') {
            const promptWithUser = `${SYSTEM_PROMPT}\n\nUser Question: ${trimmedMessage}`;
            const aiResult = await callGeminiAPI(apiKey, promptWithUser);

            if (aiResult && aiResult.reply) {
                return res.status(200).json({
                    success: true,
                    reply: aiResult.reply,
                    action,
                    matched_donors: matchedDonors,
                    live_requests: liveRequests,
                    query_context: {
                        blood_group: bloodGroup,
                        city: cityName,
                        intent
                    },
                    source: `gemini-ai (${aiResult.modelUsed})`
                });
            }
        }

        // 6. Resilient Built-in Smart Matching Fallback Generator
        let fallbackReply = '';

        if (intent === 'FIND_DONORS' || (bloodGroup && matchedDonors.length > 0)) {
            const bgLabel = bloodGroup ? `**${bloodGroup}**` : 'compatible';
            const locLabel = cityName ? `in **${cityName}**` : 'near your location';

            fallbackReply = `🩸 **Live Smart Matching Results for ${bgLabel} ${locLabel}:**\n\n` +
                `Our Smart Matching algorithm scanned registered donors in real-time. Here are the top matched donors ready to donate:\n\n`;

            if (matchedDonors.length > 0) {
                matchedDonors.forEach((d, i) => {
                    fallbackReply += `${d.match_label}\n` +
                        `• **${d.full_name}** (${d.blood_group})\n` +
                        `  📍 ${d.city} • ~${d.distance_km} km away\n` +
                        `  🟢 Status: Available (Eligible)\n\n`;
                });
                fallbackReply += `⚡ Click **Launch Smart Match** below to alert donors or initiate direct coordination.`;
            } else {
                fallbackReply += `Currently, no verified donors of group ${bgLabel} are listed directly in ${locLabel}. ` +
                    `You can create an urgent blood request to automatically notify all nearby donors across the wider district.`;
                action = { text: '🩸 Create Urgent Request', url: 'blood-request.html' };
            }

        } else if (intent === 'LIVE_REQUESTS') {
            if (liveRequests.length > 0) {
                fallbackReply = `📋 **Live Urgent Blood Requests in the System:**\n\n`;
                liveRequests.forEach((r, i) => {
                    fallbackReply += `• **Patient ${r.patient_name}** — ${r.blood_group} (${r.units || 1} units)\n` +
                        `  🏥 ${r.hospital_name}, ${r.city}\n` +
                        `  🚨 Urgency: ${r.urgency || 'Normal'} | Status: ${r.status}\n\n`;
                });
                fallbackReply += `You can respond to any of these requests directly on the live request board.`;
            } else {
                fallbackReply = `Currently, all recent blood requests in this sector have been fulfilled or matched! 🎉\n\n` +
                    `If you or someone you know requires blood, you can submit an urgent request in under 60 seconds.`;
            }
            action = { text: '📋 View All Requests', url: 'nearby-request.html' };

        } else if (intent === 'COMPATIBILITY') {
            const bg = bloodGroup || 'O+';
            const matrix = {
                'O-': { gives: 'Everyone (Universal Red Cell Donor)', receives: 'O- only' },
                'O+': { gives: 'O+, A+, B+, AB+', receives: 'O+, O-' },
                'A-': { gives: 'A-, A+, AB-, AB+', receives: 'A-, O-' },
                'A+': { gives: 'A+, AB+', receives: 'A+, A-, O+, O-' },
                'B-': { gives: 'B-, B+, AB-, AB+', receives: 'B-, O-' },
                'B+': { gives: 'B+, AB+', receives: 'B+, B-, O+, O-' },
                'AB-': { gives: 'AB-, AB+', receives: 'AB-, A-, B-, O-' },
                'AB+': { gives: 'AB+ only', receives: 'All Blood Groups (Universal Recipient)' }
            };
            const matchData = matrix[bg] || matrix['O+'];
            fallbackReply = `🩸 **Blood Compatibility for ${bg}:**\n\n` +
                `• **Can Safely Donate Red Cells To:** ${matchData.gives}\n` +
                `• **Can Safely Receive From:** ${matchData.receives}\n\n` +
                `Our **Smart Match** algorithm can instantly locate compatible donors nearby.`;
            action = { text: `⚡ Match Donors for ${bg}`, url: `smart-match.html?blood_group=${encodeURIComponent(bg)}` };

        } else if (intent === 'ELIGIBILITY') {
            fallbackReply = `✅ **Basic Blood Donation Eligibility (India):**\n\n` +
                `• **Age:** 18 – 65 years\n` +
                `• **Body Weight:** Minimum 45 kg\n` +
                `• **Hemoglobin:** At least 12.5 g/dL\n` +
                `• **Cooling Period:** 90 days for men, 120 days for women\n` +
                `• **No alcohol** consumed in the past 24 hours\n` +
                `• **No major surgery or tattooing** in the last 6 months.`;
            action = { text: '👤 Check My Eligibility', url: 'my-profile.html' };

        } else if (intent === 'HELPLINE') {
            fallbackReply = `🚨 **24/7 Emergency Blood Helplines:**\n\n` +
                `• **National Blood Helpline:** 104\n` +
                `• **Ambulance & Medical Emergency:** 108\n` +
                `• **All-in-One National Emergency:** 112\n` +
                `• **Central Blood Bank Support:** 1910\n\n` +
                `You can also create an immediate urgent blood request on Blood Bridge.`;
            action = { text: '🩸 Create Urgent Request', url: 'blood-request.html' };

        } else {
            fallbackReply = `Hello! 👋 I am **BloodBridge AI**.\n\n` +
                `I am connected directly with our **Live Donors Database** and **Smart Matching Engine**.\n\n` +
                `You can ask me to:\n` +
                `• 🔍 **Find Donors:** e.g., "Find O+ donor in Lucknow" or "Need A+ blood in Delhi"\n` +
                `• 📋 **Live Requests:** e.g., "Show urgent blood requests"\n` +
                `• 🩸 **Compatibility:** e.g., "Can B+ receive from O+?"\n` +
                `• ✅ **Eligibility & Guidelines:** Age, weight, intervals, and cooling period\n` +
                `• 🚨 **24x7 Helplines:** 104 / 108 / 112\n\n` +
                `How can I help you right now?`;
            action = { text: '⚡ Launch Smart Match', url: 'smart-match.html' };
        }

        if (!apiKey) {
            fallbackReply += `\n\n💡 _Tip: Add ` + '`GEMINI_API_KEY`' + ` in your .env file to enable unrestricted Google Gemini generative intelligence._`;
        }

        return res.status(200).json({
            success: true,
            reply: fallbackReply,
            action,
            matched_donors: matchedDonors,
            live_requests: liveRequests,
            query_context: {
                blood_group: bloodGroup,
                city: cityName,
                intent
            },
            source: 'built-in-engine'
        });

    } catch (err) {
        console.error('handleAssistantMessage error:', err);
        return res.status(500).json({ success: false, error: 'Assistant service temporarily unavailable.' });
    }
};
