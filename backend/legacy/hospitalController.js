// backend/controllers/hospitalController.js
const supabase = require('../config/supabaseClient');

// Get high-level statistics for dashboards
exports.getDashboardStats = async (req, res) => {
    try {
        const { hospital_name } = req.query;

        // Base queries
        let requestsQuery = supabase.from('blood_requests').select('status, units', { count: 'exact' });
        
        if (hospital_name) {
            requestsQuery = requestsQuery.eq('hospital_name', hospital_name);
        }

        const [requestsRes, donorsRes] = await Promise.all([
            requestsQuery,
            supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'Donor')
        ]);

        if (requestsRes.error) throw requestsRes.error;
        if (donorsRes.error) throw donorsRes.error;

        // Calculate active vs fulfilled requests
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

// Manage hospital blood inventory
exports.updateInventory = async (req, res) => {
    try {
        const { hospital_id, blood_group, units } = req.body;

        const { data, error } = await supabase
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