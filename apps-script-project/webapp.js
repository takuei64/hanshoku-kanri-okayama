/** 岡山農場版 Web App エントリポイント。 */
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  var token = (e && e.parameter && e.parameter.token) || '';

  if (action === 'pwa') return handlePwaJsonp_(e, token);

  if (action) {
    return ContentService
      .createTextOutput('未対応の操作です')
      .setMimeType(ContentService.MimeType.TEXT);
  }

  if (!isAuthTokenValid_(token)) {
    var loginTmpl = HtmlService.createTemplateFromFile('login');
    loginTmpl.appUrl = JSON.stringify(ScriptApp.getService().getUrl());
    return loginTmpl.evaluate()
      .setTitle('岡山農場 繁殖管理')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  var tmpl = HtmlService.createTemplateFromFile('index');
  tmpl.initialData = JSON.stringify(getInitialDataCached_());
  tmpl.authToken = JSON.stringify(token);
  return tmpl.evaluate()
    .setTitle('岡山農場 繁殖管理')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** 固定名JSONPによる、PWA専用の限定ブリッジ。 */
function handlePwaJsonp_(e, token) {
  var requestId = String((e && e.parameter && e.parameter.requestId) || '');
  var method = String((e && e.parameter && e.parameter.method) || '');
  var response = { requestId: requestId, ok: false, result: null, error: '' };

  if (!/^[A-Za-z0-9_-]{6,80}$/.test(requestId)) {
    response.error = '通信IDが不正です';
    return createPwaJsonpOutput_(response);
  }
  if (!isAuthTokenValid_(token)) {
    response.error = '認証が切れました。もう一度パスワードを入力してください。';
    response.authRequired = true;
    return createPwaJsonpOutput_(response);
  }

  var args;
  try {
    args = JSON.parse(String((e && e.parameter && e.parameter.payload) || '[]'));
  } catch (parseError) {
    response.error = '送信内容を読み取れませんでした';
    return createPwaJsonpOutput_(response);
  }
  if (!Array.isArray(args)) {
    response.error = '送信内容が不正です';
    return createPwaJsonpOutput_(response);
  }

  try {
    if (method === 'getInitialDataCached' && args.length === 0) {
      response.result = getInitialDataCached(token);
    } else if (method === 'refreshAllData' && args.length === 0) {
      response.result = refreshAllData(token);
    } else if (method === 'getSowCard' && args.length === 1) {
      response.result = getSowCard(args[0], token);
    } else if (method === 'executeQueuedOperation' && args.length === 1) {
      response.result = executeQueuedOperation(args[0], token);
    } else {
      response.error = '未対応の通信処理です';
      return createPwaJsonpOutput_(response);
    }
    response.ok = true;
  } catch (error) {
    response.error = error && error.message ? error.message : String(error || '処理できませんでした');
    if (response.error.indexOf('認証が切れました') >= 0) response.authRequired = true;
  }
  return createPwaJsonpOutput_(response);
}

function createPwaJsonpOutput_(response) {
  var json = JSON.stringify(response)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return ContentService
    .createTextOutput('PwaJsonp.handle(' + json + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}
