/**
 * シートメンテナンス用関数（1回だけ or 必要に応じて実行）
 */

/**
 * 種付シートを種付日（B列）で昇順ソート
 * ※ アプリは末尾200行だけ読むため、日付順に並んでいる必要がある
 * ※ 1回実行すればOK。以降のappendRowは末尾に追加されるので順序は保たれる
 */
function sortMatingSheet(authToken) {
  requireAuth_(authToken);
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('種付');
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;
  // ヘッダー行を除いてB列（種付日）で昇順ソート
  sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn())
    .sort({ column: 2, ascending: true });
  Logger.log('種付シートをソートしました（' + (lastRow - 1) + '行）');
}

/**
 * 分娩シートを分娩日（B列）で昇順ソート
 */
function sortFarrowingSheet(authToken) {
  requireAuth_(authToken);
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('分娩');
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;
  sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn())
    .sort({ column: 2, ascending: true });
  Logger.log('分娩シートをソートしました（' + (lastRow - 1) + '行）');
}

/**
 * 離乳シートを離乳日（B列）で昇順ソート
 */
function sortWeaningSheet(authToken) {
  requireAuth_(authToken);
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('離乳');
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;
  sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn())
    .sort({ column: 2, ascending: true });
  Logger.log('離乳シートをソートしました（' + (lastRow - 1) + '行）');
}

/**
 * 繁殖管理シートのヘッダーを新構成に更新
 * [日付, 母豚No, ペンNo, BT値, ステータス]
 */
function updateBreedingSheetHeader(authToken) {
  requireAuth_(authToken);
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('繁殖管理');
  if (!sheet) {
    Logger.log('繁殖管理シートが見つかりません');
    return;
  }

  var newHeaders = ['日付', '母豚No', 'ペンNo', 'BT値', 'ステータス'];
  sheet.getRange(1, 1, 1, newHeaders.length).setValues([newHeaders]);

  var lastCol = sheet.getLastColumn();
  if (lastCol > newHeaders.length) {
    sheet.getRange(1, newHeaders.length + 1, 1, lastCol - newHeaders.length).clear();
  }

  sheet.setColumnWidth(1, 110);
  sheet.setColumnWidth(2, 80);
  sheet.setColumnWidth(3, 80);
  sheet.setColumnWidth(4, 70);
  sheet.setColumnWidth(5, 120);

  sheet.getRange('A2:A').setNumberFormat('yyyy/mm/dd');

  var statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['通常', '測定終了', '再発情確認終了', '妊娠鑑定済', '空胎', '廃用'], true)
    .setAllowInvalid(true)
    .build();
  sheet.getRange('E2:E').setDataValidation(statusRule);

  Logger.log('繁殖管理シートのヘッダーを更新しました: ' + newHeaders.join(', '));
}
