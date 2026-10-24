// frontend/js/profile-sync.js
/**
 * Blood Bridge - Universal Topbar, Navigation & User Account Controller
 * Ensures identical, reliable behavior across ALL pages:
 * 1. User Profile Dropdown (My Profile, Donation History, Settings, Switch Account, Logout)
 * 2. Universal Search Bar (Searches donors/hospitals or redirects to find-donors.html)
 * 3. Notification Badges & Navigation
 * 4. Profile Sync (Name, Avatar, Blood Group, Availability)
 */

document.addEventListener('DOMContentLoaded', async () => {
    const client = window.bloodBridgeSupabase;
    if (!client?.auth) return;

    // 1. Inject Universal CSS for Dropdown & Search if not already present
    if (!document.getElementById('universal-topbar-styles')) {
        const style = document.createElement('style');
        style.id = 'universal-topbar-styles';
        style.textContent = `
            .topbar {
                position: sticky !important;
                top: 0 !important;
                z-index: 10000 !important;
            }
            .user-menu-wrapper, .notif-wrapper {
                position: relative !important;
                display: inline-flex !important;
                align-items: center !important;
                z-index: 10001 !important;
            }
            .user-profile-mini {
                cursor: pointer !important;
                user-select: none !important;
                display: flex !important;
                align-items: center !important;
                gap: 10px !important;
                padding: 4px 8px !important;
                border-radius: 24px !important;
                transition: background-color 0.2s ease !important;
            }
            .user-profile-mini:hover {
                background-color: rgba(0, 0, 0, 0.04) !important;
            }
            .search-bar {
                display: flex;
                align-items: center;
                gap: 10px;
                border: 1px solid transparent;
                transition: border-color 0.2s, background-color 0.2s;
            }
            .search-bar:focus-within {
                border-color: #E60023 !important;
                box-shadow: 0 0 0 3px rgba(230, 0, 35, 0.1) !important;
            }
            .search-bar span {
                cursor: pointer;
                user-select: none;
                transition: transform 0.15s ease;
            }
            .search-bar span:hover {
                transform: scale(1.15);
            }
            .user-dropdown-panel {
                position: absolute !important;
                right: 0 !important;
                top: calc(100% + 10px) !important;
                width: 290px !important;
                background: #ffffff !important;
                border-radius: 14px !important;
                box-shadow: 0 14px 36px rgba(0, 0, 0, 0.16), 0 4px 12px rgba(0, 0, 0, 0.08) !important;
                border: 1px solid #E4E7EC !important;
                z-index: 10002 !important;
                overflow: hidden !important;
                padding: 6px 0 !important;
                animation: universalDropdownIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
                text-align: left !important;
            }
            .leaflet-container {
                z-index: 1 !important;
            }
            .map-col {
                z-index: 1 !important;
            }
            .map-overlay {
                z-index: 500 !important;
            }
            .leaflet-popup-pane {
                z-index: 800 !important;
            }
            .leaflet-popup {
                z-index: 801 !important;
            }
            .modal-overlay, .modal {
                z-index: 20000 !important;
            }
            @keyframes universalDropdownIn {
                from { opacity: 0; transform: translateY(-8px) scale(0.97); }
                to { opacity: 1; transform: translateY(0) scale(1); }
            }
            .user-dropdown-header {
                padding: 14px 18px !important;
                display: flex !important;
                align-items: center !important;
                gap: 12px !important;
                border-bottom: 1px solid #E4E7EC !important;
                background: #FAFBFC !important;
            }
            .user-dropdown-avatar {
                width: 44px !important;
                height: 44px !important;
                border-radius: 50% !important;
                object-fit: cover !important;
                border: 2px solid #E60023 !important;
                flex-shrink: 0 !important;
            }
            .user-dropdown-info {
                flex: 1 !important;
                min-width: 0 !important;
            }
            .user-dropdown-info h5 {
                font-size: 0.95rem !important;
                font-weight: 700 !important;
                margin: 0 0 2px 0 !important;
                color: #101828 !important;
                white-space: nowrap !important;
                overflow: hidden !important;
                text-overflow: ellipsis !important;
            }
            .user-dropdown-email {
                font-size: 0.75rem !important;
                color: #475467 !important;
                margin: 0 0 4px 0 !important;
                white-space: nowrap !important;
                overflow: hidden !important;
                text-overflow: ellipsis !important;
            }
            .user-role-badge {
                display: inline-block !important;
                background: #FFF0F2 !important;
                color: #E60023 !important;
                font-size: 0.7rem !important;
                font-weight: 700 !important;
                padding: 2px 8px !important;
                border-radius: 10px !important;
            }
            .user-dropdown-divider {
                height: 1px !important;
                background: #E4E7EC !important;
                margin: 6px 0 !important;
            }
            .user-dropdown-item {
                display: flex !important;
                align-items: center !important;
                gap: 12px !important;
                padding: 10px 18px !important;
                color: #101828 !important;
                text-decoration: none !important;
                font-size: 0.88rem !important;
                font-weight: 500 !important;
                transition: background-color 0.15s !important;
                width: 100% !important;
                background: none !important;
                border: none !important;
                text-align: left !important;
                cursor: pointer !important;
                box-sizing: border-box !important;
            }
            .user-dropdown-item:hover {
                background-color: #F5F7FA !important;
            }
            .user-dropdown-item.text-danger {
                color: #E60023 !important;
                font-weight: 600 !important;
            }
            .user-dropdown-item.text-danger:hover {
                background-color: #FFF0F2 !important;
            }
        `;
        document.head.appendChild(style);
    }

    // 2. Fetch User Session & Profile
    let user = null;
    let profile = null;
    try {
        const { data: sessionData } = await client.auth.getSession();
        user = sessionData?.session?.user || null;
        if (!user) return;

        let { data: userRow, error: profileError } = await client
            .from('users')
            .select('*')
            .eq('id', user.id)
            .maybeSingle();

        if (profileError && /column/i.test(profileError.message || '')) {
            const fallback = await client
                .from('users')
                .select('full_name, role, blood_group, phone, city, state, availability_status, is_available')
                .eq('id', user.id)
                .maybeSingle();
            profile = fallback.data;
        } else {
            profile = userRow;
        }
    } catch (e) {
        console.warn('Profile sync session fetch error:', e);
    }

    const name = profile?.full_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User';
    const email = profile?.email || user?.email || '';
    const role = profile?.role || 'Donor';
    const avatar = profile?.avatar_url || 'assets/profile-placeholder.svg';
    const location = [profile?.city, profile?.state].filter(Boolean).join(', ') || 'Location not set';
    const bloodGroup = profile?.blood_group || 'Not set';
    const phone = profile?.phone || 'Not set';
    const availability = profile?.is_available ? 'Available' : 'Unavailable';

    // 3. Sync text elements & avatars across the active page
    document.querySelectorAll('[data-profile-avatar], .user-profile-mini img, #topbar-avatar').forEach((img) => {
        img.src = avatar;
        img.alt = name;
    });
    document.querySelectorAll('[data-profile-name], .user-profile-mini h5, #topbar-name').forEach((el) => {
        el.textContent = name;
    });
    document.querySelectorAll('[data-profile-role], .user-profile-mini p, #topbar-role').forEach((el) => {
        el.textContent = role;
    });
    document.querySelectorAll('[data-profile-welcome]').forEach((el) => {
        el.textContent = `${name} 👋`;
    });
    document.querySelectorAll('[data-profile-card-name]').forEach((el) => {
        el.textContent = `${name} ✔`;
    });
    document.querySelectorAll('[data-profile-card-role]').forEach((el) => {
        el.textContent = role;
    });
    document.querySelectorAll('[data-profile-blood], [data-profile-blood-stat]').forEach((el) => {
        if (el.matches('[data-profile-blood-stat]')) el.textContent = bloodGroup;
        else el.textContent = `🩸 ${bloodGroup}`;
    });
    document.querySelectorAll('[data-profile-phone]').forEach((el) => {
        el.textContent = `📞 ${phone}`;
    });
    document.querySelectorAll('[data-profile-location]').forEach((el) => {
        el.textContent = `📍 ${location}`;
    });
    document.querySelectorAll('[data-profile-availability]').forEach((el) => {
        el.textContent = `${availability} to Donate`;
    });

    const emailEl = document.getElementById('user-dropdown-email');
    if (emailEl) emailEl.textContent = email;
    const badgeEl = document.getElementById('user-dropdown-badge');
    if (badgeEl) badgeEl.textContent = role;

    // 4. Universal Logout / Switch Account Handler
    async function performLogout() {
        try {
            await client.auth.signOut();
        } catch (e) {
            console.warn('Logout signOut error:', e);
        } finally {
            localStorage.clear();
            sessionStorage.clear();
            const basePath = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/'));
            const prefix = basePath ? basePath + '/' : '';
            window.location.href = `${prefix}auth.html?mode=login`;
        }
    }

    // 5. Mount or Enhance User Profile Dropdown on EVERY page with .user-profile-mini
    const userProfileElements = document.querySelectorAll('.user-profile-mini');
    userProfileElements.forEach((userMini) => {
        // Ensure parent wrapper is relative
        let wrapper = userMini.closest('.user-menu-wrapper');
        if (!wrapper) {
            wrapper = document.createElement('div');
            wrapper.className = 'user-menu-wrapper';
            userMini.parentNode.insertBefore(wrapper, userMini);
            wrapper.appendChild(userMini);
        }

        // Check if dropdown panel already exists in wrapper or on page
        let dropdown = wrapper.querySelector('.user-dropdown-panel') || document.getElementById('user-profile-dropdown');
        if (!dropdown) {
            dropdown = document.createElement('div');
            dropdown.id = 'user-profile-dropdown';
            dropdown.className = 'user-dropdown-panel';
            dropdown.style.display = 'none';
            dropdown.innerHTML = `
                <div class="user-dropdown-header">
                    <img src="${avatar}" alt="${name}" class="user-dropdown-avatar" data-profile-avatar>
                    <div class="user-dropdown-info">
                        <h5 data-profile-name>${name}</h5>
                        <p class="user-dropdown-email" id="user-dropdown-email">${email}</p>
                        <span class="user-role-badge" id="user-dropdown-badge">${role}</span>
                    </div>
                </div>
                <a href="my-profile.html" class="user-dropdown-item">
                    <span>👤</span> My Profile
                </a>
                <a href="donation-history.html" class="user-dropdown-item">
                    <span>🕒</span> Donation History
                </a>
                <a href="settings.html" class="user-dropdown-item">
                    <span>⚙️</span> Account Settings
                </a>
                <div class="user-dropdown-divider"></div>
                <button type="button" class="user-dropdown-item btn-dropdown-action" id="btn-switch-account">
                    <span>🔄</span> Switch Account
                </button>
                <button type="button" class="user-dropdown-item btn-dropdown-action text-danger" id="btn-logout">
                    <span>🚪</span> Logout
                </button>
            `;
            wrapper.appendChild(dropdown);
        }

        // Toggle handler
        if (!userMini.dataset.bound) {
            userMini.dataset.bound = 'true';
            userMini.addEventListener('click', (e) => {
                e.stopPropagation();
                // Close notification dropdown if open
                const notifDropdown = document.getElementById('notif-dropdown');
                if (notifDropdown) notifDropdown.style.display = 'none';

                const isShown = dropdown.style.display === 'block';
                dropdown.style.display = isShown ? 'none' : 'block';
            });
        }

        // Bind actions inside dropdown
        const switchBtn = dropdown.querySelector('#btn-switch-account');
        if (switchBtn && !switchBtn.dataset.bound) {
            switchBtn.dataset.bound = 'true';
            switchBtn.addEventListener('click', performLogout);
        }
        const logoutBtn = dropdown.querySelector('#btn-logout');
        if (logoutBtn && !logoutBtn.dataset.bound) {
            logoutBtn.dataset.bound = 'true';
            logoutBtn.addEventListener('click', performLogout);
        }
    });

    // Close user dropdown on outside click
    document.addEventListener('click', (e) => {
        document.querySelectorAll('.user-dropdown-panel').forEach((dp) => {
            if (dp.style.display === 'block' && !dp.contains(e.target)) {
                const trigger = dp.closest('.user-menu-wrapper')?.querySelector('.user-profile-mini');
                if (!trigger || !trigger.contains(e.target)) {
                    dp.style.display = 'none';
                }
            }
        });
    });

    // 6. Universal Topbar Searchbar across ALL pages
    const searchBars = document.querySelectorAll('.search-bar');
    searchBars.forEach((bar) => {
        const input = bar.querySelector('input');
        const icon = bar.querySelector('span') || bar.querySelector('.search-icon-btn');
        if (!input) return;

        function handleSearch() {
            const query = input.value.trim();
            if (!query) {
                input.focus();
                return;
            }
            const isFindDonors = window.location.pathname.endsWith('find-donors.html');
            if (isFindDonors) {
                // If on find-donors.html and function exists, it filters dynamically
                const event = new Event('input', { bubbles: true });
                input.dispatchEvent(event);
            } else {
                window.location.href = `find-donors.html?q=${encodeURIComponent(query)}`;
            }
        }

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleSearch();
            }
        });

        if (icon) {
            icon.addEventListener('click', (e) => {
                e.preventDefault();
                handleSearch();
            });
        }
    });

    // 7. Universal Notification Badges Sync
    if (window.BloodMatchData?.syncUnreadBadges) {
        BloodMatchData.syncUnreadBadges();
    }

    // 8. Universal Donor Stats Sync across ALL pages
    if (window.BloodMatchData?.getDonorStats && window.BloodMatchData?.renderDonorStats && user?.id) {
        try {
            const stats = await BloodMatchData.getDonorStats(user.id);
            BloodMatchData.renderDonorStats(stats);
        } catch (e) {
            console.warn('Universal donor stats sync error:', e);
        }
    }
});
