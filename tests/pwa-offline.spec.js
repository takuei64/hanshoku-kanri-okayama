const { test, expect } = require('@playwright/test');

const appUrl = 'http://127.0.0.1:8765/hanshoku-kanri-okayama/';
const namespace = 'hanshoku-kanri-okayama-v1';
const snapshot = {
  morningList: [{
    sowNo: '900',
    penNo: '1',
    reason: '育成',
    status: '',
    btHistory: [{ date: '2026-08-04', bt: 38.5 }]
  }],
  postMatingList: [],
  farrowingList: [],
  accidentList: [],
  locationList: [
    { sowNo: '900', penNo: '1', area: '繁殖舎', info: '育成', status: '' },
    { sowNo: '901', penNo: '1001', area: '分娩舎', info: '分娩21日目', status: '' }
  ],
  reheatCheckList: [],
  pregnancyCheckList: [],
  penTaskList: []
};

test('初期同期後は圏外再起動とBT削除キュー保持ができる', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  await context.addInitScript(({ namespace, snapshot }) => {
    if (localStorage.getItem(namespace + ':test-seeded') === '1') return;
    localStorage.setItem(namespace + ':auth-token', 'test-token');
    localStorage.setItem(namespace + ':data-snapshot', JSON.stringify(snapshot));
    localStorage.setItem(namespace + ':data-snapshot-time', new Date().toISOString());
    localStorage.setItem(namespace + ':test-seeded', '1');
  }, { namespace, snapshot });

  await context.route('https://script.google.com/**', async route => {
    const requestUrl = new URL(route.request().url());
    const requestId = requestUrl.searchParams.get('requestId') || 'request';
    const method = requestUrl.searchParams.get('method');
    const response = {
      requestId,
      ok: true,
      result: method === 'executeQueuedOperation' ? { success: true } : snapshot,
      error: ''
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: 'PwaJsonp.handle(' + JSON.stringify(response) + ');'
    });
  });

  const page = await context.newPage();
  await page.goto(appUrl);
  await expect(page).toHaveTitle('岡山農場 繁殖管理');
  await expect(page.locator('#card-900')).toBeVisible();
  await expect(page.locator('.bt-chip')).toContainText('38.5');

  await page.evaluate(() => navigator.serviceWorker.ready);
  const cacheResult = await page.evaluate(async () => {
    const names = await caches.keys();
    const cache = await caches.open('breeding-okayama-pwa-v5-history');
    const keys = await cache.keys();
    return { names, urls: keys.map(item => new URL(item.url).pathname) };
  });
  expect(cacheResult.names).toContain('breeding-okayama-pwa-v5-history');
  expect(cacheResult.urls).toContain('/hanshoku-kanri-okayama/index.html');
  expect(cacheResult.urls).toContain('/hanshoku-kanri-okayama/pwa-runtime.js');
  expect(cacheResult.urls).toContain('/hanshoku-kanri-okayama/icon-512.png');

  await context.unroute('https://script.google.com/**');
  await context.setOffline(true);
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('.bt-chip').click();
  await expect(page.locator('.bt-chip')).toHaveCount(0);
  await expect(page.locator('#sync-status')).toContainText('通信待ち 1');

  const queuedBeforeReload = await page.evaluate(namespace => {
    return JSON.parse(localStorage.getItem(namespace + ':offline-queue') || '[]');
  }, namespace);
  expect(queuedBeforeReload).toHaveLength(1);
  expect(queuedBeforeReload[0].type).toBe('deleteBreedingRecord');

  await page.reload({ waitUntil: 'domcontentloaded' });
  // ChromiumのService Worker経由reloadではPlaywrightのoffline設定後も
  // navigator.onLineだけtrueへ戻るため、端末のofflineイベントを明示して再現する。
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    window.dispatchEvent(new Event('offline'));
  });
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  await expect(page.locator('#card-900')).toBeVisible();
  await expect(page.locator('.bt-chip')).toHaveCount(0);
  await expect(page.locator('#sync-status')).toContainText('通信待ち 1');

  const queuedAfterReload = await page.evaluate(namespace => {
    return JSON.parse(localStorage.getItem(namespace + ':offline-queue') || '[]');
  }, namespace);
  expect(queuedAfterReload).toHaveLength(1);
  expect(queuedAfterReload[0].id).toBe(queuedBeforeReload[0].id);
  await context.close();
});

test('圏外でも離乳頭数と繁殖舎移動を一括登録して再起動後まで保持できる', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  await context.addInitScript(({ namespace, snapshot }) => {
    if (localStorage.getItem(namespace + ':weaning-test-seeded') === '1') return;
    localStorage.setItem(namespace + ':auth-token', 'test-token');
    localStorage.setItem(namespace + ':data-snapshot', JSON.stringify(snapshot));
    localStorage.setItem(namespace + ':data-snapshot-time', new Date().toISOString());
    localStorage.setItem(namespace + ':weaning-test-seeded', '1');
  }, { namespace, snapshot });

  await context.route('https://script.google.com/**', async route => {
    const requestUrl = new URL(route.request().url());
    const requestId = requestUrl.searchParams.get('requestId') || 'request';
    const method = requestUrl.searchParams.get('method');
    const response = {
      requestId,
      ok: true,
      result: method === 'executeQueuedOperation' ? { success: true } : snapshot,
      error: ''
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: 'PwaJsonp.handle(' + JSON.stringify(response) + ');'
    });
  });

  const page = await context.newPage();
  await page.goto(appUrl);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.unroute('https://script.google.com/**');
  await context.setOffline(true);

  await page.locator('[data-page="weaning"]').click();
  await expect(page.locator('#weaning-list')).toContainText('No.901');
  await expect(page.locator('#weaning-list')).toContainText('Pen 1001');
  await page.getByRole('button', { name: '離乳登録' }).click();
  await expect(page.locator('#weaning-current-pen')).toContainText('現在 Pen 1001');
  await page.locator('#weaning-date').fill('2026-08-04');
  await page.locator('#weaning-count').fill('10');
  await page.locator('#weaning-pen').fill('12');
  await page.getByRole('button', { name: '離乳・移動を登録' }).click();

  await expect(page.locator('#weaning-list')).toContainText('分娩舎に母豚はいません');
  await expect(page.locator('#sync-status')).toContainText('通信待ち 1');
  const queued = await page.evaluate(namespace => {
    return JSON.parse(localStorage.getItem(namespace + ':offline-queue') || '[]');
  }, namespace);
  expect(queued).toHaveLength(1);
  expect(queued[0].type).toBe('recordWeaning');
  expect(queued[0].args).toEqual(['901', '2026-08-04', 10, '12']);

  await expect.poll(async () => page.evaluate(namespace => {
    const data = JSON.parse(localStorage.getItem(namespace + ':data-snapshot') || '{}');
    const sow = (data.locationList || []).find(item => String(item.sowNo) === '901');
    return sow ? sow.area + ':' + sow.penNo : '';
  }, namespace)).toBe('繁殖舎:12');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    window.dispatchEvent(new Event('offline'));
  });
  await expect(page.locator('#card-901')).toContainText('離乳移動 0日目');
  await expect(page.locator('#sync-status')).toContainText('通信待ち 1');
  await page.locator('[data-page="location"]').click();
  await expect(page.locator('#location-list')).toContainText('No.901');
  await expect(page.locator('#location-list')).toContainText('Pen 12');
  await context.close();
});

test('既に削除済みの種付削除キューは起動時に自動整理する', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  await context.addInitScript(({ namespace, snapshot }) => {
    localStorage.setItem(namespace + ':auth-token', 'test-token');
    localStorage.setItem(namespace + ':data-snapshot', JSON.stringify(snapshot));
    localStorage.setItem(namespace + ':data-snapshot-time', new Date().toISOString());
    localStorage.setItem(namespace + ':offline-queue', JSON.stringify([{
      id: 'delete-mating-70-old',
      type: 'deleteMatingRecord',
      args: ['70', '2026-07-01'],
      createdAt: '2026-08-01T00:00:00.000Z',
      attempts: 1,
      nextAttemptAt: 0,
      state: 'failed',
      error: '該当する種付記録が見つかりません'
    }]));
  }, { namespace, snapshot });

  await context.route('https://script.google.com/**', async route => {
    const requestUrl = new URL(route.request().url());
    const requestId = requestUrl.searchParams.get('requestId') || 'request';
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: 'PwaJsonp.handle(' + JSON.stringify({ requestId, ok: true, result: snapshot, error: '' }) + ');'
    });
  });

  const page = await context.newPage();
  await page.goto(appUrl);
  await expect(page.locator('#sync-status')).toContainText('同期済');
  const queue = await page.evaluate(namespace => {
    return JSON.parse(localStorage.getItem(namespace + ':offline-queue') || '[]');
  }, namespace);
  expect(queue).toEqual([]);
  await context.close();
});

test('送信先で既に削除済みの削除命令はエラーに残さない', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  await context.addInitScript(({ namespace, snapshot }) => {
    localStorage.setItem(namespace + ':auth-token', 'test-token');
    localStorage.setItem(namespace + ':data-snapshot', JSON.stringify(snapshot));
    localStorage.setItem(namespace + ':data-snapshot-time', new Date().toISOString());
    localStorage.setItem(namespace + ':offline-queue', JSON.stringify([{
      id: 'delete-mating-70-pending',
      type: 'deleteMatingRecord',
      args: ['70', '2026-07-01'],
      createdAt: '2026-08-01T00:00:00.000Z',
      attempts: 0,
      nextAttemptAt: 0,
      state: 'pending',
      error: ''
    }]));
  }, { namespace, snapshot });

  await context.route('https://script.google.com/**', async route => {
    const requestUrl = new URL(route.request().url());
    const requestId = requestUrl.searchParams.get('requestId') || 'request';
    const method = requestUrl.searchParams.get('method');
    const result = method === 'executeQueuedOperation'
      ? { success: false, error: '該当する種付記録が見つかりません', retryable: false }
      : snapshot;
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: 'PwaJsonp.handle(' + JSON.stringify({ requestId, ok: true, result, error: '' }) + ');'
    });
  });

  const page = await context.newPage();
  await page.goto(appUrl);
  await expect.poll(async () => page.evaluate(namespace => {
    return JSON.parse(localStorage.getItem(namespace + ':offline-queue') || '[]').length;
  }, namespace)).toBe(0);
  await expect(page.locator('#sync-status')).toContainText('同期済');
  await context.close();
});

test('現在地は母豚Noだけを完全一致検索し、分娩登録前に対象と数値を確認する', async ({ browser }) => {
  const locationSnapshot = {
    ...snapshot,
    locationList: [
      { sowNo: '27', penNo: '1002', area: '分娩舎', info: '分娩予定', status: '' },
      { sowNo: '37', penNo: '27', area: '繁殖舎', info: '通常', status: '' }
    ]
  };
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  await context.addInitScript(({ namespace, locationSnapshot }) => {
    localStorage.setItem(namespace + ':auth-token', 'test-token');
    localStorage.setItem(namespace + ':data-snapshot', JSON.stringify(locationSnapshot));
    localStorage.setItem(namespace + ':data-snapshot-time', new Date().toISOString());
  }, { namespace, locationSnapshot });

  await context.route('https://script.google.com/**', async route => {
    const requestUrl = new URL(route.request().url());
    const requestId = requestUrl.searchParams.get('requestId') || 'request';
    const method = requestUrl.searchParams.get('method');
    const result = method === 'executeQueuedOperation' ? { success: true } : locationSnapshot;
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: 'PwaJsonp.handle(' + JSON.stringify({ requestId, ok: true, result, error: '' }) + ');'
    });
  });

  const page = await context.newPage();
  await page.goto(appUrl);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.unroute('https://script.google.com/**');
  await context.setOffline(true);

  await page.locator('[data-page="location"]').click();
  await page.locator('#location-search').fill('27');
  await expect(page.locator('#location-list')).toContainText('No.27');
  await expect(page.locator('#location-list')).not.toContainText('No.37');
  await expect(page.locator('#location-count')).toContainText('1頭');

  await page.locator('#location-list .list-item').click();
  await page.getByRole('button', { name: '分娩登録' }).click();
  await page.locator('#farrow-record-date').fill('2026-08-25');
  await page.locator('#farrow-record-total').fill('12');
  await page.locator('#farrow-record-still').fill('1');
  page.once('dialog', async dialog => {
    expect(dialog.message()).toContain('No.27 の分娩を登録しますか？');
    expect(dialog.message()).toContain('総産子数: 12');
    expect(dialog.message()).toContain('死産数: 1');
    await dialog.accept();
  });
  await page.getByRole('button', { name: '分娩を記録' }).click();

  const queued = await page.evaluate(namespace => {
    return JSON.parse(localStorage.getItem(namespace + ':offline-queue') || '[]');
  }, namespace);
  expect(queued).toHaveLength(1);
  expect(queued[0].type).toBe('recordFarrowing');
  expect(queued[0].args).toEqual(['27', '2026-08-25', 12, 1]);
  await context.close();
});

test('個体情報から種付・分娩・離乳・BT値を修正して同期待ちに保存できる', async ({ browser }) => {
  const cardData = {
    info: { sowNo: '900', earTag: '', birthDate: '', introductionParity: '' },
    currentPen: '1',
    timeline: [
      { date: '2026-07-01', event: '種付', detail: '' },
      { date: '2026-07-20', event: '繁殖管理', detail: 'BT 38.5', _penNo: '', _bt: 38.5, _status: '' },
      { date: '2026-08-01', event: '分娩', detail: '総産子:10 死産:1', _total: 10, _still: 1 },
      { date: '2026-08-20', event: '離乳', detail: '離乳頭数:8 死亡:2', _weaned: 8, _deaths: 2 }
    ]
  };
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  await context.addInitScript(({ namespace, snapshot }) => {
    localStorage.setItem(namespace + ':auth-token', 'test-token');
    localStorage.setItem(namespace + ':data-snapshot', JSON.stringify(snapshot));
    localStorage.setItem(namespace + ':data-snapshot-time', new Date().toISOString());
  }, { namespace, snapshot });

  await context.route('https://script.google.com/**', async route => {
    const requestUrl = new URL(route.request().url());
    const requestId = requestUrl.searchParams.get('requestId') || 'request';
    const method = requestUrl.searchParams.get('method');
    const result = method === 'getSowCard'
      ? cardData
      : method === 'executeQueuedOperation' ? { success: true } : snapshot;
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: 'PwaJsonp.handle(' + JSON.stringify({ requestId, ok: true, result, error: '' }) + ');'
    });
  });

  const page = await context.newPage();
  await page.goto(appUrl);
  await page.locator('[data-page="location"]').click();
  await page.locator('#location-search').fill('900');
  await page.locator('#location-list .list-item').click();
  await page.getByRole('button', { name: '個体情報' }).click();
  await expect(page.locator('#card-result')).toContainText('総産子:10');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.unroute('https://script.google.com/**');
  await context.setOffline(true);

  await page.locator('.tl-item').filter({ hasText: '種付' }).click();
  await page.locator('#history-edit-date').fill('2026-07-02');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '修正を保存' }).click();

  await page.locator('.tl-item').filter({ hasText: '分娩' }).click();
  await page.locator('#history-edit-date').fill('2026-08-02');
  await page.locator('#history-edit-total').fill('11');
  await page.locator('#history-edit-still').fill('0');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '修正を保存' }).click();

  await page.locator('.tl-item').filter({ hasText: '離乳' }).click();
  await page.locator('#history-edit-date').fill('2026-08-21');
  await page.locator('#history-edit-weaned').fill('9');
  await page.locator('#history-edit-deaths').fill('1');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '修正を保存' }).click();

  await page.locator('.tl-item').filter({ hasText: 'BT 38.5' }).click();
  await page.locator('#history-edit-date').fill('2026-07-21');
  await page.locator('#history-edit-bt').fill('39.0');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '修正を保存' }).click();

  const queued = await page.evaluate(namespace => {
    return JSON.parse(localStorage.getItem(namespace + ':offline-queue') || '[]');
  }, namespace);
  expect(queued.map(item => item.type)).toEqual([
    'updateMatingRecord',
    'updateFarrowingRecord',
    'updateWeaningRecord',
    'updateBTRecord'
  ]);
  expect(queued[0].args).toEqual(['900', '2026-07-01', '2026-07-02']);
  expect(queued[1].args).toEqual(['900', '2026-08-01', 10, 1, '2026-08-02', 11, 0]);
  expect(queued[2].args).toEqual(['900', '2026-08-20', 8, 2, '2026-08-21', 9, 1]);
  expect(queued[3].args).toEqual(['900', '2026-07-20', 38.5, '2026-07-21', 39]);
  await expect(page.locator('#sync-status')).toContainText('通信待ち 4');
  await expect(page.locator('#card-result')).toContainText('総産子:11 死産:0');
  await context.close();
});
