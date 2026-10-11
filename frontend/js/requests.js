// frontend/js/requests.js

document.addEventListener('DOMContentLoaded', () => {
    const supabaseClient = window.bloodBridgeSupabase;
    const requestForm = document.querySelector('#blood-request-form');
    
    if (requestForm) {
        requestForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            // Extract values from the form inputs
            const urgencyInput = document.querySelector('input[name="urgency"]:checked');

            if (!supabaseClient?.auth) {
                alert('Authentication service is unavailable. Please refresh the page.');
                return;
            }

            const { data: sessionData } = await supabaseClient.auth.getSession();
            const requesterId = sessionData?.session?.user?.id;

            if (!requesterId) {
                alert("You must be logged in to create a request.");
                return;
            }

            const value = (name) => requestForm.elements[name].value.trim();
            const requestPayload = {
                patient_name: value('patient_name'),
                blood_group: value('blood_group'),
                units: Number(value('units')),
                urgency: urgencyInput?.value || 'Pending',
                hospital_name: value('hospital_name'),
                hospital_address: value('hospital_address'),
                city: value('city'),
                required_date: value('required_date'),
                required_time: value('required_time'),
                additional_info: value('additional_info'),
                requester_id: requesterId
            };

            if (!requestPayload.patient_name || !requestPayload.blood_group || !requestPayload.hospital_name ||
                !requestPayload.hospital_address || !requestPayload.city || !requestPayload.required_date ||
                !requestPayload.required_time || !Number.isInteger(requestPayload.units) || requestPayload.units < 1) {
                alert('Please complete all required request details.');
                return;
            }

            try {
                const accessToken = sessionData.session.access_token;
                // Send data to your Node.js/Express backend
                const response = await fetch('/api/requests', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${accessToken}`
                    },
                    body: JSON.stringify(requestPayload)
                });

                const result = await response.json();

                if (result.success) {
                    alert("Blood request submitted successfully!");
                    window.location.href = 'nearby-request.html';
                } else {
                    alert("Error: " + result.error);
                }
            } catch (error) {
                console.error("Error submitting request:", error);
                alert("Failed to connect to the server.");
            }
        });
    }
});
