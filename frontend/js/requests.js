// frontend/js/requests.js

document.addEventListener('DOMContentLoaded', async () => {
    const supabaseClient = window.bloodBridgeSupabase;
    const requestForm = document.querySelector('#blood-request-form');
    const locationMapContainer = document.getElementById('request-location-map');
    const locationSearchInput = document.getElementById('map-location-search');
    const useMyLocationBtn = document.getElementById('btn-use-my-location');
    const selectedLocationText = document.getElementById('selected-location-text');
    const recentRequestsContainer = document.getElementById('recent-requests-container');

    const hospitalAddressInput = document.querySelector('input[name="hospital_address"]');
    const cityInput = document.querySelector('input[name="city"]');

    let requestMap = null;
    let requestMarker = null;

    // ==========================================
    // 1. Interactive Map & Geolocation Setup
    // ==========================================
    if (locationMapContainer && window.MapService && window.L) {
        // Initial coordinates (Default Lucknow)
        let initialLat = MapService.DEFAULT_COORDS.lat;
        let initialLng = MapService.DEFAULT_COORDS.lng;

        requestMap = MapService.createMap('request-location-map', {
            center: [initialLat, initialLng],
            zoom: 13
        });

        // Create draggable location pin
        requestMarker = L.marker([initialLat, initialLng], {
            draggable: true,
            title: 'Drag to set hospital location'
        }).addTo(requestMap);

        requestMarker.bindPopup('<b>Hospital Location</b><br>Drag me to adjust location').openPopup();

        // Update inputs when pin is dragged
        requestMarker.on('dragend', async () => {
            const position = requestMarker.getLatLng();
            await updateLocationFromCoords(position.lat, position.lng);
        });

        // Click anywhere on map to move pin
        requestMap.on('click', async (e) => {
            requestMarker.setLatLng(e.latlng);
            await updateLocationFromCoords(e.latlng.lat, e.latlng.lng);
        });

        // Auto-fetch user's current GPS position on load if allowed
        MapService.getUserLocation().then((loc) => {
            if (loc && loc.isLive) {
                applyCoordsToMap(loc.lat, loc.lng, false);
            }
        });

        // Helper to update text & inputs from coordinates
        async function updateLocationFromCoords(lat, lng) {
            if (selectedLocationText) {
                selectedLocationText.textContent = 'Locating address...';
            }
            const info = await MapService.reverseGeocode(lat, lng);
            if (selectedLocationText) {
                selectedLocationText.textContent = info.displayName || `${info.city}, Uttar Pradesh`;
            }
            if (cityInput && (!cityInput.value || cityInput.value.trim() === '')) {
                cityInput.value = info.city;
            }
            if (hospitalAddressInput && (!hospitalAddressInput.value || hospitalAddressInput.value.trim() === '')) {
                hospitalAddressInput.value = info.displayName;
            }
        }

        function applyCoordsToMap(lat, lng, zoomIn = true) {
            if (!requestMap || !requestMarker) return;
            requestMarker.setLatLng([lat, lng]);
            requestMap.panTo([lat, lng]);
            if (zoomIn) requestMap.setZoom(14);
            updateLocationFromCoords(lat, lng);
        }

        // "🎯 Use My Location" Button
        if (useMyLocationBtn) {
            useMyLocationBtn.addEventListener('click', async () => {
                useMyLocationBtn.textContent = '⏳ Locating...';
                const loc = await MapService.getUserLocation();
                useMyLocationBtn.textContent = '🎯 Use My Location';
                if (loc) {
                    applyCoordsToMap(loc.lat, loc.lng, true);
                }
            });
        }

        // Search Input on Map
        if (locationSearchInput) {
            const handleSearch = async () => {
                const query = locationSearchInput.value.trim();
                if (!query) return;
                const coords = await MapService.geocodeAddress(query);
                if (coords) {
                    applyCoordsToMap(coords.lat, coords.lng, true);
                }
            };

            locationSearchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSearch();
                }
            });
        }

        // Auto-pan map if user types city or hospital address
        let debounceTimer = null;
        const triggerMapPanFromInputs = () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(async () => {
                const query = [hospitalAddressInput?.value, cityInput?.value].filter(Boolean).join(', ');
                if (query.trim().length > 3) {
                    const coords = await MapService.geocodeAddress(query);
                    if (coords) {
                        requestMarker.setLatLng([coords.lat, coords.lng]);
                        requestMap.panTo([coords.lat, coords.lng]);
                    }
                }
            }, 800);
        };

        if (cityInput) cityInput.addEventListener('input', triggerMapPanFromInputs);
        if (hospitalAddressInput) hospitalAddressInput.addEventListener('input', triggerMapPanFromInputs);
    }

    // ==========================================
    // 2. Load Real Recent Requests from Database
    // ==========================================
    async function loadRecentRequests() {
        if (!recentRequestsContainer || !supabaseClient) return;

        try {
            const { data: requests, error } = await supabaseClient
                .from('blood_requests')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(4);

            if (error) throw error;

            if (!requests || requests.length === 0) {
                recentRequestsContainer.innerHTML = `
                    <div style="text-align: center; padding: 24px 12px; color: var(--text-secondary); font-size: 0.85rem;">
                        <span style="font-size: 1.8rem; display: block; margin-bottom: 6px;">🩸</span>
                        No active requests found yet.<br>New blood requests will appear here.
                    </div>
                `;
                return;
            }

            recentRequestsContainer.innerHTML = requests.map(req => {
                const urgency = req.urgency || 'Normal';
                let tagClass = 'tag-pending';
                if (urgency.toLowerCase() === 'critical') tagClass = 'tag-critical';
                else if (urgency.toLowerCase() === 'urgent') tagClass = 'tag-urgent';

                const reqDate = req.created_at ? new Date(req.created_at).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric'
                }) : 'Recent';

                return `
                    <div class="recent-req-item">
                        <div class="req-person">
                            <h5><span style="color: var(--brand-primary);">📍</span> ${escapeHtml(req.patient_name)}</h5>
                            <p>${escapeHtml(req.blood_group)} • ${req.units} ${req.units > 1 ? 'Units' : 'Unit'}<br>${escapeHtml(req.hospital_name || '')}, ${escapeHtml(req.city || '')}</p>
                        </div>
                        <div style="text-align: right;">
                            <div class="status-tag ${tagClass}" style="margin-bottom: 4px;">${escapeHtml(urgency)}</div>
                            <p style="font-size: 0.7rem; color: var(--text-secondary);">${reqDate}</p>
                        </div>
                    </div>
                `;
            }).join('');
        } catch (err) {
            console.error('Error loading recent requests:', err);
            recentRequestsContainer.innerHTML = `
                <div style="text-align: center; padding: 16px; color: var(--text-secondary); font-size: 0.8rem;">
                    Unable to load requests.
                </div>
            `;
        }
    }

    loadRecentRequests();

    // ==========================================
    // 3. Form Submission Handling
    // ==========================================
    if (requestForm) {
        requestForm.addEventListener('submit', async (e) => {
            e.preventDefault();

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

            const submitBtn = requestForm.querySelector('button[type="submit"]');
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = 'Submitting Request...';
            }

            try {
                const accessToken = sessionData.session.access_token;
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
                    alert("Error: " + (result.error || 'Failed to submit request.'));
                }
            } catch (error) {
                console.error("Error submitting request:", error);
                alert("Failed to connect to the server.");
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Submit Blood Request';
                }
            }
        });
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
});
