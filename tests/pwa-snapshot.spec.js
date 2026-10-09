const { test, expect } = require('@playwright/test');

const appUrl = 'http://127.0.0.1:8765/hanshoku-kanri-okayama/';
const namespace = 'hanshoku-kanri-okayama-v1';
const snapshotKey = namespace + ':data-snapshot';
const snapshot = {
  morningList: ['900', '901'].map((sowNo, i) => ({ sowNo, penNo: String(i + 1), reason: '育成', status: '', btHistory: [] })),
  locationList: ['900', '901'].map((sowNo, i) => ({ sowNo, penNo: String(i + 1), area: '繁殖舎', latestMoveDate: '2026-10-01', status: '', info: '育成' })),
  postMatingList: [], farrowingList: [], accidentList: [], reheatCheckList: [], pregnancyCheckList: [], penTaskList: [],
  penList: ['1', '2', '12', '13'].map(penNo => ({ penNo, area: '繁殖舎' })),
  penTaskConfig: { breedingTypes: ['ワクチン'], farrowingTypes: ['鉄剤'], days: { 'ワクチン': 21, '鉄剤': 3 } },
  sowCards: { '900': { info: { sowNo: '900', earTag: '' }, currentPen: '1', timeline: [
    { event: '種付', date: '2026-07-01', detail: '' },
    { event: '分娩', date: '2026-08-01', _total: 10, _still: 1, detail: '総産子:10 死産:1' }
  ] } }
};

async function openOffline(browser, count = 1) {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  await context.addInitScript(({ namespace, snapshot }) => {
    // Keep automatic API traffic disabled even while obtaining the static shell.
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    if (localStorage.getItem(namespace + ':snapshot-test-seeded')) return;
    localStorage.setItem(namespace + ':auth-token', 'fixture-token');
    localStorage.setItem(namespace + ':data-snapshot', JSON.stringify(snapshot));
    localStorage.setItem(namespace + ':snapshot-test-seeded', '1');
  }, { namespace, snapshot });
  await context.route('**/mock-backend**', route => route.abort('internetdisconnected'));
  const pages = [];
  for (let i = 0; i < count; i++) {
    const page = await context.newPage();
    await page.goto(appUrl);
    await expect(page.locator('#card-900')).toBeVisible();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    pages.push(page);
  }
  await context.setOffline(true);
  return { context, pages };
}

async function prepareBT(page, sowNo = '900') {
  await page.locator('#card-' + sowNo + ' .btn-bt').click();
  await page.locator('#bt-value').fill('40.5');
  await page.locator('#bt-date').fill('2026-10-09');
}
async function prepareMove(page, sowNo = '900', penNo = '12') {
  await page.locator('#move-toggle-label').click();
  await page.locator('#move-sow').fill(sowNo);
  await page.locator('#move-pen').fill(penNo);
  await page.locator('#move-date').fill('2026-10-09');
}
async function state(page) {
  return page.evaluate(() => ({
    locations: SowLocation.list,
    cards: Breeding.list,
    tasks: PenTask.list,
    queue: OfflineSync.loadQueue()
  }));
}

test('古い別画面のpagehideが最新BT・移動スナップショットを巻き戻さない', async ({ browser }) => {
  const { context, pages: [a, b] } = await openOffline(browser, 2);
  try {
    await prepareBT(a);
    await a.locator('#bt-modal .submit-btn').click();
    await prepareMove(a);
    await a.locator('#move-submit').click();
    // B still holds the old view in memory. Its lifecycle write must merge durable changes.
    expect((await state(b)).locations.find(s => s.sowNo === '900').penNo).toBe('1');
    await b.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await a.reload({ waitUntil: 'domcontentloaded' });
    const reloaded = await state(a);
    expect(reloaded.locations.find(s => s.sowNo === '900').penNo).toBe('12');
    expect(reloaded.cards.find(s => s.sowNo === '900').btHistory).toEqual([{ date: '2026-10-09', bt: 40.5 }]);
    expect(reloaded.queue.map(op => op.type)).toEqual(['recordBTValue', 'recordMovement']);
    await expect(a.locator('#sync-status')).toHaveText('通信待ち 2');
  } finally { await context.close(); }
});

test('同じスナップショットの別画面から同時に異なる母豚を移動しても両方残る', async ({ browser }) => {
  const { context, pages: [a, b] } = await openOffline(browser, 2);
  try {
    await prepareMove(a, '900', '12');
    await prepareMove(b, '901', '13');
    await Promise.all([a.locator('#move-submit').click(), b.locator('#move-submit').click()]);
    await a.reload({ waitUntil: 'domcontentloaded' });
    const reloaded = await state(a);
    expect(reloaded.locations.find(s => s.sowNo === '900')).toMatchObject({ penNo: '12', latestMoveDate: '2026-10-09' });
    expect(reloaded.locations.find(s => s.sowNo === '901')).toMatchObject({ penNo: '13', latestMoveDate: '2026-10-09' });
    expect(reloaded.tasks.find(p => p.penNo === '12').sows).toContain('900');
    expect(reloaded.tasks.find(p => p.penNo === '13').sows).toContain('901');
    expect(reloaded.queue).toHaveLength(2);
    expect(new Set(reloaded.queue.map(op => op.id)).size).toBe(2);
  } finally { await context.close(); }
});

test('別画面から同じBT値を同時に2回入力しても片方を失わず再描画で増殖しない', async ({ browser }) => {
  const { context, pages: [a, b] } = await openOffline(browser, 2);
  try {
    await prepareBT(a);
    await prepareBT(b);
    await Promise.all([a.locator('#bt-modal .submit-btn').click(), b.locator('#bt-modal .submit-btn').click()]);
    for (let pass = 0; pass < 2; pass++) {
      await a.reload({ waitUntil: 'domcontentloaded' });
      const reloaded = await state(a);
      expect(reloaded.cards.find(s => s.sowNo === '900').btHistory).toEqual([
        { date: '2026-10-09', bt: 40.5 }, { date: '2026-10-09', bt: 40.5 }
      ]);
      expect(reloaded.queue).toHaveLength(2);
      expect(new Set(reloaded.queue.map(op => op.id)).size).toBe(2);
    }
  } finally { await context.close(); }
});

test('一覧保存だけが失敗しても操作に保存した変更から起動時にBTを復元する', async ({ browser }) => {
  const { context, pages: [page] } = await openOffline(browser);
  try {
    await prepareBT(page);
    const injected = await page.evaluate(key => {
      const originalSet = Storage.prototype.setItem;
      let failures = 0;
      Storage.prototype.setItem = function(name, value) {
        if (name === key && failures === 0) { failures++; throw new DOMException('Fixture snapshot write failure', 'QuotaExceededError'); }
        return originalSet.call(this, name, value);
      };
      // Execute the real button handler in the same task, so the failed snapshot
      // can be observed before later lifecycle recovery has a chance to repair it.
      document.querySelector('#bt-modal .submit-btn').click();
      const saved = JSON.parse(localStorage.getItem(key));
      const operation = OfflineSync.loadQueue()[0];
      Storage.prototype.setItem = originalSet;
      return { failures, storedBT: saved.morningList[0].btHistory, operation };
    }, snapshotKey);
    expect(injected.failures).toBe(1);
    expect(injected.storedBT).toEqual([]);
    expect(injected.operation.localPatch.version).toBe(1);
    expect(injected.operation.args).toEqual(['900', 40.5, '2026-10-09']);
    // A browser crash does not run pagehide. Skip that recovery path for this reload.
    await page.evaluate(() => { App.captureSnapshot = () => true; });
    await page.reload({ waitUntil: 'domcontentloaded' });
    const reloaded = await state(page);
    expect(reloaded.cards.find(s => s.sowNo === '900').btHistory).toEqual([{ date: '2026-10-09', bt: 40.5 }]);
    expect(reloaded.queue[0].id).toBe(injected.operation.id);
  } finally { await context.close(); }
});

test('全個体履歴を重複保存せず、連続修正と再起動でもカード履歴を保持する', async ({ browser }) => {
  const { context, pages: [page] } = await openOffline(browser);
  try {
    await page.evaluate(() => App.navigateTo('sowcard', { sowNo: '900' }));
    await expect(page.locator('#card-result')).toContainText('総産子:10 死産:1');
    await page.locator('.tl-item').filter({ hasText: '種付' }).click();
    await page.locator('#history-edit-date').fill('2026-07-02');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '修正を保存' }).click();
    await page.locator('.tl-item').filter({ hasText: '分娩' }).click();
    await page.locator('#history-edit-total').fill('11');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '修正を保存' }).click();
    expect(await page.evaluate(key => Object.hasOwn(JSON.parse(localStorage.getItem(key)), 'sowCards'), snapshotKey)).toBe(false);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.evaluate(() => App.navigateTo('sowcard', { sowNo: '900' }));
    await expect(page.locator('#card-result')).toContainText('2026-07-02');
    await expect(page.locator('#card-result')).toContainText('総産子:11 死産:1');
    expect((await state(page)).queue).toHaveLength(2);
  } finally { await context.close(); }
});

test('同じ個体の古いカードを2画面で開き別の履歴を修正しても両方保持する', async ({ browser }) => {
  const { context, pages: [a, b] } = await openOffline(browser, 2);
  try {
    for (const page of [a, b]) await page.evaluate(() => App.navigateTo('sowcard', { sowNo: '900' }));
    // Both edit modals intentionally start from the original card, before either save.
    await a.locator('.tl-item').filter({ hasText: '種付' }).click();
    await a.locator('#history-edit-date').fill('2026-07-02');
    await b.locator('.tl-item').filter({ hasText: '分娩' }).click();
    await b.locator('#history-edit-total').fill('11');
    a.once('dialog', dialog => dialog.accept());
    await a.getByRole('button', { name: '修正を保存' }).click();
    b.once('dialog', dialog => dialog.accept());
    await b.getByRole('button', { name: '修正を保存' }).click();
    await expect(b.locator('#card-result')).toContainText('2026-07-02');
    await expect(b.locator('#card-result')).toContainText('総産子:11 死産:1');
    const operations = (await state(b)).queue;
    expect(operations.map(op => op.type)).toEqual(['updateMatingRecord', 'updateFarrowingRecord']);
    expect(operations[0].args).toEqual(['900', '2026-07-01', '2026-07-02']);
    expect(operations[1].args).toEqual(['900', '2026-08-01', 10, 1, '2026-08-01', 11, 1]);
    await a.reload({ waitUntil: 'domcontentloaded' });
    await a.evaluate(() => App.navigateTo('sowcard', { sowNo: '900' }));
    await expect(a.locator('#card-result')).toContainText('2026-07-02');
    await expect(a.locator('#card-result')).toContainText('総産子:11 死産:1');
    expect((await state(a)).queue.map(op => op.id)).toEqual(operations.map(op => op.id));
  } finally { await context.close(); }
});
