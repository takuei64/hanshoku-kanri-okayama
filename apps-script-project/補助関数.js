/**
 * 補助関数（共通ユーティリティ）
 */

/** スプレッドシートを取得（キャッシュ用） */
function getSpreadsheet() {
  return SpreadsheetApp.openById(OKAYAMA_SPREADSHEET_ID);
}

/** シートデータを一括取得 */
function getSheetData(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() === 0) return [[]];
  return sheet.getDataRange().getValues();
}

/**
 * シートの末尾N行だけ読み取る（大量データシート用）
 * ヘッダー行（1行目）+ 末尾maxRows行を返す
 */
function getSheetDataTail(ss, sheetName, maxRows) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() <= 1) return [[]];
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastCol).getValues();
  var dataStart = Math.max(2, lastRow - maxRows + 1);
  var numRows = lastRow - dataStart + 1;
  var data = sheet.getRange(dataStart, 1, numRows, lastCol).getValues();
  return header.concat(data);
}

/** Dateを0時0分に正規化（日数計算用） */
function toMidnight(d) {
  var dt = new Date(d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

/** 2つの日付間の日数差（時刻を無視） */
function daysBetween(from, to) {
  return Math.floor((toMidnight(to) - toMidnight(from)) / 86400000);
}

/** DateをISO日付文字列に変換（google.script.run対応） */
function toDateString(d) {
  if (!(d instanceof Date)) return d ? String(d) : '';
  return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd');
}

/**
 * セルから読み取った母豚Noを文字列に正規化
 * 列フォーマットが日付の場合Dateオブジェクトで返るため、シリアル値から復元する
 * 「?」付きなど非数値の母豚Noにも対応するため文字列で統一
 */
function normalizeSowNo(val) {
  if (val instanceof Date) {
    var epoch = new Date(1899, 11, 30);
    return String(Math.round((val.getTime() - epoch.getTime()) / 86400000));
  }
  if (val === 0 || val === '') return '';
  return String(val);
}

/** ペンNoを比較・マスタ参照用に正規化（全角数字・空白対策） */
function normalizePenNo(val) {
  if (val === null || val === undefined || val === '') return '';
  var s = String(val)
    .replace(/[０-９]/g, function(ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
    })
    .trim();
  var match = s.match(/\d+/);
  return match ? match[0] : s;
}

/** シートの最大IDから次のIDを計算 */
function getNextIdFromSheet(sheet) {
  const data = sheet.getDataRange().getValues();
  let maxId = 0;
  for (let i = 1; i < data.length; i++) {
    const id = Number(data[i][0]);
    if (id > maxId) maxId = id;
  }
  return maxId + 1;
}

/** 移動記録データから最新ペンMapを構築 */
function buildLatestPenMap(movementData) {
  const penMap = {};
  for (let i = 1; i < movementData.length; i++) {
    const row = movementData[i];
    const sowNo = row[2];
    const date = row[1];
    const pen = row[3];
    if (!sowNo || !(date instanceof Date)) continue;
    if (!penMap[sowNo] || date >= penMap[sowNo].date) {
      penMap[sowNo] = { date: date, pen: pen };
    }
  }
  const result = {};
  for (const k in penMap) result[k] = penMap[k].pen;
  return result;
}

/**
 * 指定母豚の現在地（最新の移動記録のペンNo）を返す
 * @param {number} sowNo 母豚番号
 * @return {number|string} ペンNo または "不明"
 */
function getCurrentPen(sowNo, authToken) {
  requireAuth_(authToken);
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('移動記録');
  if (!sheet) return '不明';

  const data = sheet.getDataRange().getValues();
  let latestDate = null;
  let latestPen = '不明';

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    // row: [ID, 日付, 母豚No, ペンNo, 移動理由, 備考]
    if (row[2] == sowNo && row[1] instanceof Date) {
      if (!latestDate || row[1] > latestDate) {
        latestDate = row[1];
        latestPen = row[3];
      }
    }
  }
  return latestPen;
}

/**
 * 指定母豚の最新の繁殖管理ステータスを返す
 * @param {number} sowNo 母豚番号
 * @return {string} ステータス または "記録なし"
 */
function getBreedingStatus(sowNo, authToken) {
  requireAuth_(authToken);
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('繁殖管理');
  if (!sheet) return '記録なし';

  const data = sheet.getDataRange().getValues();
  let latestDate = null;
  let latestStatus = '記録なし';

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    // row: [日付, 母豚No, ペンNo, BT値, ステータス]
    if (normalizeSowNo(row[1]) == normalizeSowNo(sowNo) && row[0] instanceof Date && row[4]) {
      if (!latestDate || row[0] > latestDate || (row[0].getTime() === latestDate.getTime() && getStatusPriorityForDisplay_(row[4]) >= getStatusPriorityForDisplay_(latestStatus))) {
        latestDate = row[0];
        latestStatus = row[4];
      }
    }
  }
  return latestStatus;
}

function getStatusPriorityForDisplay_(status) {
  if (String(status || '').indexOf('廃用') >= 0) return 100;
  if (status === '空胎') return 40;
  if (status === '妊娠鑑定済') return 30;
  if (status === '測定終了') return 20;
  if (status === '通常') return 10;
  return 0;
}

/**
 * 指定母豚の分娩予定日（最新の種付日 + 114日）を返す
 * @param {number} sowNo 母豚番号
 * @return {Date|string} 分娩予定日 または "種付記録なし"
 */
function getDueDate(sowNo, authToken) {
  requireAuth_(authToken);
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('種付');
  if (!sheet) return '種付記録なし';

  const data = sheet.getDataRange().getValues();
  let latestDate = null;

  // 種付シートのカラム構成を探す（母豚No列と日付列）
  const headers = data[0].map(h => String(h).trim());
  const sowCol = headers.findIndex(h => h.includes('母豚'));
  const dateCol = headers.findIndex(h => h.includes('日') || h.includes('種付日'));

  if (sowCol === -1 || dateCol === -1) return '種付記録なし';

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[sowCol] == sowNo && row[dateCol] instanceof Date) {
      if (!latestDate || row[dateCol] > latestDate) {
        latestDate = row[dateCol];
      }
    }
  }

  if (!latestDate) return '種付記録なし';

  const dueDate = new Date(latestDate);
  dueDate.setDate(dueDate.getDate() + 114);
  return dueDate;
}

/**
 * 指定母豚の直近N日分のBT値を返す
 * @param {number} sowNo 母豚番号
 * @param {number} days 遡る日数（デフォルト7）
 * @return {Array} [[日付, BT値], ...] 日付降順
 */
function getBTHistory(sowNo, days, authToken) {
  requireAuth_(authToken);
  days = days || 7;
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('繁殖管理');
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const results = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    // row: [ID, 日付, 母豚No, BT値, ステータス, 備考]
    if (row[2] == sowNo && row[1] instanceof Date && row[1] >= cutoff) {
      results.push([row[1], row[3]]);
    }
  }

  // 日付降順でソート
  results.sort((a, b) => b[0] - a[0]);
  return results;
}

/**
 * 自動採番: 指定シートの最大IDに1を足した値を返す
 * AppSheetのINITIALVALUEで使用可能
 * @param {string} sheetName シート名
 * @return {number} 次のID
 */
function getNextId(sheetName, authToken) {
  requireAuth_(authToken);
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return 1;

  const data = sheet.getDataRange().getValues();
  let maxId = 0;
  for (let i = 1; i < data.length; i++) {
    const id = Number(data[i][0]);
    if (id > maxId) maxId = id;
  }
  return maxId + 1;
}
