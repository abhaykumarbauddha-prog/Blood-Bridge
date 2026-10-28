// frontend/js/smart-match.js
/**
 * Blood Bridge — Unified Smart Donor Radar & Match Hub
 * Combines multi-criteria algorithmic AI scoring with an interactive Leaflet + NavIC radar map.
 */

document.addEventListener('DOMContentLoaded', async () => {
    const supabaseClient = window.bloodBridgeSupabase;
    const btnFindMatch = document.getElementById('btn-find-match');
    const bloodGroupSelect = document.getElementById('match-blood-group');
    const unitsInput = document.getElementById('match-units');
    const radiusSelect = document.getElementById('match-radius');
    const urgencySelect = document.getElementById('match-urgency');
    const resultsContainer = document.getElementById('match-results');
    const summaryContainer = document.getElementById('match-summary');
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingStepText = document.getElementById('loading-step-text');
    const pipelineBar = document.getElementById('pipeline-bar');

    const btnViewCards = document.getElementById('btn-view-cards');
    const btnViewMap = document.getElementById('btn-view-map');
    const mapContainer = document.getElementById('smart-match-map-container');
    const resultsCountBadge = document.getElementById('results-count-badge');
    const btnRadarLocate = document.getElementById('btn-radar-locate-me');

    let userCoords = null;
    let currentUserId = null;
    let smartMap = null;
    let centerMarker = null;
    let radiusCircle = null;
    let donorMarkerLayer = null;
    let currentMatches = [];

    // 1. Get authenticated session
    if (supabaseClient?.auth) {
        const { data: sessionData } = await supabaseClient.auth.getSession();
        currentUserId = sessionData?.session?.user?.id || null;
    }

    // 2. Obtain initial location (high accuracy)
    if (window.MapService) {
        const loc = await MapService.getUserLocation(true);
        if (loc) {
            userCoords = { lat: loc.lat, lng: loc.lng };
        } else {
            userCoords = MapService.getDefaultLocation();
        }
    }

    // 3. Parse URL query params (?blood_group=...&units=...&radius=...&urgency=...)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('blood_group') && bloodGroupSelect) {
        bloodGroupSelect.value = urlParams.get('blood_group');
    }
    if (urlParams.get('units') && unitsInput) {
        unitsInput.value = urlParams.get('units');
    }
    if (urlParams.get('radius') && radiusSelect) {
        radiusSelect.value = urlParams.get('radius');
    }
    if (urlParams.get('urgency') && urgencySelect) {
        urgencySelect.value = urlParams.get('urgency');
    }
    const autoRequestId = urlParams.get('request_id');

    // 4. View toggles between Cards and Radar Map
    if (btnViewCards && btnViewMap && mapContainer) {
        btnViewCards.addEventListener('click', () => {
            btnViewCards.classList.add('active');
            btnViewCards.style.background = 'var(--bg-pink)';
            btnViewCards.style.color = 'var(--brand-primary)';
            btnViewMap.classList.remove('active');
            btnViewMap.style.background = 'transparent';
            btnViewMap.style.color = 'var(--text-secondary)';

            resultsContainer.style.display = 'flex';
            mapContainer.style.display = 'none';
        });

        btnViewMap.addEventListener('click', () => {
            btnViewMap.classList.add('active');
            btnViewMap.style.background = 'var(--bg-pink)';
            btnViewMap.style.color = 'var(--brand-primary)';
            btnViewCards.classList.remove('active');
            btnViewCards.style.background = 'transparent';
            btnViewCards.style.color = 'var(--text-secondary)';

            resultsContainer.style.display = 'none';
            mapContainer.style.display = 'block';

            initRadarMap();
            setTimeout(() => {
                if (smartMap) smartMap.invalidateSize();
            }, 200);
        });
    }

    // 5. Radar Map Initialization
    function initRadarMap() {
        if (!document.getElementById('smart-match-map') || !window.MapService || !window.L || !userCoords) return;

        if (!smartMap) {
            smartMap = MapService.createMap('smart-match-map', {
                center: [userCoords.lat, userCoords.lng],
                zoom: 11
            });
            if (!smartMap) return;

            donorMarkerLayer = window.L.markerClusterGroup ? L.markerClusterGroup() : L.layerGroup();
            donorMarkerLayer.addTo(smartMap);

            // Clicking anywhere on map re-positions the search center
            smartMap.on('click', (e) => {
                updateSearchOrigin(e.latlng.lat, e.latlng.lng);
            });
        }

        updateMapCenterAndRadius();
        renderDonorMarkersOnMap(currentMatches);
    }

    function updateSearchOrigin(lat, lng) {
        userCoords = { lat, lng };
        updateMapCenterAndRadius();
        runSmartMatch(true); // silent re-run
    }

    function updateMapCenterAndRadius() {
        if (!smartMap || !userCoords) return;
        const radius = Number(radiusSelect?.value) || 25;

        // Position or update draggable search center pin
        if (centerMarker) smartMap.removeLayer(centerMarker);
        const pinIcon = MapService.createDraggableArrowPin ?
            MapService.createDraggableArrowPin('Search Origin', '#2563EB') : null;

        centerMarker = L.marker([userCoords.lat, userCoords.lng], {
            icon: pinIcon || undefined,
            draggable: true,
            zIndexOffset: 1000,
            title: 'Drag me to adjust search center'
        }).addTo(smartMap);

        centerMarker.bindPopup(`
            <div style="text-align: center; padding: 4px; font-family: 'Inter', sans-serif;">
                <b style="color: #2563EB;">🎯 Search Origin Center</b><br>
                <span style="font-size: 11px; color: #475467;">Drag pin or click map to change search center</span>
            </div>
        `);

        centerMarker.on('dragend', () => {
            const pos = centerMarker.getLatLng();
            updateSearchOrigin(pos.lat, pos.lng);
        });

        // Add 5-100 KM Radius Boundary Circle
        if (radiusCircle) smartMap.removeLayer(radiusCircle);
        radiusCircle = MapService.addRadiusCircle(smartMap, userCoords.lat, userCoords.lng, radius);

        smartMap.setView([userCoords.lat, userCoords.lng], radius <= 15 ? 12 : (radius <= 35 ? 11 : 9));
    }

    function renderDonorMarkersOnMap(matches) {
        if (!smartMap || !donorMarkerLayer) return;
        donorMarkerLayer.clearLayers();

        matches.forEach(donor => {
            const dLat = Number(donor.latitude);
            const dLng = Number(donor.longitude);
            if (!Number.isFinite(dLat) || !Number.isFinite(dLng)) return;

            const markerIcon = MapService.createBloodMarkerIcon(donor.blood_group, donor.urgency);
            const marker = L.marker([dLat, dLng], { icon: markerIcon || undefined });

            const scoreColor = donor.composite_score >= 70 ? '#16A34A' : '#D97706';
            marker.bindPopup(`
                <div style="min-width: 200px; padding: 6px; text-align: center; font-family: 'Inter', sans-serif;">
                    <div style="display: inline-block; background: #DCFCE7; color: ${scoreColor}; font-weight: 800; font-size: 0.85rem; padding: 2px 8px; border-radius: 12px; margin-bottom: 6px;">
                        ${donor.composite_score}% Match
                    </div>
                    <h4 style="margin: 0 0 4px; font-size: 1rem; color: #101828;">${escapeHtml(donor.full_name || 'Anonymous Donor')}</h4>
                    <p style="margin: 0 0 8px; font-size: 0.8rem; color: #475467;">
                        🩸 <b>${escapeHtml(donor.blood_group)}</b> • 📍 <b>${donor.distance_km} km</b> away<br>
                        ${escapeHtml(donor.city || 'India')}
                    </p>
                    <a href="chat.html?with=${donor.id}" style="display: block; background: #2563EB; color: white; padding: 8px 12px; border-radius: 6px; text-decoration: none; font-size: 0.8rem; font-weight: 600;">
                        💬 Chat Now
                    </a>
                </div>
            `);

            donorMarkerLayer.addLayer(marker);
        });
    }

    // "🎯 Locate My Current Position" Button
    if (btnRadarLocate) {
        btnRadarLocate.addEventListener('click', async () => {
            const originalText = btnRadarLocate.innerText;
            btnRadarLocate.innerText = '⏳ Locating GPS...';
            btnRadarLocate.disabled = true;

            const loc = await MapService.getUserLocation(true);
            btnRadarLocate.innerText = originalText;
            btnRadarLocate.disabled = false;

            if (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng)) {
                updateSearchOrigin(loc.lat, loc.lng);
            } else {
                alert('Could not retrieve high-accuracy GPS. You can drag the blue search origin pin manually anywhere on the map.');
            }
        });
    }

    // Radius select change handler updates radius circle live
    if (radiusSelect) {
        radiusSelect.addEventListener('change', () => {
            if (smartMap) updateMapCenterAndRadius();
        });
    }

    // Pipeline step animation
    function animatePipeline(step) {
        if (!pipelineBar) return;
        const steps = pipelineBar.querySelectorAll('.pipeline-step');
        steps.forEach((el, i) => {
            el.classList.remove('active', 'done');
            if (i + 1 < step) el.classList.add('done');
            else if (i + 1 === step) el.classList.add('active');
        });
    }

    const loadingSteps = [
        { step: 1, text: 'Step 1: Filtering registered donors in your radius...' },
        { step: 2, text: 'Step 2: Noting requested blood group & units needed...' },
        { step: 3, text: 'Step 3: Scanning registered donors from database...' },
        { step: 4, text: 'Step 4: Matching exact blood group (strictly no cross-matching)...' },
        { step: 5, text: 'Step 5: Calculating distances from your location...' },
        { step: 6, text: 'Step 6: Selecting top 5 nearby matching donors...' }
    ];

    async function runSmartMatch(isSilent = false) {
        const bloodGroup = bloodGroupSelect?.value;
        const unitsNeeded = Math.max(1, parseInt(unitsInput?.value, 10) || 1);
        const radius = Number(radiusSelect?.value) || 25;
        const urgency = urgencySelect?.value || 'Normal';

        if (!bloodGroup) {
            if (!isSilent) alert('Please select a blood group to search for.');
            return;
        }

        if (!userCoords) {
            const loc = await MapService.getUserLocation(true);
            userCoords = loc ? { lat: loc.lat, lng: loc.lng } : MapService.getDefaultLocation();
        }

        if (!isSilent) {
            btnFindMatch.disabled = true;
            btnFindMatch.innerHTML = '⏳ Matching...';
            if (loadingOverlay) loadingOverlay.classList.add('active');
            if (summaryContainer) summaryContainer.style.display = 'none';
            resultsContainer.innerHTML = '';

            for (const loadStep of loadingSteps) {
                animatePipeline(loadStep.step);
                if (loadingStepText) loadingStepText.textContent = loadStep.text;
                await new Promise(r => setTimeout(r, 220));
            }
        }

        try {
            const { data: sessionData } = await supabaseClient.auth.getSession();
            const accessToken = sessionData?.session?.access_token || '';

            const response = await fetch('/api/smart-match', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${accessToken}`
                },
                body: JSON.stringify({
                    blood_group: bloodGroup,
                    units: unitsNeeded,
                    latitude: userCoords.lat,
                    longitude: userCoords.lng,
                    search_radius_km: radius,
                    urgency: urgency,
                    requester_id: currentUserId
                })
            });

            const result = await response.json();

            if (loadingOverlay) loadingOverlay.classList.remove('active');
            btnFindMatch.disabled = false;
            btnFindMatch.innerHTML = '🧠 Find Smart Matches';

            if (!result.success) {
                resultsContainer.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-icon">⚠️</div>
                        <h3>Match Error</h3>
                        <p>${escapeHtml(result.error || 'An unexpected error occurred.')}</p>
                    </div>
                `;
                return;
            }

            // Summary stats (reflecting exact match scenario)
            if (result.summary && summaryContainer) {
                summaryContainer.style.display = 'grid';
                document.getElementById('stat-total-donors').textContent = result.summary.total_donors_in_system || 0;
                document.getElementById('stat-in-radius').textContent = result.summary.donors_in_radius || 0;
                document.getElementById('stat-compatible').textContent = result.summary.exact_blood_matched || 0;
                document.getElementById('stat-eligible').textContent = result.summary.available_eligible || 0;
                document.getElementById('stat-matched').textContent = result.summary.matches_returned || 0;
            }

            animatePipeline(7);
            currentMatches = result.matches || [];

            if (resultsCountBadge) {
                resultsCountBadge.textContent = `${currentMatches.length} Matches Found`;
            }

            // Update map markers
            if (smartMap) {
                renderDonorMarkersOnMap(currentMatches);
            }

            // Render match cards
            if (currentMatches.length === 0) {
                resultsContainer.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-icon">🔍</div>
                        <h3>No Exact Match Donors Found</h3>
                        <p>No available donors with exact <b>${escapeHtml(bloodGroup)}</b> blood were found within <b>${radius} km</b> for ${unitsNeeded} unit(s). Try increasing the search radius to 50 km or 100 km.</p>
                    </div>
                `;
                return;
            }

            renderMatches(currentMatches, urgency, unitsNeeded, bloodGroup);

        } catch (error) {
            console.error('Smart Match error:', error);
            if (loadingOverlay) loadingOverlay.classList.remove('active');
            btnFindMatch.disabled = false;
            btnFindMatch.innerHTML = '🧠 Find Smart Matches';

            resultsContainer.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">⚠️</div>
                    <h3>Connection Error</h3>
                    <p>Failed to connect to the smart matching service. Please check your connection and try again.</p>
                </div>
            `;
        }
    }

    function renderMatches(matches, urgency, unitsNeeded, bloodGroup) {
        const urgencyClass = urgency.toLowerCase() === 'critical' ? 'urgency-critical'
            : urgency.toLowerCase() === 'urgent' ? 'urgency-urgent' : '';

        resultsContainer.innerHTML = matches.map((donor, index) => {
            const scoreColor = donor.composite_score >= 70 ? '#16A34A'
                : donor.composite_score >= 50 ? '#D97706' : '#2563EB';

            const avatarContent = donor.avatar_url
                ? `<img src="${escapeHtml(donor.avatar_url)}" alt="${escapeHtml(donor.full_name)}">`
                : donor.full_name ? donor.full_name.charAt(0).toUpperCase() : '🩸';

            const donationsText = donor.past_donations > 0
                ? `${donor.past_donations} donation${donor.past_donations > 1 ? 's' : ''}`
                : 'New Donor';

            return `
                <div class="match-card ${urgencyClass}" data-label="${escapeHtml(donor.match_label_key)}" style="animation: fadeSlideIn 0.3s ease ${index * 0.08}s both;">
                    <div class="rank-badge">${escapeHtml(donor.match_label)}</div>
                    
                    <div class="donor-avatar">${avatarContent}</div>
                    
                    <div class="donor-info">
                        <h3>${escapeHtml(donor.full_name || 'Anonymous Donor')}</h3>
                        <div class="donor-meta">
                            <span class="blood-badge" style="background: #DCFCE7; color: #15803D; border: 1px solid #86EFAC;">
                                🩸 Exact Match: ${escapeHtml(donor.blood_group || '')}
                            </span>
                            <span>📍 <b>${donor.distance_km} km</b> away</span>
                            <span>🏙️ ${escapeHtml(donor.city || 'Unknown')}</span>
                            <span>🏥 ${donationsText}</span>
                            <span>💉 Need: ${donor.units_requested || unitsNeeded || 1} Unit(s)</span>
                        </div>
                        <div class="match-actions">
                            <button class="btn-chat-donor" data-donor-id="${donor.id}" data-donor-name="${escapeHtml(donor.full_name || '')}">
                                💬 Chat Now
                            </button>
                            <a href="blood-request.html" class="btn-view-profile" style="text-decoration: none;">
                                📋 Request Blood
                            </a>
                        </div>
                    </div>
                    
                    <div class="score-section">
                        <div class="composite-score" style="color: ${scoreColor};">${donor.composite_score}%</div>
                        <div class="score-label">Proximity Match Score</div>
                        <div class="score-bars">
                            <div class="score-bar-row">
                                <span class="score-bar-label">Proximity</span>
                                <div class="score-bar-track">
                                    <div class="score-bar-fill" style="width: ${donor.proximity_score}%; background: #2563EB;"></div>
                                </div>
                            </div>
                            <div class="score-bar-row">
                                <span class="score-bar-label">Trust</span>
                                <div class="score-bar-track">
                                    <div class="score-bar-fill" style="width: ${donor.trust_score}%; background: #8B5CF6;"></div>
                                </div>
                            </div>
                            <div class="score-bar-row">
                                <span class="score-bar-label">Ready</span>
                                <div class="score-bar-track">
                                    <div class="score-bar-fill" style="width: ${donor.recency_score}%; background: #16A34A;"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        // Chat button handlers
        document.querySelectorAll('.btn-chat-donor').forEach(btn => {
            btn.addEventListener('click', async () => {
                const donorId = btn.dataset.donorId;
                if (!currentUserId) {
                    alert('Please log in to chat with donors.');
                    return;
                }
                window.location.href = `chat.html?with=${donorId}`;
            });
        });
    }

    if (btnFindMatch) {
        btnFindMatch.addEventListener('click', () => runSmartMatch(false));
    }

    // Auto-run for request_id or URL params
    if (autoRequestId && supabaseClient) {
        try {
            const { data: request } = await supabaseClient
                .from('blood_requests')
                .select('*')
                .eq('id', autoRequestId)
                .maybeSingle();

            if (request) {
                if (bloodGroupSelect) bloodGroupSelect.value = request.blood_group;
                if (unitsInput && request.units_needed) unitsInput.value = request.units_needed;
                if (urgencySelect) urgencySelect.value = request.urgency || 'Normal';
                if (request.search_radius_km && radiusSelect) radiusSelect.value = request.search_radius_km;
                if (request.latitude && request.longitude) {
                    userCoords = { lat: request.latitude, lng: request.longitude };
                }
                setTimeout(() => runSmartMatch(false), 400);
            }
        } catch (e) {
            console.warn('Auto-match for request failed:', e);
        }
    } else if (urlParams.get('blood_group')) {
        setTimeout(() => runSmartMatch(false), 400);
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
