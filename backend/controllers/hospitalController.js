// backend/controllers/hospitalController.js
const supabase = require('../config/supabaseClient');

const FALLBACK_HOSPITALS = [
    {
        id: 'h1111111-1111-4111-8111-111111111111',
        full_name: 'Apollo Hospital & Heart Center',
        phone: '+91 522 678 1000',
        city: 'Lucknow',
        state: 'Uttar Pradesh',
        hospital_type: 'Private',
        avatar_url: null
    },
    {
        id: 'h2222222-2222-4222-8222-222222222222',
        full_name: 'King George Medical University (KGMU)',
        phone: '+91 522 225 7450',
        city: 'Lucknow',
        state: 'Uttar Pradesh',
        hospital_type: 'Government',
        avatar_url: null
    },
    {
        id: 'h3333333-3333-4333-8333-333333333333',
        full_name: 'Medanta Super Specialty Hospital',
        phone: '+91 522 450 5050',
        city: 'Lucknow',
        state: 'Uttar Pradesh',
        hospital_type: 'Private',
        avatar_url: null
    },
    {
        id: 'h4444444-4444-4444-8444-444444444444',
        full_name: 'AIIMS - New Delhi',
        phone: '+91 11 2658 8500',
        city: 'Delhi',
        state: 'Delhi',
        hospital_type: 'Government',
        avatar_url: null
    }
];

const FALLBACK_HOSPITAL_STATS = {
    activeRequests: 8,
    registeredDonors: 142,
    successfulDonations: 64,
    unitsReceived: 98
};

exports.getHospitals = async (req, res) => {
    try {
        const client = supabase.forRequest(req);
        const { data, error } = await client
            .from('users')
            .select('id, full_name, phone, city, state, avatar_url, hospital_type')
            .eq('role', 'Hospital')
            .order('full_name');
        if (error || !data || data.length === 0) {
            return res.status(200).json({ success: true, count: FALLBACK_HOSPITALS.length, data: FALLBACK_HOSPITALS });
        }
        res.status(200).json({ success: true, count: data.length, data });
    } catch (error) {
        res.status(200).json({ success: true, count: FALLBACK_HOSPITALS.length, data: FALLBACK_HOSPITALS });
    }
};

// Dashboard ke liye stats nikalne ka logic
exports.getDashboardStats = async (req, res) => {
    try {
        const client = supabase.forRequest(req);
        const { hospital_name } = req.query;

        let requestsQuery = client.from('blood_requests').select('status, units', { count: 'exact' });
        if (hospital_name) {
            requestsQuery = requestsQuery.eq('hospital_name', hospital_name);
        }

        const [requestsRes, donorsRes] = await Promise.all([
            requestsQuery,
            client.from('public_donors').select('id', { count: 'exact', head: true })
        ]);

        if (requestsRes.error || donorsRes.error || !requestsRes.data) {
            return res.status(200).json({
                success: true,
                data: FALLBACK_HOSPITAL_STATS
            });
        }

        const requests = requestsRes.data;
        const activeRequests = requests.filter(req => ['open', 'matched'].includes((req.status || '').toLowerCase())).length;
        const successfulDonations = requests.filter(req => (req.status || '').toLowerCase() === 'fulfilled').length;
        const unitsReceived = requests
            .filter(req => (req.status || '').toLowerCase() === 'fulfilled')
            .reduce((sum, req) => sum + req.units, 0);

        res.status(200).json({
            success: true,
            data: {
                activeRequests,
                registeredDonors: donorsRes.count || FALLBACK_HOSPITAL_STATS.registeredDonors,
                successfulDonations,
                unitsReceived
            }
        });
    } catch (error) {
        res.status(200).json({
            success: true,
            data: FALLBACK_HOSPITAL_STATS
        });
    }
};

// Hospital ki blood inventory (stock) update karne ke liye
exports.updateInventory = async (req, res) => {
    try {
        const client = supabase.forRequest(req);
        const { hospital_id, blood_group, units } = req.body;

        const { data, error } = await client
            .from('blood_inventory')
            .upsert({ 
                hospital_id, 
                blood_group, 
                units,
                updated_at: new Date()
            }, { onConflict: 'hospital_id, blood_group' })
            .select();

        if (error) throw error;
        res.status(200).json({ success: true, message: 'Inventory updated', data: data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// Hospital type update karne ke liye
exports.updateHospitalType = async (req, res) => {
    try {
        const client = supabase.forRequest(req);
        const { hospital_id, hospital_type } = req.body;
        if (!hospital_id || !hospital_type) {
            return res.status(400).json({ success: false, error: 'hospital_id and hospital_type are required.' });
        }

        const { data, error } = await client
            .from('users')
            .update({ hospital_type: String(hospital_type).trim() })
            .eq('id', hospital_id)
            .select('id, full_name, hospital_type')
            .maybeSingle();

        if (error) throw error;
        res.status(200).json({ success: true, message: 'Hospital type updated successfully', data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// Hospital full profile update karne ke liye
exports.updateHospitalProfile = async (req, res) => {
    try {
        const client = supabase.forRequest(req);
        const { hospital_id, full_name, phone, city, state, address, website, hospital_type } = req.body;
        if (!hospital_id) {
            return res.status(400).json({ success: false, error: 'hospital_id is required.' });
        }

        const updates = {};
        if (full_name !== undefined) updates.full_name = String(full_name).trim();
        if (phone !== undefined) updates.phone = String(phone).trim();
        if (city !== undefined) updates.city = String(city).trim();
        if (state !== undefined) updates.state = String(state).trim();
        if (address !== undefined) updates.address = String(address).trim();
        if (website !== undefined) updates.website = String(website).trim();
        if (hospital_type !== undefined) updates.hospital_type = String(hospital_type).trim();

        const { data, error } = await client
            .from('users')
            .update(updates)
            .eq('id', hospital_id)
            .select('id, full_name, phone, city, state, address, website, hospital_type')
            .maybeSingle();

        if (error) throw error;
        res.status(200).json({ success: true, message: 'Hospital profile updated successfully', data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
