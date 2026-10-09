const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const context = {};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js_snapshot.js'), 'utf8'), context);
const patcher = context.SnapshotPatch;
const plain = value => JSON.parse(JSON.stringify(value));
const copy = plain;
function initial() {
  return {
    locationList: [{ sowNo: 'A', penNo: '1', area: '繁殖舎', latestMoveDate: '2026-10-01' }, { sowNo: 'B', penNo: '2', area: '繁殖舎' }],
    morningList: [{ sowNo: 'A', penNo: '1', btHistory: [{ date: '2026-10-08', bt: 38 }] }],
    penTaskList: [{ penNo: '1', sows: ['A'], tasks: { vaccine: { state: 'pending', date: '' } } }],
    accidentList: []
  };
}

test('independent tabs moving different sows merge; repeating a durable patch is idempotent', () => {
  const base = initial(), a = copy(base), b = copy(base);
  a.locationList[0].penNo = '3';
  a.locationList[0].latestMoveDate = '2026-10-09';
  b.locationList[1].penNo = '4';
  const p1 = patcher.diff(base, a), p2 = patcher.diff(base, b);
  const latest = patcher.apply(patcher.apply(base, p1, 'move-A'), p2, 'move-B');
  assert.deepEqual(plain(latest.locationList.map(row => row.penNo)), ['3', '4']);
  assert.deepEqual(plain(patcher.apply(latest, p1, 'move-A')), plain(latest));
});

test('concurrent BT additions preserve both entries, even for identical values on the same day', () => {
  const base = initial(), after = copy(base);
  after.morningList[0].btHistory.unshift({ date: '2026-10-09', bt: 39 });
  const patch = patcher.diff(base, after);
  let latest = patcher.apply(base, patch, 'BT-one');
  latest = patcher.apply(latest, patch, 'BT-two');
  assert.equal(latest.morningList[0].btHistory.length, 3);
  assert.equal(latest.morningList[0].btHistory.filter(row => row.bt === 39).length, 2);
  assert.equal(patcher.apply(latest, patch, 'BT-two').morningList[0].btHistory.length, 3);
});

test('a correction only removes its original BT occurrence and preserves another tab new reading', () => {
  const base = initial(), corrected = copy(base), latest = copy(base);
  corrected.morningList[0].btHistory[0].bt = 37;
  latest.morningList[0].btHistory.unshift({ date: '2026-10-09', bt: 39 });
  const result = patcher.apply(latest, patcher.diff(base, corrected), 'correction');
  assert.deepEqual(plain(result.morningList[0].btHistory.map(row => row.bt)), [39, 37]);
});

test('concurrent retirement is not undone by a stale field edit', () => {
  const base = initial(), edit = copy(base), retired = copy(base);
  edit.locationList[0].penNo = '9';
  retired.locationList.shift();
  const result = patcher.apply(retired, patcher.diff(base, edit), 'stale-move');
  assert.deepEqual(plain(result.locationList.map(row => row.sowNo)), ['B']);
});

test('pen membership and task edits merge without replacing the other tab task result', () => {
  const base = initial(), moved = copy(base), vaccinated = copy(base);
  moved.penTaskList[0].sows.push('B');
  vaccinated.penTaskList[0].tasks.vaccine = { state: 'done', date: '2026-10-09' };
  const result = patcher.apply(patcher.apply(base, patcher.diff(base, vaccinated), 'task'), patcher.diff(base, moved), 'move');
  assert.deepEqual(plain(result.penTaskList[0].sows), ['A', 'B']);
  assert.equal(result.penTaskList[0].tasks.vaccine.state, 'done');
  const again = patcher.apply(result, patcher.diff(base, moved), 'another-move');
  assert.deepEqual(plain(again.penTaskList[0].sows), ['A', 'B']);
});

test('accident rows remain separate records, including same sow and same date', () => {
  const base = initial(), after = copy(base);
  after.accidentList.push({ sowNo: 'A', date: '2026-10-09', count: 1 });
  let result = patcher.apply(base, patcher.diff(base, after), 'accident-one');
  result = patcher.apply(result, patcher.diff(base, after), 'accident-two');
  assert.equal(result.accidentList.length, 2);
});

test('nested card timeline correction preserves concurrent entries and ignores applied-ID metadata in diff', () => {
  const base = { sowCards: { A: { timeline: [{ date: '2026-10-08', event: '種付' }] } }, __offlineApplied: ['older'] };
  const after = copy(base), latest = copy(base);
  after.sowCards.A.timeline[0].date = '2026-10-09';
  after.__offlineApplied.push('ignored');
  latest.sowCards.A.timeline.push({ date: '2026-10-10', event: '繁殖管理' });
  const result = patcher.apply(latest, patcher.diff(base, after), 'edit');
  assert.deepEqual(plain(result.sowCards.A.timeline.map(row => row.date)).sort(), ['2026-10-09', '2026-10-10']);
  assert.deepEqual(plain(result.__offlineApplied), ['older', 'edit']);
});

test('patches are JSON serializable, do not mutate inputs, and preserve falsy field values', () => {
  const base = { locationList: [{ sowNo: 'A', penNo: '1', count: 2, pending: true, note: 'old' }] };
  const after = { locationList: [{ sowNo: 'A', penNo: '1', count: 0, pending: false, note: '' }] };
  const baseline = JSON.stringify(base);
  const patch = plain(patcher.diff(base, after));
  const result = patcher.apply(base, patch);
  assert.deepEqual(plain(result), after);
  assert.equal(JSON.stringify(base), baseline);
});
