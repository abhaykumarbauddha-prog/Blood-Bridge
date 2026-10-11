// frontend/js/dashboard.js
/**
 * User Dashboard Controller
 * - Connects to Supabase blood_requests table
 * - Renders Interactive 100 KM Leaflet Mini-Map with real requests and donors
 * - Dynamic legend counts
 * - Interactive Tips Carousel
 * - Dynamic Eligibility calculation
 * - Search and Quick Actions
 */

document.addEventListener('DOMContentLoaded', async () => {
    const supabaseClient = window.bloodBridgeSupabase;
    const requestsContainer = document.getElementById('dashboard-requests-container');
    const miniMapContainer = document.getElementById('dashboard-mini-map');
    const legendContainer = document.getElementById('dashboard-map-legend');
    const searchInput = document.getElementById('topbar-search-input');
    const referBtn = document.getElementById('btn-refer-friend');

    let miniMap = null;
    let userCoords = MapService?.DEFAULT_COORDS || { lat: 26.8467, lng: 80.9462 };

    // 1. Load Real Requests
    async function loadDashboardRequests() {
        if (!requestsContainer || !supabaseClient) return;

        try {
            const { data: requests, error } = await supabaseClient
                .from('blood_requests')
                .select('*')
                .neq('status', 'Fulfilled')
                .order('created_at', { ascending: false })
                .limit(4);

            if (error) throw error;

            if (!requests || requests.length === 0) {
                requestsContainer.innerHTML = `
                    <div style="text-align: center; padding: 28px 12px; color: var(--text-secondary); font-size: 0.85rem;">
                        <span style="font-size: 2rem; display: block; margin-bottom: 6px;">🩸</span>
                        No active blood requests found in your area.<br>All emergency requests will appear here.
                    </div>
                `;
                return;
            }

            requestsContainer.innerHTML = requests.map(req => {
                const urgency = req.urgency || 'Normal';
                let tagClass = 'tag-pending';
                if (urgency.toLowerCase() === 'critical') tagClass = 'tag-critical';
                else if (urgency.toLowerCase() === 'urgent') tagClass = 'tag-urgent';

                return `
                    <div class="request-item">
                        <div class="req-blood-type" style="${urgency.toLowerCase() === 'critical' ? 'color: var(--status-critical);' : ''}">${escapeHtml(req.blood_group)}</div>
                        <div class="req-info">
                            <h5>${escapeHtml(req.patient_name)}</h5>
                            <p>${escapeHtml(req.hospital_name || '')}, ${escapeHtml(req.city || '')}</p>
                        </div>
                        <div style="text-align: right;">
                            <span class="req-status-tag ${tagClass}">${escapeHtml(urgency)}</span><br>
                            <span style="font-size: 0.8rem; font-weight: 500;">${req.units} ${req.units > 1 ? 'Units' : 'Unit'}</span>
                        </div>
                        <a href="nearby-request.html" class="btn btn-primary" style="padding: 6px 12px; font-size: 0.8rem; border-radius: 6px; text-decoration: none; display: inline-block;">
                            View Details
                        </a>
                    </div>
                `;
            }).join('');
        } catch (err) {
            console.error('Error loading dashboard requests:', err);
            requestsContainer.innerHTML = `<p style="padding: 16px; color: var(--text-secondary); font-size: 0.85rem;">Unable to load requests.</p>`;
        }
    }

    // 2. Initialize Mini-Map
    async function initMiniMap() {
        if (!miniMapContainer || !window.MapService || !window.L) return;

        const loc = await MapService.getUserLocation();
        if (loc) userCoords = loc;

        miniMap = MapService.createMap('dashboard-mini-map', {
            center: [userCoords.lat, userCoords.lng],
            zoom: 11,
            scrollWheelZoom: false
        });

        // User Marker
        const userIcon = MapService.createBloodMarkerIcon(null, null, true);
        L.marker([userCoords.lat, userCoords.lng], { icon: userIcon })
            .addTo(miniMap)
            .bindPopup('<b>🎯 Your Location</b>');

        // 100 KM Radius Boundary
        MapService.addRadiusCircle(miniMap, userCoords.lat, userCoords.lng, 100);

        // Fetch Requests to plot on map
        try {
            const { data: requests } = await supabaseClient
                .from('blood_requests')
                .select('*')
                .neq('status', 'Fulfilled')
                .limit(10);

            const bloodGroupCounts = {};

            for (const req of (requests || [])) {
                const group = req.blood_group || 'O+';
                bloodGroupCounts[group] = (bloodGroupCounts[group] || 0) + 1;

                const coords = await MapService.geocodeAddress(`${req.hospital_address}, ${req.city}`);
                const icon = MapService.createBloodMarkerIcon(req.blood_group, req.urgency);
                L.marker([coords.lat, coords.lng], { icon })
                    .addTo(miniMap)
                    .bindPopup(`<b>${escapeHtml(req.patient_name)}</b> (${req.blood_group})<br>${escapeHtml(req.hospital_name)}`);
            }

            // Update Legend
            if (legendContainer) {
                const topGroups = Object.entries(bloodGroupCounts);
                if (topGroups.length === 0) {
                    legendContainer.innerHTML = `<span style="font-size: 0.8rem; color: var(--text-secondary);">100 km Active Search Radius</span>`;
                } else {
                    legendContainer.innerHTML = topGroups.slice(0, 4).map(([group, count]) => `
                        <div class="legend-item">
                            <div class="legend-dot" style="background: var(--brand-primary);"></div>
                            ${group} (${count})
                        </div>
                    `).join('');
                }
            }
        } catch (e) {
            console.warn('Mini-map data loading error:', e);
        }
    }

    // 3. Interactive Tips Carousel
    const tips = [
        { icon: '💧', title: 'Stay Hydrated', desc: 'Drink plenty of water before and after donation to maintain healthy blood volume.' },
        { icon: '🥗', title: 'Iron-Rich Foods', desc: 'Eat iron-rich foods like spinach, lentils, and beans leading up to donation day.' },
        { icon: '😴', title: 'Adequate Sleep', desc: 'Get at least 7-8 hours of sound sleep the night before donating blood.' },
        { icon: '🧘', title: 'Rest After Donating', desc: 'Relax for 10-15 minutes and enjoy a light snack immediately following donation.' }
    ];
    let currentTipIndex = 0;

    function renderTip(index) {
        currentTipIndex = (index + tips.length) % tips.length;
        const tip = tips[currentTipIndex];

        const iconEl = document.getElementById('tip-icon-display');
        const titleEl = document.getElementById('tip-title');
        const descEl = document.getElementById('tip-desc');
        const counterEl = document.getElementById('tip-counter');

        if (iconEl) iconEl.textContent = tip.icon;
        if (titleEl) titleEl.textContent = tip.title;
        if (descEl) descEl.textContent = tip.desc;
        if (counterEl) counterEl.textContent = `${currentTipIndex + 1}/${tips.length}`;

        document.querySelectorAll('#tip-dots-container .dot').forEach((dot, idx) => {
            if (idx === currentTipIndex) dot.classList.add('active');
            else dot.classList.remove('active');
        });
    }

    const prevTipBtn = document.getElementById('btn-prev-tip');
    const nextTipBtn = document.getElementById('btn-next-tip');
    if (prevTipBtn) prevTipBtn.addEventListener('click', () => renderTip(currentTipIndex - 1));
    if (nextTipBtn) nextTipBtn.addEventListener('click', () => renderTip(currentTipIndex + 1));

    document.querySelectorAll('#tip-dots-container .dot').forEach(dot => {
        dot.addEventListener('click', () => {
            const idx = parseInt(dot.dataset.index, 10);
            renderTip(idx);
        });
    });

    // 4. Refer a Friend Action
    if (referBtn) {
        referBtn.addEventListener('click', () => {
            const inviteUrl = window.location.origin + '/frontend/index.html';
            const shareText = `Join me on Blood Bridge to save lives! Donate blood and connect with emergencies in our community: ${inviteUrl}`;

            if (navigator.share) {
                navigator.share({
                    title: 'Blood Bridge - Save Lives',
                    text: shareText,
                    url: inviteUrl
                }).catch(() => {});
            } else if (navigator.clipboard) {
                navigator.clipboard.writeText(shareText);
                alert('Invite link copied to clipboard! Share it with friends and family.');
            } else {
                alert(shareText);
            }
        });
    }

    // 5. Search Bar Navigation
    if (searchInput) {
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const query = searchInput.value.trim();
                if (query) {
                    window.location.href = `find-donors.html?q=${encodeURIComponent(query)}`;
                }
            }
        });
    }

    // 6. Dynamic Eligibility from Profile
    async function checkUserEligibility() {
        if (!supabaseClient?.auth) return;
        const { data: sessionData } = await supabaseClient.auth.getSession();
        const user = sessionData?.session?.user;
        if (!user) return;

        const { data: profile } = await supabaseClient
            .from('users')
            .select('last_donation_date, full_name')
            .eq('id', user.id)
            .maybeSingle();

        const countdownEl = document.getElementById('eligibility-countdown-text');
        const summaryEl = document.getElementById('last-donation-summary-text');

        if (profile?.last_donation_date) {
            const lastDate = new Date(profile.last_donation_date);
            const daysSince = Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
            const coolingPeriodDays = 90; // Standard 90 days for whole blood
            const daysRemaining = coolingPeriodDays - daysSince;

            if (daysRemaining <= 0) {
                if (countdownEl) countdownEl.textContent = 'Eligible Now';
                if (summaryEl) summaryEl.textContent = `Last donation: ${lastDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} (Eligible to donate!)`;
            } else {
                const monthsRemaining = Math.ceil(daysRemaining / 30);
                if (countdownEl) countdownEl.textContent = `${monthsRemaining} ${monthsRemaining === 1 ? 'Month' : 'Months'}`;
                if (summaryEl) summaryEl.textContent = `Last donation: ${lastDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} (Eligible in ${daysRemaining} days)`;
            }
        } else {
            if (countdownEl) countdownEl.textContent = 'Eligible';
            if (summaryEl) summaryEl.textContent = 'No prior donations on record. You are eligible to donate today!';
        }
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

    loadDashboardRequests();
    initMiniMap();
    checkUserEligibility();
});
