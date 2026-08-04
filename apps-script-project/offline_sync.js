/**
 * 電波が弱い現場向けの保存受付。
 * クライアントが保持した操作IDで再送を重複排除し、既存の記録関数へ渡す。
 */
var OFFLINE_SYNC_LOG_SHEET = 'アプリ同期履歴';
var OFFLINE_SYNC_LOG_MAX_ROWS = 5000;

function executeQueuedOperation(operation, authToken) {
  try {
    requireAuth_(authToken);
  } catch (authError) {
    return { success: false, error: authError.message, retryable: false };
  }

  var validation = validateQueuedOperation_(operation);
  if (validation) return { success: false, error: validation, retryable: false };

  // 同じ端末からのタイムアウト再送を直列化する。既存関数のScriptLockとは別種のLockを使う。
  var userLock = LockService.getUserLock();
  var locked = false;
  try {
    userLock.waitLock(30000);
    locked = true;

    var ss = getSpreadsheet();
    var logSheet = ensureOfflineSyncLogSheet_(ss);
    var previous = findOfflineSyncResult_(logSheet, operation.id);
    if (previous) {
      previous.duplicate = true;
      previous.operationId = operation.id;
      return previous;
    }

    var result = dispatchQueuedOperation_(operation.type, operation.args, authToken);
    if (!result || typeof result !== 'object') {
      result = { success: false, error: '保存結果を確認できませんでした' };
    }
    result.operationId = operation.id;

    if (result.success) {
      // 記録本体は完了済みなので、履歴保存だけが失敗してもクライアントには成功を返す。
      try { rememberOfflineSyncResult_(logSheet, operation, result); } catch (logError) {}
    } else {
      result.retryable = isRetryableQueuedError_(result.error);
    }
    return result;
  } catch (e) {
    return { success: false, error: e.message, retryable: isRetryableQueuedError_(e.message) };
  } finally {
    if (locked) userLock.releaseLock();
  }
}

function validateQueuedOperation_(operation) {
  if (!operation || typeof operation !== 'object') return '送信データが不正です';
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(String(operation.id || ''))) return '操作IDが不正です';
  if (!Array.isArray(operation.args)) return '送信項目が不正です';

  var allowed = {
    recordMovement: 3,
    recordBTValue: 3,
    recordStatusChange: 3,
    recordMating: 2,
    recordFarrowing: 4,
    recordNursingAccident: 3,
    recordPenTasks: 3,
    deletePenTask: 3,
    deleteBreedingRecord: 5,
    deleteMatingRecord: 2,
    deleteFarrowingRecord: 4,
    deleteWeaningRecord: 4
  };
  var type = String(operation.type || '');
  if (!allowed[type]) return '未対応の保存処理です';
  if (operation.args.length !== allowed[type]) return '送信項目の数が不正です';
  if (type === 'recordPenTasks' && !Array.isArray(operation.args[1])) return '作業項目が不正です';
  return '';
}

function dispatchQueuedOperation_(type, args, authToken) {
  switch (type) {
    case 'recordMovement':
      return recordMovement(args[0], args[1], args[2], authToken);
    case 'recordBTValue':
      return recordBTValue(args[0], args[1], args[2], authToken);
    case 'recordStatusChange':
      return recordStatusChange(args[0], args[1], args[2], authToken);
    case 'recordMating':
      return recordMating(args[0], args[1], authToken);
    case 'recordFarrowing':
      return recordFarrowing(args[0], args[1], args[2], args[3], authToken);
    case 'recordNursingAccident':
      return recordNursingAccident(args[0], args[1], args[2], authToken);
    case 'recordPenTasks':
      return recordPenTasks(args[0], args[1], args[2], authToken);
    case 'deletePenTask':
      return deletePenTask(args[0], args[1], args[2], authToken);
    case 'deleteBreedingRecord':
      return deleteBreedingRecord(args[0], args[1], args[2], args[3], args[4], authToken);
    case 'deleteMatingRecord':
      return deleteMatingRecord(args[0], args[1], authToken);
    case 'deleteFarrowingRecord':
      return deleteFarrowingRecord(args[0], args[1], args[2], args[3], authToken);
    case 'deleteWeaningRecord':
      return deleteWeaningRecord(args[0], args[1], args[2], args[3], authToken);
  }
  return { success: false, error: '未対応の保存処理です' };
}

function ensureOfflineSyncLogSheet_(ss) {
  var sheet = ss.getSheetByName(OFFLINE_SYNC_LOG_SHEET);
  if (sheet) return sheet;

  sheet = ss.insertSheet(OFFLINE_SYNC_LOG_SHEET);
  sheet.getRange(1, 1, 1, 4).setValues([['操作ID', '完了日時', '処理', '結果']]);
  sheet.setFrozenRows(1);
  sheet.hideSheet();
  return sheet;
}

function findOfflineSyncResult_(sheet, operationId) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;
  var rowCount = Math.min(OFFLINE_SYNC_LOG_MAX_ROWS, lastRow - 1);
  var startRow = lastRow - rowCount + 1;
  var values = sheet.getRange(startRow, 1, rowCount, 4).getValues();
  for (var i = values.length - 1; i >= 0; i--) {
    if (String(values[i][0]) !== String(operationId)) continue;
    try {
      return JSON.parse(String(values[i][3] || '{}'));
    } catch (e) {
      return { success: true };
    }
  }
  return null;
}

function rememberOfflineSyncResult_(sheet, operation, result) {
  sheet.appendRow([operation.id, new Date(), operation.type, JSON.stringify(result)]);
  var lastRow = sheet.getLastRow();
  if (lastRow > OFFLINE_SYNC_LOG_MAX_ROWS + 501) {
    sheet.deleteRows(2, 500);
  }
}

function isRetryableQueuedError_(message) {
  return /(lock|ロック|timeout|timed out|タイムアウト|internal error|temporar|service invoked too many times|try again|一時)/i.test(String(message || ''));
}
