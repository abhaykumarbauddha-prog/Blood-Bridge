// frontend/js/admin-dashboard.js
/**
 * Admin Dashboard Controller
 * - Connects to Supabase blood_requests and users
 * - Powers Interactive Leaflet Map for Donor Locations with 100km radius
 * - Dynamically computes KPIs, blood group distribution donut chart
 * - Live search filtering, interactive tabs, moderation actions, and logout
 */

document.addEventListener('DOMContentLoaded', async () => {
    const supabaseClient = window.bloodBridgeSupabase;
    const requestsTbody = document.getElementById('admin-recent-requests-tbody');
    const donorsTbody = document.getElementById('admin-recent-donors-tbody');
    const mapContainer = document.getElementById('admin-donors-map');
    const legendContainer = document.getElementById('admin-map-legend');
    const searchInput = document.getElementById('admin-search-input');
    const logoutBtn = document.getElementById('admin-logout-btn');
    const dateFilterBtn = document.getElementById('admin-date-filter-btn');

    // KPI Elements
    const kpiTotalUsers = document.getElementById('admin-kpi-total-users');
    const kpiDonors = document.getElementById('admin-kpi-donors');
    const kpiRequests = document.getElementById('admin-kpi-requests');
    const kpiHospitals = document.getElementById('admin-kpi-hospitals');
    const kpiDonations = document.getElementById('admin-kpi-donations');

    // Donut Chart Elements
    const donutChart = document.getElementById('admin-donut-chart');
    const donutTotal = document.getElementById('admin-donut-total');
    const donutLegend = document.getElementById('admin-donut-legend');

    let adminMap = null;
    let adminCenter = null;
    let donorMarkerLayer = null;

    // Blood group colors for donut chart
    const bloodGroupColors = {
        'O+': '#E60023',
        'A+': '#F59E0B',
        'B+': '#EAB308',
        'AB+': '#8B5CF6',
        'O-': '#3B82F6',
        'A-': '#16A34A',
        'B-': '#EC4899',
        'AB-': '#06B6D4'
    };

    // 1. Load Real Dashboard Metrics & Update KPIs
    async function loadAdminMetrics() {
        if (!supabaseClient) return;

        try {
            // Total users and verified hospitals are intentionally unavailable from the protected users table.
            if (kpiTotalUsers) kpiTotalUsers.textContent = '-';

            // Registered Donors
            const { data: donorsData, count: donorsCount } = await supabaseClient
                .from('public_donors')
                .select('blood_group', { count: 'exact' });

            const totalDonors = donorsCount || (donorsData ? donorsData.length : 0);
            if (kpiDonors) kpiDonors.textContent = String(totalDonors);
            if (donutTotal) donutTotal.textContent = String(totalDonors);

            // Blood Requests & Fulfilled
            const { data: reqsData, count: reqsCount } = await supabaseClient
                .from('blood_requests')
                .select('id, status');

            const totalReqs = reqsCount || (reqsData ? reqsData.length : 0);
            if (kpiRequests) kpiRequests.textContent = String(totalReqs);

            if (kpiDonations) kpiDonations.textContent = '-';

            if (kpiHospitals) kpiHospitals.textContent = '-';

            // Compute Donut Distribution
            renderDonutDistribution(donorsData || []);
        } catch (err) {
            console.error('Error loading admin metrics:', err);
        }
    }

    // Render Dynamic Donut Chart
    function renderDonutDistribution(donors) {
        if (!donutChart || !donutLegend) return;

        if (donors.length === 0) {
            donutLegend.innerHTML = '<div style="color: var(--text-secondary); font-size: 0.8rem;">No donors to display</div>';
            return;
        }

        const counts = {};
        donors.forEach(d => {
            const grp = (d.blood_group || 'O+').trim().toUpperCase();
            counts[grp] = (counts[grp] || 0) + 1;
        });

        const total = donors.length;
        const segments = [];
        let currentPercent = 0;
        const legendItems = [];

        Object.entries(counts).forEach(([grp, count]) => {
            const pct = Math.round((count / total) * 100);
            const color = bloodGroupColors[grp] || '#6B7280';
            const nextPercent = currentPercent + pct;
            segments.push(`${color} ${currentPercent}% ${nextPercent}%`);
            currentPercent = nextPercent;

            legendItems.push(`
                <div class="legend-item">
                    <div class="legend-dot" style="background: ${color};"></div>
                    ${grp} ${pct}% (${count})
                </div>
            `);
        });

        donutChart.style.background = `conic-gradient(${segments.join(', ')})`;
        donutLegend.innerHTML = legendItems.join('');
    }

    // 2. Load Real Recent Blood Requests
    async function loadAdminRequests() {
        if (!requestsTbody || !supabaseClient) return;

        try {
            const { data: requests, error } = await supabaseClient
                .from('blood_requests')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(8);

            if (error) throw error;

            if (!requests || requests.length === 0) {
                requestsTbody.innerHTML = `
                    <tr>
                        <td colspan="7" style="text-align: center; padding: 24px; color: var(--text-secondary); font-size: 0.85rem;">
                            No blood requests found. New requests will appear here dynamically.
                        </td>
                    </tr>
                `;
                return;
            }

            requestsTbody.innerHTML = requests.map((req, idx) => {
                const urgency = req.urgency || 'Normal';
                let tagClass = 'tag-pending';
                if (urgency.toLowerCase() === 'critical') tagClass = 'tag-critical';
                else if (urgency.toLowerCase() === 'urgent') tagClass = 'tag-urgent';

                const reqId = `#BR-${(req.id || String(idx)).slice(0, 4).toUpperCase()}`;
                const reqDate = BloodMatchData.formatDateTime(req.created_at);

                return `
                    <tr class="admin-data-row">
                        <td>${reqId}</td>
                        <td><strong>${escapeHtml(req.patient_name)}</strong></td>
                        <td class="blood-type-text">${escapeHtml(req.blood_group)}</td>
                        <td>${req.units}</td>
                        <td>${escapeHtml(req.city || 'Location not set')}</td>
                        <td><span class="status-tag ${tagClass}">${escapeHtml(urgency)}</span></td>
                        <td>${reqDate}</td>
                    </tr>
                `;
            }).join('');
        } catch (err) {
            console.error('Error loading admin requests:', err);
            requestsTbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 16px; color: var(--text-secondary);">Unable to load requests.</td></tr>`;
        }
    }

    // 3. Load Real Registered Donors
    async function loadAdminDonors() {
        if (!donorsTbody || !supabaseClient) return;

        try {
            const { data: donors, error } = await supabaseClient
                .from('public_donors')
                .select('id, full_name, blood_group, city, is_available, avatar_url')
                .limit(8);

            if (error) throw error;

            if (!donors || donors.length === 0) {
                donorsTbody.innerHTML = `
                    <tr>
                        <td colspan="5" style="text-align: center; padding: 24px; color: var(--text-secondary); font-size: 0.85rem;">
                            No registered donors found yet.
                        </td>
                    </tr>
                `;
                return;
            }

            donorsTbody.innerHTML = donors.map(donor => {
                const name = donor.full_name || 'Donor';
                const avatar = donor.avatar_url || 'assets/profile-placeholder.svg';
                const isAvailable = donor.is_available === true;

                return `
                    <tr class="admin-data-row">
                        <td class="donor-name-cell">
                            <img src="${avatar}" class="donor-avatar" alt="${escapeHtml(name)}">
                            ${escapeHtml(name)}
                        </td>
                        <td class="blood-type-text">${escapeHtml(donor.blood_group || 'O+')}</td>
                        <td>${escapeHtml(donor.city || 'Location not set')}</td>
                        <td><span style="color: ${isAvailable ? 'var(--status-available)' : 'var(--status-pending)'}; font-weight: 500;">${isAvailable ? 'Available' : 'Unavailable'}</span></td>
                        <td>Protected</td>
                    </tr>
                `;
            }).join('');
        } catch (err) {
            console.error('Error loading admin donors:', err);
            donorsTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 16px; color: var(--text-secondary);">Unable to load donors.</td></tr>`;
        }
    }

    // 4. Initialize Interactive Leaflet Map for Donor Locations with 100km Radius
    async function initAdminMap() {
        if (!mapContainer || !window.MapService || !window.L) return;

        const loc = await MapService.getUserLocation();
        adminCenter = loc || (MapService.getDefaultLocation ? MapService.getDefaultLocation() : { lat: 26.8467, lng: 80.9462 });

        adminMap = MapService.createMap('admin-donors-map', {
            center: [adminCenter.lat, adminCenter.lng],
            zoom: 8,
            scrollWheelZoom: false
        });

        // 100 KM Radius Boundary Circle
        if (!adminMap) return;
        donorMarkerLayer = window.L.markerClusterGroup ? L.markerClusterGroup() : L.layerGroup();
        donorMarkerLayer.addTo(adminMap);
        MapService.addRadiusCircle(adminMap, adminCenter.lat, adminCenter.lng, 100);

        try {
            const { data: donors } = await supabaseClient
                .from('public_donors')
                .select('full_name, blood_group, city, state, is_available, latitude, longitude')
                .limit(20);

            let availableCount = 0;
            let busyCount = 0;

            for (const d of (donors || [])) {
                const coords = { lat: Number(d.latitude), lng: Number(d.longitude) };
                if (![coords.lat, coords.lng].every(Number.isFinite) || !BloodMatchData.withinRadius(adminCenter, coords, 100)) continue;
                if (d.is_available) availableCount++;
                else busyCount++;
                const icon = MapService.createBloodMarkerIcon(d.blood_group, 'Normal');
                L.marker([coords.lat, coords.lng], { icon })
                    .addTo(donorMarkerLayer || adminMap)
                    .bindPopup(`<b>${escapeHtml(d.full_name)}</b> (${d.blood_group})<br>📍 ${escapeHtml(d.city || 'Location not set')}`);
            }

            if (legendContainer) {
                legendContainer.innerHTML = `
                    <span><div class="legend-dot" style="display: inline-block; background: var(--brand-primary);"></div> Available (${availableCount})</span>
                    <span><div class="legend-dot" style="display: inline-block; background: var(--status-info);"></div> Busy (${busyCount})</span>
                    <span><div class="legend-dot" style="display: inline-block; background: #E60023;"></div> 100 km Radius</span>
                `;
            }
        } catch (e) {
            console.warn('Admin map data loading error:', e);
        }
    }

    // 5. Live Search Filtering for Tables
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            const rows = document.querySelectorAll('.admin-data-row');
            rows.forEach(row => {
                const text = row.textContent.toLowerCase();
                row.style.display = text.includes(query) ? '' : 'none';
            });
        });
    }

    // 6. Interactive Moderation Tabs
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
        });
    });

    // 7. Review Buttons
    document.querySelectorAll('.btn-review').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const reportItem = e.target.closest('.report-item');
            const title = reportItem ? reportItem.querySelector('h5')?.textContent : 'Report';
            const action = confirm(`Reviewing Report:\n"${title}"\n\nMark this report as resolved?`);
            if (action && reportItem) {
                reportItem.style.opacity = '0.4';
                btn.textContent = 'Resolved ✓';
                btn.disabled = true;
                btn.style.borderColor = 'var(--status-available)';
                btn.style.color = 'var(--status-available)';
            }
        });
    });

    // 8. Date Filter Toggle
    if (dateFilterBtn) {
        const dateOptions = ['📅 Last 30 Days ⌄', '📅 Last 7 Days ⌄', '📅 This Month ⌄', '📅 All Time ⌄'];
        let curIdx = 0;
        dateFilterBtn.addEventListener('click', () => {
            curIdx = (curIdx + 1) % dateOptions.length;
            dateFilterBtn.textContent = dateOptions[curIdx];
        });
    }

    // 9. Logout Handler
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            if (confirm('Are you sure you want to log out from Admin Dashboard?')) {
                await supabaseClient.auth.signOut();
                window.location.href = 'auth.html';
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

    // Initializations
    loadAdminMetrics();
    loadAdminRequests();
    loadAdminDonors();
    initAdminMap();
});
