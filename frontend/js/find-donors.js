// frontend/js/find-donors.js
/**
 * Find Donors Controller
 * - Fetches real donors from Supabase users table (role = 'Donor')
 * - 100 KM Radius Filtering via Haversine Formula
 * - Grid and Leaflet Map View Toggles
 */

document.addEventListener('DOMContentLoaded', async () => {
    const supabaseClient = window.bloodBridgeSupabase;
    const gridBtn = document.getElementById('btn-view-grid');
    const mapBtn = document.getElementById('btn-view-map');
    const gridContainer = document.getElementById('donor-grid-container');
    const mapContainer = document.getElementById('donors-map-container');
    const countText = document.getElementById('donors-count-text');

    const bloodFilter = document.getElementById('donor-blood-filter');
    const locationInput = document.getElementById('donor-location-filter');
    const radiusFilter = document.getElementById('donor-radius-filter');
    const statusFilter = document.getElementById('donor-status-filter');
    const searchBtn = document.getElementById('btn-donor-search');
    const sortFilter = document.getElementById('donor-sort-filter');

    let donorsMap = null;
    let radiusCircle = null;
    let userMarker = null;
    let centerCoords = null;
    let allDonors = [];
    const markerRegistry = new Map();
    let markerLayer = null;

    // 1. Initialize View Toggles
    if (gridBtn && mapBtn) {
        gridBtn.addEventListener('click', () => {
            gridBtn.classList.add('active');
            mapBtn.classList.remove('active');
            if (gridContainer) gridContainer.style.display = 'grid';
            if (mapContainer) mapContainer.style.display = 'none';
        });

        mapBtn.addEventListener('click', () => {
            mapBtn.classList.add('active');
            gridBtn.classList.remove('active');
            if (gridContainer) gridContainer.style.display = 'none';
            if (mapContainer) {
                mapContainer.style.display = 'block';
                if (!donorsMap) {
                    initDonorsMap();
                } else {
                    donorsMap.invalidateSize();
                }
            }
        });
    }

    // 2. Initialize Map
    function initDonorsMap() {
        if (!mapContainer || !window.MapService || !window.L || !centerCoords) return;

        donorsMap = MapService.createMap('donors-map-container', {
            center: [centerCoords.lat, centerCoords.lng],
            zoom: 10
        });
        if (!donorsMap) return;
        markerLayer = window.L.markerClusterGroup ? L.markerClusterGroup() : L.layerGroup();
        markerLayer.addTo(donorsMap);

        updateMapCenterAndRadius();
        renderMapMarkers();
    }

    function updateMapCenterAndRadius() {
        if (!donorsMap) return;

        const radiusKm = Number(radiusFilter?.value || 100);

        if (userMarker) donorsMap.removeLayer(userMarker);
        const userIcon = MapService.createBloodMarkerIcon(null, null, true);
        userMarker = L.marker([centerCoords.lat, centerCoords.lng], { icon: userIcon, zIndexOffset: 1000 })
            .addTo(donorsMap)
            .bindPopup('<b>🎯 Search Center Location</b>');

        if (radiusCircle) donorsMap.removeLayer(radiusCircle);
        if (radiusKm < 90000) {
            radiusCircle = MapService.addRadiusCircle(donorsMap, centerCoords.lat, centerCoords.lng, radiusKm);
        }

        donorsMap.setView([centerCoords.lat, centerCoords.lng], radiusKm <= 25 ? 12 : (radiusKm <= 50 ? 11 : 9));
    }

    // 3. Detect Location & Handle Search Query
    (async () => {
        const loc = await MapService.getUserLocation();
        centerCoords = loc || MapService.getDefaultLocation();

        if (locationInput && loc?.city) {
            locationInput.value = loc.city;
        }

        // Parse search query from URL parameter (?q=...)
        const urlParams = new URLSearchParams(window.location.search);
        const queryParam = urlParams.get('q');
        if (queryParam) {
            const cleanQ = queryParam.trim();
            const upperQ = cleanQ.toUpperCase();
            const bloodTypes = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
            if (bloodTypes.includes(upperQ) && bloodFilter) {
                bloodFilter.value = upperQ;
            } else {
                const topSearch = document.querySelector('.search-bar input');
                if (topSearch) topSearch.value = cleanQ;
            }
        }

        if (mapBtn?.classList.contains('active')) initDonorsMap();
        await fetchDonors();
    })();

    // 4. Fetch Real Donors from Supabase
    async function fetchDonors() {
        if (!supabaseClient) {
            console.error('Supabase client missing.');
            return;
        }

        if (countText) countText.textContent = 'Searching verified donors within 100km...';

        try {
            // First try backend API endpoint
            let donorsData = null;
            try {
                const { data: sessionData } = await supabaseClient.auth.getSession();
                const token = sessionData?.session?.access_token;
                const res = await fetch('/api/donors', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
                const json = await res.json();
                if (json.success && Array.isArray(json.data)) {
                    donorsData = json.data;
                }
            } catch (apiErr) {
                console.warn('Backend API /api/donors fetch failed, falling back to direct Supabase client:', apiErr);
            }

            // Fallback to direct client query
            if (!donorsData) {
                const { data, error } = await supabaseClient
                    .from('public_donors')
                    .select('id, full_name, blood_group, city, state, last_donation_date, availability_status, is_donor, is_available, latitude, longitude, avatar_url');

                if (error) throw error;
                donorsData = data || [];
            }

            allDonors = [];

            if (!centerCoords) {
                if (countText) countText.textContent = 'Set your location to find nearby donors.';
                renderGrid([]);
                return;
            }

            // Only persisted donor coordinates are valid map locations.
            for (const donor of (donorsData || [])) {
                const coords = { lat: Number(donor.latitude), lng: Number(donor.longitude) };
                if (![coords.lat, coords.lng].every(Number.isFinite)) continue;
                const distanceKm = MapService.calculateDistanceKm(centerCoords.lat, centerCoords.lng, coords.lat, coords.lng);

                allDonors.push({
                    ...donor,
                    lat: coords.lat,
                    lng: coords.lng,
                    distanceKm
                });
            }

            applyFiltersAndRender();
        } catch (err) {
            console.error('Failed to load donors:', err);
            if (countText) countText.textContent = 'Error loading donors.';
            if (gridContainer) {
                gridContainer.innerHTML = `
                    <div style="grid-column: 1 / -1; background: white; border-radius: 12px; padding: 32px; text-align: center; border: 1px solid var(--border-light);">
                        <p style="color: var(--text-secondary); margin-bottom: 8px;">Unable to load donor profiles.</p>
                        <button onclick="window.location.reload()" style="background: var(--brand-primary); color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer;">Retry</button>
                    </div>
                `;
            }
        }
    }

    // 5. Apply Filters and Render Grid + Map
    function applyFiltersAndRender() {
        const selectedGroup = bloodFilter?.value || '';
        const selectedRadius = Number(radiusFilter?.value || 100);
        const selectedStatus = statusFilter?.value || '';
        const sortVal = sortFilter?.value || 'nearest';

        const topbarInput = document.querySelector('.search-bar input');
        const searchKeyword = (topbarInput?.value || '').trim().toLowerCase();

        let filtered = allDonors.filter(donor => {
            const matchesGroup = !selectedGroup || donor.blood_group === selectedGroup;
            const matchesRadius = BloodMatchData.withinRadius(centerCoords, { lat: donor.lat, lng: donor.lng }, selectedRadius);
            const matchesStatus = !selectedStatus || (donor.is_available ? 'Available' : 'Unavailable') === selectedStatus;

            let matchesKeyword = true;
            if (searchKeyword) {
                const name = (donor.full_name || '').toLowerCase();
                const city = (donor.city || '').toLowerCase();
                const state = (donor.state || '').toLowerCase();
                const bg = (donor.blood_group || '').toLowerCase();
                matchesKeyword = name.includes(searchKeyword) || city.includes(searchKeyword) || state.includes(searchKeyword) || bg === searchKeyword;
            }

            return matchesGroup && matchesRadius && matchesStatus && matchesKeyword;
        });

        // Sort
        filtered.sort((a, b) => {
            if (sortVal === 'name') {
                return (a.full_name || '').localeCompare(b.full_name || '');
            }
            return a.distanceKm - b.distanceKm;
        });

        // Update count text
        if (countText) {
            countText.innerHTML = `Showing <strong>${filtered.length}</strong> verified ${filtered.length === 1 ? 'donor' : 'donors'} within ${selectedRadius >= 90000 ? 'any distance' : selectedRadius + ' km'}`;
        }

        // Render Grid
        renderGrid(filtered);

        // Render Map
        renderMapMarkers(filtered);
    }

    function renderGrid(donors) {
        if (!gridContainer) return;

        if (!donors.length) {
            gridContainer.innerHTML = `
                <div style="grid-column: 1 / -1; background: white; border-radius: 12px; padding: 48px 24px; text-align: center; border: 1px solid var(--border-light);">
                    <span style="font-size: 2.5rem; display: block; margin-bottom: 12px;">🩸</span>
                    <h3 style="font-size: 1.1rem; color: var(--text-dark); margin-bottom: 6px;">No Registered Donors Found in ${radiusFilter?.value || 100} KM</h3>
                    <p style="color: var(--text-secondary); font-size: 0.85rem; max-width: 340px; margin: 0 auto 20px;">
                        Try widening your search radius to 100 km or selecting "Any Blood Group".
                    </p>
                    <a href="blood-request.html" style="background: var(--brand-primary); color: white; text-decoration: none; padding: 10px 20px; border-radius: 8px; font-weight: 600; font-size: 0.9rem; display: inline-block;">
                        Post a Blood Request
                    </a>
                </div>
            `;
            return;
        }

        gridContainer.innerHTML = donors.map(donor => {
            const name = donor.full_name || 'Donor';
            const blood = donor.blood_group || 'O+';
            const city = donor.city || 'Location not set';
            const status = donor.is_available ? 'Available' : 'Unavailable';
            const isAvailable = status.toLowerCase() === 'available';
            const avatar = donor.avatar_url || 'assets/profile-placeholder.svg';

            return `
                <div class="donor-card">
                    <div class="status-badge ${isAvailable ? 'badge-available' : 'badge-busy'}">${escapeHtml(status)}</div>
                    <div class="donor-avatar">
                        <img src="${avatar}" alt="${escapeHtml(name)}">
                        <div class="blood-type-icon">${escapeHtml(blood)}</div>
                    </div>
                    <h3>${escapeHtml(name)} <span class="verified-tick">✔</span></h3>
                    <p class="location"><span>📍</span> <strong>${donor.distanceKm} km away</strong> (${escapeHtml(city)})</p>
                    
                    <div class="donor-stats">
                        <div><h4>🩸</h4><p>${escapeHtml(blood)}</p></div>
                        <div><h4>${donor.last_donation_date ? 'Recent' : 'Active'}</h4><p>Status</p></div>
                    </div>
                    <div style="display: flex; gap: 8px; margin-top: 12px;">
                        <button type="button" class="btn-contact primary btn-request-donor" style="flex: 1;" data-donor-name="${escapeHtml(name)}" data-donor-blood="${escapeHtml(blood)}">
                            Request Blood
                        </button>
                        <a href="chat.html?with=${donor.id}" class="btn-contact" style="background: var(--bg-pink); color: var(--brand-primary); border: 1px solid var(--brand-primary); padding: 8px 14px; border-radius: 8px; font-weight: 600; text-decoration: none; display: flex; align-items: center; justify-content: center; font-size: 0.85rem;" title="Chat directly with ${escapeHtml(name)}">
                            💬 Chat
                        </a>
                    </div>
                </div>
            `;
        }).join('');

        // Wire "Request Blood" buttons
        document.querySelectorAll('.btn-request-donor').forEach(btn => {
            btn.addEventListener('click', () => {
                const dName = btn.dataset.donorName;
                const dBlood = btn.dataset.donorBlood;
                sessionStorage.setItem('preferred_donor_name', dName);
                sessionStorage.setItem('preferred_donor_blood', dBlood);
                window.location.href = 'blood-request.html';
            });
        });
    }

    function renderMapMarkers(donors = allDonors) {
        if (!donorsMap) return;

        // Clear existing markers
        if (markerLayer) markerLayer.clearLayers();
        markerRegistry.clear();

        donors.forEach(donor => {
            const icon = MapService.createBloodMarkerIcon(donor.blood_group, 'Normal');
            const marker = L.marker([donor.lat, donor.lng], { icon }).addTo(markerLayer || donorsMap);

            const popupContent = `
                <div style="font-family: inherit; min-width: 190px; text-align: center;">
                    <div style="font-weight: 700; font-size: 14px; margin-bottom: 2px;">${escapeHtml(donor.full_name || 'Donor')} ✔</div>
                    <p style="margin: 0 0 6px; font-size: 12px; color: #475467;">
                        🩸 Blood Group: <b>${escapeHtml(donor.blood_group || 'O+')}</b><br>
                        📍 ${donor.distanceKm} km away (${escapeHtml(donor.city || '')})<br>
                        Status: <b style="color: #16A34A;">${donor.is_available ? 'Available' : 'Unavailable'}</b>
                    </p>
                    <div style="display: flex; gap: 6px; justify-content: center;">
                        <a href="blood-request.html" style="background: #E60023; color: white; text-decoration: none; padding: 6px 10px; border-radius: 6px; font-weight: 600; font-size: 11px;">
                            Request Blood
                        </a>
                        <a href="chat.html?with=${donor.id}" style="background: #FFF0F2; color: #E60023; border: 1px solid #E60023; text-decoration: none; padding: 6px 10px; border-radius: 6px; font-weight: 600; font-size: 11px;">
                            💬 Chat
                        </a>
                    </div>
                </div>
            `;
            marker.bindPopup(popupContent);
            markerRegistry.set(donor.id, { marker, lat: donor.lat, lng: donor.lng });
        });
    }

    // 6. Hook Controls
    if (searchBtn) {
        searchBtn.addEventListener('click', async () => {
            const locText = locationInput?.value?.trim();
            if (locText) {
                const coords = await MapService.geocodeAddress(locText);
                if (coords) {
                    centerCoords = coords;
                    updateMapCenterAndRadius();
                    // Recalculate distances relative to new center
                    allDonors.forEach(donor => {
                        donor.distanceKm = MapService.calculateDistanceKm(centerCoords.lat, centerCoords.lng, donor.lat, donor.lng);
                    });
                    if (!allDonors.length) await fetchDonors();
                }
            }
            applyFiltersAndRender();
        });
    }

    if (bloodFilter) bloodFilter.addEventListener('change', applyFiltersAndRender);
    if (radiusFilter) {
        radiusFilter.addEventListener('change', () => {
            updateMapCenterAndRadius();
            applyFiltersAndRender();
        });
    }
    if (statusFilter) statusFilter.addEventListener('change', applyFiltersAndRender);
    if (sortFilter) sortFilter.addEventListener('change', applyFiltersAndRender);

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    const topbarInput = document.querySelector('.search-bar input');
    if (topbarInput) {
        topbarInput.addEventListener('input', applyFiltersAndRender);
        topbarInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') applyFiltersAndRender();
        });
    }

    const topbarSearchIcon = document.querySelector('.search-bar span');
    if (topbarSearchIcon) {
        topbarSearchIcon.style.cursor = 'pointer';
        topbarSearchIcon.addEventListener('click', applyFiltersAndRender);
    }
});
