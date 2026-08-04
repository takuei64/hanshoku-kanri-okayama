/**
 * ?付き番号の統合・新番号付与
 * 対象シート: 種付, 分娩, 離乳, 繁殖管理
 *
 * 統合（?を外す）: 391?, 437?, 5080?, 9312?
 * 新番号: 400? → 990, 472? → 991
 */
function fixSowNumbers(authToken) {
  requireAuth_(authToken);
  var ss = getSpreadsheet();
  var renameMap = {
    '391?': '391',
    '437?': '437',
    '5080?': '5080',
    '9312?': '9312',
    '400?': '990',
    '472?': '991'
  };

  var sheets = [
    { name: '種付', sowCol: 1 },      // A列=母豚No
    { name: '分娩', sowCol: 1 },      // A列=母豚No
    { name: '離乳', sowCol: 1 },      // A列=母豚No
    { name: '繁殖管理', sowCol: 2 }   // B列=母豚No
  ];

  var log = [];
  log.push('=== 母豚番号修正結果 ===');

  for (var s = 0; s < sheets.length; s++) {
    var sheetInfo = sheets[s];
    var sheet = ss.getSheetByName(sheetInfo.name);
    if (!sheet) continue;

    var data = sheet.getDataRange().getValues();
    var count = 0;

    for (var i = 1; i < data.length; i++) {
      var cellVal = normalizeSowNo(data[i][sheetInfo.sowCol - 1]);
      if (renameMap[cellVal]) {
        var newVal = renameMap[cellVal];
        sheet.getRange(i + 1, sheetInfo.sowCol).setValue(newVal);
        count++;
        log.push('  ' + sheetInfo.name + ' 行' + (i + 1) + ': ' + cellVal + ' → ' + newVal);
      }
    }
    log.push(sheetInfo.name + ': ' + count + '件修正');
  }

  // キャッシュクリア
  try {
    var c = CacheService.getScriptCache();
    c.remove('matingMap');
    c.remove('init_v2');
  } catch(e) {}

  var result = log.join('\n');
  Logger.log(result);
  return result;
}

/**
 * データ監査: 母豚記録と繁殖管理（移動記録）のクロスチェック
 * 実行: GASエディタから auditSowData() を実行 → ログ出力
 */
function auditSowData(authToken) {
  requireAuth_(authToken);
  var ss = getSpreadsheet();

  // 1) 母豚記録の全母豚No
  var sowData = getSheetData(ss, '母豚記録');
  var masterSows = {};
  for (var i = 1; i < sowData.length; i++) {
    var no = normalizeSowNo(sowData[i][0]);
    if (no) masterSows[no] = true;
  }

  // 2) 繁殖管理からペンNo付きレコードがある母豚No（＝移動記録あり）
  var breedData = getSheetData(ss, '繁殖管理');
  var breedingSows = {};      // 繁殖管理に存在する全母豚
  var sowsWithPen = {};       // ペン記録がある母豚
  var latestPen = {};         // 最新ペン情報
  for (var i = 1; i < breedData.length; i++) {
    var no = normalizeSowNo(breedData[i][1]);
    var date = breedData[i][0];
    var pen = breedData[i][2];
    if (!no) continue;
    breedingSows[no] = true;
    if (pen) {
      sowsWithPen[no] = true;
      if (date instanceof Date && (!latestPen[no] || date >= latestPen[no].date)) {
        latestPen[no] = { date: date, pen: pen };
      }
    }
  }

  // 3) 種付記録の母豚No
  var matingData = getSheetData(ss, '種付');
  var matingSows = {};
  for (var i = 1; i < matingData.length; i++) {
    var no = normalizeSowNo(matingData[i][0]);
    if (no) matingSows[no] = true;
  }

  // 4) 分娩記録の母豚No
  var farrowData = getSheetData(ss, '分娩');
  var farrowSows = {};
  for (var i = 1; i < farrowData.length; i++) {
    var no = normalizeSowNo(farrowData[i][0]);
    if (no) farrowSows[no] = true;
  }

  // === 分析 ===
  var log = [];
  log.push('=== データ監査結果 ===');
  log.push('母豚記録: ' + Object.keys(masterSows).length + '頭');
  log.push('繁殖管理に登場: ' + Object.keys(breedingSows).length + '頭');
  log.push('ペン記録あり: ' + Object.keys(sowsWithPen).length + '頭');
  log.push('種付記録あり: ' + Object.keys(matingSows).length + '頭');
  log.push('分娩記録あり: ' + Object.keys(farrowSows).length + '頭');
  log.push('');

  // A) 母豚記録にあるが移動記録（ペン）がない
  var masterNoPen = [];
  for (var no in masterSows) {
    if (!sowsWithPen[no]) masterNoPen.push(no);
  }
  log.push('【A】母豚記録にあるがペン記録なし: ' + masterNoPen.length + '頭');
  if (masterNoPen.length > 0) log.push('  ' + masterNoPen.sort().join(', '));
  log.push('');

  // B) 移動記録があるが母豚記録にない
  var penNoMaster = [];
  for (var no in sowsWithPen) {
    if (!masterSows[no]) penNoMaster.push(no);
  }
  log.push('【B】ペン記録あるが母豚記録にない: ' + penNoMaster.length + '頭');
  if (penNoMaster.length > 0) log.push('  ' + penNoMaster.sort().join(', '));
  log.push('');

  // C) 種付記録があるが母豚記録にない
  var matingNoMaster = [];
  for (var no in matingSows) {
    if (!masterSows[no]) matingNoMaster.push(no);
  }
  log.push('【C】種付記録あるが母豚記録にない: ' + matingNoMaster.length + '頭');
  if (matingNoMaster.length > 0) log.push('  ' + matingNoMaster.sort().join(', '));
  log.push('');

  // D) 類似番号の検出（数値部分が同じで?/-付きのペアがある）
  var allNos = {};
  for (var no in masterSows) allNos[no] = true;
  for (var no in breedingSows) allNos[no] = true;
  for (var no in matingSows) allNos[no] = true;
  for (var no in farrowSows) allNos[no] = true;

  var numericMap = {};
  for (var no in allNos) {
    var numPart = no.replace(/[^0-9]/g, '');
    if (!numericMap[numPart]) numericMap[numPart] = [];
    numericMap[numPart].push(no);
  }
  log.push('【D】類似番号グループ（同じ数字で異なる表記）:');
  var hasSimilar = false;
  for (var num in numericMap) {
    if (numericMap[num].length > 1) {
      hasSimilar = true;
      var items = numericMap[num];
      var details = [];
      for (var i = 0; i < items.length; i++) {
        var no = items[i];
        var where = [];
        if (masterSows[no]) where.push('母豚記録');
        if (sowsWithPen[no]) where.push('ペン記録');
        if (matingSows[no]) where.push('種付');
        if (farrowSows[no]) where.push('分娩');
        details.push(no + '(' + where.join(',') + ')');
      }
      log.push('  ' + details.join(' / '));
    }
  }
  if (!hasSimilar) log.push('  なし');
  log.push('');

  // E) 5桁以上の疑わしい番号
  log.push('【E】5桁以上の番号（入力ミスの可能性）:');
  var suspicious = [];
  for (var no in allNos) {
    var numPart = no.replace(/[^0-9]/g, '');
    if (numPart.length >= 5) {
      var where = [];
      if (masterSows[no]) where.push('母豚記録');
      if (breedingSows[no]) where.push('繁殖管理');
      if (matingSows[no]) where.push('種付');
      if (farrowSows[no]) where.push('分娩');
      suspicious.push(no + '(' + where.join(',') + ')');
    }
  }
  if (suspicious.length > 0) log.push('  ' + suspicious.join(', '));
  else log.push('  なし');
  log.push('');

  // F) 全母豚の所在サマリ（アクティブ母豚）
  var latestMatingMap = getLatestMatingMap_();
  var latestFarrowingMap = getLatestFarrowingMap_(ss);
  var today = new Date();
  today.setHours(0, 0, 0, 0);

  var activeSows = [];
  for (var no in masterSows) {
    var mateStr = latestMatingMap[no] || '';
    var farrowStr = latestFarrowingMap[no] || '';
    var active = false;
    if (mateStr) {
      var d = daysSince_(mateStr, today);
      if (d < 150) active = true;
    }
    if (!active && farrowStr) {
      var d = daysSince_(farrowStr, today);
      if (d < 50) active = true;
    }
    if (active) {
      activeSows.push({
        no: no,
        hasPen: !!sowsWithPen[no],
        pen: latestPen[no] ? latestPen[no].pen : 'なし'
      });
    }
  }
  log.push('【F】アクティブ母豚（母豚記録ベース）: ' + activeSows.length + '頭');
  var noPenActive = activeSows.filter(function(s) { return !s.hasPen; });
  log.push('  うちペン記録なし: ' + noPenActive.length + '頭');
  if (noPenActive.length > 0) {
    log.push('  ' + noPenActive.map(function(s) { return s.no; }).sort().join(', '));
  }

  var result = log.join('\n');
  Logger.log(result);
  return result;
}

/**
 * 不整合母豚の詳細調査
 * - アクティブだがペン未登録
 * - ペン記録あるが種付記録なし
 * - 種付ベースでのアクティブ母豚全体
 */
function auditMismatch(authToken) {
  requireAuth_(authToken);
  var ss = getSpreadsheet();
  var today = new Date();
  today.setHours(0, 0, 0, 0);

  // 繁殖管理のペン記録
  var breedData = getSheetData(ss, '繁殖管理');
  var sowsWithPen = {};
  var latestPen = {};
  for (var i = 1; i < breedData.length; i++) {
    var no = normalizeSowNo(breedData[i][1]);
    var date = breedData[i][0];
    var pen = breedData[i][2];
    if (!no || !pen || !(date instanceof Date)) continue;
    sowsWithPen[no] = true;
    if (!latestPen[no] || date >= latestPen[no].date) {
      latestPen[no] = { date: date, pen: pen };
    }
  }

  // 種付Map
  var latestMatingMap = getLatestMatingMap_();
  // 分娩Map
  var latestFarrowingMap = getLatestFarrowingMap_(ss);

  // 種付ベースのアクティブ母豚
  var allSows = {};
  for (var s in latestMatingMap) allSows[s] = true;
  for (var s in latestFarrowingMap) allSows[s] = true;

  var log = [];
  log.push('=== 不整合母豚 詳細 ===\n');

  // 1) アクティブだがペン未登録
  var noPen = [];
  for (var sowNo in allSows) {
    var mateStr = latestMatingMap[sowNo] || '';
    var farrowStr = latestFarrowingMap[sowNo] || '';
    var active = false;
    var info = '';
    if (mateStr && farrowStr) {
      if (mateStr >= farrowStr) {
        var d = daysSince_(mateStr, today);
        if (d < 150) { active = true; info = '種付' + d + '日 (' + mateStr + ')'; }
      } else {
        var d = daysSince_(farrowStr, today);
        if (d < 50) { active = true; info = '分娩' + d + '日 (' + farrowStr + ')'; }
      }
    } else if (mateStr) {
      var d = daysSince_(mateStr, today);
      if (d < 150) { active = true; info = '種付' + d + '日 (' + mateStr + ')'; }
    } else if (farrowStr) {
      var d = daysSince_(farrowStr, today);
      if (d < 50) { active = true; info = '分娩' + d + '日 (' + farrowStr + ')'; }
    }
    if (active && !sowsWithPen[sowNo]) {
      noPen.push({ no: sowNo, info: info });
    }
  }
  noPen.sort(function(a, b) { return a.no.localeCompare(b.no); });
  log.push('【1】アクティブだがペン未登録: ' + noPen.length + '頭');
  for (var i = 0; i < noPen.length; i++) {
    log.push('  ' + noPen[i].no + ' | ' + noPen[i].info);
  }
  log.push('');

  // 2) ペン記録あるが種付・分娩記録がない（移動記録の母豚NOが不明）
  var penNoMating = [];
  for (var sowNo in sowsWithPen) {
    if (!latestMatingMap[sowNo] && !latestFarrowingMap[sowNo]) {
      var p = latestPen[sowNo];
      penNoMating.push({ no: sowNo, pen: p.pen, date: toDateString(p.date) });
    }
  }
  penNoMating.sort(function(a, b) { return a.no.localeCompare(b.no); });
  log.push('【2】ペン記録あるが種付・分娩記録なし: ' + penNoMating.length + '頭');
  for (var i = 0; i < penNoMating.length; i++) {
    var s = penNoMating[i];
    log.push('  ' + s.no + ' | Pen ' + s.pen + ' (' + s.date + ')');
  }

  var result = log.join('\n');
  Logger.log(result);
  return result;
}

/**
 * 繁殖管理シートの全ペンレコードをダンプ（母豚No・ペンNo・日付）
 */
function dumpPenRecords(authToken) {
  requireAuth_(authToken);
  var ss = getSpreadsheet();
  var data = getSheetData(ss, '繁殖管理');
  var log = [];
  log.push('行 | セル値 | typeof | normalized | ペンNo | 日付');
  log.push('---');
  for (var i = 1; i < data.length; i++) {
    var raw = data[i][1];
    var pen = data[i][2];
    if (!pen) continue; // ペン記録がある行のみ
    var norm = normalizeSowNo(raw);
    var dateStr = toDateString(data[i][0]);
    var typeStr = (raw instanceof Date) ? 'Date' : typeof raw;
    log.push((i+1) + ' | ' + String(raw) + ' | ' + typeStr + ' | ' + norm + ' | Pen ' + pen + ' | ' + dateStr);
  }
  return log.join('\n');
}

/**
 * 特定母豚の繁殖管理全レコードを調査
 */
function searchBreedingRecords(targetNos, authToken) {
  requireAuth_(authToken);
  var ss = getSpreadsheet();
  var data = getSheetData(ss, '繁殖管理');
  var log = [];
  log.push('=== 繁殖管理 全レコード検索 ===');
  log.push('対象: ' + targetNos.join(', '));
  log.push('');

  var targets = {};
  for (var t = 0; t < targetNos.length; t++) targets[String(targetNos[t])] = true;

  for (var i = 1; i < data.length; i++) {
    var raw = data[i][1];
    var norm = normalizeSowNo(raw);
    // 完全一致 or 部分一致で検索
    var match = false;
    for (var t = 0; t < targetNos.length; t++) {
      var target = String(targetNos[t]);
      if (norm === target || String(raw) === target || String(raw).indexOf(target) >= 0) {
        match = true;
        break;
      }
    }
    if (!match) continue;

    var pen = data[i][2] || '';
    var bt = data[i][3] || '';
    var st = data[i][4] || '';
    var dateStr = toDateString(data[i][0]);
    var typeStr = (raw instanceof Date) ? 'Date' : typeof raw;
    var parts = [];
    if (pen) parts.push('Pen:' + pen);
    if (bt) parts.push('BT:' + bt);
    if (st) parts.push(st);
    log.push('行' + (i+1) + ' | raw=' + String(raw) + ' (' + typeStr + ') | norm=' + norm + ' | ' + dateStr + ' | ' + parts.join(' / '));
  }
  return log.join('\n');
}

/**
 * ?付き番号ペアの繁殖レコード詳細比較
 */
/**
 * 5桁誤入力の修正（繁殖管理シート）
 * 47200 → 472, 50800 → 508
 */
function fixFiveDigitNumbers(authToken) {
  requireAuth_(authToken);
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('繁殖管理');
  if (!sheet) return '繁殖管理シートが見つかりません';

  var fixMap = {
    '47200': '472',
    '50800': '508'
  };

  var data = sheet.getDataRange().getValues();
  var log = [];
  log.push('=== 5桁番号修正 (繁殖管理) ===');
  var count = 0;

  for (var i = 1; i < data.length; i++) {
    var cellVal = normalizeSowNo(data[i][1]); // B列 = index 1
    if (fixMap[cellVal]) {
      var newVal = fixMap[cellVal];
      sheet.getRange(i + 1, 2).setValue(newVal); // シート列2 = B列
      count++;
      log.push('  行' + (i + 1) + ': ' + cellVal + ' → ' + newVal);
    }
  }
  log.push('合計: ' + count + '件修正');

  // キャッシュクリア
  try {
    var c = CacheService.getScriptCache();
    c.remove('matingMap');
    c.remove('init_v2');
  } catch(e) {}

  var result = log.join('\n');
  Logger.log(result);
  return result;
}

/**
 * ペン未登録照合レポート（エリア別）
 *
 * ペン区分:
 *   1-58: 種付エリア（離乳→種付→妊娠鑑定）
 *   59-160+: 妊娠エリア（日齢順: 110台後半が分娩間近→120-160が若い→59-100が若い）
 *   1000+: 分娩エリア
 *
 * 自動マッチングはしない。エリア別に並べて目視照合。
 */
function reconcileSows(authToken) {
  requireAuth_(authToken);
  var ss = getSpreadsheet();
  var today = new Date();
  today.setHours(0, 0, 0, 0);

  // 繁殖管理パース
  var breedData = getSheetData(ss, '繁殖管理');
  var latestPen = {};
  for (var i = 1; i < breedData.length; i++) {
    var no = normalizeSowNo(breedData[i][1]);
    var date = breedData[i][0];
    var pen = breedData[i][2];
    if (!no || !pen || !(date instanceof Date)) continue;
    if (!latestPen[no] || date >= latestPen[no].date) {
      latestPen[no] = { date: date, pen: String(pen) };
    }
  }

  // 種付Map（全件）
  var matingData = getSheetData(ss, '種付');
  var matingMap = {};
  for (var i = 1; i < matingData.length; i++) {
    var no = normalizeSowNo(matingData[i][0]);
    var date = matingData[i][1];
    if (!no || !(date instanceof Date)) continue;
    var ds = toDateString(date);
    if (!matingMap[no] || ds > matingMap[no]) matingMap[no] = ds;
  }

  // 分娩Map
  var farrowData = getSheetData(ss, '分娩');
  var farrowMap = {};
  for (var i = 1; i < farrowData.length; i++) {
    var no = normalizeSowNo(farrowData[i][0]);
    var date = farrowData[i][1];
    if (!no || !(date instanceof Date)) continue;
    var ds = toDateString(date);
    if (!farrowMap[no] || ds > farrowMap[no]) farrowMap[no] = ds;
  }

  function penArea(penStr) {
    var n = parseInt(penStr) || 0;
    if (n >= 1 && n <= 58) return '種付';
    if (n >= 59 && n <= 999) return '妊娠';
    if (n >= 1000) return '分娩';
    return '不明';
  }

  function estArea(days, isFarrow) {
    if (isFarrow) return '分娩';
    if (days <= 25) return '種付';
    return '妊娠';
  }

  // ---- グループA: ペン記録あるが種付/分娩記録なし（正体不明） ----
  var groupA = [];
  for (var no in latestPen) {
    if (!matingMap[no] && !farrowMap[no]) {
      var p = latestPen[no];
      var penNum = parseInt(p.pen) || 0;
      groupA.push({ no: no, pen: p.pen, penNum: penNum, date: toDateString(p.date), area: penArea(p.pen) });
    }
  }

  // ---- グループB: 種付/分娩記録あるがペンなし（アクティブ） ----
  var allSows = {};
  for (var s in matingMap) allSows[s] = true;
  for (var s in farrowMap) allSows[s] = true;

  var groupB = [];
  for (var sowNo in allSows) {
    if (latestPen[sowNo]) continue;
    var mateStr = matingMap[sowNo] || '';
    var farrowStr = farrowMap[sowNo] || '';
    var active = false;
    var days = 0;
    var info = '';
    var isFarrow = false;
    if (mateStr && farrowStr) {
      if (mateStr >= farrowStr) {
        days = daysSince_(mateStr, today);
        if (days < 150) { active = true; info = '種付' + days + '日(' + mateStr + ')'; }
      } else {
        days = daysSince_(farrowStr, today);
        if (days < 50) { active = true; info = '分娩' + days + '日(' + farrowStr + ')'; isFarrow = true; }
      }
    } else if (mateStr) {
      days = daysSince_(mateStr, today);
      if (days < 150) { active = true; info = '種付' + days + '日(' + mateStr + ')'; }
    } else if (farrowStr) {
      days = daysSince_(farrowStr, today);
      if (days < 50) { active = true; info = '分娩' + days + '日(' + farrowStr + ')'; isFarrow = true; }
    }
    if (!active) continue;
    groupB.push({ no: sowNo, days: days, info: info, area: estArea(days, isFarrow) });
  }

  // ---- エリア別に整理して出力 ----
  var areas = ['種付', '妊娠', '分娩', '不明'];
  var log = [];
  log.push('=== ペン照合レポート（エリア別） ===');
  log.push('');

  for (var ai = 0; ai < areas.length; ai++) {
    var area = areas[ai];
    var aInArea = groupA.filter(function(g) { return g.area === area; });
    var bInArea = groupB.filter(function(g) { return g.area === area; });
    if (aInArea.length === 0 && bInArea.length === 0) continue;

    // A: ペン番号順, B: 日数順
    aInArea.sort(function(a, b) { return a.penNum - b.penNum; });
    bInArea.sort(function(a, b) { return a.days - b.days; });

    log.push('━━━ ' + area + 'エリア ━━━');
    log.push('');
    log.push('  【ペンあり・種付なし】' + aInArea.length + '頭  ←正体不明');
    if (aInArea.length > 0) {
      for (var i = 0; i < aInArea.length; i++) {
        var g = aInArea[i];
        log.push('    ' + g.no + '  Pen' + g.pen + '  移動日:' + g.date);
      }
    } else {
      log.push('    なし');
    }
    log.push('');
    log.push('  【種付あり・ペンなし】' + bInArea.length + '頭  ←居場所不明');
    if (bInArea.length > 0) {
      for (var i = 0; i < bInArea.length; i++) {
        var g = bInArea[i];
        log.push('    ' + g.no + '  ' + g.info);
      }
    } else {
      log.push('    なし');
    }
    log.push('');
  }

  // ---- 空房リスト ----
  // 全アクティブ母豚の最新ペンを収集（種付/分娩あり＋ペンありの母豚）
  var occupiedPens = {};
  for (var no in latestPen) {
    // アクティブ判定: 種付150日未満 or 分娩50日未満 or グループA（正体不明だがペンにいる）
    var mateStr = matingMap[no] || '';
    var farrowStr = farrowMap[no] || '';
    var isActive = false;
    if (mateStr && farrowStr) {
      if (mateStr >= farrowStr) { isActive = daysSince_(mateStr, today) < 150; }
      else { isActive = daysSince_(farrowStr, today) < 50; }
    } else if (mateStr) { isActive = daysSince_(mateStr, today) < 150; }
    else if (farrowStr) { isActive = daysSince_(farrowStr, today) < 50; }
    // グループA（種付なしだがペン記録あり）は空房扱い → isActiveにしない
    if (isActive) {
      var p = latestPen[no].pen;
      occupiedPens[p] = no;
    }
  }

  // ペンマスタから全ペン取得
  var penMaster = getSheetData(ss, 'ペンマスタ');
  var allPens = [];
  for (var i = 1; i < penMaster.length; i++) {
    var pNo = String(penMaster[i][0]);
    if (pNo) allPens.push({ pen: pNo, penNum: parseInt(pNo) || 0, area: String(penMaster[i][1] || '') });
  }
  allPens.sort(function(a, b) { return a.penNum - b.penNum; });

  var emptyPens = { '種付': [], '妊娠': [], '分娩': [], '不明': [] };
  for (var i = 0; i < allPens.length; i++) {
    var p = allPens[i];
    if (!occupiedPens[p.pen]) {
      var a = penArea(p.pen);
      if (emptyPens[a]) emptyPens[a].push(p.pen);
      else emptyPens['不明'].push(p.pen);
    }
  }

  log.push('━━━ 空房リスト ━━━');
  for (var ai = 0; ai < areas.length; ai++) {
    var area = areas[ai];
    var pens = emptyPens[area];
    if (!pens || pens.length === 0) continue;
    log.push('  ' + area + 'エリア (' + pens.length + '房): ' + pens.join(', '));
  }
  log.push('');

  // サマリ
  log.push('━━━ サマリ ━━━');
  log.push('正体不明（ペンあり種付なし）: ' + groupA.length + '頭');
  log.push('居場所不明（種付ありペンなし）: ' + groupB.length + '頭');
  var totalEmpty = 0;
  for (var k in emptyPens) totalEmpty += emptyPens[k].length;
  log.push('空房: ' + totalEmpty + '房');

  return log.join('\n');
}

/**
 * ?付き番号ペアの繁殖レコード詳細比較
 */
function auditQuestionMarkSows(authToken) {
  requireAuth_(authToken);
  var ss = getSpreadsheet();
  var pairs = [
    ['391', '391?'],
    ['400', '400?'],
    ['437', '437?'],
    ['472', '472?'],
    ['5080', '5080?'],
    ['9312', '9312?']
  ];

  // 種付データ
  var matingData = getSheetData(ss, '種付');
  // 分娩データ
  var farrowData = getSheetData(ss, '分娩');
  // 離乳データ
  var weanData = getSheetData(ss, '離乳');
  // 繁殖管理データ
  var breedData = getSheetData(ss, '繁殖管理');

  var log = [];
  log.push('=== ?付き番号ペア 繁殖レコード詳細 ===\n');

  for (var p = 0; p < pairs.length; p++) {
    var noA = pairs[p][0];
    var noB = pairs[p][1];
    log.push('━━━ ' + noA + ' vs ' + noB + ' ━━━');

    // 種付レコード
    log.push('【種付】');
    for (var i = 1; i < matingData.length; i++) {
      var no = normalizeSowNo(matingData[i][0]);
      if (no === noA || no === noB) {
        var date = toDateString(matingData[i][1]);
        var reh = matingData[i][2] || '';
        var abort = matingData[i][3] || '';
        var extras = [];
        if (reh) extras.push('再発:' + reh);
        if (abort) extras.push('流産:' + abort);
        log.push('  ' + no + ' | ' + date + (extras.length ? ' | ' + extras.join(', ') : ''));
      }
    }

    // 分娩レコード
    log.push('【分娩】');
    for (var i = 1; i < farrowData.length; i++) {
      var no = normalizeSowNo(farrowData[i][0]);
      if (no === noA || no === noB) {
        var date = toDateString(farrowData[i][1]);
        var total = farrowData[i][2] || 0;
        var still = farrowData[i][3] || 0;
        log.push('  ' + no + ' | ' + date + ' | 総産子:' + total + ' 死産:' + still);
      }
    }

    // 繁殖管理（ペン移動・ステータス）
    log.push('【繁殖管理】');
    for (var i = 1; i < breedData.length; i++) {
      var no = normalizeSowNo(breedData[i][1]);
      if (no === noA || no === noB) {
        var date = toDateString(breedData[i][0]);
        var pen = breedData[i][2] || '';
        var bt = breedData[i][3] || '';
        var st = breedData[i][4] || '';
        var parts = [];
        if (pen) parts.push('Pen:' + pen);
        if (bt) parts.push('BT:' + bt);
        if (st) parts.push(st);
        log.push('  ' + no + ' | ' + date + ' | ' + parts.join(' / '));
      }
    }
    log.push('');
  }

  var result = log.join('\n');
  Logger.log(result);
  return result;
}
