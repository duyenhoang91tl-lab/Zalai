// OME Zalo AI Helper - content script for chat.zalo.me
(function () {
  'use strict';

  let GAS_URL = '';
  let _custCache = null;
  let _ordCache  = null;
  let _ordLoading = false;
  let _cacheAt = 0;
  let _activeTone = 'Thân thiện';
  let _currentPhone = '';
  let _currentCustData = null;
  let _cfgVisible = false;

  const CACHE_TTL = 5 * 60 * 1000;
  const CARE_STATUSES = [
    'Chưa liên hệ','Chưa sử dụng','Hẹn gọi lại sau','Đang sd','Đang tạm ngưng',
    'Knm/Máy bận','Cúp ngang','Thuê bao','Phân vân/Tiềm năng','Chốt',
    'Kcnc/Không hiệu quả','Đặt hộ/Sai số','Bầu'
  ];
  const ZALO_STATUSES = ['','Đã kết bạn','Chưa kết bạn','Đã chặn','Không có Zalo'];

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

    // Phone
    addEl(body, 'div', {className:'zai-section-label', textContent:'Số điện thoại khách'});
    const phoneRow = addEl(body, 'div', {className:'zai-phone-row'});
    addEl(phoneRow, 'input', {id:'zai-phone-input', type:'tel', placeholder:'0901234567'});
    addEl(phoneRow, 'button', {className:'zai-btn zai-btn-primary zai-btn-sm', id:'zai-lookup-btn', textContent:'Tra cứu'});
    addEl(body, 'div', {id:'zai-auto-hint', style:'font-size:10px;color:#00b14f;margin-top:3px'});

    // Customer info
    addEl(body, 'div', {id:'zai-cust-area'});

    // ── UPDATE SECTION ──
    const upd = addEl(body, 'div', {className:'zai-update-section', id:'zai-update-section'});
    upd.style.display = 'none';
    addEl(upd, 'div', {className:'zai-section-label', style:'margin-bottom:8px', textContent:'📋 Cập nhật thông tin CS'});

    // Row: Tình trạng CS + Kết bạn Zalo
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

    // CS chăm sóc
    addEl(upd, 'label', {textContent:'CS chăm sóc'});
    addEl(upd, 'input', {id:'zai-cs-inp', type:'text', placeholder:'Tên nhân viên CS...'});

    // Ghi chú
    addEl(upd, 'label', {textContent:'Ghi chú'});
    addEl(upd, 'textarea', {id:'zai-note-ta', placeholder:'Ghi chú thêm...', rows:2});

    // Save row
    const saveRow = addEl(upd, 'div', {className:'zai-save-row'});
    addEl(saveRow, 'button', {className:'zai-btn zai-btn-primary zai-btn-sm', id:'zai-save-btn', textContent:'💾 Lưu về GSheet'});
    addEl(saveRow, 'span', {className:'zai-save-status', id:'zai-save-status'});

    body.appendChild(Object.assign(document.createElement('hr'), {className:'zai-div'}));

    // ── AI SECTION ──
    const aiWrap = addEl(body, 'div', {});

    const tonesDiv = addEl(aiWrap, 'div', {className:'zai-tones', style:'margin-bottom:8px'});
    ['Thân thiện','Chuyên nghiệp','Ngắn gọn','Nhiệt tình'].forEach((t,i) => {
      addEl(tonesDiv, 'button', {className:'zai-tone'+(i===0?' active':''), dataset:{tone:t}, textContent:t});
    });

    addEl(aiWrap, 'button', {className:'zai-btn zai-btn-secondary', id:'zai-open-btn',
      textContent:'💬 Tạo TN mở đầu (dựa lịch sử mua)', style:'width:100%;margin-bottom:8px'});

    const msgHdr = addEl(aiWrap, 'div', {style:'display:flex;align-items:center;justify-content:space-between;margin-bottom:4px'});
    addEl(msgHdr, 'div', {className:'zai-section-label', style:'margin:0', textContent:'Tin nhắn khách'});
    addEl(msgHdr, 'button', {className:'zai-btn zai-btn-ghost zai-btn-sm', id:'zai-grab-btn',
      textContent:'📥 Lấy TN', title:'Tự động lấy tin nhắn cuối của khách'});

    addEl(aiWrap, 'textarea', {className:'zai-msg-area', id:'zai-msg', placeholder:'Dán hoặc nhấn "📥 Lấy TN" để tự điền...'});
    addEl(aiWrap, 'div', {style:'margin-top:5px;font-size:11px;color:#6b7280', textContent:'Ngữ cảnh / Sản phẩm (tuỳ chọn)'});
    addEl(aiWrap, 'input', {className:'zai-ctx-input', id:'zai-ctx', placeholder:'VD: khách hỏi về giá, muốn mua thêm...'});
    addEl(aiWrap, 'button', {className:'zai-btn zai-btn-primary', id:'zai-gen-btn',
      textContent:'✨ Tạo gợi ý phản hồi', style:'width:100%;margin-top:8px'});

    addEl(body, 'div', {id:'zai-sug-area'});
    addEl(body, 'div', {className:'zai-error', id:'zai-error', style:'display:none'});

    panel.appendChild(body);
    document.body.appendChild(panel);

    // Events
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
      else prefetchCustomers_();
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
    _custCache = null; _ordCache = null; _cacheAt = 0;
    if (!key) showMsg('zai-save-status','✓ Đã lưu cài đặt',2000);
    prefetchCustomers_();
  }

  async function prefetchCustomers_() {
    if (!GAS_URL) return;
    if (_custCache && Date.now() - _cacheAt < CACHE_TTL) return;
    try {
      const sep = GAS_URL.includes('?') ? '&' : '?';
      const r = await fetch(GAS_URL + sep + 'action=customers', {redirect:'follow'});
      const d = await r.json();
      const map = {};
      (d.rows||[]).forEach(r => { if(r.phone) map[normPhone(r.phone)] = r; });
      _custCache = map; _cacheAt = Date.now();
      loadOrdersBg_();
    } catch(e) {}
  }

  async function loadOrdersBg_() {
    if (_ordLoading || (_ordCache && Date.now() - _cacheAt < CACHE_TTL)) return;
    _ordLoading = true;
    try {
      const sep = GAS_URL.includes('?') ? '&' : '?';
      const r = await fetch(GAS_URL + sep + 'action=orders', {redirect:'follow'});
      const d = await r.json();
      const map = {};
      (d.orders||[]).forEach(o => {
        const p = normPhone(o.phone); if(!p) return;
        if(!map[p]) map[p] = [];
        map[p].push(o);
      });
      _ordCache = map;
    } catch(e) {}
    _ordLoading = false;
  }

  function normPhone(p) {
    if (!p) return '';
    let s = String(p).replace(/\D/g,'');
    if (s.startsWith('84') && s.length===11) s='0'+s.slice(2);
    if (s.length===9 && /^[3-9]/.test(s)) s='0'+s; // GSheet lưu thiếu số 0 đầu
    return s;
  }

  // ── PHONE AUTO-DETECT ──
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

  // ── GRAB MESSAGE ──
  function doGrabMessage() {
    const sels = [
      '[class*="message"]:not([class*="owner"]):not([class*="sender"]):not([class*="-me"])',
      '[class*="message-text"]','[class*="chat-message"]','[class*="msg-text"]'
    ];
    let last = '';
    for (const sel of sels) {
      try {
        const els = document.querySelectorAll(sel);
        for (let i=els.length-1;i>=0;i--) {
          const t=(els[i].innerText||els[i].textContent||'').trim();
          if (t.length>2 && !/^\d{1,2}:\d{2}$/.test(t)) { last=t; break; }
        }
        if (last) break;
      } catch(e){}
    }
    if (last) {
      document.getElementById('zai-msg').value = last;
      const h = document.getElementById('zai-auto-hint');
      if (h) { h.textContent='✓ Đã lấy tin nhắn'; setTimeout(()=>{h.textContent='';},2500); }
    } else {
      showError('Không tìm được tin nhắn. Hãy copy thủ công.');
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
    area.innerHTML = '<div class="zai-loading"><div class="zai-spinner"></div>Đang tra cứu...</div>';
    updSec.style.display = 'none';
    _currentCustData = null;

    if (!_custCache) {
      if (!GAS_URL) { showError('Chưa cài URL GAS. Nhấn ⚙.'); area.innerHTML=''; return; }
      await prefetchCustomers_();
    }

    const care = _custCache ? _custCache[phone] : null;
    let orders = _ordCache ? (_ordCache[phone]||[]) : [];
    orders = orders.slice().sort((a,b) => parseDate_(b.date)-parseDate_(a.date));
    const custCount = _custCache ? Object.keys(_custCache).length : 0;

    if (!care && !orders.length && !_ordCache) {
      if (care) {
        renderCard_(area, updSec, phone, raw, care, []);
        loadOrdersBg_().then(() => {
          const ords = (_ordCache&&_ordCache[phone])||[];
          renderCard_(area, updSec, phone, raw, care, ords.slice().sort((a,b)=>parseDate_(b.date)-parseDate_(a.date)));
        });
      } else {
        area.innerHTML = '<div class="zai-loading"><div class="zai-spinner"></div>Đang tải đơn hàng...</div>';
        await loadOrdersBg_();
        const ords = (_ordCache&&_ordCache[phone])||[];
        if (!care && !ords.length) {
          showNotFoundWithForm_(area, updSec, phone, raw, custCount);
          return;
        }
        renderCard_(area, updSec, phone, raw, care, ords.slice().sort((a,b)=>parseDate_(b.date)-parseDate_(a.date)));
      }
    } else if (!care && !orders.length) {
      showNotFoundWithForm_(area, updSec, phone, raw, custCount);
    } else {
      renderCard_(area, updSec, phone, raw, care, orders);
    }
  }

  function showNotFoundWithForm_(area, updSec, phone, raw, custCount) {
    const hint = custCount > 0
      ? `Đã load ${custCount} khách — <strong>${escHtml(raw)}</strong> chưa có trong GSheet.`
      : `Chưa load được dữ liệu. Kiểm tra URL GAS và Deploy version mới.`;
    area.innerHTML = `<div class="zai-not-found">⚠️ ${hint}<br><small>Có thể thêm mới bên dưới.</small></div>`;
    _currentCustData = {phone, name: raw, care: null, orders: []};
    updSec.style.display = 'block';
    document.getElementById('zai-status-sel').value = '';
    document.getElementById('zai-zalo-sel').value   = '';
    document.getElementById('zai-cs-inp').value     = '';
    document.getElementById('zai-note-ta').value    = '';
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
        </div>
        ${care&&care.note ? `<div class="zai-card-note">📝 ${escHtml(care.note)}</div>` : ''}
        ${orders.slice(0,3).length ? `<div class="zai-card-orders"><strong>Đơn gần nhất:</strong><br>${
          orders.slice(0,3).map(o => {
            const d = fmtDate_(o.date);
            const rev = o.revenue ? Number(o.revenue).toLocaleString('vi-VN')+'đ' : '';
            const sp = (o.product||'') + (o.productDetail?' — '+o.productDetail:'');
            return `• <b>${d}</b> | ${rev}<br>&nbsp;&nbsp;${escHtml(sp)}`;
          }).join('<br>')
        }</div>` : (orders.length===0 ? '<div class="zai-card-note">⏳ Đang tải đơn hàng...</div>' : '')}
      </div>`;

    updSec.style.display = 'block';
    if (care) {
      document.getElementById('zai-status-sel').value = care.status||'';
      document.getElementById('zai-zalo-sel').value   = care.zalo||'';
      document.getElementById('zai-cs-inp').value     = care.cs||'';
      document.getElementById('zai-note-ta').value    = care.note||'';
    } else {
      document.getElementById('zai-status-sel').value = '';
      document.getElementById('zai-zalo-sel').value   = '';
      document.getElementById('zai-cs-inp').value     = '';
      document.getElementById('zai-note-ta').value    = '';
    }
  }

  // ── SAVE STATUS ──
  async function doSaveStatus() {
    if (!_currentCustData) { showError('Chưa tra cứu khách nào.'); return; }
    if (!GAS_URL) { showError('Chưa cài đặt URL GAS.'); return; }
    const status = document.getElementById('zai-status-sel').value;
    const zalo   = document.getElementById('zai-zalo-sel').value;
    const cs     = document.getElementById('zai-cs-inp').value.trim();
    const note   = document.getElementById('zai-note-ta').value;
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
        schedHen:c.schedHen||'', schedHenNote:c.schedHenNote||''
      };
      const res = await fetch(GAS_URL, {method:'POST', body:JSON.stringify({action:'saveSingle',row}), headers:{'Content-Type':'text/plain'}});
      const d = await res.json();
      if (d.ok) {
        showMsg('zai-save-status','✓ Đã lưu lên GSheet!',3000);
        if (_custCache) _custCache[_currentCustData.phone] = {...c, status, zalo, cs, note};
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
    const msg = (document.getElementById('zai-msg').value||'').trim();
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
      addEl(sug,'div',{className:'zai-section-label',textContent:'💡 Gợi ý (click để copy)'});
      const card = addEl(sug,'div',{className:'zai-sug'});
      const txt = addEl(card,'div',{});
      txt.innerHTML = escHtml(text).replace(/\n/g,'<br>');
      const badge = addEl(card,'span',{className:'zai-copy-badge',textContent:'Copy'});
      card.addEventListener('click',()=>{
        navigator.clipboard.writeText(text).then(()=>{
          badge.textContent='✓ Đã copy!'; badge.classList.add('zai-copied');
          setTimeout(()=>{badge.textContent='Copy';badge.classList.remove('zai-copied');},1500);
        });
      });
    } catch(e) { sug.innerHTML=''; showError('Lỗi: '+e.message); }
    finally { btn.disabled=false; btn.textContent=label; }
  }

  // ── DATE HELPERS ──
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

  function showError(msg) { const el=document.getElementById('zai-error'); if(el){el.textContent=msg;el.style.display='block';} }
  function hideError()    { const el=document.getElementById('zai-error'); if(el) el.style.display='none'; }
  function showMsg(id,msg,ms) { const el=document.getElementById(id); if(!el) return; el.textContent=msg; if(ms) setTimeout(()=>{el.textContent='';},ms); }
  function escHtml(str) { return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function init() { buildPanel(); watchZaloChat(); }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
  else init();
})();
