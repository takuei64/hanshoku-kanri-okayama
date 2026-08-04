/**
 * ペン作業（子豚向け処置・母豚ワクチン）API
 *
 * シート: ペン作業 [日付, ペンNo, 作業種別]
 * 対象ペン:
 *   - 分娩舎: 分娩日を起点に子豚処置と母豚ワクチンを管理
 *   - 交配舎（ペンマスタ上は「ストール」）: 種付日を起点に母豚ワクチンを管理
 */

var PEN_TASK_MASTER_SHEET = '作業マスタ';

/** 岡山農場固有の作業種別をシートから取得する。 */
function getPenTaskConfig_(ss) {
  var config = { farrowingTypes: [], breedingTypes: [], days: {}, allTypes: {} };
  var sheet = ss.getSheetByName(PEN_TASK_MASTER_SHEET);
  if (!sheet || sheet.getLastRow() <= 1) return config;

  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getDisplayValues();
  var entries = [];
  for (var i = 0; i < rows.length; i++) {
    var area = String(rows[i][0] || '').trim();
    var type = String(rows[i][1] || '').trim();
    var dueDay = Number(rows[i][2]);
    var order = Number(rows[i][3]);
    var enabled = String(rows[i][4] || '').trim().toLowerCase();
    if (!type || enabled === 'false' || enabled === '0' || enabled === '無効' || enabled === 'いいえ') continue;
    var areaType = /分娩|子豚|farrow/i.test(area) ? 'farrowing' :
      (/繁殖|交配|種付|ストール|breed/i.test(area) ? 'breeding' : '');
    if (!areaType) continue;
    entries.push({ areaType: areaType, type: type, dueDay: dueDay, order: order || 9999, row: i });
  }

  entries.sort(function(a, b) { return a.order - b.order || a.row - b.row; });
  entries.forEach(function(entry) {
    if (entry.areaType === 'farrowing') config.farrowingTypes.push(entry.type);
    if (entry.areaType === 'breeding') config.breedingTypes.push(entry.type);
    config.days[entry.type] = entry.dueDay;
    config.allTypes[entry.type] = true;
  });
  return config;
}

/** ペン作業シートを取得（無ければ作成） */
function ensurePenTaskSheet_(ss) {
  var sheet = ss.getSheetByName('ペン作業');
  if (sheet) return sheet;
  sheet = ss.insertSheet('ペン作業');
  sheet.getRange(1, 1, 1, 3).setValues([['日付', 'ペンNo', '作業種別']]);
  sheet.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#9b59b6').setFontColor('#ffffff');
  sheet.getRange('A2:A').setNumberFormat('yyyy/mm/dd');
  sheet.setColumnWidth(1, 110);
  sheet.setColumnWidth(2, 80);
  sheet.setColumnWidth(3, 120);
  return sheet;
}

/**
 * 「ペンNo→{作業種別→最終実施日(yyyy-MM-dd)}」のマップを構築
 */
function getPenTaskMap_(ss) {
  var sheet = ensurePenTaskSheet_(ss);
  if (sheet.getLastRow() <= 1) return {};
  var data = sheet.getDataRange().getValues();
  var map = {};
  for (var i = 1; i < data.length; i++) {
    var date = data[i][0];
    var penNo = data[i][1];
    var type = data[i][2];
    if (!penNo || !type || !(date instanceof Date)) continue;
    var penKey = String(penNo);
    var ds = toDateString(date);
    if (!map[penKey]) map[penKey] = {};
    if (!map[penKey][type] || ds > map[penKey][type]) map[penKey][type] = ds;
  }
  return map;
}

/**
 * 指定ペン・ロットの作業状態を構築
 */
function buildPenTaskStates_(taskMap, penKey, startStr, ageDays, taskTypes, taskDays) {
  var tasks = {};
  for (var i = 0; i < taskTypes.length; i++) {
    var type = taskTypes[i];
    var doneDate = (taskMap[penKey] && taskMap[penKey][type]) || '';
    // 実施日が今回の分娩・種付より前なら、前ロットの記録として扱う
    if (doneDate && doneDate < startStr) doneDate = '';
    var dueDay = Number(taskDays[type]) || 0;
    var state = doneDate ? 'done' : (dueDay > 0 && ageDays >= dueDay ? 'overdue' : 'pending');
    tasks[type] = { date: doneDate, state: state, dueDay: dueDay };
  }
  return tasks;
}

function isBreedingPenInfo_(info) {
  var area = String(info.area || '').trim();
  return area === 'ストール' || area === '交配舎' || area === '種付舎' || area === '繁殖舎';
}

/**
 * 作業対象ペン一覧（行データ）を構築
 * 分娩舎と交配舎を別グループとして返す。
 */
function buildPenTaskList_(ss, parsed, latestFarrowingMap, latestMatingMap) {
  var taskMap = getPenTaskMap_(ss);
  var taskConfig = getPenTaskConfig_(ss);
  var latestPen = parsed.latestPen;
  var latestStatus = parsed.latestStatus;
  var today = new Date();
  today.setHours(0, 0, 0, 0);

  var currentRowsBySow = {};
  var currentRows = parsed.currentRows || [];
  for (var cr = 0; cr < currentRows.length; cr++) {
    currentRowsBySow[String(currentRows[cr].sowNo)] = currentRows[cr];
  }

  // 分娩舎: 起点日の優先順位は分娩日 → 種付+114日の推定日 → ペン移動日
  var farrowingGroups = {};
  // 交配舎: 種付日を起点に母豚ワクチンを管理
  var breedingGroups = {};

  for (var sowNo in latestPen) {
    if (isRetiredSow_(latestStatus, sowNo)) continue;
    var info = latestPen[sowNo];
    var penKey = String(info.penNo);

    if (info.area === '分娩舎') {
      if (!farrowingGroups[penKey]) {
        farrowingGroups[penKey] = {
          penNo: info.penNo, sows: [], latestFarrowStr: '', estDueStr: '', oldestMoveStr: ''
        };
      }
      var fg = farrowingGroups[penKey];
      fg.sows.push(String(sowNo));
      var farrowStr = latestFarrowingMap[sowNo];
      if (farrowStr && farrowStr > fg.latestFarrowStr) fg.latestFarrowStr = farrowStr;

      if (latestMatingMap && latestMatingMap[sowNo]) {
        var mp = latestMatingMap[sowNo].split('-');
        var due = new Date(Number(mp[0]), Number(mp[1]) - 1, Number(mp[2]));
        due.setDate(due.getDate() + 114);
        if (due <= today) {
          var dueStr = toDateString(due);
          if (dueStr > fg.estDueStr) fg.estDueStr = dueStr;
        }
      }
      if (info.date instanceof Date) {
        var moveStr = toDateString(info.date);
        if (!fg.oldestMoveStr || moveStr < fg.oldestMoveStr) fg.oldestMoveStr = moveStr;
      }
      continue;
    }

    if (!isBreedingPenInfo_(info)) continue;
    var mateStr = latestMatingMap && latestMatingMap[sowNo];
    if (!mateStr) continue;
    var latestFarrowStr = latestFarrowingMap[sowNo] || '';
    if (latestFarrowStr && latestFarrowStr > mateStr) continue;
    var currentRow = currentRowsBySow[String(sowNo)];
    if (latestStatus[sowNo] && latestStatus[sowNo].status === '空胎') continue;
    if (currentRow && currentRow.emptyDate && currentRow.emptyDate >= mateStr) continue;

    if (!breedingGroups[penKey]) {
      breedingGroups[penKey] = { penNo: info.penNo, sows: [], latestMatingStr: '' };
    }
    var bg = breedingGroups[penKey];
    bg.sows.push(String(sowNo));
    if (mateStr > bg.latestMatingStr) bg.latestMatingStr = mateStr;
  }

  var result = [];
  for (var farrowingPenKey in farrowingGroups) {
    var f = farrowingGroups[farrowingPenKey];
    var farrowingStartStr = f.latestFarrowStr || f.estDueStr || f.oldestMoveStr;
    if (!farrowingStartStr) continue;
    var fp = farrowingStartStr.split('-');
    var farrowingStartDate = new Date(Number(fp[0]), Number(fp[1]) - 1, Number(fp[2]));
    var farrowingAgeDays = daysBetween(farrowingStartDate, today);
    if (farrowingAgeDays < 0 || farrowingAgeDays > 50) continue;
    result.push({
      areaType: 'farrowing',
      penNo: f.penNo,
      sows: f.sows.sort(function(a, b) { return (parseInt(a) || 0) - (parseInt(b) || 0); }),
      startDate: farrowingStartStr,
      startSource: f.latestFarrowStr ? 'farrow' : (f.estDueStr ? 'estimated' : 'move'),
      ageDays: farrowingAgeDays,
      dayLabel: '日齢',
      taskTypes: taskConfig.farrowingTypes.slice(),
      tasks: buildPenTaskStates_(taskMap, farrowingPenKey, farrowingStartStr, farrowingAgeDays, taskConfig.farrowingTypes, taskConfig.days)
    });
  }

  for (var breedingPenKey in breedingGroups) {
    var b = breedingGroups[breedingPenKey];
    var bp = b.latestMatingStr.split('-');
    var breedingStartDate = new Date(Number(bp[0]), Number(bp[1]) - 1, Number(bp[2]));
    var matingDays = daysBetween(breedingStartDate, today);
    if (matingDays < 0 || matingDays > 150) continue;
    result.push({
      areaType: 'breeding',
      penNo: b.penNo,
      sows: b.sows.sort(function(a, b) { return (parseInt(a) || 0) - (parseInt(b) || 0); }),
      startDate: b.latestMatingStr,
      startSource: 'mating',
      ageDays: matingDays,
      dayLabel: '種付後',
      taskTypes: taskConfig.breedingTypes.slice(),
      tasks: buildPenTaskStates_(taskMap, breedingPenKey, b.latestMatingStr, matingDays, taskConfig.breedingTypes, taskConfig.days)
    });
  }

  result.sort(function(a, b) {
    if (a.areaType !== b.areaType) return a.areaType === 'farrowing' ? -1 : 1;
    return (parseInt(a.penNo) || 99999) - (parseInt(b.penNo) || 99999);
  });
  return result;
}

/**
 * 【デバッグ】ペン作業の起点日と日齢を可視化
 */
function debugPenTaskAge_() {
  var ss = getSpreadsheet();
  var breedingData = getSheetData(ss, '繁殖管理');
  var penMaster = getSheetData(ss, 'ペンマスタ');
  var penAreaMap = {};
  for (var i = 1; i < penMaster.length; i++) {
    var masterPenNo = normalizePenNo(penMaster[i][0]);
    if (masterPenNo) penAreaMap[masterPenNo] = penMaster[i][1];
  }
  var parsed = parseBreedingData_(breedingData, penAreaMap);
  var latestFarrowingMap = getLatestFarrowingMap_(ss);
  var latestMatingMap = getLatestMatingMap_();
  var list = buildPenTaskList_(ss, parsed, latestFarrowingMap, latestMatingMap);
  var lines = ['=== ペン作業 表示対象 ' + list.length + '件 ==='];
  for (var i = 0; i < list.length; i++) {
    var p = list[i];
    var src = p.startSource === 'farrow' ? '分娩' : p.startSource === 'estimated' ? '推定' :
      p.startSource === 'mating' ? '種付' : '移動';
    lines.push('Pen ' + p.penNo + ' 起点=' + p.startDate + '(' + src + ') ' +
      (p.dayLabel || '日齢') + p.ageDays + '日 母豚[' + p.sows.join(',') + ']');
  }
  return lines.join('\n');
}

/**
 * 作業を記録（複数種別を一括）
 * @param {string|number} penNo ペン番号
 * @param {Array<string>} types 作業種別配列
 * @param {string} dateStr 'yyyy-MM-dd'
 */
function recordPenTasks(penNo, types, dateStr, authToken) {
  requireAuth_(authToken);
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var ss = getSpreadsheet();
    var sheet = ensurePenTaskSheet_(ss);
    var taskConfig = getPenTaskConfig_(ss);
    var date = parseInputDate(dateStr);
    var rows = [];
    for (var i = 0; i < types.length; i++) {
      var type = String(types[i] || '').trim();
      if (!type) continue;
      if (!taskConfig.allTypes[type]) return { success: false, error: '作業マスタにない作業種別です: ' + type };
      rows.push([date, Number(penNo) || penNo, type]);
    }
    if (rows.length === 0) return { success: false, error: '作業種別が選択されていません' };
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 3).setValues(rows);
    invalidateInitialCache_();
    return { success: true, count: rows.length };
  } catch (e) {
    return { success: false, error: e.message };
  } finally { lock.releaseLock(); }
}

/**
 * 作業記録を1件削除（取消用）
 */
function deletePenTask(penNo, type, dateStr, authToken) {
  requireAuth_(authToken);
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var ss = getSpreadsheet();
    var sheet = ensurePenTaskSheet_(ss);
    if (sheet.getLastRow() <= 1) return { success: false, error: '記録なし' };
    var data = sheet.getDataRange().getValues();
    var penKey = String(penNo);
    for (var i = data.length - 1; i >= 1; i--) {
      var row = data[i];
      if (String(row[1]) !== penKey) continue;
      if (String(row[2]) !== String(type)) continue;
      if (dateStr && toDateString(row[0]) !== dateStr) continue;
      sheet.deleteRow(i + 1);
      invalidateInitialCache_();
      return { success: true };
    }
    return { success: false, error: '該当する記録が見つかりません' };
  } catch (e) {
    return { success: false, error: e.message };
  } finally { lock.releaseLock(); }
}
