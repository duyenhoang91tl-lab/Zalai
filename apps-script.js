// ============================================================
// ZALO AI — Google Apps Script API
// Paste toàn bộ code này vào Apps Script của Google Sheet
// Extensions > Apps Script > xóa code cũ > paste > Save > Deploy
// ============================================================

// CẤU HÌNH — chỉnh theo cột thực tế trong Sheet của bạn
const CONFIG = {
  SHEET_NAME: 'Sheet1',   // Tên sheet (tab dưới cùng)
  COL_NAME:   1,          // Cột A = tên khách
  COL_PHONE:  2,          // Cột B = số điện thoại
  COL_DATE:   3,          // Cột C = ngày mua
  COL_PRODUCT:4,          // Cột D = sản phẩm đã mua
  COL_NOTE:   5,          // Cột E = ghi chú cá nhân
  COL_SEGMENT:6,          // Cột F = phân loại khách (VIP, thường, mới...)
  HEADER_ROWS: 1,         // Số hàng tiêu đề (bỏ qua khi đọc)
};

// ── Xử lý GET request ──────────────────────────────────────
function doGet(e) {
  const action = e.parameter.action || 'search';
  const query  = (e.parameter.q || '').trim().toLowerCase();

  try {
    let result;
    if (action === 'search') result = searchCustomers(query);
    else if (action === 'all') result = getAllCustomers();
    else if (action === 'segments') result = getSegments();
    else result = { error: 'Unknown action' };

    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

// ── Tìm kiếm khách theo tên hoặc SĐT ──────────────────────
function searchCustomers(query) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(CONFIG.SHEET_NAME);
  const data  = sheet.getDataRange().getValues();

  const results = [];
  for (let i = CONFIG.HEADER_ROWS; i < data.length; i++) {
    const row     = data[i];
    const name    = String(row[CONFIG.COL_NAME  - 1] || '').toLowerCase();
    const phone   = String(row[CONFIG.COL_PHONE - 1] || '').replace(/\s/g, '');
    const note    = String(row[CONFIG.COL_NOTE  - 1] || '');
    const product = String(row[CONFIG.COL_PRODUCT-1] || '');
    const date    = row[CONFIG.COL_DATE - 1];
    const segment = String(row[CONFIG.COL_SEGMENT-1] || '');

    const queryClean = query.replace(/\s/g, '');
    if (
      name.includes(query) ||
      phone.includes(queryClean) ||
      note.toLowerCase().includes(query)
    ) {
      results.push({
        row:     i + 1,
        name:    row[CONFIG.COL_NAME   - 1] || '',
        phone:   row[CONFIG.COL_PHONE  - 1] || '',
        date:    date ? Utilities.formatDate(new Date(date), 'Asia/Ho_Chi_Minh', 'dd/MM/yyyy') : '',
        product: product,
        note:    note,
        segment: segment,
      });
    }

    if (results.length >= 20) break; // Giới hạn 20 kết quả
  }

  return { customers: results, total: results.length, query };
}

// ── Lấy tất cả (giới hạn 200) ─────────────────────────────
function getAllCustomers() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(CONFIG.SHEET_NAME);
  const data  = sheet.getDataRange().getValues();
  const results = [];

  for (let i = CONFIG.HEADER_ROWS; i < Math.min(data.length, 201); i++) {
    const row  = data[i];
    const date = row[CONFIG.COL_DATE - 1];
    results.push({
      row:     i + 1,
      name:    row[CONFIG.COL_NAME   - 1] || '',
      phone:   row[CONFIG.COL_PHONE  - 1] || '',
      date:    date ? Utilities.formatDate(new Date(date), 'Asia/Ho_Chi_Minh', 'dd/MM/yyyy') : '',
      product: row[CONFIG.COL_PRODUCT- 1] || '',
      note:    row[CONFIG.COL_NOTE   - 1] || '',
      segment: row[CONFIG.COL_SEGMENT- 1] || '',
    });
  }

  return { customers: results, total: results.length };
}

// ── Lấy danh sách phân loại ───────────────────────────────
function getSegments() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(CONFIG.SHEET_NAME);
  const data  = sheet.getDataRange().getValues();
  const segs  = new Set();

  for (let i = CONFIG.HEADER_ROWS; i < data.length; i++) {
    const seg = String(data[i][CONFIG.COL_SEGMENT - 1] || '').trim();
    if (seg) segs.add(seg);
  }

  return { segments: [...segs] };
}

// ── Helper ────────────────────────────────────────────────
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
