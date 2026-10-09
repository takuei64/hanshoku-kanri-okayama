/**
 * 電波が弱い現場向けの保存受付。
 * クライアントが保持した操作IDで再送を重複排除し、既存の記録関数へ渡す。
 */
var OFFLINE_SYNC_LOG_SHEET = 'アプリ同期履歴';
// 操作IDは期限なしで保持する。古い端末からの再送も同じ履歴で重複排除する。
var queuedOperationContext_ = null;

/** 個々のAPIが同じScriptLockを再取得しないための実行単位のアダプタ。 */
function getQueuedWriteLock_() {
  if (queuedOperationContext_) return { waitLock: function() {}, releaseLock: function() {} };
  return LockService.getScriptLock();
}

/** 業務データへの最初の書込み直前に呼ぶ。失敗時に無条件再送しない。 */
function markQueuedMutation_() {
  var context = queuedOperationContext_;
  if (!context || context.mutationStarted) return;
  context.mutationStarted = true;
  saveOfflineSyncEntry_(context.sheet, context.row, context.operation, { state: 'processing', fingerprint: context.fingerprint });
  SpreadsheetApp.flush();
}

function executeQueuedOperation(operation, authToken) {
  try {
    requireAuth_(authToken);
  } catch (authError) {
    return queuedErrorResult_(authError);
  }

  var validation = validateQueuedOperation_(operation);
  if (validation) return { success: false, error: validation, retryable: false, errorKind: 'permanent' };

  // ユーザー、複数タブ、画面とSWの違いによらず、履歴確認から完了保存まで直列化する。
  var scriptLock = LockService.getScriptLock();
  var locked = false;
  var journalRow = 0;
  var logSheet;
  var fingerprint;
  var result;
  try {
    scriptLock.waitLock(30000);
    locked = true;

    var ss = getSpreadsheet();
    logSheet = ensureOfflineSyncLogSheet_(ss);
    fingerprint = queuedOperationFingerprint_(operation);
    var previous = findOfflineSyncEntry_(logSheet, operation.id);
    if (previous) {
      journalRow = previous.row;
      if (previous.value.fingerprint && previous.value.fingerprint !== fingerprint) {
        return { success: false, operationId: operation.id, error: '同じ操作IDで異なる内容が送信されました。確認してください。', errorKind: 'permanent', retryable: false, code: 'OPERATION_ID_CONFLICT' };
      }
      // rejected は業務書込み前に検証で止まった記録。マスタ修正後の明示的な
      // 再送は再検証できる。処理中・結果不明・完了の記録は再実行しない。
      if (['retryable', 'reserved', 'rejected'].indexOf(previous.value.state) < 0) {
        result = previous.value.result || previous.value;
        if (previous.value.state === 'processing' || previous.value.state === 'uncertain') result = uncertainQueuedResult_(operation.id);
        result.duplicate = true;
        result.operationId = operation.id;
        return result;
      }
    }

    // 先に受付を永続化し、書込み完了と履歴保存の間で停止しても再実行しない。
    journalRow = saveOfflineSyncEntry_(logSheet, journalRow, operation, {
      state: 'reserved', fingerprint: fingerprint
    });
    SpreadsheetApp.flush();
    queuedOperationContext_ = { mutationStarted: false, sheet: logSheet, row: journalRow, operation: operation, fingerprint: fingerprint };
    try {
      result = dispatchQueuedOperation_(operation.type, operation.args, authToken);
    } catch (dispatchError) {
      result = queuedErrorResult_(dispatchError);
    }
    if (!result || typeof result !== 'object') {
      result = queuedErrorResult_(new Error('保存結果を確認できませんでした'));
    }
    result.operationId = operation.id;

    var state = 'completed';
    if (!result.success) {
      if (queuedOperationContext_.mutationStarted) {
        result = uncertainQueuedResult_(operation.id);
        state = 'uncertain';
      } else {
        result = queuedErrorResult_(result);
        result.operationId = operation.id;
        state = result.retryable || result.authRequired ? 'retryable' : 'rejected';
      }
    }
    // 受付・業務書込み・完了履歴を同じロック内で確定させる。
    SpreadsheetApp.flush();
    saveOfflineSyncEntry_(logSheet, journalRow, operation, { state: state, fingerprint: fingerprint, result: result });
    SpreadsheetApp.flush();
    return result;
  } catch (e) {
    // 完了履歴を書けなかった場合も成功を推測しない。受付行が二重実行を防ぐ。
    if (queuedOperationContext_ && queuedOperationContext_.mutationStarted) return uncertainQueuedResult_(operation.id);
    return queuedErrorResult_(e);
  } finally {
    queuedOperationContext_ = null;
    if (locked) scriptLock.releaseLock();
  }
}

function uncertainQueuedResult_(operationId) {
  return {
    success: false, operationId: operationId, retryable: false, errorKind: 'permanent',
    code: 'OPERATION_OUTCOME_UNKNOWN',
    error: '保存処理が中断され、反映結果の確認が必要です。二重登録を防ぐため再送を停止しました。操作IDを管理者へ伝えてください。'
  };
}

function queuedErrorResult_(error) {
  var message = String(error && (error.message || error.error) || error || '一時的に処理できませんでした');
  var auth = (error && (error.code === 'AUTH_REQUIRED' || error.authRequired)) || /認証が切れました/.test(message);
  var permanent = !auth && /(?:不正|未対応|確認してください|入力してください|指定してください|マスタにない|選択されていません|現在、分娩舎にいません|シートが見つかりません|記録なし|(?:該当する|修正対象の).*記録が見つかりません)/.test(message);
  return { success: false, error: message, errorKind: auth ? 'auth' : permanent ? 'permanent' : 'network', authRequired: !!auth, retryable: !auth && !permanent };
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
    recordWeaning: 4,
    recordNursingAccident: 3,
    recordPenTasks: 3,
    deletePenTask: 3,
    deleteBreedingRecord: 5,
    deleteMatingRecord: 2,
    deleteFarrowingRecord: 4,
    deleteWeaningRecord: 4,
    updateMatingRecord: 3,
    updateFarrowingRecord: 7,
    updateWeaningRecord: 7,
    updateBTRecord: 5
  };
  var type = String(operation.type || '');
  if (!allowed[type]) return '未対応の保存処理です';
  if (operation.args.length !== allowed[type]) return '送信項目の数が不正です';
  if (type === 'recordPenTasks' && !Array.isArray(operation.args[1])) return '作業項目が不正です';
  if (!String(operation.args[0] === null || operation.args[0] === undefined ? '' : operation.args[0]).trim()) return '対象の母豚NoまたはPENを確認してください';
  var dateColumns = {
    recordMovement: [2], recordBTValue: [2], recordStatusChange: [2], recordMating: [1],
    recordFarrowing: [1], recordWeaning: [1], recordNursingAccident: [1], recordPenTasks: [2],
    deletePenTask: [2], deleteBreedingRecord: [1], deleteMatingRecord: [1], deleteFarrowingRecord: [1], deleteWeaningRecord: [1],
    updateMatingRecord: [1, 2], updateFarrowingRecord: [1, 4], updateWeaningRecord: [1, 4], updateBTRecord: [1, 3]
  };
  for (var i = 0; i < dateColumns[type].length; i++) {
    var dateText = String(operation.args[dateColumns[type][i]] || '');
    var date = /^\d{4}-\d{2}-\d{2}$/.test(dateText) ? new Date(dateText + 'T00:00:00Z') : null;
    if (!date || isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateText) return '日付を確認してください';
  }
  if (type === 'recordBTValue' && (!isFinite(Number(operation.args[1])) || Number(operation.args[1]) <= 0)) return 'BT値を確認してください';
  if (type === 'recordMovement' && !String(operation.args[1] || '').trim()) return '移動先PENを確認してください';
  if (type === 'recordStatusChange' && !String(operation.args[1] || '').trim()) return '状態を確認してください';
  if (type === 'recordFarrowing' || type === 'recordWeaning' || type === 'recordNursingAccident') {
    var count = Number(operation.args[2]);
    var minimum = type === 'recordWeaning' ? 0 : 1;
    if (operation.args[2] === '' || operation.args[2] === null || !isFinite(count) || count < minimum || Math.floor(count) !== count) return '頭数を確認してください';
    if (type === 'recordFarrowing') {
      var stillBorn = Number(operation.args[3]);
      if (!isFinite(stillBorn) || stillBorn < 0 || Math.floor(stillBorn) !== stillBorn || stillBorn > count) return '死産数を確認してください';
    }
  }
  return '';
}

function dispatchQueuedOperation_(type, args, authToken) {
  // 既存シートの欠落は書込み前に判定する。マスタ/設定の修復後に同じIDを
  // 再送可能にし、複数シートを使う種付・離乳も片方だけ書き込まない。
  var requiredSheets = {
    recordMovement: ['繁殖管理', 'ペンマスタ'], recordBTValue: ['繁殖管理'], recordStatusChange: ['繁殖管理'],
    recordMating: ['種付', '繁殖管理'], recordFarrowing: ['分娩'], recordWeaning: ['離乳', '繁殖管理', 'ペンマスタ'],
    deleteBreedingRecord: ['繁殖管理'], deleteMatingRecord: ['種付'], deleteFarrowingRecord: ['分娩'], deleteWeaningRecord: ['離乳'],
    updateMatingRecord: ['種付'], updateFarrowingRecord: ['分娩'], updateWeaningRecord: ['離乳'], updateBTRecord: ['繁殖管理']
  }[type] || [];
  if (requiredSheets.length) {
    var ss = getSpreadsheet();
    for (var s = 0; s < requiredSheets.length; s++) {
      if (!ss.getSheetByName(requiredSheets[s])) return { success: false, error: requiredSheets[s] + 'シートが見つかりません。管理者へ連絡してください。' };
    }
  }
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
    case 'recordWeaning':
      return recordWeaning(args[0], args[1], args[2], args[3], authToken);
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
    case 'updateMatingRecord':
      return updateMatingRecord(args[0], args[1], args[2], authToken);
    case 'updateFarrowingRecord':
      return updateFarrowingRecord(args[0], args[1], args[2], args[3], args[4], args[5], args[6], authToken);
    case 'updateWeaningRecord':
      return updateWeaningRecord(args[0], args[1], args[2], args[3], args[4], args[5], args[6], authToken);
    case 'updateBTRecord':
      return updateBTRecord(args[0], args[1], args[2], args[3], args[4], authToken);
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

function findOfflineSyncEntry_(sheet, operationId) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;
  var match = sheet.getRange(2, 1, lastRow - 1, 1).createTextFinder(String(operationId))
    .matchEntireCell(true).useRegularExpression(false).findNext();
  if (!match) return null;
  var row = match.getRow();
  try {
    var value = JSON.parse(String(sheet.getRange(row, 4).getValue() || '{}'));
    // 旧履歴のsuccess:trueはそのまま使用する。破損・空の履歴を成功扱いしない。
    if (!value.state && value.success !== true) value = { state: 'uncertain' };
    return { row: row, value: value };
  } catch (e) {
    return { row: row, value: { state: 'uncertain' } };
  }
}

function saveOfflineSyncEntry_(sheet, row, operation, value) {
  row = row || sheet.getLastRow() + 1;
  sheet.getRange(row, 1, 1, 4).setValues([[operation.id, new Date(), operation.type, JSON.stringify(value)]]);
  return row;
}

function queuedOperationFingerprint_(operation) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify([operation.type, operation.args]), Utilities.Charset.UTF_8);
  return bytes.map(function(value) { return ('0' + ((value + 256) % 256).toString(16)).slice(-2); }).join('');
}

function isRetryableQueuedError_(message) {
  return queuedErrorResult_(message).retryable;
}
