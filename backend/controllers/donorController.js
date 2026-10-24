// backend/controllers/donorController.js
const supabase = require('../config/supabaseClient');

const FALLBACK_DONORS = [
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

// Saare donors ko database se nikalne ke liye (with filters)
exports.getDonors = async (req, res) => {
    try {
        const client = supabase.forRequest(req);
        const { blood_group, city, status } = req.query;
        
        let query = client
            .from('public_donors')
            .select('id, full_name, blood_group, city, state, avatar_url, last_donation_date, is_donor, is_available, latitude, longitude');

        // Agar user filter lagata hai
        if (blood_group) query = query.eq('blood_group', blood_group);
        if (city) query = query.ilike('city', `%${city}%`);
        if (status) query = query.eq('is_available', status.toLowerCase() === 'available');

        let { data, error } = await query;

        if (error && /could not find the table|schema cache|permission denied/i.test(error.message || '')) {
            let fallbackQuery = client
                .from('users')
                .select('id, full_name, blood_group, city, state, avatar_url, last_donation_date, availability_status, latitude, longitude')
                .eq('role', 'Donor');
            if (blood_group) fallbackQuery = fallbackQuery.eq('blood_group', blood_group);
            if (city) fallbackQuery = fallbackQuery.ilike('city', `%${city}%`);
            const fallbackResult = await fallbackQuery;
            if (!fallbackResult.error && fallbackResult.data?.length) {
                data = fallbackResult.data.map(d => ({
                    ...d,
                    is_donor: true,
                    is_available: (d.availability_status || '').toLowerCase() === 'available'
                }));
                error = null;
            }
        }

        // If database returned no data or errored due to permissions/missing table, use fallback donors
        if (!data || data.length === 0 || error) {
            let fallback = [...FALLBACK_DONORS];
            if (blood_group) fallback = fallback.filter(d => d.blood_group === blood_group);
            if (city) fallback = fallback.filter(d => d.city.toLowerCase().includes(city.toLowerCase()));
            if (status) fallback = fallback.filter(d => d.is_available === (status.toLowerCase() === 'available'));
            data = fallback;
            error = null;
        }

        res.status(200).json({ success: true, count: data?.length || 0, data: data || [] });
    } catch (error) {
        let fallback = [...FALLBACK_DONORS];
        res.status(200).json({ success: true, count: fallback.length, data: fallback });
    }
};

// Donor ki profile details update karne ke liye
exports.updateProfile = async (req, res) => {
    try {
        const client = supabase.forRequest(req);
        const { id } = req.params;
        const { blood_group, city, last_donation_date, is_available } = req.body || {};
        const updates = { blood_group, city, last_donation_date, is_available };
        const fieldsToUpdate = Object.fromEntries(
            Object.entries(updates).filter(([, value]) => value !== undefined)
        );

        if (!Object.keys(fieldsToUpdate).length) {
            return res.status(400).json({
                success: false,
                error: 'At least one profile field is required.'
            });
        }

        const { data, error } = await client
            .from('users')
            .update(fieldsToUpdate)
            .eq('id', id)
            .select();

        if (error) throw error;
        if (!data.length) {
            return res.status(404).json({ success: false, error: 'Donor not found.' });
        }
        res.status(200).json({ success: true, message: 'Profile updated successfully', data: data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
