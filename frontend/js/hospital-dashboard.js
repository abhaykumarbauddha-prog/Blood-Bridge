// frontend/js/hospital-dashboard.js
/**
 * Hospital Dashboard Controller
 * - Connects to Supabase blood_requests and users (role = 'Donor')
 * - Real-time synchronization with 100km radius distance
 * - Dynamic Blood Inventory management with Supabase persistence
 * - Search filtering and dynamic KPI counters
 */

document.addEventListener('DOMContentLoaded', async () => {
    const supabaseClient = window.bloodBridgeSupabase;
    const requestsTbody = document.getElementById('hospital-recent-requests-tbody');
    const donorMatchingList = document.getElementById('hospital-donor-matching-list');
    const searchInput = document.getElementById('hospital-search-input');
    const logoutBtn = document.getElementById('hospital-logout-btn');

    // KPI Elements
    const kpiActiveRequests = document.getElementById('hospital-kpi-active-requests');
    const kpiDonors = document.getElementById('hospital-kpi-donors');
    const kpiUnits = document.getElementById('hospital-kpi-units');
    const kpiFulfilled = document.getElementById('hospital-kpi-fulfilled');
    const statSummaryTotal = document.getElementById('stat-summary-total');
    const statSummaryFulfilled = document.getElementById('stat-summary-fulfilled');
    const statSummaryPending = document.getElementById('stat-summary-pending');
    const statSummaryCritical = document.getElementById('stat-summary-critical');

    // Inventory Elements & Modal
    const inventoryContainer = document.getElementById('hospital-inventory-list-container');
    const inventoryModal = document.getElementById('inventory-modal');
    const btnEditInventory = document.getElementById('btn-edit-inventory-link');
    const btnOpenInventoryModal = document.getElementById('btn-open-inventory-modal');
    const btnCloseInventoryModal = document.getElementById('btn-close-inventory-modal');
    const btnCancelInventoryModal = document.getElementById('btn-cancel-inventory-modal');
    const btnSaveInventoryModal = document.getElementById('btn-save-inventory-modal');
    const stockModalGrid = document.getElementById('stock-modal-grid');

    const bloodGroups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
    let hospitalId = null;
    let inventoryRows = [];

    function setInventoryMessage(message) {
        if (inventoryContainer) {
            inventoryContainer.innerHTML = `<div style="padding: 16px; color: var(--text-secondary); text-align: center;">${escapeHtml(message)}</div>`;
        }
        if (kpiUnits) kpiUnits.textContent = '-';
    }

    // Render only values returned by Supabase. An empty table is an honest empty state.
    function renderInventory(rows) {
        inventoryRows = rows || [];
        if (!inventoryRows.length) {
            setInventoryMessage('No blood inventory recorded yet. Use Manage Stock to add units.');
            return;
        }

        const totalUnits = inventoryRows.reduce((sum, row) => sum + Number(row.units || 0), 0);
        const maxUnits = Math.max(...inventoryRows.map(row => Number(row.units || 0)), 0);
        if (kpiUnits) kpiUnits.textContent = String(totalUnits);
        if (!inventoryContainer) return;

        inventoryContainer.innerHTML = inventoryRows.map((row) => {
            const group = escapeHtml(row.blood_group);
            const units = Number(row.units || 0);
            const percentage = maxUnits > 0 ? Math.round((units / maxUnits) * 100) : 0;
            const isAB = row.blood_group.startsWith('AB');
            const badgeStyle = isAB ? 'style="color: #9333EA;"' : '';
            const fillStyle = isAB
                ? `style="width: ${percentage}%; background: #9333EA;"`
                : `style="width: ${percentage}%;"`;

            return `
                <div class="inventory-item" data-group="${group}">
                    <div class="blood-badge" ${badgeStyle}>${group}</div>
                    <div class="progress-track"><div class="progress-fill" ${fillStyle}></div></div>
                    <div class="unit-count">${units} Units</div>
                </div>
            `;
        }).join('');
    }

    async function loadInventory() {
        if (!hospitalId || !supabaseClient) return;
        let { data, error } = await supabaseClient
            .from('blood_inventory')
            .select('blood_group, units, updated_at')
            .eq('hospital_id', hospitalId)
            .order('blood_group');

        if (error && /does not exist|schema cache/i.test(error.message || '')) {
            const fallback = await supabaseClient
                .from('hospital_inventory')
                .select('blood_group, units, last_updated')
                .eq('hospital_id', hospitalId)
                .order('blood_group');
            if (!fallback.error) {
                data = fallback.data;
                error = null;
            }
        }

        if (error) {
            console.error('Error loading blood inventory:', error);
            setInventoryMessage('Unable to load inventory. Run the database migration, then try again.');
            return;
        }
        renderInventory(data || []);
    }

    // Setup Inventory Modal
    function openInventoryModal() {
        if (!inventoryModal || !stockModalGrid) return;
        const inventoryByGroup = new Map(inventoryRows.map(row => [row.blood_group, Number(row.units || 0)]));

        stockModalGrid.innerHTML = bloodGroups.map((grp) => `
            <div class="stock-edit-item">
                <span style="font-weight: 700; color: var(--brand-primary);">${grp}</span>
                <input type="number" min="0" max="999999" class="stock-input" data-group="${grp}" value="${inventoryByGroup.get(grp) || 0}">
            </div>
        `).join('');

        inventoryModal.classList.add('active');
    }

    function closeInventoryModal() {
        if (inventoryModal) inventoryModal.classList.remove('active');
    }

    if (btnEditInventory) btnEditInventory.addEventListener('click', openInventoryModal);
    if (btnOpenInventoryModal) btnOpenInventoryModal.addEventListener('click', openInventoryModal);
    if (btnCloseInventoryModal) btnCloseInventoryModal.addEventListener('click', closeInventoryModal);
    if (btnCancelInventoryModal) btnCancelInventoryModal.addEventListener('click', closeInventoryModal);

    if (inventoryModal) {
        inventoryModal.addEventListener('click', (e) => {
            if (e.target === inventoryModal) closeInventoryModal();
        });
    }

    if (btnSaveInventoryModal) {
        btnSaveInventoryModal.addEventListener('click', async () => {
            if (!hospitalId) return alert('Hospital session not found. Please log in again.');
            const inputs = stockModalGrid.querySelectorAll('.stock-input');
            const rows = Array.from(inputs).map(inp => {
                const grp = inp.dataset.group;
                const val = Math.max(0, parseInt(inp.value, 10) || 0);
                return { hospital_id: hospitalId, blood_group: grp, units: val };
            });

            btnSaveInventoryModal.disabled = true;
            let { error } = await supabaseClient
                .from('blood_inventory')
                .upsert(rows, { onConflict: 'hospital_id,blood_group' });

            if (error && /does not exist|schema cache/i.test(error.message || '')) {
                const fallback = await supabaseClient
                    .from('hospital_inventory')
                    .upsert(rows, { onConflict: 'hospital_id,blood_group' });
                if (!fallback.error) error = null;
            }

            btnSaveInventoryModal.disabled = false;
            if (error) {
                console.error('Error saving blood inventory:', error);
                alert(`Unable to save inventory: ${error.message}`);
                return;
            }
            await loadInventory();
            closeInventoryModal();
        });
    }

    async function loadHospitalProfile() {
        if (!hospitalId || !supabaseClient) return;
        const { data: sessionData } = await supabaseClient.auth.getSession();
        const authUser = sessionData?.session?.user;
        const { data: profile, error } = await supabaseClient
            .from('users')
            .select('full_name, phone, city, state, avatar_url, website, hospital_type, verification_status')
            .eq('id', hospitalId)
            .maybeSingle();

        if (error) {
            console.error('Error loading hospital profile:', error);
            return;
        }

        const name = profile?.full_name || 'Hospital profile not set';
        const avatar = profile?.avatar_url || 'assets/hospital-building.svg';
        const location = [profile?.city, profile?.state].filter(Boolean).join(', ') || 'Location not set';
        const website = profile?.website || '';
        const verified = profile?.verification_status === 'verified';

        document.querySelectorAll('[data-hospital-name], [data-hospital-welcome], [data-hospital-info-name]').forEach((el) => {
            el.textContent = name;
        });
        document.querySelectorAll('[data-hospital-avatar]').forEach((el) => {
            el.src = avatar;
            el.alt = name;
        });
        const typeEl = document.querySelector('[data-hospital-type]');
        if (typeEl) typeEl.textContent = profile?.hospital_type || 'Hospital type not set';
        const locationEl = document.querySelector('[data-hospital-location]');
        if (locationEl) locationEl.textContent = location;
        const phoneEl = document.querySelector('[data-hospital-phone]');
        if (phoneEl) phoneEl.textContent = profile?.phone || 'Phone not set';
        const emailEl = document.querySelector('[data-hospital-email]');
        if (emailEl) emailEl.textContent = authUser?.email || 'Email not available';
        const websiteEl = document.querySelector('[data-hospital-website]');
        if (websiteEl) {
            websiteEl.textContent = website || 'Website not set';
            if (website) {
                websiteEl.href = /^https?:\/\//i.test(website) ? website : `https://${website}`;
                websiteEl.target = '_blank';
                websiteEl.rel = 'noopener noreferrer';
            } else {
                websiteEl.removeAttribute('href');
            }
        }
        const verificationEl = document.querySelector('[data-hospital-verification]');
        if (verificationEl) {
            verificationEl.querySelector('h5').textContent = verified ? 'Verified Hospital' : 'Verification pending';
            verificationEl.querySelector('p').textContent = verified ? 'Registered on BloodMatch' : 'Verification status is not confirmed';
        }
    }

    // 1. Load Real Blood Requests and Update Dashboard KPIs
    async function loadHospitalRequests() {
        if (!requestsTbody || !supabaseClient) return;

        try {
            const { data: requests, error } = await supabaseClient
                .from('blood_requests')
                .select('*')
                .in('status', ['open', 'matched', 'fulfilled'])
                .order('created_at', { ascending: false });

            if (error) throw error;

            const allRequests = requests || [];
            const now = new Date();
            const activeRequests = allRequests.filter((request) =>
                ['open', 'matched'].includes((request.status || '').toLowerCase())
                && request.required_by && new Date(request.required_by) > now
            );
            const requestIds = activeRequests.map((request) => request.id);
            const { data: responses, error: responsesError } = requestIds.length
                ? await supabaseClient.from('request_responses').select('id, request_id, status').in('request_id', requestIds).eq('status', 'accepted')
                : { data: [], error: null };
            if (responsesError && !/does not exist|schema cache/i.test(responsesError.message || '')) throw responsesError;
            const acceptedResponseByRequest = new Map((responses || []).map((response) => [response.request_id, response]));
            const fulfilledRequests = allRequests.filter(r => (r.status || '').toLowerCase() === 'fulfilled');
            const criticalRequests = activeRequests.filter(r => (r.urgency || '').toLowerCase() === 'critical');

            if (kpiActiveRequests) kpiActiveRequests.textContent = String(activeRequests.length);
            if (kpiFulfilled) kpiFulfilled.textContent = String(fulfilledRequests.length);
            if (statSummaryTotal) statSummaryTotal.textContent = String(allRequests.length);
            if (statSummaryFulfilled) statSummaryFulfilled.textContent = String(fulfilledRequests.length);
            if (statSummaryPending) statSummaryPending.textContent = String(activeRequests.length);
            if (statSummaryCritical) statSummaryCritical.textContent = String(criticalRequests.length);

            const displayRequests = activeRequests.slice(0, 6);

            if (displayRequests.length === 0) {
                requestsTbody.innerHTML = `
                    <tr>
                        <td colspan="8" style="text-align: center; padding: 24px; color: var(--text-secondary); font-size: 0.85rem;">
                            No blood requests found. New hospital requests will appear here.
                        </td>
                    </tr>
                `;
                return;
            }

            requestsTbody.innerHTML = displayRequests.map((req, idx) => {
                const urgency = req.urgency || 'Normal';
                let tagClass = 'tag-pending';
                if (urgency.toLowerCase() === 'critical') tagClass = 'tag-critical';
                else if (urgency.toLowerCase() === 'urgent') tagClass = 'tag-urgent';

                const reqId = `#BR-${(req.id || String(idx)).slice(0, 4).toUpperCase()}`;
                const reqDate = BloodMatchData.formatDateTime(req.created_at);

                return `
                    <tr class="hospital-req-row">
                        <td>${reqId}</td>
                        <td class="req-name"><strong>${escapeHtml(req.patient_name)}</strong></td>
                        <td class="req-group" style="color: var(--brand-primary); font-weight: 700;">${escapeHtml(req.blood_group)}</td>
                        <td>${req.units}</td>
                        <td><span class="status-tag ${tagClass}">${escapeHtml(urgency)}</span></td>
                        <td><span style="color: var(--status-pending); font-size: 0.75rem; font-weight: 600;">${escapeHtml(req.status || 'Pending')}</span></td>
                        <td>${reqDate}</td>
                        <td>
                            <a href="nearby-request.html" class="btn-view" style="text-decoration: none; display: inline-block;">
                                View
                            </a>
                            ${acceptedResponseByRequest.has(req.id) ? `<button type="button" class="btn-view btn-mark-donated" data-response-id="${acceptedResponseByRequest.get(req.id).id}" style="margin-left: 6px;">Mark donated</button>` : ''}
                        </td>
                    </tr>
                `;
            }).join('');

            document.querySelectorAll('.btn-mark-donated').forEach((button) => {
                button.addEventListener('click', async () => {
                    button.disabled = true;
                    const responseId = button.dataset.responseId;
                    let markError = null;

                    const { error: rpcErr } = await supabaseClient.rpc('mark_response_donated', { response_id_input: responseId });
                    if (rpcErr) {
                        if (/function .* does not exist|could not find the function/i.test(rpcErr.message || '')) {
                            const { data: respData, error: respErr } = await supabaseClient
                                .from('request_responses')
                                .update({ status: 'donated', donated_at: new Date().toISOString() })
                                .eq('id', responseId)
                                .select('donor_id, request_id')
                                .maybeSingle();
                            if (respErr) {
                                markError = respErr;
                            } else if (respData) {
                                await supabaseClient
                                    .from('blood_requests')
                                    .update({ status: 'fulfilled' })
                                    .eq('id', respData.request_id);
                                await supabaseClient
                                    .from('users')
                                    .update({ last_donation_date: new Date().toISOString().split('T')[0] })
                                    .eq('id', respData.donor_id);
                            }
                        } else {
                            markError = rpcErr;
                        }
                    }

                    button.disabled = false;
                    if (markError) return alert(`Unable to verify donation: ${markError.message}`);
                    alert('Donation verified and marked as completed! Donor record and history updated.');
                    loadHospitalRequests();
                });
            });
        } catch (err) {
            console.error('Error loading hospital requests:', err);
            requestsTbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 16px; color: var(--text-secondary);">Unable to load requests.</td></tr>`;
        }
    }

    // 2. Load Real Donors for Donor Matching (Within 100km)
    async function loadHospitalMatchingDonors() {
        if (!donorMatchingList || !supabaseClient) return;

        try {
            const { data: sessionData } = await supabaseClient.auth.getSession();
            const hospitalId = sessionData?.session?.user?.id;
            const { data: hospitalProfile } = hospitalId
                ? await supabaseClient.from('users').select('latitude, longitude').eq('id', hospitalId).maybeSingle()
                : { data: null };
            const hospitalCoords = { lat: Number(hospitalProfile?.latitude), lng: Number(hospitalProfile?.longitude) };
            if (![hospitalCoords.lat, hospitalCoords.lng].every(Number.isFinite)) {
                donorMatchingList.innerHTML = '<div style="padding: 24px; color: var(--text-secondary); text-align: center;">Hospital location not set. Set your location before searching donors.</div>';
                return;
            }
            const { data: donors, error } = await supabaseClient
                .from('public_donors')
                .select('id, full_name, blood_group, city, state, last_donation_date, is_available, latitude, longitude, avatar_url');

            if (error) throw error;

            const allDonors = donors || [];
            if (kpiDonors) kpiDonors.textContent = String(allDonors.length);

            if (allDonors.length === 0) {
                donorMatchingList.innerHTML = `
                    <div style="text-align: center; padding: 24px; color: var(--text-secondary); font-size: 0.85rem;">
                        No matching donors currently registered in this 100km area.
                    </div>
                `;
                return;
            }

            const topDonors = allDonors.slice(0, 5);
            const processedDonors = [];
            for (const d of topDonors) {
                const coords = { lat: Number(d.latitude), lng: Number(d.longitude) };
                if (![coords.lat, coords.lng].every(Number.isFinite) || !BloodMatchData.withinRadius(hospitalCoords, coords, 100)) continue;
                const distanceKm = MapService.calculateDistanceKm(hospitalCoords.lat, hospitalCoords.lng, coords.lat, coords.lng);
                processedDonors.push({ ...d, distanceKm });
            }

            donorMatchingList.innerHTML = processedDonors.map(donor => {
                const name = donor.full_name || 'Donor';
                const avatar = donor.avatar_url || 'assets/profile-placeholder.svg';

                return `
                    <div class="donor-match-item">
                        <div class="donor-info">
                            <img src="${avatar}" alt="${escapeHtml(name)}">
                            <div>
                                <h5>${escapeHtml(name)} <span style="color: var(--brand-primary);">${escapeHtml(donor.blood_group || 'O+')}</span></h5>
                                <p>${escapeHtml(donor.city || 'Location not set')} • Status: ${donor.is_available ? 'Available' : 'Unavailable'}</p>
                            </div>
                        </div>
                        <div class="distance"><strong>${donor.distanceKm} km</strong> away</div>
                        <button type="button" class="btn-contact btn-hospital-contact" data-donor-name="${escapeHtml(name)}">
                            Contact via request
                        </button>
                    </div>
                `;
            }).join('');

            document.querySelectorAll('.btn-hospital-contact').forEach(btn => {
                btn.addEventListener('click', () => {
                    const dName = btn.dataset.donorName;
                    alert(`Create a blood request to contact ${dName} through the verified request flow.`);
                });
            });
        } catch (err) {
            console.error('Error loading matching donors:', err);
            donorMatchingList.innerHTML = `<p style="padding: 16px; color: var(--text-secondary); font-size: 0.85rem;">Unable to load donors.</p>`;
        }
    }

    // 3. Search Filter in Topbar
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            const rows = document.querySelectorAll('.hospital-req-row');
            rows.forEach(row => {
                const text = row.textContent.toLowerCase();
                row.style.display = text.includes(query) ? '' : 'none';
            });
        });
    }

    // 4. Logout Handler
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            if (confirm('Are you sure you want to log out from Hospital Account?')) {
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

    const { data: sessionData } = await supabaseClient.auth.getSession();
    hospitalId = sessionData?.session?.user?.id || null;
    if (!hospitalId) return;
    loadHospitalProfile();
    loadInventory();
    loadHospitalRequests();
    loadHospitalMatchingDonors();
});
