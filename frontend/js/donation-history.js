// frontend/js/donation-history.js
// Displays donor pledges & completed donations with requester names, dates & completion action

document.addEventListener('DOMContentLoaded', async () => {
    const client = window.bloodBridgeSupabase;
    const tbody = document.getElementById('donation-history-tbody');
    const searchInput = document.querySelector('[data-history-search]');
    const filterSelect = document.querySelector('[data-history-filter]');
    const exportButton = document.getElementById('download-donation-report');
    let rows = [];

    if (!client?.auth || !tbody) return;

    const { data: sessionData } = await client.auth.getSession();
    const user = sessionData?.session?.user;
    if (!user) {
        tbody.innerHTML = '<tr><td colspan="8" style="padding: 32px; text-align: center; color: var(--text-secondary);">Please log in to view donation history.</td></tr>';
        return;
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
    }

    function formatDate(dateStr) {
        if (!dateStr) return '-';
        try {
            const d = new Date(dateStr);
            if (Number.isNaN(d.getTime())) return dateStr;
            return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        } catch (_) {
            return dateStr;
        }
    }

    // Load donation history
    async function loadDonationHistory() {
        rows = [];
        let loadedViaApi = false;

        // 1. Try fetching from Backend API
        try {
            const response = await fetch(`/api/requests/donor-history/${user.id}`, {
                headers: {
                    'Authorization': `Bearer ${sessionData?.session?.access_token || ''}`
                }
            });
            const result = await response.json();
            if (result.success && Array.isArray(result.data)) {
                rows = result.data;
                loadedViaApi = true;
            }
        } catch (apiErr) {
            console.warn('API donor history fallback to Supabase:', apiErr);
        }

        // 2. Fallback direct Supabase Query
        if (!loadedViaApi) {
            try {
                const { data, error } = await client
                    .from('request_responses')
                    .select('id, status, donated_at, created_at, request_id, blood_requests(id, patient_name, blood_group, units, hospital_name, city, required_date, requester_id)')
                    .eq('donor_id', user.id)
                    .in('status', ['accepted', 'donated', 'fulfilled', 'completed'])
                    .order('created_at', { ascending: false });

                if (!error && data) {
                    // Fetch requester names
                    const requesterIds = [...new Set(data.map(r => r.blood_requests?.requester_id).filter(Boolean))];
                    let requesterMap = {};

                    if (requesterIds.length > 0) {
                        const { data: requesters } = await client
                            .from('users')
                            .select('id, full_name')
                            .in('id', requesterIds);

                        if (requesters) {
                            requesters.forEach(u => { requesterMap[u.id] = u.full_name; });
                        }
                    }

                    rows = data.map(r => {
                        const reqData = r.blood_requests || {};
                        return {
                            id: r.id,
                            request_id: r.request_id,
                            status: r.status,
                            donated_at: r.donated_at,
                            created_at: r.created_at,
                            patient_name: reqData.patient_name || 'Patient',
                            requester_name: requesterMap[reqData.requester_id] || 'Requester',
                            hospital_name: reqData.hospital_name || 'Hospital',
                            city: reqData.city || '',
                            blood_group: reqData.blood_group || '-',
                            units: reqData.units || 1,
                            required_date: reqData.required_date
                        };
                    });
                }
            } catch (sbErr) {
                console.error('Supabase fallback error:', sbErr);
            }
        }

        await updateStats();
        render();
    }

    async function updateStats() {
        let stats = null;
        if (window.BloodMatchData?.getDonorStats && user?.id) {
            stats = await BloodMatchData.getDonorStats(user.id);
        }

        const completedDonations = rows.filter(r => ['donated', 'fulfilled', 'completed', 'accepted'].includes(r.status));
        const totalDonations = stats ? stats.totalDonations : completedDonations.length;
        const totalUnits = stats ? stats.totalUnits : (completedDonations.reduce((sum, r) => sum + (Number(r.units) || 1), 0) || totalDonations);
        const livesImpacted = stats ? stats.livesImpacted : totalDonations * 3;

        const totalDonationsEl = document.getElementById('history-total-donations');
        const totalUnitsEl = document.getElementById('history-total-units');
        const livesImpactedEl = document.getElementById('history-lives-impacted');
        const nextEligibleEl = document.getElementById('history-next-eligible');

        if (totalDonationsEl) totalDonationsEl.textContent = String(totalDonations);
        if (totalUnitsEl) totalUnitsEl.textContent = String(totalUnits);
        if (livesImpactedEl) livesImpactedEl.textContent = String(livesImpacted);

        if (nextEligibleEl) {
            if (stats) {
                if (stats.isEligible) {
                    nextEligibleEl.innerHTML = '<span style="color:var(--status-available, #10B981);font-weight:700;">Eligible Now ✔</span>';
                } else {
                    const formatted = window.BloodMatchData?.formatDateTime ? BloodMatchData.formatDateTime(stats.nextEligibleDate) : new Date(stats.nextEligibleDate).toLocaleDateString();
                    nextEligibleEl.innerHTML = `<span style="color:var(--status-pending, #F59E0B);font-weight:700;">${formatted}</span> <small style="display:block;font-size:0.75rem;color:var(--text-secondary);">(${stats.daysRemaining} days cooling period)</small>`;
                }
            } else {
                nextEligibleEl.innerHTML = '<span style="color:var(--status-available, #10B981);font-weight:700;">Eligible Now ✔</span>';
            }
        }

        if (stats && window.BloodMatchData?.renderDonorStats) {
            BloodMatchData.renderDonorStats(stats);
        }
    }

    function render() {
        const query = (searchInput?.value || '').toLowerCase().trim();
        const period = filterSelect?.value || 'all';
        const now = new Date();

        const visible = rows.filter((row) => {
            const searchable = `${row.hospital_name || ''} ${row.patient_name || ''} ${row.requester_name || ''} ${row.blood_group || ''} ${row.id}`.toLowerCase();
            if (query && !searchable.includes(query)) return false;

            const recordDate = new Date(row.donated_at || row.created_at);
            if (period === 'year' && recordDate.getFullYear() !== now.getFullYear()) return false;
            if (period === 'last-year' && recordDate.getFullYear() !== now.getFullYear() - 1) return false;
            return true;
        });

        if (!visible.length) {
            tbody.innerHTML = '<tr><td colspan="8" style="padding: 32px; text-align: center; color: var(--text-secondary);">No donation records found. Active pledges and completed donations will appear here.</td></tr>';
            return;
        }

        tbody.innerHTML = visible.map((row) => {
            const isDonated = row.status === 'donated';
            const displayDate = isDonated ? formatDate(row.donated_at) : (formatDate(row.required_date) || formatDate(row.created_at));
            const dateSubtitle = isDonated ? 'Donated on' : 'Pledged on';

            return `<tr>
                <td><strong>#${escapeHtml(String(row.id).slice(0, 8).toUpperCase())}</strong></td>
                <td>
                    <div style="font-weight: 600;">${escapeHtml(displayDate)}</div>
                    <div style="font-size: 0.75rem; color: var(--text-secondary);">${dateSubtitle}</div>
                </td>
                <td>
                    <div style="font-weight: 600; color: var(--text-dark);">👤 ${escapeHtml(row.patient_name)}</div>
                    <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 2px;">Requested by: <strong>${escapeHtml(row.requester_name)}</strong></div>
                </td>
                <td>
                    <div class="hospital-col">
                        <div class="hospital-icon">🏥</div>
                        <div>
                            <div style="font-weight: 600;">${escapeHtml(row.hospital_name || 'Hospital')}</div>
                            <div style="font-size: 0.75rem; color: var(--text-secondary);">${escapeHtml(row.city || '')}</div>
                        </div>
                    </div>
                </td>
                <td class="blood-type-col" style="font-size: 1rem;">🩸 ${escapeHtml(row.blood_group || '-')}</td>
                <td><strong>${Number(row.units || 1)}</strong> ${Number(row.units) > 1 ? 'Units' : 'Unit'}</td>
                <td>
                    ${isDonated
                        ? '<span class="status-tag tag-completed">Donated ✔</span>'
                        : '<span class="status-tag tag-pending">Pledged ⏳</span>'
                    }
                </td>
                <td>
                    ${isDonated
                        ? '<span class="cert-btn" style="color:var(--status-available);font-weight:600;cursor:default;">✔ Recorded</span>'
                        : `<button type="button" class="btn btn-primary btn-mark-complete" data-req-id="${row.request_id}" data-patient="${escapeHtml(row.patient_name)}" style="padding:6px 12px;font-size:0.8rem;border-radius:6px;background:var(--brand-primary);color:white;border:none;cursor:pointer;font-weight:600;">✔ Mark Donated</button>`
                    }
                </td>
            </tr>`;
        }).join('');

        // Attach event listeners to "Mark Donated" buttons
        tbody.querySelectorAll('.btn-mark-complete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const reqId = btn.dataset.reqId;
                const patient = btn.dataset.patient;

                const confirmed = confirm(`Have you successfully donated blood for ${patient} at the hospital?\n\nClick OK to verify and mark this donation as completed in your records.`);
                if (!confirmed) return;

                btn.disabled = true;
                btn.textContent = 'Saving... ⏳';

                let success = false;

                // 1. Try Backend API
                try {
                    const res = await fetch(`/api/requests/${reqId}/complete`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${sessionData?.session?.access_token || ''}`
                        },
                        body: JSON.stringify({ donor_id: user.id })
                    });
                    const resData = await res.json();
                    if (resData.success) {
                        success = true;
                    }
                } catch (err) {
                    console.warn('API complete fallback:', err);
                }

                // 2. Direct Supabase Fallback
                if (!success) {
                    try {
                        const nowIso = new Date().toISOString();
                        await client.from('request_responses').update({ status: 'donated', donated_at: nowIso }).eq('request_id', reqId).eq('donor_id', user.id);
                        await client.from('blood_requests').update({ status: 'fulfilled' }).eq('id', reqId);
                        await client.from('users').update({ last_donation_date: nowIso.split('T')[0] }).eq('id', user.id);
                        success = true;
                    } catch (sbErr) {
                        console.error('Supabase complete error:', sbErr);
                    }
                }

                if (success) {
                    alert(`🎉 Thank you! Your blood donation for ${patient} has been successfully verified and recorded in your Donation History!`);
                    await loadDonationHistory();
                } else {
                    alert('Unable to mark donation as completed. Please check your connection and try again.');
                    btn.disabled = false;
                    btn.textContent = '✔ Mark Donated';
                }
            });
        });
    }

    function downloadCsv() {
        if (!rows.length) return alert('There is no donation data to export.');
        const header = ['Donation ID', 'Date', 'Patient Name', 'Requester Name', 'Hospital', 'City', 'Blood Group', 'Units', 'Status'];
        const csvRows = rows.map((row) => {
            const date = row.donated_at || row.created_at;
            return [
                row.id,
                date,
                row.patient_name || '',
                row.requester_name || '',
                row.hospital_name || '',
                row.city || '',
                row.blood_group || '',
                row.units || 1,
                row.status
            ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',');
        });
        const blob = new Blob([[header.join(','), ...csvRows].join('\n')], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `blood-bridge-donation-history-${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    }

    searchInput?.addEventListener('input', render);
    filterSelect?.addEventListener('change', render);
    exportButton?.addEventListener('click', downloadCsv);

    loadDonationHistory();
});
