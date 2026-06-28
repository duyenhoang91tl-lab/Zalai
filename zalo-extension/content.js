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
    hdr.innerHTML = '<span>🤖 OME Zalo AI Helper</span><button id="zai-close-btn" title="Đóng">✕</button>';
    panel.appendChild(hdr);

    // CS sticky bar
    const csBar = document.createElement('div');
    csBar.id = 'zai-cs-bar';
    csBar.style.cssText = 'background:#dcfce7;border-bottom:2px solid #86efac;padding:5px 10px;font-size:11px;';
    csBar.innerHTML =
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">'+
      '<span>👤</span>'+
      '<select id="zai-cs-bar-sel" style="flex:1;font-size:11px;border:1px solid #86efac;border-radius:4px;padding:2px 4px;">'+
      '<option value="">— Chọn CS —</option>'+
      CS_NAMES.filter(Boolean).map(n=>'<option value="'+n+'">'+n+'</option>').join('')+
      '</select>'+
      '<span style="color:#16a34a;font-size:10px;">CS mặc định cho phiên</span></div>'+
      '<div style="display:flex;align-items:center;gap:6px;">'+
      '<span>💬</span>'+
      '<select id="zai-nz-sel" style="flex:1;font-size:11px;border:1px solid #86efac;border-radius:4px;padding:2px 4px;">'+
      '<option value="">— Chọn nick —</option></select>'+
      '<button id="zai-nz-add" style="font-size:11px;background:#16a34a;color:#fff;border:none;border-radius:4px;padding:2px 7px;cursor:pointer;">＋</button>'+
      '</div>';
    panel.appendChild(csBar);

    // Tabs
    const tabs = document.createElement('div');
    tabs.className = 'zai-tabs';
    tabs.innerHTML = ['Tìm KH','Cập nhật','AI','Lịch sử tin'].map((t,i) =>
      `<button class="zai-tab${i===0?' active':''}" data-tab="${i}">${t}</button>`).join('');
    panel.appendChild(tabs);

    // Tab panes
    const panes = document.createElement('div');
    panes.className = 'zai-panes';

    // Pane 0: Tìm KH
    const p0 = document.createElement('div');
    p0.className = 'zai-pane active';
    p0.innerHTML =
      '<div style="display:flex;gap:4px;margin-bottom:6px;">'+
      '<input id="zai-phone" type="text" placeholder="Số điện thoại..." style="flex:1;"/>'+
      '<button id="zai-lookup-btn">🔍</button></div>'+
      '<div id="zai-error" style="color:#ef4444;font-size:11px;display:none;"></div>'+
      '<div id="zai-card"></div>';
    panes.appendChild(p0);

    // Pane 1: Cập nhật
    const p1 = document.createElement('div');
    p1.className = 'zai-pane';
    p1.innerHTML =
      '<input type="hidden" id="zai-cs-sel"/>'+
      '<input type="hidden" id="zai-nz-form-sel"/>'+
      '<div class="zai-frow"><label>Tình trạng CS</label>'+
      '<select id="zai-status-sel"><option value="">— Chọn —</option>'+
      CARE_STATUSES.map(s=>'<option>'+s+'</option>').join('')+'</select></div>'+
      '<div class="zai-frow"><label>Kết bạn Zalo</label>'+
      '<select id="zai-zalo-sel">'+ZALO_STATUSES.map(s=>'<option>'+s+'</option>').join('')+'</select></div>'+
      '<div class="zai-frow"><label>Trạng thái KH</label>'+
      '<select id="zai-kh-status-sel">'+CUST_STATUS_OPTS.map(s=>'<option>'+s+'</option>').join('')+'</select></div>'+
      '<div class="zai-frow"><label>Lịch hẹn</label>'+
      '<input id="zai-sched-date" type="date" style="width:120px;"/>'+
      '<input id="zai-sched-note" type="text" placeholder="Ghi chú lịch..." style="flex:1;"/></div>'+
      '<div class="zai-frow"><label>Ghi chú CS</label>'+
      '<textarea id="zai-note" rows="3" placeholder="Ghi chú..."></textarea></div>'+
      '<button id="zai-save-btn" style="width:100%;">Lưu</button>'+
      '<div id="zai-save-msg" style="font-size:11px;margin-top:4px;"></div>';
    panes.appendChild(p1);

    // Pane 2: AI
    const p2 = document.createElement('div');
    p2.className = 'zai-pane';
    p2.innerHTML =
      '<div style="display:flex;gap:4px;margin-bottom:6px;">'+
      '<select id="zai-tone-sel" style="flex:1;font-size:11px;">'+
      ['Thân thiện','Chuyên nghiệp','Ngắn gọn'].map(t=>'<option>'+t+'</option>').join('')+'</select>'+
      '<button id="zai-hist-btn" title="Lịch sử tin nhắn">📝</button></div>'+
      '<textarea id="zai-msg" rows="3" placeholder="Nhập tin nhắn của khách..."></textarea>'+
      '<div id="zai-hist-box" style="display:none;background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;padding:6px;margin:4px 0;font-size:10px;max-height:100px;overflow-y:auto;"></div>'+
      '<button id="zai-ai-btn" style="width:100%;margin-top:4px;">Gợi ý trả lời</button>'+
      '<div id="zai-ai-resp" style="margin-top:6px;font-size:11px;white-space:pre-wrap;"></div>';
    panes.appendChild(p2);

    // Pane 3: Lịch sử tin
    const p3 = document.createElement('div');
    p3.className = 'zai-pane';
    p3.innerHTML = '<div id="zai-hist-list" style="font-size:11px;"><em>Chưa có tin nhắn nào.</em></div>';
    panes.appendChild(p3);

    panel.appendChild(panes);

    // Config section
    const cfg = document.createElement('div');
    cfg.id = 'zai-cfg';
    cfg.style.cssText = 'display:none;padding:8px;border-top:1px solid #e2e8f0;font-size:11px;';
    cfg.innerHTML =
      '<div style="display:flex;gap:4px;align-items:center;">'+
      '<label style="white-space:nowrap;">GAS URL</label>'+
      '<input id="zai-gas-url" type="text" style="flex:1;font-size:10px;" placeholder="https://script.google.com/..."/>'+
      '<button id="zai-save-cfg">✓</button></div>';
    panel.appendChild(cfg);

    // Footer
    const ftr = document.createElement('div');
    ftr.style.cssText = 'display:flex;justify-content:space-between;padding:4px 8px;border-top:1px solid #e2e8f0;';
    ftr.innerHTML = '<button id="zai-cfg-btn" style="font-size:10px;background:none;border:none;color:#94a3b8;cursor:pointer;">&#9881; Cài đặt</button>'+
      '<span id="zai-ver" style="font-size:9px;color:#cbd5e1;line-height:24px;">v14.9</span>';
    panel.appendChild(ftr);

    document.body.appendChild(panel);
    initPanelEvents();
  }

  function togglePanel() {
    const p = document.getElementById('ome-zai-panel');
    if (!p) return;
    p.style.display = p.style.display === 'none' ? '' : 'none';
  }

  function initPanelEvents() {
    document.getElementById('zai-close-btn').addEventListener('click', togglePanel);

    // Tabs
    document.querySelectorAll('.zai-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.zai-tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.zai-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.zai-pane')[+btn.dataset.tab].classList.add('active');
      });
    });

    // Tìm KH
    document.getElementById('zai-lookup-btn').addEventListener('click', doLookup_);
    document.getElementById('zai-phone').addEventListener('keydown', e => { if(e.key==='Enter') doLookup_(); });

    // Lưu
    document.getElementById('zai-save-btn').addEventListener('click', doSaveStatus_);

    // AI
    document.getElementById('zai-ai-btn').addEventListener('click', doAI_);
    document.getElementById('zai-tone-sel').addEventListener('change', e => { _activeTone = e.target.value; });
    document.getElementById('zai-hist-btn').addEventListener('click', () => {
      _histVisible = !_histVisible;
      const hb = document.getElementById('zai-hist-box');
      if (hb) hb.style.display = _histVisible ? '' : 'none';
    });

    // Config
    document.getElementById('zai-cfg-btn').addEventListener('click', () => {
      _cfgVisible = !_cfgVisible;
      const cfg = document.getElementById('zai-cfg');
      if (cfg) cfg.style.display = _cfgVisible ? '' : 'none';
    });
    document.getElementById('zai-save-cfg').addEventListener('click', () => {
      const url = document.getElementById('zai-gas-url').value.trim();
      if (url) {
        chrome.storage.local.set({ome_gas_url: url}, () => {
          GAS_URL = url;
          showMsg('zai-save-msg', '✓ Đã lưu GAS URL', 2000);
          loadCSNames_();
          loadNickZaloList_();
        });
      }
    });

    // CS sticky bar
    const csSel = document.getElementById('zai-cs-bar-sel');
    if (csSel) {
      csSel.addEventListener('change', () => {
        _currentCS = csSel.value;
        chrome.storage.local.set({ome_current_cs: _currentCS});
        // Sync hidden cs input
        const fcs = document.getElementById('zai-cs-sel');
        if (fcs) fcs.value = _currentCS;
        startReminderPoll_();
      });
    }

    // Nick Zalo sticky
    const nzSel = document.getElementById('zai-nz-sel');
    if (nzSel) {
      nzSel.addEventListener('change', () => {
        _currentZaloNick = nzSel.value;
        chrome.storage.local.set({ome_current_nz: _currentZaloNick});
        // Sync hidden nick input
        const fnz = document.getElementById('zai-nz-form-sel');
        if (fnz) fnz.value = _currentZaloNick;
      });
    }

    // Nick Zalo add button
    const nzAdd = document.getElementById('zai-nz-add');
    if (nzAdd) {
      nzAdd.addEventListener('click', async () => {
        const name = prompt('Nhập Nick Zalo mới:');
        if (!name || !name.trim()) return;
        const nick = name.trim();
        if (!_zaloNickList.includes(nick)) {
          _zaloNickList.push(nick);
          // Save to GAS Settings
          if (GAS_URL) {
            const sep = GAS_URL.includes('?') ? '&' : '?';
            await fetch(GAS_URL + sep + 'action=saveSingle', {
              method: 'POST', redirect: 'follow',
              headers: {'Content-Type':'application/json'},
              body: JSON.stringify({settingKey:'nickZaloList', settingValue: JSON.stringify(_zaloNickList)})
            }).catch(()=>{});
          }
          // Rebuild sticky dropdown only (zai-nz-form-sel is hidden)
          const sel = document.getElementById('zai-nz-sel');
          if (sel) {
            const o = document.createElement('option'); o.value=nick; o.textContent=nick; sel.appendChild(o);
          }
        }
        // Auto-select
        _currentZaloNick = nick;
        chrome.storage.local.set({ome_current_nz: nick});
        const s2 = document.getElementById('zai-nz-sel');
        if (s2) s2.value = nick;
        const f2 = document.getElementById('zai-nz-form-sel');
        if (f2) f2.value = nick;
      });
    }
  }

  // ── LOAD CS NAMES ──
  async function loadCSNames_() {
    if (!GAS_URL) return;
    try {
      const sep = GAS_URL.includes('?') ? '&' : '?';
      const r = await fetch(GAS_URL + sep + 'action=users', {redirect:'follow'});
      const d = await r.json();
      if (d.users && d.users.length) {
        CS_NAMES = ['', ...d.users];
        // Rebuild CS bar selector only (zai-cs-sel is hidden input)
        const barSel = document.getElementById('zai-cs-bar-sel');
        if (barSel) {
          const cur = barSel.value;
          barSel.innerHTML = '<option value="">— Chọn CS —</option>';
          d.users.forEach(u => {
            const o = document.createElement('option'); o.value=u; o.textContent=u; barSel.appendChild(o);
          });
          barSel.value = cur || _currentCS || '';
        }
        const hCS = document.getElementById('zai-cs-sel');
        if (hCS) hCS.value = _currentCS || '';
      }
    } catch(e) {}
  }

  // ── LOOKUP ──
  async function doLookup_() {
    const raw = (document.getElementById('zai-phone')||{}).value || '';
    const phone = raw.trim().replace(/\s+/g,'');
    if (!phone) { showError('Điền số điện thoại'); return; }
    if (!GAS_URL) { showError('Chưa cài GAS URL'); return; }
    hideError();
    const cacheKey = phone;
    const now = Date.now();
    if (_lookupCache[cacheKey] && now - _lookupCache[cacheKey].ts < LOOKUP_TTL) {
      renderCard_(_lookupCache[cacheKey].data);
      return;
    }
    document.getElementById('zai-card').textContent = 'Đang tìm...';
    try {
      const sep = GAS_URL.includes('?') ? '&' : '?';
      const r = await fetch(GAS_URL + sep + 'action=lookup&phone=' + encodeURIComponent(phone), {redirect:'follow'});
      const d = await r.json();
      if (d.error) { showError(d.error); document.getElementById('zai-card').textContent=''; return; }
      _lookupCache[cacheKey] = {ts: now, data: d};
      renderCard_(d);
      // Switch to Tìm KH tab
      document.querySelectorAll('.zai-tab')[0].click();
    } catch(e) { showError('Lỗi kết nối: ' + e.message); document.getElementById('zai-card').textContent=''; }
  }

  // ── RENDER CARD ──
  function renderCard_(d) {
    _currentPhone = d.phone || '';
    _currentCustData = d;
    const card = document.getElementById('zai-card');
    if (!card) return;

    const orders = d.orders || [];
    const ordersHtml = orders.length ? orders.map(o =>
      '<div class="zai-order"><b>'+escHtml(formatDate_(o.date))+'</b> — '+escHtml(o.product||'')+' — '+escHtml(String(o.revenue||''))+'</div>'
    ).join('') : '<div style="color:#94a3b8">Chưa có đơn hàng</div>';

    const c = d.care || {};
    card.innerHTML =
      '<div class="zai-card-name">'+(d.name?escHtml(d.name):'—')+'</div>'+
      '<div style="color:#64748b;font-size:11px;">'+escHtml(d.phone||'')+'</div>'+
      '<hr style="margin:6px 0;"/>'+
      '<div class="zai-orders-hdr">🛎 Đơn hàng ('+orders.length+')</div>'+
      ordersHtml +
      '<hr style="margin:6px 0;"/>'+
      '<div style="font-size:11px;color:#475569;">'+
      '<div>📅 <b>Cập nhật:</b> '+(c.updated||'—')+'</div>'+
      '<div>📊 <b>Tình trạng CS:</b> '+escHtml(c.status||'—')+'</div>'+
      '<div>📱 <b>Zalo:</b> '+escHtml(c.zalo||'—')+'</div>'+
      '<div>👤 <b>CS:</b> '+escHtml(c.cs||'—')+'</div>'+
      '<div>💬 <b>Nick Zalo CS:</b> '+(Array.isArray(c.nickZalos)?c.nickZalos.join(', '):escHtml(c.nickZalos||'—'))+'</div>'+
      '<div>🏷️ <b>Trạng thái KH:</b> '+escHtml(c.khStatus||'—')+'</div>'+
      (c.schedHen?'<div>🕔 <b>Lịch hẹn:</b> '+escHtml(formatDate_(c.schedHen))+(c.schedHenNote?' — '+escHtml(c.schedHenNote):'')+'</div>':'')+
      (c.note?'<div>📝 <b>Ghi chú:</b> '+escHtml(c.note)+'</div>':'')+
      '</div>';

    // Auto-fill update form
    const st = document.getElementById('zai-status-sel');
    if (st) st.value = c.status || '';
    const zl = document.getElementById('zai-zalo-sel');
    if (zl) zl.value = c.zalo || '';
    const cs = document.getElementById('zai-cs-sel');
    if (cs) cs.value = _currentCS || c.cs || '';
    const nzf = document.getElementById('zai-nz-form-sel');
    if (nzf) nzf.value = _currentZaloNick || '';
    const khs = document.getElementById('zai-kh-status-sel');
    if (khs) khs.value = c.khStatus || '';
    const sd = document.getElementById('zai-sched-date');
    if (sd) sd.value = c.schedHen ? formatDateISO_(c.schedHen) : '';
    const sn = document.getElementById('zai-sched-note');
    if (sn) sn.value = c.schedHenNote || '';
    const nt = document.getElementById('zai-note');
    if (nt) nt.value = '';
  }

  // ── SAVE STATUS ──
  async function doSaveStatus_() {
    if (!_currentPhone) { showError('Chưa tìm khách hàng'); return; }
    if (!GAS_URL) { showError('Chưa cài GAS URL'); return; }
    hideError();
    const c = (_currentCustData && _currentCustData.care) || {};
    // Build timestamp prefix for note
    const noteVal = (document.getElementById('zai-note')||{}).value || '';
    let noteFinal = c.note || '';
    if (noteVal.trim()) {
      const now = new Date();
      const dd = String(now.getDate()).padStart(2,'0');
      const mm = String(now.getMonth()+1).padStart(2,'0');
      const hh = String(now.getHours()).padStart(2,'0');
      const mi = String(now.getMinutes()).padStart(2,'0');
      const csName = _currentCS || document.getElementById('zai-cs-sel').value || '';
      const prefix = '['+dd+'/'+mm+' '+hh+':'+mi+(csName?' - '+csName:'')+'] ';
      noteFinal = prefix + noteVal.trim() + (c.note ? '\n' + c.note : '');
    }
    const payload = {
      phone: _currentPhone,
      status: document.getElementById('zai-status-sel').value || (c.status||''),
      zalo:   document.getElementById('zai-zalo-sel').value   || (c.zalo  ||''),
      cs:     document.getElementById('zai-cs-sel').value     || _currentCS || (c.cs||''),
      note:   noteFinal,
      schedHen:     (document.getElementById('zai-sched-date')||{}).value || (c.schedHen||''),
      schedHenNote: (document.getElementById('zai-sched-note')||{}).value || (c.schedHenNote||''),
      khStatus: document.getElementById('zai-kh-status-sel').value || (c.khStatus||''),
      nickZalos: (() => {
        const formNick = (document.getElementById('zai-nz-form-sel')||{}).value || _currentZaloNick || '';
        const existing = c.nickZalos || [];
        if (formNick && !existing.includes(formNick)) return [...existing, formNick];
        return existing;
      })()
    };
    const btn = document.getElementById('zai-save-btn');
    if (btn) btn.disabled = true;
    try {
      const sep = GAS_URL.includes('?') ? '&' : '?';
      const r = await fetch(GAS_URL + sep + 'action=saveSingle', {
        method: 'POST', redirect: 'follow',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      });
      const d = await r.json();
      if (d.ok) {
        showMsg('zai-save-msg','✓ Đã lưu!', 2500);
        // Update cache + re-render
        if (_lookupCache[_currentPhone]) {
          const care = Object.assign({}, (_lookupCache[_currentPhone].data.care||{}), payload);
          _lookupCache[_currentPhone].data.care = care;
          _currentCustData = _lookupCache[_currentPhone].data;
        }
        // Clear note field after save
        const nt = document.getElementById('zai-note'); if (nt) nt.value='';
      } else {
        showMsg('zai-save-msg','⚠ Lỗi lưu: '+(d.error||'unknown'),3000);
      }
    } catch(e) { showMsg('zai-save-msg','⚠ Lỗi kết nối', 3000); }
    if (btn) btn.disabled = false;
  }

  // ── AI ──
  async function doAI_() {
    const msg = (document.getElementById('zai-msg')||{}).value || '';
    if (!msg.trim()) return;
    if (!GAS_URL) { showError('Chưa cài GAS URL'); return; }
    const btn = document.getElementById('zai-ai-btn');
    if (btn) btn.disabled = true;
    const resp = document.getElementById('zai-ai-resp');
    if (resp) resp.textContent = 'Đang tư vấn...';
    // Save chat history for AI context
    _chatHistory.push({role:'user', content: msg});
    // Render history tab
    renderHistoryTab_();
    try {
      const sep = GAS_URL.includes('?') ? '&' : '?';
      const r = await fetch(GAS_URL + sep + 'action=ai', {
        method: 'POST', redirect: 'follow',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          phone: _currentPhone,
          customerData: _currentCustData,
          message: msg,
          tone: _activeTone,
          history: _chatHistory.slice(-10) // last 10 messages for context
        })
      });
      const d = await r.json();
      if (d.reply) {
        if (resp) resp.textContent = d.reply;
        _chatHistory.push({role:'assistant', content: d.reply});
        renderHistoryTab_();
      } else {
        if (resp) resp.textContent = '—';
      }
    } catch(e) {
      if (resp) resp.textContent = '⚠ Lỗi kết nối';
    }
    if (btn) btn.disabled = false;
  }

  function renderHistoryTab_() {
    const list = document.getElementById('zai-hist-list');
    if (!list) return;
    if (!_chatHistory.length) { list.innerHTML = '<em>Chưa có tin nhắn nào.</em>'; return; }
    list.innerHTML = _chatHistory.map(m =>
      '<div style="margin-bottom:6px;"><b style="color:'+(m.role==='user'?'#3b82f6':'#16a34a')+';">'+
      (m.role==='user'?'KH':'AI')+':</b> '+escHtml(m.content)+'</div>'
    ).join('');
    list.scrollTop = list.scrollHeight;
    // Also update hist-box in AI tab
    const hb = document.getElementById('zai-hist-box');
    if (hb) hb.innerHTML = list.innerHTML;
  }

  // ── WATCH ZALO CHAT ──
  function watchZaloChat() {
    let lastMsg = '';
    setInterval(() => {
      const msgs = document.querySelectorAll('[class*="message"] [class*="text"], [class*="msg"] [class*="content"]');
      if (!msgs.length) return;
      const last = msgs[msgs.length - 1];
      const txt = (last.textContent || '').trim();
      if (!txt || txt === lastMsg) return;
      lastMsg = txt;
      // Update AI tab message box with latest customer message
      const aiMsg = document.getElementById('zai-msg');
      if (aiMsg && !aiMsg.value) aiMsg.value = txt;
      // Push to chat history (avoid dups)
      if (!_chatHistory.length || _chatHistory[_chatHistory.length-1].content !== txt) {
        _chatHistory.push({role:'user', content: txt});
        renderHistoryTab_();
      }
    }, 2000);

    // Also intercept React-based message sends
    document.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        const inp = e.target;
        if (!inp) return;
        const txt2 = inp.value || inp.textContent || '';
        if (txt2.trim() && txt2 !== lastMsg) {
          lastMsg = txt2;
          _chatHistory.push({role:'user', content: txt2.trim()});
          renderHistoryTab_();
        }
      }
    }, true);
  }

  // ── DATE UTILS ──
  function formatDate_(s) {
    if (!s) return '—';
    if (String(s).includes('T')) {
      const dt = new Date(s);
      if (!isNaN(dt)) {
        const dd = String(dt.getDate()).padStart(2,'0');
        const mm = String(dt.getMonth()+1).padStart(2,'0');
        const yy = dt.getFullYear();
        return dd+'/'+mm+'/'+yy;
      }
    }
    const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[3]+'/'+m[2]+'/'+m[1];
    return String(s);
  }

  function formatDateISO_(s) {
    if (!s) return '';
    if (String(s).includes('T')) {
      const dt = new Date(s);
      if (!isNaN(dt)) {
        const dd = String(dt.getDate()).padStart(2,'0');
        const mm = String(dt.getMonth()+1).padStart(2,'0');
        const yy = dt.getFullYear();
        return yy+'-'+mm+'-'+dd;
      }
    }
    const m = String(s).match(/(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : '';
  }

  // ── CLEAR FORM ──
  function clearForm_() {
    ['zai-status-sel','zai-zalo-sel','zai-kh-status-sel'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    const cs = document.getElementById('zai-cs-sel');
    if (cs) cs.value = _currentCS || '';
    const nzf = document.getElementById('zai-nz-form-sel');
    if (nzf) nzf.value = _currentZaloNick || '';
    ['zai-note','zai-sched-date','zai-sched-note'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
  }

  // ── UI HELPERS ──
  function showError(msg) { const el=document.getElementById('zai-error'); if(el){ el.textContent=msg; el.style.display=''; } }
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
        window.open('https://duyenhoang91tl-lab.github.io/teamduyen/?phone=' + encodeURIComponent(rem.phone), '_blank');
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
      // Rebuild sticky nick dropdown
      const nzSel = document.getElementById('zai-nz-sel');
      if (nzSel) {
        nzSel.innerHTML = '<option value="">— Chọn nick —</option>';
        _zaloNickList.forEach(n => {
          const o = document.createElement('option'); o.value=n; o.textContent=n; nzSel.appendChild(o);
        });
        if (_currentZaloNick) nzSel.value = _currentZaloNick;
      }
      // Sync hidden form nick input
      const nzF = document.getElementById('zai-nz-form-sel');
      if (nzF) nzF.value = _currentZaloNick || '';
    } catch(e) {}
  }

  // ── INIT ──
  async function init() {
    // Load saved config
    chrome.storage.local.get(['ome_gas_url','ome_current_cs','ome_current_nz'], data => {
      if (data.ome_gas_url) {
        GAS_URL = data.ome_gas_url;
        const urlInp = document.getElementById('zai-gas-url');
        if (urlInp) urlInp.value = GAS_URL;
      }
      if (data.ome_current_cs) {
        _currentCS = data.ome_current_cs;
        const csSel = document.getElementById('zai-cs-bar-sel');
        if (csSel) csSel.value = _currentCS;
        const fcs = document.getElementById('zai-cs-sel');
        if (fcs) fcs.value = _currentCS;
      }
      if (data.ome_current_nz) {
        _currentZaloNick = data.ome_current_nz;
        const nzSel = document.getElementById('zai-nz-sel');
        if (nzSel) nzSel.value = _currentZaloNick;
        const nzF = document.getElementById('zai-nz-form-sel');
        if (nzF) nzF.value = _currentZaloNick;
      }
      if (GAS_URL) {
        loadCSNames_();
        loadNickZaloList_();
        startReminderPoll_();
      }
    });
    buildPanel();
  }

  // ── STYLE ──
  const style = document.createElement('style');
  style.textContent = `
    #ome-zai-toggle {
      position: fixed; bottom: 20px; right: 20px; z-index: 99999;
      background: #1e40af; color: #fff; border: none; border-radius: 24px;
      padding: 10px 18px; font-size: 14px; font-weight: bold;
      cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }
    #ome-zai-panel {
      position: fixed; bottom: 70px; right: 20px; z-index: 99998;
      width: 340px; max-height: 80vh; overflow-y: auto;
      background: #fff; border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.2);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 12px; display: flex; flex-direction: column;
    }
    .zai-hdr {
      background: #1e40af; color: #fff; padding: 10px 14px;
      border-radius: 12px 12px 0 0; display: flex;
      justify-content: space-between; align-items: center;
      font-weight: bold; font-size: 13px;
    }
    .zai-hdr button { background: none; border: none; color: #fff; cursor: pointer; font-size: 16px; }
    .zai-tabs { display: flex; border-bottom: 1px solid #e2e8f0; }
    .zai-tab {
      flex: 1; padding: 6px 4px; font-size: 10px; border: none; background: none;
      cursor: pointer; color: #64748b; border-bottom: 2px solid transparent;
    }
    .zai-tab.active { color: #1e40af; border-bottom-color: #1e40af; font-weight: bold; }
    .zai-panes { flex: 1; overflow-y: auto; }
    .zai-pane { display: none; padding: 10px; }
    .zai-pane.active { display: block; }
    .zai-pane input[type=text], .zai-pane input[type=date], .zai-pane textarea, .zai-pane select {
      width: 100%; box-sizing: border-box; border: 1px solid #e2e8f0;
      border-radius: 6px; padding: 5px 8px; font-size: 11px; margin: 0;
    }
    .zai-pane button {
      background: #1e40af; color: #fff; border: none; border-radius: 6px;
      padding: 7px 14px; cursor: pointer; font-size: 12px;
    }
    .zai-pane button:disabled { background: #93c5fd; }
    .zai-frow { display: flex; flex-direction: column; gap: 2px; margin-bottom: 7px; }
    .zai-frow label { font-size: 10px; color: #64748b; font-weight: 600; }
    .zai-card-name { font-size: 15px; font-weight: bold; color: #1e293b; margin-bottom: 2px; }
    .zai-orders-hdr { font-size: 11px; font-weight: 600; color: #475569; margin-bottom: 4px; }
    .zai-order { font-size: 11px; color: #334155; padding: 3px 0; border-bottom: 1px solid #f1f5f9; }
    #zai-ai-resp { background: #f8fafc; border-radius: 6px; padding: 8px; min-height: 40px; }
    #zai-error { background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 5px 8px; }
  `;
  document.head.appendChild(style);

  function init_wrap() {
    if (typeof chrome === 'undefined' || !chrome.storage) {
      setTimeout(init_wrap, 500);
      return;
    }
    init();
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, reply) => {
      if (msg.type === 'LOOKUP') {
        const inp = document.getElementById('zai-phone');
        if (inp) inp.value = msg.phone;
        doLookup_();
        reply({ok: true});
      }
    });
  }

  document.addEventListener('change', e => {
    if (e.target && e.target.id === 'zai-gas-url') {
      GAS_URL = e.target.value.trim();
    }
  });

  function extractPhoneFromZalo() {
    const els = document.querySelectorAll('[class*="phone"], [data-phone]');
    for (const el of els) {
      const txt = (el.textContent || el.getAttribute('data-phone') || '').replace(/\s/g,'');
      if (/^0\d{9}$/.test(txt)) return txt;
    }
    return null;
  }

  function autoFillPhone() {
    const phone = extractPhoneFromZalo();
    if (phone) {
      const inp = document.getElementById('zai-phone');
      if (inp && !inp.value) {
        inp.value = phone;
      }
    }
  }

  setInterval(autoFillPhone, 3000);

  const origFetch = window.fetch;
  window.fetch = function(...args) {
    const result = origFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
      if (url && url.includes('chat.zalo.me') && args[1] && args[1].body) {
        try {
          const body = typeof args[1].body === 'string' ? JSON.parse(args[1].body) : args[1].body;
          if (body && body.message) {
            const txt3 = body.message;
            if (txt3 && txt3.trim() && (!_chatHistory.length || _chatHistory[_chatHistory.length-1].content !== txt3)) {
              _chatHistory.push({role:'cs', content: txt3.trim()});
              renderHistoryTab_();
            }
          }
        } catch(e) {}
      }
    } catch(e) {}
    return result;
  };

  // ── MUTATION OBSERVER for Zalo SPA navigation ──
  let _lastConvId = '';
  const _navObserver = new MutationObserver(() => {
    const match = location.pathname.match(/\/([0-9]+)(?:\/|$)/);
    const convId = match ? match[1] : '';
    if (convId && convId !== _lastConvId) {
      _lastConvId = convId;
      _chatHistory = [];
      _currentPhone = '';
      _currentCustData = null;
      clearForm_();
      const card = document.getElementById('zai-card');
      if (card) card.innerHTML = '';
      const aiResp = document.getElementById('zai-ai-resp');
      if (aiResp) aiResp.textContent = '';
      renderHistoryTab_();
    }
  });
  _navObserver.observe(document.body, {childList: true, subtree: true});

  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', init_wrap);
  else init_wrap();
})();
