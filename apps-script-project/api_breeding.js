/**
 * 繁殖管理API（移動記録統合）
 *
 * 繁殖管理シート: [日付, 母豚No, ペンNo, BT値, ステータス]
 *
 * 高速化戦略:
 *   - 種付シート（2500行）: 「母豚No→最新種付日」Mapを6時間キャッシュ
 *     種付記録時にMapだけ差分更新（シート全読みしない）
 *   - 計算結果全体: 3分キャッシュ
 *   - 初回データ: doGet()でHTMLに埋め込み
 */

var CACHE_KEY_INITIAL = 'init_v22';
var CACHE_KEY_MATING = 'matingMap_v4';
var CACHE_TTL_INITIAL = 900;     // 15分
var CACHE_TTL_MATING  = 21600;   // 6時間
var CACHE_MAX_CHARS   = 95000;
var EVENT_LOOKBACK_ROWS = 1000;
var CURRENT_STATUS_SHEET = '母豚現在状況';
var CURRENT_STATUS_HEADERS = [
  '母豚No', '現在ペン', 'エリア', '最新移動日', '最新種付日', '最新分娩日',
  '種付状態', '繁殖測定終了日', '種付後測定終了日', '再発情確認終了日', '妊娠鑑定日', '空胎日',
  'BT履歴', '更新日時'
];

// ============================================================
//  キャッシュ管理
// ============================================================

function getCache_() { return CacheService.getScriptCache(); }

/**
 * 種付シートの末尾から「母豚No→最新種付日」Mapを構築してキャッシュ
 * 前提: 種付シートは種付日で昇順ソート済み（sortMatingSheet()で事前ソート）
 */
function getLatestMatingMap_() {
  var cache = getCache_();
  var cached = cache.get(CACHE_KEY_MATING);
  if (cached) {
    try { return JSON.parse(cached); } catch(e) {}
  }
  var ss = getSpreadsheet();
  var data = getSheetDataTail(ss, '種付', EVENT_LOOKBACK_ROWS);
  var map = {};
  for (var i = 1; i < data.length; i++) {
    var sowNo = normalizeSowNo(data[i][0]);
    var date = data[i][1];
    if (!sowNo || !(date instanceof Date)) continue;
    var ds = toDateString(date);
    if (!map[sowNo] || ds > map[sowNo]) map[sowNo] = ds;
  }
  try { cache.put(CACHE_KEY_MATING, JSON.stringify(map), CACHE_TTL_MATING); } catch(e) {}
  return map;
}

/** 分娩シートから「母豚No→最新分娩日」Mapを構築 */
function getLatestFarrowingMap_(ss) {
  var data = getSheetDataTail(ss, '分娩', EVENT_LOOKBACK_ROWS);
  var map = {};
  for (var i = 1; i < data.length; i++) {
    var sowNo = normalizeSowNo(data[i][0]);
    var date = data[i][1];
    if (!sowNo || !(date instanceof Date)) continue;
    var ds = toDateString(date);
    if (!map[sowNo] || ds > map[sowNo]) map[sowNo] = ds;
  }
  return map;
}

/** 離乳シートの末尾200行から「母豚No→最新離乳日」Mapを構築 */
function getLatestWeaningMap_(ss) {
  var data = getSheetDataTail(ss, '離乳', EVENT_LOOKBACK_ROWS);
  var map = {};
  for (var i = 1; i < data.length; i++) {
    var sowNo = normalizeSowNo(data[i][0]);
    var date = data[i][1];
    if (!sowNo || !(date instanceof Date)) continue;
    var ds = toDateString(date);
    if (!map[sowNo] || ds > map[sowNo]) map[sowNo] = ds;
  }
  return map;
}

/** 種付Mapに1件追加してキャッシュ更新（シート読み直し不要） */
function updateMatingMapCache_(sowNo, dateStr) {
  var cache = getCache_();
  var cached = cache.get(CACHE_KEY_MATING);
  var map = {};
  if (cached) { try { map = JSON.parse(cached); } catch(e) {} }
  if (!map[sowNo] || dateStr > map[sowNo]) map[sowNo] = dateStr;
  try { cache.put(CACHE_KEY_MATING, JSON.stringify(map), CACHE_TTL_MATING); } catch(e) {}
}

function invalidateInitialCache_() {
  try { getCache_().remove(CACHE_KEY_INITIAL); } catch(e) {}
}

/** 全キャッシュをクリアして最新データを返す（更新ボタン用） */
function refreshAllData(authToken) {
  requireAuth_(authToken);
  try {
    var c = getCache_();
    c.remove(CACHE_KEY_INITIAL);
    c.remove(CACHE_KEY_MATING);
  } catch(e) {}
  return getInitialData_();
}

// ============================================================
//  初回データ取得（doGet / refresh用）
// ============================================================

function getInitialDataCached(authToken) {
  requireAuth_(authToken);
  return getInitialDataCached_();
}

function getInitialDataCached_() {
  var cache = getCache_();
  var cached = cache.get(CACHE_KEY_INITIAL);
  if (cached) {
    try { return JSON.parse(cached); } catch(e) {}
  }
  var data = getInitialData_();
  try {
    var json = JSON.stringify(data);
    if (json.length < CACHE_MAX_CHARS) cache.put(CACHE_KEY_INITIAL, json, CACHE_TTL_INITIAL);
  } catch(e) {}
  return data;
}

function getInitialData(authToken) {
  requireAuth_(authToken);
  return getInitialData_();
}

function getInitialData_() {
  var ss = getSpreadsheet();
  var currentRows = getCurrentStatusRows_(ss);
  var parsed = buildParsedFromCurrentRows_(currentRows);
  var latestMatingMap = mapCurrentDates_(currentRows, 'latestMatingDate');
  var latestFarrowingMap = mapCurrentDates_(currentRows, 'latestFarrowingDate');

  var morningList = buildMorningListFromCurrent_(currentRows);
  var locationList = buildLocationListFromCurrent_(currentRows);
  var farrowingList = buildFarrowingListFromCurrent_(currentRows);

  var postMatingList = buildPostMatingListFromCurrent_(currentRows);
  var reheatCheckList = buildReheatCheckListFromCurrent_(currentRows);
  var pregnancyCheckList = buildPregnancyCheckListFromCurrent_(currentRows);
  var accidentList = getRecentAccidents_(ss);
  var penTaskList = buildPenTaskList_(ss, parsed, latestFarrowingMap, latestMatingMap);
  return { morningList: morningList, locationList: locationList, farrowingList: farrowingList, postMatingList: postMatingList, reheatCheckList: reheatCheckList, pregnancyCheckList: pregnancyCheckList, accidentList: accidentList, penTaskList: penTaskList };
}

// ============================================================
//  現在状況シート（高速表示用）
// ============================================================

function ensureCurrentStatusSheet_(ss) {
  var sheet = ss.getSheetByName(CURRENT_STATUS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(CURRENT_STATUS_SHEET);
  }
  var headerRange = sheet.getRange(1, 1, 1, CURRENT_STATUS_HEADERS.length);
  var existing = headerRange.getValues()[0];
  if (existing.join('\t') !== CURRENT_STATUS_HEADERS.join('\t')) {
    headerRange.setValues([CURRENT_STATUS_HEADERS]);
    sheet.getRange(1, 1, 1, CURRENT_STATUS_HEADERS.length)
      .setFontWeight('bold').setBackground('#1f5ca8').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function parseDateString_(dateStr) {
  if (!dateStr) return null;
  if (dateStr instanceof Date) return dateStr;
  var s = String(dateStr).trim();
  var m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function currentDateStr_(value) {
  if (!value) return '';
  if (value instanceof Date) return toDateString(value);
  var d = parseDateString_(value);
  return d ? toDateString(d) : String(value);
}

function parseBtHistory_(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    var parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function getCurrentStatusRows_(ss) {
  var sheet = ensureCurrentStatusSheet_(ss);
  if (sheet.getLastRow() <= 1) return [];
  var data = sheet.getRange(1, 1, sheet.getLastRow(), CURRENT_STATUS_HEADERS.length).getValues();
  var header = data[0];
  function col(name, fallback) {
    for (var c = 0; c < header.length; c++) {
      if (String(header[c]) === name) return c;
    }
    return fallback;
  }
  var cSow = col('母豚No', 0);
  var cPen = col('現在ペン', 1);
  var cArea = col('エリア', 2);
  var cMove = col('最新移動日', 3);
  var cMating = col('最新種付日', 4);
  var cFarrow = col('最新分娩日', 5);
  var cStatus = col('種付状態', 6);
  var cBreedingDone = col('繁殖測定終了日', 7);
  var cPostMatingDone = col('種付後測定終了日', -1);
  var cReheatDone = col('再発情確認終了日', cPostMatingDone >= 0 ? 9 : 8);
  var cPregDone = col('妊娠鑑定日', cPostMatingDone >= 0 ? 10 : 9);
  var cEmpty = col('空胎日', cPostMatingDone >= 0 ? 11 : 10);
  var cBt = col('BT履歴', cPostMatingDone >= 0 ? 12 : 11);
  var result = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var sowNo = normalizeSowNo(row[cSow]);
    if (!sowNo) continue;
    result.push({
      sowNo: sowNo,
      penNo: normalizePenNo(row[cPen]),
      area: row[cArea] || '',
      latestMoveDate: currentDateStr_(row[cMove]),
      latestMatingDate: currentDateStr_(row[cMating]),
      latestFarrowingDate: currentDateStr_(row[cFarrow]),
      matingStatus: row[cStatus] || '',
      breedingDoneDate: currentDateStr_(row[cBreedingDone]),
      postMatingDoneDate: cPostMatingDone >= 0 ? currentDateStr_(row[cPostMatingDone]) : '',
      reheatDoneDate: currentDateStr_(row[cReheatDone]),
      pregnancyDoneDate: currentDateStr_(row[cPregDone]),
      emptyDate: currentDateStr_(row[cEmpty]),
      btHistory: parseBtHistory_(row[cBt])
    });
  }
  return result;
}

function mapCurrentDates_(rows, field) {
  var map = {};
  for (var i = 0; i < rows.length; i++) {
    if (rows[i][field]) map[rows[i].sowNo] = rows[i][field];
  }
  return map;
}

function buildParsedFromCurrentRows_(rows) {
  var latestPen = {};
  var latestStatus = {};
  var btMap = {};
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (r.penNo && r.latestMoveDate) {
      latestPen[r.sowNo] = { date: parseDateString_(r.latestMoveDate), penNo: r.penNo, area: r.area || '' };
    }
    if (r.matingStatus) {
      latestStatus[r.sowNo] = { status: r.matingStatus, date: parseDateString_(r.latestMatingDate || r.latestMoveDate) || new Date(0) };
    }
    btMap[r.sowNo] = r.btHistory || [];
  }
  return { latestPen: latestPen, latestStatus: latestStatus, btMap: btMap, currentRows: rows };
}

function sortByPen_(a, b) {
  var penA = parseInt(a.penNo, 10) || 99999;
  var penB = parseInt(b.penNo, 10) || 99999;
  return penA - penB;
}

function isStallRow_(row) {
  var area = String(row.area || '').trim();
  return area === 'ストール' || area === '交配舎' || area === '種付舎' || area === '繁殖舎';
}

function hasFarrowAfterMating_(row) {
  return row.latestFarrowingDate && (!row.latestMatingDate || row.latestFarrowingDate > row.latestMatingDate);
}

function doneAfter_(doneDate, anchorDate) {
  return doneDate && anchorDate && doneDate >= anchorDate;
}

function buildMorningListFromCurrent_(rows) {
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var result = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!isStallRow_(r)) continue;

    var movedAfterFarrow = hasFarrowAfterMating_(r) && r.latestMoveDate >= r.latestFarrowingDate;
    var movementOnly = !r.latestMatingDate && !r.latestFarrowingDate;
    var emptyAfterMating = r.matingStatus === '空胎' && doneAfter_(r.emptyDate, r.latestMatingDate);
    if (!emptyAfterMating && !r.latestMoveDate) continue;
    var anchorDate = emptyAfterMating ? r.emptyDate : r.latestMoveDate;
    var breedingDoneAfterAnchor = doneAfter_(r.breedingDoneDate, anchorDate);
    if (breedingDoneAfterAnchor) {
      // 育成豚は1回目の発情確認終了から15日後に、次回確認対象として再表示する。
      if (!movementOnly || daysSince_(r.breedingDoneDate, today) < 15) continue;
    }
    if (!movedAfterFarrow && !movementOnly && !emptyAfterMating) continue;

    var days = daysSince_(anchorDate, today);
    result.push({
      sowNo: String(r.sowNo),
      penNo: r.penNo,
      reason: emptyAfterMating ? '空胎 ' + days + '日目' : movedAfterFarrow ? '離乳移動 ' + days + '日目' : '育成/移動 ' + days + '日目',
      group: emptyAfterMating ? 0 : movedAfterFarrow ? 1 : 2,
      days: days,
      status: r.matingStatus || '',
      btHistory: (r.btHistory || []).slice(0, 7)
    });
  }
  result.sort(sortByPen_);
  return result;
}

function buildLocationListFromCurrent_(rows) {
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var result = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var info = '';
    if (hasFarrowAfterMating_(r)) {
      info = '分娩' + daysSince_(r.latestFarrowingDate, today) + '日目';
    } else if (r.latestMatingDate) {
      info = '種付' + daysSince_(r.latestMatingDate, today) + '日目';
    } else if (r.latestMoveDate) {
      info = '移動' + daysSince_(r.latestMoveDate, today) + '日目';
    }
    result.push({
      sowNo: String(r.sowNo),
      penNo: r.penNo || '未登録',
      area: r.area || '',
      status: r.matingStatus || '',
      info: info,
      mateDays: r.latestMatingDate ? daysSince_(r.latestMatingDate, today) : 999
    });
  }
  result.sort(sortByPen_);
  return result;
}

function buildFarrowingListFromCurrent_(rows) {
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var result = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r.latestMatingDate || hasFarrowAfterMating_(r)) continue;
    var days = daysSince_(r.latestMatingDate, today);
    if (days >= 120) continue;
    var mateDate = parseDateString_(r.latestMatingDate);
    var dueDate = new Date(mateDate);
    dueDate.setDate(dueDate.getDate() + 114);
    result.push({
      sowNo: String(r.sowNo),
      penNo: r.penNo || '未登録',
      matingDate: r.latestMatingDate,
      daysSinceMate: days,
      dueDate: toDateString(dueDate),
      status: r.matingStatus || ''
    });
  }
  result.sort(function(a, b) { return a.matingDate.localeCompare(b.matingDate); });
  return result;
}

function buildPostMatingListFromCurrent_(rows) {
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var result = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r.latestMatingDate || hasFarrowAfterMating_(r)) continue;
    if (doneAfter_(r.postMatingDoneDate, r.latestMatingDate)) continue;
    var days = daysSince_(r.latestMatingDate, today);
    if (days < 0 || days >= 15) continue;
    result.push({
      sowNo: String(r.sowNo),
      penNo: r.penNo || '不明',
      days: days,
      mateDate: r.latestMatingDate,
      status: r.matingStatus || '通常',
      btHistory: r.btHistory || []
    });
  }
  result.sort(sortByPen_);
  return result;
}

function buildReheatCheckListFromCurrent_(rows) {
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var result = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r.latestMatingDate || hasFarrowAfterMating_(r)) continue;
    if (doneAfter_(r.reheatDoneDate, r.latestMatingDate)) continue;
    if (doneAfter_(r.pregnancyDoneDate, r.latestMatingDate)) continue;
    if (doneAfter_(r.emptyDate, r.latestMatingDate)) continue;
    var days = daysSince_(r.latestMatingDate, today);
    if (days < 15 || days > 150) continue;
    result.push({
      sowNo: String(r.sowNo),
      penNo: r.penNo || '不明',
      days: days,
      mateDate: r.latestMatingDate,
      eventDate: r.latestMatingDate,
      detailPrefix: '種付後',
      status: r.matingStatus || '通常',
      btHistory: r.btHistory || []
    });
  }
  result.sort(sortByPen_);
  return result;
}

function buildPregnancyCheckListFromCurrent_(rows) {
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var result = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r.latestMatingDate || hasFarrowAfterMating_(r)) continue;
    if (doneAfter_(r.pregnancyDoneDate, r.latestMatingDate)) continue;
    if (doneAfter_(r.emptyDate, r.latestMatingDate)) continue;
    var days = daysSince_(r.latestMatingDate, today);
    if (days < 25 || days > 150) continue;
    result.push({
      sowNo: String(r.sowNo),
      penNo: r.penNo || '不明',
      days: days,
      mateDate: r.latestMatingDate
    });
  }
  result.sort(sortByPen_);
  return result;
}

// ============================================================
//  データ解析
// ============================================================

function parseBreedingData_(data, penAreaMap) {
  var latestPen = {};
  var latestStatus = {};
  var btMap = {};
  var btCutoff = new Date();
  btCutoff.setDate(btCutoff.getDate() - 60);

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var date = row[0], sowNo = normalizeSowNo(row[1]), penNo = normalizePenNo(row[2]), bt = row[3], status = row[4];
    if (!sowNo || !(date instanceof Date)) continue;

    if (penNo && (!latestPen[sowNo] || date >= latestPen[sowNo].date)) {
      latestPen[sowNo] = { date: date, penNo: penNo, area: penAreaMap[penNo] || '' };
    }
    if (status && shouldReplaceStatus_(latestStatus[sowNo], status, date)) {
      latestStatus[sowNo] = { status: status, date: date };
    }
    if (bt && date >= btCutoff) {
      if (!btMap[sowNo]) btMap[sowNo] = [];
      btMap[sowNo].push({ date: toDateString(date), bt: bt });
    }
  }
  return { latestPen: latestPen, latestStatus: latestStatus, btMap: btMap };
}

function shouldReplaceStatus_(current, nextStatus, nextDate) {
  if (!current) return true;
  if (nextDate > current.date) return true;
  if (nextDate < current.date) return false;
  return getStatusPriority_(nextStatus) >= getStatusPriority_(current.status);
}

function getStatusPriority_(status) {
  if (isRetiredStatus_(status)) return 100;
  if (status === '空胎') return 40;
  if (status === '妊娠鑑定済') return 30;
  if (isReheatCheckDoneStatus_(status)) return 20;
  if (status === '測定終了') return 20;
  if (status === '通常') return 10;
  return 0;
}

function isRetiredStatus_(status) {
  return String(status || '').indexOf('廃用') >= 0;
}

function isReheatCheckDoneStatus_(status) {
  var s = String(status || '').trim();
  return s === '再発情確認終了' || (s.indexOf('再発') >= 0 && s.indexOf('確認') >= 0 && s.indexOf('終了') >= 0);
}

function isPostMatingDoneStatus_(status) {
  var s = String(status || '').trim();
  return s === '種付後測定終了' || (s.indexOf('種付後') >= 0 && s.indexOf('測定') >= 0 && s.indexOf('終了') >= 0);
}

function isMorningExcludedStatus_(status) {
  return status === '測定終了' || status === '妊娠鑑定済' || isReheatCheckDoneStatus_(status) || isRetiredStatus_(status);
}

function isRetiredSow_(latestStatus, sowNo) {
  var st = latestStatus[sowNo];
  return st && isRetiredStatus_(st.status);
}

function getBtHistForReheat_(btMap, sowNo) {
  return (btMap[sowNo] || []).sort(function(a, b) {
    return b.date.localeCompare(a.date);
  });
}

/** 朝チェック一覧（latestMatingMap/latestFarrowingMapは文字列日付のMap） */
function buildMorningList_(parsed, latestMatingMap, latestFarrowingMap) {
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var todayStr = toDateString(today);
  var latestPen = parsed.latestPen;
  var latestStatus = parsed.latestStatus;
  var btMap = parsed.btMap;

  function isExcluded(sowNo) {
    var s = latestStatus[sowNo];
    return s && isMorningExcludedStatus_(s.status);
  }
  function getBtHist(sowNo) {
    return (btMap[sowNo] || []).sort(function(a, b) {
      return b.date.localeCompare(a.date);
    }).slice(0, 7);
  }

  var result = [];
  var addedSows = {};

  // A) ストールに移動した母豚
  // 移動だけを根拠に表示するのは、過去の種付/分娩データがない母豚だけ。
  // 種付が移動日以降なら新しい種付サイクルとして表示する。
  for (var sowNo in latestPen) {
    if (isExcluded(sowNo)) continue;
    var mv = latestPen[sowNo];
    var area = String(mv.area || '').trim();
    var isStall = area === 'ストール' || area === '交配舎' || area === '種付舎' || area === '繁殖舎';
    if (!isStall) continue;
    var st = latestStatus[sowNo];
    if (st && isMorningExcludedStatus_(st.status) && st.date > mv.date) continue;
    var hasBreedingEvent = !!(latestMatingMap[sowNo] || latestFarrowingMap[sowNo]);
    var daysSinceMove = daysBetween(mv.date, today);
    var reason = 'ストール移動 ' + daysSinceMove + '日目';
    var displayDays = daysSinceMove;
    var showByMating = false;

    if (latestMatingMap[sowNo]) {
      var mateParts = latestMatingMap[sowNo].split('-');
      var mateDate = new Date(Number(mateParts[0]), Number(mateParts[1]) - 1, Number(mateParts[2]));
      if (mateDate >= mv.date) {
        var daysSinceMate = daysBetween(mateDate, today);
        reason = '種付' + daysSinceMate + '日目';
        displayDays = daysSinceMate;
        showByMating = true;
      }
    }

    if (hasBreedingEvent && !showByMating) continue;

    result.push({
      sowNo: String(sowNo), penNo: mv.penNo,
      reason: reason,
      group: 0, days: displayDays,
      status: latestStatus[sowNo] ? latestStatus[sowNo].status : '',
      btHistory: getBtHist(sowNo)
    });
    addedSows[sowNo] = true;
  }

  // B) 種付後15日以降の母豚（再発チェック）
  for (var sowNo in latestMatingMap) {
    if (addedSows[sowNo] || isExcluded(sowNo)) continue;
    var mateDateStr = latestMatingMap[sowNo];
    var farrowDateStr = latestFarrowingMap[sowNo] || '';
    if (farrowDateStr && farrowDateStr > mateDateStr) continue;
    var parts = mateDateStr.split('-');
    var mateDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    var daysSinceMate = daysBetween(mateDate, today);
    if (daysSinceMate < 15 || daysSinceMate > 150) continue;

    var currentPen = latestPen[sowNo];
    if (currentPen) {
      var currentArea = String(currentPen.area || '').trim();
      var currentIsStall = currentArea === 'ストール' || currentArea === '交配舎' || currentArea === '種付舎' || currentArea === '繁殖舎';
      if (!currentIsStall) continue;
    }

    var pen = currentPen ? currentPen.penNo : '不明';
    result.push({
      sowNo: String(sowNo), penNo: pen,
      reason: '種付後 ' + daysSinceMate + '日目（再発チェック）',
      group: 1, days: daysSinceMate,
      status: latestStatus[sowNo] ? latestStatus[sowNo].status : '',
      btHistory: getBtHist(sowNo)
    });
    addedSows[sowNo] = true;
  }

  // C) 移動記録があるが種付記録がない母豚（育成豚など）
  for (var sowNo in latestPen) {
    if (addedSows[sowNo] || isExcluded(sowNo)) continue;
    if (latestMatingMap[sowNo]) continue; // 種付記録ありはスキップ（A/Bで処理済み）
    if (latestFarrowingMap[sowNo]) continue; // 分娩履歴ありは移動だけでは繁殖リストに出さない
    var mv = latestPen[sowNo];
    var daysSinceMove = daysBetween(mv.date, today);
    result.push({
      sowNo: String(sowNo), penNo: mv.penNo,
      reason: '育成/移動 ' + daysSinceMove + '日目',
      group: 2, days: daysSinceMove,
      status: latestStatus[sowNo] ? latestStatus[sowNo].status : '',
      btHistory: getBtHist(sowNo)
    });
    addedSows[sowNo] = true;
  }

  result.sort(sortByPen_);
  return result;
}

/**
 * アクティブ母豚の現在地一覧
 * アクティブ条件:
 *   - ペン記録あり & 150日以内 → 無条件表示（種付/分娩キャッシュ200件外でも消えない）
 *   - ペン記録なし → 種付<150日 or 分娩<50日 で表示
 * info はイベント基準（種付/分娩 > 移動）で構築
 */
function buildLocationList_(parsed, latestMatingMap, latestFarrowingMap) {
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var latestPen = parsed.latestPen;
  var latestStatus = parsed.latestStatus;

  var allSows = {};
  for (var s in latestMatingMap) allSows[s] = true;
  for (var s in latestFarrowingMap) allSows[s] = true;
  for (var s in latestPen) allSows[s] = true;

  var result = [];
  for (var sowNo in allSows) {
    if (isRetiredSow_(latestStatus, sowNo)) continue;
    var pen = latestPen[sowNo];
    var mateStr = latestMatingMap[sowNo] || '';
    var farrowStr = latestFarrowingMap[sowNo] || '';
    var active = false;
    var info = '';

    // 1) ペン記録があり 150日以内なら無条件で表示
    if (pen && pen.date) {
      var dMove = daysBetween(pen.date, today);
      if (dMove < 150) {
        active = true;
        if (farrowStr && (!mateStr || farrowStr > mateStr)) {
          info = '分娩' + daysSince_(farrowStr, today) + '日目';
        } else if (mateStr) {
          info = '種付' + daysSince_(mateStr, today) + '日目';
        } else if (farrowStr) {
          info = '分娩' + daysSince_(farrowStr, today) + '日目';
        } else {
          info = '移動' + dMove + '日目';
        }
      }
    }

    // 2) ペン記録なし → 旧ロジック（種付/分娩のみで判定）
    if (!active) {
      if (mateStr && farrowStr) {
        if (mateStr >= farrowStr) {
          var d = daysSince_(mateStr, today);
          if (d < 150) { active = true; info = '種付' + d + '日目'; }
        } else {
          var d = daysSince_(farrowStr, today);
          if (d < 50) { active = true; info = '分娩' + d + '日目'; }
        }
      } else if (mateStr) {
        var d = daysSince_(mateStr, today);
        if (d < 150) { active = true; info = '種付' + d + '日目'; }
      } else if (farrowStr) {
        var d = daysSince_(farrowStr, today);
        if (d < 50) { active = true; info = '分娩' + d + '日目'; }
      }
    }

    if (!active) continue;

    var st = latestStatus[sowNo];
    var mateDays = mateStr ? daysSince_(mateStr, today) : 999;
    result.push({
      sowNo: String(sowNo),
      penNo: pen ? pen.penNo : '未登録',
      area: pen ? pen.area : '',
      status: st ? st.status : '',
      info: info,
      mateDays: mateDays
    });
  }

  // ペン番号昇順（エリア無関係）
  result.sort(function(a, b) {
    var penA = parseInt(a.penNo) || 99999;
    var penB = parseInt(b.penNo) || 99999;
    return penA - penB;
  });
  return result;
}

function daysSince_(dateStr, today) {
  var parts = dateStr.split('-');
  var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return daysBetween(d, today);
}

/** 種付済み母豚の一覧（分娩舎移動用）
 *  対象: 種付記録あり、種付後120日未満、測定終了は除外
 */
function buildFarrowingList_(parsed, latestMatingMap) {
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var latestPen = parsed.latestPen;
  var latestStatus = parsed.latestStatus;
  var result = [];

  for (var sowNo in latestMatingMap) {
    if (isRetiredSow_(latestStatus, sowNo)) continue;
    var mateDateStr = latestMatingMap[sowNo];
    var parts = mateDateStr.split('-');
    var mateDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    var daysSinceMate = daysBetween(mateDate, today);

    // 120日以上経過は除外
    if (daysSinceMate >= 120) continue;

    var st = latestStatus[sowNo];

    var dueDate = new Date(mateDate);
    dueDate.setDate(dueDate.getDate() + 114);

    var pen = latestPen[sowNo];
    result.push({
      sowNo: String(sowNo),
      penNo: pen ? pen.penNo : '未登録',
      matingDate: mateDateStr,
      daysSinceMate: daysSinceMate,
      dueDate: toDateString(dueDate),
      status: st ? st.status : ''
    });
  }

  // 種付日昇順（古い=分娩が近い順が上）
  result.sort(function(a, b) { return a.matingDate.localeCompare(b.matingDate); });
  return result;
}

/**
 * 再発情確認対象リスト
 * 条件:
 *   - 最新種付後15日以上で、測定終了または空胎になっている
 *   - 最新種付より後に離乳/分娩があり、まだ次の種付がない
 *   - 再発情確認終了は除外（妊娠鑑定リストには残す）
 */
function buildReheatCheckList_(parsed, latestMatingMap, latestFarrowingMap, latestWeaningMap) {
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var latestPen = parsed.latestPen;
  var latestStatus = parsed.latestStatus;
  var btMap = parsed.btMap;

  function dateFromStr(dateStr) {
    var parts = dateStr.split('-');
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  function addRow(result, sowNo, anchorDateStr, statusLabel, detailPrefix, mateDateStr) {
    if (latestPen[sowNo] && latestPen[sowNo].area === '分娩舎') return;
    var anchorDate = dateFromStr(anchorDateStr);
    var days = daysBetween(anchorDate, today);
    if (days > 150) return;
    var pen = latestPen[sowNo] ? latestPen[sowNo].penNo : '不明';
    result.push({
      sowNo: String(sowNo),
      penNo: pen,
      days: days,
      mateDate: mateDateStr || '',
      eventDate: anchorDateStr,
      detailPrefix: detailPrefix,
      status: statusLabel,
      btHistory: getBtHistForReheat_(btMap, sowNo)
    });
  }

  var allSows = {};
  for (var s in latestMatingMap) allSows[s] = true;
  for (var s in latestFarrowingMap) allSows[s] = true;
  for (var s in latestWeaningMap) allSows[s] = true;

  var result = [];
  for (var sowNo in allSows) {
    if (isRetiredSow_(latestStatus, sowNo)) continue;
    var st = latestStatus[sowNo];
    var mateDateStr = latestMatingMap[sowNo] || '';
    var farrowDateStr = latestFarrowingMap[sowNo] || '';
    var weanDateStr = latestWeaningMap[sowNo] || '';
    var isReheatDone = st && isReheatCheckDoneStatus_(st.status);
    var hasFarrowAfterMating = farrowDateStr && (!mateDateStr || farrowDateStr > mateDateStr);

    // 離乳後、まだ次の種付がない母豚は実質空胎として表示
    if (!isReheatDone && weanDateStr && (!mateDateStr || weanDateStr > mateDateStr)) {
      var label = '離乳後空胎';
      if (latestPen[sowNo] && toDateString(latestPen[sowNo].date) >= weanDateStr) label = '種付待ち';
      addRow(result, sowNo, weanDateStr, label, '離乳後', mateDateStr);
      continue;
    }

    // 最新種付後の測定終了/妊鑑空胎
    if (!isReheatDone && !hasFarrowAfterMating && mateDateStr && st && (st.status === '測定終了' || st.status === '空胎')) {
      var mateDate = dateFromStr(mateDateStr);
      var days = daysBetween(mateDate, today);
      if (days >= 15) {
        addRow(result, sowNo, mateDateStr, st.status, '種付後', mateDateStr);
      }
    }
  }

  result.sort(function(a, b) {
    var penA = parseInt(a.penNo) || 99999;
    var penB = parseInt(b.penNo) || 99999;
    return penA - penB;
  });
  return result;
}

/**
 * ペン未登録のアクティブ母豚一覧
 * アクティブ条件: 種付<150日 or 分娩<50日
 */
function buildNoPenList_(parsed, latestMatingMap, latestFarrowingMap) {
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var latestPen = parsed.latestPen;
  var latestStatus = parsed.latestStatus;

  var allSows = {};
  for (var s in latestMatingMap) allSows[s] = true;
  for (var s in latestFarrowingMap) allSows[s] = true;

  var result = [];
  for (var sowNo in allSows) {
    if (isRetiredSow_(latestStatus, sowNo)) continue;
    // ペン登録済みはスキップ
    if (latestPen[sowNo]) continue;

    var mateStr = latestMatingMap[sowNo] || '';
    var farrowStr = latestFarrowingMap[sowNo] || '';
    var active = false;
    var info = '';

    if (mateStr && farrowStr) {
      if (mateStr >= farrowStr) {
        var d = daysSince_(mateStr, today);
        if (d < 150) { active = true; info = '種付' + d + '日目'; }
      } else {
        var d = daysSince_(farrowStr, today);
        if (d < 50) { active = true; info = '分娩' + d + '日目'; }
      }
    } else if (mateStr) {
      var d = daysSince_(mateStr, today);
      if (d < 150) { active = true; info = '種付' + d + '日目'; }
    } else if (farrowStr) {
      var d = daysSince_(farrowStr, today);
      if (d < 50) { active = true; info = '分娩' + d + '日目'; }
    }

    if (!active) continue;
    result.push({ sowNo: String(sowNo), info: info });
  }

  result.sort(function(a, b) { return a.sowNo.localeCompare(b.sowNo, undefined, {numeric: true}); });
  return result;
}

/**
 * 妊娠鑑定対象リスト
 * 条件: 種付25日以上 かつ 妊娠鑑定済/空胎でない
 *   測定終了は除外しない（再発確認終了→妊娠鑑定→移動 のワークフロー）
 */
function buildPregnancyCheckList_(parsed, latestMatingMap) {
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var latestPen = parsed.latestPen;
  var latestStatus = parsed.latestStatus;

  var result = [];
  for (var sowNo in latestMatingMap) {
    var st = latestStatus[sowNo];
    if (st && isRetiredStatus_(st.status)) continue;
    if (st && (st.status === '妊娠鑑定済' || st.status === '空胎')) continue;

    var mateDateStr = latestMatingMap[sowNo];
    var parts = mateDateStr.split('-');
    var mateDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    var days = daysBetween(mateDate, today);
    if (days < 25) continue;

    var pen = latestPen[sowNo] ? latestPen[sowNo].penNo : '不明';
    result.push({
      sowNo: String(sowNo),
      penNo: pen,
      days: days,
      mateDate: mateDateStr
    });
  }

  // ペン番号順
  result.sort(function(a, b) {
    var penA = parseInt(a.penNo) || 99999;
    var penB = parseInt(b.penNo) || 99999;
    return penA - penB;
  });
  return result;
}

// ============================================================
//  書込みAPI
// ============================================================

function parseInputDate(dateStr) {
  if (dateStr) {
    var parts = dateStr.split('-');
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }
  return new Date();
}

function getPenAreaForCurrent_(ss, penNo) {
  penNo = normalizePenNo(penNo);
  var data = getSheetData(ss, 'ペンマスタ');
  for (var i = 1; i < data.length; i++) {
    if (normalizePenNo(data[i][0]) === penNo) return data[i][1] || '';
  }
  return '';
}

function emptyCurrentRow_(sowNo) {
  return {
    sowNo: String(sowNo),
    penNo: '',
    area: '',
    latestMoveDate: '',
    latestMatingDate: '',
    latestFarrowingDate: '',
    matingStatus: '',
    breedingDoneDate: '',
    reheatDoneDate: '',
    pregnancyDoneDate: '',
    emptyDate: '',
    btHistory: []
  };
}

function currentRowToValues_(row) {
  return [[
    row.sowNo || '',
    row.penNo || '',
    row.area || '',
    row.latestMoveDate || '',
    row.latestMatingDate || '',
    row.latestFarrowingDate || '',
    row.matingStatus || '',
    row.breedingDoneDate || '',
    row.postMatingDoneDate || '',
    row.reheatDoneDate || '',
    row.pregnancyDoneDate || '',
    row.emptyDate || '',
    JSON.stringify(row.btHistory || []),
    Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss')
  ]];
}

function findCurrentRow_(sheet, sowNo) {
  if (sheet.getLastRow() <= 1) return { rowIndex: 0, row: null };
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, CURRENT_STATUS_HEADERS.length).getValues();
  var sn = String(sowNo);
  for (var i = 0; i < data.length; i++) {
    if (normalizeSowNo(data[i][0]) === sn) {
      return {
        rowIndex: i + 2,
        row: {
          sowNo: sn,
          penNo: normalizePenNo(data[i][1]),
          area: data[i][2] || '',
          latestMoveDate: currentDateStr_(data[i][3]),
          latestMatingDate: currentDateStr_(data[i][4]),
          latestFarrowingDate: currentDateStr_(data[i][5]),
          matingStatus: data[i][6] || '',
          breedingDoneDate: currentDateStr_(data[i][7]),
          postMatingDoneDate: currentDateStr_(data[i][8]),
          reheatDoneDate: currentDateStr_(data[i][9]),
          pregnancyDoneDate: currentDateStr_(data[i][10]),
          emptyDate: currentDateStr_(data[i][11]),
          btHistory: parseBtHistory_(data[i][12])
        }
      };
    }
  }
  return { rowIndex: 0, row: null };
}

function upsertCurrentRow_(ss, sowNo, patch) {
  var sheet = ensureCurrentStatusSheet_(ss);
  var found = findCurrentRow_(sheet, sowNo);
  var row = found.row || emptyCurrentRow_(sowNo);
  for (var k in patch) row[k] = patch[k];
  var values = currentRowToValues_(row);
  if (found.rowIndex) {
    sheet.getRange(found.rowIndex, 1, 1, CURRENT_STATUS_HEADERS.length).setValues(values);
  } else {
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, CURRENT_STATUS_HEADERS.length).setValues(values);
  }
}

function removeCurrentRow_(ss, sowNo) {
  var sheet = ensureCurrentStatusSheet_(ss);
  var found = findCurrentRow_(sheet, sowNo);
  if (found.rowIndex) sheet.deleteRow(found.rowIndex);
}

function addBtToCurrent_(ss, sowNo, bt, dateStr) {
  var sheet = ensureCurrentStatusSheet_(ss);
  var found = findCurrentRow_(sheet, sowNo);
  var row = found.row || emptyCurrentRow_(sowNo);
  row.btHistory = row.btHistory || [];
  row.btHistory.unshift({ date: dateStr, bt: bt });
  row.btHistory.sort(function(a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
  row.btHistory = row.btHistory.slice(0, 10);
  upsertCurrentRow_(ss, sowNo, row);
}

function latestDateForSow_(data, sowCol, dateCol, sowNo) {
  var latest = null;
  for (var i = 1; i < data.length; i++) {
    if (normalizeSowNo(data[i][sowCol]) !== sowNo) continue;
    var d = data[i][dateCol];
    if (!(d instanceof Date)) continue;
    if (!latest || d > latest) latest = d;
  }
  return latest;
}

function syncCurrentStatusForSow_(ss, sowNo) {
  var sn = String(sowNo);
  var breeding = getSheetData(ss, '繁殖管理');
  var mating = getSheetData(ss, '種付');
  var farrowing = getSheetData(ss, '分娩');
  var latestMating = latestDateForSow_(mating, 0, 1, sn);
  var latestFarrowing = latestDateForSow_(farrowing, 0, 1, sn);

  var latestPen = null;
  var latestStatus = null;
  var statusEvents = [];
  var btHistory = [];
  for (var i = 1; i < breeding.length; i++) {
    var row = breeding[i];
    if (normalizeSowNo(row[1]) !== sn) continue;
    var d = row[0];
    if (!(d instanceof Date)) continue;
    var penNo = normalizePenNo(row[2]);
    var bt = row[3];
    var status = row[4] || '';
    if (penNo && (!latestPen || d >= latestPen.date)) {
      latestPen = { date: d, penNo: penNo, area: getPenAreaForCurrent_(ss, penNo) };
    }
    if (status) {
      statusEvents.push({ date: d, status: status });
      if (!latestStatus || shouldReplaceStatus_(latestStatus, status, d)) {
        latestStatus = { date: d, status: status };
      }
    }
    if (bt !== '' && bt !== null && bt !== undefined) {
      btHistory.push({ date: toDateString(d), bt: bt });
    }
  }

  if (!latestPen || (latestStatus && isRetiredStatus_(latestStatus.status))) {
    removeCurrentRow_(ss, sn);
    return;
  }

  var latestMatingStr = latestMating ? toDateString(latestMating) : '';
  var latestFarrowingStr = latestFarrowing ? toDateString(latestFarrowing) : '';
  var activeMating = latestMating && (!latestFarrowing || latestMating >= latestFarrowing);
  var breedingDone = '';
  var postMatingDone = '';
  var reheatDone = '';
  var pregDone = '';
  var emptyDate = '';
  statusEvents.sort(function(a, b) { return a.date - b.date; });
  for (var j = 0; j < statusEvents.length; j++) {
    var ev = statusEvents[j];
    if (ev.status === '測定終了' && ev.date >= latestPen.date && (!latestMating || latestPen.date > latestMating)) {
      breedingDone = toDateString(ev.date);
    } else if (isPostMatingDoneStatus_(ev.status) && activeMating && ev.date >= latestMating) {
      postMatingDone = toDateString(ev.date);
    } else if (ev.status === '再発情確認終了' && activeMating && ev.date >= latestMating) {
      reheatDone = toDateString(ev.date);
    } else if (ev.status === '妊娠鑑定済' && activeMating && ev.date >= latestMating) {
      pregDone = toDateString(ev.date);
    } else if (ev.status === '空胎' && activeMating && ev.date >= latestMating) {
      emptyDate = toDateString(ev.date);
    }
  }

  var matingStatus = '';
  if (activeMating) {
    if (emptyDate) {
      matingStatus = '空胎';
      if (!reheatDone) reheatDone = emptyDate;
    } else if (pregDone) {
      matingStatus = '妊娠鑑定済';
      if (!reheatDone) reheatDone = pregDone;
    } else {
      matingStatus = '通常';
    }
  }
  btHistory.sort(function(a, b) { return String(b.date).localeCompare(String(a.date)); });
  upsertCurrentRow_(ss, sn, {
    sowNo: sn,
    penNo: latestPen.penNo,
    area: latestPen.area,
    latestMoveDate: toDateString(latestPen.date),
    latestMatingDate: latestMatingStr,
    latestFarrowingDate: latestFarrowingStr,
    matingStatus: matingStatus,
    breedingDoneDate: breedingDone,
    postMatingDoneDate: postMatingDone,
    reheatDoneDate: reheatDone,
    pregnancyDoneDate: pregDone,
    emptyDate: emptyDate,
    btHistory: btHistory.slice(0, 10)
  });
}

function recordMovement(sowNo, penNo, dateStr, authToken) {
  requireAuth_(authToken);
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var ss = getSpreadsheet();
    var sn = String(sowNo);
    penNo = normalizePenNo(penNo);
    var area = getPenAreaForCurrent_(ss, penNo);
    if (!area) throw new Error('ペンマスタにないPENです。');
    var date = parseInputDate(dateStr);
    var ds = toDateString(date);
    ss.getSheetByName('繁殖管理').appendRow([date, sn, penNo, '', '']);
    upsertCurrentRow_(ss, sn, {
      penNo: penNo,
      area: area,
      latestMoveDate: ds,
      breedingDoneDate: ''
    });
    invalidateInitialCache_();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  } finally { lock.releaseLock(); }
}

function recordBTValue(sowNo, bt, dateStr, authToken) {
  requireAuth_(authToken);
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var ss = getSpreadsheet();
    var sn = String(sowNo);
    var date = parseInputDate(dateStr);
    var ds = toDateString(date);
    ss.getSheetByName('繁殖管理').appendRow([date, sn, '', bt, '']);
    addBtToCurrent_(ss, sn, bt, ds);
    invalidateInitialCache_();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  } finally { lock.releaseLock(); }
}

function recordStatusChange(sowNo, status, dateStr, authToken) {
  requireAuth_(authToken);
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var ss = getSpreadsheet();
    var sn = String(sowNo);
    var date = parseInputDate(dateStr);
    var ds = toDateString(date);
    ss.getSheetByName('繁殖管理').appendRow([date, sn, '', '', status]);
    if (isRetiredStatus_(status)) {
      removeCurrentRow_(ss, sn);
    } else if (status === '測定終了') {
      upsertCurrentRow_(ss, sn, { breedingDoneDate: ds });
    } else if (isPostMatingDoneStatus_(status)) {
      upsertCurrentRow_(ss, sn, { postMatingDoneDate: ds });
    } else if (isReheatCheckDoneStatus_(status)) {
      upsertCurrentRow_(ss, sn, { reheatDoneDate: ds });
    } else if (status === '妊娠鑑定済') {
      upsertCurrentRow_(ss, sn, { pregnancyDoneDate: ds, matingStatus: '妊娠鑑定済' });
    } else if (status === '空胎') {
      upsertCurrentRow_(ss, sn, { emptyDate: ds, matingStatus: '空胎' });
    } else if (status === '通常') {
      upsertCurrentRow_(ss, sn, { matingStatus: '通常' });
    }
    invalidateInitialCache_();
    return { success: true, status: status };
  } catch (e) {
    return { success: false, error: e.message };
  } finally { lock.releaseLock(); }
}

function recordMating(sowNo, dateStr, authToken) {
  requireAuth_(authToken);
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var ss = getSpreadsheet();
    var sn = String(sowNo);
    var date = parseInputDate(dateStr);
    var ds = toDateString(date);
    ss.getSheetByName('種付').appendRow([sn, date, '', '']);
    ss.getSheetByName('繁殖管理').appendRow([date, sn, '', '', '通常']);
    upsertCurrentRow_(ss, sn, {
      latestMatingDate: ds,
      matingStatus: '通常',
      breedingDoneDate: '',
      postMatingDoneDate: '',
      reheatDoneDate: '',
      pregnancyDoneDate: '',
      emptyDate: ''
    });
    // 種付Mapキャッシュを差分更新（シート再読み不要）
    updateMatingMapCache_(sn, ds);
    invalidateInitialCache_();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  } finally { lock.releaseLock(); }
}

function recordFarrowing(sowNo, dateStr, totalBorn, stillBorn, authToken) {
  requireAuth_(authToken);
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var ss = getSpreadsheet();
    var sn = String(sowNo);
    var date = parseInputDate(dateStr);
    var ds = toDateString(date);
    ss.getSheetByName('分娩').appendRow([sn, date, totalBorn || 0, stillBorn || 0]);
    upsertCurrentRow_(ss, sn, {
      latestFarrowingDate: ds,
      matingStatus: '',
      breedingDoneDate: '',
      postMatingDoneDate: '',
      reheatDoneDate: '',
      pregnancyDoneDate: '',
      emptyDate: ''
    });
    invalidateInitialCache_();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  } finally { lock.releaseLock(); }
}

/**
 * 離乳記録と分娩舎から繁殖舎への移動を1操作で保存する。
 * 途中で失敗した場合は追加行を戻し、現在状況も元データから再構築する。
 */
function recordWeaning(sowNo, dateStr, weanedCount, targetPen, authToken) {
  requireAuth_(authToken);
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var ss = getSpreadsheet();
    var sn = normalizeSowNo(sowNo);
    if (!sn) throw new Error('母豚Noを確認してください');

    var countText = weanedCount === null || weanedCount === undefined ? '' : String(weanedCount).trim();
    var count = Number(countText);
    if (countText === '' || !isFinite(count) || count < 0 || Math.floor(count) !== count) {
      throw new Error('離乳頭数を0以上の整数で入力してください');
    }

    var penNo = normalizePenNo(targetPen);
    var area = getPenAreaForCurrent_(ss, penNo);
    if (area !== '繁殖舎') throw new Error('移動先は繁殖舎のPENを指定してください');

    var inputDate = String(dateStr || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(inputDate)) throw new Error('離乳日を確認してください');
    var date = parseInputDate(inputDate);
    if (isNaN(date.getTime()) || toDateString(date) !== inputDate) throw new Error('離乳日を確認してください');
    var ds = toDateString(date);

    var current = findCurrentRow_(ensureCurrentStatusSheet_(ss), sn);
    if (!current.row || current.row.area !== '分娩舎') {
      throw new Error('No.' + sn + ' は現在、分娩舎にいません');
    }

    var weaningSheet = ss.getSheetByName('離乳');
    var breedingSheet = ss.getSheetByName('繁殖管理');
    if (!weaningSheet) throw new Error('離乳シートが見つかりません');
    if (!breedingSheet) throw new Error('繁殖管理シートが見つかりません');

    var weaningRow = weaningSheet.getLastRow() + 1;
    var breedingRow = breedingSheet.getLastRow() + 1;
    var wroteWeaning = false;
    var wroteBreeding = false;
    try {
      weaningSheet.getRange(weaningRow, 1, 1, 4).setValues([[sn, date, count, '']]);
      wroteWeaning = true;
      breedingSheet.getRange(breedingRow, 1, 1, 5).setValues([[date, sn, penNo, '', '離乳']]);
      wroteBreeding = true;
      upsertCurrentRow_(ss, sn, {
        penNo: penNo,
        area: area,
        latestMoveDate: ds,
        matingStatus: '',
        breedingDoneDate: '',
        postMatingDoneDate: '',
        reheatDoneDate: '',
        pregnancyDoneDate: '',
        emptyDate: ''
      });
    } catch (writeError) {
      if (wroteBreeding && breedingSheet.getLastRow() >= breedingRow) breedingSheet.deleteRow(breedingRow);
      if (wroteWeaning && weaningSheet.getLastRow() >= weaningRow) weaningSheet.deleteRow(weaningRow);
      try { syncCurrentStatusForSow_(ss, sn); } catch (syncError) {}
      throw writeError;
    }

    try { invalidateInitialCache_(); } catch (cacheError) {}
    return { success: true, sowNo: sn, penNo: penNo, weanedCount: count, status: '離乳' };
  } catch (e) {
    return { success: false, error: e.message };
  } finally { lock.releaseLock(); }
}

/**
 * 種付シートの1行を削除（タイプミス修正用）
 * 末尾から検索して母豚No+日付一致の最初の行を削除
 * 同日に複数種付が記録された場合は末尾（最新）から1件のみ削除
 */
function deleteMatingRecord(sowNo, dateStr, authToken) {
  requireAuth_(authToken);
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName('種付');
    var data = sheet.getDataRange().getValues();
    var sn = String(sowNo);

    for (var i = data.length - 1; i >= 1; i--) {
      var row = data[i];
      if (normalizeSowNo(row[0]) !== sn) continue;
      if (dateStr && toDateString(row[1]) !== dateStr) continue;

      sheet.deleteRow(i + 1);
      // 種付Mapキャッシュは末尾200行から再構築されるので、削除後はリセット
      try { getCache_().remove(CACHE_KEY_MATING); } catch(e) {}
      syncCurrentStatusForSow_(ss, sn);
      invalidateInitialCache_();
      return { success: true };
    }
    return { success: false, error: '該当する種付記録が見つかりません' };
  } catch (e) {
    return { success: false, error: e.message };
  } finally { lock.releaseLock(); }
}

function deleteFarrowingRecord(sowNo, dateStr, totalBorn, stillBorn, authToken) {
  requireAuth_(authToken);
  return deleteLifecycleRecord_('分娩', sowNo, dateStr, totalBorn, stillBorn);
}

function deleteWeaningRecord(sowNo, dateStr, weanedCount, deathCount, authToken) {
  requireAuth_(authToken);
  return deleteLifecycleRecord_('離乳', sowNo, dateStr, weanedCount, deathCount);
}

function deleteLifecycleRecord_(sheetName, sowNo, dateStr, value1, value2) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return { success: false, error: sheetName + 'シートが見つかりません' };
    var data = sheet.getDataRange().getValues();
    var sn = String(sowNo);

    for (var i = data.length - 1; i >= 1; i--) {
      var row = data[i];
      if (normalizeSowNo(row[0]) !== sn) continue;
      if (dateStr && toDateString(row[1]) !== dateStr) continue;
      if (value1 !== null && value1 !== undefined && value1 !== '' && Number(row[2]) !== Number(value1)) continue;
      if (value2 !== null && value2 !== undefined && value2 !== '' && Number(row[3]) !== Number(value2)) continue;

      sheet.deleteRow(i + 1);
      syncCurrentStatusForSow_(ss, sn);
      invalidateInitialCache_();
      return { success: true };
    }
    return { success: false, error: '該当する' + sheetName + '記録が見つかりません' };
  } catch (e) {
    return { success: false, error: e.message };
  } finally { lock.releaseLock(); }
}

/**
 * 繁殖管理シートの1行を削除（タイプミス修正用）
 * 末尾から検索して最初に一致した行を削除
 */
function deleteBreedingRecord(sowNo, dateStr, penNo, bt, status, authToken) {
  requireAuth_(authToken);
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName('繁殖管理');
    var data = sheet.getDataRange().getValues();
    var sn = String(sowNo);

    for (var i = data.length - 1; i >= 1; i--) {
      var row = data[i];
      if (normalizeSowNo(row[1]) !== sn) continue;
      if (dateStr && toDateString(row[0]) !== dateStr) continue;
      if (penNo && String(row[2]) !== String(penNo)) continue;
      if (bt !== null && bt !== undefined && bt !== '' && Math.abs(Number(row[3]) - Number(bt)) > 0.001) continue;
      if (status && String(row[4]) !== String(status)) continue;

      sheet.deleteRow(i + 1);
      syncCurrentStatusForSow_(ss, sn);
      invalidateInitialCache_();
      return { success: true };
    }
    return { success: false, error: '該当する記録が見つかりません' };
  } catch (e) {
    return { success: false, error: e.message };
  } finally { lock.releaseLock(); }
}

// ============================================================
//  ほ育事故
// ============================================================

/** ほ育事故シートの直近30件を取得（日付降順） */
function getRecentAccidents_(ss) {
  var sheet = ss.getSheetByName('ほ育事故');
  if (!sheet || sheet.getLastRow() <= 1) return [];
  var data = getSheetDataTail(ss, 'ほ育事故', 30);
  var result = [];
  for (var i = 1; i < data.length; i++) {
    var sowNo = normalizeSowNo(data[i][0]);
    var date = data[i][1];
    var count = Number(data[i][2]) || 0;
    if (!sowNo) continue;
    result.push({ sowNo: sowNo, date: date instanceof Date ? toDateString(date) : String(date), count: count });
  }
  result.sort(function(a, b) { return b.date.localeCompare(a.date); });
  return result;
}

/** ほ育事故を記録 シート列: [母豚No, 日付, 頭数] */
function recordNursingAccident(sowNo, dateStr, count, authToken) {
  requireAuth_(authToken);
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName('ほ育事故');
    if (!sheet) {
      sheet = ss.insertSheet('ほ育事故');
      sheet.getRange(1, 1, 1, 3).setValues([['母豚No', '日付', '頭数']]);
      sheet.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#d93025').setFontColor('#ffffff');
      sheet.getRange('B2:B').setNumberFormat('yyyy/mm/dd');
    }
    var sn = String(sowNo);
    sheet.appendRow([sn, parseInputDate(dateStr), count]);
    invalidateInitialCache_();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  } finally { lock.releaseLock(); }
}
