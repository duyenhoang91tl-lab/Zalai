// OME Zalo AI Helper - content script for chat.zalo.me
(function () {
  'use strict';

  let GAS_URL = '';
  let _cache = { customers: null, orders: null, fetchedAt: 0 };
  let _activeTone = 'Thân thiện';
  let _currentPhone = '';
  let _currentCustData = null;
  let _cfgVisible = false;

  const CACHE_TTL = 5 * 60 * 1000;
  const CARE_STATUSES = [
    'Chưa liên hệ', 'Chưa sử dụng',
    'Hẹn gọi lại sau', 'Đang sd', 'Đang tạm ngưng',
    'Knm/Máy bận', 'Cúp ngang', 'Thuê bao',
    'Phân vân/Tiềm năng', 'Chốt',
    'Kcnc/Không hiệu quả', 'Đặt hộ/Sai số', 'Bầu'
  ];

  // ── BUILD PANEL ──
  function buildPanel() {
    if (document.getElementById('ome-zai-panel')) return;

    const toggle = document.createElement('button');
    toggle.id = 'ome-zai-toggle';
    toggle.title = 'OME Zalo AI';
    toggle.textContent = '🤖 AI';
    toggle.addEventListener('click', togglePanel);
    document.body.appendChild(toggle);

    const panel = document.createElement('div');
    panel.id = 'ome-zai-panel';

    const hdr = document.createElement('div');
    hdr.className = 'zai-hdr';
    hdr.innerHTML = `<div style="flex:1"><div class="zai-hdr-title">🤖 OME Zalo AI</div><div class="zai-hdr-sub">Tra cứu & gợi ý phản hồi khách</div></div>`;
    const cfgBtn = document.createElement('button');
    cfgBtn.className = 'zai-cfg-btn';
    cfgBtn.id = 'zai-cfg-toggle';
    cfgBtn.title = 'Cài đặt';
    cfgBtn.textContent = '⚙';
    hdr.appendChild(cfgBtn);
    panel.appendChild(hdr);

    const cfg = document.createElement('div');
    cfg.className = 'zai-cfg';
    cfg.id = 'zai-cfg';
    cfg.style.display = 'none';

    const lbGas = document.createElement('label');
    lbGas.textContent = 'URL Web App GAS (appweb teamduyen)';
    cfg.appendChild(lbGas);
    const inpGas = document.createElement('input');
    inpGas.id = 'zai-gas-url';
    inpGas.type = 'text';
    inpGas.placeholder = 'https://script.google.com/macros/s/...';
    cfg.appendChild(inpGas);

    const lbKey = document.createElement('label');
    lbKey.textContent = '🔑 Groq API Key (lưu 1 lần dùng chung cả team)';
    cfg.appendChild(lbKey);
    const inpKey = document.createElement('input');
    inpKey.id = 'zai-gemini-key';
    inpKey.type = 'text';
    inpKey.placeholder = 'gsk_... (lấy miễn phí tại console.groq.com)';
    cfg.appendChild(inpKey);

    const saveBtn = document.createElement('button');
    saveBtn.className = 'zai-cfg-save';
    saveBtn.id = 'zai-cfg-save';
    saveBtn.textContent = '💾 Lưu cài đặt';
    cfg.appendChild(saveBtn);
    const hint = document.createElement('div');
    hint.className = 'zai-cfg-hint';
    hint.textContent = 'Key Groq được lưu vào Google Sheets, dùng chung cho cả team. Chỉ cần nhập 1 lần.';
    cfg.appendChild(hint);
    panel.appendChild(cfg);

    const body = document.createElement('div');
    body.className = 'zai-body';
    body.id = 'zai-body';

    // Phone
    const phoneWrap = document.createElement('div');
    const phoneLbl = document.createElement('div');
    phoneLbl.className = 'zai-section-label';
    phoneLbl.textContent = 'Số điện thoại khách';
    phoneWrap.appendChild(phoneLbl);
    const phoneRow = document.createElement('div');
    phoneRow.className = 'zai-phone-row';
    const phoneInp = document.createElement('input');
    phoneInp.id = 'zai-phone-input';
    phoneInp.type = 'tel';
    phoneInp.placeholder = '0901234567';
    const lookupBtn = document.createElement('button');
    lookupBtn.className = 'zai-btn zai-btn-primary zai-btn-sm';
    lookupBtn.id = 'zai-lookup-btn';
    lookupBtn.textContent = 'Tra cứu';
    phoneRow.appendChild(phoneInp);
    phoneRow.appendChild(lookupBtn);
    phoneWrap.appendChild(phoneRow);
    const autoHint = document.createElement('div');
    autoHint.id = 'zai-auto-hint';
    autoHint.style.cssText = 'font-size:10px;color:#00b14f;margin-top:3px';
    phoneWrap.appendChild(autoHint);
    body.appendChild(phoneWrap);

    const custArea = document.createElement('div');
    custArea.id = 'zai-cust-area';
    body.appendChild(custArea);

    // Update section
    const updateSec = document.createElement('div');
    updateSec.className = 'zai-update-section';
    updateSec.id = 'zai-update-section';
    updateSec.style.display = 'none';
    const updateLbl = document.createElement('div');
    updateLbl.className = 'zai-section-label';
    updateLbl.style.marginBottom = '6px';
    updateLbl.textContent = '📋 Cập nhật tình trạng CS';
    updateSec.appendChild(updateLbl);
    const statusLbl = document.createElement('label');
    statusLbl.textContent = 'Tình trạng';
    updateSec.appendChild(statusLbl);
    const statusSel = document.createElement('select');
    statusSel.id = 'zai-status-sel';
    const defOpt = document.createElement('option');
    defOpt.value = ''; defOpt.textContent = '— Chọn —';
    statusSel.appendChild(defOpt);
    CARE_STATUSES.forEach(s => {
      const o = document.createElement('option');
      o.value = s; o.textContent = s;
      statusSel.appendChild(o);
    });
    updateSec.appendChild(statusSel);
    const noteLbl = document.createElement('label');
    noteLbl.textContent = 'Ghi chú';
    updateSec.appendChild(noteLbl);
    const noteTa = document.createElement('textarea');
    noteTa.id = 'zai-note-ta';
    noteTa.placeholder = 'Ghi chú thêm...';
    noteTa.rows = 2;
    updateSec.appendChild(noteTa);
    const saveRow = document.createElement('div');
    saveRow.className = 'zai-save-row';
    const saveStatusBtn = document.createElement('button');
    saveStatusBtn.className = 'zai-btn zai-btn-primary zai-btn-sm';
    saveStatusBtn.id = 'zai-save-btn';
    saveStatusBtn.textContent = '💾 Lưu về GSheet';
    const saveStatusSpan = document.createElement('span');
    saveStatusSpan.className = 'zai-save-status';
    saveStatusSpan.id = 'zai-save-status';
    saveRow.appendChild(saveStatusBtn);
    saveRow.appendChild(saveStatusSpan);
    updateSec.appendChild(saveRow);
    body.appendChild(updateSec);

    const hr = document.createElement('hr');
    hr.className = 'zai-div';
    body.appendChild(hr);

    // AI section
    const aiWrap = document.createElement('div');
    const msgLbl = document.createElement('div');
    msgLbl.className = 'zai-section-label';
    msgLbl.textContent = 'Tin nhắn khách (copy từ Zalo)';
    aiWrap.appendChild(msgLbl);
    const msgTa = document.createElement('textarea');
    msgTa.className = 'zai-msg-area';
    msgTa.id = 'zai-msg';
    msgTa.placeholder = 'Dán tin nhắn của khách vào đây...';
    aiWrap.appendChild(msgTa);
    const ctxLbl = document.createElement('div');
    ctxLbl.style.cssText = 'margin-top:5px;font-size:11px;color:#6b7280';
    ctxLbl.textContent = 'Ngữ cảnh / Sản phẩm (tuỳ chọn)';
    aiWrap.appendChild(ctxLbl);
    const ctxInp = document.createElement('input');
    ctxInp.className = 'zai-ctx-input';
    ctxInp.id = 'zai-ctx';
    ctxInp.placeholder = 'VD: Đang tư vấn kem dưỡng, khách hỏi về giá...';
    aiWrap.appendChild(ctxInp);
    const tonesDiv = document.createElement('div');
    tonesDiv.className = 'zai-tones';
    tonesDiv.style.marginTop = '8px';
    ['Thân thiện', 'Chuyên nghiệp', 'Ngắn gọn', 'Nhiệt tình'].forEach((t, i) => {
      const tb = document.createElement('button');
      tb.className = 'zai-tone' + (i === 0 ? ' active' : '');
      tb.dataset.tone = t;
      tb.textContent = t;
      tonesDiv.appendChild(tb);
    });
    aiWrap.appendChild(tonesDiv);
    const genBtn = document.createElement('button');
    genBtn.className = 'zai-btn zai-btn-primary';
    genBtn.id = 'zai-gen-btn';
    genBtn.textContent = '✨ Tạo gợi ý AI';
    genBtn.style.cssText = 'width:100%;margin-top:8px';
    aiWrap.appendChild(genBtn);
    body.appendChild(aiWrap);

    const sugArea = document.createElement('div');
    sugArea.id = 'zai-sug-area';
    body.appendChild(sugArea);
    const errDiv = document.createElement('div');
    errDiv.className = 'zai-error';
    errDiv.id = 'zai-error';
    errDiv.style.display = 'none';
    body.appendChild(errDiv);

    panel.appendChild(body);
    document.body.appendChild(panel);

    // Events
    cfgBtn.addEventListener('click', () => {
      _cfgVisible = !_cfgVisible;
      cfg.style.display = _cfgVisible ? 'block' : 'none';
    });
    saveBtn.addEventListener('click', saveConfig);
    lookupBtn.addEventListener('click', doLookup);
    saveStatusBtn.addEventListener('click', doSaveStatus);
    genBtn.addEventListener('click', doGenerate);
    tonesDiv.addEventListener('click', (e) => {
      const tb = e.target.closest('.zai-tone');
      if (!tb) return;
      tonesDiv.querySelectorAll('.zai-tone').forEach(b => b.classList.remove('active'));
      tb.classList.add('active');
      _activeTone = tb.dataset.tone;
    });

    chrome.storage.local.get(['ome_gas_url'], (res) => {
      GAS_URL = res.ome_gas_url || '';
      if (GAS_URL) inpGas.value = GAS_URL;
      if (!GAS_URL) { _cfgVisible = true; cfg.style.display = 'block'; }
    });
  }

  function togglePanel() {
    const panel = document.getElementById('ome-zai-panel');
    const btn = document.getElementById('ome-zai-toggle');
    if (!panel) return;
    panel.classList.toggle('open');
    btn.classList.toggle('shifted');
  }

  async function saveConfig() {
    const gasEl = document.getElementById('zai-gas-url');
    GAS_URL = (gasEl ? gasEl.value.trim() : '');
    if (!GAS_URL) { showError('Vui lòng nhập URL GAS.'); return; }
    chrome.storage.local.set({ ome_gas_url: GAS_URL });
    const keyEl = document.getElementById('zai-gemini-key');
    const geminiKey = keyEl ? keyEl.value.trim() : '';
    if (geminiKey) {
      try {
        const r = await fetch(GAS_URL, {
          method: 'POST',
          body: JSON.stringify({ action: 'setSetting', key: 'geminiKey', value: geminiKey }),
          headers: { 'Content-Type': 'text/plain' }
        });
        const d = await r.json();
        if (d.ok) {
          showMsg('zai-save-status', '✓ Đã lưu Groq Key lên GSheet!', 3000);
          if (keyEl) keyEl.value = '';
        } else { showError('Lỗi lưu key: ' + JSON.stringify(d)); return; }
      } catch (e) { showError('Lỗi kết nối GAS: ' + e.message); return; }
    }
    _cfgVisible = false;
    document.getElementById('zai-cfg').style.display = 'none';
    _cache = { customers: null, orders: null, fetchedAt: 0 };
    if (!geminiKey) showMsg('zai-save-status', '✓ Đã lưu cài đặt', 2000);
  }

  // ── EXTRACT PHONE từ text (tên Zalo format "...tên... 09xxxxxxxx") ──
  function extractPhone(text) {
    if (!text) return null;
    const m = text.match(/(0[3-9]\d{8})/);
    return m ? m[1] : null;
  }

  // ── LẤY TÊN CUỘC CHAT HIỆN TẠI từ nhiều nguồn ──
  function getCurrentChatName() {
    // 1. Placeholder ô nhập tin nhắn: "Nhập @, tin nhắn tới <TÊN>"
    const selectors = [
      'div[contenteditable][placeholder*="tin nhắn tới"]',
      'div[contenteditable][data-placeholder*="tin nhắn tới"]',
      '[placeholder*="tin nhắn tới"]',
      '[data-placeholder*="tin nhắn tới"]'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const ph = el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || '';
        const name = ph.replace(/^.*tin nhắn tới\s*/i, '').trim();
        if (name) return name;
      }
    }
    // 2. Header title (thử nhiều selector)
    const headerSels = [
      '.chat-header__title',
      '[class*="chat-header"] [class*="title"]',
      '[class*="chatHeader"] [class*="title"]',
      '[class*="header"] h3',
      '[class*="header"] h4',
      '[class*="conversation"] [class*="name"]',
      '[class*="thread"] [class*="name"]'
    ];
    for (const sel of headerSels) {
      try {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim()) return el.textContent.trim();
      } catch(e) {}
    }
    return null;
  }

  // ── WATCH — dùng MutationObserver + setInterval song song ──
  function watchZaloChat() {
    let _lastName = '';

    function check() {
      const name = getCurrentChatName();
      if (!name || name === _lastName) return;
      _lastName = name;
      const phone = extractPhone(name);
      if (phone && phone !== _currentPhone) {
        _currentPhone = phone;
        const inp = document.getElementById('zai-phone-input');
        if (inp) {
          inp.value = phone;
          const hint = document.getElementById('zai-auto-hint');
          if (hint) hint.textContent = '✓ Tự động: ' + name.trim();
          doLookup();
        }
      }
    }

    // Observer bắt DOM thay đổi
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    // Interval dự phòng — kiểm tra mỗi 1.5s khi DOM không thay đổi (VD: chuyển tab)
    setInterval(check, 1500);
  }

  // ── DATA FETCHING ──
  async function fetchAllData() {
    if (!GAS_URL) throw new Error('Chưa cài đặt URL GAS. Nhấn ⚙.');
    const now = Date.now();
    if (_cache.customers && _cache.orders && now - _cache.fetchedAt < CACHE_TTL) return _cache;
    const sep = GAS_URL.includes('?') ? '&' : '?';
    const [custRes, ordRes] = await Promise.all([
      fetch(GAS_URL + sep + 'action=customers', { redirect: 'follow' }),
      fetch(GAS_URL + sep + 'action=orders', { redirect: 'follow' })
    ]);
    const custData = await custRes.json();
    const ordData  = await ordRes.json();
    const custMap  = {};
    (custData.rows || []).forEach(r => { if (r.phone) custMap[normPhone(r.phone)] = r; });
    const ordMap = {};
    (ordData.orders || []).forEach(o => {
      const p = normPhone(o.phone); if (!p) return;
      if (!ordMap[p]) ordMap[p] = [];
      ordMap[p].push(o);
    });
    _cache = { customers: custMap, orders: ordMap, fetchedAt: Date.now() };
    return _cache;
  }

  function normPhone(p) {
    if (!p) return '';
    let s = String(p).replace(/\D/g, '');
    if (s.startsWith('84') && s.length === 11) s = '0' + s.slice(2);
    return s;
  }

  // ── LOOKUP ──
  async function doLookup() {
    const raw = (document.getElementById('zai-phone-input').value || '').trim();
    if (!raw) { showError('Vui lòng nhập số điện thoại.'); return; }
    hideError();
    const phone = normPhone(raw);
    const area = document.getElementById('zai-cust-area');
    const updateSec = document.getElementById('zai-update-section');
    area.innerHTML = '<div class="zai-loading"><div class="zai-spinner"></div>Đang tra cứu...</div>';
    updateSec.style.display = 'none';
    _currentCustData = null;
    try {
      const data = await fetchAllData();
      const care   = data.customers[phone];
      const orders = (data.orders[phone] || []).slice().sort((a, b) => new Date(b.date) - new Date(a.date));
      if (!care && !orders.length) {
        area.innerHTML = `<div class="zai-not-found">Không tìm thấy <strong>${escHtml(raw)}</strong>.<br><small>Thử Sync GS trên app trước.</small></div>`;
        return;
      }
      const name     = orders.length ? (orders[0].name || raw) : raw;
      const products = [...new Set(orders.map(o => o.product).filter(Boolean))].join(', ');
      const totalRev = orders.reduce((s, o) => s + (parseFloat(o.revenue) || 0), 0);
      _currentCustData = { phone, name, care, orders };
      area.innerHTML = `
        <div class="zai-card">
          <div class="zai-card-name">${escHtml(name)} <span style="font-size:11px;font-weight:400;color:#9ca3af">${escHtml(raw)}</span></div>
          <div class="zai-chips">
            ${orders.length ? `<span class="zai-chip">📦 ${orders.length} đơn</span>` : ''}
            ${totalRev ? `<span class="zai-chip">💰 ${Math.round(totalRev/1000)}K</span>` : ''}
            ${products ? `<span class="zai-chip">🏷 ${escHtml(products)}</span>` : ''}
            ${care && care.status ? `<span class="zai-chip">📋 ${escHtml(care.status)}</span>` : ''}
            ${care && care.cs ? `<span class="zai-chip">👤 CS: ${escHtml(care.cs)}</span>` : ''}
          </div>
          ${care && care.note ? `<div class="zai-card-note">📝 ${escHtml(care.note)}</div>` : ''}
          ${orders.slice(0,3).length ? `<div class="zai-card-orders"><strong>Đơn gần nhất:</strong><br>${orders.slice(0,3).map(o => {
            const d = o.date ? new Date(o.date).toLocaleDateString('vi-VN') : '?';
            return `• ${d} — ${escHtml(o.product||o.productDetail||'?')}${o.revenue?' ('+Number(o.revenue).toLocaleString('vi-VN')+'đ)':''}`;
          }).join('<br>')}</div>` : ''}
        </div>`;
      updateSec.style.display = 'block';
      if (care && care.status) document.getElementById('zai-status-sel').value = care.status;
      if (care && care.note)   document.getElementById('zai-note-ta').value    = care.note;
    } catch (e) {
      area.innerHTML = '';
      showError(e.message);
    }
  }

  // ── SAVE STATUS ──
  async function doSaveStatus() {
    if (!_currentCustData) { showError('Chưa tra cứu khách nào.'); return; }
    if (!GAS_URL) { showError('Chưa cài đặt URL GAS.'); return; }
    const status = document.getElementById('zai-status-sel').value;
    const note   = document.getElementById('zai-note-ta').value;
    const btn    = document.getElementById('zai-save-btn');
    btn.disabled = true; btn.textContent = 'Đang lưu...';
    try {
      const care = _currentCustData.care || {};
      const row  = {
        phone: _currentCustData.phone, status: status || care.status || '',
        zalo: care.zalo || '', cs: care.cs || '', note,
        schedules: care.schedules||'', schedGoi: care.schedGoi||'',
        schedGoiNote: care.schedGoiNote||'', schedSP: care.schedSP||'',
        schedSPNote: care.schedSPNote||'', schedCS: care.schedCS||'',
        schedCSNote: care.schedCSNote||'', schedHen: care.schedHen||'',
        schedHenNote: care.schedHenNote||''
      };
      const res = await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'saveSingle', row }),
        headers: { 'Content-Type': 'text/plain' }
      });
      const d = await res.json();
      if (d.ok) {
        showMsg('zai-save-status', '✓ Đã lưu lên GSheet!', 3000);
        if (_cache.customers) _cache.customers[_currentCustData.phone] = { ...care, status, note };
      } else { showError('Lỗi: ' + JSON.stringify(d)); }
    } catch (e) { showError('Lỗi kết nối: ' + e.message); }
    finally { btn.disabled = false; btn.textContent = '💾 Lưu về GSheet'; }
  }

  // ── AI GENERATE ──
  async function doGenerate() {
    if (!GAS_URL) { showError('Chưa cài đặt URL GAS. Nhấn ⚙.'); return; }
    const msg = (document.getElementById('zai-msg').value || '').trim();
    if (!msg) { showError('Vui lòng dán tin nhắn của khách.'); return; }
    const ctx = (document.getElementById('zai-ctx').value || '').trim();
    const btn = document.getElementById('zai-gen-btn');
    const sugArea = document.getElementById('zai-sug-area');
    hideError();
    btn.disabled = true; btn.textContent = 'AI đang soạn...';
    sugArea.innerHTML = '<div class="zai-loading"><div class="zai-spinner"></div>Đang tạo gợi ý...</div>';
    let custLines = [];
    if (_currentCustData) {
      const { name, phone, care, orders } = _currentCustData;
      custLines.push('Tên: ' + name + ' | SĐT: ' + phone);
      if (orders && orders.length) custLines.push('Số đơn: ' + orders.length);
      const prods = [...new Set((orders||[]).map(o=>o.product).filter(Boolean))].slice(0,3).join(', ');
      if (prods) custLines.push('SP đã mua: ' + prods);
      if (care && care.status) custLines.push('Tình trạng: ' + care.status);
    }
    if (ctx) custLines.push('Ngữ cảnh: ' + ctx);
    const prompt =
      (custLines.length ? '[KH] ' + custLines.join(' | ') + '\n' : '') +
      '[TN khách] ' + msg + '\n' +
      '[Giọng văn] ' + _activeTone + '\n' +
      'Soạn 1 tin nhắn trả lời phù hợp, ngắn gọn, tiếng Việt tự nhiên.';
    try {
      const res = await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'ai', prompt }),
        headers: { 'Content-Type': 'text/plain' }
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'GAS trả về lỗi');
      const text = (data.text || '').trim();
      sugArea.innerHTML = '';
      const sugLbl = document.createElement('div');
      sugLbl.className = 'zai-section-label';
      sugLbl.textContent = '💡 Gợi ý phản hồi (click để copy)';
      sugArea.appendChild(sugLbl);
      const card = document.createElement('div');
      card.className = 'zai-sug';
      const txt = document.createElement('div');
      txt.innerHTML = escHtml(text).replace(/\n/g, '<br>');
      const badge = document.createElement('span');
      badge.className = 'zai-copy-badge';
      badge.textContent = 'Copy';
      card.appendChild(txt);
      card.appendChild(badge);
      card.addEventListener('click', () => {
        navigator.clipboard.writeText(text).then(() => {
          badge.textContent = '✓ Đã copy!';
          badge.classList.add('zai-copied');
          setTimeout(() => { badge.textContent = 'Copy'; badge.classList.remove('zai-copied'); }, 1500);
        });
      });
      sugArea.appendChild(card);
    } catch (e) {
      sugArea.innerHTML = '';
      showError('Lỗi: ' + e.message);
    } finally {
      btn.disabled = false; btn.textContent = '✨ Tạo gợi ý AI';
    }
  }

  function showError(msg) { const el = document.getElementById('zai-error'); if (el) { el.textContent = msg; el.style.display = 'block'; } }
  function hideError() { const el = document.getElementById('zai-error'); if (el) el.style.display = 'none'; }
  function showMsg(id, msg, ms) { const el = document.getElementById(id); if (!el) return; el.textContent = msg; if (ms) setTimeout(() => { el.textContent = ''; }, ms); }
  function escHtml(str) { return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function init() { buildPanel(); watchZaloChat(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
