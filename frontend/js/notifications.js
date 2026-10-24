document.addEventListener('DOMContentLoaded', async () => {
    const client = window.bloodBridgeSupabase;
    const container = document.getElementById('notifications-container');
    const markAllButton = document.querySelector('.mark-read-btn');
    const searchInput = document.querySelector('.search-bar input');
    const tabs = [...document.querySelectorAll('.tabs-container .tab')];
    if (!client?.auth || !container) return;
    const { data: sessionData } = await client.auth.getSession();
    const user = sessionData?.session?.user;
    if (!user) return;

    let notifications = [];
    let activeFilter = 'all';
    let searchTerm = '';

    const escapeHtml = (value) => String(value || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

    const iconFor = (type) => ({ request: ['🩸', 'icon-urgent'], response: ['👤', 'icon-info'], badge_earned: ['🏆', 'icon-system'], system: ['✔', 'icon-success'] }[type] || ['🔔', 'icon-info']);

    function filteredNotifications() {
        return notifications.filter((item) => {
            const matchesFilter = activeFilter === 'all'
                || (activeFilter === 'unread' && !item.read_at)
                || (activeFilter === 'requests' && ['request', 'response'].includes(item.type))
                || (activeFilter === 'system' && !['request', 'response'].includes(item.type));
            const haystack = `${item.title} ${item.body}`.toLowerCase();
            return matchesFilter && haystack.includes(searchTerm);
        });
    }

    function render() {
        const items = filteredNotifications();
        tabs.forEach((tab) => {
            const count = tab.querySelector('.tab-count');
            if (!count) return;
            const filter = tab.dataset.filter;
            const value = filter === 'all' ? notifications.length : filter === 'unread' ? notifications.filter((item) => !item.read_at).length : notifications.filter((item) => filter === 'requests' ? ['request', 'response'].includes(item.type) : !['request', 'response'].includes(item.type)).length;
            count.hidden = value === 0;
            count.textContent = String(value);
        });
        if (!items.length) {
            container.innerHTML = '<div style="padding: 32px; text-align: center; color: var(--text-secondary);">No notifications found.</div>';
            return;
        }
        container.innerHTML = items.map((item) => {
            const [icon, iconClass] = iconFor(item.type);
            return `<article class="notification-item${item.read_at ? '' : ' unread'}" data-id="${item.id}">
                <div class="notif-icon-container ${iconClass}">${icon}</div>
                <div class="notif-content">
                    <h4>${escapeHtml(item.title)}</h4>
                    <p>${escapeHtml(item.body)}</p>
                    <div class="notif-actions">
                        ${item.link ? `<a class="btn-action btn-primary notification-link" href="${escapeHtml(item.link)}" data-id="${item.id}">Open</a>` : ''}
                        ${!item.read_at ? `<button class="btn-action btn-outline mark-one" data-id="${item.id}">Mark as read</button>` : ''}
                    </div>
                    <div class="notif-time" style="margin-top: 12px;">⏱️ ${BloodMatchData.formatDateTime(item.created_at)}</div>
                </div>
                ${item.read_at ? '' : '<div class="unread-dot"></div>'}
            </article>`;
        }).join('');

        container.querySelectorAll('.mark-one, .notification-link').forEach((element) => {
            element.addEventListener('click', async () => {
                await markRead(element.dataset.id);
            });
        });
    }

    async function markRead(id) {
        const { error } = await client.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
        if (!error) {
            const item = notifications.find((notification) => notification.id === id);
            if (item) item.read_at = new Date().toISOString();
            render();
            BloodMatchData.syncUnreadBadges();
        }
    }

    async function loadNotifications() {
        const { data, error } = await client.from('notifications').select('id, type, title, body, link, read_at, created_at').order('created_at', { ascending: false });
        if (error) {
            container.innerHTML = '<div style="padding: 32px; text-align: center; color: var(--text-secondary);">Notifications are not available yet.</div>';
            return;
        }
        notifications = data || [];
        render();
        BloodMatchData.syncUnreadBadges();
    }

    tabs.forEach((tab) => tab.addEventListener('click', () => {
        tabs.forEach((item) => item.classList.remove('active'));
        tab.classList.add('active');
        activeFilter = tab.dataset.filter || 'all';
        render();
    }));
    if (searchInput) searchInput.addEventListener('input', () => { searchTerm = searchInput.value.trim().toLowerCase(); render(); });
    if (markAllButton) markAllButton.addEventListener('click', async () => {
        const { error } = await client.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null);
        if (!error) { notifications.forEach((item) => { item.read_at = item.read_at || new Date().toISOString(); }); render(); BloodMatchData.syncUnreadBadges(); }
    });

    client.channel(`notifications-page-${user.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, loadNotifications)
        .subscribe();
    await loadNotifications();
});
