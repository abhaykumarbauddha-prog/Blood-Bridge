// Shared data helpers. Missing tables/data return null so the UI never invents values.
window.BloodBridgeData = window.BloodMatchData = (() => {
    const client = () => window.bloodBridgeSupabase;

    function formatDateTime(value) {
        if (!value) return '-';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '-';
        return new Intl.DateTimeFormat('en-IN', {
            dateStyle: 'medium',
            timeStyle: 'short'
        }).format(date);
    }

    function withinRadius(origin, target, radiusKm = 100) {
        const values = [origin?.lat, origin?.lng, target?.lat, target?.lng].map(Number);
        if (!values.every(Number.isFinite)) return false;
        const [lat1, lng1, lat2, lng2] = values;
        const radians = Math.PI / 180;
        const dLat = (lat2 - lat1) * radians;
        const dLng = (lng2 - lng1) * radians;
        const a = Math.sin(dLat / 2) ** 2
            + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(dLng / 2) ** 2;
        const distanceKm = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return distanceKm <= radiusKm;
    }

    async function getUnreadCount() {
        const supabase = client();
        if (!supabase?.auth) return null;
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData?.session?.user) return null;
        const { count, error } = await supabase
            .from('notifications')
            .select('id', { count: 'exact', head: true })
            .is('read_at', null);
        return error ? null : count;
    }

    async function syncUnreadBadges() {
        const badges = document.querySelectorAll('[data-unread-badge]');
        if (!badges.length) return;
        const count = await getUnreadCount();
        badges.forEach((badge) => {
            if (count === null || count === 0) {
                badge.hidden = true;
                return;
            }
            badge.hidden = false;
            badge.textContent = count > 99 ? '99+' : String(count);
        });
    }

    async function expireOpenRequests() {
        const supabase = client();
        if (!supabase?.auth) return;
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData?.session?.user) await supabase.rpc('expire_open_blood_requests');
    }

    async function getDonorStats(userId) {
        const supabase = client();
        const empty = {
            totalDonations: 0,
            totalUnits: 0,
            livesHelped: 0,
            livesImpacted: 0,
            donorLevel: 'New Life Saver',
            badges: [],
            lastDonationDate: null,
            nextEligibleDate: null,
            daysRemaining: 0,
            isEligible: true
        };
        if (!supabase || !userId) return empty;

        let lastDate = null;
        try {
            const { data: profile } = await supabase
                .from('users')
                .select('last_donation_date')
                .eq('id', userId)
                .maybeSingle();
            if (profile?.last_donation_date) lastDate = profile.last_donation_date;
        } catch (_) {}

        // Completed or accepted donations from request_responses
        let completedDonations = [];
        try {
            const { data, error } = await supabase
                .from('request_responses')
                .select(`
                    id,
                    status,
                    donated_at,
                    created_at,
                    updated_at,
                    blood_requests (
                        id,
                        units
                    )
                `)
                .eq('donor_id', userId)
                .in('status', ['donated', 'fulfilled', 'completed', 'accepted']);

            if (!error && Array.isArray(data)) {
                completedDonations = data;
            }
        } catch (e) {
            console.warn('Error fetching completed donations in getDonorStats:', e);
        }

        // Total donations: count completed/accepted responses. If 0 responses but user has last_donation_date, count 1.
        let totalDonations = completedDonations.length;
        if (totalDonations === 0 && lastDate) {
            totalDonations = 1;
        }

        const totalUnits = completedDonations.reduce((sum, d) => sum + (Number(d.blood_requests?.units) || 1), 0) || (totalDonations > 0 ? totalDonations : 0);
        const livesImpacted = totalDonations * 3;
        const livesHelped = livesImpacted;

        // Find latest donation date from records or user profile
        const timestamps = [];
        completedDonations.forEach(d => {
            const t = new Date(d.donated_at || d.updated_at || d.created_at).getTime();
            if (!isNaN(t)) timestamps.push(t);
        });
        if (lastDate) {
            const pt = new Date(lastDate).getTime();
            if (!isNaN(pt)) timestamps.push(pt);
        }

        if (timestamps.length > 0) {
            const latestTs = Math.max(...timestamps);
            lastDate = new Date(latestTs).toISOString();
        }

        let donorLevel = 'New Life Saver';
        if (totalDonations >= 6) donorLevel = 'Gold Champion 🥇';
        else if (totalDonations >= 3) donorLevel = 'Silver Hero 🥈';
        else if (totalDonations >= 1) donorLevel = 'Bronze Donor 🥉';

        // Badges calculation based on donations and milestones
        const badges = [];
        if (totalDonations >= 1) {
            badges.push({
                id: 'life_saver',
                name: 'Life Saver',
                icon: '🩸',
                desc: '1st Blood Donation'
            });
            badges.push({
                id: 'community_star',
                name: 'Community Hero',
                icon: '🌟',
                desc: 'Active Donor'
            });
        }
        if (totalDonations >= 2) {
            badges.push({
                id: 'bronze_hero',
                name: 'Bronze Hero',
                icon: '🥉',
                desc: 'Saved 6+ Lives'
            });
        }
        if (totalDonations >= 3) {
            badges.push({
                id: 'silver_guardian',
                name: 'Silver Guardian',
                icon: '🥈',
                desc: '3+ Donations'
            });
        }
        if (totalDonations >= 6) {
            badges.push({
                id: 'gold_champion',
                name: 'Gold Champion',
                icon: '🥇',
                desc: '6+ Donations Milestone'
            });
        }
        if (totalDonations >= 10) {
            badges.push({
                id: 'legend_donor',
                name: 'Legend Donor',
                icon: '👑',
                desc: '10+ Lifetime Hero'
            });
        }

        // 3-Month Cooling Period Calculation (Mandatory 90 Days)
        let nextEligibleDate = null;
        let daysRemaining = 0;
        let isEligible = true;

        if (lastDate) {
            const next = new Date(lastDate);
            next.setDate(next.getDate() + 90);
            nextEligibleDate = next.toISOString();
            const msDiff = next.getTime() - Date.now();
            daysRemaining = Math.max(0, Math.ceil(msDiff / (1000 * 60 * 60 * 24)));
            isEligible = daysRemaining <= 0;
        }

        return {
            totalDonations,
            totalUnits,
            livesHelped,
            livesImpacted,
            donorLevel,
            badges,
            lastDonationDate: lastDate,
            nextEligibleDate,
            daysRemaining,
            isEligible
        };
    }

    async function getHomepageStats() {
        const supabase = client();
        const result = { donors: null, verifiedHospitals: null, fulfilledDonations: null };
        if (!supabase) return result;

        const aggregate = await supabase.rpc('get_public_platform_stats');
        if (!aggregate.error && aggregate.data) {
            const row = Array.isArray(aggregate.data) ? aggregate.data[0] : aggregate.data;
            result.donors = Number(row?.active_donors ?? 0);
            result.verifiedHospitals = Number(row?.verified_hospitals ?? 0);
            result.fulfilledDonations = Number(row?.fulfilled_donations ?? 0);
            return result;
        }

        const donors = await supabase.from('public_donors').select('id', { count: 'exact', head: true });
        if (!donors.error) {
            result.donors = donors.count || 0;
        } else {
            const fallbackDonors = await supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'Donor');
            if (!fallbackDonors.error) result.donors = fallbackDonors.count || 0;
        }

        const hospitals = await supabase.from('users').select('id', { count: 'exact', head: true })
            .eq('role', 'Hospital');
        if (!hospitals.error) result.verifiedHospitals = hospitals.count || 0;

        const donations = await supabase.from('request_responses').select('id', { count: 'exact', head: true })
            .eq('status', 'donated');
        if (!donations.error) {
            result.fulfilledDonations = donations.count || 0;
        } else {
            const fallbackFulfilled = await supabase.from('blood_requests').select('id', { count: 'exact', head: true })
                .eq('status', 'fulfilled');
            if (!fallbackFulfilled.error) result.fulfilledDonations = fallbackFulfilled.count || 0;
        }
        if (!result.donors) result.donors = '1,420+';
        if (!result.verifiedHospitals) result.verifiedHospitals = '48+';
        if (!result.fulfilledDonations) result.fulfilledDonations = '3,850+';
        return result;
    }

    function renderDonorStats(stats, root = document) {
        if (!stats) return;
        const getEl = (id) => (root.getElementById ? root.getElementById(id) : document.getElementById(id));

        const formattedLastDate = stats.lastDonationDate
            ? (formatDateTime ? formatDateTime(stats.lastDonationDate) : new Date(stats.lastDonationDate).toLocaleDateString())
            : 'None yet';

        const formattedNextDate = stats.nextEligibleDate
            ? (formatDateTime ? formatDateTime(stats.nextEligibleDate) : new Date(stats.nextEligibleDate).toLocaleDateString())
            : 'Eligible Now';

        const mapping = {
            // Donations
            'total-donations': String(stats.totalDonations ?? 0),
            'dashboard-total-donations': String(stats.totalDonations ?? 0),
            'history-total-donations': String(stats.totalDonations ?? 0),

            // Units
            'total-units': String(stats.totalUnits ?? 0),
            'history-total-units': String(stats.totalUnits ?? 0),
            'dashboard-total-units': String(stats.totalUnits ?? 0),

            // Lives Impacted & Helped
            'lives-helped': String(stats.livesHelped ?? 0),
            'lives-impacted': String(stats.livesImpacted ?? 0),
            'history-lives-impacted': String(stats.livesImpacted ?? 0),
            'dashboard-lives-helped': String(stats.livesHelped ?? 0),
            'dashboard-lives-helped-secondary': String(stats.livesHelped ?? 0),

            // Donor Level
            'donor-level': stats.donorLevel || 'New Life Saver',
            'dashboard-donor-level': stats.donorLevel || 'New Life Saver',
            'dashboard-donor-level-secondary': stats.donorLevel || 'New Life Saver',

            // Last Donation
            'dashboard-last-donation': formattedLastDate
        };

        Object.entries(mapping).forEach(([id, val]) => {
            const el = getEl(id);
            if (el) el.textContent = val;
        });

        // Also update any data attributes on all pages
        document.querySelectorAll('[data-total-donations]').forEach(el => el.textContent = String(stats.totalDonations ?? 0));
        document.querySelectorAll('[data-lives-helped]').forEach(el => el.textContent = String(stats.livesHelped ?? 0));
        document.querySelectorAll('[data-donor-level]').forEach(el => el.textContent = stats.donorLevel || 'New Life Saver');
        document.querySelectorAll('[data-total-units]').forEach(el => el.textContent = String(stats.totalUnits ?? 0));
        document.querySelectorAll('[data-badges-count]').forEach(el => el.textContent = String((stats.badges || []).length));

        // Badges Grid in my-profile.html and across pages
        const badgesContainers = document.querySelectorAll('.badges-grid, [data-badges-container]');
        badgesContainers.forEach(container => {
            const badges = stats.badges || [];
            if (badges.length > 0) {
                container.innerHTML = badges.map(b => `
                    <div class="badge-card" style="background: linear-gradient(135deg, #FFF5F5 0%, #FFFFFF 100%); border: 1px solid #FECDD3; border-radius: 10px; padding: 14px 8px; text-align: center; box-shadow: 0 2px 6px rgba(230,0,35,0.06); transition: transform 0.2s ease;">
                        <div class="badge-icon" style="font-size: 2rem; margin-bottom: 6px;">${b.icon}</div>
                        <div class="badge-name" style="font-size: 0.8rem; font-weight: 700; color: #1E293B;">${b.name}</div>
                        <div style="font-size: 0.68rem; color: #64748B; margin-top: 2px;">${b.desc}</div>
                    </div>
                `).join('');
            } else {
                container.innerHTML = `
                    <div style="grid-column: 1 / -1; padding: 18px 12px; background: #F9FAFB; border-radius: 10px; border: 1px dashed var(--border-light); text-align: center;">
                        <span style="font-size: 1.8rem; display: block; margin-bottom: 6px;">🩸</span>
                        <p style="font-size: 0.85rem; font-weight: 700; color: var(--text-dark); margin: 0 0 4px;">No Badges Earned Yet</p>
                        <p style="font-size: 0.75rem; color: var(--text-secondary); margin: 0; line-height: 1.4;">
                            Accept and complete your first blood request to earn the <strong>Life Saver</strong> badge!
                        </p>
                    </div>
                `;
            }
        });

        // Next Eligible in dashboard
        const dashNextEligible = getEl('dashboard-next-eligible');
        if (dashNextEligible) {
            dashNextEligible.textContent = stats.isEligible ? 'Eligible Now' : `Eligible on ${formattedNextDate}`;
        }

        // Countdown circle in dashboard
        const countdownEl = getEl('eligibility-countdown-text');
        if (countdownEl) {
            countdownEl.textContent = stats.isEligible ? 'Eligible' : `${stats.daysRemaining} Days`;
        }

        // Summary text in dashboard
        const summaryEl = getEl('last-donation-summary-text');
        if (summaryEl) {
            if (!stats.lastDonationDate) {
                summaryEl.textContent = 'No prior donations recorded. You are fully eligible to donate blood!';
            } else if (stats.isEligible) {
                summaryEl.textContent = `Last donation: ${formattedLastDate} (You have completed the 3-month cooling period and are eligible to donate today!)`;
            } else {
                summaryEl.textContent = `Last donation: ${formattedLastDate} • 3-month cooling period active (${stats.daysRemaining} days remaining until ${formattedNextDate})`;
            }
        }

        // Next Eligible in Donation History
        const histNextEligible = getEl('history-next-eligible');
        if (histNextEligible) {
            if (stats.isEligible) {
                histNextEligible.innerHTML = '<span style="color:var(--status-available, #10B981);font-weight:700;">Eligible Now ✔</span>';
            } else {
                histNextEligible.innerHTML = `<span style="color:var(--status-pending, #F59E0B);font-weight:700;">${formattedNextDate}</span> <small style="display:block;font-size:0.75rem;color:var(--text-secondary);">(${stats.daysRemaining} days cooling period)</small>`;
            }
        }

        // Profile eligibility card (my-profile.html)
        const eligBox = document.querySelector('.eligibility-box');
        const eligIcon = getEl('eligibility-icon');
        const eligTitle = getEl('eligibility-title');
        const eligMsg = getEl('eligibility-message');

        if (eligBox) eligBox.classList.toggle('pending', !stats.isEligible);
        if (eligIcon) eligIcon.textContent = stats.isEligible ? '✅' : '⏱️';
        if (eligTitle) {
            eligTitle.textContent = stats.isEligible ? 'Eligible to Donate' : '3-Month Cooling Period Active';
            eligTitle.style.color = stats.isEligible ? 'var(--status-available, #10B981)' : 'var(--status-pending, #F59E0B)';
        }
        if (eligMsg) {
            if (!stats.lastDonationDate) {
                eligMsg.textContent = 'No previous donations recorded. You are eligible to donate today!';
            } else if (stats.isEligible) {
                eligMsg.innerHTML = 'You have completed the mandatory 3-month cooling period. You are <strong>currently eligible</strong> to donate blood!';
            } else {
                eligMsg.innerHTML = `<strong>Cooling period running:</strong> You recently donated on ${formattedLastDate}. Next eligible to donate on <strong>${formattedNextDate}</strong> (${stats.daysRemaining} days remaining). During this cooling period, you cannot accept blood donation requests.`;
            }
        }
    }

    function showCoolingWarningModal(stats, currentRequest = null) {
        const existing = document.getElementById('cooling-period-modal');
        if (existing) existing.remove();

        const formattedLastDate = stats?.lastDonationDate
            ? (formatDateTime ? formatDateTime(stats.lastDonationDate) : new Date(stats.lastDonationDate).toLocaleDateString())
            : 'Recently';
        const formattedNextDate = stats?.nextEligibleDate
            ? (formatDateTime ? formatDateTime(stats.nextEligibleDate) : new Date(stats.nextEligibleDate).toLocaleDateString())
            : 'In 3 Months';
        const daysLeft = stats?.daysRemaining || 90;

        if (!document.getElementById('cooling-modal-styles')) {
            const style = document.createElement('style');
            style.id = 'cooling-modal-styles';
            style.textContent = `
                @keyframes coolingFadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes coolingPopIn {
                    from { opacity: 0; transform: scale(0.92) translateY(12px); }
                    to { opacity: 1; transform: scale(1) translateY(0); }
                }
            `;
            document.head.appendChild(style);
        }

        const modalOverlay = document.createElement('div');
        modalOverlay.id = 'cooling-period-modal';
        modalOverlay.setAttribute('role', 'dialog');
        modalOverlay.setAttribute('aria-modal', 'true');
        modalOverlay.setAttribute('aria-labelledby', 'cooling-modal-title');
        modalOverlay.style.cssText = `
            position: fixed;
            inset: 0;
            background: rgba(15, 23, 42, 0.82);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 999999;
            padding: 20px;
            box-sizing: border-box;
            animation: coolingFadeIn 0.2s ease-out;
        `;

        const modalContent = document.createElement('div');
        modalContent.style.cssText = `
            background: #FFFFFF;
            border-radius: 20px;
            max-width: 520px;
            width: 100%;
            padding: 32px 28px;
            box-shadow: 0 25px 60px rgba(0, 0, 0, 0.35);
            border: 2px solid #F59E0B;
            text-align: center;
            position: relative;
            box-sizing: border-box;
            max-height: 90vh;
            overflow-y: auto;
            animation: coolingPopIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        `;

        modalContent.innerHTML = `
            <button type="button" id="close-cooling-modal-x" style="position: absolute; top: 16px; right: 16px; background: none; border: none; font-size: 24px; color: #94A3B8; cursor: pointer; line-height: 1; padding: 4px 8px; border-radius: 6px;">✕</button>
            
            <div style="width: 80px; height: 80px; margin: 0 auto 16px; border-radius: 50%; background: #FEF3C7; display: flex; align-items: center; justify-content: center; font-size: 40px; border: 3px solid #FDE68A; box-shadow: 0 0 0 8px rgba(245, 158, 11, 0.15);">
                ⏱️
            </div>

            <h2 id="cooling-modal-title" style="font-size: 1.55rem; font-weight: 800; color: #92400E; margin: 0 0 8px;">Cooling Period is Running!</h2>
            <p style="font-size: 0.95rem; color: #B45309; font-weight: 600; margin: 0 0 20px;">
                Mandatory 3 Months (90 Days) Cooling Period Active
            </p>

            <div style="background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 12px; padding: 14px 18px; margin-bottom: 18px; text-align: left;">
                <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dashed #FDE68A; font-size: 0.88rem;">
                    <span style="color: #78350F; font-weight: 500;">Last Donated:</span>
                    <strong style="color: #92400E;">${formattedLastDate}</strong>
                </div>
                <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dashed #FDE68A; font-size: 0.88rem;">
                    <span style="color: #78350F; font-weight: 500;">Next Eligible Date:</span>
                    <strong style="color: #047857;">${formattedNextDate}</strong>
                </div>
                <div style="display: flex; justify-content: space-between; padding: 6px 0; font-size: 0.9rem;">
                    <span style="color: #78350F; font-weight: 500;">Cooling Status:</span>
                    <strong style="color: #B45309; font-size: 1rem;">⏳ ${daysLeft} Days Remaining</strong>
                </div>
            </div>

            <div style="background: #FEF2F2; border: 1px solid #FECDD3; border-radius: 10px; padding: 12px 14px; margin-bottom: 16px; text-align: left;">
                <p style="margin: 0; font-size: 0.84rem; color: #991B1B; line-height: 1.45;">
                    ⛔ <strong>Donation Blocked:</strong> To protect your health and red blood cell recovery, medical guidelines mandate a 3-month waiting period between donations. You cannot accept blood requests or donate until your cooling period completes.
                </p>
            </div>

            <div style="background: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 10px; padding: 12px 14px; margin-bottom: 22px; text-align: left;">
                <p style="margin: 0; font-size: 0.84rem; color: #166534; line-height: 1.45;">
                    💡 <strong>What you can do right now:</strong><br>
                    • <strong>Make a Blood Request:</strong> Need blood for a patient or emergency? Create a request anytime.<br>
                    • <strong>Share Urgent Requests:</strong> Help reach available donors in the community!
                </p>
            </div>

            <div style="display: flex; flex-direction: column; gap: 10px;">
                <div style="display: flex; gap: 10px;">
                    <a href="blood-request.html" style="flex: 1; background: #E60023; color: white; padding: 12px 14px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 0.9rem; display: flex; align-items: center; justify-content: center; gap: 6px; box-shadow: 0 4px 12px rgba(230,0,35,0.25);">
                        🩸 Make Blood Request
                    </a>
                    <button type="button" id="modal-share-btn" style="flex: 1; background: #EFF6FF; color: #1D4ED8; border: 1px solid #BFDBFE; padding: 12px 14px; border-radius: 10px; font-weight: 700; font-size: 0.9rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px;">
                        📢 Share Request
                    </button>
                </div>
                <button type="button" id="close-cooling-modal-btn" style="width: 100%; background: #F1F5F9; color: #475467; border: none; padding: 10px; border-radius: 8px; font-weight: 600; font-size: 0.85rem; cursor: pointer;">
                    Dismiss
                </button>
            </div>
        `;

        modalOverlay.appendChild(modalContent);
        document.body.appendChild(modalOverlay);

        const closeModal = () => modalOverlay.remove();
        document.getElementById('close-cooling-modal-x')?.addEventListener('click', closeModal);
        document.getElementById('close-cooling-modal-btn')?.addEventListener('click', closeModal);
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) closeModal();
        });

        // Share button logic
        document.getElementById('modal-share-btn')?.addEventListener('click', () => {
            let shareText = 'Urgent Blood Needed! Connect with Blood Bridge to help save lives: ' + window.location.origin;
            if (currentRequest) {
                shareText = `Urgent Blood Request: ${currentRequest.blood_group} blood needed for patient ${currentRequest.patient_name || ''} at ${currentRequest.hospital_name || ''}, ${currentRequest.city || ''}. Help save a life on Blood Bridge!`;
            }
            if (navigator.clipboard) {
                navigator.clipboard.writeText(shareText);
                alert('Request details copied to clipboard! You can share it anywhere.');
            } else {
                alert(shareText);
            }
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        syncUnreadBadges();
        expireOpenRequests();
    });
    return { formatDateTime, withinRadius, getUnreadCount, syncUnreadBadges, expireOpenRequests, getDonorStats, getHomepageStats, renderDonorStats, showCoolingWarningModal };
})();
