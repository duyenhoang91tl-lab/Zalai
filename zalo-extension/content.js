// OME Zalo AI Helper - content script v14.3
// v14.3: AI section len tren, lich su xuong duoi, an lich su (chi show status), 100 tin, fix emoticon
(function () {
  'use strict';

  let GAS_URL = '';
  let _lookupCache = {};
  let _activeTone = 'Thân thiện';
  let _currentPhone = '';
  let _currentCustData = null;
  let _cfgVisible = false;
  let _chatHistory = []; // luu tin nhan khach, khong hien thi trong textarea
  let _histVisible = false;

  const LOOKUP_TTL = 5 * 60 * 1000;
  const CARE_STATUSES = [
    'Chưa liên hệ','Chưa sử dụng','Hẹn gọi lại sau','Đang sd','Đang tạm ngưng',
    'Knm/Máy bận','Cúp ngang','Thuê bao','Phân vân/Tiềm năng','Chốt',
    'Kcnc/Không hiệu quả','Đặt hộ/Sai số','Bầu'
  ];
  const ZALO_STATUSES = ['','Đã kết bạn','Chưa kết bạn','Đã chặn','Không có Zalo'];
  const CS_NAMES = ['','duyenht','thaomt','dieptn','vanntt'];

  // BUILD PANEL
  function buildPanel() {
    if (document.getElementById('ome-zai-panel')) return;

    const toggle = document.createElement('button');
    toggle.id = 'ome-zai-toggle'; toggle.title = 'OME Zalo AI'; toggle.textContent = '🤖 AI';
    toggle.addEventListener('click', togglePanel);
    document.body.appendChild(toggle);

    const panel = document.createElement('div');
    panel.id = 'ome-zai-panel';

    // Header
    const hdr = document.createElement('div');
    hdr.className = 'zai-hdr';
    hdr.innerHTML = `<div style="flex:1"><div class="zai-hdr-title">🤖 OME Zalo AI</div><div class="zai-hdr-sub">Tra cứu & gợi ý phản hồi khách</div></div>`;
    const cfgBtn = document.createElement('button');
    cfgBtn.className = 'zai-cfg-btn'; cfgBtn.id = 'zai-cfg-toggle'; cfgBtn.title = 'Cài đặt'; cfgBtn.textContent = '⚙';
    hdr.appendChild(cfgBtn); panel.appendChild(hdr);

    // Config
    const cfg = document.createElement('div');
    cfg.className = 'zai-cfg'; cfg.id = 'zai-cfg'; cfg.style.display = 'none';
    addEl(cfg, 'label', {textContent:'URL Web App GAS (appweb teamduyen)'});
    const inpGas = addEl(cfg, 'input', {id:'zai-gas-url', type:'text', placeholder:'https://script.google.com/macros/s/...'});
    addEl(cfg, 'label', {textContent:'🔑 Groq API Key (lưu 1 lần dùng chung cả team)'});
    addEl(cfg, 'input', {id:'zai-gemini-key', type:'text', placeholder:'gsk_... (lấy miễn phí tại console.groq.com)'});
    const saveBtn = addEl(cfg, 'button', {className:'zai-cfg-save', id:'zai-cfg-save', textContent:'💾 Lưu cài đặt'});
    addEl(cfg, 'div', {className:'zai-cfg-hint', textContent:'Key Groq được lưu vào Google Sheets, dùng chung cho cả team.'});
    panel.appendChild(cfg);

    // Body
    const body = document.createElement('div');
    body.className = 'zai-body'; body.id = 'zai-body';

    // 1. PHONE
    addEl(body, 'div', {className:'zai-section-label', textContent:'Số điện thoại khách'});
    const phoneRow = addEl(body, 'div', {className:'zai-phone-row'});
    addEl(phoneRow, 'input', {id:'zai-phone-input', type:'tel', placeholder:'0901234567'});
    addEl(phoneRow, 'button', {className:'zai-btn zai-btn-primary zai-btn-sm', id:'zai-lookup-btn', textContent:'Tra cứu'});
    addEl(body, 'div', {id:'zai-auto-hint', style:'font-size:10px;color:#00b14f;margin-top:3px'});

    body.appendChild(Object.assign(document.createElement('hr'), {className:'zai-div'}));

    // 2. AI SECTION (len tren)
    const aiWrap = addEl(body, 'div', {});
    const tonesDiv = addEl(aiWrap, 'div', {className:'zai-tones', style:'margin-bottom:8px'});
    ['Thân thiện','Chuyên nghiệp','Ngắn gọn','Nhiệt tình'].forEach((t,i) => {
      addEl(tonesDiv, 'button', {className:'zai-tone'+(i===0?' active':''), dataset:{tone:t}, textContent:t});
    });

    addEl(aiWrap, 'button', {className:'zai-btn zai-btn-secondary', id:'zai-open-btn',
      textContent:'💬 Tạo TN mở đầu (dựa lịch sử mua)', style:'width:100%;margin-bottom:8px'});

    // Grab row
    const msgHdr = addEl(aiWrap, 'div', {style:'display:flex;align-items:center;justify-content:space-between;margin-bottom:4px'});
    addEl(msgHdr, 'div', {className:'zai-section-label', style:'margin:0', textContent:'Tin nhắn khách'});
    addEl(msgHdr, 'button', {className:'zai-btn zai-btn-ghost zai-btn-sm', id:'zai-grab-btn',
      textContent:'📥 Lấy TN', title:'Tự động lấy 100 tin nhắn gần nhất của khách'});

    // History status
    const histStatus = addEl(aiWrap, 'div', {id:'zai-hist-status', style:'font-size:11px;color:#6b7280;margin-bottom:4px;display:none'});

    // Textarea (an mac dinh)
    const msgTa = addEl(aiWrap, 'textarea', {className:'zai-msg-area', id:'zai-msg',
      placeholder:'Dán thủ công nếu cần...'});
    msgTa.style.display = 'none';

    addEl(aiWrap, 'div', {style:'margin-top:5px;font-size:11px;color:#6b7280', textContent:'Ngữ cảnh / Sản phẩm (tuỳ chọn)'});
    addEl(aiWrap, 'input', {className:'zai-ctx-input', id:'zai-ctx', placeholder:'VD: khách hỏi về giá, muốn mua thêm...'});
    addEl(aiWrap, 'button', {className:'zai-btn zai-btn-primary', id:'zai-gen-btn',
      textContent:'✨ Tạo gợi ý phản hồi', style:'width:100%;margin-top:8px'});

    addEl(body, 'div', {id:'zai-sug-area'});
    addEl(body, 'div', {className:'zai-error', id:'zai-error', style:'display:none'});

    body.appendChild(Object.assign(document.createElement('hr'), {className:'zai-div'}));

    // 3. CUSTOMER CARD (xuong duoi)
    addEl(body, 'div', {id:'zai-cust-area'});

    // 4. UPDATE SECTION
    const upd = addEl(body, 'div', {className:'zai-update-section', id:'zai-update-section'});
    upd.style.display = 'none';
    addEl(upd, 'div', {className:'zai-section-label', style:'margin-bottom:8px', textContent:'📋 Cập nhật thông tin CS'});

    const row1 = addEl(upd, 'div', {className:'zai-field-row'});
    const col1 = addEl(row1, 'div', {className:'zai-field-col'});
    addEl(col1, 'label', {textContent:'Tình trạng CS'});
    const statusSel = addEl(col1, 'select', {id:'zai-status-sel'});
    addEl(statusSel, 'option', {value:'', textContent:'— Chọn —'});
    CARE_STATUSES.forEach(s => addEl(statusSel, 'option', {value:s, textContent:s}));

    const col2 = addEl(row1, 'div', {className:'zai-field-col'});
    addEl(col2, 'label', {textContent:'Kết bạn Zalo'});
    const zaloSel = addEl(col2, 'select', {id:'zai-zalo-sel'});
    ZALO_STATUSES.forEach(s => addEl(zaloSel, 'option', {value:s, textContent:s||'— Chọn —'}));

    addEl(upd, 'label', {textContent:'CS chăm sóc'});
    const csSel = addEl(upd, 'select', {id:'zai-cs-sel'});
    CS_NAMES.forEach(s => addEl(csSel, 'option', {value:s, textContent:s||'— Chọn CS —'}));

    const row2 = addEl(upd, 'div', {className:'zai-field-row'});
    const col3 = addEl(row2, 'div', {className:'zai-field-col'});
    addEl(col3, 'label', {textContent:'Lịch hẹn'});
    addEl(col3, 'input', {id:'zai-hen-date', type:'date'});
    const col4 = addEl(row2, 'div', {className:'zai-field-col'});
    addEl(col4, 'label', {textContent:'Ghi chú hẹn'});
    addEl(col4, 'input', {id:'zai-hen-note', type:'text', placeholder:'Hẹn gì...'});

    addEl(upd, 'label', {textContent:'Ghi chú CS'});
    addEl(upd, 'textarea', {id:'zai-note-ta', placeholder:'Ghi chú thêm...', rows:2});

    const saveRow = addEl(upd, 'div', {className:'zai-save-row'});
    addEl(saveRow, 'button', {className:'zai-btn zai-btn-primary zai-btn-sm', id:'zai-save-btn', textContent:'💾 Lưu về GSheet'});
    addEl(saveRow, 'span', {className:'zai-save-status', id:'zai-save-status'});

    panel.appendChild(body);
    document.body.appendChild(panel);

    // EVENTS
    cfgBtn.addEventListener('click', () => { _cfgVisible = !_cfgVisible; cfg.style.display = _cfgVisible ? 'block' : 'none'; });
    saveBtn.addEventListener('click', saveConfig);
    document.getElementById('zai-lookup-btn').addEventListener('click', doLookup);
    document.getElementById('zai-save-btn').addEventListener('click', doSaveStatus);
    document.getElementById('zai-open-btn').addEventListener('click', doGenerateOpener);
    document.getElementById('zai-grab-btn').addEventListener('click', doGrabMessage);
    document.getElementById('zai-gen-btn').addEventListener('click', doGenerate);
    tonesDiv.addEventListener('click', (e) => {
      const tb = e.target.closest('.zai-tone'); if (!tb) return;
      tonesDiv.querySelectorAll('.zai-tone').forEach(b => b.classList.remove('active'));
      tb.classList.add('active'); _activeTone = tb.dataset.tone;
    });
    chrome.storage.local.get(['ome_gas_url'], (res) => {
      GAS_URL = res.ome_gas_url || '';
      if (GAS_URL) inpGas.value = GAS_URL;
      if (!GAS_URL) { _cfgVisible = true; cfg.style.display = 'block'; }
    });
  }

  function addEl(parent, tag, props) {
    const el = document.createElement(tag);
    if (props.dataset) { Object.assign(el.dataset, props.dataset); delete props.dataset; }
    if (props.style && typeof props.style === 'string') { el.style.cssText = props.style; delete props.style; }
    Object.assign(el, props);
    parent.appendChild(el);
    return el;
  }

  function togglePanel() {
    const panel = document.getElementById('ome-zai-panel');
    const btn   = document.getElementById('ome-zai-toggle');
    if (!panel) return;
    panel.classList.toggle('open'); btn.classList.toggle('shifted');
  }

  async function saveConfig() {
    const gasEl = document.getElementById('zai-gas-url');
    GAS_URL = gasEl ? gasEl.value.trim() : '';
    if (!GAS_URL) { showError('Vui lòng nhập URL GAS.'); return; }
    chrome.storage.local.set({ ome_gas_url: GAS_URL });
    const keyEl = document.getElementById('zai-gemini-key');
    const key = keyEl ? keyEl.value.trim() : '';
    if (key) {
      try {
        const r = await fetch(GAS_URL, { method:'POST', body:JSON.stringify({action:'setSetting',key:'geminiKey',value:key}), headers:{'Content-Type':'text/plain'} });
        const d = await r.json();
        if (d.ok) { showMsg('zai-save-status','✓ Đã lưu Groq Key!',3000); if(keyEl) keyEl.value=''; }
        else { showError('Lỗi lưu key: '+JSON.stringify(d)); return; }
      } catch(e) { showError('Lỗi kết nối GAS: '+e.message); return; }
    }
    _cfgVisible = false;
    document.getElementById('zai-cfg').style.display = 'none';
    _lookupCache = {};
    if (!key) showMsg('zai-save-status','✓ Đã lưu cài đặt',2000);
  }

  function normPhone(p) {
    if (!p) return '';
    let s = String(p).replace(/\D/g,'');
    if (s.startsWith('84') && s.length===11) s='0'+s.slice(2);
    if (s.length===9 && /^[3-9]/.test(s)) s='0'+s;
    return s;
  }

  function extractPhone(text) {
    if (!text) return null;
    const m = text.match(/(0[3-9]\d{8})/);
    return m ? m[1] : null;
  }
  function getCurrentChatName() {
    const sels = ['div[contenteditable][placeholder*="tin nhắn tới"]','[placeholder*="tin nhắn tới"]','[data-placeholder*="tin nhắn tới"]'];
    for (const sel of sels) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          const ph = el.getAttribute('placeholder')||el.getAttribute('data-placeholder')||'';
          const name = ph.replace(/^.*tin nhắn tới\s*/i,'').trim();
          if (name) return name;
        }
      } catch(e){}
    }
    for (const sel of ['.chat-header__title','[class*="chat-header"] [class*="title"]','[class*="header"] h3','[class*="header"] h4']) {
      try { const el=document.querySelector(sel); if(el&&el.textContent.trim()) return el.textContent.trim(); } catch(e){}
    }
    return null;
  }
  function watchZaloChat() {
    let _last = '';
    function check() {
      const name = getCurrentChatName();
      if (!name || name === _last) return;
      _last = name;
      const phone = extractPhone(name);
      if (phone && phone !== _currentPhone) {
        _currentPhone = phone;
        const inp = document.getElementById('zai-phone-input');
        if (inp) {
          inp.value = phone;
          const hint = document.getElementById('zai-auto-hint');
          if (hint) hint.textContent = '✓ Tự động: '+name.trim();
          doLookup();
        }
      }
    }
    new MutationObserver(check).observe(document.body, {childList:true, subtree:true, characterData:true});
    setInterval(check, 1500);
  }

  // GRAB TIN NHAN KHACH

  // Lay text thuan, bo qua <img> (Zalo render emoticon thanh img)
  function getTextOnly_(el) {
    let t = '';
    for (const node of el.childNodes) {
      if (node.nodeType === 3) t += node.textContent;
      else if (node.nodeType === 1 && node.tagName !== 'IMG') t += getTextOnly_(node);
    }
    return t;
  }

  function stripText_(text) {
    return text
      // Xoa timestamp noi tuyen vi du "20:23" gan sat chu
      .replace(/\d{1,2}:\d{2}/g, '')
      // Zalo text emoticon dang /-heart/ hoac /-heart
      .replace(/\/-[\w-]+\/?/g, '')
      // Emoticon alt text dang -heart -strong (khong co slash dau)
      .replace(/(^|\s)-[a-z][\w-]*/gi, '$1')
      // Text emoticons ASCII
      .replace(/:-?[hH]|:-?[)(DdPpOo><]|:[vV3]|=\)+|\^{2,}|>:<|:\*/g, '')
      // Unicode emoji
      .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
      .replace(/[\u{2600}-\u{27BF}]/gu, '')
      .replace(/[\u{FE00}-\u{FE0F}]/gu, '')
      .replace(/[\u{1F900}-\u{1F9FF}]/gu, '')
      .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  const SKIP_MSG = [
    /^\d{1,2}:\d{2}$/,
    /^\d{1,3}$/,
    /^bạn bị nhỡ/i,
    /^cuộc gọi/i,
    /^gọi lại$/i,
    /^missed call/i,
    /^đã thu hồi/i,
    /^tin nhắn đã xóa/i,
  ];

  function doGrabMessage() {
    const chatArea = document.querySelector(
      '[class*="chat-content"],[class*="message-list"],[class*="conversation-content"],[class*="msg-list"],[class*="MessageBox"]'
    );
    if (!chatArea) { showError('Không tìm thấy vùng chat. Thử click vào cuộc trò chuyện trước.'); return; }

    const chatRect = chatArea.getBoundingClientRect();
    const midX = chatRect.left + chatRect.width * 0.55;

    const OWN_MARKERS = ['owner','--me','_me_','sent','outgoing'];
    let allItems = [];
    for (const sel of ['[class*="message-item"]','[class*="msg-item"]','[class*="chat-item"]','[class*="message"]']) {
      const found = [...chatArea.querySelectorAll(sel)];
      if (found.length > 2) { allItems = found; break; }
    }

    let msgs = [];
    for (const item of allItems) {
      try {
        const cls = (item.className||'').toLowerCase();
        if (OWN_MARKERS.some(m => cls.includes(m))) continue;
        const rect = item.getBoundingClientRect();
        if (rect.width > 10 && rect.left > midX) continue;
        if (['system','notify','date-','divider'].some(m => cls.includes(m))) continue;

        const textEl = item.querySelector('[class*="text"],[class*="content"],[class*="body"],[class*="message-text"]') || item;
        const raw = getTextOnly_(textEl).trim();
        if (!raw) continue;
        if (SKIP_MSG.some(p => p.test(raw))) continue;

        const clean = stripText_(raw);
        if (!clean || clean.length < 2) continue;
        msgs.push(clean);
      } catch(e) {}
    }

    const seen = new Set();
    const uniq = msgs.filter(m => { if (seen.has(m)) return false; seen.add(m); return true; });
    const last100 = uniq.slice(-100);

    const histStatus = document.getElementById('zai-hist-status');
    const msgTa = document.getElementById('zai-msg');

    if (last100.length) {
      _chatHistory = last100;
      if (msgTa) msgTa.value = last100.join('\n---\n');

      if (histStatus) {
        _histVisible = false;
        if (msgTa) msgTa.style.display = 'none';
        histStatus.style.display = 'block';
        histStatus.innerHTML = `✓ Load history done: <b>${last100.length} tin</b> &nbsp;<a href="#" id="zai-hist-toggle" style="color:#00b14f;text-decoration:underline">Xem</a>`;
        document.getElementById('zai-hist-toggle').addEventListener('click', (e) => {
          e.preventDefault();
          _histVisible = !_histVisible;
          if (msgTa) msgTa.style.display = _histVisible ? 'block' : 'none';
          e.target.textContent = _histVisible ? 'Ẩn' : 'Xem';
        });
      }
    } else {
      showError('Không đọc được tin nhắn. Dán thủ công vào ô bên dưới.');
      if (histStatus) histStatus.style.display = 'none';
      if (msgTa) msgTa.style.display = 'block';
    }
  }

  // LOOKUP
  async function doLookup() {
    const raw = (document.getElementById('zai-phone-input').value||'').trim();
    if (!raw) { showError('Vui lòng nhập số điện thoại.'); return; }
    hideError();
    const phone = normPhone(raw);
    const area   = document.getElementById('zai-cust-area');
    const updSec = document.getElementById('zai-update-section');
    updSec.style.display = 'none';
    _currentCustData = null;

    if (!GAS_URL) { showError('Chưa cài URL GAS. Nhấn ⚙.'); area.innerHTML=''; return; }

    const hit = _lookupCache[phone];
    if (hit && Date.now() - hit.ts < LOOKUP_TTL) {
      if (!hit.orders.length && !hit.care) showNotFoundWithForm_(area, updSec, phone, raw);
      else renderCard_(area, updSec, phone, raw, hit.care, hit.orders);
      return;
    }

    area.innerHTML = '<div class="zai-loading"><div class="zai-spinner"></div>Đang tra cứu...</div>';

    try {
      const sep = GAS_URL.includes('?') ? '&' : '?';
      const r = await fetch(
        GAS_URL + sep + 'action=lookup&phone=' + encodeURIComponent(phone),
        {redirect:'follow'}
      );
      const d = await r.json();
      if (d.error) throw new Error(d.error);

      const orders = (d.orders||[]).slice().sort((a,b) => parseDate_(b.date)-parseDate_(a.date));
      _lookupCache[phone] = {care: d.care||null, orders, ts: Date.now()};

      if (!orders.length && !d.care) {
        showNotFoundWithForm_(area, updSec, phone, raw);
      } else {
        renderCard_(area, updSec, phone, raw, d.care||null, orders);
      }
    } catch(e) {
      area.innerHTML = '';
      showError('Lỗi tra cứu: ' + e.message);
      showNotFoundWithForm_(area, updSec, phone, raw);
    }
  }

  function showNotFoundWithForm_(area, updSec, phone, raw) {
    area.innerHTML = `<div class="zai-not-found">⚠️ <strong>${escHtml(raw)}</strong> chưa có trong hệ thống.<br><small>Có thể thêm mới bên dưới.</small></div>`;
    _currentCustData = {phone, name: raw, care: null, orders: []};
    updSec.style.display = 'block';
    clearForm_();
  }

  function clearForm_() {
    ['zai-status-sel','zai-zalo-sel','zai-cs-sel','zai-hen-date','zai-hen-note','zai-note-ta']
      .forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  }

  function renderCard_(area, updSec, phone, raw, care, orders) {
    const name   = orders.length ? (orders[0].name||raw) : (care&&care.name||raw);
    const prods  = [...new Set(orders.map(o=>o.product).filter(Boolean))].join(', ');
    const totRev = orders.reduce((s,o)=>s+(parseFloat(o.revenue)||0),0);
    _currentCustData = {phone, name, care, orders};

    area.innerHTML = `
      <div class="zai-card">
        <div class="zai-card-name">${escHtml(name)} <span style="font-size:11px;font-weight:400;color:#9ca3af">${escHtml(raw)}</span></div>
        <div class="zai-chips">
          ${orders.length ? `<span class="zai-chip">📦 ${orders.length} đơn</span>` : ''}
          ${totRev ? `<span class="zai-chip">💰 ${Math.round(totRev/1000)}K</span>` : ''}
          ${prods ? `<span class="zai-chip">🏷 ${escHtml(prods)}</span>` : ''}
          ${care&&care.status ? `<span class="zai-chip">📋 ${escHtml(care.status)}</span>` : ''}
          ${care&&care.zalo  ? `<span class="zai-chip">💬 ${escHtml(care.zalo)}</span>` : ''}
          ${care&&care.cs    ? `<span class="zai-chip">👤 ${escHtml(care.cs)}</span>` : ''}
          ${care&&care.schedHen ? `<span class="zai-chip">📅 ${fmtDate_(care.schedHen)}</span>` : ''}
        </div>
        ${care&&care.note ? `<div class="zai-card-note">📝 ${escHtml(care.note)}</div>` : ''}
        ${orders.slice(0,3).length ? `<div class="zai-card-orders"><strong>Đơn gần nhất:</strong><br>${
          orders.slice(0,3).map(o => {
            const d = fmtDate_(o.date);
            const rev = o.revenue ? Number(o.revenue).toLocaleString('vi-VN')+'đ' : '';
            const sp = (o.product||'') + (o.productDetail?' — '+o.productDetail:'');
            return `• <b>${d}</b> | ${rev}<br>&nbsp;&nbsp;${escHtml(sp)}`;
          }).join('<br>')
        }</div>` : ''}
      </div>`;

    updSec.style.display = 'block';
    document.getElementById('zai-status-sel').value = care&&care.status||'';
    document.getElementById('zai-zalo-sel').value   = care&&care.zalo||'';
    document.getElementById('zai-cs-sel').value     = care&&care.cs||'';
    document.getElementById('zai-hen-date').value   = care&&care.schedHen ? toInputDate_(care.schedHen) : '';
    document.getElementById('zai-hen-note').value   = care&&care.schedHenNote||'';
    document.getElementById('zai-note-ta').value    = care&&care.note||'';
  }

  // SAVE STATUS
  async function doSaveStatus() {
    if (!_currentCustData) { showError('Chưa tra cứu khách nào.'); return; }
    if (!GAS_URL) { showError('Chưa cài đặt URL GAS.'); return; }
    const status  = document.getElementById('zai-status-sel').value;
    const zalo    = document.getElementById('zai-zalo-sel').value;
    const cs      = document.getElementById('zai-cs-sel').value;
    const henDate = document.getElementById('zai-hen-date').value;
    const henNote = document.getElementById('zai-hen-note').value.trim();
    const note    = document.getElementById('zai-note-ta').value;
    const btn    = document.getElementById('zai-save-btn');
    btn.disabled = true; btn.textContent = 'Đang lưu...';
    try {
      const c = _currentCustData.care||{};
      const row = {
        phone:_currentCustData.phone, status:status||c.status||'',
        zalo:zalo||c.zalo||'', cs:cs||c.cs||'', note,
        schedules:c.schedules||'', schedGoi:c.schedGoi||'', schedGoiNote:c.schedGoiNote||'',
        schedSP:c.schedSP||'', schedSPNote:c.schedSPNote||'',
        schedCS:c.schedCS||'', schedCSNote:c.schedCSNote||'',
        schedHen:henDate||c.schedHen||'', schedHenNote:henNote||c.schedHenNote||''
      };
      const res = await fetch(GAS_URL, {method:'POST', body:JSON.stringify({action:'saveSingle',row}), headers:{'Content-Type':'text/plain'}});
      const d = await res.json();
      if (d.ok) {
        showMsg('zai-save-status','✓ Đã lưu lên GSheet!',3000);
        delete _lookupCache[_currentCustData.phone];
      } else { showError('Lỗi: '+JSON.stringify(d)); }
    } catch(e) { showError('Lỗi kết nối: '+e.message); }
    finally { btn.disabled=false; btn.textContent='💾 Lưu về GSheet'; }
  }

  // BUILD CUST LINES cho AI
  function buildCustLines() {
    if (!_currentCustData) return [];
    const {name, phone, care, orders} = _currentCustData;
    const lines = ['Tên: '+name+' | SĐT: '+phone];
    if (orders&&orders.length) {
      lines.push('Số đơn đã mua: '+orders.length);
      const prods = [...new Set(orders.map(o=>o.product).filter(Boolean))].slice(0,5).join(', ');
      if (prods) lines.push('Sản phẩm đã mua: '+prods);
      const last = orders[0];
      if (last) {
        const d = fmtDate_(last.date);
        lines.push('Đơn gần nhất: '+[d,last.product,last.revenue?Number(last.revenue).toLocaleString('vi-VN')+'đ':''].filter(Boolean).join(' - '));
      }
    }
    if (care&&care.status) lines.push('Tình trạng CS: '+care.status);
    if (care&&care.note)   lines.push('Ghi chú: '+care.note);
    return lines;
  }

  async function doGenerateOpener() {
    if (!GAS_URL) { showError('Chưa cài đặt URL GAS.'); return; }
    if (!_currentCustData) { showError('Tra cứu khách trước đã.'); return; }
    const btn = document.getElementById('zai-open-btn');
    const sug = document.getElementById('zai-sug-area');
    hideError(); btn.disabled=true; btn.textContent='AI đang soạn...';
    sug.innerHTML='<div class="zai-loading"><div class="zai-spinner"></div>Đang soạn tin mở đầu...</div>';
    const lines = buildCustLines();
    const ctx = (document.getElementById('zai-ctx').value||'').trim();
    if (ctx) lines.push('Ngữ cảnh: '+ctx);
    const prompt = '[KH] '+lines.join(' | ')+'\n[Giọng văn] '+_activeTone+'\nSoạn 1 tin nhắn Zalo CHỦ ĐỘNG bắt chuyện chăm sóc khách sau mua, dựa vào lịch sử mua hàng trên. Ngắn gọn, tự nhiên, tiếng Việt.';
    await callAI_(prompt, btn, '💬 Tạo TN mở đầu (dựa lịch sử mua)', sug);
  }

  async function doGenerate() {
    if (!GAS_URL) { showError('Chưa cài đặt URL GAS.'); return; }
    const histText = _chatHistory.length ? _chatHistory.join('\n---\n') : '';
    const taText   = (document.getElementById('zai-msg').value||'').trim();
    const msg = histText || taText;
    if (!msg) { showError('Chưa có tin nhắn khách. Nhấn 📥 Lấy TN hoặc dán thủ công.'); return; }
    const btn = document.getElementById('zai-gen-btn');
    const sug = document.getElementById('zai-sug-area');
    hideError(); btn.disabled=true; btn.textContent='AI đang soạn...';
    sug.innerHTML='<div class="zai-loading"><div class="zai-spinner"></div>Đang tạo gợi ý...</div>';
    const lines = buildCustLines();
    const ctx = (document.getElementById('zai-ctx').value||'').trim();
    if (ctx) lines.push('Ngữ cảnh: '+ctx);
    const prompt = (lines.length?'[KH] '+lines.join(' | ')+'\n':'')+
      '[TN khách] '+msg+'\n[Giọng văn] '+_activeTone+'\nSoạn 1 tin nhắn trả lời phù hợp, ngắn gọn, tiếng Việt tự nhiên.';
    await callAI_(prompt, btn, '✨ Tạo gợi ý phản hồi', sug);
  }

  async function callAI_(prompt, btn, label, sug) {
    try {
      const res = await fetch(GAS_URL, {method:'POST', body:JSON.stringify({action:'ai',prompt}), headers:{'Content-Type':'text/plain'}});
      const data = await res.json();
      if (!data.ok) throw new Error(data.error||'GAS lỗi');
      const text = (data.text||'').trim();
      sug.innerHTML='';
      addEl(sug,'div',{className:'zai-section-label',textContent:'💡 Gợi ý — sửa nếu cần rồi copy/lưu'});

      const ta = addEl(sug,'textarea',{id:'zai-sug-edit', rows:4});
      ta.style.cssText='width:100%;box-sizing:border-box;font-size:12px;padding:8px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;margin-top:4px;font-family:inherit';
      ta.value = text;

      const btnRow = addEl(sug,'div',{style:'display:flex;gap:6px;margin-top:6px'});

      const copyBtn = addEl(btnRow,'button',{className:'zai-btn zai-btn-primary zai-btn-sm',textContent:'📋 Copy'});
      copyBtn.addEventListener('click',()=>{
        navigator.clipboard.writeText(ta.value).then(()=>{
          copyBtn.textContent='✓ Đã copy!';
          setTimeout(()=>{copyBtn.textContent='📋 Copy';},1500);
        });
      });

      const saveBtn2 = addEl(btnRow,'button',{className:'zai-btn zai-btn-secondary zai-btn-sm',textContent:'💾 Lưu mẫu'});
      saveBtn2.title='Lưu câu trả lời này (sau khi sửa) làm mẫu để AI học';
      saveBtn2.addEventListener('click',() => saveAIExample_(prompt, ta.value, saveBtn2));

    } catch(e) { sug.innerHTML=''; showError('Lỗi: '+e.message); }
    finally { btn.disabled=false; btn.textContent=label; }
  }

  async function saveAIExample_(prompt, corrected, btn) {
    if (!GAS_URL) { showError('Chưa cài URL GAS.'); return; }
    if (!corrected.trim()) { showError('Câu trả lời trống.'); return; }
    btn.disabled=true; btn.textContent='Đang lưu...';
    try {
      const r = await fetch(GAS_URL, {
        method:'POST',
        body: JSON.stringify({action:'saveAIContext', type:'combo_template', content: corrected.trim(), context: prompt.slice(0,300)}),
        headers:{'Content-Type':'text/plain'}
      });
      const d = await r.json();
      if (d.ok) { btn.textContent='✓ Đã lưu!'; setTimeout(()=>{btn.textContent='💾 Lưu mẫu';btn.disabled=false;},2000); }
      else { showError('Lỗi lưu mẫu: '+JSON.stringify(d)); btn.disabled=false; btn.textContent='💾 Lưu mẫu'; }
    } catch(e) { showError('Lỗi: '+e.message); btn.disabled=false; btn.textContent='💾 Lưu mẫu'; }
  }

  // DATE HELPERS
  function parseDate_(d) {
    if (!d) return 0;
    if (typeof d==='number') return (d-25569)*86400000;
    const s = String(d).trim();
    const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m1) return new Date(+m1[3],+m1[2]-1,+m1[1]).getTime();
    const m2 = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (m2) return new Date(+m2[1],+m2[2]-1,+m2[3]).getTime();
    return new Date(s).getTime()||0;
  }
  function fmtDate_(d) {
    const ts = parseDate_(d); if (!ts) return '?';
    const dt = new Date(ts);
    return ('0'+dt.getDate()).slice(-2)+'/'+('0'+(dt.getMonth()+1)).slice(-2)+'/'+dt.getFullYear();
  }
  function toInputDate_(d) {
    const ts = parseDate_(d); if (!ts) return '';
    const dt = new Date(ts);
    return dt.getFullYear()+'-'+('0'+(dt.getMonth()+1)).slice(-2)+'-'+('0'+dt.getDate()).slice(-2);
  }

  function showError(msg) { const el=document.getElementById('zai-error'); if(el){el.textContent=msg;el.style.display='block';} }
  function hideError()    { const el=document.getElementById('zai-error'); if(el) el.style.display='none'; }
  function showMsg(id,msg,ms) { const el=document.getElementById(id); if(!el) return; el.textContent=msg; if(ms) setTimeout(()=>{el.textContent='';},ms); }
  function escHtml(str) { return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function init() { buildPanel(); watchZaloChat(); }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
  else init();
})();
