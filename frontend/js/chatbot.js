// frontend/js/chatbot.js
/**
 * Blood Bridge — Interactive AI Help Chatbot & Guidance Widget
 * Injects a floating assistance bubble and intelligent guidance window
 * with blood compatibility tools, eligibility checks, and live chat links.
 */

(function () {
    if (window.__bloodBridgeChatbotLoaded) return;
    window.__bloodBridgeChatbotLoaded = true;

    // Inject CSS styles for the floating chatbot
    const style = document.createElement('style');
    style.id = 'bb-chatbot-styles';
    style.textContent = `
        .bb-chatbot-btn {
            position: fixed;
            bottom: 24px;
            right: 24px;
            width: 58px;
            height: 58px;
            border-radius: 50%;
            background: linear-gradient(135deg, #E60023 0%, #B91C1C 100%);
            color: #FFFFFF;
            border: none;
            cursor: pointer;
            box-shadow: 0 6px 20px rgba(230, 0, 35, 0.4);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.6rem;
            z-index: 99999;
            transition: all 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }
        .bb-chatbot-btn:hover {
            transform: scale(1.08) translateY(-2px);
            box-shadow: 0 8px 26px rgba(230, 0, 35, 0.55);
        }
        .bb-chatbot-badge {
            position: absolute;
            top: -2px;
            right: -2px;
            background: #10B981;
            color: white;
            font-size: 0.65rem;
            font-weight: 800;
            padding: 2px 6px;
            border-radius: 10px;
            border: 2px solid white;
            animation: bbPulse 2s infinite;
        }
        @keyframes bbPulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.15); }
            100% { transform: scale(1); }
        }

        .bb-chatbot-window {
            position: fixed;
            bottom: 96px;
            right: 24px;
            width: 380px;
            max-width: calc(100vw - 32px);
            height: 540px;
            max-height: calc(100vh - 120px);
            background: #FFFFFF;
            border-radius: 20px;
            box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18), 0 2px 6px rgba(0, 0, 0, 0.08);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            z-index: 99999;
            border: 1px solid #E4E7EC;
            transform-origin: bottom right;
            transition: transform 0.25s ease, opacity 0.25s ease;
            font-family: 'Inter', -apple-system, sans-serif;
        }
        .bb-chatbot-window.bb-hidden {
            transform: scale(0.85);
            opacity: 0;
            pointer-events: none;
            display: none !important;
        }

        /* Header */
        .bb-chat-header {
            background: linear-gradient(135deg, #1E1B4B 0%, #312E81 50%, #4C1D95 100%);
            color: white;
            padding: 16px 20px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-shrink: 0;
        }
        .bb-header-info { display: flex; align-items: center; gap: 10px; }
        .bb-avatar-circle {
            width: 38px;
            height: 38px;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.15);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.2rem;
            border: 1.5px solid rgba(255, 255, 255, 0.3);
        }
        .bb-header-title { font-size: 0.95rem; font-weight: 700; }
        .bb-header-sub { font-size: 0.72rem; color: #C7D2FE; display: flex; align-items: center; gap: 4px; }
        .bb-header-dot { width: 6px; height: 6px; background: #10B981; border-radius: 50%; }

        .bb-header-actions { display: flex; gap: 6px; }
        .bb-header-btn {
            background: rgba(255, 255, 255, 0.15);
            border: none;
            color: white;
            width: 28px;
            height: 28px;
            border-radius: 50%;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.85rem;
            transition: background 0.15s;
        }
        .bb-header-btn:hover { background: rgba(255, 255, 255, 0.3); }

        /* Quick Action Chips */
        .bb-quick-pills {
            display: flex;
            gap: 6px;
            padding: 10px 14px;
            background: #F8FAFC;
            border-bottom: 1px solid #E2E8F0;
            overflow-x: auto;
            flex-shrink: 0;
        }
        .bb-quick-pills::-webkit-scrollbar { height: 3px; }
        .bb-pill {
            background: #FFFFFF;
            border: 1px solid #CBD5E1;
            padding: 5px 10px;
            border-radius: 12px;
            font-size: 0.74rem;
            font-weight: 600;
            color: #334155;
            cursor: pointer;
            white-space: nowrap;
            transition: all 0.15s;
        }
        .bb-pill:hover {
            border-color: #E60023;
            color: #E60023;
            background: #FFF0F2;
        }

        /* Message Stream */
        .bb-chat-body {
            flex: 1;
            padding: 16px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 12px;
            background: #FAFAFA;
        }
        .bb-chat-body::-webkit-scrollbar { width: 4px; }
        .bb-chat-body::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 4px; }

        .bb-msg {
            max-width: 82%;
            padding: 10px 14px;
            border-radius: 14px;
            font-size: 0.85rem;
            line-height: 1.45;
            word-break: break-word;
        }
        .bb-msg.bot {
            align-self: flex-start;
            background: #FFFFFF;
            color: #1E293B;
            border-bottom-left-radius: 3px;
            border: 1px solid #E2E8F0;
            box-shadow: 0 1px 2px rgba(0,0,0,0.04);
        }
        .bb-msg.user {
            align-self: flex-end;
            background: linear-gradient(135deg, #E60023 0%, #DC2626 100%);
            color: #FFFFFF;
            border-bottom-right-radius: 3px;
        }
        .bb-msg-action-btn {
            display: inline-block;
            margin-top: 8px;
            padding: 6px 12px;
            background: #4C1D95;
            color: #FFFFFF !important;
            text-decoration: none;
            border-radius: 6px;
            font-size: 0.78rem;
            font-weight: 600;
            transition: background 0.15s;
        }
        .bb-msg-action-btn:hover { background: #6D28D9; }

        /* Input Area */
        .bb-chat-footer {
            padding: 12px 14px;
            background: #FFFFFF;
            border-top: 1px solid #E2E8F0;
            display: flex;
            align-items: center;
            gap: 8px;
            flex-shrink: 0;
        }
        .bb-input {
            flex: 1;
            padding: 9px 14px;
            border: 1px solid #CBD5E1;
            border-radius: 20px;
            font-size: 0.85rem;
            outline: none;
            background: #F8FAFC;
        }
        .bb-input:focus { border-color: #E60023; background: #FFFFFF; }
        .bb-send-btn {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            background: #E60023;
            color: white;
            border: none;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.95rem;
            transition: transform 0.15s;
        }
        .bb-send-btn:hover { transform: scale(1.05); }

        /* Typing indicator */
        .bb-typing {
            display: flex;
            gap: 4px;
            padding: 8px 12px;
            background: #FFFFFF;
            border: 1px solid #E2E8F0;
            border-radius: 12px;
            align-self: flex-start;
            width: fit-content;
        }
        .bb-typing-dot {
            width: 6px;
            height: 6px;
            background: #94A3B8;
            border-radius: 50%;
            animation: bbBlink 1.4s infinite;
        }
        .bb-typing-dot:nth-child(2) { animation-delay: 0.2s; }
        .bb-typing-dot:nth-child(3) { animation-delay: 0.4s; }
        @keyframes bbBlink {
            0%, 60%, 100% { opacity: 0.2; transform: translateY(0); }
            30% { opacity: 1; transform: translateY(-4px); }
        }

        /* Matched Donors & Live Requests Card Decks */
        .bb-cards-deck {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-top: 10px;
            width: 100%;
        }
        .bb-card-title {
            font-size: 0.72rem;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #64748B;
            margin-bottom: 2px;
            display: flex;
            align-items: center;
            gap: 5px;
        }
        .bb-donor-card {
            background: #FFFFFF;
            border: 1px solid #E2E8F0;
            border-left: 3px solid #E60023;
            border-radius: 10px;
            padding: 9px 11px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.05);
            transition: transform 0.15s, box-shadow 0.15s;
        }
        .bb-donor-card:hover {
            transform: translateY(-1px);
            box-shadow: 0 3px 8px rgba(0,0,0,0.08);
        }
        .bb-donor-top {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 6px;
        }
        .bb-donor-name {
            font-weight: 700;
            font-size: 0.84rem;
            color: #0F172A;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .bb-blood-badge {
            background: #FEE2E2;
            color: #DC2626;
            font-weight: 800;
            font-size: 0.72rem;
            padding: 2px 7px;
            border-radius: 6px;
            border: 1px solid #FECACA;
        }
        .bb-rank-badge {
            font-size: 0.68rem;
            font-weight: 700;
            background: #FEF3C7;
            color: #B45309;
            padding: 2px 6px;
            border-radius: 6px;
        }
        .bb-donor-details {
            font-size: 0.74rem;
            color: #475467;
            margin-top: 4px;
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            align-items: center;
        }
        .bb-donor-detail-item {
            display: inline-flex;
            align-items: center;
            gap: 3px;
        }
        .bb-avail-dot {
            width: 7px;
            height: 7px;
            background: #16A34A;
            border-radius: 50%;
            display: inline-block;
        }
        .bb-donor-actions {
            display: flex;
            gap: 6px;
            margin-top: 8px;
        }
        .bb-mini-btn {
            padding: 4px 8px;
            border-radius: 6px;
            font-size: 0.72rem;
            font-weight: 600;
            text-decoration: none;
            cursor: pointer;
            border: none;
            transition: all 0.15s;
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }
        .bb-mini-btn.primary {
            background: #E60023;
            color: white !important;
        }
        .bb-mini-btn.primary:hover {
            background: #B91C1C;
        }
        .bb-mini-btn.secondary {
            background: #EEF2F6;
            color: #334155 !important;
            border: 1px solid #CBD5E1;
        }
        .bb-mini-btn.secondary:hover {
            background: #E2E8F0;
        }
        /* Request Mini Cards */
        .bb-req-card {
            background: #FFFBFB;
            border: 1px solid #FCA5A5;
            border-left: 3px solid #DC2626;
            border-radius: 10px;
            padding: 9px 11px;
            margin-bottom: 6px;
        }
        .bb-req-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 0.82rem;
            font-weight: 700;
        }
        .bb-req-meta {
            font-size: 0.73rem;
            color: #64748B;
            margin-top: 3px;
        }
        /* Source badge */
        .bb-source-tag {
            font-size: 0.65rem;
            color: #94A3B8;
            margin-top: 6px;
            text-align: right;
            display: block;
            font-style: italic;
        }
    `;
    document.head.appendChild(style);

    // Knowledge Base & Smart Intent Matching
    const KNOWLEDGE_BASE = [
        {
            keywords: ['compatibility', 'compatible', 'blood group', 'who can donate', 'who can receive', 'chart', 'matrix', 'universal'],
            reply: `🩸 **Blood Compatibility Guide:**\n\n` +
                   `• **O- (Universal Donor)**: Can donate red cells to ALL blood groups (A+, A-, B+, B-, AB+, AB-, O+, O-).\n` +
                   `• **AB+ (Universal Recipient)**: Can receive red cells from ALL blood groups.\n` +
                   `• **A+**: Receives from A+, A-, O+, O-. Donates to A+, AB+.\n` +
                   `• **B+**: Receives from B+, B-, O+, O-. Donates to B+, AB+.\n` +
                   `• **O+**: Receives only from O+, O-. Donates to O+, A+, B+, AB+.\n\n` +
                   `Want AI to find compatible donors near you?`,
            action: { text: '⚡ Launch Smart Match', url: 'smart-match.html' }
        },
        {
            keywords: ['smart match', 'how does smart match work', 'algorithm', 'score', 'priority', 'ranking'],
            reply: `⚡ **Blood Bridge Smart Match V2:**\n\n` +
                   `Our multi-criteria algorithm matches donors in real-time:\n` +
                   `1. **Radius Scan**: Filters donors within your chosen radius (5–100 km).\n` +
                   `2. **Biological Compatibility**: Matches ABO & Rh compatibility.\n` +
                   `3. **Proximity Scoring (35%)**: Closest donors receive top marks.\n` +
                   `4. **Trust Score (30%)**: Earned through completed previous donations.\n` +
                   `5. **Availability & Ready (35%)**: Active donors ready for emergency response.\n\n` +
                   `Categorized into **Smart Match 🏆**, **Best Match ⭐**, and **Recommended 👍**.`,
            action: { text: '⚡ Try Smart Match Now', url: 'smart-match.html' }
        },
        {
            keywords: ['chat', 'message', 'talk', 'contact donor', 'contact hospital', 'messaging', 'live chat'],
            reply: `💬 **Blood Bridge In-App Live Chat:**\n\n` +
                   `You can communicate directly and in real-time with:\n` +
                   `• **Requester ↔ Donor**: Coordinate donation time, hospital location, and transport.\n` +
                   `• **Hospital ↔ Donor**: Schedule appointments and verify arrival.\n` +
                   `• **Blood Bank ↔ Hospital**: Coordinate unit transfers.\n\n` +
                   `Messages update instantly using live Supabase subscriptions!`,
            action: { text: '💬 Open Live Messages', url: 'chat.html' }
        },
        {
            keywords: ['eligibility', 'eligible', 'can i donate', 'rules', 'criteria', 'weight', 'age', 'interval'],
            reply: `✅ **Blood Donor Eligibility Criteria:**\n\n` +
                   `• **Age**: 18 to 65 years.\n` +
                   `• **Weight**: Minimum 45 kg (50 kg recommended).\n` +
                   `• **Hemoglobin**: Minimum 12.5 g/dL.\n` +
                   `• **Donation Interval**: Every 3 months (men) or every 4 months (women).\n` +
                   `• **Health**: Normal blood pressure, no fever or active infections in last 48 hours.\n` +
                   `• **Tattoos/Piercings**: Must wait 6 months before donating.`,
            action: { text: '👤 Update Donor Profile', url: 'my-profile.html' }
        },
        {
            keywords: ['emergency', 'urgent', 'critical', 'helpline', 'call', 'ambulance', 'phone', 'police'],
            reply: `🚨 **Immediate Emergency Blood Helplines:**\n\n` +
                   `• **National Blood Helpline (Govt)**: 📞 **1910** (Toll-Free 24x7)\n` +
                   `• **National Health Helpline**: 📞 **104**\n` +
                   `• **National Emergency Number**: 📞 **112**\n` +
                   `• **Red Cross Blood Bank**: 📞 **011-23716441**\n\n` +
                   `For urgent requirements, create a request with urgency marked **Critical** to alert nearby verified donors immediately.`,
            action: { text: '🩸 Create Urgent Request', url: 'blood-request.html' }
        },
        {
            keywords: ['request', 'need blood', 'how to request', 'create request', 'patient'],
            reply: `🩸 **How to Create a Blood Request:**\n\n` +
                   `1. Go to **Blood Requests** in the menu.\n` +
                   `2. Enter patient name, required blood group, and units.\n` +
                   `3. Select hospital name, city, and drag the map pin to hospital location.\n` +
                   `4. Choose search radius (e.g. 25 km) and urgency level.\n` +
                   `5. Click submit — you will be immediately taken to **Smart AI Match** to connect with available donors!`,
            action: { text: '🩸 Request Blood Now', url: 'blood-request.html' }
        },
        {
            keywords: ['find', 'search', 'donor list', 'nearby donors'],
            reply: `🔍 **Finding Donors in Your City:**\n\n` +
                   `You can browse our directory with live availability statuses and filter by blood group and city, or use our automated Smart Match engine for prioritized recommendations.`,
            action: { text: '🔍 Find Donors Directory', url: 'find-donors.html' }
        }
    ];

    // Build Chatbot HTML
    const container = document.createElement('div');
    container.id = 'blood-bridge-chatbot-container';
    container.innerHTML = `
        <!-- Floating Trigger Button -->
        <button class="bb-chatbot-btn" id="bb-toggle-btn" title="Need help? Ask BloodBridge AI 🩸">
            💬
            <span class="bb-chatbot-badge">AI</span>
        </button>

        <!-- Floating Chatbot Window -->
        <div class="bb-chatbot-window bb-hidden" id="bb-chat-window">
            <!-- Header -->
            <div class="bb-chat-header">
                <div class="bb-header-info">
                    <div class="bb-avatar-circle">🤖</div>
                    <div>
                        <div class="bb-header-title">BloodBridge AI Assistant</div>
                        <div class="bb-header-sub"><span class="bb-header-dot"></span> Online • 24/7 Guidance</div>
                    </div>
                </div>
                <div class="bb-header-actions">
                    <button class="bb-header-btn" id="bb-clear-btn" title="Clear chat">🗑️</button>
                    <button class="bb-header-btn" id="bb-close-btn" title="Close">✕</button>
                </div>
            </div>

            <!-- Quick Action Pills -->
            <div class="bb-quick-pills">
                <button class="bb-pill" data-query="Find O+ donor in Lucknow">🔍 Find O+ Donors</button>
                <button class="bb-pill" data-query="smart match">⚡ Smart Match</button>
                <button class="bb-pill" data-query="Show urgent blood requests">📋 Urgent Requests</button>
                <button class="bb-pill" data-query="compatibility">🩸 Compatibility</button>
                <button class="bb-pill" data-query="chat">💬 Live Chat</button>
                <button class="bb-pill" data-query="eligibility">✅ Eligibility</button>
                <button class="bb-pill" data-query="emergency">🚨 Helpline 104</button>
            </div>

            <!-- Chat Message Stream -->
            <div class="bb-chat-body" id="bb-chat-body">
                <div class="bb-msg bot">
                    Hello! 👋 I'm your <strong>BloodBridge AI Assistant</strong>.<br><br>
                    I am directly connected to our <strong>Live Donors Database</strong> and <strong>Smart Matching Engine</strong>.<br><br>
                    Try asking me:<br>
                    • <em>"Find O+ donor in Lucknow"</em><br>
                    • <em>"Need B+ blood in Kanpur"</em><br>
                    • <em>"Show urgent blood requests"</em><br>
                    • <em>"Can A+ donate to O-?"</em>
                </div>
            </div>

            <!-- Input Footer -->
            <div class="bb-chat-footer">
                <input type="text" class="bb-input" id="bb-chat-input" placeholder="Ask a question or find donors..." autocomplete="off">
                <button class="bb-send-btn" id="bb-chat-send" title="Send message">➤</button>
            </div>
        </div>
    `;

    document.body.appendChild(container);

    // Elements
    const toggleBtn = document.getElementById('bb-toggle-btn');
    const chatWindow = document.getElementById('bb-chat-window');
    const closeBtn = document.getElementById('bb-close-btn');
    const clearBtn = document.getElementById('bb-clear-btn');
    const chatBody = document.getElementById('bb-chat-body');
    const chatInput = document.getElementById('bb-chat-input');
    const sendBtn = document.getElementById('bb-chat-send');

    let isOpen = false;

    // Toggle window
    function toggleChat(open = null) {
        isOpen = open !== null ? open : !isOpen;
        if (isOpen) {
            chatWindow.classList.remove('bb-hidden');
            toggleBtn.style.transform = 'scale(0.9)';
            chatInput.focus();
        } else {
            chatWindow.classList.add('bb-hidden');
            toggleBtn.style.transform = '';
        }
    }

    toggleBtn.addEventListener('click', () => toggleChat());
    closeBtn.addEventListener('click', () => toggleChat(false));

    clearBtn.addEventListener('click', () => {
        chatBody.innerHTML = `
            <div class="bb-msg bot">
                Chat cleared! 👋 How can I assist you with Blood Bridge live donors or requests?
            </div>
        `;
    });

    // Send query to Gemini AI & Smart Matching endpoint
    async function handleSend() {
        const text = chatInput.value.trim();
        if (!text) return;

        // Append user bubble
        appendMessage('user', text);
        chatInput.value = '';

        // Show typing indicator
        showTypingIndicator();

        // Attempt non-blocking location retrieval if available
        let userLocation = null;
        try {
            if (window.MapService && typeof window.MapService.getUserLocation === 'function') {
                userLocation = await window.MapService.getUserLocation(true);
            }
        } catch (e) {
            // Silently proceed
        }

        try {
            const res = await fetch('/api/chat/assistant', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: text,
                    latitude: userLocation?.lat,
                    longitude: userLocation?.lng,
                    city: userLocation?.city
                })
            });
            const data = await res.json();
            removeTypingIndicator();
            if (data && data.success && data.reply) {
                appendMessage('bot', data.reply, data.action, data);
            } else {
                const fallback = generateBotResponse(text);
                appendMessage('bot', fallback.reply, fallback.action);
            }
        } catch (err) {
            removeTypingIndicator();
            const fallback = generateBotResponse(text);
            appendMessage('bot', fallback.reply, fallback.action);
        }
    }

    sendBtn.addEventListener('click', handleSend);
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSend();
        }
    });

    // Quick pills
    document.querySelectorAll('.bb-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            const query = pill.dataset.query;
            chatInput.value = query;
            handleSend();
        });
    });

    function showTypingIndicator() {
        const indicator = document.createElement('div');
        indicator.className = 'bb-typing';
        indicator.id = 'bb-typing-indicator';
        indicator.innerHTML = `
            <div class="bb-typing-dot"></div>
            <div class="bb-typing-dot"></div>
            <div class="bb-typing-dot"></div>
        `;
        chatBody.appendChild(indicator);
        chatBody.scrollTop = chatBody.scrollHeight;
    }

    function removeTypingIndicator() {
        const ind = document.getElementById('bb-typing-indicator');
        if (ind) ind.remove();
    }

    function appendMessage(sender, text, action = null, data = null) {
        const msgEl = document.createElement('div');
        msgEl.className = `bb-msg ${sender}`;

        // Robust Markdown parser for bold, italics, bullets, code, and line breaks
        let formatted = escapeHtml(text)
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code style="background: rgba(0,0,0,0.06); padding: 1px 4px; border-radius: 4px; font-size: 0.85em;">$1</code>')
            .replace(/\n• /g, '<br>• ')
            .replace(/\n\*/g, '<br>• ')
            .replace(/\n/g, '<br>');

        msgEl.innerHTML = formatted;

        // Render Live Matched Donors Card Deck if present
        if (data && Array.isArray(data.matched_donors) && data.matched_donors.length > 0) {
            const deck = document.createElement('div');
            deck.className = 'bb-cards-deck';

            const title = document.createElement('div');
            title.className = 'bb-card-title';
            title.innerHTML = '⚡ Live Matched Donors (Nearest First)';
            deck.appendChild(title);

            data.matched_donors.slice(0, 3).forEach(donor => {
                const card = document.createElement('div');
                card.className = 'bb-donor-card';

                const bgUrl = `smart-match.html?blood_group=${encodeURIComponent(donor.blood_group || 'O+')}${donor.city ? `&city=${encodeURIComponent(donor.city)}` : ''}`;

                card.innerHTML = `
                    <div class="bb-donor-top">
                        <div class="bb-donor-name">
                            <span>👤 ${escapeHtml(donor.full_name)}</span>
                            <span class="bb-blood-badge">${escapeHtml(donor.blood_group)}</span>
                        </div>
                        <span class="bb-rank-badge">${escapeHtml(donor.match_label || 'Verified')}</span>
                    </div>
                    <div class="bb-donor-details">
                        <span class="bb-donor-detail-item">📍 ${escapeHtml(donor.city || 'Nearby')} • ~${donor.distance_km} km</span>
                        <span class="bb-donor-detail-item"><span class="bb-avail-dot"></span> Available</span>
                    </div>
                    <div class="bb-donor-actions">
                        <a href="${bgUrl}" class="bb-mini-btn primary">⚡ Smart Match</a>
                        <a href="chat.html" class="bb-mini-btn secondary">💬 Message</a>
                    </div>
                `;
                deck.appendChild(card);
            });
            msgEl.appendChild(deck);
        }

        // Render Active Live Blood Requests if present
        if (data && Array.isArray(data.live_requests) && data.live_requests.length > 0) {
            const reqDeck = document.createElement('div');
            reqDeck.className = 'bb-cards-deck';

            const reqTitle = document.createElement('div');
            reqTitle.className = 'bb-card-title';
            reqTitle.innerHTML = '🩸 Active Live Blood Requests';
            reqDeck.appendChild(reqTitle);

            data.live_requests.slice(0, 2).forEach(r => {
                const rCard = document.createElement('div');
                rCard.className = 'bb-req-card';
                rCard.innerHTML = `
                    <div class="bb-req-header">
                        <span>Patient ${escapeHtml(r.patient_name || 'Anonymous')}</span>
                        <span class="bb-blood-badge">${escapeHtml(r.blood_group)}</span>
                    </div>
                    <div class="bb-req-meta">
                        🏥 ${escapeHtml(r.hospital_name || 'Hospital')}, ${escapeHtml(r.city || '')} • <strong>${r.units || 1} Unit(s)</strong> • 🚨 ${escapeHtml(r.urgency || 'Normal')}
                    </div>
                    <div style="margin-top: 6px;">
                        <a href="nearby-request.html" class="bb-mini-btn primary">🩸 View Request</a>
                    </div>
                `;
                reqDeck.appendChild(rCard);
            });
            msgEl.appendChild(reqDeck);
        }

        // Action button
        if (action && action.url && action.text) {
            const actionBtn = document.createElement('a');
            actionBtn.href = action.url;
            actionBtn.className = 'bb-msg-action-btn';
            actionBtn.textContent = action.text;
            msgEl.appendChild(document.createElement('br'));
            msgEl.appendChild(actionBtn);
        }

        // Subtle AI Source attribution
        if (data && data.source) {
            const src = document.createElement('span');
            src.className = 'bb-source-tag';
            src.textContent = data.source.includes('gemini') ? '✨ Powered by Google Gemini' : '⚡ BloodBridge Live Smart Engine';
            msgEl.appendChild(src);
        }

        chatBody.appendChild(msgEl);
        chatBody.scrollTop = chatBody.scrollHeight;
    }

    function generateBotResponse(input) {
        const lower = input.toLowerCase();

        // 1. Check knowledge base keywords
        for (const entry of KNOWLEDGE_BASE) {
            if (entry.keywords.some(kw => lower.includes(kw))) {
                return entry;
            }
        }

        // 2. Specific blood group compatibility check (e.g., "can A+ donate to O-")
        const bgRegex = /(ab\+|ab-|a\+|a-|b\+|b-|o\+|o-)(?!\w)/gi;
        const matches = lower.match(bgRegex);
        if (matches && matches.length > 0) {
            const bg = matches[0].toUpperCase();
            const matrix = {
                'O-': { gives: 'Everyone (Universal)', receives: 'O-' },
                'O+': { gives: 'O+, A+, B+, AB+', receives: 'O+, O-' },
                'A-': { gives: 'A-, A+, AB-, AB+', receives: 'A-, O-' },
                'A+': { gives: 'A+, AB+', receives: 'A+, A-, O+, O-' },
                'B-': { gives: 'B-, B+, AB-, AB+', receives: 'B-, O-' },
                'B+': { gives: 'B+, AB+', receives: 'B+, B-, O+, O-' },
                'AB-': { gives: 'AB-, AB+', receives: 'AB-, A-, B-, O-' },
                'AB+': { gives: 'AB+ only', receives: 'Everyone (Universal Recipient)' }
            };
            const data = matrix[bg];
            if (data) {
                return {
                    reply: `🩸 **Blood Group ${bg} Info:**\n\n` +
                           `• **Can Donate Red Cells To**: ${data.gives}\n` +
                           `• **Can Safely Receive From**: ${data.receives}\n\n` +
                           `Use our Smart Match algorithm to find compatible donors around you.`,
                    action: { text: `⚡ Match Donors for ${bg}`, url: `smart-match.html?blood_group=${encodeURIComponent(bg)}` }
                };
            }
        }

        // 3. Fallback answer
        return {
            reply: `I understand you're asking about "${escapeHtml(input)}".\n\n` +
                   `I can help you with:\n` +
                   `• **Smart Matching**: Finding nearby compatible donors ranked by proximity and trust.\n` +
                   `• **Live Chat**: Chatting directly with donors, hospitals, and blood banks.\n` +
                   `• **Eligibility & Helplines**: 24x7 emergency blood bank contacts.`,
            action: { text: '⚡ Open Smart Match', url: 'smart-match.html' }
        };
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
})();
