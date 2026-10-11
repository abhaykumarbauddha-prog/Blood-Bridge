// backend/controllers/requestController.js
const supabase = require('../config/supabaseClient');

// Create a new blood request
exports.createRequest = async (req, res) => {
    try {
        const {
            patient_name,
            blood_group,
            units,
            urgency,
            hospital_name,
            hospital_address,
            city,
            required_date,
            required_time,
            additional_info,
            requester_id
        } = req.body;

        const { data, error } = await supabase
            .from('blood_requests')
            .insert([{
                patient_name,
                blood_group,
                units,
                urgency,
                hospital_name,
                hospital_address,
                city,
                required_date,
                required_time,
                additional_info,
                requester_id
            }])
            .select();

        if (error) throw error;

        res.status(201).json({
            success: true,
            message: 'Blood request created successfully',
            data: data
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// Get all nearby/active blood requests (Filtered by city/status)
exports.getRequests = async (req, res) => {
    try {
        const { city, blood_group } = req.query;
        
        let query = supabase
            .from('blood_requests')
            .select('*')
            .eq('status', 'Pending')
            .order('created_at', { ascending: false });

        // Apply filters if provided in the URL query string
        if (city) query = query.ilike('city', `%${city}%`);
        if (blood_group) query = query.eq('blood_group', blood_group);

        const { data, error } = await query;

        if (error) throw error;

        res.status(200).json({
            success: true,
            count: data.length,
            data: data
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// Update request status (e.g., from Pending to Fulfilled)
exports.updateRequestStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const { data, error } = await supabase
            .from('blood_requests')
            .update({ status: status })
            .eq('id', id)
            .select();

        if (error) throw error;

        res.status(200).json({
            success: true,
            message: `Request marked as ${status}`,
            data: data
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};