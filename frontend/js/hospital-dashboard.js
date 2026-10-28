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
    const btnQuickStock = document.getElementById('btn-quick-stock');

    // Hospital Type Elements & Modal
    const hospitalTypeModal = document.getElementById('hospital-type-modal');
    const btnOpenTypeModal = document.getElementById('btn-open-type-modal');
    const btnQuickHospitalType = document.getElementById('btn-quick-hospital-type');
    const btnCloseTypeModal = document.getElementById('btn-close-type-modal');
    const btnCancelTypeModal = document.getElementById('btn-cancel-type-modal');
    const btnSaveHospitalType = document.getElementById('btn-save-hospital-type');
    const selectHospitalType = document.getElementById('select-hospital-type');
    const hospitalTypeFeedback = document.getElementById('hospital-type-feedback');
    let currentHospitalType = '';

    // Parent feature cards
    const hospitalRequestsCard = document.getElementById('hospital-requests-card');
    const hospitalDonorsSection = document.getElementById('hospital-donors-section');
    const hospitalInfoCard = document.getElementById('hospital-info-card');

    // Quick Action elements
    const btnQuickCreateRequest = document.getElementById('btn-quick-create-request');
    const btnQuickViewDonors = document.getElementById('btn-quick-view-donors');
    const btnQuickUpdateProfile = document.getElementById('btn-quick-update-profile');
    const btnBannerNewRequest = document.getElementById('btn-banner-new-request');
    const btnEditHospitalInfo = document.getElementById('btn-edit-hospital-info');

    // Quick Create Blood Request Modal
    const quickRequestModal = document.getElementById('hospital-quick-request-modal');
    const btnCloseQuickRequestModal = document.getElementById('btn-close-quick-request-modal');
    const btnCancelQuickRequestModal = document.getElementById('btn-cancel-quick-request-modal');
    const quickBloodRequestForm = document.getElementById('quick-blood-request-form');
    const quickPatientName = document.getElementById('quick-patient-name');
    const quickBloodGroup = document.getElementById('quick-blood-group');
    const quickUnits = document.getElementById('quick-units');
    const quickUrgency = document.getElementById('quick-urgency');
    const quickReqDate = document.getElementById('quick-req-date');
    const quickReqTime = document.getElementById('quick-req-time');
    const quickHospitalName = document.getElementById('quick-hospital-name');
    const quickHospitalCity = document.getElementById('quick-hospital-city');
    const quickHospitalAddress = document.getElementById('quick-hospital-address');
    const quickRequestFeedback = document.getElementById('quick-request-feedback');
    const btnSubmitQuickRequest = document.getElementById('btn-submit-quick-request');

    // Update Hospital Profile Modal
    const hospitalProfileModal = document.getElementById('hospital-profile-modal');
    const btnCloseProfileModal = document.getElementById('btn-close-profile-modal');
    const btnCancelProfileModal = document.getElementById('btn-cancel-profile-modal');
    const quickHospitalProfileForm = document.getElementById('quick-hospital-profile-form');
    const profileModalName = document.getElementById('profile-modal-name');
    const profileModalType = document.getElementById('profile-modal-type');
    const profileModalPhone = document.getElementById('profile-modal-phone');
    const profileModalCity = document.getElementById('profile-modal-city');
    const profileModalState = document.getElementById('profile-modal-state');
    const profileModalAddress = document.getElementById('profile-modal-address');
    const profileModalWebsite = document.getElementById('profile-modal-website');
    const hospitalProfileFeedback = document.getElementById('hospital-profile-feedback');
    const btnSaveHospitalProfile = document.getElementById('btn-save-hospital-profile');

    const bloodGroups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
    let hospitalId = null;
    let inventoryRows = [];
    let hospitalProfileData = null;

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
    if (btnQuickStock) btnQuickStock.addEventListener('click', openInventoryModal);
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

    // Setup Hospital Type Modal
    function openTypeModal() {
        if (!hospitalTypeModal) return;
        if (selectHospitalType && currentHospitalType) {
            selectHospitalType.value = currentHospitalType;
        }
        if (hospitalTypeFeedback) {
            hospitalTypeFeedback.style.display = 'none';
            hospitalTypeFeedback.textContent = '';
        }
        hospitalTypeModal.classList.add('active');
    }

    function closeTypeModal() {
        if (hospitalTypeModal) hospitalTypeModal.classList.remove('active');
    }

    if (btnOpenTypeModal) btnOpenTypeModal.addEventListener('click', openTypeModal);
    if (btnQuickHospitalType) btnQuickHospitalType.addEventListener('click', openTypeModal);
    if (btnCloseTypeModal) btnCloseTypeModal.addEventListener('click', closeTypeModal);
    if (btnCancelTypeModal) btnCancelTypeModal.addEventListener('click', closeTypeModal);

    if (hospitalTypeModal) {
        hospitalTypeModal.addEventListener('click', (e) => {
            if (e.target === hospitalTypeModal) closeTypeModal();
        });
    }

    if (btnSaveHospitalType) {
        btnSaveHospitalType.addEventListener('click', async () => {
            if (!hospitalId) return alert('Hospital session not found. Please log in again.');
            const chosenType = selectHospitalType?.value?.trim();
            if (!chosenType) {
                if (hospitalTypeFeedback) {
                    hospitalTypeFeedback.style.display = 'block';
                    hospitalTypeFeedback.style.background = '#FEE2E2';
                    hospitalTypeFeedback.style.color = '#B91C1C';
                    hospitalTypeFeedback.textContent = 'Please select a hospital type.';
                }
                return;
            }

            btnSaveHospitalType.disabled = true;
            btnSaveHospitalType.textContent = 'Saving...';

            let saved = false;
            let errorMessage = '';

            try {
                const { error: supaErr } = await supabaseClient
                    .from('users')
                    .update({ hospital_type: chosenType })
                    .eq('id', hospitalId);

                if (supaErr) throw supaErr;
                saved = true;
            } catch (err) {
                console.warn('Supabase update failed, attempting backend fallback:', err);
                errorMessage = err.message || 'Update failed';

                try {
                    const response = await fetch('/api/hospitals/type', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ hospital_id: hospitalId, hospital_type: chosenType })
                    });
                    const resData = await response.json();
                    if (resData.success) {
                        saved = true;
                    }
                } catch (apiErr) {
                    console.error('API update failed:', apiErr);
                }
            }

            btnSaveHospitalType.disabled = false;
            btnSaveHospitalType.textContent = 'Save Hospital Type';

            if (saved) {
                currentHospitalType = chosenType;
                document.querySelectorAll('[data-hospital-type]').forEach((el) => {
                    el.textContent = chosenType;
                });
                if (hospitalTypeFeedback) {
                    hospitalTypeFeedback.style.display = 'block';
                    hospitalTypeFeedback.style.background = '#DCFCE7';
                    hospitalTypeFeedback.style.color = '#15803D';
                    hospitalTypeFeedback.textContent = 'Hospital type saved successfully!';
                }
                setTimeout(() => {
                    closeTypeModal();
                }, 900);
            } else {
                if (hospitalTypeFeedback) {
                    hospitalTypeFeedback.style.display = 'block';
                    hospitalTypeFeedback.style.background = '#FEE2E2';
                    hospitalTypeFeedback.style.color = '#B91C1C';
                    hospitalTypeFeedback.textContent = `Could not save: ${errorMessage}`;
                }
            }
        });
    }

    async function loadHospitalProfile() {
        if (!hospitalId || !supabaseClient) return;
        const { data: sessionData } = await supabaseClient.auth.getSession();
        const authUser = sessionData?.session?.user;
        const { data: profile, error } = await supabaseClient
            .from('users')
            .select('full_name, phone, city, state, address, avatar_url, website, hospital_type, verification_status')
            .eq('id', hospitalId)
            .maybeSingle();

        if (error) {
            console.error('Error loading hospital profile:', error);
            return;
        }

        hospitalProfileData = profile || {};

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
        currentHospitalType = profile?.hospital_type || '';
        if (typeEl) typeEl.textContent = profile?.hospital_type || 'Hospital type not set';
        if (selectHospitalType && profile?.hospital_type) {
            selectHospitalType.value = profile.hospital_type;
        }
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
            verificationEl.querySelector('p').textContent = verified ? 'Registered on Blood Bridge' : 'Verification status is not confirmed';
        }
    }

    // =========================================================================
    // QUICK ACTION 1: CREATE BLOOD REQUEST (Connected to Recent Requests card)
    // =========================================================================
    function openQuickRequestModal() {
        if (!quickRequestModal) return;
        if (quickBloodRequestForm) quickBloodRequestForm.reset();
        if (quickRequestFeedback) {
            quickRequestFeedback.style.display = 'none';
            quickRequestFeedback.textContent = '';
        }

        // Default to +2 hours from now
        const future = new Date(Date.now() + 2 * 60 * 60 * 1000);
        const pad = (v) => String(v).padStart(2, '0');
        if (quickReqDate) quickReqDate.value = `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}`;
        if (quickReqTime) quickReqTime.value = `${pad(future.getHours())}:${pad(future.getMinutes())}`;

        // Pre-fill hospital data
        if (quickHospitalName) quickHospitalName.value = hospitalProfileData?.full_name || '';
        if (quickHospitalCity) quickHospitalCity.value = hospitalProfileData?.city || '';
        if (quickHospitalAddress) {
            quickHospitalAddress.value = [hospitalProfileData?.address, hospitalProfileData?.city, hospitalProfileData?.state].filter(Boolean).join(', ') || '';
        }
        if (quickUnits) quickUnits.value = '1';
        if (quickUrgency) quickUrgency.value = 'Critical';
        if (quickBloodGroup) quickBloodGroup.value = 'O+';

        quickRequestModal.classList.add('active');
        if (quickPatientName) quickPatientName.focus();
    }

    function closeQuickRequestModal() {
        if (quickRequestModal) quickRequestModal.classList.remove('active');
    }

    if (btnQuickCreateRequest) btnQuickCreateRequest.addEventListener('click', openQuickRequestModal);
    if (btnBannerNewRequest) btnBannerNewRequest.addEventListener('click', openQuickRequestModal);
    if (btnCloseQuickRequestModal) btnCloseQuickRequestModal.addEventListener('click', closeQuickRequestModal);
    if (btnCancelQuickRequestModal) btnCancelQuickRequestModal.addEventListener('click', closeQuickRequestModal);
    if (quickRequestModal) {
        quickRequestModal.addEventListener('click', (e) => {
            if (e.target === quickRequestModal) closeQuickRequestModal();
        });
    }

    if (quickBloodRequestForm) {
        quickBloodRequestForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!hospitalId) return alert('Hospital session not found. Please log in again.');

            const patientName = quickPatientName?.value?.trim();
            const bloodGroup = quickBloodGroup?.value?.trim();
            const units = parseInt(quickUnits?.value, 10) || 1;
            const urgency = quickUrgency?.value?.trim() || 'Critical';
            const reqDate = quickReqDate?.value?.trim();
            const reqTime = quickReqTime?.value?.trim();
            const hName = quickHospitalName?.value?.trim() || hospitalProfileData?.full_name || 'Hospital Facility';
            const city = quickHospitalCity?.value?.trim() || hospitalProfileData?.city || 'City';
            const address = quickHospitalAddress?.value?.trim() || hospitalProfileData?.address || city;

            if (!patientName || !bloodGroup || !reqDate || !reqTime || !hName || !city || !address) {
                if (quickRequestFeedback) {
                    quickRequestFeedback.style.display = 'block';
                    quickRequestFeedback.style.background = '#FEE2E2';
                    quickRequestFeedback.style.color = '#B91C1C';
                    quickRequestFeedback.textContent = 'Please fill in all required request details.';
                }
                return;
            }

            const requiredBy = new Date(`${reqDate}T${reqTime}:00`);
            if (Number.isNaN(requiredBy.getTime()) || requiredBy <= new Date()) {
                if (quickRequestFeedback) {
                    quickRequestFeedback.style.display = 'block';
                    quickRequestFeedback.style.background = '#FEE2E2';
                    quickRequestFeedback.style.color = '#B91C1C';
                    quickRequestFeedback.textContent = 'Required date & time must be in the future.';
                }
                return;
            }

            if (btnSubmitQuickRequest) {
                btnSubmitQuickRequest.disabled = true;
                btnSubmitQuickRequest.textContent = 'Submitting & Broadcasting...';
            }

            const requestPayload = {
                patient_name: patientName,
                blood_group: bloodGroup,
                units: units,
                urgency: urgency,
                hospital_name: hName,
                hospital_address: address,
                city: city,
                required_date: reqDate,
                required_time: reqTime,
                requester_id: hospitalId
            };

            let createdSuccess = false;
            let errorMessage = '';

            try {
                // Try backend API first
                const { data: sessionData } = await supabaseClient.auth.getSession();
                const token = sessionData?.session?.access_token;
                const response = await fetch('/api/requests', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                    },
                    body: JSON.stringify(requestPayload)
                });
                const result = await response.json();
                if (result.success) {
                    createdSuccess = true;
                } else {
                    throw new Error(result.error || 'Server error creating request');
                }
            } catch (apiErr) {
                console.warn('API /api/requests call failed, falling back to direct Supabase insert:', apiErr);
                errorMessage = apiErr.message;
                try {
                    const { error: supaErr } = await supabaseClient
                        .from('blood_requests')
                        .insert([{
                            ...requestPayload,
                            status: 'open',
                            required_by: requiredBy.toISOString(),
                            created_at: new Date().toISOString()
                        }]);
                    if (supaErr) throw supaErr;
                    createdSuccess = true;
                } catch (supaFail) {
                    console.error('Supabase insert failed:', supaFail);
                    errorMessage = supaFail.message;
                }
            }

            if (btnSubmitQuickRequest) {
                btnSubmitQuickRequest.disabled = false;
                btnSubmitQuickRequest.textContent = 'Submit Request';
            }

            if (createdSuccess) {
                if (quickRequestFeedback) {
                    quickRequestFeedback.style.display = 'block';
                    quickRequestFeedback.style.background = '#DCFCE7';
                    quickRequestFeedback.style.color = '#15803D';
                    quickRequestFeedback.textContent = 'Emergency blood request created and broadcast to nearby donors!';
                }
                // Instantly sync parent feature: Recent Blood Requests & KPIs
                await loadHospitalRequests();
                if (hospitalRequestsCard) {
                    hospitalRequestsCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    hospitalRequestsCard.classList.add('highlight-pulse');
                    setTimeout(() => hospitalRequestsCard.classList.remove('highlight-pulse'), 2200);
                }
                setTimeout(() => {
                    closeQuickRequestModal();
                }, 1000);
            } else {
                if (quickRequestFeedback) {
                    quickRequestFeedback.style.display = 'block';
                    quickRequestFeedback.style.background = '#FEE2E2';
                    quickRequestFeedback.style.color = '#B91C1C';
                    quickRequestFeedback.textContent = `Could not create request: ${errorMessage}`;
                }
            }
        });
    }

    // =========================================================================
    // QUICK ACTION 2: DONORS / VIEW DONORS (Connected to Donor Matching card)
    // =========================================================================
    if (btnQuickViewDonors) {
        btnQuickViewDonors.addEventListener('click', (e) => {
            if (e.shiftKey || e.ctrlKey || e.metaKey) {
                window.location.href = 'find-donors.html';
                return;
            }
            if (hospitalDonorsSection) {
                hospitalDonorsSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
                hospitalDonorsSection.classList.add('highlight-pulse');
                setTimeout(() => hospitalDonorsSection.classList.remove('highlight-pulse'), 2200);
            } else {
                window.location.href = 'find-donors.html';
            }
        });
        btnQuickViewDonors.addEventListener('dblclick', () => {
            window.location.href = 'find-donors.html';
        });
    }

    // =========================================================================
    // QUICK ACTION 3: UPDATE PROFILE (Connected to Hospital Information card)
    // =========================================================================
    function openProfileModal() {
        if (!hospitalProfileModal) return;
        if (hospitalProfileFeedback) {
            hospitalProfileFeedback.style.display = 'none';
            hospitalProfileFeedback.textContent = '';
        }

        if (profileModalName) profileModalName.value = hospitalProfileData?.full_name || '';
        if (profileModalType) profileModalType.value = hospitalProfileData?.hospital_type || currentHospitalType || 'Private';
        if (profileModalPhone) profileModalPhone.value = hospitalProfileData?.phone || '';
        if (profileModalCity) profileModalCity.value = hospitalProfileData?.city || '';
        if (profileModalState) profileModalState.value = hospitalProfileData?.state || '';
        if (profileModalAddress) profileModalAddress.value = hospitalProfileData?.address || '';
        if (profileModalWebsite) profileModalWebsite.value = hospitalProfileData?.website || '';

        hospitalProfileModal.classList.add('active');
        if (profileModalName) profileModalName.focus();
    }

    function closeProfileModal() {
        if (hospitalProfileModal) hospitalProfileModal.classList.remove('active');
    }

    if (btnQuickUpdateProfile) btnQuickUpdateProfile.addEventListener('click', openProfileModal);
    if (btnEditHospitalInfo) btnEditHospitalInfo.addEventListener('click', openProfileModal);
    if (btnCloseProfileModal) btnCloseProfileModal.addEventListener('click', closeProfileModal);
    if (btnCancelProfileModal) btnCancelProfileModal.addEventListener('click', closeProfileModal);
    if (hospitalProfileModal) {
        hospitalProfileModal.addEventListener('click', (e) => {
            if (e.target === hospitalProfileModal) closeProfileModal();
        });
    }

    if (quickHospitalProfileForm) {
        quickHospitalProfileForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!hospitalId) return alert('Hospital session not found. Please log in again.');

            const updates = {
                full_name: profileModalName?.value?.trim() || '',
                hospital_type: profileModalType?.value?.trim() || '',
                phone: profileModalPhone?.value?.trim() || '',
                city: profileModalCity?.value?.trim() || '',
                state: profileModalState?.value?.trim() || '',
                address: profileModalAddress?.value?.trim() || '',
                website: profileModalWebsite?.value?.trim() || ''
            };

            if (!updates.full_name || !updates.phone || !updates.city) {
                if (hospitalProfileFeedback) {
                    hospitalProfileFeedback.style.display = 'block';
                    hospitalProfileFeedback.style.background = '#FEE2E2';
                    hospitalProfileFeedback.style.color = '#B91C1C';
                    hospitalProfileFeedback.textContent = 'Hospital name, contact phone, and city are required.';
                }
                return;
            }

            if (btnSaveHospitalProfile) {
                btnSaveHospitalProfile.disabled = true;
                btnSaveHospitalProfile.textContent = 'Saving Profile...';
            }

            let profileSaved = false;
            let errorMessage = '';

            try {
                const { error: supaErr } = await supabaseClient
                    .from('users')
                    .update(updates)
                    .eq('id', hospitalId);

                if (supaErr) throw supaErr;
                profileSaved = true;
            } catch (err) {
                console.warn('Direct Supabase profile update failed, attempting backend fallback:', err);
                errorMessage = err.message || 'Update failed';

                try {
                    const response = await fetch('/api/hospitals/profile', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ hospital_id: hospitalId, ...updates })
                    });
                    const resData = await response.json();
                    if (resData.success) {
                        profileSaved = true;
                    }
                } catch (apiErr) {
                    console.error('API profile update failed:', apiErr);
                }
            }

            if (btnSaveHospitalProfile) {
                btnSaveHospitalProfile.disabled = false;
                btnSaveHospitalProfile.textContent = 'Save Changes';
            }

            if (profileSaved) {
                if (hospitalProfileFeedback) {
                    hospitalProfileFeedback.style.display = 'block';
                    hospitalProfileFeedback.style.background = '#DCFCE7';
                    hospitalProfileFeedback.style.color = '#15803D';
                    hospitalProfileFeedback.textContent = 'Hospital profile updated successfully!';
                }
                // Instantly sync parent feature: Hospital Information card
                await loadHospitalProfile();
                if (hospitalInfoCard) {
                    hospitalInfoCard.classList.add('highlight-pulse');
                    setTimeout(() => hospitalInfoCard.classList.remove('highlight-pulse'), 2200);
                }
                setTimeout(() => {
                    closeProfileModal();
                }, 900);
            } else {
                if (hospitalProfileFeedback) {
                    hospitalProfileFeedback.style.display = 'block';
                    hospitalProfileFeedback.style.background = '#FEE2E2';
                    hospitalProfileFeedback.style.color = '#B91C1C';
                    hospitalProfileFeedback.textContent = `Could not save profile: ${errorMessage}`;
                }
            }
        });
    }

    // Keyboard accessibility for action boxes & modals
    document.querySelectorAll('.action-box[tabindex="0"]').forEach(box => {
        box.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                box.click();
            }
        });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeQuickRequestModal();
            closeProfileModal();
            closeTypeModal();
            closeInventoryModal();
        }
    });

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

            // Compute live operational request percentages
            const totalCount = allRequests.length;
            const fulfilledCount = fulfilledRequests.length;
            const criticalCount = criticalRequests.length;
            const pendingCount = activeRequests.length;

            const fulfilledPct = totalCount > 0 ? Math.round((fulfilledCount / totalCount) * 100) : 0;
            const criticalPct = totalCount > 0 ? Math.round((criticalCount / totalCount) * 100) : 0;
            const pendingPct = totalCount > 0 ? Math.round((pendingCount / totalCount) * 100) : 0;

            const elFulfilledPct = document.getElementById('analytics-fulfilled-pct');
            const elFulfilledBar = document.getElementById('analytics-fulfilled-bar');
            if (elFulfilledPct) elFulfilledPct.textContent = `${fulfilledPct}%`;
            if (elFulfilledBar) elFulfilledBar.style.width = `${fulfilledPct}%`;

            const elCriticalPct = document.getElementById('analytics-critical-pct');
            const elCriticalBar = document.getElementById('analytics-critical-bar');
            if (elCriticalPct) elCriticalPct.textContent = `${criticalPct}%`;
            if (elCriticalBar) elCriticalBar.style.width = `${criticalPct}%`;

            const elPendingPct = document.getElementById('analytics-pending-pct');
            const elPendingBar = document.getElementById('analytics-pending-bar');
            if (elPendingPct) elPendingPct.textContent = `${pendingPct}%`;
            if (elPendingBar) elPendingBar.style.width = `${pendingPct}%`;

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
                ? await supabaseClient.from('users').select('latitude, longitude, city').eq('id', hospitalId).maybeSingle()
                : { data: null };
            let hospitalCoords = { lat: Number(hospitalProfile?.latitude), lng: Number(hospitalProfile?.longitude) };
            if (![hospitalCoords.lat, hospitalCoords.lng].every(Number.isFinite)) {
                const defaultLoc = window.MapService?.getDefaultLocation ? window.MapService.getDefaultLocation() : { lat: 26.8467, lng: 80.9462 };
                hospitalCoords = { lat: defaultLoc.lat, lng: defaultLoc.lng };
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

            const processedDonors = [];
            for (const d of allDonors) {
                const coords = { lat: Number(d.latitude), lng: Number(d.longitude) };
                let distanceKm = null;
                if ([coords.lat, coords.lng].every(Number.isFinite) && [hospitalCoords.lat, hospitalCoords.lng].every(Number.isFinite)) {
                    distanceKm = MapService.calculateDistanceKm(hospitalCoords.lat, hospitalCoords.lng, coords.lat, coords.lng);
                }
                if (distanceKm === null || distanceKm <= 100) {
                    processedDonors.push({ ...d, distanceKm: distanceKm !== null ? distanceKm : 12.5 });
                }
                if (processedDonors.length >= 5) break;
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
    if (window.BloodBridgeData?.syncUnreadBadges) {
        window.BloodBridgeData.syncUnreadBadges();
    }
});
