// frontend/js/chat.js
/**
 * Blood Bridge — Live In-App Chat & Real-Time Messaging Controller
 * Manages conversations between Requester ↔ Donor, Hospital ↔ Donor,
 * Blood Bank ↔ Donor, and Blood Bank ↔ Hospital.
 */

document.addEventListener('DOMContentLoaded', async () => {
    const supabaseClient = window.bloodBridgeSupabase;

    // DOM Elements
    const convListEl = document.getElementById('conversations-list');
    const convCountBadge = document.getElementById('conv-count-badge');
    const searchInput = document.getElementById('conv-search-input');
    const tabButtons = document.querySelectorAll('.conv-tab');

    const chatEmptyState = document.getElementById('chat-empty-state');
    const activeChatHeader = document.getElementById('active-chat-header');
    const quickChipsBar = document.getElementById('quick-chips-bar');
    const messagesStream = document.getElementById('messages-stream');
    const chatInputBar = document.getElementById('chat-input-bar');
    const chatLockedNotice = document.getElementById('chat-locked-notice');

    const headerAvatar = document.getElementById('header-avatar');
    const headerName = document.getElementById('header-name');
    const headerRole = document.getElementById('header-role');
    const headerBlood = document.getElementById('header-blood');
    const headerCity = document.getElementById('header-city');
    const headerLifecycleBadge = document.getElementById('header-lifecycle-badge');
    const headerReqInfo = document.getElementById('header-req-info');
    const btnCompleteDonation = document.getElementById('btn-chat-complete-donation');
    const messageInput = document.getElementById('message-input');
    const btnSend = document.getElementById('btn-send-message');
    const btnCallHelpline = document.getElementById('btn-call-helpline');

    const sidebarSubRequesters = document.getElementById('sidebar-sub-requesters');
    const sidebarSubDonors = document.getElementById('sidebar-sub-donors');

    const currentUserNameEl = document.getElementById('current-user-name');
    const currentUserRoleEl = document.getElementById('current-user-role');

    // State
    let currentUserId = null;
    let currentUserProfile = null;
    let activeConversation = null;
    let conversations = [];
    let activeFilter = 'all';
    let realtimeChannel = null;
    let pollingInterval = null;

    // 1. Authenticate & initialize user
    async function initUser() {
        if (!supabaseClient?.auth) {
            alert('Supabase client unavailable. Please refresh.');
            return false;
        }

        const { data: sessionData } = await supabaseClient.auth.getSession();
        const user = sessionData?.session?.user;
        if (!user) {
            // Not logged in -> redirect to login
            alert('Please sign in to access Blood Bridge live chat.');
            window.location.href = 'auth.html?mode=login';
            return false;
        }

        currentUserId = user.id;

        // Fetch current user details
        const { data: profile } = await supabaseClient
            .from('users')
            .select('*')
            .eq('id', currentUserId)
            .maybeSingle();

        currentUserProfile = profile || { full_name: user.email?.split('@')[0] || 'User', role: 'User' };

        if (currentUserNameEl) currentUserNameEl.textContent = currentUserProfile.full_name || 'My Account';
        if (currentUserRoleEl) currentUserRoleEl.textContent = currentUserProfile.role || 'Member';

        return true;
    }

    // 2. Load conversations for current user
    async function loadConversations(autoSelectId = null) {
        try {
            const { data: sessionData } = await supabaseClient.auth.getSession();
            const token = sessionData?.session?.access_token;

            const res = await fetch(`/api/chat/conversations?user_id=${currentUserId}`, {
                headers: token ? { 'Authorization': `Bearer ${token}` } : {}
            });

            const result = await res.json();
            if (!result.success) throw new Error(result.error);

            conversations = result.data || [];
            renderConversationsList();

            if (autoSelectId) {
                const target = conversations.find(c => c.id === autoSelectId);
                if (target) selectConversation(target);
            } else if (activeConversation) {
                const updated = conversations.find(c => c.id === activeConversation.id);
                if (updated) activeConversation = updated;
            }
        } catch (err) {
            console.error('Error loading conversations:', err);
            convListEl.innerHTML = `
                <div style="text-align: center; padding: 30px 16px; color: var(--text-secondary); font-size: 0.85rem;">
                    Failed to load conversations.<br>
                    <button id="btn-retry-convs" style="margin-top: 10px; background: var(--brand-primary); color: white; border: none; padding: 6px 14px; border-radius: 6px; cursor: pointer;">Retry</button>
                </div>
            `;
            document.getElementById('btn-retry-convs')?.addEventListener('click', () => loadConversations());
        }
    }

    // 3. Render Conversations in sidebar list
    function renderConversationsList() {
        const query = searchInput?.value.trim().toLowerCase() || '';

        const filtered = conversations.filter(conv => {
            const other = conv.other_user || {};
            const matchesQuery = !query ||
                (other.full_name && other.full_name.toLowerCase().includes(query)) ||
                (conv.last_message_text && conv.last_message_text.toLowerCase().includes(query));

            if (!matchesQuery) return false;

            if (activeFilter === 'requesters') {
                return conv.other_user_type === 'requester';
            }
            if (activeFilter === 'donors') {
                return conv.other_user_type === 'donor';
            }
            return true;
        });

        if (convCountBadge) {
            convCountBadge.textContent = `${filtered.length} chat${filtered.length === 1 ? '' : 's'}`;
        }

        if (filtered.length === 0) {
            const filterLabel = activeFilter === 'requesters' ? 'requesters' : activeFilter === 'donors' ? 'donors' : 'contacts';
            convListEl.innerHTML = `
                <div style="text-align: center; padding: 40px 20px; color: var(--text-secondary); font-size: 0.88rem;">
                    <p style="font-size: 1.8rem; margin-bottom: 8px;">💬</p>
                    <strong>No ${filterLabel} conversations found</strong>
                    <p style="font-size: 0.78rem; margin-top: 4px;">Accepted requests from Nearby Requests will appear here for live coordination.</p>
                </div>
            `;
            return;
        }

        convListEl.innerHTML = filtered.map(conv => {
            const other = conv.other_user || {};
            const isActive = activeConversation && activeConversation.id === conv.id;
            const initials = getInitials(other.full_name || 'User');
            const unreadBadge = conv.unread_count > 0 ? `<span class="conv-unread">${conv.unread_count}</span>` : '';
            const roleClass = (other.role || '').toLowerCase().includes('donor') ? 'conv-role-donor'
                : (other.role || '').toLowerCase().includes('hospital') ? 'conv-role-hospital' : 'conv-role-bank';

            const timeStr = conv.last_message_at ? formatTime(conv.last_message_at) : '';

            const statusBadge = conv.chat_status === 'concluded'
                ? `<span style="font-size: 0.65rem; background: #F1F5F9; color: #64748B; padding: 1px 6px; border-radius: 4px; font-weight: 600;">🔒 Concluded</span>`
                : (conv.chat_status === 'active'
                    ? `<span style="font-size: 0.65rem; background: #DCFCE7; color: #166534; padding: 1px 6px; border-radius: 4px; font-weight: 600;">🟢 Active</span>`
                    : '');

            return `
                <div class="conv-item ${isActive ? 'active' : ''}" data-conv-id="${conv.id}">
                    <div class="conv-avatar-wrap">
                        ${other.avatar_url
                            ? `<img class="conv-avatar" src="${other.avatar_url}" alt="${escapeHtml(other.full_name)}">`
                            : `<div class="conv-avatar">${initials}</div>`
                        }
                        <span class="conv-online-badge"></span>
                    </div>
                    <div class="conv-body">
                        <div class="conv-body-top">
                            <span class="conv-name">${escapeHtml(other.full_name || 'User')}</span>
                            <span class="conv-time">${timeStr}</span>
                        </div>
                        <div class="conv-body-sub">
                            <span class="conv-role-tag ${roleClass}">${escapeHtml(other.role || 'Member')}</span>
                            ${other.blood_group ? `<span class="conv-blood-tag">🩸 ${escapeHtml(other.blood_group)}</span>` : ''}
                            ${statusBadge}
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
                            <span class="conv-snippet">${escapeHtml(conv.last_message_text || 'Started a conversation')}</span>
                            ${unreadBadge}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        // Attach click handlers
        convListEl.querySelectorAll('.conv-item').forEach(item => {
            item.addEventListener('click', () => {
                const convId = item.dataset.convId;
                const selected = conversations.find(c => c.id === convId);
                if (selected) selectConversation(selected);
            });
        });
    }

    // 4. Select a conversation
    async function selectConversation(conv) {
        activeConversation = conv;
        renderConversationsList();

        // Switch visible panels
        chatEmptyState.style.display = 'none';
        activeChatHeader.style.display = 'flex';
        messagesStream.style.display = 'flex';

        // Check lifecycle status
        const isConcluded = conv.chat_status === 'concluded';
        const isActive = conv.chat_status === 'active';

        if (isConcluded) {
            chatLockedNotice.style.display = 'block';
            chatInputBar.style.display = 'none';
            quickChipsBar.style.display = 'none';
            if (headerLifecycleBadge) {
                headerLifecycleBadge.textContent = '🔒 Concluded (Donation Completed)';
                headerLifecycleBadge.style.background = '#F1F5F9';
                headerLifecycleBadge.style.color = '#475467';
            }
            if (btnCompleteDonation) btnCompleteDonation.style.display = 'none';
        } else if (isActive) {
            chatLockedNotice.style.display = 'none';
            chatInputBar.style.display = 'flex';
            quickChipsBar.style.display = 'flex';
            if (headerLifecycleBadge) {
                headerLifecycleBadge.textContent = '🟢 Active Coordination';
                headerLifecycleBadge.style.background = '#DCFCE7';
                headerLifecycleBadge.style.color = '#166534';
            }
            if (btnCompleteDonation) btnCompleteDonation.style.display = 'inline-flex';
        } else {
            chatLockedNotice.style.display = 'none';
            chatInputBar.style.display = 'flex';
            quickChipsBar.style.display = 'flex';
            if (headerLifecycleBadge) {
                headerLifecycleBadge.textContent = '💬 Direct Chat';
                headerLifecycleBadge.style.background = '#EEF2F6';
                headerLifecycleBadge.style.color = '#475467';
            }
            if (btnCompleteDonation) btnCompleteDonation.style.display = 'none';
        }

        // Update header details
        const other = conv.other_user || {};
        headerName.textContent = other.full_name || 'User';
        headerRole.textContent = other.role || (conv.other_user_type === 'donor' ? 'Donor' : 'Requester');
        headerRole.className = `conv-role-tag ${
            (other.role || '').toLowerCase().includes('donor') ? 'conv-role-donor'
            : (other.role || '').toLowerCase().includes('hospital') ? 'conv-role-hospital' : 'conv-role-bank'
        }`;

        if (other.blood_group) {
            headerBlood.style.display = 'inline';
            headerBlood.textContent = `🩸 ${other.blood_group}`;
        } else {
            headerBlood.style.display = 'none';
        }

        headerCity.textContent = other.city ? `• ${other.city}` : '';

        if (headerReqInfo) {
            if (conv.request_info) {
                headerReqInfo.textContent = `• ${conv.request_info.patient_name} (${conv.request_info.blood_group}) @ ${conv.request_info.hospital_name}`;
            } else {
                headerReqInfo.textContent = '';
            }
        }

        if (other.avatar_url) {
            headerAvatar.innerHTML = `<img src="${other.avatar_url}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
        } else {
            headerAvatar.textContent = getInitials(other.full_name || 'U');
        }

        // Load message history
        await loadMessages(conv.id);

        // Mark messages as read
        markRead(conv.id);
        conv.unread_count = 0;
        renderConversationsList();

        // Focus input if active
        if (!isConcluded) {
            messageInput.focus();
        }
    }

    // 5. Load messages for conversation
    async function loadMessages(convId) {
        messagesStream.innerHTML = `
            <div style="text-align: center; padding: 40px; color: var(--text-secondary); font-size: 0.85rem;">
                Loading messages...
            </div>
        `;

        try {
            const { data: sessionData } = await supabaseClient.auth.getSession();
            const token = sessionData?.session?.access_token;

            const res = await fetch(`/api/chat/messages/${convId}?limit=100`, {
                headers: token ? { 'Authorization': `Bearer ${token}` } : {}
            });

            const result = await res.json();
            if (!result.success) throw new Error(result.error);

            renderMessages(result.data || []);
        } catch (err) {
            console.error('Error loading messages:', err);
            messagesStream.innerHTML = `
                <div style="text-align: center; padding: 40px; color: var(--text-secondary); font-size: 0.85rem;">
                    Failed to load messages. Please try again.
                </div>
            `;
        }
    }

    // 6. Render Messages in the stream
    function renderMessages(messages) {
        if (messages.length === 0) {
            messagesStream.innerHTML = `
                <div style="text-align: center; padding: 60px 20px; color: var(--text-secondary);">
                    <div style="font-size: 2.2rem; margin-bottom: 12px;">👋</div>
                    <h4 style="font-size: 1.05rem; color: var(--text-dark); margin-bottom: 4px;">Say hello!</h4>
                    <p style="font-size: 0.85rem;">This is the start of your direct conversation with ${escapeHtml(activeConversation?.other_user?.full_name || 'this member')}.</p>
                </div>
            `;
            return;
        }

        let html = '';
        let lastDate = '';

        messages.forEach(msg => {
            const isOutgoing = msg.sender_id === currentUserId;
            const msgDate = new Date(msg.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

            if (msgDate !== lastDate) {
                html += `
                    <div class="msg-date-divider">
                        <span>${msgDate}</span>
                    </div>
                `;
                lastDate = msgDate;
            }

            const timeStr = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const checkMark = isOutgoing ? `<span class="msg-check ${msg.read_at ? 'read' : ''}">✓✓</span>` : '';
            const otherInitials = getInitials(activeConversation?.other_user?.full_name || 'U');

            html += `
                <div class="msg-bubble-wrap ${isOutgoing ? 'outgoing' : 'incoming'}">
                    ${!isOutgoing ? `<div class="msg-avatar">${otherInitials}</div>` : ''}
                    <div class="msg-content">
                        <div class="msg-bubble">${escapeHtml(msg.message)}</div>
                        <div class="msg-meta">
                            <span>${timeStr}</span>
                            ${checkMark}
                        </div>
                    </div>
                </div>
            `;
        });

        messagesStream.innerHTML = html;
        scrollToBottom();
    }

    function scrollToBottom() {
        messagesStream.scrollTop = messagesStream.scrollHeight;
    }

    // 7. Send Message
    async function sendMessage(text) {
        const trimmed = (text || messageInput.value).trim();
        if (!trimmed || !activeConversation || !currentUserId) return;

        messageInput.value = '';
        btnSend.disabled = true;

        // Optimistically append outgoing message
        const optimisticMsg = {
            id: 'temp-' + Date.now(),
            conversation_id: activeConversation.id,
            sender_id: currentUserId,
            message: trimmed,
            created_at: new Date().toISOString(),
            read_at: null
        };

        const currentItems = messagesStream.querySelectorAll('.msg-bubble-wrap');
        if (currentItems.length === 0) {
            messagesStream.innerHTML = '';
        }

        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const bubbleHtml = `
            <div class="msg-bubble-wrap outgoing" id="${optimisticMsg.id}">
                <div class="msg-content">
                    <div class="msg-bubble">${escapeHtml(trimmed)}</div>
                    <div class="msg-meta">
                        <span>${timeStr}</span>
                        <span class="msg-check">✓</span>
                    </div>
                </div>
            </div>
        `;
        messagesStream.insertAdjacentHTML('beforeend', bubbleHtml);
        scrollToBottom();

        try {
            const { data: sessionData } = await supabaseClient.auth.getSession();
            const token = sessionData?.session?.access_token;

            const res = await fetch('/api/chat/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                body: JSON.stringify({
                    conversation_id: activeConversation.id,
                    sender_id: currentUserId,
                    message: trimmed
                })
            });

            const result = await res.json();
            if (!result.success) throw new Error(result.error);

            // Update optimistic checkmark
            const optEl = document.getElementById(optimisticMsg.id);
            if (optEl) {
                const check = optEl.querySelector('.msg-check');
                if (check) check.textContent = '✓✓';
            }

            // Update conversation in list
            activeConversation.last_message_text = trimmed;
            activeConversation.last_message_at = new Date().toISOString();
            renderConversationsList();

        } catch (err) {
            console.error('Error sending message:', err);
            alert('Failed to send message: ' + err.message);
        } finally {
            btnSend.disabled = false;
            messageInput.focus();
        }
    }

    // 8. Mark messages as read
    async function markRead(convId) {
        if (!convId || !currentUserId) return;
        try {
            const { data: sessionData } = await supabaseClient.auth.getSession();
            const token = sessionData?.session?.access_token;

            await fetch('/api/chat/messages/read', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                body: JSON.stringify({
                    conversation_id: convId,
                    user_id: currentUserId
                })
            });
        } catch (e) {
            console.warn('Mark read failed silently:', e);
        }
    }

    // 9. Realtime Subscription
    function setupRealtime() {
        if (!supabaseClient?.channel) return;

        try {
            realtimeChannel = supabaseClient
                .channel('bloodbridge-live-chat')
                .on('postgres_changes', {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'chat_messages'
                }, payload => {
                    const newMsg = payload.new;
                    if (!newMsg) return;

                    // If message is in active conversation
                    if (activeConversation && newMsg.conversation_id === activeConversation.id) {
                        if (newMsg.sender_id !== currentUserId) {
                            // Append incoming bubble
                            const otherInitials = getInitials(activeConversation.other_user?.full_name || 'U');
                            const timeStr = new Date(newMsg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                            const bubbleHtml = `
                                <div class="msg-bubble-wrap incoming">
                                    <div class="msg-avatar">${otherInitials}</div>
                                    <div class="msg-content">
                                        <div class="msg-bubble">${escapeHtml(newMsg.message)}</div>
                                        <div class="msg-meta">
                                            <span>${timeStr}</span>
                                        </div>
                                    </div>
                                </div>
                            `;
                            messagesStream.insertAdjacentHTML('beforeend', bubbleHtml);
                            scrollToBottom();
                            markRead(activeConversation.id);
                        }
                    }

                    // Update conversations list snippet
                    const conv = conversations.find(c => c.id === newMsg.conversation_id);
                    if (conv) {
                        conv.last_message_text = newMsg.message;
                        conv.last_message_at = newMsg.created_at;
                        if (!activeConversation || activeConversation.id !== conv.id) {
                            conv.unread_count = (conv.unread_count || 0) + 1;
                        }
                        renderConversationsList();
                    } else {
                        // New conversation created by other user -> refresh list
                        loadConversations();
                    }
                })
                .subscribe();

        } catch (e) {
            console.warn('Realtime channel error:', e);
        }

        // Safety fallback polling every 4 seconds
        pollingInterval = setInterval(() => {
            if (activeConversation) {
                loadMessagesQuietly(activeConversation.id);
            }
        }, 4000);
    }

    async function loadMessagesQuietly(convId) {
        if (!convId) return;
        try {
            const { data: sessionData } = await supabaseClient.auth.getSession();
            const token = sessionData?.session?.access_token;
            const res = await fetch(`/api/chat/messages/${convId}?limit=100`, {
                headers: token ? { 'Authorization': `Bearer ${token}` } : {}
            });
            const result = await res.json();
            if (result.success && result.data && activeConversation && activeConversation.id === convId) {
                const currentCount = messagesStream.querySelectorAll('.msg-bubble-wrap').length;
                if (result.data.length !== currentCount) {
                    renderMessages(result.data);
                }
            }
        } catch (_) {}
    }

    // 10. Handle query params (?tab=requesters|donors, ?conversation_id=UUID, ?request_id=UUID, ?with=UUID)
    async function handleQueryParams() {
        const params = new URLSearchParams(window.location.search);
        const tab = params.get('tab');
        const convIdParam = params.get('conversation_id');
        const requestId = params.get('request_id');
        const targetUserId = params.get('with');

        // Apply tab filter if passed
        if (tab === 'requesters' || tab === 'donors') {
            activeFilter = tab;
            tabButtons.forEach(b => {
                b.classList.toggle('active', b.dataset.tab === tab);
            });
            if (tab === 'requesters' && sidebarSubRequesters) {
                sidebarSubRequesters.classList.add('active-sub');
                if (sidebarSubDonors) sidebarSubDonors.classList.remove('active-sub');
            } else if (tab === 'donors' && sidebarSubDonors) {
                sidebarSubDonors.classList.add('active-sub');
                if (sidebarSubRequesters) sidebarSubRequesters.classList.remove('active-sub');
            }
            renderConversationsList();
        }

        // Auto-select conversation by conversation_id
        if (convIdParam) {
            const match = conversations.find(c => c.id === convIdParam);
            if (match) {
                selectConversation(match);
                return;
            }
        }

        // Auto-select conversation by request_id
        if (requestId) {
            const match = conversations.find(c => c.request_id === requestId);
            if (match) {
                selectConversation(match);
                return;
            }
        }

        if (!targetUserId) return;

        // Check if conversation already exists with this user
        let existing = conversations.find(c => {
            const other = c.other_user || {};
            return other.id === targetUserId || c.participant_1 === targetUserId || c.participant_2 === targetUserId;
        });

        if (existing) {
            selectConversation(existing);
            return;
        }

        // Otherwise create new conversation via backend API
        try {
            const { data: sessionData } = await supabaseClient.auth.getSession();
            const token = sessionData?.session?.access_token;

            const res = await fetch('/api/chat/conversations', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                body: JSON.stringify({
                    participant_1: currentUserId,
                    participant_2: targetUserId,
                    request_id: requestId || null
                })
            });

            const result = await res.json();
            if (result.success && result.data) {
                // Reload conversations and select the newly created one
                await loadConversations(result.data.id);
            } else if (result.error) {
                console.warn('Auto-create conversation notice:', result.error);
            }
        } catch (err) {
            console.error('Error auto-creating conversation with user:', err);
        }
    }

    // Complete donation from chat action button
    if (btnCompleteDonation) {
        btnCompleteDonation.addEventListener('click', async () => {
            if (!activeConversation || !activeConversation.request_id) return;
            const reqInfo = activeConversation.request_info;

            const confirmMsg = `Are you sure you want to mark this blood donation as completed?\n\n` +
                `• Patient: ${reqInfo?.patient_name || 'Patient'}\n` +
                `• Hospital: ${reqInfo?.hospital_name || 'Hospital'}\n\n` +
                `This will verify the blood donation, update donor donation history & cooling period, and close this live coordination chat.`;

            if (!confirm(confirmMsg)) return;

            btnCompleteDonation.disabled = true;
            btnCompleteDonation.textContent = 'Completing... ⏳';

            try {
                const { data: sessionData } = await supabaseClient.auth.getSession();
                const token = sessionData?.session?.access_token;

                const res = await fetch(`/api/requests/${activeConversation.request_id}/complete`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                    },
                    body: JSON.stringify({
                        donor_id: activeConversation.other_user_type === 'donor'
                            ? activeConversation.other_user?.id
                            : currentUserId
                    })
                });

                const result = await res.json();
                if (!result.success) {
                    alert(result.error || 'Failed to complete donation.');
                    btnCompleteDonation.disabled = false;
                    btnCompleteDonation.textContent = '✅ Mark Donation Completed';
                    return;
                }

                alert('🎉 Blood donation successfully completed! This coordination chat has been concluded.');
                await loadConversations(activeConversation.id);

            } catch (err) {
                console.error('Complete donation error:', err);
                alert('Network error while completing donation: ' + err.message);
                btnCompleteDonation.disabled = false;
                btnCompleteDonation.textContent = '✅ Mark Donation Completed';
            }
        });
    }

    // Event Listeners
    if (btnSend) {
        btnSend.addEventListener('click', () => sendMessage());
    }

    if (messageInput) {
        messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
    }

    // Quick chip buttons
    document.querySelectorAll('.quick-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const phrase = chip.dataset.phrase;
            if (phrase) sendMessage(phrase);
        });
    });

    // Search input
    if (searchInput) {
        searchInput.addEventListener('input', () => renderConversationsList());
    }

    // Tab buttons
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            tabButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeFilter = btn.dataset.tab;
            renderConversationsList();
        });
    });

    // Emergency Helpline popup
    if (btnCallHelpline) {
        btnCallHelpline.addEventListener('click', () => {
            alert(
                '🚨 Blood Bridge Emergency Helplines:\n\n' +
                '• National Blood Helpline: 1910 (Toll Free 24x7)\n' +
                '• Red Cross Blood Bank: 104\n' +
                '• Blood Bridge Priority Emergency: +91 1800-BLOOD-HELP\n\n' +
                'If this is an acute trauma or medical crisis, please immediately dial 112.'
            );
        });
    }

    // Helpers
    function getInitials(name) {
        if (!name) return 'U';
        const parts = name.trim().split(/\s+/);
        if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
        return parts[0].substring(0, 2).toUpperCase();
    }

    function formatTime(isoString) {
        try {
            const d = new Date(isoString);
            const now = new Date();
            const diffHours = (now - d) / (1000 * 60 * 60);
            if (diffHours < 24 && d.getDate() === now.getDate()) {
                return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            }
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        } catch (_) {
            return '';
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

    // Cleanup on window unload
    window.addEventListener('beforeunload', () => {
        if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);
        if (pollingInterval) clearInterval(pollingInterval);
    });

    // START
    const ready = await initUser();
    if (ready) {
        await loadConversations();
        await handleQueryParams();
        setupRealtime();
    }
});
