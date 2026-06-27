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
    toggle.onclick = () => togglePanel();
    document.body.appendChild(toggle);

    const panel = document.createElement('div');
    panel.id = 'ome-zai-panel';
    panel.innerHTML = `
      <div class="zai-hdr">
        <div>
          <div class="zai-hdr-title">🤖 OME Zalo AI</div>
          <div class="zai-hdr-sub">Tra cứu & gợi ý phản hồi khách</div>
        </div>
        <button class="zai-cfg-btn" id="zai-cfg-toggle" title="Cài đặt">⚙</button>
      </div>

      <!-- Config -->
      <div class="zai-cfg" id="zai-cfg" style="display:none">
        <label>URL Web App GAS (appweb teamduyen)</label>
        <input id="zai-gas-url" placeholder="https://script.google.com/macros/s/..." type="text">

        <label>🔑 Gemini API Key (lưu 1 lần dùng chung cả team)</label>
        <input id="zai-gemini-key" placeholder="AIzaSy... (lấy miễn phí tại aistudio.google.com)" type="text">

        <button class="zai-cfg-save" id="zai-cfg-save">💾 Lưu cài đặt</button>
        <div class="zai-cfg-hint">Key Gemini được lưu vào Google Sheets, dùng chung cho cả team. Chỉ cần nhập 1 lần.</div>
      </div>

      <!-- Body -->
      <div class="zai-body" id="zai-body">
        <div>
          <div class="zai-section-label">Số điện thoại khách</div>
          <div class="zai-phone-row">
            <input id="zai-phone-input" placeholder="0901234567" type="tel">
            <button class="zai-btn zai-btn-primary zai-btn-sm" onclick="window._zaiLookup()">Tra cứu</button>
          </div>
          <div style="font-size:10px;color:#9ca3af;margin-top:3px" id="zai-auto-hint"></div>
        </div>

        <div id="zai-cust-area"></div>

        <div class="zai-update-section" id="zai-update-section" style="display:none">
          <div class="zai-section-label" style="margin-bottom:6px">📋 Cập nhật tình trạng CS</div>
          <label>Tình trạng</label>
          <select id="zai-status-sel">
            <option value="">— Chọn —</option>
            ${CARE_STATUSES.map(s => `<option value="${s}">${s}</option>`).join('')}
          </select>
          <label>Ghi chú</label>
          <textarea id="zai-note-ta" placeholder="Ghi chú thêm..." rows="2"></textarea>
          <div class="zai-save-row">
            <button class="zai-btn zai-btn-primary zai-btn-sm" id="zai-save-btn" onclick="window._zaiSaveStatus()">💾 Lưu về GSheet</button>
            <span class="zai-save-status" id="zai-save-status"></span>
          </div>
        </div>

        <hr class="zai-div">

        <div>
          <div class="zai-section-label">Tin nhắn khách (copy từ Zalo)</div>
          <textarea class="zai-msg-area" id="zai-msg" placeholder="Dán tin nhắn của khách vào đây..."></textarea>
          <div style="margin-top:5px;font-size:11px;color:#6b7280">Ngữ cảnh / Sản phẩm (tuỳ chọn)</div>
          <input class="zai-ctx-input" id="zai-ctx" placeholder="VD: Đang tư vấn kem dưỡng, khách hỏi về giá...">
          <div class="zai-tones" style="margin-top:8px">
            <button class="zai-tone active" data-tone="Thân thiện" onclick="window._zaiTone(this)">Thân thiện</button>
            <button class="zai-tone" data-tone="Chuyên nghiệp" onclick="window._zaiTone(this)">Chuyên nghiệp</button>
            <button class="zai-tone" data-tone="Ngắn gọn" onclick="window._zaiTone(this)">Ngắn gọn</button>
            <button class="zai-tone" data-tone="Nhiệt tình" onclick="window._zaiTone(this)">Nhiệt tình</button>
          </div>
          <button class="zai-btn zai-btn-primary" id="zai-gen-btn" onclick="window._zaiGenerate()" style="width:100%;margin-top:8px">✨ Tạo gợi ý AI</button>
        </div>

        <div id="zai-sug-area"></div>
        <div class="zai-error" id="zai-error" style="display:none"></div>
      </div>
    `;
    document.body.appendChild(panel);

    document.getElementById('zai-cfg-toggle').onclick = () => {
      _cfgVisible = !_cfgVisible;
      document.getElementById('zai-cfg').style.display = _cfgVisible ? 'block' : 'none';
    };

    document.getElementById('zai-cfg-save').onclick = saveConfig;

    chrome.storage.local.get(['ome_gas_url'], (res) => {
      GAS_URL = res.ome_gas_url || '';
      if (GAS_URL) document.getElementById('zai-gas-url').value = GAS_URL;
      if (!GAS_URL) {
        _cfgVisible = true;
        document.getElementById('zai-cfg').style.display = 'block';
      }
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
    GAS_URL = document.getElementById('zai-gas-url').value.trim();
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
          showMsg('zai-save-status', '✓ Đã lưu Gemini Key lên GSheet!', 3000);
          if (keyEl) keyEl.value = '';
        } else {
          showError('Lỗi lưu key: ' + JSON.stringify(d));
          return;
        }
      } catch (e) {
        showError('Lỗi kết nối GAS: ' + e.message);
        return;
      }
    }

    _cfgVisible = false;
    document.getElementById('zai-cfg').style.display = 'none';
    _cache = { customers: null, orders: null, fetchedAt: 0 };
    if (!geminiKey) showMsg('zai-save-status', '✓ Đã lưu cài đặt', 2000);
  }

  // ── AUTO-DETECT PHONE ──
  function extractPhone(text) {
    if (!text) return null;
    const m = text.match(/(?:^|\D)(0[3-9]\d{8})(?:\D|$)/);
    return m ? m[1] : null;
  }

  function watchZaloChat() {
    const observer = new MutationObserver(() => {
      const nameEl = document.querySelector(
        '[class*="chat-header"] [class*="name"], [class*="conversation-header"] [class*="name"], ' +
        '[class*="title-chat"] span, [class*="header-chat"] [class*="title"]'
      );
      if (!nameEl) return;
      const name = nameEl.textContent || '';
      const phone = extractPhone(name);
      if (phone && phone !== _currentPhone) {
        _currentPhone = phone;
        const inp = document.getElementById('zai-phone-input');
        if (inp) {
          inp.value = phone;
          const hint = document.getElementById('zai-auto-hint');
          if (hint) hint.textContent = '✓ Tự động phát hiện: ' + name.trim();
          window._zaiLookup();
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
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
  window._zaiLookup = async function () {
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
        area.innerHTML = `<div class="zai-not-found">Không tìm thấy <strong>${raw}</strong>.<br><small>Thử Sync GS trên app trước.</small></div>`;
        return;
      }

      const name     = orders.length ? (orders[0].name || raw) : raw;
      const products = [...new Set(orders.map(o => o.product).filter(Boolean))].join(', ');
      const totalRev = orders.reduce((s, o) => s + (parseFloat(o.revenue) || 0), 0);
      _currentCustData = { phone, name, care, orders };

      area.innerHTML = `
        <div class="zai-card">
          <div class="zai-card-name">${escHtml(name)} <span style="font-size:11px;font-weight:400;color:#9ca3af">${raw}</span></div>
          <div class="zai-chips">
            ${orders.length ? `<span class="zai-chip">📦 ${orders.length} đơn</span>` : ''}
            ${totalRev ? `<span class="zai-chip">💰 ${Math.round(totalRev / 1000)}K</span>` : ''}
            ${products ? `<span class="zai-chip">🏷 ${escHtml(products)}</span>` : ''}
            ${care && care.status ? `<span class="zai-chip">📋 ${escHtml(care.status)}</span>` : ''}
            ${care && care.cs ? `<span class="zai-chip">👤 CS: ${escHtml(care.cs)}</span>` : ''}
          </div>
          ${care && care.note ? `<div class="zai-card-note">📝 ${escHtml(care.note)}</div>` : ''}
          ${orders.slice(0, 3).length ? `
            <div class="zai-card-orders"><strong>Đơn gần nhất:</strong><br>
              ${orders.slice(0, 3).map(o => {
                const d = o.date ? new Date(o.date).toLocaleDateString('vi-VN') : '?';
                return `• ${d} — ${escHtml(o.product || o.productDetail || '?')}${o.revenue ? ' (' + Number(o.revenue).toLocaleString('vi-VN') + 'đ)' : ''}`;
              }).join('<br>')}
            </div>` : ''}
        </div>`;

      updateSec.style.display = 'block';
      if (care && care.status) document.getElementById('zai-status-sel').value = care.status;
      if (care && care.note)   document.getElementById('zai-note-ta').value    = care.note;
    } catch (e) {
      area.innerHTML = '';
      showError(e.message);
    }
  };

  // ── SAVE STATUS ──
  window._zaiSaveStatus = async function () {
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
        schedules: care.schedules || '', schedGoi: care.schedGoi || '',
        schedGoiNote: care.schedGoiNote || '', schedSP: care.schedSP || '',
        schedSPNote: care.schedSPNote || '', schedCS: care.schedCS || '',
        schedCSNote: care.schedCSNote || '', schedHen: care.schedHen || '',
        schedHenNote: care.schedHenNote || ''
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
      } else {
        showError('Lỗi: ' + JSON.stringify(d));
      }
    } catch (e) {
      showError('Lỗi kết nối: ' + e.message);
    } finally {
      btn.disabled = false; btn.textContent = '💾 Lưu về GSheet';
    }
  };

  // ── AI GENERATE ──
  window._zaiGenerate = async function () {
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
      custLines.push('Tên khách: ' + name, 'SĐT: ' + phone);
      if (orders && orders.length) custLines.push('Số đơn đã mua: ' + orders.length);
      const prods = [...new Set((orders || []).map(o => o.product).filter(Boolean))].join(', ');
      if (prods) custLines.push('Sản phẩm đã mua: ' + prods);
      if (care && care.status) custLines.push('Tình trạng CS: ' + care.status);
      if (care && care.note)   custLines.push('Ghi chú CS: ' + care.note);
      const last = (orders || []).slice(0, 2).map(o =>
        `${o.date ? new Date(o.date).toLocaleDateString('vi-VN') : ''} ${o.product || ''} ${o.revenue ? '(' + Number(o.revenue).toLocaleString('vi-VN') + 'đ)' : ''}`.trim()
      ).join(', ');
      if (last) custLines.push('Đơn gần nhất: ' + last);
    }
    if (ctx) custLines.push('Ngữ cảnh bổ sung: ' + ctx);

    const prompt = `Bạn là nhân viên chăm sóc khách hàng chuyên nghiệp của shop bán lẻ Việt Nam.\n` +
      (custLines.length ? 'Thông tin khách hàng:\n' + custLines.join('\n') + '\n\n' : '') +
      `Tin nhắn khách gửi: "${msg}"\n\n` +
      `Hãy viết 3 phiên bản phản hồi cho khách, giọng văn ${_activeTone.toLowerCase()}, bằng tiếng Việt tự nhiên, phù hợp nhắn qua Zalo.\n` +
      `Mỗi phiên bản trên 1 dòng riêng, bắt đầu bằng "1.", "2.", "3.". Không giải thích thêm.`;

    try {
      const res = await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'ai', prompt }),
        headers: { 'Content-Type': 'text/plain' }
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'GAS trả về lỗi');

      const text = data.text || '';
      const sugs = text.split(/\n(?=\d+\.)/).map(s => s.replace(/^\d+\.\s*/, '').trim()).filter(Boolean);
      if (!sugs.length) sugs.push(text.trim());

      sugArea.innerHTML = `
        <div class="zai-section-label">💡 Gợi ý phản hồi (click để copy)</div>
        ${sugs.map((s, i) => `
          <div class="zai-sug" onclick="window._zaiCopy(this,'${encodeURIComponent(s)}')">
            <div class="zai-sug-num">Phương án ${i + 1}</div>
            <div>${escHtml(s).replace(/\n/g, '<br>')}</div>
            <span class="zai-copy-badge">Copy</span>
          </div>`).join('')}`;
    } catch (e) {
      sugArea.innerHTML = '';
      showError('Lỗi: ' + e.message);
    } finally {
      btn.disabled = false; btn.textContent = '✨ Tạo gợi ý AI';
    }
  };

  window._zaiCopy = function (el, encoded) {
    navigator.clipboard.writeText(decodeURIComponent(encoded)).then(() => {
      const badge = el.querySelector('.zai-copy-badge');
      if (badge) { badge.textContent = '✓ Đã copy!'; badge.classList.add('zai-copied'); }
      setTimeout(() => { if (badge) { badge.textContent = 'Copy'; badge.classList.remove('zai-copied'); } }, 1500);
    });
  };

  window._zaiTone = function (btn) {
    document.querySelectorAll('.zai-tone').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    _activeTone = btn.dataset.tone;
  };

  function showError(msg) {
    const el = document.getElementById('zai-error');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
  }
  function hideError() {
    const el = document.getElementById('zai-error');
    if (el) el.style.display = 'none';
  }
  function showMsg(id, msg, ms) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    if (ms) setTimeout(() => { el.textContent = ''; }, ms);
  }
  function escHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function init() { buildPanel(); watchZaloChat(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
