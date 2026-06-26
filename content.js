// Zalo AI Assistant v5 — Chrome AI (Gemini Nano), không cần API Key
(function () {
  if (document.getElementById('zalo-ai-panel')) return;

  let sheetApiUrl   = '';
  let ragApiUrl     = '';
  let currentMode   = 'reply';
  let currentTone   = 'chuyên_nghiệp';
  let panelOpen     = false;
  let selectedCustomer = null;
  let toggleBtnRef  = null;
  let lastSeenMessage = null;
  let hasUnread     = false;

  // Chrome AI session (reused across calls)
  let aiSession = null;
  let aiAvailable = false; // optimistic; will be confirmed on first use

  const TONES = {
    'chuyên_nghiệp': 'Chuyên nghiệp',
    'thân_thiện':    'Thân thiện',
    'ngắn_gọn':      'Ngắn gọn',
    'nhiệt_tình':    'Nhiệt tình',
  };

  const MODES = {
    reply:    { label: '💬 Trả lời',   placeholder: 'Dán tin nhắn của khách...' },
    compose:  { label: '✍️ Soạn mới', placeholder: 'Mô tả nội dung muốn nhắn...' },
    care:     { label: '🤝 Chăm sóc', placeholder: '' },
    customers:{ label: '📋 Khách',    placeholder: '' },
    translate:{ label: '🌐 Dịch',     placeholder: 'Nhập văn bản cần dịch...' },
  };

  chrome.storage.local.get(['zai_sheet_url','zai_rag_url'], (r) => {
    sheetApiUrl = r.zai_sheet_url || '';
    ragApiUrl   = r.zai_rag_url   || '';
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SHEET_URL_UPDATED') sheetApiUrl = msg.url || '';
    if (msg.type === 'RAG_URL_UPDATED')   ragApiUrl   = msg.url || '';
    if (msg.type === 'CHECK_AI')          initAI();
  });

  // ── Chrome AI initialisation ──────────────────────────────
  // Chrome đổi tên trạng thái: cũ 'readily'/'after-download'/'no',
  // mới (global LanguageModel) 'available'/'downloadable'/'downloading'/'unavailable'.
  const SYSTEM_PROMPT = `Bạn là trợ lý nhắn tin cho shop Việt Nam.
Trả lời bằng JSON hợp lệ, KHÔNG markdown, KHÔNG backtick, KHÔNG giải thích.
Viết tự nhiên như người Việt thật nhắn tin — ngắn gọn, chân thành, không sáo rỗng.`;

  function getLM() {
    return (typeof LanguageModel !== 'undefined' && LanguageModel)
      || window.ai?.languageModel
      || null;
  }

  async function createSession(lm) {
    try {
      return await lm.create({ initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }] });
    } catch {
      // fallback cho API cũ
      return await lm.create({ systemPrompt: SYSTEM_PROMPT });
    }
  }

  async function initAI() {
    try {
      const lm = getLM();
      if (!lm) { aiAvailable = false; return; }

      const avail = await (lm.availability?.() ?? lm.capabilities?.());
      const status = typeof avail === 'string' ? avail : avail?.available;

      const READY       = ['readily', 'available'];
      const DOWNLOADING = ['after-download', 'downloadable', 'downloading'];

      if (READY.includes(status)) {
        if (!aiSession) aiSession = await createSession(lm);
        aiAvailable = true;
      } else if (DOWNLOADING.includes(status)) {
        // Model còn đang tải — kích hoạt tải về ngầm
        createSession(lm).then(s => { aiSession = s; aiAvailable = true; }).catch(() => {});
        aiAvailable = false;
      } else {
        aiAvailable = false;
      }
    } catch {
      aiAvailable = false;
    }
  }

  // Call AI and parse JSON response
  async function callAI(prompt) {
    if (!aiSession) await initAI();
    if (!aiSession) throw new Error('Gemini Nano chưa sẵn sàng. Xem Phần 2 trong hướng dẫn.');

    // Create a fresh clone per call to avoid context pollution
    const clone = await aiSession.clone();
    let raw = await clone.prompt(prompt);
    clone.destroy();

    // Strip markdown code fences if model adds them
    raw = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(raw);
  }

  // ── Phone / message scanning ──────────────────────────────
  const PHONE_REGEX = /(?:\+?84|0)(?:3|5|7|8|9)\d{8}\b/;

  const SELECTORS_CHAT_HEADER = [
    '[data-testid="conversation-header"]',
    '.conversation-header',
    '.chat-header',
    '.ct-header',
  ];

  const SELECTORS_INFO_PANEL = [
    '[data-testid="conversation-info"]',
    '.conversation-info-panel',
    '.info-panel',
    '.profile-panel',
  ];

  const SELECTORS_LAST_INCOMING_MSG = [
    '.message-row.incoming:last-child .message-content',
    '.message-item.received:last-child .text-content',
    '.msg-item.is-received:last-of-type .msg-text',
  ];

  function findPhoneNumber() {
    const priorityNodes = [];
    [...SELECTORS_CHAT_HEADER, ...SELECTORS_INFO_PANEL].forEach(sel => {
      document.querySelectorAll(sel).forEach(el => priorityNodes.push(el));
    });
    for (const node of priorityNodes) {
      const m = node.innerText.match(PHONE_REGEX);
      if (m) return normalizePhone(m[0]);
    }
    const clone = document.body.cloneNode(true);
    clone.querySelector('#zalo-ai-panel')?.remove();
    const m = clone.innerText.match(PHONE_REGEX);
    return m ? normalizePhone(m[0]) : null;
  }

  function normalizePhone(raw) {
    let p = raw.replace(/\s|-/g, '');
    if (p.startsWith('+84')) p = '0' + p.slice(3);
    else if (p.startsWith('84')) p = '0' + p.slice(2);
    return p;
  }

  function findLastIncomingMessage() {
    for (const sel of SELECTORS_LAST_INCOMING_MSG) {
      const el = document.querySelector(sel);
      if (el && el.innerText.trim()) return el.innerText.trim();
    }
    return null;
  }

  // ── Unread watcher ────────────────────────────────────────
  function startUnreadWatcher() {
    lastSeenMessage = findLastIncomingMessage();
    setInterval(() => {
      const msg = findLastIncomingMessage();
      if (msg && msg !== lastSeenMessage) {
        lastSeenMessage = msg;
        if (!panelOpen) { hasUnread = true; updateBadge(); }
      }
    }, 2500);
  }

  function updateBadge() {
    const badge = document.getElementById('zai-unread-badge');
    if (badge) badge.classList.toggle('hidden', !hasUnread);
  }

  function clearUnread() { hasUnread = false; updateBadge(); }

  // ── Send to Zalo ──────────────────────────────────────────
  function sendToZalo(text) {
    const chatInput =
      document.querySelector('[data-testid="chat-input"]') ||
      document.querySelector('.chat-input [contenteditable="true"]') ||
      document.querySelector('div[contenteditable="true"]');
    if (!chatInput) { alert('⚠️ Click vào cuộc trò chuyện trên Zalo trước!'); return false; }
    chatInput.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, text);
    chatInput.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
    setTimeout(() => {
      chatInput.dispatchEvent(new KeyboardEvent('keydown', {
        key:'Enter', code:'Enter', keyCode:13, bubbles:true, cancelable:true
      }));
    }, 150);
    return true;
  }

  // ── Build Panel ───────────────────────────────────────────
  function buildPanel() {
    // Kick off AI init in background right away
    initAI();

    const panel = document.createElement('div');
    panel.id = 'zalo-ai-panel';
    panel.classList.add('hidden');
    panel.innerHTML = `
      <div id="zai-header">
        <div id="zai-header-left">
          <div id="zai-logo">✦</div>
          <div>
            <div id="zai-title">Zalo AI</div>
            <div id="zai-subtitle" style="display:flex;align-items:center;gap:5px;">
              <span id="zai-ai-dot" style="width:6px;height:6px;border-radius:50%;background:#64748b;display:inline-block;flex-shrink:0"></span>
              <span id="zai-ai-label">Gemini Nano</span>
            </div>
          </div>
        </div>
        <button id="zai-close">✕</button>
      </div>

      <div id="zai-modes">
        ${Object.entries(MODES).map(([k,m])=>`
          <button class="zai-mode-btn ${k===currentMode?'active':''}" data-mode="${k}">${m.label}</button>
        `).join('')}
      </div>

      <!-- ── TAB: reply / compose / translate ── -->
      <div id="zai-standard-section">
        <div id="zai-context-section">
          <div class="zai-label">Ngữ cảnh / Sản phẩm</div>
          <textarea id="zai-context-box" placeholder="VD: Shop giày thể thao, đổi trả 7 ngày..."></textarea>
        </div>
        <div class="zai-divider"></div>
        <div style="padding:0 16px 10px">
          <div class="zai-label">Tin nhắn cần xử lý</div>
          <textarea id="zai-message-input" placeholder="${MODES[currentMode].placeholder}"></textarea>
        </div>
        <div id="zai-tone-row">
          ${Object.entries(TONES).map(([k,l])=>`
            <button class="zai-tone-chip ${k===currentTone?'active':''}" data-tone="${k}">${l}</button>
          `).join('')}
        </div>
      </div>

      <!-- ── TAB: chăm sóc ── -->
      <div id="zai-care-section" style="display:none;padding:0 16px 12px;flex-direction:column;gap:10px;">
        <div id="zai-selected-customer-banner" style="display:none"></div>
        <div class="zai-field">
          <div class="zai-label">Tên khách</div>
          <input type="text" id="zai-care-name" class="zai-input" placeholder="Anh Minh, chị Lan..." />
        </div>
        <div class="zai-field">
          <div class="zai-label">Lần nhắn cuối / tình huống</div>
          <input type="text" id="zai-care-last" class="zai-input" placeholder="2 tuần chưa nhắn, hỏi size 42..." />
        </div>
        <div class="zai-field">
          <div class="zai-label">Muốn giới thiệu</div>
          <input type="text" id="zai-care-offer" class="zai-input" placeholder="Sale 30%, hàng mới về..." />
        </div>
        <div id="zai-care-tone-row" style="display:flex;gap:6px;flex-wrap:wrap;">
          ${Object.entries(TONES).map(([k,l])=>`
            <button class="zai-tone-chip ${k===currentTone?'active':''}" data-tone="${k}">${l}</button>
          `).join('')}
        </div>
      </div>

      <!-- ── TAB: danh sách khách ── -->
      <div id="zai-customers-section" style="display:none;flex-direction:column;flex:1;overflow:hidden;">
        <div style="padding:10px 16px 8px">
          <div class="zai-label">Tìm khách (tên / SĐT)</div>
          <div style="display:flex;gap:6px">
            <input type="text" id="zai-search-input" class="zai-input" placeholder="Nhập tên hoặc số điện thoại..." style="flex:1" />
            <button id="zai-search-btn" class="zai-icon-btn">🔍</button>
          </div>
          <div id="zai-sheet-status" style="font-size:11px;color:#64748b;margin-top:6px"></div>
        </div>
        <div id="zai-customer-list" style="flex:1;overflow-y:auto;padding:0 16px 16px"></div>
      </div>

      <!-- ── Buttons ── -->
      <div id="zai-btn-row">
        <button id="zai-auto-btn" style="margin-bottom:8px">
          <span>📌</span>
          <span>Tạo gợi ý từ cuộc chat này</span>
        </button>
        <button id="zai-generate-btn">
          <span>✦</span>
          <span id="zai-btn-text">Tạo gợi ý</span>
        </button>
      </div>

      <div id="zai-status"></div>

      <div id="zai-loading">
        <div class="zai-spinner"></div>
        <div id="zai-loading-text">Gemini đang soạn thảo...</div>
      </div>

      <div id="zai-suggestions-section">
        <div id="zai-empty">
          <div id="zai-empty-icon">✦</div>
          Nhập thông tin và nhấn<br><strong style="color:#6366f1">Tạo gợi ý</strong>
        </div>
      </div>
    `;

    const toggle = document.createElement('button');
    toggle.id = 'zalo-ai-toggle';
    toggle.innerHTML = '✦ AI<span id="zai-unread-badge" class="zai-badge-dot hidden"></span>';
    toggleBtnRef = toggle;

    document.body.appendChild(panel);
    document.body.appendChild(toggle);
    bindEvents(panel, toggle);
    startUnreadWatcher();

    // Update AI status dot after a short delay
    setTimeout(updateAIDot, 1500);
  }

  async function updateAIDot() {
    await initAI();
    const dot   = document.getElementById('zai-ai-dot');
    const label = document.getElementById('zai-ai-label');
    if (!dot) return;
    if (aiAvailable) {
      dot.style.background   = '#10b981';
      label.textContent      = 'Gemini Nano ✓';
    } else {
      dot.style.background   = '#f59e0b';
      label.textContent      = 'Gemini chưa sẵn sàng';
    }
  }

  function bindEvents(panel, toggle) {
    toggle.addEventListener('click', () => {
      panelOpen = !panelOpen;
      panel.classList.toggle('hidden', !panelOpen);
      toggle.classList.toggle('panel-open', panelOpen);
      document.body.style.marginRight = panelOpen ? '340px' : '';
      if (panelOpen) clearUnread();
    });

    panel.querySelector('#zai-close').addEventListener('click', () => {
      panelOpen = false;
      panel.classList.add('hidden');
      toggle.classList.remove('panel-open');
      document.body.style.marginRight = '';
    });

    panel.querySelectorAll('.zai-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        currentMode = btn.dataset.mode;
        panel.querySelectorAll('.zai-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        switchMode(panel, currentMode);
      });
    });

    panel.addEventListener('click', (e) => {
      if (!e.target.classList.contains('zai-tone-chip')) return;
      currentTone = e.target.dataset.tone;
      panel.querySelectorAll('.zai-tone-chip').forEach(c => {
        c.classList.toggle('active', c.dataset.tone === currentTone);
      });
    });

    panel.querySelector('#zai-generate-btn').addEventListener('click', () => generateSuggestions(panel));
    panel.querySelector('#zai-auto-btn').addEventListener('click', () => autoGenerateFromChat(panel));
    panel.querySelector('#zai-message-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); generateSuggestions(panel); }
    });

    panel.querySelector('#zai-search-btn').addEventListener('click', () => searchCustomers(panel));
    panel.querySelector('#zai-search-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') searchCustomers(panel);
    });
  }

  function switchMode(panel, mode) {
    const isCare      = mode === 'care';
    const isCustomers = mode === 'customers';
    const isStandard  = !isCare && !isCustomers;

    panel.querySelector('#zai-standard-section').style.display  = isStandard  ? '' : 'none';
    panel.querySelector('#zai-care-section').style.display      = isCare      ? 'flex' : 'none';
    panel.querySelector('#zai-customers-section').style.display = isCustomers ? 'flex' : 'none';
    panel.querySelector('#zai-btn-row').style.display           = isCustomers ? 'none' : '';
    panel.querySelector('#zai-suggestions-section').style.display = isCustomers ? 'none' : '';
    panel.querySelector('#zai-loading').style.display = 'none';

    panel.querySelector('#zai-btn-text').textContent = isCare ? 'Tạo tin hỏi thăm' : 'Tạo gợi ý';
    if (isStandard) {
      panel.querySelector('#zai-message-input').placeholder = MODES[mode].placeholder;
    }
  }

  // ── RAG knowledge base ────────────────────────────────────
  async function searchKnowledgeBase(query) {
    if (!ragApiUrl || !query) return '';
    try {
      const url = `${ragApiUrl}/api/search?q=${encodeURIComponent(query)}&k=4`;
      const res = await fetch(url);
      if (!res.ok) return '';
      const data = await res.json();
      const results = data.results || [];
      if (!results.length) return '';
      return results
        .map((r, i) => `[Tài liệu ${i + 1} - ${r.filename}]\n${r.text}`)
        .join('\n\n');
    } catch { return ''; }
  }

  // ── Main generate function ────────────────────────────────
  async function generateSuggestions(panel) {
    const statusEl     = panel.querySelector('#zai-status');
    const loadingEl    = panel.querySelector('#zai-loading');
    const suggestionsEl= panel.querySelector('#zai-suggestions-section');
    const generateBtn  = panel.querySelector('#zai-generate-btn');

    let prompt;
    let ragQuery = '';

    if (currentMode === 'care') {
      const name  = panel.querySelector('#zai-care-name').value.trim();
      const last  = panel.querySelector('#zai-care-last').value.trim();
      const offer = panel.querySelector('#zai-care-offer').value.trim();
      if (!name) { showStatus(statusEl, '⚠️ Nhập tên khách'); return; }
      prompt   = buildCarePrompt(name, last, offer, currentTone, selectedCustomer);
      ragQuery = [last, offer].filter(Boolean).join(' ');
    } else {
      const msg = panel.querySelector('#zai-message-input').value.trim();
      const ctx = panel.querySelector('#zai-context-box').value.trim();
      if (!msg) { showStatus(statusEl, '⚠️ Nhập tin nhắn cần xử lý'); return; }
      prompt   = buildPrompt(currentMode, msg, ctx, currentTone);
      ragQuery = msg;
    }

    statusEl.classList.remove('visible');
    generateBtn.disabled = true;
    loadingEl.classList.add('visible');
    suggestionsEl.innerHTML = '';

    // Inject RAG knowledge if available
    if (ragApiUrl && ragQuery && currentMode !== 'translate') {
      panel.querySelector('#zai-loading-text').textContent = 'Đang tra tài liệu...';
      const knowledge = await searchKnowledgeBase(ragQuery);
      if (knowledge) {
        prompt = `Thông tin nội bộ liên quan (ưu tiên dùng, không bịa thêm):\n\n${knowledge}\n\n---\n\n${prompt}`;
      }
    }
    panel.querySelector('#zai-loading-text').textContent = 'Gemini đang soạn thảo...';

    try {
      const parsed = await callAI(prompt);
      loadingEl.classList.remove('visible');
      generateBtn.disabled = false;
      renderSuggestions(suggestionsEl, parsed.suggestions || []);
      selectedCustomer = null;
    } catch (err) {
      loadingEl.classList.remove('visible');
      generateBtn.disabled = false;

      // If Gemini Nano not ready, show helpful message
      if (err.message?.includes('Gemini Nano')) {
        showStatus(statusEl, `⚠️ ${err.message}`);
      } else if (err instanceof SyntaxError) {
        showStatus(statusEl, '❌ Gemini trả về định dạng không hợp lệ. Thử lại.');
      } else {
        showStatus(statusEl, `❌ ${err.message}`);
      }
      await updateAIDot();
    }
  }

  // ── Prompts ───────────────────────────────────────────────
  function buildPrompt(mode, message, context, tone) {
    const t = TONES[tone] || 'Chuyên nghiệp';
    const c = context ? `\nNgữ cảnh: ${context}` : '';
    if (mode === 'reply')
      return `${c}\nTin nhắn khách: "${message}"\nGiọng: ${t}\nTạo 3 câu trả lời tự nhiên.\nJSON:{"suggestions":[{"tone":"...","text":"..."},...]}`;
    if (mode === 'compose')
      return `${c}\nYêu cầu: "${message}"\nGiọng: ${t}\nSoạn 3 tin chủ động.\nJSON:{"suggestions":[{"tone":"...","text":"..."},...]}`;
    if (mode === 'translate')
      return `Dịch: "${message}"\nJSON:{"suggestions":[{"tone":"Tiếng Anh 🇬🇧","text":"..."},{"tone":"Tiếng Trung 🇨🇳","text":"..."},{"tone":"Tiếng Việt ✓","text":"${message}"}]}`;
  }

  function buildCarePrompt(name, last, offer, tone, customer) {
    const t = TONES[tone] || 'Thân thiện';
    const extra = customer
      ? `\nLịch sử: Sản phẩm đã mua: ${customer.product || 'chưa rõ'}, ngày ${customer.date || 'chưa rõ'}, ghi chú: ${customer.note || 'không có'}`
      : '';
    const offerStr = offer ? `\nMuốn giới thiệu: ${offer}` : '';
    return `Tên khách: ${name}
Tình huống: ${last}${offerStr}${extra}
Giọng: ${t}

Viết 3 tin nhắn hỏi thăm khách lâu chưa nhắn. Mỗi tin: cá nhân hoá với "${name}", 2-4 câu, tự nhiên như Zalo thật, không giống nhau, KHÔNG dùng template sáo rỗng.

JSON:{"suggestions":[
  {"tone":"Mẫu 1 — Hỏi thăm","text":"..."},
  {"tone":"Mẫu 2 — Nhắc sản phẩm","text":"..."},
  {"tone":"Mẫu 3 — Có ưu đãi","text":"..."}
]}`;
  }

  // ── Auto-generate from chat ───────────────────────────────
  async function autoGenerateFromChat(panel) {
    const statusEl = panel.querySelector('#zai-status');
    const autoBtn  = panel.querySelector('#zai-auto-btn');
    autoBtn.disabled = true;
    clearUnread();
    showStatus(statusEl, '🔄 Đang quét cuộc chat...');

    currentMode = 'reply';
    panel.querySelectorAll('.zai-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === 'reply'));
    switchMode(panel, 'reply');

    const phone   = findPhoneNumber();
    const lastMsg = findLastIncomingMessage();

    if (lastMsg) {
      panel.querySelector('#zai-message-input').value = lastMsg;
    }

    let customerSummary = '';
    if (phone) {
      const c = await fetchCustomerByPhone(phone);
      if (c) {
        selectedCustomer = c;
        customerSummary = [
          `Khách: ${c.name || ''} (${c.phone || phone})`,
          c.segment ? `Phân loại: ${c.segment}` : '',
          c.product ? `Đã mua: ${c.product}` : '',
          c.date    ? `Lần mua cuối: ${c.date}` : '',
          c.note    ? `Ghi chú: ${c.note}` : '',
        ].filter(Boolean).join('\n');
      }
    }

    const ctxBox = panel.querySelector('#zai-context-box');
    if (customerSummary) {
      ctxBox.value = ctxBox.value
        ? `${ctxBox.value}\n\n${customerSummary}`
        : customerSummary;
    }

    if (!phone && !lastMsg) {
      showStatus(statusEl, '⚠️ Không quét được SĐT/tin nhắn — hãy dán tin nhắn khách vào ô bên dưới rồi bấm "Tạo gợi ý"');
      autoBtn.disabled = false;
      return;
    }
    if (!lastMsg) {
      showStatus(statusEl, '⚠️ Đã tìm SĐT nhưng chưa đọc được tin nhắn — hãy dán tin nhắn khách rồi bấm "Tạo gợi ý"');
      autoBtn.disabled = false;
      return;
    }

    autoBtn.disabled = false;
    await generateSuggestions(panel);
  }

  // ── Sheet search ──────────────────────────────────────────
  async function fetchCustomerByPhone(phone) {
    if (!sheetApiUrl || !phone) return null;
    try {
      const url = `${sheetApiUrl}?action=search&q=${encodeURIComponent(phone)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.error || !data.customers?.length) return null;
      return data.customers[0];
    } catch { return null; }
  }

  async function searchCustomers(panel) {
    if (!sheetApiUrl) {
      panel.querySelector('#zai-sheet-status').innerHTML =
        '⚠️ Chưa có Sheet API URL — mở popup extension để cài đặt';
      return;
    }

    const q       = panel.querySelector('#zai-search-input').value.trim();
    const listEl  = panel.querySelector('#zai-customer-list');
    const statusEl= panel.querySelector('#zai-sheet-status');

    statusEl.textContent = '🔄 Đang tải...';
    listEl.innerHTML = '';

    try {
      const url = `${sheetApiUrl}?action=${q ? 'search' : 'all'}&q=${encodeURIComponent(q)}`;
      const res = await fetch(url);
      const data = await res.json();

      if (data.error) throw new Error(data.error);
      const customers = data.customers || [];
      statusEl.textContent = `Tìm thấy ${customers.length} khách`;

      if (!customers.length) {
        listEl.innerHTML = '<div style="color:#64748b;font-size:12px;padding:16px 0;text-align:center">Không tìm thấy khách nào</div>';
        return;
      }

      customers.forEach(c => {
        const card = document.createElement('div');
        card.className = 'zai-customer-card';
        const daysSince = c.date ? daysSinceDate(c.date) : null;
        const daysLabel = daysSince !== null ? `${daysSince} ngày trước` : 'Chưa rõ';

        card.innerHTML = `
          <div class="zai-cust-header">
            <span class="zai-cust-name">${c.name || 'Không tên'}</span>
            ${c.segment ? `<span class="zai-cust-seg">${c.segment}</span>` : ''}
          </div>
          <div class="zai-cust-meta">📱 ${c.phone || '—'} &nbsp;·&nbsp; 🛍 ${c.product || '—'}</div>
          <div class="zai-cust-meta">📅 Mua lần cuối: ${c.date || '—'} (${daysLabel})</div>
          ${c.note ? `<div class="zai-cust-note">📝 ${c.note}</div>` : ''}
          <button class="zai-use-customer-btn">Dùng thông tin này → Soạn tin</button>
        `;

        card.querySelector('.zai-use-customer-btn').addEventListener('click', () => {
          useCustomer(panel, c);
        });
        listEl.appendChild(card);
      });

    } catch (err) {
      statusEl.textContent = `❌ ${err.message}`;
    }
  }

  function daysSinceDate(dateStr) {
    try {
      const parts = dateStr.split('/');
      const d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
      return Math.floor((Date.now() - d.getTime()) / 86400000);
    } catch { return null; }
  }

  function useCustomer(panel, c) {
    selectedCustomer = c;
    currentMode = 'care';
    panel.querySelectorAll('.zai-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === 'care'));
    switchMode(panel, 'care');

    panel.querySelector('#zai-care-name').value = c.name || '';
    panel.querySelector('#zai-care-last').value = [
      c.product ? `Đã mua: ${c.product}` : '',
      c.date    ? `lần cuối ${c.date}` : '',
      c.note    || ''
    ].filter(Boolean).join(', ');
    panel.querySelector('#zai-care-offer').value = '';

    const banner = panel.querySelector('#zai-selected-customer-banner');
    banner.style.display = 'flex';
    banner.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;background:rgba(99,102,241,0.12);
        border:1px solid rgba(99,102,241,0.3);border-radius:8px;padding:8px 10px;font-size:11.5px;color:#a5b4fc;">
        ✦ Đã tải: <strong>${c.name}</strong> &nbsp;·&nbsp; ${c.phone}
        <button onclick="this.closest('#zai-selected-customer-banner').style.display='none'"
          style="margin-left:auto;background:none;border:none;color:#64748b;cursor:pointer;font-size:14px">✕</button>
      </div>
    `;
  }

  // ── Render suggestions ────────────────────────────────────
  function renderSuggestions(container, suggestions) {
    if (!suggestions.length) {
      container.innerHTML = '<div id="zai-empty"><div id="zai-empty-icon">⚠️</div>Không có kết quả — thử lại</div>';
      return;
    }
    container.innerHTML = '<div id="zai-suggestions-label">GỢI Ý — Copy hoặc Gửi ngay</div>';
    suggestions.forEach(s => {
      const card = document.createElement('div');
      card.className = 'zai-suggestion-card';
      card.innerHTML = `
        <div class="zai-suggestion-tone">${s.tone}</div>
        <div class="zai-suggestion-text">${s.text}</div>
        <div class="zai-card-actions">
          <button class="zai-copy-btn">📋 Copy</button>
          <button class="zai-send-btn">🚀 Gửi ngay</button>
        </div>
      `;
      card.querySelector('.zai-copy-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(s.text).then(() => {
          const btn = card.querySelector('.zai-copy-btn');
          btn.textContent = '✓ Đã copy';
          setTimeout(() => { btn.textContent = '📋 Copy'; }, 1500);
        });
      });
      card.querySelector('.zai-send-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        const ok = sendToZalo(s.text);
        if (ok) {
          const btn = card.querySelector('.zai-send-btn');
          btn.textContent = '✓ Đã gửi!';
          btn.style.background = '#10b981';
          setTimeout(() => { btn.textContent = '🚀 Gửi ngay'; btn.style.background = ''; }, 2000);
        }
      });
      container.appendChild(card);
    });
  }

  function showStatus(el, msg) {
    el.textContent = msg;
    el.classList.add('visible');
    setTimeout(() => el.classList.remove('visible'), 5000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildPanel);
  } else {
    buildPanel();
  }
})();
