const sheetUrlInput = document.getElementById('sheet-url');
const ragUrlInput   = document.getElementById('rag-url');
const saveBtn       = document.getElementById('save-btn');
const statusEl      = document.getElementById('status');
const aiBadge       = document.getElementById('ai-status-badge');
const aiText        = document.getElementById('ai-status-text');
const checkBtn      = document.getElementById('check-ai-btn');

// Load saved settings
chrome.storage.local.get(['zai_sheet_url','zai_rag_url'], (r) => {
  if (r.zai_sheet_url) sheetUrlInput.value = r.zai_sheet_url;
  if (r.zai_rag_url)   ragUrlInput.value   = r.zai_rag_url;
  if (r.zai_sheet_url || r.zai_rag_url) showStatus('✓ Đã có cài đặt', false);
});

// Check Gemini Nano availability
// LƯU Ý: Chrome đã đổi tên trạng thái API. Bản cũ (window.ai.languageModel) dùng
// 'readily' / 'after-download' / 'no'. Bản mới (global LanguageModel, Chrome 131+)
// dùng 'available' / 'downloadable' / 'downloading' / 'unavailable'.
// Code cũ chỉ check tên cũ nên báo "chưa bật" dù máy đã sẵn sàng -> đây là lý do
// extension báo không kết nối được.
async function checkChromeAI() {
  aiBadge.classList.remove('error');
  aiText.textContent = 'Đang kiểm tra Gemini Nano...';

  try {
    const lm = (typeof LanguageModel !== 'undefined' && LanguageModel)
      || window.ai?.languageModel
      || null;

    if (!lm) throw new Error('not_found');

    const raw = await (lm.availability?.() ?? lm.capabilities?.());
    const status = typeof raw === 'string' ? raw : raw?.available;

    const READY       = ['readily', 'available'];
    const DOWNLOADING = ['after-download', 'downloadable', 'downloading'];

    if (READY.includes(status)) {
      aiBadge.classList.remove('error');
      aiText.textContent = '✓ Gemini Nano sẵn sàng — không cần API Key!';
    } else if (DOWNLOADING.includes(status)) {
      aiBadge.classList.remove('error');
      aiText.innerHTML = '⬇️ Gemini Nano đang tải về... Đợi xong rồi dùng được.';
    } else {
      throw new Error('unavailable');
    }
  } catch (e) {
    aiBadge.classList.add('error');
    if (e.message === 'not_found' || e.message === 'unavailable') {
      aiText.innerHTML = '⚠️ Chrome AI chưa bật. Xem hướng dẫn bên dưới để kích hoạt.';
    } else {
      aiText.innerHTML = '⚠️ Lỗi kiểm tra: ' + e.message;
    }
  }
}

checkChromeAI();
checkBtn.addEventListener('click', checkChromeAI);

// Notify content scripts to re-check
chrome.tabs.query({ url: 'https://chat.zalo.me/*' }, (tabs) => {
  tabs.forEach(tab => chrome.tabs.sendMessage(tab.id, { type: 'CHECK_AI' }).catch(() => {}));
});

saveBtn.addEventListener('click', () => {
  const url = sheetUrlInput.value.trim();
  let ragUrl = ragUrlInput.value.trim().replace(/\/+$/, '');

  if (url && !url.startsWith('https://script.google.com')) {
    showStatus('Sheet URL không hợp lệ', true); return;
  }
  if (ragUrl && !ragUrl.startsWith('https://')) {
    showStatus('Server tài liệu phải bắt đầu bằng https://', true); return;
  }

  chrome.storage.local.set({ zai_sheet_url: url, zai_rag_url: ragUrl }, () => {
    showStatus('✓ Đã lưu thành công!', false);
    chrome.tabs.query({ url: 'https://chat.zalo.me/*' }, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { type: 'SHEET_URL_UPDATED', url }).catch(() => {});
        chrome.tabs.sendMessage(tab.id, { type: 'RAG_URL_UPDATED', url: ragUrl }).catch(() => {});
      });
    });
  });
});

function showStatus(msg, isError) {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (isError ? ' error' : '');
}
