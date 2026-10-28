// backend/controllers/smartMatchController.js
/**
 * Blood Bridge — Advanced Smart Matching Engine V2
 * Multi-criteria donor matching with radius, blood compatibility,
 * proximity scoring, trust scoring, and priority classification.
 */

const supabase = require('../config/supabaseClient');

// Blood Compatibility Helper — Strict Exact Match as required by Blood Bridge specifications
function isExactBloodMatch(donorGroup, requestedGroup) {
    if (!donorGroup || !requestedGroup) return false;
    return donorGroup.trim().toUpperCase() === requestedGroup.trim().toUpperCase();
}

/**
 * Haversine formula for distance between two coordinates in km
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

/**
 * SMART MATCHING API — POST /api/smart-match
 * 
 * 7-Step Exact Match Scenario:
 * 1. Find donors in radius selected by requester
 * 2. Check & note requested blood group and units needed
 * 3. System holds blood group & units needed context
 * 4. Fetch registered donors from database with their blood group info
 * 5. Match EXACT Blood Group between Donors and Requesters (A+ only matches A+)
 * 6. Pool eligible matched donors
 * 7. Check location of every matched donor, sort by nearest proximity, and select top 5
 */
exports.findSmartMatches = async (req, res) => {
    try {
        const client = supabase.forRequest(req);
        const {
            request_id,
            blood_group,
            units = 1,
            latitude,
            longitude,
            search_radius_km = 25,
            urgency = 'Normal',
            requester_id
        } = req.body || {};

        // Step 2 & 3: Validate and note Blood Group and Units Needed
        if (!blood_group) {
            return res.status(400).json({ success: false, error: 'blood_group is required.' });
        }
        const requestedBloodGroup = blood_group.trim().toUpperCase();
        const unitsNeeded = Math.max(1, parseInt(units, 10) || 1);

        const reqLat = Number(latitude);
        const reqLng = Number(longitude);
        if (!Number.isFinite(reqLat) || !Number.isFinite(reqLng)) {
            return res.status(400).json({ success: false, error: 'Valid latitude and longitude are required.' });
        }

        const radiusKm = Math.min(Math.max(Number(search_radius_km) || 25, 1), 500);

        // ============================================================
        // STEP 4: Fetch registered donors with blood group from database
        // ============================================================
        let { data: donors, error: donorError } = await client
            .from('public_donors')
            .select('id, full_name, blood_group, city, state, availability_status, is_available, is_donor, latitude, longitude, last_donation_date, avatar_url');

        if (donorError || !donors?.length) {
            const fallbackResult = await client
                .from('users')
                .select('id, full_name, blood_group, city, state, availability_status, is_available, is_donor, latitude, longitude, last_donation_date, avatar_url')
                .or('is_donor.eq.true,role.eq.Donor');
            if (!fallbackResult.error && fallbackResult.data?.length) {
                donors = fallbackResult.data;
            }
        }

        if (!donors || donors.length === 0) {
            return res.status(200).json({
                success: true,
                matches: [],
                message: 'No donors registered in the system.',
                summary: {
                    total_donors_in_system: 0,
                    donors_in_radius: 0,
                    exact_blood_matched: 0,
                    available_eligible: 0,
                    matches_returned: 0,
                    units_needed: unitsNeeded,
                    blood_group_requested: requestedBloodGroup
                }
            });
        }

        // ============================================================
        // STEP 1: Find donors in the radius selected by requester
        // ============================================================
        let radiusFiltered = donors.filter(donor => {
            if (requester_id && donor.id === requester_id) return false; // Exclude requester self

            const dLat = Number(donor.latitude);
            const dLng = Number(donor.longitude);
            if (!Number.isFinite(dLat) || !Number.isFinite(dLng)) return false;

            const distance = haversineKm(reqLat, reqLng, dLat, dLng);
            donor._distanceKm = parseFloat(distance.toFixed(1));
            return distance <= radiusKm;
        });

        // ============================================================
        // STEP 5: Match EXACT Blood Group (Donors === Requester)
        // Strictly no cross-matching (e.g. A+ will ONLY match A+)
        // ============================================================
        let exactBloodFiltered = radiusFiltered.filter(donor => {
            return isExactBloodMatch(donor.blood_group, requestedBloodGroup);
        });

        // ============================================================
        // STEP 6: Eligible Matched Donors pool (Availability & Cooling)
        // ============================================================
        let availableFiltered = exactBloodFiltered.filter(donor => {
            const isAvailable = donor.is_available === true ||
                (donor.availability_status || '').toLowerCase() === 'available';
            return isAvailable;
        });

        // Check 90-day cooling period enforcement
        const now = Date.now();
        availableFiltered = availableFiltered.filter(donor => {
            if (!donor.last_donation_date) return true;
            const lastDonation = new Date(donor.last_donation_date).getTime();
            if (isNaN(lastDonation)) return true;
            const nextEligible = lastDonation + (90 * 24 * 60 * 60 * 1000);
            return now >= nextEligible;
        });

        // Fetch past donations for trust context
        const donorIds = availableFiltered.map(d => d.id);
        let donationCounts = {};

        if (donorIds.length > 0) {
            const { data: responses, error: respError } = await client
                .from('request_responses')
                .select('donor_id, status')
                .in('donor_id', donorIds)
                .in('status', ['donated', 'fulfilled', 'completed']);

            if (!respError && responses) {
                responses.forEach(r => {
                    donationCounts[r.donor_id] = (donationCounts[r.donor_id] || 0) + 1;
                });
            }
        }

        // ============================================================
        // STEP 7: Check location of matched donors, rank by nearby
        // proximity, and select TOP 5 closest donors
        // ============================================================
        const maxDistance = radiusKm;
        const maxDonations = Math.max(1, ...Object.values(donationCounts), 1);

        const scoredDonors = availableFiltered.map(donor => {
            // Proximity Score (0-100): Closer = higher
            const proximityScore = Math.max(0, Math.round((1 - (donor._distanceKm / maxDistance)) * 100));

            // Trust Score (0-100) based on verified donations
            const pastDonations = donationCounts[donor.id] || 0;
            const trustScore = Math.min(100, Math.round((pastDonations / maxDonations) * 100));

            // Readiness Score (0-100) based on donation recency
            let recencyScore = 100;
            if (donor.last_donation_date) {
                const daysSince = Math.floor((now - new Date(donor.last_donation_date).getTime()) / (1000 * 60 * 60 * 24));
                recencyScore = Math.min(100, Math.max(0, Math.round(((daysSince - 90) / 275) * 100)));
            }

            // Proximity is prioritized for emergency response
            const compositeScore = Math.round(((proximityScore * 0.65) + (trustScore * 0.25) + (recencyScore * 0.10)) * 10) / 10;

            return {
                id: donor.id,
                full_name: donor.full_name,
                blood_group: donor.blood_group,
                city: donor.city,
                state: donor.state,
                avatar_url: donor.avatar_url,
                phone: donor.phone,
                latitude: donor.latitude,
                longitude: donor.longitude,
                distance_km: donor._distanceKm,
                past_donations: pastDonations,
                last_donation_date: donor.last_donation_date,
                proximity_score: proximityScore,
                trust_score: trustScore,
                availability_score: 100,
                recency_score: recencyScore,
                composite_score: compositeScore,
                exact_match: true,
                units_requested: unitsNeeded
            };
        });

        // Sort strictly by nearest proximity (ascending distance: 0.1 km, 0.5 km, 1.2 km...)
        scoredDonors.sort((a, b) => a.distance_km - b.distance_km);

        // Select TOP 5 nearby located donors
        const top5Matches = scoredDonors.slice(0, 5);

        // Classify labels for top 5
        const labels = [
            '🏆 Top Nearby Match',
            '⭐ 2nd Nearest Match',
            '✅ 3rd Nearest Match',
            '📍 4th Nearest Match',
            '📍 5th Nearest Match'
        ];
        const labelKeys = ['top_match', 'best_match', 'good_match', 'recommended', 'recommended'];

        const classifiedMatches = top5Matches.map((donor, index) => ({
            ...donor,
            match_rank: index + 1,
            match_label: labels[index] || '📍 Nearby Match',
            match_label_key: labelKeys[index] || 'recommended'
        }));

        // Summary structure
        const summary = {
            total_donors_in_system: donors.length,
            donors_in_radius: radiusFiltered.length,
            exact_blood_matched: exactBloodFiltered.length,
            available_eligible: availableFiltered.length,
            matches_returned: classifiedMatches.length,
            search_radius_km: radiusKm,
            blood_group_requested: requestedBloodGroup,
            units_needed: unitsNeeded,
            urgency: urgency,
            request_id: request_id || null
        };

        return res.status(200).json({
            success: true,
            matches: classifiedMatches,
            summary
        });

    } catch (error) {
        console.error('Smart Match error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Returns match labels array based on urgency
 */
function getMatchLabels(urgency) {
    return [
        '🏆 Top Nearby Match',
        '⭐ 2nd Nearest Match',
        '✅ 3rd Nearest Match',
        '📍 4th Nearest Match',
        '📍 5th Nearest Match'
    ];
}

function getLabelKey(index, urgency) {
    const keys = ['top_match', 'best_match', 'good_match', 'recommended', 'recommended'];
    return keys[index] || 'recommended';
}

/**
 * GET /api/smart-match/request/:id
 * Auto-run smart match for an existing blood request
 */
exports.matchForRequest = async (req, res) => {
    try {
        const client = supabase.forRequest(req);
        const requestId = req.params.id;

        const { data: request, error: reqError } = await client
            .from('blood_requests')
            .select('*')
            .eq('id', requestId)
            .maybeSingle();

        if (reqError || !request) {
            return res.status(404).json({ success: false, error: 'Blood request not found.' });
        }

        // Forward to the main smart match handler with request data
        req.body = {
            request_id: request.id,
            blood_group: request.blood_group,
            units: request.units_needed || 1,
            latitude: request.latitude,
            longitude: request.longitude,
            search_radius_km: request.search_radius_km || 100,
            urgency: request.urgency || 'Normal',
            requester_id: request.requester_id
        };

        return exports.findSmartMatches(req, res);

    } catch (error) {
        console.error('Match for request error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
};
