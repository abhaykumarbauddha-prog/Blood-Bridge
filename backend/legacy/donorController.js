// backend/controllers/donorController.js
const supabase = require('../config/supabaseClient');

// Get all donors with optional filtering
exports.getDonors = async (req, res) => {
    try {
        const { blood_group, city, status } = req.query;
        
        let query = supabase
            .from('users')
            .select('id, full_name, phone, blood_group, city, last_donation_date, availability_status')
            .eq('role', 'Donor');

        // Apply filters
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

// Update a donor's profile information
exports.updateProfile = async (req, res) => {
    try {
        const { id } = req.params;
        const { blood_group, city, last_donation_date, availability_status } = req.body;

        const { data, error } = await supabase
            .from('users')
            .update({ 
                blood_group, 
                city, 
                last_donation_date, 
                availability_status 
            })
            .eq('id', id)
            .select();

        if (error) throw error;

        res.status(200).json({ success: true, message: 'Profile updated', data: data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};