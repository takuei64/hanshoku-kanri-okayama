// Read-only release smoke check: no passwords/tokens, no business-data writes.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'pwa-config.js'), 'utf8'), context);
const config = context.window.OKAYAMA_APP_CONFIG;
async function check() {
  const url = new URL(config.backendUrl);
  Object.entries({action:'pwa',method:'ping',transport:'json',requestId:'readonly-release-check',payload:'[]'}).forEach(([key,value]) => url.searchParams.set(key,value));
  const response = await fetch(url, {signal:AbortSignal.timeout(15000), redirect:'follow'});
  let body;
  try { body = await response.json(); } catch { throw new Error('JSON ping未対応、または公開設定未反映です'); }
  if (!response.ok || !body.ok || body.result?.protocolVersion !== 2 || body.result?.reachable !== true || body.result?.status !== 'auth') {
    throw new Error('新しいpingの応答条件を満たしていません');
  }
  console.log('Apps Script: protocolVersion 2 / reachable / authentication required — OK');
  if (process.argv.includes('--backend-only')) return;
  const worker = await fetch('https://takuei64.github.io/hanshoku-kanri-okayama/sw.js', {signal:AbortSignal.timeout(15000), cache:'no-store'});
  const source = await worker.text();
  if (!worker.ok || !source.includes('breeding-okayama-pwa-v6-autosync') || !source.includes('js_snapshot.js')) throw new Error('Pagesの新しいService Workerは未反映です');
  console.log('GitHub Pages: v6-autosync / snapshot module — OK');
  console.log('端末の認証付き送信、CORS、AndroidのOSによるBackground Sync発火は別途実機確認してください。');
}
check().catch(error => { console.error('確認未完了: ' + (error.name === 'TimeoutError' ? '通信タイムアウト' : error.message)); process.exitCode = 1; });
