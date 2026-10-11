// backend/controllers/donorController.js
const supabase = require('../config/supabaseClient');

// Saare donors ko database se nikalne ke liye (with filters)
exports.getDonors = async (req, res) => {
    try {
        const client = supabase.forRequest(req);
        const { blood_group, city, status } = req.query;
        
        let query = client
            .from('users')
            .select('id, full_name, phone, blood_group, city, last_donation_date, availability_status')
            .eq('role', 'Donor');

        // Agar user filter lagata hai
        if (blood_group) query = query.eq('blood_group', blood_group);
        if (city) query = query.ilike('city', `%${city}%`);
        if (status) query = query.eq('availability_status', status);

        const { data, error } = await query;

        if (error) throw error;
        res.status(200).json({ success: true, count: data.length, data: data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// Donor ki profile details update karne ke liye
exports.updateProfile = async (req, res) => {
    try {
        const client = supabase.forRequest(req);
        const { id } = req.params;
        const { blood_group, city, last_donation_date, availability_status } = req.body || {};
        const updates = { blood_group, city, last_donation_date, availability_status };
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
