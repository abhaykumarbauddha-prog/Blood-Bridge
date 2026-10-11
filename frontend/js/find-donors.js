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
    let centerCoords = MapService.DEFAULT_COORDS;
    let allDonors = [];
    const markerRegistry = new Map();

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
        if (!mapContainer || !window.MapService || !window.L) return;

        donorsMap = MapService.createMap('donors-map-container', {
            center: [centerCoords.lat, centerCoords.lng],
            zoom: 10
        });

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

    // 3. Detect Live Location
    MapService.getUserLocation().then(loc => {
        if (loc) {
            centerCoords = loc;
            if (locationInput && loc.isLive) {
                MapService.reverseGeocode(loc.lat, loc.lng).then(info => {
                    if (info.city) locationInput.value = info.city;
                });
            }
        }
    });

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
                const res = await fetch('/api/donors');
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
                    .from('users')
                    .select('id, full_name, phone, blood_group, city, address, state, last_donation_date, availability_status, avatar_url')
                    .eq('role', 'Donor');

                if (error) throw error;
                donorsData = data || [];
            }

            allDonors = [];

            // Process location & distance for each real donor
            for (const donor of (donorsData || [])) {
                const locationQuery = [donor.address, donor.city, donor.state || 'Uttar Pradesh'].filter(Boolean).join(', ');
                const coords = await MapService.geocodeAddress(locationQuery);
                const distanceKm = MapService.calculateDistanceKm(centerCoords.lat, centerCoords.lng, coords.lat, coords.lng);

                allDonors.push({
                    ...donor,
                    lat: coords.lat,
                    lng: coords.lng,
                    distanceKm: distanceKm ?? 15
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

        let filtered = allDonors.filter(donor => {
            const matchesGroup = !selectedGroup || donor.blood_group === selectedGroup;
            const matchesRadius = donor.distanceKm <= selectedRadius;
            const matchesStatus = !selectedStatus || (donor.availability_status || 'Available') === selectedStatus;
            return matchesGroup && matchesRadius && matchesStatus;
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
            const city = donor.city || 'Lucknow';
            const status = donor.availability_status || 'Available';
            const isAvailable = status.toLowerCase() === 'available';
            const avatar = donor.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=FFF0F2&color=E60023`;

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
                    <button type="button" class="btn-contact primary btn-request-donor" data-donor-name="${escapeHtml(name)}" data-donor-blood="${escapeHtml(blood)}">
                        Request Blood
                    </button>
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
        markerRegistry.forEach(({ marker }) => donorsMap.removeLayer(marker));
        markerRegistry.clear();

        donors.forEach(donor => {
            const icon = MapService.createBloodMarkerIcon(donor.blood_group, 'Normal');
            const marker = L.marker([donor.lat, donor.lng], { icon }).addTo(donorsMap);

            const popupContent = `
                <div style="font-family: inherit; min-width: 180px; text-align: center;">
                    <div style="font-weight: 700; font-size: 14px; margin-bottom: 2px;">${escapeHtml(donor.full_name || 'Donor')} ✔</div>
                    <p style="margin: 0 0 6px; font-size: 12px; color: #475467;">
                        🩸 Blood Group: <b>${escapeHtml(donor.blood_group || 'O+')}</b><br>
                        📍 ${donor.distanceKm} km away (${escapeHtml(donor.city || '')})<br>
                        Status: <b style="color: #16A34A;">${escapeHtml(donor.availability_status || 'Available')}</b>
                    </p>
                    <a href="blood-request.html" style="display: block; background: #E60023; color: white; text-decoration: none; padding: 6px 12px; border-radius: 6px; font-weight: 600; font-size: 11px;">
                        Request Blood
                    </a>
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
                        donor.distanceKm = MapService.calculateDistanceKm(centerCoords.lat, centerCoords.lng, donor.lat, donor.lng) ?? 15;
                    });
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

    // Initial load
    fetchDonors();
});
