document.addEventListener('DOMContentLoaded', () => {
    const client = window.bloodBridgeSupabase;
    const content = document.getElementById('admin-content');
    const toolbar = document.getElementById('admin-toolbar');
    const errorBox = document.getElementById('admin-error');
    const title = document.getElementById('page-title');
    const section = new URLSearchParams(window.location.search).get('section') || 'users';

    const names = {
        users: 'Users', donors: 'Donors', requests: 'Blood Requests', hospitals: 'Hospitals',
        donations: 'Donations', notifications: 'Notifications', reports: 'Reports',
        audit: 'Audit Logs', settings: 'System Settings'
    };
    title.textContent = names[section] || 'Admin Management';
    document.querySelector(`[data-section="${section}"]`)?.classList.add('active');

    const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    const shortId = (id) => id ? `#${String(id).slice(0, 8).toUpperCase()}` : '-';
    const date = (value) => value ? new Date(value).toLocaleString() : '-';
    const status = (value) => `<span class="status ${escapeHtml(String(value || 'unknown').toLowerCase())}">${escapeHtml(value || 'Unknown')}</span>`;
    const showError = (message) => { errorBox.textContent = message; errorBox.style.display = 'block'; };
    const clearError = () => { errorBox.textContent = ''; errorBox.style.display = 'none'; };

    async function rpc(name, args = {}) {
        const { data, error } = await client.rpc(name, args);
        if (error) throw error;
        return data || [];
    }

    function setToolbar({ search = true, filters = [] } = {}) {
        const existingValues = {};
        toolbar.querySelectorAll('input, select').forEach((element) => { existingValues[element.id] = element.value; });
        toolbar.innerHTML = '';
        if (search) toolbar.innerHTML += '<input id="table-search" placeholder="Search this section…">';
        filters.forEach((filter) => {
            toolbar.innerHTML += `<select id="${filter.id}">${filter.options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join('')}</select>`;
        });
        toolbar.innerHTML += '<button class="btn-primary" id="apply-filters">Apply filters</button>';
        Object.entries(existingValues).forEach(([id, value]) => { const element = document.getElementById(id); if (element) element.value = value; });
        document.getElementById('apply-filters').addEventListener('click', load);
    }

    function renderTable(headers, rows, empty = 'No records found.') {
        if (!rows.length) { content.innerHTML = `<div class="empty">${empty}</div>`; return; }
        content.innerHTML = `<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
    }

    async function loadUsers(roleFilter = null) {
        setToolbar({ filters: [{ id: 'role-filter', options: [{ value: '', label: 'All roles' }, { value: 'Donor', label: 'Donors' }, { value: 'Requester', label: 'Requesters' }, { value: 'Hospital', label: 'Hospitals' }, { value: 'Admin', label: 'Admins' }] }] });
        document.getElementById('role-filter').value = roleFilter || '';
        const search = document.getElementById('table-search')?.value || '';
        const rows = await rpc('admin_list_users', { role_filter: roleFilter || document.getElementById('role-filter')?.value || null, search_text: search });
        renderTable(['User', 'Role', 'Blood group', 'Location', 'Phone', 'Availability', 'Account', 'Created'], rows.map((u) => `<tr><td><strong>${escapeHtml(u.full_name)}</strong><br><small>${shortId(u.id)}</small></td><td>${status(u.role)}</td><td>${escapeHtml(u.blood_group || '-')}</td><td>${escapeHtml([u.city].filter(Boolean).join(', ') || '-')}</td><td>${escapeHtml(u.phone || '-')}</td><td>${status(u.is_available ? 'Available' : 'Unavailable')}</td><td>${status(u.account_status || 'active')}</td><td>${date(u.created_at)}</td></tr>`));
    }

    async function loadDonors() {
        setToolbar();
        const search = document.getElementById('table-search')?.value || '';
        const rows = await rpc('admin_list_users', { role_filter: 'Donor', search_text: search });
        renderTable(['Donor', 'Blood group', 'Location', 'Phone', 'Availability', 'Last updated'], rows.map((u) => `<tr><td><strong>${escapeHtml(u.full_name)}</strong><br><small>${shortId(u.id)}</small></td><td>${escapeHtml(u.blood_group || '-')}</td><td>${escapeHtml(u.city || '-')}</td><td>${escapeHtml(u.phone || '-')}</td><td>${status(u.is_available ? 'Available' : 'Unavailable')}</td><td>${date(u.created_at)}</td></tr>`));
    }

    async function loadRequests() {
        setToolbar({ filters: [{ id: 'status-filter', options: [{ value: '', label: 'All statuses' }, 'open', 'matched', 'fulfilled', 'expired', 'cancelled'].map((v) => typeof v === 'string' ? { value: v, label: v } : v) }] });
        const search = document.getElementById('table-search')?.value || '';
        const filter = document.getElementById('status-filter')?.value || null;
        const rows = await rpc('admin_list_requests', { status_filter: filter, search_text: search });
        renderTable(['Request', 'Patient', 'Blood', 'Units', 'Hospital', 'Urgency', 'Status', 'Responses', 'Created', 'Action'], rows.map((r) => `<tr><td>${shortId(r.id)}</td><td>${escapeHtml(r.patient_name)}</td><td>${escapeHtml(r.blood_group)}</td><td>${escapeHtml(r.units)}</td><td>${escapeHtml(r.hospital_name)}<br><small>${escapeHtml(r.city)}</small></td><td>${status(r.urgency)}</td><td>${status(r.status)}</td><td>${escapeHtml(r.response_count)}</td><td>${date(r.created_at)}</td><td><select class="request-status" data-id="${escapeHtml(r.id)}"><option value="">Change</option><option value="open">Open</option><option value="matched">Matched</option><option value="fulfilled">Fulfilled</option><option value="expired">Expired</option><option value="cancelled">Cancelled</option></select></td></tr>`));
        document.querySelectorAll('.request-status').forEach((el) => el.addEventListener('change', async () => { if (!el.value) return; await performAction('admin_set_request_status', { request_id_input: el.dataset.id, status_input: el.value }); }));
    }

    async function loadHospitals() {
        setToolbar();
        const search = document.getElementById('table-search')?.value || '';
        const rows = await rpc('admin_list_hospitals', { search_text: search });
        renderTable(['Hospital', 'Location', 'Type', 'Phone', 'Verification', 'Inventory units', 'Created', 'Action'], rows.map((h) => `<tr><td><strong>${escapeHtml(h.full_name)}</strong><br><small>${shortId(h.id)}</small></td><td>${escapeHtml([h.city, h.state].filter(Boolean).join(', ') || '-')}</td><td>${escapeHtml(h.hospital_type || '-')}</td><td>${escapeHtml(h.phone || '-')}</td><td>${status(h.verification_status)}</td><td>${escapeHtml(h.inventory_units)}</td><td>${date(h.created_at)}</td><td><select class="hospital-status" data-id="${escapeHtml(h.id)}"><option value="">Change</option><option value="pending">Pending</option><option value="verified">Verified</option><option value="rejected">Rejected</option><option value="suspended">Suspended</option></select></td></tr>`));
        document.querySelectorAll('.hospital-status').forEach((el) => el.addEventListener('change', async () => { if (!el.value) return; await performAction('admin_set_hospital_verification', { hospital_id_input: el.dataset.id, status_input: el.value }); }));
    }

    async function loadDonations() {
        setToolbar();
        const rows = await rpc('admin_list_donations', { search_text: document.getElementById('table-search')?.value || '' });
        renderTable(['Donation', 'Request', 'Donor', 'Blood', 'Hospital', 'Units', 'Status', 'Donated at', 'Created'], rows.map((d) => `<tr><td>${shortId(d.response_id)}</td><td>${shortId(d.request_id)}</td><td>${escapeHtml(d.donor_name || '-')}<br><small>${shortId(d.donor_id)}</small></td><td>${escapeHtml(d.blood_group || '-')}</td><td>${escapeHtml(d.hospital_name)}</td><td>${escapeHtml(d.units)}</td><td>${status(d.status)}</td><td>${date(d.donated_at)}</td><td>${date(d.created_at)}</td></tr>`));
    }

    async function loadNotifications() {
        setToolbar();
        const rows = await rpc('admin_list_notifications');
        renderTable(['Notification', 'User', 'Type', 'Message', 'Read', 'Created'], rows.map((n) => `<tr><td><strong>${escapeHtml(n.title)}</strong><br><small>${shortId(n.id)}</small></td><td>${escapeHtml(n.user_name || '-')}<br><small>${shortId(n.user_id)}</small></td><td>${escapeHtml(n.type)}</td><td>${escapeHtml(n.body)}</td><td>${n.read_at ? date(n.read_at) : status('Unread')}</td><td>${date(n.created_at)}</td></tr>`));
    }

    async function loadReports() {
        setToolbar({ filters: [{ id: 'report-status', options: [{ value: '', label: 'All statuses' }, 'open', 'in_progress', 'resolved'].map((v) => typeof v === 'string' ? { value: v, label: v } : v) }] });
        const rows = await rpc('admin_list_reports', { status_filter: document.getElementById('report-status')?.value || null });
        renderTable(['Report', 'User', 'Subject', 'Message', 'Status', 'Created', 'Action'], rows.map((r) => `<tr><td>${shortId(r.id)}</td><td>${shortId(r.user_id)}<br><small>${escapeHtml(r.email || '')}</small></td><td>${escapeHtml(r.subject)}</td><td>${escapeHtml(r.message)}</td><td>${status(r.status)}</td><td>${date(r.created_at)}</td><td><select class="report-status" data-id="${escapeHtml(r.id)}"><option value="">Change</option><option value="open">Open</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option></select></td></tr>`));
        document.querySelectorAll('.report-status').forEach((el) => el.addEventListener('change', async () => { if (!el.value) return; await performAction('admin_set_report_status', { report_id_input: el.dataset.id, status_input: el.value }); }));
    }

    async function loadAudit() {
        setToolbar({ search: false });
        const rows = await rpc('admin_list_audit_logs');
        renderTable(['Time', 'Admin', 'Action', 'Target', 'Old values', 'New values'], rows.map((r) => `<tr><td>${date(r.created_at)}</td><td>${escapeHtml(r.admin_name || shortId(r.admin_user_id))}</td><td>${escapeHtml(r.action)}</td><td>${escapeHtml(r.target_type || '-')}<br><small>${shortId(r.target_id)}</small></td><td><small>${escapeHtml(JSON.stringify(r.old_values || {}))}</small></td><td><small>${escapeHtml(JSON.stringify(r.new_values || {}))}</small></td></tr>`));
    }

    async function loadSettings() {
        setToolbar({ search: false });
        const rows = await rpc('admin_system_status');
        const s = rows[0] || {};
        content.innerHTML = `<div class="system-grid"><div class="system-card">Database<strong>${status(s.database_status)}</strong></div><div class="system-card">Registered users<strong>${escapeHtml(s.authenticated_users)}</strong></div><div class="system-card">Open requests<strong>${escapeHtml(s.open_requests)}</strong></div><div class="system-card">Unread notifications<strong>${escapeHtml(s.unread_notifications)}</strong></div><div class="system-card">Last activity<strong>${date(s.last_activity)}</strong></div></div>`;
    }

    async function performAction(name, args) {
        clearError();
        try { await rpc(name, args); await load(); } catch (error) { showError(error.message || 'Action failed'); }
    }

    async function load() {
        clearError();
        content.innerHTML = '<div class="empty">Loading admin data…</div>';
        try {
            if (section === 'users') await loadUsers();
            else if (section === 'donors') await loadDonors();
            else if (section === 'requests') await loadRequests();
            else if (section === 'hospitals') await loadHospitals();
            else if (section === 'donations') await loadDonations();
            else if (section === 'notifications') await loadNotifications();
            else if (section === 'reports') await loadReports();
            else if (section === 'audit') await loadAudit();
            else if (section === 'settings') await loadSettings();
            else content.innerHTML = '<div class="empty">Choose an admin section.</div>';
        } catch (error) { showError(error.message || 'Unable to load admin data. Apply the admin migrations first.'); content.innerHTML = '<div class="empty">No data loaded.</div>'; }
    }

    document.getElementById('refresh-btn').addEventListener('click', load);
    document.getElementById('admin-logout').addEventListener('click', async (event) => { event.preventDefault(); await client.auth.signOut(); window.location.href = 'auth.html'; });
    load();
});
