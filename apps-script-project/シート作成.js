/**
 * 岡山農場版の初期シート構成。
 * ペン番号と作業種別は農場確認後にマスタへ登録し、既存農場の値は自動投入しない。
 */
var OKAYAMA_SHEET_DEFINITIONS = [
  { name: '母豚記録', headers: ['母豚No', '耳標No', '生年月日', '導入時産歴'], dateColumns: [3] },
  { name: '種付', headers: ['母豚No', '種付日', '再発情', '流産'], dateColumns: [2] },
  { name: '分娩', headers: ['母豚No', '分娩日', '総産子数', '死産数'], dateColumns: [2] },
  { name: '離乳', headers: ['母豚No', '離乳日', '離乳頭数', '死亡頭数'], dateColumns: [2] },
  { name: '繁殖管理', headers: ['日付', '母豚No', 'ペンNo', 'BT値', 'ステータス'], dateColumns: [1] },
  { name: 'ペンマスタ', headers: ['ペンNo', 'エリア', '備考'] },
  { name: '移動記録', headers: ['ID', '日付', '母豚No', 'ペンNo', '移動理由', '備考'], dateColumns: [2] },
  { name: 'ほ育事故', headers: ['母豚No', '日付', '頭数'], dateColumns: [2] },
  { name: 'ペン作業', headers: ['日付', 'ペンNo', '作業種別'], dateColumns: [1] },
  { name: '作業マスタ', headers: ['エリア種別', '作業種別', '基準日数', '表示順', '有効'] },
  { name: '母豚現在状況', headers: CURRENT_STATUS_HEADERS },
  { name: 'アプリ同期履歴', headers: ['操作ID', '完了日時', '処理', '結果'], hidden: true }
];

function setupSheets(authToken) {
  requireAuth_(authToken);
  return setupOkayamaSheets_();
}

function setupOkayamaSheets_() {
  var ss = getSpreadsheet();
  ss.setSpreadsheetTimeZone('Asia/Tokyo');
  ss.setSpreadsheetLocale('ja_JP');
  var created = [];
  OKAYAMA_SHEET_DEFINITIONS.forEach(function(definition) {
    var sheet = ss.getSheetByName(definition.name);
    if (!sheet) {
      sheet = ss.insertSheet(definition.name);
      created.push(definition.name);
    }
    formatOkayamaSheet_(sheet, definition);
  });

  return {
    success: true,
    created: created,
    spreadsheetId: ss.getId(),
    spreadsheetName: ss.getName()
  };
}

function formatOkayamaSheet_(sheet, definition) {
  var headers = definition.headers;
  var styledColumnCount = Math.max(headers.length, sheet.getLastColumn());
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  var headerStyleRange = sheet.getRange(1, 1, 1, styledColumnCount);
  var currentHeaders = headerRange.getDisplayValues()[0];
  var isEmpty = currentHeaders.every(function(value) { return value === ''; });
  if (isEmpty) headerRange.setValues([headers]);

  headerStyleRange
    .setFontFamily('HGPゴシックM')
    .setFontWeight('bold')
    .setFontColor('#202124')
    .setBackground('#e8eaed');
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, Math.max(sheet.getMaxRows(), 2), styledColumnCount)
    .setFontFamily('HGPゴシックM');

  (definition.dateColumns || []).forEach(function(column) {
    sheet.getRange(2, column, Math.max(sheet.getMaxRows() - 1, 1), 1)
      .setNumberFormat('yyyy/mm/dd');
  });

  for (var column = 1; column <= headers.length; column++) {
    sheet.setColumnWidth(column, column === headers.length ? 160 : 110);
  }
  if (definition.hidden && !sheet.isSheetHidden()) sheet.hideSheet();
}
