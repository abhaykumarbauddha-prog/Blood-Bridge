// frontend/js/nearby-requests.js
/**
 * Unified Nearby Blood Requests Controller
 * - 100 KM Radius Filtering via Haversine Formula
 * - Real-time Leaflet OpenStreetMap sync
 * - Connects to Supabase blood_requests table
 */

document.addEventListener('DOMContentLoaded', async () => {
    const supabaseClient = window.bloodBridgeSupabase;
    const mapContainer = document.getElementById('nearby-leaflet-map');
    const requestsListContainer = document.getElementById('nearby-requests-container');
    const countText = document.getElementById('nearby-count-text');
    const bloodGroupFilter = document.getElementById('blood-group-filter');
    const sortFilter = document.getElementById('sort-filter');
    const myLocationBtn = document.getElementById('btn-my-location');
    const searchAreaBtn = document.getElementById('btn-search-area');

    if (!mapContainer || !window.MapService || !window.L) {
        console.error('MapService or Leaflet not found.');
        return;
    }

    let map = null;
    let userMarker = null;
    let radiusCircle = null;
    let userCoords = MapService.DEFAULT_COORDS;
    let allRequests = [];
    const markerRegistry = new Map(); // id -> { marker, lat, lng }

    // 1. Initialize Map
    map = MapService.createMap('nearby-leaflet-map', {
        center: [userCoords.lat, userCoords.lng],
        zoom: 10
    });

    // 2. Fetch User Location & Setup Radius Circle
    async function initLocation() {
        const loc = await MapService.getUserLocation();
        userCoords = loc;

        // Position User Pin
        const userIcon = MapService.createBloodMarkerIcon(null, null, true);
        if (userMarker) map.removeLayer(userMarker);
        userMarker = L.marker([userCoords.lat, userCoords.lng], { icon: userIcon, zIndexOffset: 1000 })
            .addTo(map)
            .bindPopup('<b>🎯 Your Current Location</b>')
            .openPopup();

        // Add 100 KM Radius Boundary Circle
        if (radiusCircle) map.removeLayer(radiusCircle);
        radiusCircle = MapService.addRadiusCircle(map, userCoords.lat, userCoords.lng, 100);

        map.setView([userCoords.lat, userCoords.lng], 10);
    }

    await initLocation();

    // 3. Fetch Real Requests from Database
    async function fetchRequests() {
        if (!supabaseClient) {
            console.error('Supabase client not initialized.');
            return;
        }

        if (countText) countText.textContent = 'Fetching requests within 100km...';

        try {
            const { data, error } = await supabaseClient
                .from('blood_requests')
                .select('*')
                .neq('status', 'Fulfilled')
                .order('created_at', { ascending: false });

            if (error) throw error;

            allRequests = [];

            // Geocode and compute distance for each request
            for (const req of (data || [])) {
                const locationQuery = [req.hospital_address, req.city, 'Uttar Pradesh'].filter(Boolean).join(', ');
                const coords = await MapService.geocodeAddress(locationQuery);
                const distanceKm = MapService.calculateDistanceKm(userCoords.lat, userCoords.lng, coords.lat, coords.lng);

                allRequests.push({
                    ...req,
                    lat: coords.lat,
                    lng: coords.lng,
                    distanceKm: distanceKm ?? 10
                });
            }

            renderAll();
        } catch (err) {
            console.error('Failed to load blood requests:', err);
            if (countText) countText.textContent = 'Error loading nearby requests.';
            if (requestsListContainer) {
                requestsListContainer.innerHTML = `
                    <div style="background: white; border-radius: 12px; padding: 32px; text-align: center; border: 1px solid var(--border-light);">
                        <p style="color: var(--text-secondary); margin-bottom: 8px;">Unable to load requests.</p>
                        <button onclick="window.location.reload()" style="background: var(--brand-primary); color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer;">Retry</button>
                    </div>
                `;
            }
        }
    }

    // 4. Render Markers and List Cards with 100 KM Filter
    function renderAll() {
        // Clear previous markers
        markerRegistry.forEach(({ marker }) => map.removeLayer(marker));
        markerRegistry.clear();

        const selectedGroup = bloodGroupFilter?.value || '';
        const selectedSort = sortFilter?.value || 'urgency';

        // Filter within 100 KM and by blood group
        let filtered = allRequests.filter(req => {
            const within100Km = req.distanceKm <= 100;
            const matchesGroup = !selectedGroup || req.blood_group === selectedGroup;
            return within100Km && matchesGroup;
        });

        // Apply Sorting
        filtered.sort((a, b) => {
            if (selectedSort === 'distance') {
                return a.distanceKm - b.distanceKm;
            }
            if (selectedSort === 'newest') {
                return new Date(b.created_at || 0) - new Date(a.created_at || 0);
            }
            // Urgency sorting: Critical -> Urgent -> Pending/Normal
            const urgencyRank = { 'critical': 3, 'urgent': 2, 'pending': 1, 'normal': 1 };
            const rankA = urgencyRank[(a.urgency || '').toLowerCase()] || 1;
            const rankB = urgencyRank[(b.urgency || '').toLowerCase()] || 1;
            return rankB - rankA;
        });

        // Update count header
        if (countText) {
            countText.textContent = `${filtered.length} active blood ${filtered.length === 1 ? 'request' : 'requests'} within 100km`;
        }

        // Render List
        if (!filtered.length) {
            requestsListContainer.innerHTML = `
                <div style="background: white; border-radius: 12px; padding: 48px 24px; text-align: center; border: 1px solid var(--border-light); margin-top: 12px;">
                    <span style="font-size: 2.5rem; display: block; margin-bottom: 12px;">🩸</span>
                    <h3 style="font-size: 1.1rem; color: var(--text-dark); margin-bottom: 6px;">No Active Requests in 100 KM</h3>
                    <p style="color: var(--text-secondary); font-size: 0.85rem; max-width: 320px; margin: 0 auto 20px;">
                        There are currently no matching blood emergencies within your 100 km radius.
                    </p>
                    <a href="blood-request.html" style="background: var(--brand-primary); color: white; text-decoration: none; padding: 10px 20px; border-radius: 8px; font-weight: 600; font-size: 0.9rem; display: inline-block;">
                        Create a Request
                    </a>
                </div>
            `;
            return;
        }

        requestsListContainer.innerHTML = filtered.map(req => {
            const urgency = req.urgency || 'Normal';
            const isCritical = urgency.toLowerCase() === 'critical';
            const isUrgent = urgency.toLowerCase() === 'urgent';
            const borderStyle = isCritical ? 'border-left: 4px solid var(--status-critical);' :
                                (isUrgent ? 'border-left: 4px solid var(--status-pending);' : 'border-left: 4px solid var(--status-info);');
            const tagClass = isCritical ? 'tag-critical' : (isUrgent ? 'tag-urgent' : 'tag-normal');

            return `
                <div class="req-card" data-req-id="${req.id}" style="${borderStyle} cursor: pointer;">
                    <div class="req-card-header">
                        <div class="blood-group-badge" style="${isCritical ? 'background: var(--brand-primary); color: white;' : ''}">
                            ${escapeHtml(req.blood_group)}
                        </div>
                        <div class="req-info">
                            <h3>${escapeHtml(req.patient_name)}</h3>
                            <p><span>📍</span> ${escapeHtml(req.hospital_name || '')} • <strong>${req.distanceKm} km away</strong></p>
                        </div>
                        <div class="status-tag ${tagClass}">${escapeHtml(urgency)}</div>
                    </div>
                    <div class="req-details">
                        <div><span class="label">Units Required</span><span class="value">${req.units} ${req.units > 1 ? 'Units' : 'Unit'}</span></div>
                        <div><span class="label">Required By</span><span class="value" style="${isCritical ? 'color: var(--status-critical);' : ''}">${escapeHtml(req.required_date || 'Immediate')} ${escapeHtml(req.required_time || '')}</span></div>
                        <div style="grid-column: span 2;">
                            <span class="label">Condition / Info</span>
                            <span class="value">${escapeHtml(req.additional_info || 'Blood required urgently for patient.')}</span>
                        </div>
                    </div>
                    <div class="req-actions" style="margin-top: 14px;">
                        <button type="button" class="btn btn-outline btn-share-req" data-req-id="${req.id}">Share</button>
                        <button type="button" class="btn btn-primary btn-accept-req" data-req-id="${req.id}">Accept & Donate</button>
                    </div>
                </div>
            `;
        }).join('');

        // Plot Markers on Leaflet Map
        filtered.forEach(req => {
            const icon = MapService.createBloodMarkerIcon(req.blood_group, req.urgency);
            const marker = L.marker([req.lat, req.lng], { icon }).addTo(map);

            const popupContent = `
                <div style="font-family: inherit; min-width: 190px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                        <strong style="font-size: 14px; color: #101828;">${escapeHtml(req.patient_name)}</strong>
                        <span style="background: #FFF0F2; color: #E60023; font-weight: 700; font-size: 12px; padding: 2px 6px; border-radius: 4px;">${escapeHtml(req.blood_group)}</span>
                    </div>
                    <p style="margin: 0 0 6px; font-size: 12px; color: #475467;">
                        🏥 ${escapeHtml(req.hospital_name || '')}<br>
                        📍 ${req.distanceKm} km away (${escapeHtml(req.city || '')})<br>
                        🩸 Units: <b>${req.units}</b>
                    </p>
                    <button class="leaflet-popup-action-btn" data-req-id="${req.id}" style="width: 100%; background: #E60023; color: white; border: none; padding: 6px 12px; border-radius: 6px; font-weight: 600; font-size: 11px; cursor: pointer; margin-top: 4px;">
                        Accept & Donate
                    </button>
                </div>
            `;
            marker.bindPopup(popupContent);

            markerRegistry.set(req.id, { marker, lat: req.lat, lng: req.lng });
        });

        // Click card to pan map to marker
        document.querySelectorAll('.req-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('button')) return; // Ignore if clicked on button
                const id = card.dataset.reqId;
                const item = markerRegistry.get(id);
                if (item) {
                    map.flyTo([item.lat, item.lng], 13, { duration: 1 });
                    item.marker.openPopup();
                }
            });
        });

        // Share buttons
        document.querySelectorAll('.btn-share-req').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const reqId = btn.dataset.reqId;
                const req = allRequests.find(r => r.id === reqId);
                const shareText = `Emergency Blood Request: ${req?.blood_group} needed for ${req?.patient_name} at ${req?.hospital_name}, ${req?.city}. Connect on Blood Bridge!`;
                if (navigator.clipboard) {
                    navigator.clipboard.writeText(shareText);
                    alert('Request details copied to clipboard!');
                } else {
                    alert(shareText);
                }
            });
        });

        // Accept & Donate buttons
        document.querySelectorAll('.btn-accept-req, .leaflet-popup-action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const reqId = btn.dataset.reqId;
                const req = allRequests.find(r => r.id === reqId);
                alert(`Thank you for volunteering! Blood Bridge notification sent for ${req?.patient_name} at ${req?.hospital_name}.`);
            });
        });
    }

    // 5. Controls
    if (bloodGroupFilter) bloodGroupFilter.addEventListener('change', renderAll);
    if (sortFilter) sortFilter.addEventListener('change', renderAll);

    if (myLocationBtn) {
        myLocationBtn.addEventListener('click', async () => {
            myLocationBtn.textContent = '⏳ Locating...';
            await initLocation();
            myLocationBtn.textContent = '🎯 My Location';
            renderAll();
        });
    }

    if (searchAreaBtn) {
        searchAreaBtn.addEventListener('click', () => {
            const center = map.getCenter();
            userCoords = { lat: center.lat, lng: center.lng };
            if (radiusCircle) {
                radiusCircle.setLatLng(center);
            }
            // Recalculate distances from new center
            allRequests.forEach(req => {
                req.distanceKm = MapService.calculateDistanceKm(center.lat, center.lng, req.lat, req.lng) ?? 10;
            });
            renderAll();
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

    // Initial load
    fetchRequests();
});
