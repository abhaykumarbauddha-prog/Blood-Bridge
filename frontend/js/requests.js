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
    let selectedCoordinates = null;

    const defaultRequiredBy = () => {
        const dateInput = requestForm?.elements.required_date;
        const timeInput = requestForm?.elements.required_time;
        if (!dateInput || !timeInput || dateInput.value || timeInput.value) return;
        const future = new Date(Date.now() + 60 * 60 * 1000);
        const pad = (value) => String(value).padStart(2, '0');
        dateInput.value = `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}`;
        timeInput.value = `${pad(future.getHours())}:${pad(future.getMinutes())}`;
    };
    defaultRequiredBy();

    // Radius chip selector interactive click
    document.querySelectorAll('.radius-chip-card').forEach(card => {
        card.addEventListener('click', () => {
            document.querySelectorAll('.radius-chip-card').forEach(c => {
                c.classList.remove('active');
                c.style.border = '1px solid var(--border-light)';
                c.style.background = 'transparent';
                const mainText = c.querySelector('div:first-of-type');
                if (mainText) mainText.style.color = 'var(--text-dark)';
                const subText = c.querySelector('div:last-of-type');
                if (subText) subText.style.color = 'var(--text-secondary)';
            });
            card.classList.add('active');
            card.style.border = '2px solid var(--brand-primary)';
            card.style.background = 'var(--bg-pink)';
            const mainText = card.querySelector('div:first-of-type');
            if (mainText) mainText.style.color = 'var(--brand-primary)';
            const subText = card.querySelector('div:last-of-type');
            if (subText) subText.style.color = 'var(--brand-primary)';
            const radio = card.querySelector('input[type="radio"]');
            if (radio) radio.checked = true;
        });
    });

    // ==========================================
    // 1. Interactive Map & Geolocation Setup
    // ==========================================
    if (locationMapContainer && window.MapService && window.L) {
        const defaultLoc = MapService.getDefaultLocation ? MapService.getDefaultLocation() : { lat: 26.8467, lng: 80.9462 };
        let currentLat = defaultLoc.lat;
        let currentLng = defaultLoc.lng;

        requestMap = MapService.createMap('request-location-map', {
            center: [currentLat, currentLng],
            zoom: 13
        });
        setTimeout(() => { if (requestMap) requestMap.invalidateSize(); }, 250);

        // Create prominent draggable location pin with directional arrow
        const pinIcon = MapService.createDraggableArrowPin ? 
            MapService.createDraggableArrowPin('Drag Arrow to Hospital', '#E60023') : null;

        requestMarker = L.marker([currentLat, currentLng], {
            icon: pinIcon || undefined,
            draggable: true,
            title: 'Drag me to set exact hospital location',
            autoPan: true
        }).addTo(requestMap);

        requestMarker.bindPopup(`
            <div style="text-align: center; padding: 4px;">
                <b style="color: #E60023;">📍 Hospital Location</b><br>
                <span style="font-size: 11px; color: #475467;">Drag pin or click map to reposition</span>
            </div>
        `).openPopup();

        // Helper to update text & inputs from coordinates
        async function updateLocationFromCoords(lat, lng) {
            selectedCoordinates = { latitude: lat, longitude: lng };
            if (selectedLocationText) {
                selectedLocationText.textContent = `📍 ${lat.toFixed(4)}, ${lng.toFixed(4)} (Resolving...)`;
            }
            const info = await MapService.reverseGeocode(lat, lng);
            if (selectedLocationText) {
                selectedLocationText.textContent = info?.displayName || `Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}`;
            }
            if (cityInput && info?.city) {
                cityInput.value = info.city;
            }
            if (hospitalAddressInput && info?.displayName) {
                hospitalAddressInput.value = info.address || info.displayName;
            }
            requestMarker.setPopupContent(`
                <div style="text-align: center; padding: 4px; max-width: 220px;">
                    <b style="color: #E60023;">📍 Hospital Location</b><br>
                    <span style="font-size: 12px; font-weight: 500;">${info?.displayName || 'Selected Point'}</span><br>
                    <small style="color: #667085; font-size: 10px;">Drag pin anytime to change</small>
                </div>
            `);
        }

        function applyCoordsToMap(lat, lng, zoomIn = true) {
            if (!requestMap || !requestMarker) return;
            selectedCoordinates = { latitude: lat, longitude: lng };
            requestMarker.setLatLng([lat, lng]);
            requestMap.panTo([lat, lng]);
            if (zoomIn) requestMap.setZoom(15);
            updateLocationFromCoords(lat, lng);
        }

        // Update inputs when pin is dragged
        requestMarker.on('dragend', async () => {
            const position = requestMarker.getLatLng();
            await updateLocationFromCoords(position.lat, position.lng);
        });

        // Click anywhere on map to move pin immediately
        requestMap.on('click', async (e) => {
            requestMarker.setLatLng(e.latlng);
            await updateLocationFromCoords(e.latlng.lat, e.latlng.lng);
        });

        // Attempt non-blocking live GPS in background to center on requester
        MapService.getUserLocation(false).then((liveLoc) => {
            if (liveLoc && Number.isFinite(liveLoc.lat) && Number.isFinite(liveLoc.lng)) {
                applyCoordsToMap(liveLoc.lat, liveLoc.lng, true);
            } else {
                updateLocationFromCoords(currentLat, currentLng);
            }
        }).catch(() => {
            updateLocationFromCoords(currentLat, currentLng);
        });

        // "🎯 Use My Location" Button
        if (useMyLocationBtn) {
            useMyLocationBtn.addEventListener('click', async () => {
                const originalText = useMyLocationBtn.innerHTML;
                useMyLocationBtn.innerHTML = '⏳ Locating GPS...';
                useMyLocationBtn.disabled = true;
                const loc = await MapService.getUserLocation(true);
                useMyLocationBtn.disabled = false;
                useMyLocationBtn.innerHTML = originalText;
                if (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng)) {
                    applyCoordsToMap(loc.lat, loc.lng, true);
                    requestMarker.openPopup();
                } else {
                    alert('Could not retrieve GPS location. Please check browser permissions or drag the marker pin manually on the map.');
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
                } else {
                    alert(`Could not find coordinates for "${query}". You can drag the pin manually.`);
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
                        selectedCoordinates = { latitude: coords.lat, longitude: coords.lng };
                    }
                }
            }, 800);
        };

        if (cityInput) cityInput.addEventListener('input', triggerMapPanFromInputs);
        if (hospitalAddressInput) hospitalAddressInput.addEventListener('input', triggerMapPanFromInputs);
    }

    if (!requestMap && useMyLocationBtn) {
        useMyLocationBtn.addEventListener('click', async () => {
            useMyLocationBtn.textContent = '⏳ Locating...';
            const loc = await MapService.getUserLocation();
            useMyLocationBtn.textContent = '🎯 Use My Location';
            if (!loc) return;
            selectedCoordinates = { latitude: loc.lat, longitude: loc.lng };
            const info = await MapService.reverseGeocode(loc.lat, loc.lng);
            if (selectedLocationText) selectedLocationText.textContent = info?.displayName || 'Location selected';
        });
    }

    // Auto-prefill hospital and facility details if logged-in user is Hospital
    if (supabaseClient?.auth) {
        (async () => {
            try {
                const { data: sessionData } = await supabaseClient.auth.getSession();
                const currentUserId = sessionData?.session?.user?.id;
                if (!currentUserId) return;
                const { data: userProfile } = await supabaseClient
                    .from('users')
                    .select('role, full_name, city, state, address, latitude, longitude')
                    .eq('id', currentUserId)
                    .maybeSingle();

                if (userProfile) {
                    const isHospital = userProfile.role === 'Hospital' || window.location.search.includes('source=hospital');
                    const hNameInput = document.querySelector('input[name="hospital_name"]');
                    if (isHospital && hNameInput && !hNameInput.value && userProfile.full_name) {
                        hNameInput.value = userProfile.full_name;
                    }
                    if (cityInput && !cityInput.value && userProfile.city) {
                        cityInput.value = userProfile.city;
                    }
                    if (hospitalAddressInput && !hospitalAddressInput.value) {
                        const fullAddr = [userProfile.address, userProfile.city, userProfile.state].filter(Boolean).join(', ');
                        if (fullAddr) hospitalAddressInput.value = fullAddr;
                    }
                    if (Number.isFinite(Number(userProfile.latitude)) && Number.isFinite(Number(userProfile.longitude))) {
                        const pLat = Number(userProfile.latitude);
                        const pLng = Number(userProfile.longitude);
                        selectedCoordinates = { latitude: pLat, longitude: pLng };
                        if (requestMarker && requestMap) {
                            requestMarker.setLatLng([pLat, pLng]);
                            requestMap.setView([pLat, pLng], 13);
                        }
                    }
                }
            } catch (err) {
                console.warn('Could not auto-prefill user/hospital profile:', err);
            }
        })();
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
                .eq('status', 'open')
                .gt('required_by', new Date().toISOString())
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

            const requestIds = requests.map((request) => request.id);
            const { data: responses } = await supabaseClient
                .from('request_responses')
                .select('id, request_id, status')
                .in('request_id', requestIds)
                .eq('status', 'accepted');
            const acceptedResponseByRequest = new Map((responses || []).map((response) => [response.request_id, response]));

            recentRequestsContainer.innerHTML = requests.map(req => {
                const urgency = req.urgency || 'Normal';
                let tagClass = 'tag-pending';
                if (urgency.toLowerCase() === 'critical') tagClass = 'tag-critical';
                else if (urgency.toLowerCase() === 'urgent') tagClass = 'tag-urgent';

                const reqDate = BloodMatchData.formatDateTime(req.created_at);

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
                        ${acceptedResponseByRequest.has(req.id) ? `<button type="button" class="btn-mark-donated" data-response-id="${acceptedResponseByRequest.get(req.id).id}">Mark donated</button>` : ''}
                    </div>
                `;
            }).join('');

            recentRequestsContainer.querySelectorAll('.btn-mark-donated').forEach((button) => {
                button.addEventListener('click', async () => {
                    button.disabled = true;
                    const responseId = button.dataset.responseId;
                    let markError = null;

                    const { error: rpcErr } = await supabaseClient.rpc('mark_response_donated', { response_id_input: responseId });
                    if (rpcErr) {
                        if (/function .* does not exist|could not find the function/i.test(rpcErr.message || '')) {
                            const { data: respData, error: respErr } = await supabaseClient
                                .from('request_responses')
                                .update({ status: 'donated', donated_at: new Date().toISOString() })
                                .eq('id', responseId)
                                .select('donor_id, request_id')
                                .maybeSingle();
                            if (respErr) {
                                markError = respErr;
                            } else if (respData) {
                                await supabaseClient
                                    .from('blood_requests')
                                    .update({ status: 'fulfilled' })
                                    .eq('id', respData.request_id);
                                await supabaseClient
                                    .from('users')
                                    .update({ last_donation_date: new Date().toISOString().split('T')[0] })
                                    .eq('id', respData.donor_id);
                            }
                        } else {
                            markError = rpcErr;
                        }
                    }

                    button.disabled = false;
                    if (markError) return alert(`Unable to verify donation: ${markError.message}`);
                    alert('Donation verified and marked as completed!');
                    loadRecentRequests();
                });
            });
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
            const radiusInput = document.querySelector('input[name="search_radius_km"]:checked');

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
            const selectedRadius = Number(radiusInput?.value) || 25;
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
                requester_id: requesterId,
                search_radius_km: selectedRadius,
                latitude: selectedCoordinates?.latitude || null,
                longitude: selectedCoordinates?.longitude || null
            };

            if (!requestPayload.patient_name || !requestPayload.blood_group || !requestPayload.hospital_name ||
                !requestPayload.hospital_address || !requestPayload.city || !requestPayload.required_date ||
                !requestPayload.required_time || !Number.isInteger(requestPayload.units) || requestPayload.units < 1) {
                alert('Please complete all required request details.');
                return;
            }

            const requiredBy = new Date(`${requestPayload.required_date}T${requestPayload.required_time}:00`);
            if (Number.isNaN(requiredBy.getTime()) || requiredBy <= new Date()) {
                alert('Required by date and time must be in the future.');
                return;
            }

            const submitBtn = requestForm.querySelector('button[type="submit"]');
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = 'Submitting Request & Scanning Donors...';
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
                    const createdId = result.data?.[0]?.id || result.data?.id;
                    const destination = createdId
                        ? `smart-match.html?request_id=${createdId}&blood_group=${encodeURIComponent(requestPayload.blood_group)}&radius=${selectedRadius}&urgency=${encodeURIComponent(requestPayload.urgency)}`
                        : `smart-match.html?blood_group=${encodeURIComponent(requestPayload.blood_group)}&radius=${selectedRadius}`;
                    alert("Blood request submitted successfully! Redirecting to Smart AI Matching...");
                    window.location.href = destination;
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
