const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const domains = ['breeding', 'sow', 'farrowing', 'weaning', 'pentask', 'postmating', 'reheatcheck', 'pregcheck'];
const copy = value => JSON.parse(JSON.stringify(value));

// Isolate screen behavior from transport. The queue contract is: persist first,
// then applyLocal, then snapshot. Transport / storage tests exercise that contract separately.
function screens({ failSave = false, saved = new Map() } = {}) {
  const elements = new Map();
  const hidden = [];
  const notices = [];
  const node = id => {
    if (!elements.has(id)) elements.set(id, { value: '', textContent: '', innerHTML: '', style: {}, classList: { contains: () => false }, disabled: false });
    return elements.get(id);
  };
  const context = vm.createContext({
    console, Date, JSON, navigator: { onLine: false }, confirm: () => true,
    setTimeout: () => 1, clearTimeout() {},
    document: { getElementById: node, querySelectorAll: () => [{ value: 'ワクチン' }] },
    localStorage: { getItem: key => saved.get(key) || null, setItem: (key, val) => saved.set(key, String(val)) },
    App: {
      currentPage: 'location', today: () => '2026-10-09', setDateDefault() {},
      toast: message => notices.push(message), hideModal: id => hidden.push(id), showModal() {},
      getStatusBadgeClass: () => '', showLoading() {}, hideLoading() {},
      penList: [{ penNo: '2', area: '繁殖舎' }, { penNo: '6', area: '繁殖舎' }, { penNo: '100', area: '分娩舎' }]
    }
  });
  for (const name of domains) vm.runInContext(fs.readFileSync(path.join(root, `js_${name}.js`), 'utf8'), context);
  function snapshot() {
    return copy({
      locationList: context.SowLocation.list, morningList: context.Breeding.list,
      farrowingList: context.Farrowing.list, accidentList: context.Farrowing.accidentList,
      reheatCheckList: context.ReheatCheck.list, postMatingList: context.PostMating.list,
      pregnancyCheckList: context.PregCheck.list, penTaskList: context.PenTask.list
    });
  }
  context.OfflineSync = {
    queue: [],
    enqueue(type, args, handlers = {}) {
      if (failSave) return null;
      const op = { id: `operation-${this.queue.length + 1}`, type, args: copy(args), state: 'pending' };
      this.queue.push(op);
      saved.set('queue', JSON.stringify(this.queue));
      if (handlers.applyLocal) handlers.applyLocal();
      saved.set('snapshot', JSON.stringify(snapshot()));
      return op.id;
    }
  };
  context.SowLocation.list = [{ sowNo: 42, penNo: '2', area: '繁殖舎', latestMoveDate: '2026-10-01', latestMatingDate: '2026-09-01', status: '', info: '' }];
  for (const name of ['Breeding', 'PostMating', 'ReheatCheck', 'Farrowing', 'PregCheck']) {
    context[name].list = [{ sowNo: '42', penNo: '2', btHistory: [], status: '', mateDate: '2026-09-01', matingDate: '2026-09-01' }];
  }
  context.PenTask.farrowingTaskTypes = ['鉄剤'];
  context.PenTask.breedingTaskTypes = ['ワクチン'];
  context.PenTask.dueDays = { '鉄剤': 3, 'ワクチン': 21 };
  context.PenTask.list = [{ penNo: '2', areaType: 'breeding', sows: ['42', '43'], taskTypes: ['ワクチン'], tasks: { 'ワクチン': { state: 'done', date: '2026-10-01' } }, ageDays: 38 }];
  const prior = saved.get('snapshot');
  if (prior) {
    const data = JSON.parse(prior);
    context.SowLocation.list = data.locationList;
    context.Breeding.list = data.morningList;
    context.Farrowing.list = data.farrowingList;
    context.Farrowing.accidentList = data.accidentList;
    context.ReheatCheck.list = data.reheatCheckList;
    context.PostMating.list = data.postMatingList;
    context.PregCheck.list = data.pregnancyCheckList;
    context.PenTask.list = data.penTaskList;
    context.OfflineSync.queue = JSON.parse(saved.get('queue'));
  }
  return { c: context, saved, node, hidden, notices, snapshot, fill: values => Object.entries(values).forEach(([id, value]) => { node(id).value = String(value); }) };
}

const routes = {
  '繁殖上部': env => {
    env.fill({ 'move-sow': 42, 'move-pen': 100, 'move-date': '2026-10-09' });
    env.c.Breeding.submitMove();
  },
  '現在地Pen': env => {
    env.c.SowLocation.moveSowNo = '42';
    env.fill({ 'loc-move-pen': 100, 'loc-move-date': '2026-10-09' });
    env.c.SowLocation.submitMove();
  },
  '分娩移動': env => {
    env.c.Farrowing.selectedSow = '42';
    env.fill({ 'farrow-move-pen': 100, 'farrow-move-date': '2026-10-09' });
    env.c.Farrowing.confirmMove();
  }
};

for (const [name, submit] of Object.entries(routes)) {
  test(`${name}: offline move updates all lists, area/date, tasks and survives reload`, () => {
    const env = screens();
    submit(env);
    for (const state of [env, screens({ saved: env.saved })]) {
      for (const listName of ['SowLocation', 'PostMating', 'ReheatCheck', 'Farrowing', 'PregCheck']) {
        const sow = state.c[listName].list[0];
        assert.equal(sow.penNo, '100', listName);
        assert.equal(sow.area, '分娩舎', listName);
        assert.equal(sow.latestMoveDate, '2026-10-09', listName);
      }
      assert.equal(state.c.Breeding.list.length, 0, 'morning breeding checks only belong to breeding areas');
      assert.equal(state.c.Weaning.getList().length, 1);
      assert.deepEqual(copy(state.c.PenTask.findPen('2').sows), ['43']);
      const destination = state.c.PenTask.findPen('100');
      assert.deepEqual(copy(destination.sows), ['42']);
      assert.equal(destination.tasks['鉄剤'].state, 'pending');
      assert.equal(destination.tasks['ワクチン'], undefined, 'source Pen completion must not follow sow');
      assert.equal(state.c.OfflineSync.queue[0].type, 'recordMovement');
      assert.deepEqual(copy(state.c.OfflineSync.queue[0].args), ['42', '100', '2026-10-09']);
    }
  });

  test(`${name}: failed durable save leaves form and all lists unchanged`, () => {
    const env = screens({ failSave: true });
    const before = env.snapshot();
    submit(env);
    assert.deepEqual(env.snapshot(), before);
    assert.equal(env.c.OfflineSync.queue.length, 0);
    assert.equal(env.hidden.length, 0);
    assert.equal(env.notices.length, 0);
  });
}

test('離乳同時移動 updates destination task target and persists after restart', () => {
  const env = screens();
  env.c.SowLocation.list[0].area = '分娩舎';
  env.c.SowLocation.list[0].penNo = '100';
  env.c.PenTask.list[0].areaType = 'farrowing';
  env.c.PenTask.list[0].penNo = '100';
  env.c.Weaning.selectedSow = '42';
  env.fill({ 'weaning-date': '2026-10-09', 'weaning-count': '10', 'weaning-pen': '6' });
  env.c.Weaning.submit();
  const restarted = screens({ saved: env.saved });
  const row = restarted.c.SowLocation.list[0];
  assert.equal(row.penNo, '6');
  assert.equal(row.area, '繁殖舎');
  assert.equal(row.latestMoveDate, '2026-10-09');
  assert.equal(restarted.c.Weaning.getList().length, 0);
  assert.equal(restarted.c.Breeding.list[0].penNo, '6');
  assert.deepEqual(copy(restarted.c.PenTask.findPen('6').sows), ['42']);
  assert.equal(restarted.c.Farrowing.list.length, 0);
  assert.equal(restarted.c.OfflineSync.queue[0].type, 'recordWeaning');
});

test('existing destination Pen task completions stay at their Pen; past move cannot undo later current location', () => {
  const env = screens();
  env.c.PenTask.list.push({ penNo: '100', areaType: 'farrowing', sows: ['44'], tasks: { '鉄剤': { state: 'done', date: '2026-10-08' } } });
  routes['繁殖上部'](env);
  assert.deepEqual(copy(env.c.PenTask.findPen('100').sows), ['44', '42']);
  assert.equal(env.c.PenTask.findPen('100').tasks['鉄剤'].state, 'done');
  env.c.SowLocation.applyMovementLocal('42', '2', '2026-10-05');
  assert.equal(env.c.SowLocation.list[0].penNo, '100');
});

test('BT, task completion and cancellation persist without server callbacks', () => {
  const env = screens();
  env.c.Breeding.selectedSow = '42';
  env.fill({ 'bt-value': 11.5, 'bt-date': '2026-10-09', 'pentask-date': '2026-10-09' });
  env.c.Breeding.submitBT();
  env.c.PenTask.selectedPen = '2';
  env.c.PenTask.submit();
  assert.equal(env.c.PenTask.findPen('2').tasks['ワクチン'].state, 'done');
  env.c.PenTask.undo('ワクチン', '2026-10-09');
  const restarted = screens({ saved: env.saved });
  for (const name of ['Breeding', 'PostMating', 'ReheatCheck']) assert.equal(restarted.c[name].list[0].btHistory[0].bt, 11.5);
  assert.notEqual(restarted.c.PenTask.findPen('2').tasks['ワクチン'].state, 'done');
  assert.deepEqual(restarted.c.OfflineSync.queue.map(op => op.type), ['recordBTValue', 'recordPenTasks', 'deletePenTask']);
});

test('cached card edits and deletes work offline and are not reintroduced after reopening', () => {
  const env = screens();
  const data = { info: { sowNo: '42' }, currentPen: '2', timeline: [
    { event: '種付', date: '2026-09-01', detail: '' },
    { event: '繁殖管理', date: '2026-10-08', _bt: 10, _penNo: '', _status: '' }
  ] };
  env.c.SowCard.saveCached('42', data);
  env.c.SowCard.search('42');
  env.c.SowCard.editIndex = 1;
  env.c.SowCard.editOriginal = copy(data.timeline[1]);
  env.fill({ 'history-edit-date': '2026-10-09', 'history-edit-bt': 12 });
  env.c.SowCard.submitEdit();
  env.c.SowCard.confirmDeleteMating('42', '2026-09-01');
  const restarted = screens({ saved: env.saved });
  restarted.c.SowCard.search('42');
  assert.equal(restarted.c.SowCard.currentData.timeline.length, 1);
  assert.equal(restarted.c.SowCard.currentData.timeline[0]._bt, 12);
  assert.deepEqual(restarted.c.OfflineSync.queue.map(op => op.type), ['updateBTRecord', 'deleteMatingRecord']);
});

test('a delayed card response cannot overwrite an input that already synchronized while it was in flight', () => {
  const env = screens();
  env.c.navigator.onLine = true;
  let revision = 'before';
  let success;
  env.c.OfflineSync.mutationRevision = () => revision;
  const runner = {
    withSuccessHandler(fn) { success = fn; return this; },
    withFailureHandler() { return this; }, getSowCard() {}
  };
  env.c.google = { script: { run: runner } };
  env.c.SowCard.saveCached('42', { info: { sowNo: '42' }, currentPen: '2', timeline: [] });
  env.c.SowCard.search('42');
  env.c.SowCard.saveCached('42', { info: { sowNo: '42' }, currentPen: '100', timeline: [] });
  revision = 'after-completion';
  success({ info: { sowNo: '42' }, currentPen: '2', timeline: [] });
  assert.equal(env.c.SowCard.loadCached('42').currentPen, '100');
});

test('every domain mutation stops before changing data or hiding its input if persistence fails', () => {
  const actions = [
    env => { env.c.Breeding.selectedSow = '42'; env.fill({ 'bt-value': 10, 'bt-date': '2026-10-09' }); env.c.Breeding.submitBT(); },
    env => { env.c.Breeding.pendingAction = { type: 'mating', sowNo: '42' }; env.c.Breeding.confirmStatus(); },
    env => { env.c.Breeding.pendingAction = { type: 'status', sowNo: '42', status: '測定終了' }; env.c.Breeding.confirmStatus(); },
    env => env.c.Breeding.confirmDeleteBT('42', '2026-10-09', 10),
    env => env.c.PostMating.confirmDone('42'),
    env => env.c.ReheatCheck.confirmDone('42'),
    env => env.c.PregCheck.confirm('42', '空胎'),
    env => { env.c.Weaning.selectedSow = '42'; env.fill({ 'weaning-date': '2026-10-09', 'weaning-count': 10, 'weaning-pen': 6 }); env.c.Weaning.submit(); },
    env => { env.c.Farrowing.recordSowNo = '42'; env.fill({ 'farrow-record-date': '2026-10-09', 'farrow-record-total': 12, 'farrow-record-still': 1 }); env.c.Farrowing.confirmRecord(); },
    env => { env.fill({ 'accident-sow': 42, 'accident-date': '2026-10-09', 'accident-count': 1 }); env.c.Farrowing.submitAccident(); },
    env => { env.c.SowLocation.actionSowNo = '42'; env.fill({ 'death-date': '2026-10-09', 'death-count': 1 }); env.c.SowLocation.submitDeath(); },
    env => { env.c.PenTask.selectedPen = '2'; env.c.PenTask.submit(); },
    env => { env.c.PenTask.selectedPen = '2'; env.c.PenTask.undo('ワクチン', '2026-10-01'); },
    env => env.c.SowCard.confirmDeleteMating('42', '2026-09-01'),
    env => env.c.SowCard.confirmDeleteFarrowing('42', '2026-09-01', 10, 1),
    env => env.c.SowCard.confirmDeleteWeaning('42', '2026-09-01', 9, 1),
    env => env.c.SowCard.confirmDelete('42', '2026-09-01', '', 10, ''),
    env => { env.c.Mating.sowNo = '42'; env.c.Mating.submit(); }
  ];
  for (let i = 0; i < actions.length; i++) {
    const env = screens({ failSave: true });
    const before = env.snapshot();
    actions[i](env);
    assert.deepEqual(env.snapshot(), before, `action ${i}`);
    assert.equal(env.hidden.length, 0, `action ${i}`);
    assert.equal(env.notices.length, 0, `action ${i}`);
  }
});

test('GitHub Pages and Apps Script screen implementations match', () => {
  for (const name of [...domains, 'app', 'offline', 'snapshot']) {
    const source = fs.readFileSync(path.join(root, `js_${name}.js`), 'utf8').trim();
    const gas = fs.readFileSync(path.join(root, `apps-script-project/js_${name}.html`), 'utf8').replace(/^<script>\s*/, '').replace(/\s*<\/script>\s*$/, '').trim();
    assert.equal(gas, source, name);
  }
});
