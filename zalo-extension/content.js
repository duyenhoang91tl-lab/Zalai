// OME Zalo AI Helper - content script phien ban 10.22.9.7.2026 (gio.phut.ngay.thang.nam xuat ban)
// v15.3: Tu dong cap nhat tinh trang ket ban Zalo ve Sasum khi chay chien dich
//        (Gui ket ban->Chua ket ban; Da gui/Huy yeu cau->Chua dong y; ten co CTN->Chan;
//         ten co NHD->Zalo ngung hd; khong thay gi->Da ket ban; trung trang thai cu->bo qua)
// v15.2: Dinh tuyen gui theo Nick Zalo (perPhoneNick tu CareData.nickZalos);
//        khong danh dau skipped/failed len server nua -> nick khac van gui duoc
// v15.1: Dong bo gan-tuc-thoi - tu dong poll GAS moi 6s khi panel dang mo de lay
//        thay doi tu Sasum (hoac tu Zalo AI o may khac) ma khong ghi de field CS dang sua
// v15.0: An muc "CS cham soc" & "Nick Zalo dang dung" (tu dong lay tu thanh tren, dong bo Sasum);
//        Ghi chu CS chuyen sang dang JSON [{text,user,time}] + nut "+" giong Sasum (co lich su, xoa tung muc)
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
  let _productCodeMap = null; // mang [code,[tu-khoa...]] doc dong tu sheet "Mã Zalo" (fallback ve ZALO_PRODUCT_MAP_ neu chua tai duoc)
  let _zaloNickList = []; // danh sach nick tu GAS
  let _lastServerCare = {}; // baseline lan tra cuu/poll gan nhat, dung de biet CS co dang sua field nao khong
  let _pollInFlight = false;
  let _carePollStarted = false;

  // ── BROADCAST (gui tin hang loat) state ──
  let _bcRunning = false;
  let _bcPaused = false;
  let _bcStopFlag = false;
  let _bcQueue = [];
  let _bcLog = [];
  // Delay giua 2 khach (giay) - de ngau nhien cho giong nguoi that, tranh bi Zalo han che
  let _bcDelayMinSec = 45;
  let _bcDelayMaxSec = 90;
  // Cu sau bao nhieu tin thi nghi dai 1 lan
  let _bcBatchPauseEvery = 15;
  let _bcBatchPauseMin = 6;
  // Co kiem tra khop Nick Zalo dang dung voi Nick phu trach cua chien dich truoc khi gui khong
  // (mac dinh TAT vi du lieu Nick Zalo theo khach/chien dich chua duoc dong bo day du)
  let _bcCheckNick = false;

  const POLL_INTERVAL_MS = 6000; // dong bo gan-tuc-thoi: kiem tra du lieu moi moi 6 giay khi panel dang mo

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
  let CARE_STATUS_TREE = null; // cay Tinh trang CS load tu GAS (dong bo voi appweb)

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

    // ── BROADCAST SECTION (gui tin hang loat) ──
    const bcWrap = document.createElement('div');
    bcWrap.id = 'zai-bc-wrap';
    bcWrap.style.cssText = 'border-bottom:2px solid #bbf7d0;background:#f0fdf4;flex-shrink:0;';
    const bcHdr = document.createElement('div');
    bcHdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 14px;cursor:pointer;';
    bcHdr.innerHTML = '<span style="font-weight:700;color:#15803d;font-size:12px">📢 Gửi hàng loạt</span><span id="zai-bc-toggle" style="color:#15803d;font-size:11px">▼ mở</span>';
    const bcBody = document.createElement('div');
    bcBody.id = 'zai-bc-body';
    bcBody.style.cssText = 'display:none;padding:0 14px 10px;';
    bcHdr.addEventListener('click', () => {
      const hidden = bcBody.style.display === 'none';
      bcBody.style.display = hidden ? 'block' : 'none';
      document.getElementById('zai-bc-toggle').textContent = hidden ? '▲ thu gọn' : '▼ mở';
      if (hidden) loadBroadcastQueue_();
    });
    bcWrap.appendChild(bcHdr);
    bcWrap.appendChild(bcBody);
    panel.appendChild(bcWrap);

    // ── QUET DANH BA ZALO (du phong khi khach chua co don hang trong Sasum) ──
    const zsWrap = document.createElement('div');
    zsWrap.id = 'zai-zs-wrap';
    zsWrap.style.cssText = 'border-bottom:2px solid #e5e7eb;background:#f9fafb;flex-shrink:0;';
    const zsHdr = document.createElement('div');
    zsHdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 14px;cursor:pointer;';
    zsHdr.innerHTML = '<span style="font-weight:700;color:#374151;font-size:12px">🔍 Quét danh bạ Zalo (dự phòng)</span><span id="zai-zs-toggle" style="color:#374151;font-size:11px">▼ mở</span>';
    const zsBody = document.createElement('div');
    zsBody.id = 'zai-zs-body';
    zsBody.style.cssText = 'display:none;padding:8px 14px 10px;';
    zsBody.innerHTML =
      '<div style="font-size:10px;color:#6b7280;margin-bottom:6px">' +
      'Quét các tên hiển thị đang thấy trên màn hình theo cú pháp "ngày+tháng mã-sp Tên khách, SĐT" ' +
      '(VD: 6+7 hh Nguyễn Văn A, 0901234567). Chỉ dùng cho khách CHƯA có đơn hàng nào trong Sasum — ' +
      'có đơn thật thì hệ thống luôn ưu tiên dùng đơn thật, bỏ qua bản quét này.</div>' +
      '<button class="zai-btn zai-btn-secondary zai-btn-sm" id="zai-zs-scan-btn">🔍 Quét màn hình hiện tại</button>' +
      '<div id="zai-zs-preview" style="margin-top:8px"></div>';
    zsHdr.addEventListener('click', () => {
      const hidden = zsBody.style.display === 'none';
      zsBody.style.display = hidden ? 'block' : 'none';
      document.getElementById('zai-zs-toggle').textContent = hidden ? '▲ thu gọn' : '▼ mở';
    });
    zsWrap.appendChild(zsHdr);
    zsWrap.appendChild(zsBody);
    panel.appendChild(zsWrap);
    zsBody.querySelector('#zai-zs-scan-btn').addEventListener('click', () => {
      renderZsPreview_(scanZaloContactNames_());
    });

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

    // CS chăm sóc & Nick Zalo CS đang dùng: KHÔNG hiển thị nữa,
    // tự động = CS / Nick đã chọn ở thanh trên cùng (đồng bộ 2 chiều với Sasum)
    addEl(upd, 'input', {id:'zai-cs-sel', type:'hidden'});
    addEl(upd, 'input', {id:'zai-nz-form-sel', type:'hidden'});

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
    const col5 = addEl(row2, 'div', {className:'zai-field-col'});
    addEl(col5, 'label', {textContent:'🎂 Sinh nhật'});
    addEl(col5, 'input', {id:'zai-birthday', type:'date'});

    addEl(upd, 'label', {textContent:'Ghi chú CS'});
    const noteWrap = addEl(upd, 'div', {className:'zai-note-wrap'});
    const noteRow  = addEl(noteWrap, 'div', {className:'zai-note-row'});
    addEl(noteRow, 'textarea', {id:'zai-note-new', placeholder:'Thêm ghi chú mới...', rows:2});
    addEl(noteRow, 'button', {className:'zai-btn zai-btn-primary zai-btn-sm', id:'zai-note-add-btn', type:'button', textContent:'+', title:'Thêm ghi chú (Ctrl+Enter)'});
    addEl(noteWrap, 'div', {id:'zai-note-history', className:'zai-note-history'});
    addEl(upd, 'input', {id:'zai-note-raw', type:'hidden'});

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
    document.getElementById('zai-note-add-btn').addEventListener('click', addNoteEntry_);
    document.getElementById('zai-note-new').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addNoteEntry_(); }
    });
    tonesDiv.addEventListener('click', (e) => {
      const tb = e.target.closest('.zai-tone'); if (!tb) return;
      tonesDiv.querySelectorAll('.zai-tone').forEach(b => b.classList.remove('active'));
      tb.classList.add('active'); _activeTone = tb.dataset.tone;
    });
    chrome.storage.local.get(['ome_gas_url','ome_current_cs','ome_current_nz'], (res) => {
      GAS_URL = res.ome_gas_url || '';
      if (GAS_URL) { inpGas.value = GAS_URL; loadCSNames_(); loadNickZaloList_(); loadCareStatusTree_(); loadProductCodeMap_(); }
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
      const nzF = document.getElementById('zai-nz-form-sel');
      if (nzF) nzF.value = _currentZaloNick;
    });
    nzAddBtn.addEventListener('click', async () => {
      const nick = (prompt('Nhập nick Zalo mới:') || '').trim();
      if (!nick) return;
      if (GAS_URL) {
        try {
          // Uu tien addZaloNick: server tu MERGE vao danh sach chung -> khong ghi de mat nick cu
          const r = await fetch(GAS_URL, {method:'POST', body:JSON.stringify({action:'addZaloNick', nick}), headers:{'Content-Type':'text/plain'}});
          const d = await r.json();
          if (d && d.error) {
            // GAS cu chua co addZaloNick -> fallback: tai list MOI NHAT tu server, merge roi luu
            await loadNickZaloList_();
            if (!_zaloNickList.includes(nick)) _zaloNickList.push(nick);
            await fetch(GAS_URL, {method:'POST', body:JSON.stringify({action:'setSetting',key:'nickZaloList',value:JSON.stringify(_zaloNickList)}), headers:{'Content-Type':'text/plain'}});
          }
        } catch(e) {}
      }
      await loadNickZaloList_();
      if (!_zaloNickList.includes(nick)) _zaloNickList.push(nick);
      const nzSelEl = document.getElementById('zai-nz-sel');
      if (nzSelEl) nzSelEl.value = nick;
      _currentZaloNick = nick;
      chrome.storage.local.set({ ome_current_nz: nick });
      const nzF = document.getElementById('zai-nz-form-sel');
      if (nzF) nzF.value = nick;
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
    loadCareStatusTree_();
    loadProductCodeMap_();
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
    _lastServerCare  = {};
    updSec.style.display = 'block';
    clearForm_();
  }

  function clearForm_() {
    ['zai-status-sel','zai-zalo-sel','zai-hen-date','zai-hen-note','zai-note-new']
      .forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
    const csSel = document.getElementById('zai-cs-sel');
    if (csSel) csSel.value = _currentCS || '';
    const nzF = document.getElementById('zai-nz-form-sel');
    if (nzF) nzF.value = _currentZaloNick || '';
    const rawEl = document.getElementById('zai-note-raw');
    if (rawEl) rawEl.value = '';
    renderNoteHistory_('');
  }

  // Chi ve lai khung the thong tin (doc, an toan de goi lai khi poll ma khong lam mat du lieu CS dang go)
  function renderCustCard_(area, phone, raw, care, orders) {
    const name   = orders.length ? (orders[0].name||raw) : (care&&care.name||raw);
    const prods  = [...new Set(orders.map(o=>o.product).filter(Boolean))].join(', ');
    const totRev = orders.reduce((s,o)=>s+(parseFloat(o.revenue)||0),0);

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
        ${care&&care.note ? `<div class="zai-card-note">📝 ${escHtml(_latestNoteText_(care.note))}</div>` : ''}
        ${orders.slice(0,3).length ? `<div class="zai-card-orders"><strong>Đơn gần nhất:</strong><br>${
          orders.slice(0,3).map(o => {
            const d = fmtDate_(o.date);
            const rev = o.revenue ? Number(o.revenue).toLocaleString('vi-VN')+'đ' : '';
            const sp = (o.product||'') + (o.productDetail?' — '+o.productDetail:'');
            return `• <b>${d}</b> | ${rev}<br>&nbsp;&nbsp;${escHtml(sp)}`;
          }).join('<br>')
        }</div>` : ''}
      </div>`;
    return name;
  }

  function renderCard_(area, updSec, phone, raw, care, orders) {
    const name = renderCustCard_(area, phone, raw, care, orders);
    _currentCustData = {phone, name, care, orders};
    _lastServerCare  = care || {}; // baseline moi de so sanh khi poll (phat hien CS dang sua field nao)

    updSec.style.display = 'block';
    document.getElementById('zai-status-sel').value = care&&care.status||'';
    document.getElementById('zai-zalo-sel').value   = care&&care.zalo||'';
    // CS chăm sóc: đồng bộ từ server (care.cs), fallback nếu không có từ server thì dùng _currentCS
    document.getElementById('zai-cs-sel').value     = care&&care.cs || _currentCS || '';
    const nzF = document.getElementById('zai-nz-form-sel');
    if (nzF) nzF.value = _currentZaloNick || '';
    document.getElementById('zai-hen-date').value   = care&&care.schedHen ? toInputDate_(care.schedHen) : '';
    document.getElementById('zai-hen-note').value   = care&&care.schedHenNote||'';
    document.getElementById('zai-kh-status-sel').value = care&&care.khStatus||'';
    document.getElementById('zai-birthday').value   = care&&care.birthday||'';
    // Ghi chú CS: đọc dữ liệu (đồng bộ 2 chiều với Sasum, cùng định dạng JSON [{text,user,time}])
    const noteNewEl = document.getElementById('zai-note-new');
    if (noteNewEl) noteNewEl.value = '';
    const rawEl = document.getElementById('zai-note-raw');
    const noteRaw = (care && care.note) || '';
    if (rawEl) rawEl.value = noteRaw;
    renderNoteHistory_(noteRaw);
  }

  // ── ĐỒNG BỘ GẦN-TỨC-THỜI (polling) ──
  // Cu moi POLL_INTERVAL_MS, neu panel dang mo va co khach dang xem, kiem tra GAS
  // xem co ai vua luu thay doi (tu Sasum hoac tu Zalo AI o may khac) khong. Neu co,
  // cap nhat lai the thong tin + cac field CHUA duoc CS tu sua (tranh ghi de luc dang go).
  async function pollCareTick_() {
    if (_pollInFlight) return;
    if (!GAS_URL || !_currentCustData || !_currentCustData.phone) return;
    const panel = document.getElementById('ome-zai-panel');
    if (!panel || !panel.classList.contains('open')) return;
    if (typeof document.visibilityState === 'string' && document.visibilityState !== 'visible') return;
    _pollInFlight = true;
    const phone = _currentCustData.phone;
    try {
      const sep = GAS_URL.includes('?') ? '&' : '?';
      const r = await fetch(GAS_URL + sep + 'action=lookup&phone=' + encodeURIComponent(phone) + '&_ts=' + Date.now(), {redirect:'follow'});
      const d = await r.json();
      if (d.error) return;
      if (!_currentCustData || _currentCustData.phone !== phone) return; // CS da chuyen sang khach khac trong luc cho fetch
      const newCare   = d.care || null;
      const newOrders = (d.orders||[]).slice().sort((a,b) => parseDate_(b.date)-parseDate_(a.date));
      const oldUpdated = _lastServerCare && _lastServerCare.updated;
      const newUpdated = newCare && newCare.updated;
      const changed = (newUpdated || '') !== (oldUpdated || '') || newOrders.length !== (_currentCustData.orders||[]).length;
      if (!changed) return;
      applyPolledCare_(phone, newCare, newOrders);
    } catch(e) { /* im lang, thu lai lan poll sau */ }
    finally { _pollInFlight = false; }
  }

  function applyPolledCare_(phone, newCare, newOrders) {
    const area = document.getElementById('zai-cust-area');
    const raw  = (document.getElementById('zai-phone-input') && document.getElementById('zai-phone-input').value) || phone;
    if (area) renderCustCard_(area, phone, raw, newCare, newOrders);

    const baseline = _lastServerCare || {};
    const c = newCare || {};

    // Field don gian: chi tu dong cap nhat neu CS CHUA sua (gia tri hien tai == baseline cu)
    function syncField(id, key) {
      const el = document.getElementById(id); if (!el) return;
      const baseVal = baseline[key] || '';
      if ((el.value||'') === baseVal) el.value = c[key] || '';
    }
    syncField('zai-status-sel','status');
    syncField('zai-zalo-sel','zalo');
    syncField('zai-kh-status-sel','khStatus');
    syncField('zai-hen-note','schedHenNote');
    syncField('zai-birthday','birthday');
    const henDateEl = document.getElementById('zai-hen-date');
    if (henDateEl) {
      const baseHen = baseline.schedHen ? toInputDate_(baseline.schedHen) : '';
      if ((henDateEl.value||'') === baseHen) henDateEl.value = c.schedHen ? toInputDate_(c.schedHen) : '';
    }

    // Ghi chú: giữ lại các mục CS vừa bấm "+" nhưng CHƯA lưu (pending), rồi ghép với bản mới nhất từ server
    const rawEl = document.getElementById('zai-note-raw');
    if (rawEl) {
      const localArr  = _parseNotes(rawEl.value);
      const baseArr   = _parseNotes(baseline.note || '');
      const serverArr = _parseNotes(c.note || '');
      const baseKeys  = new Set(baseArr.map(n => JSON.stringify(n)));
      const pendingLocal = localArr.filter(n => !baseKeys.has(JSON.stringify(n)));
      const merged = pendingLocal.concat(serverArr);
      rawEl.value = _notesToStr(merged);
      renderNoteHistory_(rawEl.value);
    }

    _currentCustData.care   = c;
    _currentCustData.orders = newOrders;
    _lastServerCare = c;
    _lookupCache[phone] = {care: c, orders: newOrders, ts: Date.now()};
    showMsg('zai-save-status', '🔄 Vừa đồng bộ dữ liệu mới từ Sasum', 2500);
  }

  function startCarePoll_() {
    if (_carePollStarted) return;
    _carePollStarted = true;
    setInterval(pollCareTick_, POLL_INTERVAL_MS);
  }

  // ── SAVE STATUS ──
  async function doSaveStatus() {
    if (!_currentCustData) { showError('Chưa tra cứu khách nào.'); return; }
    if (!GAS_URL) { showError('Chưa cài đặt URL GAS.'); return; }
    const status  = document.getElementById('zai-status-sel').value;
    const zalo    = document.getElementById('zai-zalo-sel').value;
    // CS chăm sóc luôn = CS đang chọn ở thanh trên (mục 1), đồng bộ 2 chiều với Sasum
    const cs      = _currentCS || '';
    const henDate = document.getElementById('zai-hen-date').value;
    const henNote = document.getElementById('zai-hen-note').value.trim();
    const care    = (_currentCustData && _currentCustData.care) || null;
    // Ghi chú CS: dang JSON [{text,user,time}] giong Sasum, da duoc build san qua nut "+"
    const rawEl   = document.getElementById('zai-note-raw');
    const note    = (rawEl ? rawEl.value : '') || (care && care.note) || '';
    const btn    = document.getElementById('zai-save-btn');
    btn.disabled = true; btn.textContent = 'Đang lưu...';
    try {
      const c = care||{};
      const birthday = document.getElementById('zai-birthday') ? document.getElementById('zai-birthday').value : '';
      const row = {
        phone:_currentCustData.phone, status:status||c.status||'',
        zalo:zalo||c.zalo||'', cs:cs||c.cs||'', note,
        schedules:c.schedules||'', schedGoi:c.schedGoi||'', schedGoiNote:c.schedGoiNote||'',
        schedSP:c.schedSP||'', schedSPNote:c.schedSPNote||'',
        schedCS:c.schedCS||'', schedCSNote:c.schedCSNote||'',
        schedHen:henDate||c.schedHen||'', schedHenNote:henNote||c.schedHenNote||'',
        khStatus: document.getElementById('zai-kh-status-sel').value || (c.khStatus||''),
        birthday: birthday || c.birthday || '',
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
        // Cap nhat baseline ngay de lan poll ke tiep khong bao "co ban moi" voi chinh du lieu vua luu
        const savedCare = { ...row, updated: new Date().toISOString() };
        _currentCustData.care = savedCare;
        _lastServerCare = savedCare;
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
    if (care&&care.note) {
      const latest = _latestNoteText_(care.note);
      if (latest) lines.push('Ghi chú: '+latest);
    }
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

  // ── GHI CHÚ CS: luu mang JSON [{text,user,time}], giong het dinh dang Sasum (app web) ──
  function _parseNotes(raw) {
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr; // dinh dang moi
    } catch(e) {}
    // dinh dang cu (text thuan) → wrap thanh 1 muc khong co user/time
    return [{ text: raw, user: '', time: '' }];
  }
  function _notesToStr(arr) { return JSON.stringify(arr); }
  function _latestNoteText_(raw) {
    const arr = _parseNotes(raw);
    return arr.length ? arr[0].text : '';
  }
  function _fmtNoteTime(d) {
    const h  = String(d.getHours()).padStart(2,'0');
    const m  = String(d.getMinutes()).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const yy = d.getFullYear();
    return `${h}:${m} ${dd}/${mm}/${yy}`;
  }
  function renderNoteHistory_(raw) {
    const hist = document.getElementById('zai-note-history');
    if (!hist) return;
    const arr = _parseNotes(raw);
    if (!arr.length) { hist.innerHTML = '<div class="zai-note-empty">Chưa có ghi chú nào</div>'; return; }
    hist.innerHTML = arr.map((n,i) => {
      const meta = [n.user, n.time].filter(Boolean).join(' · ');
      return `<div class="zai-note-entry">
        ${meta ? `<div class="zai-note-meta">${n.user?`<b>${escHtml(n.user)}</b>`:''}${n.time?' '+escHtml(n.time):''}${i===0?' <span class="zai-note-latest">MỚI NHẤT</span>':''}</div>` : ''}
        <div class="zai-note-text">${escHtml(n.text).replace(/\n/g,'<br>')}</div>
        <button class="zai-note-del" data-idx="${i}" title="Xóa ghi chú này">✕</button>
      </div>`;
    }).join('');
    hist.querySelectorAll('.zai-note-del').forEach(b => {
      b.addEventListener('click', () => deleteNoteEntry_(parseInt(b.dataset.idx,10)));
    });
  }
  function addNoteEntry_() {
    const inp = document.getElementById('zai-note-new');
    const text = (inp ? inp.value : '').trim();
    if (!text) {
      if (inp) { inp.style.border = '1px solid #ef4444'; setTimeout(() => { inp.style.border = ''; }, 1200); }
      return;
    }
    const rawEl = document.getElementById('zai-note-raw');
    const arr = _parseNotes(rawEl ? rawEl.value : '');
    const userName = _currentCS || 'CS';
    arr.unshift({ text, user: userName, time: _fmtNoteTime(new Date()) });
    const newRaw = _notesToStr(arr);
    if (rawEl) rawEl.value = newRaw;
    if (inp) inp.value = '';
    renderNoteHistory_(newRaw);
  }
  function deleteNoteEntry_(idx) {
    if (!confirm('Xóa ghi chú này?')) return;
    const rawEl = document.getElementById('zai-note-raw');
    const arr = _parseNotes(rawEl ? rawEl.value : '');
    arr.splice(idx, 1);
    const newRaw = _notesToStr(arr);
    if (rawEl) rawEl.value = newRaw;
    renderNoteHistory_(newRaw);
  }

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
      // Mở KH → tra cứu ngay trong panel Zalo AI (điền SDT + lookup, đồng bộ về Sasum khi lưu)
      const openBtn = document.createElement('button');
      openBtn.textContent = 'Mở KH';
      openBtn.style.cssText = 'background:#3b82f6;color:#fff;border:none;border-radius:3px;padding:2px 6px;cursor:pointer;font-size:10px;flex-shrink:0;';
      openBtn.addEventListener('click', () => {
        const inp = document.getElementById('zai-phone-input');
        if (inp) inp.value = rem.phone;
        doLookup();
        const bodyEl = document.getElementById('zai-body');
        if (bodyEl) bodyEl.scrollTop = 0;
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
      // zai-nz-form-sel gio la input an, luon dong bo theo nick sticky
      const nzF = document.getElementById('zai-nz-form-sel');
      if (nzF) nzF.value = _currentZaloNick || '';
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
        // zai-cs-sel gio la input an, luon dong bo theo CS sticky (khong can dropdown)
      }
    } catch(e) {}
  }

  // ── TINH TRANG CS: load cay dong tu GAS (dong bo voi appweb) ──
  function careStatusOptionsHtml_(tree, selected) {
    let html = '<option value="">— Chọn —</option>';
    (tree || []).forEach(function(node) {
      if (node.children && node.children.length) {
        html += '<optgroup label="' + escHtml(node.label) + '">';
        node.children.forEach(function(child) {
          if (!child.value) return;
          html += '<option value="' + escHtml(child.value) + '"' + (selected === child.value ? ' selected' : '') + '>' +
                  escHtml(node.label + ' - ' + (child.label || child.value)) + '</option>';
        });
        html += '</optgroup>';
      } else if (node.value) {
        html += '<option value="' + escHtml(node.value) + '"' + (selected === node.value ? ' selected' : '') + '>' +
                escHtml(node.label || node.value) + '</option>';
      }
    });
    return html;
  }

  function rebuildStatusSel_() {
    const sel = document.getElementById('zai-status-sel');
    if (!sel || !Array.isArray(CARE_STATUS_TREE) || !CARE_STATUS_TREE.length) return;
    const cur = sel.value;
    sel.innerHTML = careStatusOptionsHtml_(CARE_STATUS_TREE, cur);
    sel.value = cur;
  }

  async function loadCareStatusTree_() {
    if (!GAS_URL) return;
    const sep = GAS_URL.includes('?') ? '&' : '?';
    let tree = null;
    try {
      const r = await fetch(GAS_URL + sep + 'action=getSetting&key=careStatus', {redirect:'follow'});
      const d = await r.json();
      if (d && d.value) { try { tree = typeof d.value === 'string' ? JSON.parse(d.value) : d.value; } catch(e) {} }
    } catch(e) {}
    if (!Array.isArray(tree) || !tree.length) {
      try {
        const r = await fetch(GAS_URL + sep + 'action=customers', {redirect:'follow'});
        const d = await r.json();
        if (d && Array.isArray(d.careStatus) && d.careStatus.length) tree = d.careStatus;
      } catch(e) {}
    }
    if (Array.isArray(tree) && tree.length) {
      CARE_STATUS_TREE = tree;
      rebuildStatusSel_();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  BROADCAST — Gui tin (+anh) hang loat cho danh sach KH, tu dong
  //  mo tung doan chat va gui, KHONG can tay chon tung khach.
  //
  //  ⚠️ LUU Y QUAN TRONG:
  //  - Cac CSS selector de "tim o tim kiem Zalo" va "tim input dinh kem anh"
  //    (SEARCH_SELS / FILE_INPUT_SELS ben duoi) la best-effort, dua tren cau truc
  //    Zalo Web pho bien. Zalo co the doi giao dien theo thoi gian, nen neu
  //    chien dich bao "Không tìm thấy ô tìm kiếm / input đính kèm ảnh", hay
  //    dung DevTools (F12 -> Inspect) tren o do de lay đúng selector va cap nhat
  //    lai trong file nay.
  //  - Nen bat dau voi 1 chien dich NHO (vai khach) de kiem tra chay dung truoc
  //    khi chay danh sach lon.
  //  - Chi nen dung cho khach da la ban Zalo / da co lich su chat, va da dong y
  //    nhan tin CSKH, de tranh bi Zalo danh dau spam.
  // ═══════════════════════════════════════════════════════════════

  function sleep_(ms) { return new Promise(res => setTimeout(res, ms)); }
  function randDelayMs_(minSec, maxSec) { return (minSec + Math.random() * (maxSec - minSec)) * 1000; }

  function bcLog_(msg) {
    const ts = new Date().toLocaleTimeString('vi-VN');
    _bcLog.unshift('[' + ts + '] ' + msg);
    _bcLog = _bcLog.slice(0, 60);
    const el = document.getElementById('zai-bc-log');
    if (el) el.innerHTML = _bcLog.map(l => escHtml(l)).join('<br>');
    console.log('[OME Broadcast] ' + msg);
  }

  async function markBroadcastServer_(id, phone, status) {
    if (!GAS_URL) return;
    try {
      await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'broadcastMark', id, phone, status }),
        redirect: 'follow'
      });
    } catch (e) {}
  }

  async function loadBroadcastQueue_() {
    if (!GAS_URL) return;
    const box = document.getElementById('zai-bc-body');
    if (box && !_bcRunning) box.innerHTML = '<div style="font-size:11px;color:#6b7280">Đang tải...</div>';
    try {
      const sep = GAS_URL.includes('?') ? '&' : '?';
      const r = await fetch(GAS_URL + sep + 'action=broadcastQueue&cs=' + encodeURIComponent(_currentCS || ''), { redirect: 'follow' });
      const d = await r.json();
      _bcQueue = d.broadcasts || [];
      renderBroadcastList_();
    } catch (e) {
      if (box) box.innerHTML = '<div class="zai-error" style="display:block">Lỗi tải danh sách chiến dịch: ' + escHtml(e.message) + '</div>';
    }
  }

  function renderBroadcastList_() {
    const box = document.getElementById('zai-bc-body');
    if (!box) return;
    box.innerHTML = '';

    // Toggle: co kiem tra khop Nick Zalo truoc khi gui khong (tuy chon, de danh cho sau nay khi du lieu Nick dong bo day du)
    const nickRow = document.createElement('label');
    nickRow.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:11px;color:#166534;margin-bottom:8px;cursor:pointer;';
    nickRow.innerHTML = '<input type="checkbox" id="zai-bc-checknick" style="margin:0"> Kiểm tra khớp Nick Zalo trước khi gửi (bật khi đã đồng bộ Nick theo khách)';
    box.appendChild(nickRow);
    const checknickEl = nickRow.querySelector('#zai-bc-checknick');
    checknickEl.checked = _bcCheckNick;
    checknickEl.addEventListener('change', () => { _bcCheckNick = checknickEl.checked; });

    if (!_bcQueue.length) {
      box.innerHTML = '<div style="font-size:11px;color:#6b7280;padding:6px 0">Không có chiến dịch nào đang chờ gửi.</div>';
    } else {
      _bcQueue.forEach(camp => {
        const card = document.createElement('div');
        card.style.cssText = 'background:#fff;border:1px solid #bbf7d0;border-radius:7px;padding:8px 10px;margin-bottom:6px;font-size:12px;';
        card.innerHTML = '<div style="font-weight:700;margin-bottom:3px">' + escHtml(camp.label || camp.id) + '</div>' +
          '<div style="color:#6b7280;font-size:11px;margin-bottom:6px">Còn ' + camp.pendingPhones.length + '/' + camp.total +
          ' khách chưa gửi &middot; ' + (camp.images || []).length + ' ảnh</div>';
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:5px;';
        const startBtn = document.createElement('button');
        startBtn.className = 'zai-btn zai-btn-primary zai-btn-sm';
        startBtn.textContent = '▶ Bắt đầu';
        startBtn.disabled = _bcRunning;
        startBtn.addEventListener('click', () => startBroadcast_(camp));
        btnRow.appendChild(startBtn);
        card.appendChild(btnRow);
        box.appendChild(card);
      });
    }

    // Thanh dieu khien + log — chi hien khi dang chay 1 chien dich
    const ctrl = document.createElement('div');
    ctrl.id = 'zai-bc-ctrl';
    ctrl.style.cssText = 'margin-top:6px;display:' + (_bcRunning ? 'block' : 'none') + ';';
    ctrl.innerHTML =
      '<div style="display:flex;gap:5px;margin-bottom:5px;">' +
        '<button class="zai-btn zai-btn-ghost zai-btn-sm" id="zai-bc-pause">⏸ Tạm dừng</button>' +
        '<button class="zai-btn zai-btn-ghost zai-btn-sm" id="zai-bc-stop">⏹ Dừng hẳn</button>' +
      '</div>' +
      '<div id="zai-bc-status" style="font-size:11px;color:#166534;margin-bottom:4px;"></div>' +
      '<div id="zai-bc-log" style="font-size:10px;color:#6b7280;max-height:120px;overflow-y:auto;background:#f9fafb;border:1px solid #e5e7eb;border-radius:5px;padding:5px;"></div>';
    box.appendChild(ctrl);

    const pb = document.getElementById('zai-bc-pause');
    if (pb) pb.addEventListener('click', () => {
      _bcPaused = !_bcPaused;
      pb.textContent = _bcPaused ? '▶ Tiếp tục' : '⏸ Tạm dừng';
      bcLog_(_bcPaused ? 'Đã tạm dừng.' : 'Tiếp tục gửi.');
    });
    const sb = document.getElementById('zai-bc-stop');
    if (sb) sb.addEventListener('click', () => {
      _bcStopFlag = true;
      bcLog_('Đã yêu cầu dừng hẳn — sẽ dừng sau khi xử lý xong khách hiện tại.');
    });
  }

  // Tim va mo doan chat cua 1 SDT bang cach go vao o tim kiem cua Zalo
  async function openZaloChatByPhone_(phone) {
    const SEARCH_SELS = [
      'input[placeholder*="Tìm kiếm"]',
      'input[placeholder*="Tìm"]',
      '[class*="search-box"] input',
      '[class*="search"] input[type="text"]',
      'input[class*="search"]',
    ];
    let searchEl = null;
    for (const sel of SEARCH_SELS) {
      try { const el = document.querySelector(sel); if (el) { searchEl = el; break; } } catch (e) {}
    }
    if (!searchEl) { bcLog_('❌ Không tìm thấy ô tìm kiếm Zalo cho: ' + phone); return false; }

    searchEl.focus();
    try {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(searchEl, phone);
    } catch (e) { searchEl.value = phone; }
    searchEl.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep_(1000);

    const RESULT_SELS = [
      '[class*="search-result"] [class*="item"]',
      '[class*="searchResult"] [class*="item"]',
      '[class*="result-list"] [class*="item"]',
      '[class*="contact-item"]',
      '[class*="result"] [class*="item"]',
    ];
    let target = null;
    for (const sel of RESULT_SELS) {
      try {
        const items = [...document.querySelectorAll(sel)];
        target = items.find(it => (it.textContent || '').includes(phone));
        if (target) break;
      } catch (e) {}
    }
    if (!target) { bcLog_('❌ Không tìm thấy khách trong kết quả tìm kiếm: ' + phone); return false; }

    target.click();
    await sleep_(1200);

    for (let i = 0; i < 8; i++) {
      const name = getCurrentChatName();
      if (name && extractPhone(name) === phone) return true;
      await sleep_(400);
    }
    bcLog_('⚠️ Đã mở chat nhưng chưa xác nhận khớp đúng khách: ' + phone + ' (vẫn thử gửi)');
    return true;
  }

  function findZaloComposeInput_() {
    const INPUT_SELS = [
      '[class*="chat-input"] [contenteditable]',
      '[class*="message-input"] [contenteditable]',
      '[class*="input-box"] [contenteditable]',
      '[class*="input-area"] [contenteditable]',
      '[class*="editor"] [contenteditable]',
      '[contenteditable="true"]',
    ];
    for (const sel of INPUT_SELS) {
      try {
        const els = [...document.querySelectorAll(sel)];
        const el = els.find(e => { const r = e.getBoundingClientRect(); return r.height > 20 && r.height < 300 && r.width > 100; });
        if (el) return el;
      } catch (e) {}
    }
    return null;
  }

  function insertZaloText_(inputEl, text) {
    if (!text || !text.trim()) return;
    inputEl.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(inputEl);
    sel.removeAllRanges(); sel.addRange(range);
    document.execCommand('delete', false);
    document.execCommand('insertText', false, text);
    inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
  }

  async function fetchAsFile_(url, filename) {
    const res = await fetch(url);
    const blob = await res.blob();
    return new File([blob], filename, { type: blob.type || 'image/jpeg' });
  }

  // Gan anh vao input file an cua Zalo bang DataTransfer (khong the set input.files truc tiep)
  async function attachZaloImages_(imageUrls) {
    const FILE_INPUT_SELS = [
      'input[type="file"][accept*="image"]',
      'input[type="file"]',
    ];
    let fileInput = null;
    for (const sel of FILE_INPUT_SELS) {
      try { const el = document.querySelector(sel); if (el) { fileInput = el; break; } } catch (e) {}
    }
    if (!fileInput) { bcLog_('❌ Không tìm thấy input đính kèm ảnh của Zalo'); return false; }

    const files = [];
    for (let i = 0; i < imageUrls.length; i++) {
      try { files.push(await fetchAsFile_(imageUrls[i], 'img_' + i + '.jpg')); }
      catch (e) { bcLog_('⚠️ Lỗi tải ảnh ' + (i + 1) + ': ' + e.message); }
    }
    if (!files.length) return false;

    try {
      const dt = new DataTransfer();
      files.forEach(f => dt.items.add(f));
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep_(1200);
      return true;
    } catch (e) {
      bcLog_('❌ Lỗi gắn ảnh: ' + e.message);
      return false;
    }
  }

  function clickZaloSendOrEnter_(inputEl) {
    const SEND_SELS = ['button[class*="send"]', '[class*="btn-send"]', '[class*="sendBtn"]', '[class*="send-btn"]', '[class*="icon-send"]'];
    for (const s of SEND_SELS) {
      try { const b = document.querySelector(s); if (b) { b.click(); return true; } } catch (e) {}
    }
    if (inputEl) {
      inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      inputEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      return true;
    }
    return false;
  }

  // ── TU DONG CAP NHAT TINH TRANG KET BAN ZALO VE SASUM ──
  // Quy uoc doc tu giao dien chat dang mo:
  //  - Co nut/banner "Gửi kết bạn" / "Gửi yêu cầu kết bạn"  -> Chưa kết bạn
  //  - Co "Đã gửi lời mời/yêu cầu" / "Hủy yêu cầu" / "Thu hồi" -> Chưa đồng ý (da gui, cho chap nhan)
  //  - Ten khach co chu CTN -> Chặn (da ket ban nhung chan tin nhan)
  //  - Ten khach co chu NHD -> Zalo ngừng hd (tai khoan ngung hoat dong)
  //  - Khong thay gi -> Đã kết bạn
  function detectZaloFriendStatus_() {
    const name = getCurrentChatName() || '';
    if (/\bNHD\b/i.test(name)) return 'Zalo ngừng hd';
    if (/\bCTN\b/i.test(name)) return 'Chặn';
    let sawSend = false, sawPending = false;
    try {
      const els = document.querySelectorAll('button, a, span, div');
      for (const el of els) {
        if (el.children && el.children.length > 0) continue;
        const t = (el.textContent || '').trim();
        if (!t || t.length > 70) continue;
        const tl = t.toLowerCase();
        if (/hủy yêu cầu|đã gửi (lời mời|yêu cầu)|thu hồi lời mời/.test(tl)) { sawPending = true; break; }
        if (/^gửi kết bạn$|gửi yêu cầu kết bạn/.test(tl)) sawSend = true;
      }
    } catch (e) {}
    if (sawPending) return 'Chưa đồng ý';
    if (sawSend) return 'Chưa kết bạn';
    return 'Đã kết bạn';
  }

  // Cap nhat len Sasum (chi ghi khi khac gia tri hien tai -> khach da update roi thi tu bo qua)
  async function autoUpdateZaloStatus_(phone) {
    if (!GAS_URL || !phone) return;
    try {
      const st = detectZaloFriendStatus_();
      const sep = GAS_URL.includes('?') ? '&' : '?';
      const r = await fetch(GAS_URL + sep + 'action=lookup&phone=' + encodeURIComponent(phone), { redirect: 'follow' });
      const d = await r.json();
      const care = (d && d.care) || null;
      if (care && (care.zalo || '') === st) return; // da dung trang thai nay roi -> bo qua
      const row = Object.assign({}, care || { phone: phone, cs: _currentCS || '' });
      row.phone = phone;
      row.zalo = st;
      await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'saveSingle', row }), headers: { 'Content-Type': 'text/plain' } });
      bcLog_('🔗 Cập nhật Zalo "' + st + '" → Sasum: ' + phone);
    } catch (e) {}
  }

  async function startBroadcast_(camp) {
    if (_bcRunning) { bcLog_('Đang có chiến dịch chạy, vui lòng dừng trước khi bắt đầu chiến dịch khác.'); return; }

    // Kiem tra khop Nick Zalo (chi khi nguoi dung bat tuy chon nay)
    if (_bcCheckNick) {
      if (camp.expectedNick) {
        if (_currentZaloNick !== camp.expectedNick) {
          alert('⚠️ Nick Zalo đang dùng ("' + (_currentZaloNick || '(chưa chọn)') +
            '") KHÔNG khớp với Nick phụ trách của chiến dịch "' + (camp.label || camp.id) + '" ("' + camp.expectedNick +
            '"). Vui lòng chuyển đúng Nick Zalo (ở thanh 💬 Nick phía trên) rồi thử lại.');
          return;
        }
      } else {
        if (!window.confirm('Chiến dịch "' + (camp.label || camp.id) + '" chưa có dữ liệu Nick Zalo để so khớp (chưa đồng bộ). Vẫn tiếp tục gửi?')) return;
      }
    }

    const confirmMsg = 'Sẽ TỰ ĐỘNG gửi tin + ' + (camp.images || []).length + ' ảnh cho ' +
      camp.pendingPhones.length + ' khách trong chiến dịch "' + (camp.label || camp.id) +
      '".\n\nExtension sẽ tự mở từng đoạn chat và gửi, có nghỉ giữa các khách để tránh bị Zalo hạn chế. ' +
      'Bạn có thể Tạm dừng / Dừng hẳn bất cứ lúc nào.\n\nTiếp tục?';
    if (!window.confirm(confirmMsg)) return;

    _bcRunning = true; _bcPaused = false; _bcStopFlag = false;
    _bcLog = [];
    renderBroadcastList_();
    bcLog_('Bắt đầu chiến dịch "' + (camp.label || camp.id) + '" — ' + camp.pendingPhones.length + ' khách.');

    let sentCount = 0, failCount = 0, skipCount = 0;
    const total = camp.pendingPhones.length;

    for (let idx = 0; idx < camp.pendingPhones.length; idx++) {
      if (_bcStopFlag) break;
      while (_bcPaused && !_bcStopFlag) { await sleep_(1000); }
      if (_bcStopFlag) break;

      const phone = camp.pendingPhones[idx];
      const statusEl = document.getElementById('zai-bc-status');
      if (statusEl) statusEl.textContent = 'Đang gửi ' + (idx + 1) + '/' + total + ' — ' + phone;

      // Dinh tuyen theo Nick Zalo: neu khach da co du lieu nick ket ban (tu CareData.nickZalos)
      // va nick dang dung KHONG nam trong do -> bo qua NHUNG KHONG danh dau len server,
      // de CS mo dung nick van gui duoc cho khach nay.
      const custNicks = (camp.perPhoneNick && camp.perPhoneNick[phone]) || [];
      if (_currentZaloNick && Array.isArray(custNicks) && custNicks.length && !custNicks.includes(_currentZaloNick)) {
        skipCount++;
        bcLog_('⏭ Bỏ qua (khách kết bạn nick khác: ' + custNicks.join(', ') + '): ' + phone);
        continue;
      }

      try {
        const opened = await openZaloChatByPhone_(phone);
        if (!opened) {
          // KHONG danh dau len server — co the khach la ban cua nick khac,
          // CS mo dung nick se van thay khach nay trong hang doi.
          skipCount++;
          bcLog_('⏭ Bỏ qua (không mở được chat — có thể chưa kết bạn nick này): ' + phone);
        } else {
          await sleep_(600);
          // Tu dong doc tinh trang ket ban tu giao dien chat -> update ve Sasum (khong chan luong gui)
          autoUpdateZaloStatus_(phone).catch(() => {});
          const inputEl = findZaloComposeInput_();
          if (!inputEl) {
            failCount++;
            bcLog_('❌ Không tìm thấy ô soạn tin cho: ' + phone + ' (sẽ thử lại ở lần chạy sau)');
          } else {
            if (camp.images && camp.images.length) await attachZaloImages_(camp.images);
            const personalMsg = (camp.perPhoneMsg && camp.perPhoneMsg[phone]) ? camp.perPhoneMsg[phone] : (camp.message || '');
            insertZaloText_(inputEl, personalMsg);
            await sleep_(400);
            clickZaloSendOrEnter_(inputEl);
            sentCount++;
            await markBroadcastServer_(camp.id, phone, 'sent');
            bcLog_('✅ Đã gửi: ' + phone);
          }
        }
      } catch (e) {
        failCount++;
        bcLog_('❌ Lỗi với ' + phone + ': ' + e.message + ' (sẽ thử lại ở lần chạy sau)');
      }

      if (_bcStopFlag) break;

      const doneSoFar = sentCount + failCount + skipCount;
      if (doneSoFar > 0 && doneSoFar % _bcBatchPauseEvery === 0 && idx < camp.pendingPhones.length - 1) {
        bcLog_('⏳ Nghỉ ' + _bcBatchPauseMin + ' phút sau ' + _bcBatchPauseEvery + ' tin để tránh bị Zalo hạn chế...');
        await sleep_(_bcBatchPauseMin * 60 * 1000);
      } else if (idx < camp.pendingPhones.length - 1) {
        await sleep_(randDelayMs_(_bcDelayMinSec, _bcDelayMaxSec));
      }
    }

    _bcRunning = false;
    const statusEl = document.getElementById('zai-bc-status');
    const summary = 'Hoàn tất: ' + sentCount + ' đã gửi, ' + failCount + ' lỗi, ' + skipCount + ' bỏ qua.';
    if (statusEl) statusEl.textContent = summary;
    bcLog_('🏁 ' + summary);
    await loadBroadcastQueue_();
  }

  // ═══════════════════════════════════════════════════════════════
  //  QUET DANH BA ZALO — du phong khi khach chua co don hang trong Sasum.
  //  Doc cac ten hien thi (do CS tu dat khi ket ban) theo cu phap:
  //    "<ngày>+<tháng> <mã sp> <Tên khách>, <SĐT>"  (VD: 6+7 hh Nguyễn Văn A, 0901234567)
  //  Ma san pham dung chung voi backend (PRODUCT_CODE_MAP_ trong gas_v13.js).
  //  CHI la du phong — KH da co don hang that trong OrderData luon duoc uu tien.
  // ═══════════════════════════════════════════════════════════════
  const ZALO_PRODUCT_MAP_ = [
    ['HH',  ['hh', 'healthouse']],
    ['CF',  ['cf', 'cafe']],
    ['M9',  ['m9', 'make9']],
    ['LV',  ['lv', 'louisviel']],
    ['TEA', ['tea', 'tb', 'tra', 'trà']],
    ['VIK', ['vik', 'vikim', 'vi kim', 'fractional']],
    ['EVE', ['eve', 'every']],
    ['RS',  ['rs', 'reason']],
    ['DA',  ['da', 'dear', 'dearglam']]
  ];
  function zaloProductCode_(token) {
    const t = (token || '').toLowerCase();
    const m = _productCodeMap || ZALO_PRODUCT_MAP_;
    for (const [code, kws] of m) if (kws.includes(t)) return code;
    return '';
  }

  // Tai bang ma san pham dong tu sheet "Mã Zalo" (qua GAS) - de sua/them ma san pham
  // chi can sua trong Sheet, khong can sua code. Neu tai loi thi tu dong dung
  // ZALO_PRODUCT_MAP_ (bang cung) da khai bao san o tren.
  async function loadProductCodeMap_() {
    if (!GAS_URL) return;
    try {
      const sep = GAS_URL.includes('?') ? '&' : '?';
      const r = await fetch(GAS_URL + sep + 'action=productCodeMap', { redirect: 'follow' });
      const d = await r.json();
      if (Array.isArray(d.map) && d.map.length) _productCodeMap = d.map;
    } catch (e) { /* giu nguyen bang cung neu tai loi */ }
  }

  // Quet toan bo text hien dang render tren trang (leaf element) tim ten khop cu phap.
  // Best-effort — khong phu thuoc class cu the cua danh ba Zalo (de tranh gay khi Zalo doi DOM),
  // ket qua luon duoc CS xem lai truoc khi dong bo, khong tu dong gui gi ca.
  function scanZaloContactNames_() {
    const RE = /(\d{1,2})[+\-\/](\d{1,2})\s+([A-Za-zÀ-ỹ]+)\s+(.+?)[,]?\s*(0[3-9]\d{8})\b/;
    const seen = new Set();
    const results = [];
    const all = document.querySelectorAll('body *');
    for (const el of all) {
      if (el.children && el.children.length > 0) continue; // chi lay leaf de tranh trung text lap cua the cha
      const text = (el.textContent || '').trim();
      if (!text || text.length > 120) continue;
      const m = text.match(RE);
      if (!m) continue;
      const phone = normPhone(m[5]);
      if (!phone || seen.has(phone)) continue;
      const day = parseInt(m[1], 10), month = parseInt(m[2], 10);
      if (day < 1 || day > 31 || month < 1 || month > 12) continue;
      seen.add(phone);
      let year = new Date().getFullYear();
      let guess = new Date(year, month - 1, day);
      if (guess.getTime() > Date.now()) guess = new Date(year - 1, month - 1, day);
      results.push({
        phone, rawName: text, nameGuess: m[4].trim(),
        orderDateGuess: guess.toISOString().slice(0, 10),
        productCodeGuess: zaloProductCode_(m[3])
      });
    }
    return results;
  }

  function renderZsPreview_(rows) {
    const box = document.getElementById('zai-zs-preview');
    if (!box) return;
    if (!rows.length) { box.innerHTML = '<div style="font-size:11px;color:#6b7280">Không tìm thấy tên nào khớp cú pháp trên màn hình hiện tại. Thử cuộn/mở danh bạ rồi quét lại.</div>'; return; }
    box.innerHTML =
      '<div style="font-size:11px;color:#166534;margin-bottom:5px">Tìm thấy ' + rows.length + ' khách — bỏ chọn dòng nào không đúng rồi bấm Đồng bộ:</div>' +
      '<div style="max-height:180px;overflow-y:auto;border:1px solid #e5e7eb;border-radius:6px;background:#fff;">' +
      rows.map((r, i) =>
        '<label style="display:flex;gap:6px;align-items:flex-start;padding:5px 8px;font-size:11px;border-bottom:1px solid #f3f4f6;cursor:pointer;">' +
          '<input type="checkbox" class="zai-zs-chk" data-i="' + i + '" checked style="margin-top:2px">' +
          '<span>' + escHtml(r.nameGuess || r.phone) + ' — <b>' + escHtml(r.phone) + '</b><br>' +
          '<span style="color:#6b7280">' + escHtml(r.orderDateGuess) + (r.productCodeGuess ? ' · ' + escHtml(r.productCodeGuess) : ' · (chưa nhận diện SP)') + '</span></span>' +
        '</label>'
      ).join('') +
      '</div>' +
      '<button class="zai-btn zai-btn-primary zai-btn-sm" id="zai-zs-sync-btn" style="margin-top:6px;width:100%">☁ Đồng bộ các dòng đã chọn lên GSheet</button>' +
      '<div id="zai-zs-sync-status" style="font-size:11px;color:#00b14f;margin-top:4px"></div>';
    document.getElementById('zai-zs-sync-btn').addEventListener('click', () => syncZsRows_(rows));
  }

  async function syncZsRows_(rows) {
    if (!GAS_URL) { showError('Chưa cài đặt URL GAS.'); return; }
    const checks = [...document.querySelectorAll('.zai-zs-chk')].filter(c => c.checked);
    const selected = checks.map(c => rows[parseInt(c.dataset.i, 10)]).map(r => ({ ...r, scannedBy: _currentCS || '' }));
    if (!selected.length) { showMsg('zai-zs-sync-status', 'Chưa chọn dòng nào.', 2500); return; }
    const btn = document.getElementById('zai-zs-sync-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Đang đồng bộ...'; }
    try {
      const res = await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'saveZaloScan', rows: selected }),
        redirect: 'follow'
      });
      const d = await res.json();
      if (d.ok) showMsg('zai-zs-sync-status', '✓ Đã đồng bộ ' + d.count + ' khách lên GSheet', 4000);
      else showMsg('zai-zs-sync-status', 'Lỗi: ' + (d.error || 'không rõ'), 4000);
    } catch (e) {
      showMsg('zai-zs-sync-status', 'Lỗi kết nối: ' + e.message, 4000);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '☁ Đồng bộ các dòng đã chọn lên GSheet'; }
    }
  }

  function init() { buildPanel(); watchZaloChat(); startCarePoll_(); }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
  else init();
})();
