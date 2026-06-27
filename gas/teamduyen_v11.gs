// ═══════════════════════════════════════════════════════════════
//  OME CS Portal — Google Apps Script v11.0
//  MOI v11.0: Them action=lookup (server-side search theo phone, co CacheService)
//             Them normPhone_ de xu ly so dien thoai GSheet luu thieu so 0
//             CacheService cho action=customers va action=lookup (TTL 5 phut)
//             Invalidate cache sau khi saveSingleCare_
//  MOI v10.3: AIContext mo rong: callback_script, sales_script_cu, sales_script_moi, faq
//  MOI v10.1: Them action=ai -> goi Groq API qua GAS (API key luu trong Settings)
//  MOI v10.0: OrderData tach thanh nhieu sheet theo nam
//  Type: Web app | Execute as: Me | Who has access: Anyone
//  LUU Y: moi lan sua code phai Deploy lai (New deployment hoac Deploy version moi)
// ═══════════════════════════════════════════════════════════════

var SH_CARE   = 'CareData';
var SH_TEAM   = 'Teams';
var SH_AUDIT  = 'AuditLog';
var SH_SET    = 'Settings';
var SH_ASSIGN = 'AssignData';
var SH_USER   = 'Users';

var ORDER_SS_ID = '1JVIFMIUgKdfTG1FEMDGoYjQ3Qll2ChkbSHHTjgieLPs';

function getOrderSS_() {
  return ORDER_SS_ID
    ? SpreadsheetApp.openById(ORDER_SS_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

var ORDER_SHEETS = [
  { name: 'OrderData21_22', years: [21, 22, 2021, 2022] },
  { name: 'OrderData23',    years: [23, 2023] },
  { name: 'OrderData24',    years: [24, 2024] },
  { name: 'OrderData25',    years: [25, 2025] },
  { name: 'OrderData26',    years: [26, 2026] }
];
var SH_ORDER_DEFAULT = 'OrderData26';

var CARE_HEADERS  = ['phone','status','zalo','cs','note','schedules',
  'schedGoi','schedGoiNote','schedSP','schedSPNote',
  'schedCS','schedCSNote','schedHen','schedHenNote','updated'];
var ORDER_HEADERS = ['phone','name','date','year','month','cs','source','revenue',
  'product','productDetail','status','zalo','note','careCS'];
var TEAM_HEADERS  = ['id','name','leader','members','color'];
var AUDIT_HEADERS = ['timestamp','user','action','phone','oldValue','newValue'];
var SET_HEADERS   = ['key','value'];
var ASSIGN_HEADERS= ['id','date','csName','label','phones','donePhones'];
var USER_HEADERS  = ['username','passHash','role','name','team','active'];

// ---- helpers ----
function getSheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); }
  if (sh.getLastRow() === 0 && headers) { sh.appendRow(headers); }
  return sh;
}
function getOrderSheet_(name) {
  var ss = getOrderSS_();
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(ORDER_HEADERS); }
  return sh;
}
function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
function getOrderSheetName_(year) {
  var y = Number(year);
  for (var i = 0; i < ORDER_SHEETS.length; i++) {
    if (ORDER_SHEETS[i].years.indexOf(y) !== -1) return ORDER_SHEETS[i].name;
  }
  return SH_ORDER_DEFAULT;
}

// ── PHONE NORMALIZATION (xu ly GSheet luu so nguyen, mat so 0 dau) ──
function normPhone_(p) {
  if (!p) return '';
  var s = String(p).replace(/[^0-9]/g, '');
  if (s.length === 11 && s.indexOf('84') === 0) s = '0' + s.substring(2);
  if (s.length === 9 && /^[3-9]/.test(s)) s = '0' + s;
  return s;
}

// ── TIM KIEM THEO PHONE (dung cho action=lookup) ──
function findCareByPhone_(phone) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SH_CARE);
  if (!sh || sh.getLastRow() < 2) return null;
  var ph = normPhone_(phone);
  var vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    if (!vals[i][0]) continue;
    if (normPhone_(vals[i][0]) === ph) {
      return {
        phone: vals[i][0], status: vals[i][1]||'', zalo: vals[i][2]||'', cs: vals[i][3]||'',
        note: vals[i][4]||'', schedules: vals[i][5]||'',
        schedGoi: vals[i][6]||'', schedGoiNote: vals[i][7]||'',
        schedSP: vals[i][8]||'', schedSPNote: vals[i][9]||'',
        schedCS: vals[i][10]||'', schedCSNote: vals[i][11]||'',
        schedHen: vals[i][12]||'', schedHenNote: vals[i][13]||'', updated: vals[i][14]||''
      };
    }
  }
  return null;
}

function readOrdersByPhone_(phone) {
  var ss = getOrderSS_();
  var ph = normPhone_(phone);
  var out = [];
  // Doc tu sheet moi nhat (26) ve cu (21_22) de ket qua sort dung
  for (var i = ORDER_SHEETS.length - 1; i >= 0; i--) {
    var sh = ss.getSheetByName(ORDER_SHEETS[i].name);
    if (!sh || sh.getLastRow() < 2) continue;
    var vals = sh.getDataRange().getValues();
    for (var j = 1; j < vals.length; j++) {
      if (!vals[j][0]) continue;
      if (normPhone_(vals[j][0]) !== ph) continue;
      out.push({
        phone: vals[j][0], name: vals[j][1]||'', date: vals[j][2]||'', year: vals[j][3]||'',
        month: vals[j][4]||'', cs: vals[j][5]||'', source: vals[j][6]||'', revenue: vals[j][7]||0,
        product: vals[j][8]||'', productDetail: vals[j][9]||'', status: vals[j][10]||'',
        zalo: vals[j][11]||'', note: vals[j][12]||'', careCS: vals[j][13]||''
      });
    }
  }
  return out;
}

function readAllOrders_() {
  var ss = getOrderSS_();
  var out = [];
  for (var i = 0; i < ORDER_SHEETS.length; i++) {
    var sh = ss.getSheetByName(ORDER_SHEETS[i].name);
    if (sh) out = out.concat(readOrders_(sh));
  }
  return out;
}

function readCare_(sh) {
  var out = [];
  if (!sh || sh.getLastRow() < 2) return out;
  var vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    if (!vals[i][0]) continue;
    out.push({
      phone: vals[i][0], status: vals[i][1]||'', zalo: vals[i][2]||'', cs: vals[i][3]||'',
      note: vals[i][4]||'', schedules: vals[i][5]||'',
      schedGoi: vals[i][6]||'', schedGoiNote: vals[i][7]||'',
      schedSP: vals[i][8]||'', schedSPNote: vals[i][9]||'',
      schedCS: vals[i][10]||'', schedCSNote: vals[i][11]||'',
      schedHen: vals[i][12]||'', schedHenNote: vals[i][13]||'', updated: vals[i][14]||''
    });
  }
  return out;
}

function readOrders_(sh) {
  var out = [];
  if (!sh || sh.getLastRow() < 2) return out;
  var ov = sh.getDataRange().getValues();
  for (var j = 1; j < ov.length; j++) {
    if (!ov[j][0]) continue;
    out.push({
      phone: ov[j][0], name: ov[j][1]||'', date: ov[j][2]||'', year: ov[j][3]||'',
      month: ov[j][4]||'', cs: ov[j][5]||'', source: ov[j][6]||'', revenue: ov[j][7]||0,
      product: ov[j][8]||'', productDetail: ov[j][9]||'', status: ov[j][10]||'',
      zalo: ov[j][11]||'', note: ov[j][12]||'', careCS: ov[j][13]||''
    });
  }
  return out;
}

function readTeams_(sh) {
  var out = [];
  if (!sh || sh.getLastRow() < 2) return out;
  var v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) {
    if (!v[i][0] && !v[i][1]) continue;
    var members = [];
    try { members = v[i][3] ? JSON.parse(v[i][3]) : []; } catch (e) { members = (''+v[i][3]).split(',').filter(String); }
    out.push({ id: v[i][0], name: v[i][1]||'', leader: v[i][2]||'', members: members, color: v[i][4]||'' });
  }
  return out;
}

function readUsers_(sh) {
  var out = [];
  if (!sh || sh.getLastRow() < 2) return out;
  var v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) {
    if (!v[i][0]) continue;
    out.push({
      username: String(v[i][0]), passHash: String(v[i][1]||''), role: v[i][2]||'cs',
      name: v[i][3]||'', team: v[i][4]||'', active: (v[i][5]===''||v[i][5]===undefined) ? true : (v[i][5]===true || v[i][5]==='TRUE' || v[i][5]==='true' || v[i][5]===1)
    });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════
//  doGet
// ═══════════════════════════════════════════════════════════════
function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : '';

    // ── MOI: lookup theo phone (toi uu, co cache) ──
    if (action === 'lookup') {
      var phone = (e && e.parameter && e.parameter.phone) ? String(e.parameter.phone) : '';
      if (!phone) return jsonOut_({ error: 'Thieu phone' });
      var cache = CacheService.getScriptCache();
      var cacheKey = 'lk_' + normPhone_(phone);
      var cached = cache.get(cacheKey);
      if (cached) {
        try { return jsonOut_(JSON.parse(cached)); } catch(ec) {}
      }
      var result = {
        ok: true,
        care: findCareByPhone_(phone),
        orders: readOrdersByPhone_(phone)
      };
      try { cache.put(cacheKey, JSON.stringify(result), 300); } catch(ec) {}
      return jsonOut_(result);
    }

    if (action === 'customers') {
      var cache2 = CacheService.getScriptCache();
      var cached2 = cache2.get('customers_v11');
      if (cached2) {
        try { return jsonOut_(JSON.parse(cached2)); } catch(ec) {}
      }
      var result2 = { rows: readCare_(ss.getSheetByName(SH_CARE)), careStatus: readCareStatus_(ss) };
      try { cache2.put('customers_v11', JSON.stringify(result2), 300); } catch(ec) {}
      return jsonOut_(result2);
    }
    if (action === 'orders') {
      return jsonOut_({ orders: readAllOrders_() });
    }
    if (action === 'teams') {
      return jsonOut_({ teams: readTeams_(ss.getSheetByName(SH_TEAM)) });
    }
    if (action === 'users') {
      return jsonOut_({ users: readUsers_(ss.getSheetByName(SH_USER)) });
    }
    if (action === 'audit') {
      var sh = ss.getSheetByName(SH_AUDIT);
      var rows = [];
      if (sh && sh.getLastRow() > 1) {
        var last = sh.getLastRow();
        var n = Math.min(200, last - 1);
        var v = sh.getRange(last - n + 1, 1, n, 6).getValues();
        for (var i = v.length - 1; i >= 0; i--) {
          rows.push({ timestamp: v[i][0], user: v[i][1], action: v[i][2], phone: v[i][3], oldValue: v[i][4], newValue: v[i][5] });
        }
      }
      return jsonOut_({ audit: rows });
    }
    if (action === 'dashboard') {
      return jsonOut_(buildDashboard_());
    }
    if (action === 'assign') {
      return jsonOut_({ assignHistory: readAssign_(ss.getSheetByName(SH_ASSIGN)) });
    }
    if (action === 'count') {
      var shc = ss.getSheetByName(SH_CARE);
      var totalOrders = 0;
      for (var si = 0; si < ORDER_SHEETS.length; si++) {
        var sho = getOrderSS_().getSheetByName(ORDER_SHEETS[si].name);
        if (sho) totalOrders += Math.max(0, sho.getLastRow() - 1);
      }
      return jsonOut_({
        orderRows: totalOrders,
        careRows:  shc ? Math.max(0, shc.getLastRow() - 1) : 0,
        ver: 'v11.0'
      });
    }

    // default — backward compatible
    var result3 = { rows: readCare_(ss.getSheetByName(SH_CARE)), orders: [] };
    if (!(e && e.parameter && e.parameter.noOrders)) {
      result3.orders = readAllOrders_();
    }
    result3.careStatus = readCareStatus_(ss);
    return jsonOut_(result3);
  } catch (err) {
    return jsonOut_({ error: err.message });
  }
}

function buildDashboard_() {
  var care   = readCare_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH_CARE));
  var orders = readAllOrders_();
  var phones = {}, revenue = 0, friend = 0;
  for (var i = 0; i < care.length; i++) {
    if (care[i].zalo === 'Da ket ban' || care[i].zalo === 'Đã kết bạn') friend++;
  }
  for (var j = 0; j < orders.length; j++) {
    phones[orders[j].phone] = true;
    revenue += Number(orders[j].revenue) || 0;
  }
  return { totalCustomers: Object.keys(phones).length, totalOrders: orders.length, totalRevenue: revenue, careRows: care.length, zaloFriends: friend };
}

// ═══════════════════════════════════════════════════════════════
//  doPost
// ═══════════════════════════════════════════════════════════════
function doPost(e) {
  if (!e || !e.postData) return;
  try {
    var data   = JSON.parse(e.postData.contents);
    var action = data.action;
    if (action === 'save')               return saveAllCare_(data.rows);
    if (action === 'saveSingle')          return saveSingleCare_(data.row);
    if (action === 'saveBatch')           return saveBatchCare_(data.rows);
    if (action === 'saveOrders')          return saveOrders_(data.orders);
    if (action === 'patchOrder')          return patchOrder_(data);
    if (action === 'replaceOrders')       return replaceOrders_(data.orders, data);
    if (action === 'setOrderCareCS')      return setOrderCareCS_(data.phone, data.careCS);
    if (action === 'setOrderCareCSBatch') return setOrderCareCSBatch_(data.updates);
    if (action === 'saveTeams')           return saveTeams_(data.teams);
    if (action === 'saveUsers')           return saveUsers_(data.users);
    if (action === 'saveAudit')           return saveAudit_(data.rows);
    if (action === 'setSetting')          return setSetting_(data.key, data.value);
    if (action === 'saveAssign')          return saveAssignEntry_(data.entry);
    if (action === 'saveAssignHistory')   return saveAssignHistory_(data.history);
    if (action === 'saveCareStatus')      return saveCareStatus_(data.careStatus);
    if (action === 'saveAIContext')       return saveAIContext_(data.type, data.content, data.context);
    if (action === 'ai')                  return callGeminiAI_(data);
    return jsonOut_({ error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonOut_({ error: err.message });
  }
}

function saveAllCare_(rows) {
  var sh = getSheet_(SH_CARE, CARE_HEADERS);
  sh.clearContents();
  var matrix = [CARE_HEADERS];
  for (var i = 0; i < rows.length; i++) matrix.push(careRow_(rows[i]));
  sh.getRange(1, 1, matrix.length, CARE_HEADERS.length).setValues(matrix);
  // Xoa cache
  try { CacheService.getScriptCache().remove('customers_v11'); } catch(ec) {}
  return jsonOut_({ ok: true, written: rows.length });
}

function saveSingleCare_(r) {
  var sh = getSheet_(SH_CARE, CARE_HEADERS);
  var last = sh.getLastRow();
  var rowIdx = -1;
  if (last >= 2) {
    var finder = sh.getRange(2, 1, last - 1, 1).createTextFinder(String(r.phone)).matchEntireCell(true);
    var cell = finder.findNext();
    if (cell) rowIdx = cell.getRow();
  }
  if (rowIdx > 0) sh.getRange(rowIdx, 1, 1, CARE_HEADERS.length).setValues([careRow_(r)]);
  else sh.appendRow(careRow_(r));
  // Invalidate cache
  try {
    var cache = CacheService.getScriptCache();
    cache.remove('customers_v11');
    cache.remove('lk_' + normPhone_(String(r.phone)));
  } catch(ec) {}
  return jsonOut_({ ok: true, found: rowIdx > 0 });
}

function saveBatchCare_(rows) {
  var sh = getSheet_(SH_CARE, CARE_HEADERS);
  var data = sh.getDataRange().getValues();
  var index = {};
  for (var i = 1; i < data.length; i++) { if (data[i][0]) index[String(data[i][0])] = i; }
  var appended = 0, updated = 0;
  for (var k = 0; k < rows.length; k++) {
    var r = rows[k]; var key = String(r.phone); var rowArr = careRow_(r);
    if (index[key] !== undefined) { data[index[key]] = rowArr; updated++; }
    else { data.push(rowArr); index[key] = data.length - 1; appended++; }
  }
  sh.getRange(1, 1, data.length, CARE_HEADERS.length).setValues(data);
  try { CacheService.getScriptCache().remove('customers_v11'); } catch(ec) {}
  return jsonOut_({ ok: true, updated: updated, appended: appended });
}

function careRow_(r) {
  return [r.phone||'', r.status||'', r.zalo||'', r.cs||'', r.note||'', r.schedules||'',
    r.schedGoi||'', r.schedGoiNote||'', r.schedSP||'', r.schedSPNote||'',
    r.schedCS||'', r.schedCSNote||'', r.schedHen||'', r.schedHenNote||'', new Date().toISOString()];
}

function saveOrders_(orders) {
  if (!orders || !orders.length) return jsonOut_({ ok: true, written: 0, skipped: 0 });
  var ss = getOrderSS_();
  var groups = {};
  for (var k = 0; k < orders.length; k++) {
    var o = orders[k];
    var shName = getOrderSheetName_(o.year);
    if (!groups[shName]) groups[shName] = [];
    groups[shName].push(o);
  }
  var totalWritten = 0, totalSkipped = 0;
  for (var shName in groups) {
    var sh = getOrderSheet_(shName);
    var existing = sh.getDataRange().getValues();
    var keys = {};
    for (var i = 1; i < existing.length; i++) {
      if (!existing[i][0]) continue;
      keys[existing[i][0]+'|'+existing[i][3]+'|'+existing[i][4]+'|'+existing[i][7]] = true;
    }
    var toAppend = [];
    var grp = groups[shName];
    for (var j = 0; j < grp.length; j++) {
      var ord = grp[j];
      var key = (ord.phone||'')+'|'+(ord.year||'')+'|'+(ord.month||'')+'|'+(ord.revenue||0);
      if (keys[key]) { totalSkipped++; continue; }
      keys[key] = true;
      toAppend.push([ord.phone||'', ord.name||'', ord.date||'', ord.year||'', ord.month||'',
        ord.cs||'', ord.source||'', ord.revenue||0, ord.product||'', ord.productDetail||'',
        ord.status||'', ord.zalo||'', ord.note||'', ord.careCS||'']);
    }
    if (toAppend.length) {
      sh.getRange(sh.getLastRow()+1, 1, toAppend.length, ORDER_HEADERS.length).setValues(toAppend);
      totalWritten += toAppend.length;
    }
  }
  return jsonOut_({ ok: true, written: totalWritten, skipped: totalSkipped });
}

function patchOrder_(data) {
  var ss = getOrderSS_();
  var shName = getOrderSheetName_(data.oldYear);
  var sheetsToSearch = [shName];
  for (var si = 0; si < ORDER_SHEETS.length; si++) {
    if (ORDER_SHEETS[si].name !== shName) sheetsToSearch.push(ORDER_SHEETS[si].name);
  }
  for (var si2 = 0; si2 < sheetsToSearch.length; si2++) {
    var sh = ss.getSheetByName(sheetsToSearch[si2]);
    if (!sh || sh.getLastRow() < 2) continue;
    var vals = sh.getDataRange().getValues();
    for (var i = 1; i < vals.length; i++) {
      var r = vals[i];
      if (String(r[0]) !== String(data.phone))      continue;
      if (String(r[3]) !== String(data.oldYear))    continue;
      if (String(r[4]) !== String(data.oldMonth))   continue;
      if (Number(r[7]) !== Number(data.oldRevenue)) continue;
      if (data.newDate    !== undefined) sh.getRange(i+1, 3).setValue(data.newDate);
      if (data.newYear    !== undefined) sh.getRange(i+1, 4).setValue(data.newYear);
      if (data.newMonth   !== undefined) sh.getRange(i+1, 5).setValue(data.newMonth);
      if (data.newRevenue !== undefined) sh.getRange(i+1, 8).setValue(data.newRevenue);
      if (data.newProduct)               sh.getRange(i+1, 9).setValue(data.newProduct);
      if (data.newDetail)                sh.getRange(i+1,10).setValue(data.newDetail);
      // Xoa cache lookup cho phone nay
      try { CacheService.getScriptCache().remove('lk_' + normPhone_(String(data.phone))); } catch(ec) {}
      return jsonOut_({ ok: true, updated: true });
    }
  }
  var newShName = getOrderSheetName_(data.newYear || data.oldYear);
  var newSh = getOrderSheet_(newShName);
  newSh.appendRow([data.phone||'', '', data.newDate||'', data.newYear||data.oldYear||'',
    data.newMonth||data.oldMonth||'', '', '', data.newRevenue||0,
    data.newProduct||'', data.newDetail||'', '', '', '', '']);
  return jsonOut_({ ok: true, updated: false, appended: true });
}

function replaceOrders_(orders, data) {
  orders = orders || [];
  var allowEmpty = data && data.allowEmpty === true;
  var force      = data && data.force === true;
  var ss = getOrderSS_();
  var prev = 0;
  for (var si = 0; si < ORDER_SHEETS.length; si++) {
    var sh0 = ss.getSheetByName(ORDER_SHEETS[si].name);
    if (sh0) prev += Math.max(0, sh0.getLastRow() - 1);
  }
  if (orders.length === 0 && !allowEmpty) {
    return jsonOut_({ error: 'TU_CHOI: Du lieu rong. Gui kem allowEmpty=true neu muon xoa sach.', prev: prev });
  }
  if (orders.length > 0 && prev > 50 && orders.length < prev * 0.4 && !force) {
    return jsonOut_({ warn: true, needForce: true, prev: prev, incoming: orders.length,
      error: 'CANH_BAO: Du lieu moi ('+orders.length+') it hon 40% du lieu cu ('+prev+'). Gui lai voi force=true.' });
  }
  var groups = {};
  for (var si2 = 0; si2 < ORDER_SHEETS.length; si2++) groups[ORDER_SHEETS[si2].name] = [];
  for (var k = 0; k < orders.length; k++) {
    var o = orders[k];
    var shName = getOrderSheetName_(o.year);
    if (!groups[shName]) groups[shName] = [];
    groups[shName].push(o);
  }
  var totalWritten = 0;
  for (var shName in groups) {
    var sh = getOrderSheet_(shName);
    sh.clearContents();
    sh.getRange(1, 1, 1, ORDER_HEADERS.length).setValues([ORDER_HEADERS]);
    var grp = groups[shName];
    var CHUNK = 50000, rowPtr = 2;
    for (var start = 0; start < grp.length; start += CHUNK) {
      var end = Math.min(start + CHUNK, grp.length);
      var matrix = [];
      for (var j = start; j < end; j++) {
        var ord = grp[j];
        matrix.push([ord.phone||'', ord.name||'', ord.date||'', ord.year||'', ord.month||'',
          ord.cs||'', ord.source||'', ord.revenue||0, ord.product||'', ord.productDetail||'',
          ord.status||'', ord.zalo||'', ord.note||'', ord.careCS||'']);
      }
      if (matrix.length) { sh.getRange(rowPtr, 1, matrix.length, ORDER_HEADERS.length).setValues(matrix); rowPtr += matrix.length; }
      SpreadsheetApp.flush();
    }
    totalWritten += grp.length;
  }
  return jsonOut_({ ok: true, mode: 'replace', prev: prev, written: totalWritten });
}

function setOrderCareCS_(phone, careCS) {
  if (!phone) return jsonOut_({ error: 'thieu phone' });
  var ss = getOrderSS_();
  var totalUpdated = 0;
  for (var si = 0; si < ORDER_SHEETS.length; si++) {
    var sh = ss.getSheetByName(ORDER_SHEETS[si].name);
    if (!sh || sh.getLastRow() < 2) continue;
    var last = sh.getLastRow();
    var finder = sh.getRange(2, 1, last-1, 1).createTextFinder(String(phone)).matchEntireCell(true);
    var found = finder.findAll();
    for (var i = 0; i < found.length; i++) { sh.getRange(found[i].getRow(), ORDER_HEADERS.length).setValue(careCS||''); }
    totalUpdated += found.length;
  }
  return jsonOut_({ ok: true, updated: totalUpdated });
}

function setOrderCareCSBatch_(updates) {
  updates = updates || [];
  if (!updates.length) return jsonOut_({ ok: true, updated: 0 });
  var map = {};
  for (var u = 0; u < updates.length; u++) { if (updates[u] && updates[u].phone != null) map[String(updates[u].phone)] = (updates[u].careCS||''); }
  var ss = getOrderSS_();
  var changed = 0;
  for (var si = 0; si < ORDER_SHEETS.length; si++) {
    var sh = ss.getSheetByName(ORDER_SHEETS[si].name);
    if (!sh || sh.getLastRow() < 2) continue;
    var last = sh.getLastRow();
    var col = ORDER_HEADERS.length;
    var phones  = sh.getRange(2, 1, last-1, 1).getValues();
    var careCol = sh.getRange(2, col, last-1, 1).getValues();
    for (var r = 0; r < phones.length; r++) {
      var ph = String(phones[r][0]);
      if (ph && map.hasOwnProperty(ph)) { careCol[r][0] = map[ph]; changed++; }
    }
    sh.getRange(2, col, last-1, 1).setValues(careCol);
  }
  return jsonOut_({ ok: true, updated: changed });
}

function saveTeams_(teams) {
  var sh = getSheet_(SH_TEAM, TEAM_HEADERS);
  sh.clearContents();
  var matrix = [TEAM_HEADERS];
  for (var i = 0; i < teams.length; i++) {
    var t = teams[i];
    matrix.push([t.id||'', t.name||'', t.leader||'', JSON.stringify(t.members||[]), t.color||'']);
  }
  sh.getRange(1, 1, matrix.length, TEAM_HEADERS.length).setValues(matrix);
  return jsonOut_({ ok: true, written: teams.length });
}

function saveUsers_(users) {
  users = users || [];
  var adminCount = 0;
  for (var a = 0; a < users.length; a++) { if (users[a] && users[a].role === 'admin') adminCount++; }
  if (users.length > 0 && adminCount === 0) return jsonOut_({ error: 'TU_CHOI: Phai con it nhat 1 tai khoan Admin.' });
  var sh = getSheet_(SH_USER, USER_HEADERS);
  sh.clearContents();
  var matrix = [USER_HEADERS];
  for (var i = 0; i < users.length; i++) {
    var u = users[i];
    matrix.push([String(u.username||''), String(u.passHash||''), u.role||'cs', u.name||'', u.team||'', (u.active===false?false:true)]);
  }
  sh.getRange(1, 1, matrix.length, USER_HEADERS.length).setValues(matrix);
  return jsonOut_({ ok: true, written: users.length });
}

function saveAudit_(rows) {
  var sh = getSheet_(SH_AUDIT, AUDIT_HEADERS);
  if (!rows || !rows.length) return jsonOut_({ ok: true, written: 0 });
  var matrix = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    matrix.push([r.timestamp||new Date().toISOString(), r.user||'', r.action||'', r.phone||'', r.oldValue||'', r.newValue||'']);
  }
  sh.getRange(sh.getLastRow()+1, 1, matrix.length, AUDIT_HEADERS.length).setValues(matrix);
  return jsonOut_({ ok: true, written: matrix.length });
}

function setSetting_(key, value) {
  var sh = getSheet_(SH_SET, SET_HEADERS);
  var last = sh.getLastRow(); var rowIdx = -1;
  if (last >= 2) {
    var finder = sh.getRange(2, 1, last-1, 1).createTextFinder(String(key)).matchEntireCell(true);
    var cell = finder.findNext();
    if (cell) rowIdx = cell.getRow();
  }
  if (rowIdx > 0) sh.getRange(rowIdx, 2).setValue(value);
  else sh.appendRow([key, value]);
  return jsonOut_({ ok: true });
}

function saveCareStatus_(list) {
  if (!Array.isArray(list)) return jsonOut_({ error: 'careStatus phai la mang.' });
  return setSetting_('careStatus', JSON.stringify(list));
}

function readCareStatus_(ss) {
  var sh = ss.getSheetByName(SH_SET);
  if (!sh || sh.getLastRow() < 2) return null;
  var vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    if (vals[i][0] === 'careStatus') { try { return JSON.parse(vals[i][1]); } catch(e) { return null; } }
  }
  return null;
}

function readAssign_(sh) {
  var out = [];
  if (!sh || sh.getLastRow() < 2) return out;
  var vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    if (!vals[i][0]) continue;
    var phones = [], donePhones = [];
    try { phones = JSON.parse(vals[i][4]||'[]'); } catch(e) { phones = []; }
    try { donePhones = JSON.parse(vals[i][5]||'[]'); } catch(e) { donePhones = []; }
    out.push({ id: String(vals[i][0]), date: String(vals[i][1]||''), csName: String(vals[i][2]||''), label: String(vals[i][3]||''), phones: phones, donePhones: donePhones });
  }
  return out;
}

function saveAssignEntry_(entry) {
  if (!entry || !entry.id) return jsonOut_({ error: 'no entry.id' });
  var sh = getSheet_(SH_ASSIGN, ASSIGN_HEADERS);
  var last = sh.getLastRow(); var rowIdx = -1;
  if (last >= 2) {
    var finder = sh.getRange(2, 1, last-1, 1).createTextFinder(String(entry.id)).matchEntireCell(true);
    var cell = finder.findNext();
    if (cell) rowIdx = cell.getRow();
  }
  var row = [entry.id||'', entry.date||'', entry.csName||'', entry.label||'', JSON.stringify(entry.phones||[]), JSON.stringify(entry.donePhones||[])];
  if (rowIdx > 0) sh.getRange(rowIdx, 1, 1, ASSIGN_HEADERS.length).setValues([row]);
  else sh.appendRow(row);
  return jsonOut_({ ok: true });
}

function saveAssignHistory_(history) {
  if (!history) return jsonOut_({ error: 'no history' });
  var sh = getSheet_(SH_ASSIGN, ASSIGN_HEADERS);
  sh.clearContents();
  var matrix = [ASSIGN_HEADERS];
  for (var i = 0; i < history.length; i++) {
    var h = history[i];
    matrix.push([h.id||'', h.date||'', h.csName||'', h.label||'', JSON.stringify(h.phones||[]), JSON.stringify(h.donePhones||[])]);
  }
  sh.getRange(1, 1, matrix.length, ASSIGN_HEADERS.length).setValues(matrix);
  return jsonOut_({ ok: true, written: history.length });
}

// Luu vi du mau cho AI hoc (tu phan hoi cua CS sau khi sua)
function saveAIContext_(type, content, context) {
  if (!type || !content) return jsonOut_({ error: 'Thieu type hoac content' });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SH_CONTEXT);
  if (!sh) { sh = ss.insertSheet(SH_CONTEXT); sh.appendRow(['type','content','context','created']); }
  sh.appendRow([type, content, context||'', new Date().toISOString()]);
  return jsonOut_({ ok: true });
}

// ═══════════════════════════════════════════════════════════════
//  AI — Groq + AIContext
// ═══════════════════════════════════════════════════════════════
var SH_CONTEXT = 'AIContext';

function getSetting_(key) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SH_SET);
  if (!sh || sh.getLastRow() < 2) return null;
  var vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][0]) === key) return vals[i][1] || null;
  }
  return null;
}

function readAIContext_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SH_CONTEXT);
  var result = {
    systemPrompt: '', careProcess: '', callbackScript: '',
    salesScriptCu: '', salesScriptMoi: '',
    products: [], faqs: [], combos: []
  };
  if (!sh || sh.getLastRow() < 2) return result;
  var vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    var type    = String(vals[i][0] || '').trim();
    var content = String(vals[i][1] || '').trim();
    if (!content) continue;
    if (type === 'system_prompt')        result.systemPrompt   = content;
    else if (type === 'care_process')    result.careProcess    = content;
    else if (type === 'callback_script') result.callbackScript = content;
    else if (type === 'sales_script_cu') result.salesScriptCu  = content;
    else if (type === 'sales_script_moi')result.salesScriptMoi = content;
    else if (type === 'product')         result.products.push(content);
    else if (type === 'faq')             result.faqs.push(content);
    else if (type === 'combo_template')  result.combos.push(content);
  }
  return result;
}

function callGeminiAI_(data) {
  var key = getSetting_('geminiKey');
  if (!key) return jsonOut_({ error: 'Chua co API Key. Mo extension -> nut banh rang -> nhap key Groq -> Luu.' });
  var userMsg = data.prompt || '';
  if (!userMsg) return jsonOut_({ error: 'Thieu noi dung tin nhan' });

  var ctx = readAIContext_();
  var systemParts = [];
  if (ctx.systemPrompt) {
    systemParts.push(ctx.systemPrompt);
  } else {
    systemParts.push('Ban la chuyen vien cham soc khach hang cua cong ty my pham OME. Tra loi bang tieng Viet, than thien, ngan gon.');
  }
  function trunc_(s, n) { return s && s.length > n ? s.substring(0, n) + '...' : s; }
  if (ctx.careProcess) systemParts.push('\n\nQUY TRINH CSKH:\n' + trunc_(ctx.careProcess, 600));
  if (ctx.callbackScript) systemParts.push('\n\nKICH BAN GOI LAI:\n' + trunc_(ctx.callbackScript, 500));
  if (ctx.salesScriptCu) systemParts.push('\n\nKICH BAN KHACH CU:\n' + trunc_(ctx.salesScriptCu, 500));
  if (ctx.salesScriptMoi) systemParts.push('\n\nKICH BAN KHACH MOI:\n' + trunc_(ctx.salesScriptMoi, 500));
  if (ctx.products.length > 0) systemParts.push('\n\nSAN PHAM OME:\n' + ctx.products.slice(0, 12).join('\n'));
  if (ctx.faqs.length > 0) systemParts.push('\n\nFAQ:\n' + ctx.faqs.slice(0, 4).join('\n'));
  if (ctx.combos.length > 0) systemParts.push('\n\nMAU TIN NHAN:\n' + ctx.combos.slice(0, 5).join('\n'));
  systemParts.push('\n\nYEU CAU: Chi dua ra DUY NHAT 1 cau tra loi ngan gon (toi da 150 tu), phu hop nhat voi tin nhan khach. Khong danh so, khong giai thich them.');

  var payload = {
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: systemParts.join('') },
      { role: 'user', content: userMsg }
    ],
    temperature: 0.7,
    max_tokens: 400
  };

  try {
    var res = UrlFetchApp.fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'post',
        headers: { 'Authorization': 'Bearer ' + key },
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      }
    );
    var code = res.getResponseCode();
    var txt  = res.getContentText();
    if (code !== 200) return jsonOut_({ error: 'Groq loi ' + code + ': ' + txt.substring(0, 300) });
    var d = JSON.parse(txt);
    var result = d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
    return jsonOut_({ ok: true, text: result || '' });
  } catch (err) {
    return jsonOut_({ error: 'Loi goi Groq: ' + err.message });
  }
}

// ═══════════════════════════════════════════════════════════════
//  testScript
// ═══════════════════════════════════════════════════════════════
function testScript() {
  getSheet_(SH_CARE, CARE_HEADERS);
  getSheet_(SH_TEAM, TEAM_HEADERS);
  getSheet_(SH_AUDIT, AUDIT_HEADERS);
  getSheet_(SH_SET, SET_HEADERS);
  getSheet_(SH_ASSIGN, ASSIGN_HEADERS);
  getSheet_(SH_USER, USER_HEADERS);
  var oss = getOrderSS_();
  for (var i = 0; i < ORDER_SHEETS.length; i++) {
    var _s = oss.getSheetByName(ORDER_SHEETS[i].name) || oss.insertSheet(ORDER_SHEETS[i].name);
    if (_s.getLastRow() === 0) _s.appendRow(ORDER_HEADERS);
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var oss2 = getOrderSS_();
  var log = 'OK v11.0 - CareData:' + ss.getSheetByName(SH_CARE).getLastRow();
  for (var j = 0; j < ORDER_SHEETS.length; j++) {
    var sh = oss2.getSheetByName(ORDER_SHEETS[j].name);
    log += ' | ' + ORDER_SHEETS[j].name + ':' + (sh ? sh.getLastRow() : 'missing');
  }
  Logger.log(log);
  // Test lookup
  var testResult = findCareByPhone_('0978000000');
  Logger.log('Test lookup: ' + JSON.stringify(testResult));
}
