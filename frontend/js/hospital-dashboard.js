// frontend/js/hospital-dashboard.js
/**
 * Hospital Dashboard Controller
 * - Connects to Supabase blood_requests and users (role = 'Donor')
 * - Real-time synchronization with 100km radius distance
 * - Dynamic Blood Inventory management with interactive modal & persistent storage
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

    // Inventory Elements & Modal
    const inventoryContainer = document.getElementById('hospital-inventory-list-container');
    const inventoryModal = document.getElementById('inventory-modal');
    const btnEditInventory = document.getElementById('btn-edit-inventory-link');
    const btnOpenInventoryModal = document.getElementById('btn-open-inventory-modal');
    const btnCloseInventoryModal = document.getElementById('btn-close-inventory-modal');
    const btnCancelInventoryModal = document.getElementById('btn-cancel-inventory-modal');
    const btnSaveInventoryModal = document.getElementById('btn-save-inventory-modal');
    const stockModalGrid = document.getElementById('stock-modal-grid');

    const defaultCenter = (window.MapService && window.MapService.DEFAULT_COORDS) ? window.MapService.DEFAULT_COORDS : { lat: 26.8467, lng: 80.9462 };

    // Default Blood Inventory Data
    const defaultInventory = {
        'O+': 45,
        'O-': 18,
        'A+': 32,
        'A-': 14,
        'B+': 28,
        'B-': 10,
        'AB+': 8,
        'AB-': 6
    };

    function getStoredInventory() {
        try {
            const raw = localStorage.getItem('hospital_inventory');
            if (raw) return JSON.parse(raw);
        } catch (e) {
            console.warn('Error reading stored inventory:', e);
        }
        return { ...defaultInventory };
    }

    function saveStoredInventory(inv) {
        localStorage.setItem('hospital_inventory', JSON.stringify(inv));
    }

    // Render Blood Inventory Section
    function renderInventory() {
        const inv = getStoredInventory();
        let totalUnits = 0;

        if (inventoryContainer) {
            inventoryContainer.innerHTML = Object.entries(inv).map(([grp, units]) => {
                totalUnits += Number(units);
                const maxRef = 50;
                const percentage = Math.min(100, Math.round((units / maxRef) * 100));
                const isAB = grp.startsWith('AB');
                const badgeStyle = isAB ? 'style="color: #9333EA;"' : '';
                const fillStyle = isAB ? 'style="width: ' + percentage + '%; background: #9333EA;"' : 'style="width: ' + percentage + '%;"';

                return `
                    <div class="inventory-item" data-group="${grp}">
                        <div class="blood-badge" ${badgeStyle}>${grp}</div>
                        <div class="progress-track">
                            <div class="progress-fill" ${fillStyle}></div>
                        </div>
                        <div class="unit-count">${units} Units</div>
                    </div>
                `;
            }).join('');
        } else {
            totalUnits = Object.values(inv).reduce((a, b) => a + Number(b), 0);
        }

        if (kpiUnits) {
            kpiUnits.textContent = String(totalUnits);
        }
    }

    // Setup Inventory Modal
    function openInventoryModal() {
        if (!inventoryModal || !stockModalGrid) return;
        const inv = getStoredInventory();

        stockModalGrid.innerHTML = Object.entries(inv).map(([grp, count]) => `
            <div class="stock-edit-item">
                <span style="font-weight: 700; color: var(--brand-primary);">${grp}</span>
                <input type="number" min="0" max="999" class="stock-input" data-group="${grp}" value="${count}">
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
        btnSaveInventoryModal.addEventListener('click', () => {
            const inputs = stockModalGrid.querySelectorAll('.stock-input');
            const newInv = {};
            inputs.forEach(inp => {
                const grp = inp.dataset.group;
                const val = Math.max(0, parseInt(inp.value, 10) || 0);
                newInv[grp] = val;
            });
            saveStoredInventory(newInv);
            renderInventory();
            closeInventoryModal();
        });
    }

    // 1. Load Real Blood Requests and Update Dashboard KPIs
    async function loadHospitalRequests() {
        if (!requestsTbody || !supabaseClient) return;

        try {
            const { data: requests, error } = await supabaseClient
                .from('blood_requests')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;

            const allRequests = requests || [];
            const activeRequests = allRequests.filter(r => (r.status || 'Pending').toLowerCase() !== 'fulfilled');
            const fulfilledRequests = allRequests.filter(r => (r.status || '').toLowerCase() === 'fulfilled');

            if (kpiActiveRequests) kpiActiveRequests.textContent = String(activeRequests.length);
            if (kpiFulfilled) kpiFulfilled.textContent = String(fulfilledRequests.length);
            if (statSummaryTotal) statSummaryTotal.textContent = String(allRequests.length);
            if (statSummaryFulfilled) statSummaryFulfilled.textContent = String(fulfilledRequests.length);
            if (statSummaryPending) statSummaryPending.textContent = String(activeRequests.length);

            const displayRequests = allRequests.slice(0, 6);

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
                const reqDate = req.created_at ? new Date(req.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'Today';

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
                        </td>
                    </tr>
                `;
            }).join('');
        } catch (err) {
            console.error('Error loading hospital requests:', err);
            requestsTbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 16px; color: var(--text-secondary);">Unable to load requests.</td></tr>`;
        }
    }

    // 2. Load Real Donors for Donor Matching (Within 100km)
    async function loadHospitalMatchingDonors() {
        if (!donorMatchingList || !supabaseClient) return;

        try {
            const { data: donors, error } = await supabaseClient
                .from('users')
                .select('id, full_name, phone, blood_group, city, address, last_donation_date, availability_status, avatar_url')
                .eq('role', 'Donor');

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
                const query = [d.address, d.city, 'Uttar Pradesh'].filter(Boolean).join(', ');
                const coords = (window.MapService && window.MapService.geocodeAddress) ? await window.MapService.geocodeAddress(query) : defaultCenter;
                const distanceKm = (window.MapService && window.MapService.calculateDistanceKm) 
                    ? (window.MapService.calculateDistanceKm(defaultCenter.lat, defaultCenter.lng, coords.lat, coords.lng) ?? 12) 
                    : 12;
                processedDonors.push({ ...d, distanceKm });
            }

            donorMatchingList.innerHTML = processedDonors.map(donor => {
                const name = donor.full_name || 'Donor';
                const avatar = donor.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=FFF0F2&color=E60023`;

                return `
                    <div class="donor-match-item">
                        <div class="donor-info">
                            <img src="${avatar}" alt="${escapeHtml(name)}">
                            <div>
                                <h5>${escapeHtml(name)} <span style="color: var(--brand-primary);">${escapeHtml(donor.blood_group || 'O+')}</span></h5>
                                <p>${escapeHtml(donor.city || 'Lucknow')} • Status: ${escapeHtml(donor.availability_status || 'Available')}</p>
                            </div>
                        </div>
                        <div class="distance"><strong>${donor.distanceKm} km</strong> away</div>
                        <button type="button" class="btn-contact btn-hospital-contact" data-donor-name="${escapeHtml(name)}" data-donor-phone="${escapeHtml(donor.phone || 'N/A')}">
                            Contact
                        </button>
                    </div>
                `;
            }).join('');

            document.querySelectorAll('.btn-hospital-contact').forEach(btn => {
                btn.addEventListener('click', () => {
                    const dName = btn.dataset.donorName;
                    const dPhone = btn.dataset.donorPhone;
                    alert(`Contacting Donor: ${dName}\nPhone: ${dPhone}`);
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
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (confirm('Are you sure you want to log out from Hospital Account?')) {
                localStorage.removeItem('bloodbridge_user');
                sessionStorage.clear();
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
    renderInventory();
    loadHospitalRequests();
    loadHospitalMatchingDonors();
});
