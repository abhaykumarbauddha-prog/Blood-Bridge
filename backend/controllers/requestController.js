// backend/controllers/requestController.js
const supabase = require('../config/supabaseClient');

// Nayi blood request create karne ke liye
exports.createRequest = async (req, res) => {
    try {
        const client = supabase.forRequest(req);
        const { patient_name, blood_group, units, urgency, hospital_name, hospital_address, city, required_date, required_time, additional_info, requester_id } = req.body || {};

        const requiredFields = {
            patient_name,
            blood_group,
            units,
            urgency,
            hospital_name,
            hospital_address,
            city,
            required_date,
            required_time,
            requester_id
        };
        const missingField = Object.entries(requiredFields).find(([, value]) => (
            value === undefined || value === null || value === ''
        ));

        if (missingField) {
            return res.status(400).json({
                success: false,
                error: `${missingField[0]} is required.`
            });
        }

        if (!Number.isInteger(units) || units < 1) {
            return res.status(400).json({ success: false, error: 'units must be a positive integer.' });
        }

        const { data, error } = await client
            .from('blood_requests')
            .insert([{ patient_name, blood_group, units, urgency, hospital_name, hospital_address, city, required_date, required_time, additional_info, requester_id }])
            .select();

        if (error) throw error;
        res.status(201).json({ success: true, message: 'Request created successfully', data: data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// Saari pending blood requests dekhne ke liye
exports.getRequests = async (req, res) => {
    try {
        const client = supabase.forRequest(req);
        const { city, blood_group } = req.query;

        let query = client
            .from('blood_requests')
            .select('*')
            .eq('status', 'Pending');

        if (city) query = query.ilike('city', `%${city}%`);
        if (blood_group) query = query.eq('blood_group', blood_group);

        const { data, error } = await query.order('created_at', { ascending: false });

        if (error) throw error;
        res.status(200).json({ success: true, count: data.length, data: data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// Blood request ka status update karne ke liye
exports.updateRequestStatus = async (req, res) => {
    try {
        const client = supabase.forRequest(req);
        const { id } = req.params;
        const { status } = req.body || {};
        const allowedStatuses = ['Pending', 'Urgent', 'Critical', 'Fulfilled'];

        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                error: `status must be one of: ${allowedStatuses.join(', ')}.`
            });
        }

        const { data, error } = await client
            .from('blood_requests')
            .update({ status })
            .eq('id', id)
            .select();

        if (error) throw error;
        if (!data.length) {
            return res.status(404).json({ success: false, error: 'Blood request not found.' });
        }

        res.status(200).json({
            success: true,
            message: `Request marked as ${status}.`,
            data
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
