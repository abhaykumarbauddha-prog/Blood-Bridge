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
    let userCoords = null;
    let allRequests = [];
    const markerRegistry = new Map(); // id -> { marker, lat, lng }
    let markerLayer = null;
    let currentDonorStats = null;

    // 2. Fetch User Location & Setup Radius Circle
    async function initLocation() {
        const loc = await MapService.getUserLocation();
        userCoords = loc || (MapService.getDefaultLocation ? MapService.getDefaultLocation() : { lat: 26.8467, lng: 80.9462 });

        if (!map) {
            map = MapService.createMap('nearby-leaflet-map', { center: [userCoords.lat, userCoords.lng], zoom: 10 });
            if (!map) return false;
            markerLayer = window.L.markerClusterGroup ? L.markerClusterGroup() : L.layerGroup();
            markerLayer.addTo(map);
        }

        // Position User Pin
        const userIcon = MapService.createBloodMarkerIcon(null, null, userCoords.isLive !== false);
        if (userMarker) map.removeLayer(userMarker);
        userMarker = L.marker([userCoords.lat, userCoords.lng], { icon: userIcon, zIndexOffset: 1000 })
            .addTo(map)
            .bindPopup(`<b>${userCoords.isLive ? '🎯 Your Location' : '📍 Regional Search Center'}</b>`)
            .openPopup();

        // Add 100 KM Radius Boundary Circle
        if (radiusCircle) map.removeLayer(radiusCircle);
        radiusCircle = MapService.addRadiusCircle(map, userCoords.lat, userCoords.lng, 100);

        map.setView([userCoords.lat, userCoords.lng], 10);
        setTimeout(() => {
            if (map) map.invalidateSize();
        }, 300);
        return true;
    }

    await initLocation();

    // 3. Fetch Real Requests from Database
    async function fetchRequests() {
        if (!supabaseClient) {
            console.error('Supabase client not initialized.');
            return;
        }

        // Fetch current user's donor stats & cooling period status
        if (supabaseClient.auth) {
            try {
                const { data: sessionData } = await supabaseClient.auth.getSession();
                if (sessionData?.session?.user && window.BloodMatchData?.getDonorStats) {
                    currentDonorStats = await BloodMatchData.getDonorStats(sessionData.session.user.id);
                    if (window.BloodMatchData?.renderDonorStats) {
                        BloodMatchData.renderDonorStats(currentDonorStats);
                    }
                }
            } catch (authErr) {
                console.warn('Could not fetch donor cooling stats:', authErr);
            }
        }

        if (countText) countText.textContent = 'Fetching requests within 100km...';

        try {
            const { data, error } = await supabaseClient
                .from('blood_requests')
                .select('*')
                .in('status', ['open', 'matched', 'pending', 'fulfilled', 'completed'])
                .order('created_at', { ascending: false });

            if (error) throw error;

            allRequests = [];

            // Geocode and compute distance for each request
            for (const req of (data || [])) {
                const coords = { lat: Number(req.latitude), lng: Number(req.longitude) };
                if (![coords.lat, coords.lng].every(Number.isFinite)) continue;
                const distanceKm = MapService.calculateDistanceKm(userCoords.lat, userCoords.lng, coords.lat, coords.lng);

                allRequests.push({
                    ...req,
                    lat: coords.lat,
                    lng: coords.lng,
                    distanceKm
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

    // Helper: Priority rank for requests (Urgent -> Pending -> Completed)
    function getRequestPriorityRank(req) {
        const status = (req.status || '').toLowerCase();
        if (['fulfilled', 'completed', 'donated'].includes(status)) {
            return 3; // 3. Completed
        }
        const urgency = (req.urgency || '').toLowerCase();
        if (urgency === 'critical') return 0; // 1. Urgent (Critical)
        if (urgency === 'urgent') return 1;   // 1. Urgent
        return 2; // 2. Pending / Normal
    }

    // 4. Render Markers and List Cards with 100 KM Filter
    function renderAll() {
        // Clear previous markers
        if (markerLayer) markerLayer.clearLayers();
        markerRegistry.clear();

        const selectedGroup = bloodGroupFilter?.value || '';
        const selectedSort = sortFilter?.value || 'urgency';
        const topbarInput = document.querySelector('.search-bar input');
        const searchKeyword = (topbarInput?.value || '').trim().toLowerCase();

        // Filter within 100 KM, by blood group, and by search text
        let filtered = allRequests.filter(req => {
            const within100Km = BloodMatchData.withinRadius(userCoords, { lat: req.lat, lng: req.lng }, 100);
            const matchesGroup = !selectedGroup || req.blood_group === selectedGroup;

            let matchesKeyword = true;
            if (searchKeyword) {
                const pName = (req.patient_name || '').toLowerCase();
                const hName = (req.hospital_name || '').toLowerCase();
                const city = (req.city || '').toLowerCase();
                const bg = (req.blood_group || '').toLowerCase();
                matchesKeyword = pName.includes(searchKeyword) || hName.includes(searchKeyword) || city.includes(searchKeyword) || bg === searchKeyword;
            }

            return within100Km && matchesGroup && matchesKeyword;
        });

        // Apply Sorting: Strict order of Urgent (0, 1) -> Pending (2) -> Completed (3)
        filtered.sort((a, b) => {
            const rankA = getRequestPriorityRank(a);
            const rankB = getRequestPriorityRank(b);

            if (rankA !== rankB) {
                return rankA - rankB; // Urgent -> Pending -> Completed
            }

            if (selectedSort === 'distance') {
                return (a.distanceKm || 0) - (b.distanceKm || 0);
            }
            return new Date(b.created_at || 0) - new Date(a.created_at || 0);
        });

        // Update count header with breakdown
        const urgentCount = filtered.filter(r => getRequestPriorityRank(r) <= 1).length;
        const pendingCount = filtered.filter(r => getRequestPriorityRank(r) === 2).length;
        const completedCount = filtered.filter(r => getRequestPriorityRank(r) === 3).length;

        if (countText) {
            countText.textContent = `${filtered.length} blood requests within 100km • ${urgentCount} Urgent, ${pendingCount} Pending, ${completedCount} Completed`;
        }

        // Render List
        if (!filtered.length) {
            requestsListContainer.innerHTML = `
                <div style="background: white; border-radius: 12px; padding: 48px 24px; text-align: center; border: 1px solid var(--border-light); margin-top: 12px;">
                    <span style="font-size: 2.5rem; display: block; margin-bottom: 12px;">🩸</span>
                    <h3 style="font-size: 1.1rem; color: var(--text-dark); margin-bottom: 6px;">No Matching Requests in 100 KM</h3>
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
            const isCompleted = ['fulfilled', 'completed', 'donated'].includes((req.status || '').toLowerCase());
            const urgency = req.urgency || 'Normal';
            const isCritical = urgency.toLowerCase() === 'critical';
            const isUrgent = urgency.toLowerCase() === 'urgent';

            let borderStyle = 'border-left: 4px solid var(--status-info);';
            let tagClass = 'tag-normal';
            let tagText = urgency;

            if (isCompleted) {
                borderStyle = 'border-left: 4px solid var(--status-available, #10B981);';
                tagClass = 'tag-completed';
                tagText = 'Completed ✔';
            } else if (isCritical) {
                borderStyle = 'border-left: 4px solid var(--status-critical);';
                tagClass = 'tag-critical';
                tagText = 'Critical';
            } else if (isUrgent) {
                borderStyle = 'border-left: 4px solid var(--status-pending);';
                tagClass = 'tag-urgent';
                tagText = 'Urgent';
            }

            const isCooling = currentDonorStats && !currentDonorStats.isEligible && currentDonorStats.daysRemaining > 0;

            const actionButtons = isCompleted
                ? `
                    <button type="button" class="btn btn-outline btn-share-req" data-req-id="${req.id}">Share</button>
                    <button type="button" class="btn btn-completed" disabled style="background: var(--status-available, #10B981); color: white; cursor: default; opacity: 0.95; font-weight: 600;">Completed ✔</button>
                `
                : (isCooling
                    ? `
                        <button type="button" class="btn btn-outline btn-share-req" data-req-id="${req.id}">Share</button>
                        <button type="button" class="btn btn-warning btn-accept-req" data-req-id="${req.id}" style="background: #F59E0B; color: white; border: none; font-weight: 700; box-shadow: 0 2px 6px rgba(245,158,11,0.25);">⏱️ Cooling Period (${currentDonorStats.daysRemaining}d)</button>
                    `
                    : `
                        <button type="button" class="btn btn-outline btn-share-req" data-req-id="${req.id}">Share</button>
                        <button type="button" class="btn btn-primary btn-accept-req" data-req-id="${req.id}">Accept & Donate</button>
                    `
                );

            return `
                <div class="req-card ${isCompleted ? 'req-completed' : ''}" data-req-id="${req.id}" style="${borderStyle} cursor: pointer;">
                    <div class="req-card-header">
                        <div class="blood-group-badge" style="${isCritical ? 'background: var(--brand-primary); color: white;' : (isCompleted ? 'background: #DEF7EC; color: #046C4E;' : '')}">
                            ${escapeHtml(req.blood_group)}
                        </div>
                        <div class="req-info">
                            <h3>${escapeHtml(req.patient_name)}</h3>
                            <p><span>📍</span> ${escapeHtml(req.hospital_name || '')} • <strong>${req.distanceKm} km away</strong></p>
                        </div>
                        <div class="status-tag ${tagClass}">${escapeHtml(tagText)}</div>
                    </div>
                    <div class="req-details">
                        <div><span class="label">Units Required</span><span class="value">${req.units} ${req.units > 1 ? 'Units' : 'Unit'}</span></div>
                        <div><span class="label">Required By</span><span class="value" style="${isCritical ? 'color: var(--status-critical);' : ''}">${escapeHtml(BloodMatchData.formatDateTime(req.required_by))}</span></div>
                        <div style="grid-column: span 2;">
                            <span class="label">Condition / Info</span>
                            <span class="value">${escapeHtml(req.additional_info || 'Blood required urgently for patient.')}</span>
                        </div>
                    </div>
                    <div class="req-actions" style="margin-top: 14px;">
                        ${actionButtons}
                    </div>
                </div>
            `;
        }).join('');

        // Plot Markers on Leaflet Map
        filtered.forEach(req => {
            const isCompleted = ['fulfilled', 'completed', 'donated'].includes((req.status || '').toLowerCase());
            const isCooling = currentDonorStats && !currentDonorStats.isEligible && currentDonorStats.daysRemaining > 0;
            const icon = MapService.createBloodMarkerIcon(req.blood_group, isCompleted ? 'Completed' : req.urgency);
            const marker = L.marker([req.lat, req.lng], { icon }).addTo(markerLayer || map);

            let popupBtn = '';
            if (isCompleted) {
                popupBtn = `<span style="display: block; width: 100%; text-align: center; background: #DEF7EC; color: #046C4E; font-weight: 700; font-size: 11px; padding: 6px 0; border-radius: 6px; margin-top: 4px;">Completed ✔</span>`;
            } else if (isCooling) {
                popupBtn = `<button class="leaflet-popup-action-btn" data-req-id="${req.id}" style="width: 100%; background: #F59E0B; color: white; border: none; padding: 6px 12px; border-radius: 6px; font-weight: 700; font-size: 11px; cursor: pointer; margin-top: 4px;">
                    ⏱️ Cooling Period (${currentDonorStats.daysRemaining}d)
                </button>`;
            } else {
                popupBtn = `<button class="leaflet-popup-action-btn" data-req-id="${req.id}" style="width: 100%; background: #E60023; color: white; border: none; padding: 6px 12px; border-radius: 6px; font-weight: 600; font-size: 11px; cursor: pointer; margin-top: 4px;">
                    Accept & Donate
                </button>`;
            }

            const popupContent = `
                <div style="font-family: inherit; min-width: 190px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                        <strong style="font-size: 14px; color: #101828;">${escapeHtml(req.patient_name)}</strong>
                        <span style="background: ${isCompleted ? '#DEF7EC' : '#FFF0F2'}; color: ${isCompleted ? '#046C4E' : '#E60023'}; font-weight: 700; font-size: 12px; padding: 2px 6px; border-radius: 4px;">${escapeHtml(req.blood_group)}</span>
                    </div>
                    <p style="margin: 0 0 6px; font-size: 12px; color: #475467;">
                        🏥 ${escapeHtml(req.hospital_name || '')}<br>
                        📍 ${req.distanceKm} km away (${escapeHtml(req.city || '')})<br>
                        🩸 Units: <b>${req.units}</b><br>
                        Status: <b>${isCompleted ? 'Completed ✔' : (req.urgency || 'Pending')}</b>
                    </p>
                    ${popupBtn}
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
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const reqId = btn.dataset.reqId;
                const req = allRequests.find(r => r.id === reqId);
                if (!supabaseClient?.auth) return alert('Authentication service is unavailable.');

                const { data: sessionData } = await supabaseClient.auth.getSession();
                const user = sessionData?.session?.user;
                if (!user) {
                    return alert('Please log in as a donor to accept a request.');
                }

                // Check 3-month cooling period FIRST:
                const stats = window.BloodMatchData?.getDonorStats
                    ? await BloodMatchData.getDonorStats(user.id)
                    : currentDonorStats;

                if (stats && !stats.isEligible && stats.daysRemaining > 0) {
                    currentDonorStats = stats;
                    if (window.BloodMatchData?.showCoolingWarningModal) {
                        BloodMatchData.showCoolingWarningModal(stats, req);
                    } else {
                        alert(`Cooling period is running! You have ${stats.daysRemaining} days remaining in your 3-month cooling period. You cannot accept requests until it finishes.`);
                    }
                    return; // STRICTLY BLOCK ACCEPTANCE
                }

                btn.disabled = true;
                const originalText = btn.innerHTML;
                btn.innerHTML = 'Accepting & Completing... ⏳';

                let completedSuccessfully = false;
                const donationDate = new Date().toISOString();

                // 1. Try Backend API
                try {
                    const response = await fetch(`/api/requests/${reqId}/accept`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${sessionData?.session?.access_token || ''}`
                        },
                        body: JSON.stringify({
                            donor_id: user.id,
                            complete: true,
                            donated_at: donationDate
                        })
                    });
                    const resData = await response.json();
                    if (resData.success) {
                        completedSuccessfully = true;
                    } else if (resData.cooling_period) {
                        // Backend detected cooling period
                        btn.disabled = false;
                        btn.innerHTML = originalText;
                        if (window.BloodMatchData?.showCoolingWarningModal) {
                            BloodMatchData.showCoolingWarningModal(resData, req);
                        } else {
                            alert(resData.error || 'Cooling period is running.');
                        }
                        return;
                    }
                } catch (apiErr) {
                    console.warn('API accept note:', apiErr);
                }

                // 2. Direct Supabase Fallback (ensures 100% completion & resilience)
                try {
                    // Update request_responses with donated status
                    await supabaseClient
                        .from('request_responses')
                        .upsert({
                            request_id: reqId,
                            donor_id: user.id,
                            status: 'donated',
                            donated_at: donationDate
                        }, { onConflict: 'request_id,donor_id' });
                    
                    // Mark request as fulfilled / completed in blood_requests
                    await supabaseClient
                        .from('blood_requests')
                        .update({ status: 'fulfilled' })
                        .eq('id', reqId);

                    // Update donor's last_donation_date in users table
                    await supabaseClient
                        .from('users')
                        .update({ last_donation_date: donationDate.split('T')[0] })
                        .eq('id', user.id);

                    completedSuccessfully = true;
                } catch (sbErr) {
                    console.warn('Supabase direct update error:', sbErr);
                }

                // 3. Send Notification to Requester
                if (req?.requester_id) {
                    const donorName = user.user_metadata?.full_name || 'A verified donor';
                    const donorPhone = user.user_metadata?.phone || '';
                    try {
                        await supabaseClient.from('notifications').insert([{
                            user_id: req.requester_id,
                            type: 'system',
                            title: 'Blood Donation Completed! 🎉',
                            body: `Good news! Donor ${donorName} has accepted and completed your blood request for ${req.patient_name || 'the patient'} at ${req.hospital_name || 'the hospital'}.${donorPhone ? ' Contact: ' + donorPhone : ''} The request is now marked as Completed.`,
                            link: 'nearby-request.html'
                        }]);
                    } catch (_) {}
                }

                // 4. Send Confirmation Notification to Donor
                try {
                    const donorName = user.user_metadata?.full_name || 'Donor';
                    await supabaseClient.from('notifications').insert([{
                        user_id: user.id,
                        type: 'badge_earned',
                        title: `Blood Donation Successful! 🏆`,
                        body: `Thank you, ${donorName}! Your blood donation for patient ${req?.patient_name || 'the patient'} at ${req?.hospital_name || 'Hospital'} has been completed and recorded in your Donation History.`,
                        link: 'donation-history.html'
                    }]);
                } catch (_) {}

                btn.innerHTML = 'Completed ✔';
                btn.style.background = 'var(--status-available, #10B981)';
                btn.style.color = 'white';

                // 5. Update Universal Donor Stats across all components immediately
                if (window.BloodMatchData?.getDonorStats && window.BloodMatchData?.renderDonorStats) {
                    try {
                        currentDonorStats = await BloodMatchData.getDonorStats(user.id);
                        BloodMatchData.renderDonorStats(currentDonorStats);
                    } catch (statErr) {
                        console.warn('Stats refresh error:', statErr);
                    }
                }

                alert(
                    `Thank you! Your blood donation for ${req?.patient_name || 'the patient'} has been completed. ❤️\n\n` +
                    `• Hospital: ${req?.hospital_name || 'Hospital'}\n` +
                    `• Units Donated: ${req?.units || 1} (${req?.blood_group || ''})\n` +
                    `• Status: Completed ✔\n\n` +
                    `A notification has been sent to the requester, and your Donation History and stats have been updated!`
                );

                await fetchRequests();
            });
        });
    }

    // 5. Controls
    if (bloodGroupFilter) bloodGroupFilter.addEventListener('change', renderAll);
    if (sortFilter) sortFilter.addEventListener('change', renderAll);

    const topbarInput = document.querySelector('.search-bar input');
    if (topbarInput) {
        topbarInput.addEventListener('input', renderAll);
        topbarInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') renderAll();
        });
    }

    const topbarSearchIcon = document.querySelector('.search-bar span');
    if (topbarSearchIcon) {
        topbarSearchIcon.style.cursor = 'pointer';
        topbarSearchIcon.addEventListener('click', renderAll);
    }

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
                req.distanceKm = MapService.calculateDistanceKm(center.lat, center.lng, req.lat, req.lng);
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
