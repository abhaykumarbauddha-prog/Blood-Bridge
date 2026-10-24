// backend/controllers/requestController.js
const supabase = require('../config/supabaseClient');

// Blood Compatibility helper (Universal biological chart)
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

// Smart Matching: Matches requests with compatible donors and notifies them
async function triggerSmartMatching(client, request) {
    try {
        const { id, patient_name, blood_group, units, hospital_name, city, requester_id } = request;

        // 1. Fetch potential donors from public.users table
        const { data: donors, error: donorError } = await client
            .from('users')
            .select('id, full_name, blood_group, city, availability_status, is_available')
            .neq('id', requester_id);

        if (donorError) {
            console.warn('Smart matching donor fetch note:', donorError.message);
            return;
        }

        if (!donors || donors.length === 0) return;

        // 2. Filter donors whose blood group is compatible and who are available
        const matchedDonors = donors.filter(donor => {
            const isAvail = donor.is_available === true || (donor.availability_status || '').toLowerCase() === 'available';
            if (!isAvail) return false;

            return isBloodCompatible(donor.blood_group, blood_group);
        });

        console.log(`Smart matching: Found ${matchedDonors.length} compatible donor(s) for request ${id} (${blood_group})`);

        if (matchedDonors.length > 0) {
            // 3. Insert notification for every matched donor
            const notifications = matchedDonors.map(donor => ({
                user_id: donor.id,
                type: 'request',
                title: `Urgent Blood Match: ${blood_group} Needed! 🩸`,
                body: `Hello ${donor.full_name || 'Donor'}, patient ${patient_name} urgently needs ${units || 1} unit(s) of ${blood_group} blood at ${hospital_name}, ${city || 'nearby'}. Your blood profile is a compatible match!`,
                link: 'nearby-request.html'
            }));

            const { error: notifErr } = await client
                .from('notifications')
                .insert(notifications);

            if (notifErr) {
                console.warn('Smart matching notification insert note:', notifErr.message);
            }
        }

        // 4. Send broadcast confirmation notification to the requester
        if (requester_id) {
            await client.from('notifications').insert([{
                user_id: requester_id,
                type: 'system',
                title: 'Blood Request Broadcasted! 📢',
                body: `Your request for ${patient_name} (${units || 1} unit(s) of ${blood_group}) has been broadcasted to ${matchedDonors.length} matching donors.`,
                link: 'nearby-request.html'
            }]).catch(err => console.warn('Requester notif note:', err.message));
        }

    } catch (err) {
        console.error('Smart matching exception:', err);
    }
}

// ==========================================
// 1. CREATE BLOOD REQUEST
// ==========================================
exports.createRequest = async (req, res) => {
    try {
        const client = supabase.forRequest(req);
        const { patient_name, blood_group, units, urgency, hospital_name, hospital_address, city, required_date, required_time, additional_info, requester_id, latitude, longitude } = req.body || {};

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

        const requiredBy = new Date(`${required_date}T${required_time}:00+05:30`);
        if (Number.isNaN(requiredBy.getTime()) || requiredBy <= new Date()) {
            return res.status(400).json({ success: false, error: 'required_by must be in the future.' });
        }

        const duplicateSince = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
        const { data: duplicateRows, error: duplicateError } = await client
            .from('blood_requests')
            .select('id')
            .eq('requester_id', requester_id)
            .eq('patient_name', patient_name)
            .eq('blood_group', blood_group)
            .eq('hospital_name', hospital_name)
            .gte('created_at', duplicateSince)
            .limit(1);

        if (duplicateError) throw duplicateError;
        if (duplicateRows?.length) {
            return res.status(409).json({ success: false, error: 'A similar request was already created within the last 6 hours.' });
        }

        let { data, error } = await client
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
                required_by: requiredBy.toISOString(),
                additional_info,
                requester_id,
                latitude,
                longitude,
                status: 'open'
            }])
            .select();

        if (error && /column .* does not exist|could not find the .* column/i.test(error.message || '')) {
            const fallbackInsert = await client
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
                    requester_id,
                    latitude,
                    longitude,
                    status: 'Pending'
                }])
                .select();
            if (!fallbackInsert.error) {
                data = fallbackInsert.data;
                error = null;
            }
        }

        if (error) throw error;

        const createdRequest = (data && data[0]) ? data[0] : req.body;

        // Trigger Smart Matching in background
        triggerSmartMatching(client, createdRequest);

        res.status(201).json({ success: true, message: 'Request created successfully', data: data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ==========================================
// 2. GET BLOOD REQUESTS
// ==========================================
exports.getRequests = async (req, res) => {
    try {
        const client = supabase.forRequest(req);
        let query = client.from('blood_requests').select('*');

        if (req.query.status) {
            if (req.query.status === 'all') {
                // Return all statuses without filtering
            } else if (req.query.status.includes(',')) {
                const statuses = req.query.status.split(',').map(s => s.trim());
                query = query.in('status', statuses);
            } else {
                query = query.eq('status', req.query.status);
            }
        } else {
            // Default: include active and fulfilled/completed requests
            query = query.in('status', ['open', 'matched', 'pending', 'fulfilled', 'completed']);
        }

        if (req.query.blood_group) {
            query = query.eq('blood_group', req.query.blood_group);
        }

        if (req.query.city) {
            query = query.ilike('city', `%${req.query.city}%`);
        }

        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) throw error;

        res.status(200).json({ success: true, data: data || [] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ==========================================
// 3. ACCEPT / COMPLETE BLOOD REQUEST (Donor accepts/donates)
// ==========================================
exports.acceptRequest = async (req, res) => {
    try {
        const client = supabase.forRequest(req);
        const requestId = req.params.id;
        const donorId = req.body.donor_id;
        const isComplete = req.body.complete !== false; // Default true: clicking Accept/Donate completes donation
        const donationDate = req.body.donated_at || new Date().toISOString();

        if (!donorId) {
            return res.status(400).json({ success: false, error: 'donor_id is required.' });
        }

        // 1. Fetch blood request details
        const { data: request, error: reqErr } = await client
            .from('blood_requests')
            .select('*')
            .eq('id', requestId)
            .maybeSingle();

        if (reqErr || !request) {
            return res.status(404).json({ success: false, error: 'Blood request not found.' });
        }

        // 2. Fetch donor details and check cooling period
        const { data: donor } = await client
            .from('users')
            .select('full_name, phone, last_donation_date')
            .eq('id', donorId)
            .maybeSingle();

        const donorName = donor?.full_name || 'A verified donor';
        const donorPhone = donor?.phone || '';

        // Check if donor is in 3-month (90 days) cooling period
        let lastDonationTs = donor?.last_donation_date ? new Date(donor.last_donation_date).getTime() : null;

        // Also check request_responses for recent completed donations
        const { data: recentDonations } = await client
            .from('request_responses')
            .select('donated_at, created_at, updated_at')
            .eq('donor_id', donorId)
            .in('status', ['donated', 'fulfilled', 'completed', 'accepted'])
            .order('created_at', { ascending: false })
            .limit(5);

        if (Array.isArray(recentDonations) && recentDonations.length > 0) {
            recentDonations.forEach(r => {
                const ts = new Date(r.donated_at || r.updated_at || r.created_at).getTime();
                if (!isNaN(ts) && (!lastDonationTs || ts > lastDonationTs)) {
                    lastDonationTs = ts;
                }
            });
        }

        if (lastDonationTs) {
            const nextEligible = new Date(lastDonationTs + 90 * 24 * 60 * 60 * 1000);
            const msRemaining = nextEligible.getTime() - Date.now();
            const daysRemaining = Math.max(0, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)));
            if (daysRemaining > 0) {
                return res.status(400).json({
                    success: false,
                    cooling_period: true,
                    daysRemaining,
                    lastDonationDate: new Date(lastDonationTs).toISOString(),
                    nextEligibleDate: nextEligible.toISOString(),
                    error: `Cooling period is running! You have ${daysRemaining} days remaining in your 3-month cooling period. You cannot accept requests until it finishes.`
                });
            }
        }

        // 3. Upsert into request_responses with status = 'donated' (or 'accepted' if pledge only)
        const newResponseStatus = isComplete ? 'donated' : 'accepted';
        const { data: responseData, error: respError } = await client
            .from('request_responses')
            .upsert({
                request_id: requestId,
                donor_id: donorId,
                status: newResponseStatus,
                donated_at: isComplete ? donationDate : null
            }, { onConflict: 'request_id,donor_id' })
            .select()
            .maybeSingle();

        if (respError) throw respError;

        // 4. Update blood_requests status to 'fulfilled' (or 'matched' if pledge only)
        const requestStatus = isComplete ? 'fulfilled' : 'matched';
        await client
            .from('blood_requests')
            .update({ status: requestStatus })
            .eq('id', requestId);

        // 5. Update donor's last_donation_date in users table if completed
        if (isComplete) {
            await client
                .from('users')
                .update({ last_donation_date: donationDate.split('T')[0] })
                .eq('id', donorId);
        }

        // 6. Send Notification to the REQUESTER:
        if (request.requester_id) {
            const contactMsg = donorPhone ? ` Contact: ${donorPhone}.` : '';
            const notifTitle = isComplete ? 'Blood Donation Completed! 🎉' : 'Donor Accepted Your Request! ❤️';
            const notifBody = isComplete
                ? `Wonderful news! Donor ${donorName} has accepted and completed the blood donation for ${request.patient_name} at ${request.hospital_name}.${contactMsg} The request is now marked as Completed.`
                : `Good news! Donor ${donorName} has accepted your blood request for ${request.patient_name} at ${request.hospital_name}.${contactMsg}`;

            await client
                .from('notifications')
                .insert([{
                    user_id: request.requester_id,
                    type: isComplete ? 'system' : 'response',
                    title: notifTitle,
                    body: notifBody,
                    link: 'nearby-request.html'
                }]);
        }

        // 7. Send Confirmation Notification to the DONOR:
        const donorNotifTitle = isComplete ? 'Blood Donation Successful! 🏆' : `Donation Pledge Saved: ${request.patient_name} 🩸`;
        const donorNotifBody = isComplete
            ? `Thank you, ${donorName}! Your blood donation for patient ${request.patient_name} at ${request.hospital_name} has been completed and recorded in your Donation History.`
            : `You accepted to donate for ${request.patient_name} at ${request.hospital_name}, ${request.city}. You can view and manage this pledge in Donation History.`;

        await client
            .from('notifications')
            .insert([{
                user_id: donorId,
                type: isComplete ? 'badge_earned' : 'response',
                title: donorNotifTitle,
                body: donorNotifBody,
                link: 'donation-history.html'
            }]);

        res.status(200).json({
            success: true,
            message: isComplete
                ? 'Blood request completed successfully! Donor history and requester notified.'
                : 'Blood request accepted successfully! Donation pledge saved and requester notified.',
            data: responseData
        });

    } catch (error) {
        console.error('Accept request error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ==========================================
// 4. COMPLETE DONATION (Donation held & verified)
// ==========================================
exports.completeDonation = async (req, res) => {
    try {
        const client = supabase.forRequest(req);
        const requestId = req.params.id;
        const donorId = req.body.donor_id;
        const donationDate = req.body.donated_at || new Date().toISOString();

        // 1. Fetch request details to get patient_name, hospital, requester_id
        const { data: request, error: reqErr } = await client
            .from('blood_requests')
            .select('*')
            .eq('id', requestId)
            .maybeSingle();

        if (reqErr || !request) {
            return res.status(404).json({ success: false, error: 'Blood request not found.' });
        }

        // 2. Fetch requester name
        const { data: requesterUser } = await client
            .from('users')
            .select('full_name')
            .eq('id', request.requester_id)
            .maybeSingle();

        const requesterName = requesterUser?.full_name || 'Requester';

        // 3. Find response record
        let updateQuery = client
            .from('request_responses')
            .update({
                status: 'donated',
                donated_at: donationDate
            })
            .eq('request_id', requestId);

        if (donorId) {
            updateQuery = updateQuery.eq('donor_id', donorId);
        }

        const { data: updatedResp, error: respErr } = await updateQuery.select().maybeSingle();
        if (respErr) throw respErr;

        const effectiveDonorId = donorId || updatedResp?.donor_id;

        // 4. Update blood_requests status to 'fulfilled'
        await client
            .from('blood_requests')
            .update({ status: 'fulfilled' })
            .eq('id', requestId);

        // 5. Update donor's last_donation_date in users table
        if (effectiveDonorId) {
            await client
                .from('users')
                .update({ last_donation_date: donationDate.split('T')[0] })
                .eq('id', effectiveDonorId);

            const { data: donorUser } = await client
                .from('users')
                .select('full_name')
                .eq('id', effectiveDonorId)
                .maybeSingle();

            const donorName = donorUser?.full_name || 'Donor';

            // Send completion notification to donor
            await client
                .from('notifications')
                .insert([{
                    user_id: effectiveDonorId,
                    type: 'badge_earned',
                    title: 'Blood Donation Successful! 🏆',
                    body: `Thank you, ${donorName}! Your blood donation for patient ${request.patient_name} (Requested by: ${requesterName}) held on ${new Date(donationDate).toLocaleDateString()} has been verified and recorded in your Donation History.`,
                    link: 'donation-history.html'
                }]);

            // Send completion notification to requester
            if (request.requester_id) {
                await client
                    .from('notifications')
                    .insert([{
                        user_id: request.requester_id,
                        type: 'system',
                        title: 'Donation Completed Successfully! 🎉',
                        body: `The blood donation for patient ${request.patient_name} by donor ${donorName} has been completed. Thank you for using Blood Bridge!`,
                        link: 'nearby-request.html'
                    }]);
            }
        }

        res.status(200).json({
            success: true,
            message: 'Donation successfully marked as completed! Donor history and profiles updated.',
            data: updatedResp
        });

    } catch (error) {
        console.error('Complete donation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ==========================================
// 5. GET DONOR HISTORY (With Requester Name & Donation Date)
// ==========================================
exports.getDonorHistory = async (req, res) => {
    try {
        const client = supabase.forRequest(req);
        const donorId = req.params.donor_id;

        if (!donorId) {
            return res.status(400).json({ success: false, error: 'donor_id is required.' });
        }

        // Fetch request_responses where donor_id matches, including accepted and donated
        const { data: responses, error: respError } = await client
            .from('request_responses')
            .select(`
                id,
                status,
                donated_at,
                created_at,
                request_id,
                blood_requests (
                    id,
                    patient_name,
                    blood_group,
                    units,
                    hospital_name,
                    hospital_address,
                    city,
                    required_date,
                    requester_id
                )
            `)
            .eq('donor_id', donorId)
            .in('status', ['accepted', 'donated'])
            .order('created_at', { ascending: false });

        if (respError) throw respError;

        // Fetch requester names for each request
        const requesterIds = [...new Set((responses || []).map(r => r.blood_requests?.requester_id).filter(Boolean))];
        let requesterMap = {};

        if (requesterIds.length > 0) {
            const { data: requesters } = await client
                .from('users')
                .select('id, full_name, phone')
                .in('id', requesterIds);

            if (requesters) {
                requesters.forEach(u => {
                    requesterMap[u.id] = u.full_name;
                });
            }
        }

        const enrichedHistory = (responses || []).map(row => {
            const reqData = row.blood_requests || {};
            const requesterName = requesterMap[reqData.requester_id] || 'Requester';
            return {
                id: row.id,
                request_id: row.request_id,
                status: row.status,
                donated_at: row.donated_at,
                created_at: row.created_at,
                patient_name: reqData.patient_name || 'Patient',
                requester_name: requesterName,
                hospital_name: reqData.hospital_name || 'Hospital',
                hospital_address: reqData.hospital_address || '',
                city: reqData.city || '',
                blood_group: reqData.blood_group || '',
                units: reqData.units || 1,
                required_date: reqData.required_date
            };
        });

        res.status(200).json({
            success: true,
            data: enrichedHistory
        });

    } catch (error) {
        console.error('Donor history error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ==========================================
// 6. UPDATE REQUEST STATUS
// ==========================================
exports.updateRequestStatus = async (req, res) => {
    try {
        const client = supabase.forRequest(req);
        const { id } = req.params;
        const { status } = req.body || {};
        const allowedStatuses = ['open', 'matched', 'fulfilled', 'expired', 'cancelled'];

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
