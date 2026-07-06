// OME Zalo AI Helper - content script v14.9
// v14.7: Nick Zalo selector, Trang thai KH, reminder polling, extended ZALO_STATUSES
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
  let _currentCS = ''; // CS dang dung, luu vao chrome.storage
  let _currentZaloNick = ''; // Nick Zalo CS dang dung, sticky
  let _zaloNickList = []; // danh sach nick tu GAS

  const LOOKUP_TTL = 5 * 60 * 1000;
  const CARE_STATUSES = [
    'Chưa liên hệ','Chưa sử dụng','Hẹn gọi lại sau','Đang sd','Đang tạm ngưng',
    'Knm/Máy bận','Cúp ngang','Thuê bao','Phân vân/Tiềm năng','Chốt',
    'Kcnc/Không hiệu quả','Đặt hộ/Sai số','Bầu'
  ];
  const ZALO_STATUSES = ['','Đã kết bạn','Chưa kết bạn','Chưa đồng ý','Không nhận tn lạ','Chặn','Hủy kết bạn','Không tìm thấy zl','ZL NHD/K có','Zalo ngừng hd'];
  const CUST_STATUS_OPTS = [
  '','1. Không thể kết nối',
  '2.1 Không hiệu quả','2.2 Hiệu quả','2.3 Chưa rõ tác dụng',
  '3. Chưa dùng',
  '4.1 Không hiệu quả','4.2 Đã có kết quả','4.3 Đã đổi sang sản phẩm khác',
  '5. Đang tạm dừng','6. Nhận hộ / Sai số','7. Ngang Cúp','8. Từ chối'
];
  let CS_NAMES = ['','duyenht','thaomt','dieptn','vanntt']; // fallback, se load tu GAS

  // ── BUILD PANEL ──
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
    addEl(cfg, 'label', {textContent:'URL Web App GAS (appweb Sasum)'});
    const inpGas = addEl(cfg, 'input', {id:'zai-gas-url', type:'text', placeholder:'https://script.google.com/macros/s/...'});
    addEl(cfg, 'label', {textContent:'🔑 Groq API Key (lưu 1 lần dùng chung cả team)'});
    addEl(cfg, 'input', {id:'zai-gemini-key', type:'text', placeholder:'gsk_... (lấy miễn phí tại console.groq.com)'});
    const saveBtn = addEl(cfg, 'button', {className:'zai-cfg-save', id:'zai-cfg-save', textContent:'💾 Lưu cài đặt'});
    addEl(cfg, 'div', {className:'zai-cfg-hint', textContent:'Key Groq được lưu vào Google Sheets, dùng chung cho cả team.'});
    panel.appendChild(cfg);

    // CS sticky bar
    const csBar = document.createElement('div');
    csBar.id = 'zai-cs-bar';
    csBar.style.cssText = 'background:#f0fdf4;border-bottom:1px solid #bbf7d0;padding:7px 14px;font-size:12px;';
    const csRow = document.createElement('div');
    csRow.style.cssText = 'display:flex;align-items:center;gap:8px;';
    csRow.innerHTML = '<span style="color:#166534;font-weight:700;white-space:nowrap">👤 CS:</span>';
    const csBarSel = document.createElement('select');
    csBarSel.id = 'zai-cs-bar-sel';
    csBarSel.style.cssText = 'flex:1;font-size:12px;padding:3px 6px;border:1px solid #86efac;border-radius:6px;background:#fff;color:#166534;font-weight:600;';
    ['','duyenht','dieptn','thaomt','vanntt'].forEach(s => {
      const o = document.createElement('option'); o.value=s; o.textContent=s||'-- Chọn CS --'; csBarSel.appendChild(o);
    });
    csRow.appendChild(csBarSel);
    const csBarHint = document.createElement('span');
    csBarHint.id = 'zai-cs-bar-hint';
    csBarHint.style.cssText = 'font-size:10px;color:#15803d;';
    csRow.appendChild(csBarHint);
    csBar.appendChild(csRow);
    const nzRow = document.createElement('div');
    nzRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:5px;border-top:1px solid #bbf7d0;padding-top:5px;';
    nzRow.innerHTML = '<span style="color:#166534;font-weight:700;white-space:nowrap;font-size:12px">💬 Nick:</span>';
    const nzSel = document.createElement('select');
    nzSel.id = 'zai-nz-sel';
    nzSel.style.cssText = 'flex:1;font-size:12px;padding:3px 6px;border:1px solid #86efac;border-radius:6px;background:#fff;color:#166534;';
    const nzAddBtn = document.createElement('button');
    nzAddBtn.id = 'zai-nz-add';
    nzAddBtn.textContent = '＋';
    nzAddBtn.title = 'Thêm nick mới';
    nzAddBtn.style.cssText = 'background:#15803d;color:#fff;border:none;border-radius:5px;padding:3px 8px;font-size:13px;cursor:pointer;';
    nzRow.appendChild(nzSel);
    nzRow.appendChild(nzAddBtn);
    csBar.appendChild(nzRow);
    panel.appendChild(csBar);

    // Body
    const body = document.createElement('div');
    body.className = 'zai-body'; body.id = 'zai-body';

    // ── 1. PHONE ──
    addEl(body, 'div', {className:'zai-section-label', textContent:'Số điện thoại khách'});
    const phoneRow = addEl(body, 'div', {className:'zai-phone-row'});
    addEl(phoneRow, 'input', {id:'zai-phone-input', type:'tel', placeholder:'0901234567'});
    addEl(phoneRow, 'button', {className:'zai-btn zai-btn-primary zai-btn-sm', id:'zai-lookup-btn', textContent:'Tra cứu'});
    addEl(body, 'div', {id:'zai-auto-hint', style:'font-size:10px;color:#00b14f;margin-top:3px'});

    body.appendChild(Object.assign(document.createElement('hr'), {className:'zai-div'}));

    // ── 2. AI SECTION (len tren) ──
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

    // History status (hien thi sau khi grab, co link xem)
    const histStatus = addEl(aiWrap, 'div', {id:'zai-hist-status', style:'font-size:11px;color:#6b7280;margin-bottom:4px;display:none'});

    // Textarea (an mac dinh, chi hien khi bam "Xem")
    const msgTa = addEl(aiWrap, 'textarea', {className:'zai-msg-area', id:'zai-msg',
      placeholder:'Dán thủ công nếu cần...'});
    msgTa.style.display = 'none';

    // Nguyen canh input
    addEl(aiWrap, 'div', {style:'margin-top:5px;font-size:11px;color:#6b7280', textContent:'Ngữ cảnh / Sản phẩm (tuỳ chọn)'});
    addEl(aiWrap, 'input', {className:'zai-ctx-input', id:'zai-ctx', placeholder:'VD: khách hỏi về giá, muốn mua thêm...'});
    addEl(aiWrap, 'button', {className:'zai-btn zai-btn-primary', id:'zai-gen-btn',
      textContent:'✨ Tạo gợi ý phản hồi', style:'width:100%;margin-top:8px'});

    addEl(body, 'div', {id:'zai-sug-area'});
    addEl(body, 'div', {className:'zai-error', id:'zai-error', style:'display:none'});

    body.appendChild(Object.assign(document.createElement('hr'), {className:'zai-div'}));

    // ── 3. UPDATE SECTION (tren) ──
    const upd = addEl(body, 'div', {className:'zai-update-section', id:'zai-update-section'});
    upd.style.display = 'block'; // hien san ngay khi mo panel (khong cho tra cuu)
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

    addEl(upd, 'label', {textContent:'Nick Zalo CS đang dùng'});
    const nzFormSel = addEl(upd, 'select', {id:'zai-nz-form-sel'});
    addEl(nzFormSel, 'option', {value:'', textContent:'— Chọn nick —'});

    addEl(upd, 'label', {textContent:'Trạng thái KH'});
    const khStatusSel = addEl(upd, 'select', {id:'zai-kh-status-sel'});
    CUST_STATUS_OPTS.forEach(s => addEl(khStatusSel, 'option', {value:s, textContent:s||'— Chọn —'}));

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

    // ── 4. CUSTOMER CARD (duoi cung) ──
    addEl(body, 'div', {id:'zai-cust-area'});

    panel.appendChild(body);
    document.body.appendChild(panel);

    // ── EVENTS ──
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
    chrome.storage.local.get(['ome_gas_url','ome_current_cs','ome_current_nz'], (res) => {
      GAS_URL = res.ome_gas_url || '';
      if (GAS_URL) { inpGas.value = GAS_URL; loadCSNames_(); loadNickZaloList_(); }
      if (!GAS_URL) { _cfgVisible = true; cfg.style.display = 'block'; }
      _currentCS = res.ome_current_cs || '';
      if (_currentCS) {
        csBarSel.value = _currentCS;
        csBarHint.textContent = 'tự động áp dụng';
      }
      _currentZaloNick = res.ome_current_nz || '';
      startReminderPoll_();
    });
    nzSel.addEventListener('change', () => {
      _currentZaloNick = nzSel.value;
      chrome.storage.local.set({ ome_current_nz: _currentZaloNick });
    });
    nzAddBtn.addEventListener('click', async () => {
      const nick = (prompt('Nhập nick Zalo mới:') || '').trim();
      if (!nick) return;
      if (!_zaloNickList.includes(nick)) _zaloNickList.push(nick);
      // Save via GAS setSetting
      if (GAS_URL) {
        try {
          await fetch(GAS_URL, {method:'POST', body:JSON.stringify({action:'setSetting',key:'nickZaloList',value:JSON.stringify(_zaloNickList)}), headers:{'Content-Type':'text/plain'}});
        } catch(e) {}
      }
      await loadNickZaloList_();
      const nzSelEl = document.getElementById('zai-nz-sel');
      if (nzSelEl) nzSelEl.value = nick;
      _currentZaloNick = nick;
      chrome.storage.local.set({ ome_current_nz: nick });
    });
    csBarSel.addEventListener('change', () => {
      _currentCS = csBarSel.value;
      chrome.storage.local.set({ ome_current_cs: _currentCS });
      csBarHint.textContent = _currentCS ? 'đã lưu' : '';
      setTimeout(() => { csBarHint.textContent = _currentCS ? 'tự động áp dụng' : ''; }, 1500);
      // Cap nhat dropdown CS trong form neu dang mo
      const csSel = document.getElementById('zai-cs-sel');
      if (csSel) csSel.value = _currentCS;
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
    loadCSNames_();
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

  // ── GRAB TIN NHẮN KHÁCH ──

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
      // Zalo text emoticon dang /-heart/ hoac /-heart (co slash cuoi hoac khong)
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
      // Dien vao textarea (an) de du phong
      if (msgTa) msgTa.value = last100.join('\n---\n');

      // Hien thi trang thai + nut xem
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

  // ── LOOKUP ──
  async function doLookup() {
    const raw = (document.getElementById('zai-phone-input').value||'').trim();
    if (!raw) { showError('Vui lòng nhập số điện thoại.'); return; }
    hideError();
    const phone = normPhone(raw);
    const area   = document.getElementById('zai-cust-area');
    const updSec = document.getElementById('zai-update-section');
    updSec.style.display = 'block'; // luon hien muc cap nhat
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
    ['zai-status-sel','zai-zalo-sel','zai-hen-date','zai-hen-note','zai-note-ta']
      .forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
    const csSel = document.getElementById('zai-cs-sel');
    if (csSel) csSel.value = _currentCS || '';
    const nzF = document.getElementById('zai-nz-form-sel');
    if (nzF) nzF.value = _currentZaloNick || '';
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
    document.getElementById('zai-cs-sel').value     = care&&care.cs||_currentCS||'';
    document.getElementById('zai-hen-date').value   = care&&care.schedHen ? toInputDate_(care.schedHen) : '';
    document.getElementById('zai-hen-note').value   = care&&care.schedHenNote||'';
    document.getElementById('zai-note-ta').value    = care&&care.note||'';
    document.getElementById('zai-kh-status-sel').value = care&&care.khStatus||'';
    // Nick Zalo form: dung nick sticky; neu khach da co nick nay thi giu, neu chua co thi van hien de de them
    const nzF = document.getElementById('zai-nz-form-sel');
    if (nzF) {
      // Rebuild options tu _zaloNickList + nick khach da luu
      nzF.innerHTML = '<option value="">— Chọn nick —</option>';
      const allNicks = [...new Set([..._zaloNickList, ...(care&&care.nickZalos||[])])];
      allNicks.forEach(n => { const o=document.createElement('option'); o.value=n; o.textContent=n; nzF.appendChild(o); });
      // Auto-chon: uu tien nick sticky, neu nick sticky co trong list khach thi dung, neu khong thi van chon sticky
      nzF.value = _currentZaloNick || (care&&care.nickZalos&&care.nickZalos[0]||'');
    }
  }

  // ── SAVE STATUS ──
  async function doSaveStatus() {
    if (!_currentCustData) { showError('Chưa tra cứu khách nào.'); return; }
    if (!GAS_URL) { showError('Chưa cài đặt URL GAS.'); return; }
    const status  = document.getElementById('zai-status-sel').value;
    const zalo    = document.getElementById('zai-zalo-sel').value;
    const cs      = document.getElementById('zai-cs-sel').value;
    const henDate = document.getElementById('zai-hen-date').value;
    const henNote = document.getElementById('zai-hen-note').value.trim();
    const care    = (_currentCustData && _currentCustData.care) || null;
    const rawNote = document.getElementById('zai-note-ta').value.trim();
    const usedCS  = cs || (care && care.cs) || _currentCS || '';
    const now     = new Date();
    const stamp   = '[' + ('0'+now.getDate()).slice(-2) + '/' + ('0'+(now.getMonth()+1)).slice(-2) +
                    ' ' + ('0'+now.getHours()).slice(-2) + ':' + ('0'+now.getMinutes()).slice(-2) +
                    (usedCS ? ' - ' + usedCS : '') + ']';
    const origNote = (care && care.note) || '';
    // Chi them timestamp neu note moi khac note cu
    const note = rawNote && rawNote !== origNote
      ? stamp + ' ' + rawNote
      : rawNote;
    const btn    = document.getElementById('zai-save-btn');
    btn.disabled = true; btn.textContent = 'Đang lưu...';
    try {
      const c = care||{};
      const row = {
        phone:_currentCustData.phone, status:status||c.status||'',
        zalo:zalo||c.zalo||'', cs:cs||c.cs||'', note,
        schedules:c.schedules||'', schedGoi:c.schedGoi||'', schedGoiNote:c.schedGoiNote||'',
        schedSP:c.schedSP||'', schedSPNote:c.schedSPNote||'',
        schedCS:c.schedCS||'', schedCSNote:c.schedCSNote||'',
        schedHen:henDate||c.schedHen||'', schedHenNote:henNote||c.schedHenNote||'',
        khStatus: document.getElementById('zai-kh-status-sel').value || (c.khStatus||''),
        nickZalos: (() => {
          const existing = c.nickZalos || [];
          if (_currentZaloNick && !existing.includes(_currentZaloNick)) return [...existing, _currentZaloNick];
          return existing;
        })()
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

  // ── BUILD CUST LINES cho AI ──
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
    // Uu tien _chatHistory, fallback textarea
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

      const sendZaloBtn = addEl(btnRow,'button',{className:'zai-btn zai-btn-primary zai-btn-sm',textContent:'📤 Gởi Zalo'});
      sendZaloBtn.title='Tự điền vào ô chat Zalo và gởi ngay';
      sendZaloBtn.addEventListener('click',() => sendToZalo_(ta.value, sendZaloBtn));

      const saveBtn2 = addEl(btnRow,'button',{className:'zai-btn zai-btn-secondary zai-btn-sm',textContent:'💾 Lưu mẫu'});
      saveBtn2.title='Lưu câu trả lời này (sau khi sửa) làm mẫu để AI học';
      saveBtn2.addEventListener('click',() => saveAIExample_(prompt, ta.value, saveBtn2));

    } catch(e) { sug.innerHTML=''; showError('Lỗi: '+e.message); }
    finally { btn.disabled=false; btn.textContent=label; }
  }

  // Gui tin nhan vao o chat Zalo
  function sendToZalo_(text, btn) {
    if (!text.trim()) return;
    const INPUT_SELS = [
      '[class*="chat-input"] [contenteditable]',
      '[class*="message-input"] [contenteditable]',
      '[class*="input-box"] [contenteditable]',
      '[class*="input-area"] [contenteditable]',
      '[class*="editor"] [contenteditable]',
      '[contenteditable="true"]',
    ];
    let inputEl = null;
    for (const sel of INPUT_SELS) {
      try {
        const els = [...document.querySelectorAll(sel)];
        const el = els.find(e => { const r=e.getBoundingClientRect(); return r.height>20&&r.height<300&&r.width>100; });
        if (el) { inputEl=el; break; }
      } catch(e) {}
    }
    if (!inputEl) {
      navigator.clipboard.writeText(text).then(()=>{
        if(btn){btn.textContent='✓ Đã copy (không tìm được ô chat)';setTimeout(()=>{btn.textContent='📤 Gởi Zalo';},2500);}
      });
      return;
    }
    inputEl.focus();
    const sel2 = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(inputEl);
    sel2.removeAllRanges(); sel2.addRange(range);
    document.execCommand('delete', false);
    document.execCommand('insertText', false, text);
    inputEl.dispatchEvent(new InputEvent('input',{bubbles:true,data:text}));
    setTimeout(()=>{
      const SEND_SELS = [
        'button[class*="send"]','[class*="btn-send"]','[class*="sendBtn"]',
        '[class*="send-btn"]','[class*="icon-send"]',
      ];
      let sent=false;
      for (const s of SEND_SELS) {
        try { const b=document.querySelector(s); if(b){b.click();sent=true;break;} } catch(e){}
      }
      if (!sent) {
        inputEl.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:13,which:13,bubbles:true}));
        inputEl.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',keyCode:13,which:13,bubbles:true}));
      }
      if(btn){btn.textContent='✓ Đã gởi!';setTimeout(()=>{btn.textContent='📤 Gởi Zalo';},2000);}
    }, 150);
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

  // ── DATE HELPERS ──
  function parseDate_(d) {
    if (!d) return 0;
    if (typeof d==='number') return (d - 25569) * 86400000;
    const s = String(d).trim();
    // Full ISO with time (e.g. GAS Date object -> "2026-04-17T17:00:00.000Z")
    // Must use new Date() to preserve timezone offset correctly
    if (s.includes('T')) { const dt=new Date(s); return isNaN(dt)?0:dt.getTime(); }
    // DD/MM/YYYY (dinh dang Viet Nam tu GAS Utilities.formatDate)
    const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (m1) return new Date(+m1[3],+m1[2]-1,+m1[1]).getTime();
    // YYYY-MM-DD (ISO date only, no timezone shift needed)
    const m2 = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (m2) return new Date(+m2[1],+m2[2]-1,+m2[3]).getTime();
    const dt = new Date(s);
    return isNaN(dt) ? 0 : dt.getTime();
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

  async function doneReminder_(phone) {
    if (!GAS_URL) return;
    try {
      const sep = GAS_URL.includes('?') ? '&' : '?';
      await fetch(GAS_URL + sep + 'action=saveSingle', {
        method: 'POST', redirect: 'follow',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({phone, schedHen:'', schedHenNote:''})
      });
    } catch(e) {}
  }

  function renderReminderPanel_(reminders) {
    let panel = document.getElementById('zai-remind-panel');
    const host = document.getElementById('ome-zai-panel');
    if (!host) return;
    const csBar = document.getElementById('zai-cs-bar');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'zai-remind-panel';
      panel.style.cssText = 'background:#fef2f2;border-bottom:2px solid #fca5a5;font-size:11px;';
      if (csBar && csBar.nextSibling) host.insertBefore(panel, csBar.nextSibling);
      else host.insertBefore(panel, host.firstChild);
    }
    const toggleBtn = document.getElementById('ome-zai-toggle');
    if (!reminders || !reminders.length) {
      panel.style.display = 'none';
      if (toggleBtn) toggleBtn.style.boxShadow = '';
      return;
    }
    if (toggleBtn) toggleBtn.style.boxShadow = '0 0 0 3px #ef4444';
    panel.style.display = '';
    const today = new Date(); today.setHours(0,0,0,0);
    panel.innerHTML =
      '<div style="padding:5px 10px;background:#fca5a5;color:#7f1d1d;font-weight:bold;display:flex;justify-content:space-between;align-items:center;">'+
      '<span>🔔 ' + reminders.length + ' lịch hẹn</span>'+
      '<span id="zai-remind-toggle" style="cursor:pointer;font-size:11px;user-select:none;">▲ thu gọn</span></div>'+
      '<div id="zai-remind-list" style="max-height:180px;overflow-y:auto;"></div>';
    const list = panel.querySelector('#zai-remind-list');
    reminders.forEach(rem => {
      const item = document.createElement('div');
      item.style.cssText = 'display:flex;align-items:center;gap:4px;padding:4px 8px;border-bottom:1px solid #fecaca;';
      const henDate = rem.schedHen ? new Date(rem.schedHen) : null;
      if (henDate) henDate.setHours(0,0,0,0);
      const isOverdue = henDate && henDate < today;
      // Phone copy button
      const phoneBtn = document.createElement('button');
      phoneBtn.textContent = '📋 ' + rem.phone;
      phoneBtn.title = 'Bấm để copy số';
      phoneBtn.style.cssText = 'background:#fff;border:1px solid #fca5a5;border-radius:3px;padding:1px 5px;cursor:pointer;font-size:10px;font-family:monospace;white-space:nowrap;flex-shrink:0;';
      phoneBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(rem.phone).catch(()=>{});
        const orig = phoneBtn.textContent;
        phoneBtn.textContent = '✓ đã copy';
        setTimeout(() => { phoneBtn.textContent = orig; }, 1200);
      });
      // Tag + note
      const note = document.createElement('span');
      note.style.cssText = 'flex:1;font-size:10px;color:#7f1d1d;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;';
      note.title = rem.schedHenNote || '';
      const tagColor = isOverdue ? '#ef4444' : '#f97316';
      const tagText = isOverdue ? 'Quá hạn' : 'Hôm nay';
      note.innerHTML = '<span style="background:'+tagColor+';color:#fff;border-radius:2px;padding:0 3px;font-size:9px;margin-right:3px;">'+tagText+'</span>' + escHtml(rem.schedHenNote || '—');
      // Mở KH → appweb
      const openBtn = document.createElement('button');
      openBtn.textContent = 'Mở KH';
      openBtn.style.cssText = 'background:#3b82f6;color:#fff;border:none;border-radius:3px;padding:2px 6px;cursor:pointer;font-size:10px;flex-shrink:0;';
      openBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(rem.phone).catch(()=>{});
        window.open('https://duyenhoang91tl-lab.github.io/Sasum/?phone=' + encodeURIComponent(rem.phone), '_blank');
      });
      // Done
      const doneBtn = document.createElement('button');
      doneBtn.textContent = '✓ Done';
      doneBtn.style.cssText = 'background:#22c55e;color:#fff;border:none;border-radius:3px;padding:2px 6px;cursor:pointer;font-size:10px;flex-shrink:0;';
      doneBtn.addEventListener('click', async () => {
        doneBtn.disabled = true;
        await doneReminder_(rem.phone);
        item.style.opacity = '0.4';
        setTimeout(() => {
          item.remove();
          if (!list.children.length) {
            panel.style.display = 'none';
            if (toggleBtn) toggleBtn.style.boxShadow = '';
          }
        }, 700);
      });
      item.appendChild(phoneBtn);
      item.appendChild(note);
      item.appendChild(openBtn);
      item.appendChild(doneBtn);
      list.appendChild(item);
    });
    panel.querySelector('#zai-remind-toggle').addEventListener('click', () => {
      const l = panel.querySelector('#zai-remind-list');
      const tog = panel.querySelector('#zai-remind-toggle');
      if (!l) return;
      const hidden = l.style.display === 'none';
      l.style.display = hidden ? '' : 'none';
      if (tog) tog.textContent = hidden ? '▲ thu gọn' : '▼ mở rộng';
    });
  }
async function startReminderPoll_() {
    if (!GAS_URL || !_currentCS) return;
    if (Notification && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    async function checkReminders() {
      if (!GAS_URL || !_currentCS) return;
      try {
        const sep = GAS_URL.includes('?') ? '&' : '?';
        const r = await fetch(GAS_URL + sep + 'action=reminders&cs=' + encodeURIComponent(_currentCS), {redirect:'follow'});
        const d = await r.json();
        renderReminderPanel_(d.reminders || []);
        if (d.reminders && d.reminders.length && Notification && Notification.permission === 'granted') {
          new Notification('OME: ' + d.reminders.length + ' lịch hẹn hôm nay', {
            body: d.reminders.slice(0,3).map(r2 => r2.phone + (r2.schedHenNote?' - '+r2.schedHenNote:'')).join('\n'),
            icon: ''
          });
        }
      } catch(e) {}
    }
    checkReminders();
    setInterval(checkReminders, 5 * 60 * 1000);
  }


  async function loadNickZaloList_() {
    if (!GAS_URL) return;
    try {
      const sep = GAS_URL.includes('?') ? '&' : '?';
      const r = await fetch(GAS_URL + sep + 'action=getSetting&key=nickZaloList', {redirect:'follow'});
      const d = await r.json();
      let list = [];
      if (d.value) { try { list = JSON.parse(d.value); } catch(e) {} }
      _zaloNickList = Array.isArray(list) ? list : [];
      // Rebuild nzSel dropdown
      const nzSel = document.getElementById('zai-nz-sel');
      if (nzSel) {
        nzSel.innerHTML = '<option value="">-- Chọn nick --</option>';
        _zaloNickList.forEach(n => {
          const o = document.createElement('option'); o.value=n; o.textContent=n; nzSel.appendChild(o);
        });
        if (_currentZaloNick) nzSel.value = _currentZaloNick;
      }
      // Sync vao form selector neu dang mo
      const nzF = document.getElementById('zai-nz-form-sel');
      if (nzF) {
        const cur = nzF.value;
        nzF.innerHTML = '<option value="">— Chọn nick —</option>';
        _zaloNickList.forEach(n => { const o=document.createElement('option'); o.value=n; o.textContent=n; nzF.appendChild(o); });
        nzF.value = cur || _currentZaloNick || '';
      }
    } catch(e) {}
  }

  async function loadCSNames_() {
    if (!GAS_URL) return;
    try {
      const sep = GAS_URL.includes('?') ? '&' : '?';
      const r = await fetch(GAS_URL + sep + 'action=users', {redirect:'follow'});
      const d = await r.json();
      if (d.users && d.users.length) {
        const active = d.users.filter(u => u.active !== false);
        const names = ['', ...active.map(u => u.username||u.name).filter(Boolean)];
        CS_NAMES = names;
        // Cap nhat dropdown neu da render
        const sel = document.getElementById('zai-cs-sel');
        if (sel) {
          const cur = sel.value;
          sel.innerHTML = '';
          CS_NAMES.forEach(s => { const o=document.createElement('option'); o.value=s; o.textContent=s||'— Chọn CS —'; sel.appendChild(o); });
          if (cur) sel.value = cur;
        }
      }
    } catch(e) {}
  }

  function init() { buildPanel(); watchZaloChat(); }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
  else init();
})();
