/**
 * 全シートのヘッダー行とサンプルデータを取得してログ出力
 */
function inspectSheets(authToken) {
  requireAuth_(authToken);
  const ss = getSpreadsheet();
  const sheets = ss.getSheets();

  for (const sheet of sheets) {
    const name = sheet.getName();
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();

    Logger.log('=== ' + name + ' === (rows=' + lastRow + ', cols=' + lastCol + ')');

    if (lastRow === 0 || lastCol === 0) {
      Logger.log('  (空のシート)');
      continue;
    }

    // ヘッダー行
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    Logger.log('  Headers: ' + JSON.stringify(headers));

    // サンプルデータ（2〜4行目）
    const sampleRows = Math.min(3, lastRow - 1);
    if (sampleRows > 0) {
      const data = sheet.getRange(2, 1, sampleRows, lastCol).getValues();
      for (let i = 0; i < data.length; i++) {
        Logger.log('  Row ' + (i + 2) + ': ' + JSON.stringify(data[i]));
      }
    }
  }
}
