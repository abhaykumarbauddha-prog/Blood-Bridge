// frontend/js/dashboard.js
/**
 * Blood Bridge - User Dashboard Controller
 * - Dynamic Time-Based Greeting
 * - User Profile Dropdown with Switch Account & Logout
 * - Notification Bell with Dropdown & Sync with Recent Notifications Card
 * - Working Topbar Search Bar
 * - Donor Stats & Badge Level Calculation (3 lives per donation, Dynamic Donor Level)
 * - Blood Requests Near You (Active & Emergency requests)
 * - Resilient Leaflet Mini-Map with GPS & Profile Fallback Coordinates
 * - Quick Actions & Refer a Friend (Link to auth.html?mode=signup)
 * - Accurate 90-day Blood Donation Eligibility Countdown
 */

document.addEventListener('DOMContentLoaded', async () => {
    const supabaseClient = window.bloodBridgeSupabase;
    const requestsContainer = document.getElementById('dashboard-requests-container');
    const notificationsContainer = document.getElementById('dashboard-notifications-container');
    const miniMapContainer = document.getElementById('dashboard-mini-map');
    const legendContainer = document.getElementById('dashboard-map-legend');
    const searchInput = document.getElementById('topbar-search-input');
    const searchBtn = document.getElementById('topbar-search-btn');
    const referBtn = document.getElementById('btn-refer-friend');
    const notifBell = document.getElementById('dashboard-notif-bell');
    const notifDropdown = document.getElementById('notif-dropdown');
    const notifDropdownList = document.getElementById('notif-dropdown-list');
    const markAllReadBtn = document.getElementById('btn-mark-all-read');
    const userProfileBtn = document.getElementById('dashboard-user-profile-btn');
    const userProfileDropdown = document.getElementById('user-profile-dropdown');
    const switchAccountBtn = document.getElementById('btn-switch-account');
    const logoutBtn = document.getElementById('btn-logout');
    const updateProfileBtn = document.getElementById('btn-update-profile');

    // Referral Modal Elements
    const referralModal = document.getElementById('referral-modal');
    const referralLinkInput = document.getElementById('referral-link-input');
    const copyReferralBtn = document.getElementById('btn-copy-referral-link');
    const copySuccessMsg = document.getElementById('referral-copy-success');
    const closeReferralModalBtn = document.getElementById('btn-close-referral-modal');

    let currentUser = null;
    let userProfile = null;
    let miniMap = null;
    let requestMarkerLayer = null;

    // ==========================================
    // 1. Time-Based Greeting
    // ==========================================
    function updateGreeting() {
        const greetingEl = document.getElementById('greeting-time-text');
        if (!greetingEl) return;
        const hour = new Date().getHours();
        let greeting = 'Good Morning';
        if (hour >= 12 && hour < 17) {
            greeting = 'Good Afternoon';
        } else if (hour >= 17 && hour < 21) {
            greeting = 'Good Evening';
        } else if (hour >= 21 || hour < 5) {
            greeting = 'Good Night';
        }
        greetingEl.textContent = `${greeting},`;
    }
    updateGreeting();

    // ==========================================
    // 2. Fetch Active Session & User Profile
    // ==========================================
    async function loadUserSession() {
        if (!supabaseClient?.auth) return null;
        try {
            const { data: sessionData } = await supabaseClient.auth.getSession();
            currentUser = sessionData?.session?.user || null;
            if (!currentUser) return null;

            const { data: profile } = await supabaseClient
                .from('users')
                .select('*')
                .eq('id', currentUser.id)
                .maybeSingle();

            userProfile = profile || null;

            // Populate user dropdown header
            const emailEl = document.getElementById('user-dropdown-email');
            const badgeEl = document.getElementById('user-dropdown-badge');
            if (emailEl) emailEl.textContent = userProfile?.email || currentUser.email || '';
            if (badgeEl) badgeEl.textContent = userProfile?.role || 'Donor';

            return currentUser;
        } catch (err) {
            console.warn('Session loading error:', err);
            return null;
        }
    }
    await loadUserSession();

    // ==========================================
    // 3. User Profile Dropdown & Switch Account / Logout
    // ==========================================
    if (userProfileBtn && userProfileDropdown) {
        userProfileBtn.dataset.bound = 'true';
        userProfileBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Close notif dropdown if open
            if (notifDropdown) notifDropdown.style.display = 'none';
            const isVisible = userProfileDropdown.style.display === 'block';
            userProfileDropdown.style.display = isVisible ? 'none' : 'block';
        });
    }

    async function handleLogout() {
        try {
            if (supabaseClient?.auth) {
                await supabaseClient.auth.signOut();
            }
        } catch (e) {
            console.warn('Sign out error:', e);
        } finally {
            localStorage.clear();
            sessionStorage.clear();
            const basePath = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/'));
            window.location.href = `${basePath ? basePath + '/' : ''}auth.html?mode=login`;
        }
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }

    if (switchAccountBtn) {
        switchAccountBtn.addEventListener('click', handleLogout);
    }

    if (updateProfileBtn) {
        updateProfileBtn.addEventListener('click', () => {
            window.location.href = 'my-profile.html';
        });
    }

    // ==========================================
    // 4. Notification Bell & Recent Notifications Synchronization
    // ==========================================
    const iconForNotif = (type) => {
        switch (type) {
            case 'request': return ['🩸', 'icon-red'];
            case 'response': return ['👤', 'icon-green'];
            case 'badge_earned': return ['🏆', 'icon-purple'];
            case 'system': return ['✔', 'icon-green'];
            default: return ['🔔', 'icon-red'];
        }
    };

    async function loadNotifications() {
        if (!supabaseClient) return;

        let notifications = [];
        try {
            const { data, error } = await supabaseClient
                .from('notifications')
                .select('id, type, title, body, link, read_at, created_at')
                .order('created_at', { ascending: false })
                .limit(8);

            if (!error && Array.isArray(data)) {
                notifications = data;
            }
        } catch (e) {
            console.warn('Error loading notifications:', e);
        }

        renderDropdownNotifications(notifications);
        renderCardNotifications(notifications);
        if (window.BloodMatchData?.syncUnreadBadges) {
            BloodMatchData.syncUnreadBadges();
        }
    }

    function renderDropdownNotifications(items) {
        if (!notifDropdownList) return;
        if (!items || items.length === 0) {
            notifDropdownList.innerHTML = `
                <div style="padding: 24px; text-align: center; color: var(--text-secondary); font-size: 0.85rem;">
                    No notifications yet.
                </div>
            `;
            return;
        }

        notifDropdownList.innerHTML = items.map(item => {
            const [icon, iconClass] = iconForNotif(item.type);
            const isUnread = !item.read_at;
            const timeAgo = formatTimeAgo(item.created_at);

            return `
                <div class="dropdown-item ${isUnread ? 'unread' : ''}" data-id="${item.id}" data-link="${item.link || ''}">
                    <div class="notif-icon-circle ${iconClass}" style="flex-shrink: 0;">${icon}</div>
                    <div style="flex: 1; min-width: 0;">
                        <h5 style="font-size: 0.88rem; font-weight: ${isUnread ? '700' : '600'}; margin-bottom: 2px; color: var(--text-dark);">${escapeHtml(item.title)}</h5>
                        <p style="font-size: 0.78rem; color: var(--text-secondary); line-height: 1.35; margin-bottom: 4px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${escapeHtml(item.body)}</p>
                        <span style="font-size: 0.72rem; color: var(--text-secondary);">⏱️ ${timeAgo}</span>
                    </div>
                    ${isUnread ? '<div style="width: 8px; height: 8px; border-radius: 50%; background: var(--brand-primary); margin-top: 6px;"></div>' : ''}
                </div>
            `;
        }).join('');

        // Attach click handlers
        notifDropdownList.querySelectorAll('.dropdown-item').forEach(el => {
            el.addEventListener('click', async () => {
                const id = el.dataset.id;
                const link = el.dataset.link;
                if (id) await markNotificationRead(id);
                if (link && link !== 'null' && link.trim() !== '') {
                    window.location.href = link;
                }
            });
        });
    }

    function renderCardNotifications(items) {
        if (!notificationsContainer) return;
        if (!items || items.length === 0) {
            notificationsContainer.innerHTML = `
                <div style="padding: 24px 12px; color: var(--text-secondary); text-align: center; font-size: 0.88rem;">
                    <span style="font-size: 1.8rem; display: block; margin-bottom: 6px;">🔔</span>
                    No notifications available yet.
                </div>
            `;
            return;
        }

        notificationsContainer.innerHTML = items.slice(0, 5).map(item => {
            const [icon, iconClass] = iconForNotif(item.type);
            const isUnread = !item.read_at;
            const timeAgo = formatTimeAgo(item.created_at);

            return `
                <div class="notif-item" style="padding: 10px 0; border-bottom: 1px solid var(--border-light); cursor: pointer;" data-id="${item.id}" data-link="${item.link || ''}">
                    <div class="notif-icon-circle ${iconClass}">${icon}</div>
                    <div class="notif-content" style="flex: 1;">
                        <h5 style="font-weight: ${isUnread ? '700' : '600'};">${escapeHtml(item.title)} ${isUnread ? '<span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:var(--brand-primary); vertical-align:middle; margin-left:4px;"></span>' : ''}</h5>
                        <p>${escapeHtml(item.body)}</p>
                    </div>
                    <div class="notif-time">${timeAgo}</div>
                </div>
            `;
        }).join('');

        notificationsContainer.querySelectorAll('.notif-item').forEach(el => {
            el.addEventListener('click', async () => {
                const id = el.dataset.id;
                const link = el.dataset.link;
                if (id) await markNotificationRead(id);
                if (link && link !== 'null' && link.trim() !== '') {
                    window.location.href = link;
                }
            });
        });
    }

    async function markNotificationRead(id) {
        if (!supabaseClient || !id) return;
        try {
            await supabaseClient
                .from('notifications')
                .update({ read_at: new Date().toISOString() })
                .eq('id', id);
            await loadNotifications();
        } catch (e) {
            console.warn('Mark notification read failed:', e);
        }
    }

    if (notifBell && notifDropdown) {
        notifBell.addEventListener('click', (e) => {
            e.stopPropagation();
            // Close user menu dropdown if open
            if (userProfileDropdown) userProfileDropdown.style.display = 'none';
            const isVisible = notifDropdown.style.display === 'flex';
            notifDropdown.style.display = isVisible ? 'none' : 'flex';
            if (!isVisible) {
                loadNotifications();
            }
        });
    }

    if (markAllReadBtn) {
        markAllReadBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!supabaseClient) return;
            try {
                await supabaseClient
                    .from('notifications')
                    .update({ read_at: new Date().toISOString() })
                    .is('read_at', null);
                await loadNotifications();
            } catch (err) {
                console.warn('Mark all read error:', err);
            }
        });
    }

    // Close floating dropdowns on click outside
    document.addEventListener('click', (e) => {
        if (notifDropdown && notifDropdown.style.display === 'flex' && !notifDropdown.contains(e.target) && !notifBell.contains(e.target)) {
            notifDropdown.style.display = 'none';
        }
        if (userProfileDropdown && userProfileDropdown.style.display === 'block' && !userProfileDropdown.contains(e.target) && !userProfileBtn.contains(e.target)) {
            userProfileDropdown.style.display = 'none';
        }
    });

    // ==========================================
    // 5. Search Bar Navigation
    // ==========================================
    function executeSearch() {
        if (!searchInput) return;
        const query = searchInput.value.trim();
        if (!query) {
            searchInput.focus();
            return;
        }
        window.location.href = `find-donors.html?q=${encodeURIComponent(query)}`;
    }

    if (searchInput) {
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') executeSearch();
        });
    }

    if (searchBtn) {
        searchBtn.addEventListener('click', executeSearch);
    }

    // ==========================================
    // 6. Blood Requests Near You (Card 3)
    // ==========================================
    async function loadDashboardRequests() {
        if (!requestsContainer || !supabaseClient) return;

        try {
            // Load open blood requests ordered by creation
            const { data: requests, error } = await supabaseClient
                .from('blood_requests')
                .select('*')
                .eq('status', 'open')
                .order('created_at', { ascending: false })
                .limit(4);

            if (error) throw error;

            if (!requests || requests.length === 0) {
                requestsContainer.innerHTML = `
                    <div style="text-align: center; padding: 28px 12px; color: var(--text-secondary); font-size: 0.85rem;">
                        <span style="font-size: 2rem; display: block; margin-bottom: 6px;">🩸</span>
                        No active emergency blood requests right now.<br>When new requests are created, they will appear here.
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
                        <div class="req-blood-type" style="${urgency.toLowerCase() === 'critical' ? 'color: var(--status-critical); font-weight: 700;' : ''}">${escapeHtml(req.blood_group)}</div>
                        <div class="req-info">
                            <h5>${escapeHtml(req.patient_name || 'Emergency Patient')}</h5>
                            <p>${escapeHtml(req.hospital_name || 'Hospital')}, ${escapeHtml(req.city || '')}</p>
                        </div>
                        <div style="text-align: right;">
                            <span class="req-status-tag ${tagClass}">${escapeHtml(urgency)}</span><br>
                            <span style="font-size: 0.8rem; font-weight: 500;">${req.units || 1} ${req.units > 1 ? 'Units' : 'Unit'}</span>
                        </div>
                        <a href="nearby-request.html?id=${encodeURIComponent(req.id)}" class="btn btn-primary" style="padding: 6px 12px; font-size: 0.8rem; border-radius: 6px; text-decoration: none; display: inline-block;">
                            View Details
                        </a>
                    </div>
                `;
            }).join('');
        } catch (err) {
            console.error('Error loading dashboard requests:', err);
            requestsContainer.innerHTML = `<p style="padding: 16px; color: var(--text-secondary); font-size: 0.85rem; text-align: center;">Unable to load requests.</p>`;
        }
    }

    // ==========================================
    // 7. Interactive Mini-Map (Resilient with Fallback Coordinates)
    // ==========================================
    async function initMiniMap() {
        if (!miniMapContainer || !window.MapService || !window.L) return;

        let centerCoords = null;
        let isLiveGps = false;

        // Try getting GPS with timeout
        try {
            const loc = await MapService.getUserLocation();
            if (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng)) {
                centerCoords = loc;
                isLiveGps = true;
            }
        } catch (e) {
            console.warn('Geolocation probe skipped:', e);
        }

        // Fallback 1: Profile coordinates if saved
        if (!centerCoords && userProfile?.latitude && userProfile?.longitude) {
            const pLat = Number(userProfile.latitude);
            const pLng = Number(userProfile.longitude);
            if (Number.isFinite(pLat) && Number.isFinite(pLng)) {
                centerCoords = { lat: pLat, lng: pLng };
            }
        }

        // Fallback 2: Default regional center (Lucknow / Northern India center: 26.8467, 80.9462)
        if (!centerCoords) {
            centerCoords = { lat: 26.8467, lng: 80.9462 };
        }

        try {
            miniMap = MapService.createMap('dashboard-mini-map', {
                center: [centerCoords.lat, centerCoords.lng],
                zoom: isLiveGps ? 11 : 9,
                scrollWheelZoom: false
            });

            if (!miniMap) return;

            // Fix Leaflet sizing in flex/grid
            setTimeout(() => {
                if (miniMap) miniMap.invalidateSize();
            }, 300);

            requestMarkerLayer = window.L.markerClusterGroup ? L.markerClusterGroup() : L.layerGroup();
            requestMarkerLayer.addTo(miniMap);

            // User / Center Marker
            const userIcon = MapService.createBloodMarkerIcon(null, null, isLiveGps);
            L.marker([centerCoords.lat, centerCoords.lng], { icon: userIcon })
                .addTo(miniMap)
                .bindPopup(`<b>${isLiveGps ? '🎯 Your Location' : '📍 Search Center'}</b><br>${userProfile?.city || 'Regional Center'}`);

            // 100 KM Radius Boundary
            MapService.addRadiusCircle(miniMap, centerCoords.lat, centerCoords.lng, 100);

            // Fetch and plot open requests
            const { data: requests } = await supabaseClient
                .from('blood_requests')
                .select('*')
                .eq('status', 'open')
                .limit(20);

            const bloodGroupCounts = {};
            let plottedCount = 0;

            for (const req of (requests || [])) {
                const reqLat = Number(req.latitude);
                const reqLng = Number(req.longitude);
                if (!Number.isFinite(reqLat) || !Number.isFinite(reqLng)) continue;

                const within100 = BloodMatchData?.withinRadius
                    ? BloodMatchData.withinRadius(centerCoords, { lat: reqLat, lng: reqLng }, 100)
                    : true;

                if (!within100) continue;

                plottedCount++;
                const group = req.blood_group || 'Blood';
                bloodGroupCounts[group] = (bloodGroupCounts[group] || 0) + 1;

                const icon = MapService.createBloodMarkerIcon(req.blood_group, req.urgency);
                L.marker([reqLat, reqLng], { icon })
                    .addTo(requestMarkerLayer || miniMap)
                    .bindPopup(`<b>${escapeHtml(req.patient_name || 'Emergency')}</b> (${escapeHtml(req.blood_group)})<br>${escapeHtml(req.hospital_name || '')}<br><a href="nearby-request.html?id=${encodeURIComponent(req.id)}" style="color: #E60023; font-weight: 600;">View Details →</a>`);
            }

            // Update Legend
            if (legendContainer) {
                const topGroups = Object.entries(bloodGroupCounts);
                if (topGroups.length === 0) {
                    legendContainer.innerHTML = `<span style="font-size: 0.8rem; color: var(--text-secondary);">${plottedCount > 0 ? plottedCount + ' requests in range' : '100 km Search Radius Active'}</span>`;
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
            console.warn('Mini-map initialization error:', e);
        }
    }

    // ==========================================
    // 8. User Stats & Donation Updates (Card 2) & Upcoming Eligibility
    // ==========================================
    async function loadDonorStatsAndEligibility() {
        if (!currentUser) return;
        try {
            if (window.BloodMatchData?.getDonorStats && window.BloodMatchData?.renderDonorStats) {
                const stats = await BloodMatchData.getDonorStats(currentUser.id);
                BloodMatchData.renderDonorStats(stats);
            }
        } catch (e) {
            console.warn('Dashboard donor stats load error:', e);
        }
    }

    // ==========================================
    // 9. Refer a Friend Modal & Link Generator
    // ==========================================
    function getReferralLink() {
        const basePath = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/'));
        const prefix = basePath ? basePath + '/' : '';
        return `${window.location.origin}/${prefix}auth.html?mode=signup`;
    }

    if (referBtn && referralModal) {
        referBtn.addEventListener('click', () => {
            const signupLink = getReferralLink();
            if (referralLinkInput) referralLinkInput.value = signupLink;
            if (copySuccessMsg) copySuccessMsg.style.display = 'none';
            referralModal.style.display = 'flex';
        });
    }

    if (copyReferralBtn && referralLinkInput) {
        copyReferralBtn.addEventListener('click', async () => {
            const link = referralLinkInput.value;
            try {
                if (navigator.clipboard) {
                    await navigator.clipboard.writeText(link);
                } else {
                    referralLinkInput.select();
                    document.execCommand('copy');
                }
                if (copySuccessMsg) copySuccessMsg.style.display = 'block';
            } catch (err) {
                console.warn('Copy link error:', err);
            }
        });
    }

    if (closeReferralModalBtn && referralModal) {
        closeReferralModalBtn.addEventListener('click', () => {
            referralModal.style.display = 'none';
        });
    }

    if (referralModal) {
        referralModal.addEventListener('click', (e) => {
            if (e.target === referralModal) {
                referralModal.style.display = 'none';
            }
        });
    }

    // ==========================================
    // 10. Interactive Tips Carousel
    // ==========================================
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

    // Helper functions
    function formatTimeAgo(isoString) {
        if (!isoString) return 'Just now';
        const date = new Date(isoString);
        const sec = Math.floor((Date.now() - date.getTime()) / 1000);
        if (sec < 60) return 'Just now';
        const min = Math.floor(sec / 60);
        if (min < 60) return `${min}m ago`;
        const hr = Math.floor(min / 60);
        if (hr < 24) return `${hr}h ago`;
        const day = Math.floor(hr / 24);
        if (day < 7) return `${day}d ago`;
        return date.toLocaleDateString();
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

    // Initialize all components
    loadDashboardRequests();
    loadNotifications();
    initMiniMap();
    loadDonorStatsAndEligibility();
});
