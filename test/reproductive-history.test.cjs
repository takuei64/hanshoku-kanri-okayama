const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
function api() {
  const context = vm.createContext({
    toDateString: value => value instanceof Date ? value.toISOString().slice(0, 10) : String(value || ''),
    normalizeSowNo: value => String(value || '').trim(),
    getSheetData: (ss, name) => ss[name] || [[]]
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'apps-script-project/api_reproductive_history.js'), 'utf8'), context);
  return context;
}
function history({ mating = [], statuses = [], farrowing = [], weaning = [], parity = '' } = {}) {
  return api().buildReproductiveHistories_({
    '種付': [[], ...mating.map(row => ['42', ...row])],
    '繁殖管理': [[], ...statuses.map(([date, status]) => [date, '42', '', '', status])],
    '分娩': [[], ...farrowing.map(date => ['42', date])],
    '離乳': [[], ...weaning.map(date => ['42', date])],
    '母豚記録': [[], ['42', '', '', parity]]
  }, { 42: true })['42'];
}
function labels(h) { return Array.from(h.events, e => e.label); }

test('育成の3回の種付を、同日重複・翌日の追い種付と区別する', () => {
  const h = history({ parity: 0, mating: [
    ['2026-06-01'], ['2026-06-01'], ['2026-06-02'], ['2026-06-22'], ['2026-06-23'], ['2026-07-13']
  ], statuses: [['2026-06-21', '再発'], ['2026-07-12', '再発情']] });
  assert.equal(h.origin, '育成');
  assert.equal(h.attempts, 3);
  assert.equal(h.returns, 2);
  assert.equal(labels(h).filter(x => x === '追い種付（目安）').length, 2);
  assert.equal(h.estimated, true);
});

test('再発チェック済→妊鑑空胎→再種付→再発の経過を残す', () => {
  const h = history({ farrowing: ['2026-04-01'], weaning: ['2026-05-01'], mating: [
    ['2026-05-06'], ['2026-06-01']
  ], statuses: [['2026-05-27', '再発情確認終了'], ['2026-05-31', '空胎'], ['2026-06-22', '再発']] });
  assert.equal(h.origin, '離乳');
  assert.equal(h.attempts, 2);
  assert.equal(h.returns, 1);
  assert.equal(h.empties, 1);
  assert.deepEqual(labels(h), ['種付1回目', '再発チェック済', '空胎', '種付2回目', '再発']);
});

test('前産の失敗を持ち越さず、直近の離乳から数える', () => {
  const h = history({ farrowing: ['2026-07-01'], weaning: ['2026-07-25'], mating: [
    ['2026-01-01'], ['2026-02-01'], ['2026-03-01'], ['2026-07-30']
  ], statuses: [['2026-01-22', '空胎'], ['2026-02-22', '再発']] });
  assert.equal(h.attempts, 1);
  assert.equal(h.returns, 0);
  assert.equal(h.empties, 0);
});

test('再発チェック終了や測定終了を再発と数えず、未記録の再種付理由を推測しない', () => {
  const h = history({ mating: [['2026-07-01'], ['2026-08-01']], statuses: [
    ['2026-07-03', '測定終了'], ['2026-07-22', '再発情確認終了'], ['2026-07-27', '妊娠鑑定済']
  ] });
  assert.equal(h.returns, 0);
  assert.equal(h.empties, 0);
  assert.equal(h.attempts, 2);
  assert.equal(h.origin, '導入／記録開始');
});

test('空胎の重複記録・再検査は同じ種付回で1回として数える', () => {
  const h = history({ mating: [['2026-07-01']], statuses: [
    ['2026-07-26', '空胎'], ['2026-07-26', '空胎'], ['2026-07-28', '空胎']
  ] });
  assert.equal(h.empties, 1);
  assert.equal(h.events.length, 3);
});

test('同日の判定と種付の前後は断定せず、日付不明の再発を偽の日付にしない', () => {
  const h = history({ mating: [['2026-07-01', 'あり'], ['2026-07-02']], statuses: [
    ['2026-07-01', '空胎']
  ] });
  assert.equal(h.sameDayUncertain, true);
  assert.equal(h.events.find(e => e.type === 'return').date, '');
  const unknown = history({ mating: [['2026-07-01', 'あり'], ['2026-07-02']] });
  assert.equal(unknown.attempts, 1);
});

test('種付表の日付付き再発・流産を並べ、否定値を失敗と数えない', () => {
  const h = history({ mating: [['2026-07-01', '2026-07-22'], ['2026-07-23', 'なし', '2026-08-15']] });
  assert.equal(h.returns, 1);
  assert.deepEqual(labels(h), ['種付1回目', '再発', '種付2回目', '流産']);
  assert.equal(history({ mating: [['2026-07-01', false, 0]] }).returns, 0);
});

test('順不同の古い記録も読む・対象の豚だけを一覧へ付与する', () => {
  const list = [{ sowNo: '42' }], pregList = [{ sowNo: '42' }];
  const data = { '種付': [[], ['42', '2026-08-01'], ['43', '2026-08-01'], ['42', '2026-07-01']] };
  api().attachReproductiveHistory_(data, [list, pregList]);
  assert.equal(list[0].reproductiveHistory.attempts, 2);
  assert.equal(pregList[0].reproductiveHistory.attempts, 2);
  assert.equal(data['種付'].length, 4);
});

test('表示はHTMLをエスケープし、未同期と履歴未取得を明示する', () => {
  const c = vm.createContext({ OfflineSync: { queue: [{ type: 'recordMating', args: ['42', '2026-09-08'] }] } });
  vm.runInContext(fs.readFileSync(path.join(root, 'js_breeding.js'), 'utf8'), c);
  let html = c.Breeding.renderHistory({ sowNo: '42' });
  assert.match(html, /未同期の変更あり/);
  assert.match(html, /オンライン更新後/);
  html = c.Breeding.renderHistory({ sowNo: '42', reproductiveHistory: {
    origin: '<img src=x onerror=alert(1)>', attempts: 1, events: [{ date: '2026-09-01', label: '<script>', type: 'mating' }]
  } });
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.equal(c.Breeding.typeInfo({ kind: 'reheat', s: {} }).label, '再発チェック');
});

test('更新で別農場のオフライン用キャッシュを消さない', async () => {
  let activate;
  const removed = [];
  const c = vm.createContext({
    self: { addEventListener(name, fn) { if (name === 'activate') activate = fn; }, clients: { claim() {} } },
    caches: { keys: async () => ['breeding-pwa-old', 'breeding-okayama-pwa-old', 'another-app'], delete: async key => removed.push(key) }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), c);
  await new Promise((resolve, reject) => activate({ waitUntil: p => p.then(resolve, reject) }));
  assert.deepEqual(removed, [root.endsWith('okayama') ? 'breeding-okayama-pwa-old' : 'breeding-pwa-old']);
});
