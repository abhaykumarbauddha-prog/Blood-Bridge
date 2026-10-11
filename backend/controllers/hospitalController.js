// backend/controllers/hospitalController.js
const supabase = require('../config/supabaseClient');

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
            client.from('users').select('id', { count: 'exact', head: true }).eq('role', 'Donor')
        ]);

        if (requestsRes.error) throw requestsRes.error;
        if (donorsRes.error) throw donorsRes.error;

        const requests = requestsRes.data;
        const activeRequests = requests.filter(req => req.status === 'Pending' || req.status === 'Urgent').length;
        const successfulDonations = requests.filter(req => req.status === 'Fulfilled').length;
        const unitsReceived = requests
            .filter(req => req.status === 'Fulfilled')
            .reduce((sum, req) => sum + req.units, 0);

        res.status(200).json({
            success: true,
            data: {
                activeRequests,
                registeredDonors: donorsRes.count,
                successfulDonations,
                unitsReceived
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// Hospital ki blood inventory (stock) update karne ke liye
exports.updateInventory = async (req, res) => {
    try {
        const client = supabase.forRequest(req);
        const { hospital_id, blood_group, units } = req.body;

        const { data, error } = await client
            .from('hospital_inventory')
            .upsert({ 
                hospital_id, 
                blood_group, 
                units,
                last_updated: new Date()
            }, { onConflict: 'hospital_id, blood_group' })
            .select();

        if (error) throw error;
        res.status(200).json({ success: true, message: 'Inventory updated', data: data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
