const { test, expect } = require('@playwright/test');

const appUrl = 'http://127.0.0.1:8765/hanshoku-kanri-okayama/';
const namespace = 'hanshoku-kanri-okayama-v1';
const snapshot = { morningList: [{ sowNo: '900', penNo: '1', reason: '育成', btHistory: [] }], locationList: [{ sowNo: '900', penNo: '1', area: '繁殖舎', info: '育成' }] };

async function seed(context, token = 'fixture-token') {
  await context.addInitScript(({ namespace, snapshot, token }) => {
    if (localStorage.getItem(namespace + ':runtime-test-seeded')) return;
    localStorage.setItem(namespace + ':data-snapshot', JSON.stringify(snapshot));
    if (token) localStorage.setItem(namespace + ':auth-token', token);
    localStorage.setItem(namespace + ':runtime-test-seeded', '1');
  }, { namespace, snapshot, token });
}

async function mockBackend(context, onOperation = async () => ({ success: true }), options = {}) {
  await context.route(/https:\/\/script\.google\.com\/|\/mock-backend/, async route => {
    const url = new URL(route.request().url());
    const method = url.searchParams.get('method');
    const token = url.searchParams.get('token');
    if (!method) return route.fulfill({ contentType: 'text/html', body: '<p>Fixture login only</p>' });
    const authenticated = options.authenticated ? options.authenticated(token) : true;
    const result = method === 'ping' ? { reachable: true, authenticated, status: authenticated ? 'online' : 'auth' }
      : method === 'executeQueuedOperation' ? await onOperation(JSON.parse(url.searchParams.get('payload'))[0], token)
        : options.getSnapshot ? await options.getSnapshot(method) : snapshot;
    const envelope = { requestId: url.searchParams.get('requestId'), ok: true, result };
    const json = url.searchParams.get('transport') === 'json';
    await route.fulfill({ contentType: json ? 'application/json' : 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' },
      body: json ? JSON.stringify(envelope) : 'PwaJsonp.handle(' + JSON.stringify(envelope) + ');' });
  });
}

test('見かけ上オンラインでも到達不能なら保存済み画面を即時に操作できる', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await seed(context, '');
  await context.route(/https:\/\/script\.google\.com\/|\/mock-backend/, route => route.abort('internetdisconnected'));
  const page = await context.newPage();
  await page.goto(appUrl);
  expect(await page.evaluate(() => navigator.onLine)).toBe(true);
  await expect(page.locator('#card-900')).toBeVisible();
  await expect(page.locator('#pwa-login-overlay')).toBeHidden();
  for (const name of ['pregcheck', 'farrowing', 'weaning', 'location', 'pentask', 'breeding']) {
    await page.locator('[data-page="' + name + '"]').click();
    await expect(page.locator('#page-' + name)).toBeVisible();
  }
  await expect.poll(() => page.evaluate(() => PwaNetwork.result.state)).toBe('offline');
  await expect(page.locator('#pwa-login-overlay')).toBeHidden();
  await context.close();
});

async function seedQueue(context, id, offline = false) {
  await context.addInitScript(({ namespace, id, offline }) => {
    if (offline) Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    if (localStorage.getItem(namespace + ':seeded-queue:' + id)) return;
    localStorage.setItem(namespace + ':offline-queue', JSON.stringify([{ id, type: 'recordBTValue', args: ['900', '2026-10-09', 38.5],
      state: 'pending', createdAt: '2026-10-09T00:00:00.000Z', attempts: 3, nextAttemptAt: Date.now() + 600000 }]));
    localStorage.setItem(namespace + ':seeded-queue:' + id, '1');
  }, { namespace, id, offline });
}

test('起動時の長い再送待機を解除して最後まで送信し最新一覧取得後に同期済になる', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await seed(context);
  await seedQueue(context, 'fixture-startup');
  const delivered = [];
  let refreshed = 0;
  await mockBackend(context, async op => { delivered.push(op.id); return { success: true }; }, {
    getSnapshot: async () => { refreshed++; return { ...snapshot, morningList: [{ ...snapshot.morningList[0], reason: '同期後の一覧' }] }; }
  });
  const page = await context.newPage();
  await page.goto(appUrl);
  await expect(page.locator('#sync-status')).toHaveText('同期済');
  await expect.poll(() => page.evaluate(() => Breeding.list[0].reason)).toBe('同期後の一覧');
  expect(delivered).toEqual(['fixture-startup']);
  expect(refreshed).toBeGreaterThan(0);
  expect(await page.evaluate(() => OfflineSync.loadQueue())).toEqual([]);
  await context.close();
});

for (const eventName of ['online', 'pageshow', 'focus', 'visibilitychange']) {
  test(eventName + 'で長い通信待機を解除し左上を押さず自動同期する', async ({ browser }) => {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await seed(context);
    await seedQueue(context, 'fixture-' + eventName, true);
    const delivered = [];
    await mockBackend(context, async op => { delivered.push(op.id); return { success: true }; });
    const page = await context.newPage();
    await page.goto(appUrl);
    await expect(page.locator('#sync-status')).toHaveText('通信待ち 1');
    await page.evaluate(eventName => {
      const op = OfflineSync.loadQueue()[0];
      op.nextAttemptAt = Date.now() + 600000;
      OfflineSync.persist(op);
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
      if (eventName === 'visibilitychange') {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        document.dispatchEvent(new Event(eventName));
      } else window.dispatchEvent(new Event(eventName));
    }, eventName);
    await expect(page.locator('#sync-status')).toHaveText('同期済');
    expect(delivered).toEqual(['fixture-' + eventName]);
    expect(await page.evaluate(() => OfflineSync.loadQueue())).toEqual([]);
    await context.close();
  });
}

test('認証切れでは操作IDを保持し新しい認証後に自動送信を再開する', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await seed(context, 'expired-fixture');
  await seedQueue(context, 'fixture-auth-resume');
  const delivered = [];
  await mockBackend(context, async (op, token) => { delivered.push({ id: op.id, token }); return { success: true }; }, {
    authenticated: token => token === 'new-fixture'
  });
  const page = await context.newPage();
  await page.goto(appUrl);
  await expect(page.locator('#sync-status')).toHaveText('認証待ち 1');
  await expect(page.locator('#pwa-login-overlay')).toBeHidden();
  await expect(page.locator('#card-900')).toBeVisible();
  const before = await page.evaluate(() => OfflineSync.loadQueue());
  expect(before[0].id).toBe('fixture-auth-resume');
  expect(before[0].state).toBe('auth');
  expect(delivered).toEqual([]);
  await page.evaluate(() => { PwaAuth.saveToken('new-fixture'); PwaShell.onAuthenticated(); });
  await expect(page.locator('#sync-status')).toHaveText('同期済');
  expect(delivered).toEqual([{ id: 'fixture-auth-resume', token: 'new-fixture' }]);
  expect(await page.evaluate(() => OfflineSync.loadQueue())).toEqual([]);
  await context.close();
});

test('二つの画面で同時に端末保存した操作を失わず再表示で全件同期する', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await seed(context);
  await context.addInitScript(() => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }));
  const unique = new Set(), attempts = [];
  await mockBackend(context, async op => { attempts.push(op.id); const duplicate = unique.has(op.id); unique.add(op.id); return { success: true, duplicate }; });
  const first = await context.newPage(), second = await context.newPage();
  await Promise.all([first.goto(appUrl), second.goto(appUrl)]);
  const ids = await Promise.all([first.evaluate(() => OfflineSync.enqueue('recordBTValue', ['900', '2026-10-09', 38.5])),
    second.evaluate(() => OfflineSync.enqueue('recordBTValue', ['900', '2026-10-10', 39]))]);
  await expect.poll(() => first.evaluate(() => OfflineSync.loadQueue().length)).toBe(2);
  await expect.poll(() => second.evaluate(() => OfflineSync.loadQueue().length)).toBe(2);
  await Promise.all([first, second].map(page => page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    window.dispatchEvent(new Event('focus'));
  })));
  await expect(first.locator('#sync-status')).toHaveText('同期済');
  await expect(second.locator('#sync-status')).toHaveText('同期済');
  expect([...unique].sort()).toEqual(ids.sort());
  expect(attempts.every(id => ids.includes(id))).toBe(true);
  expect(await first.evaluate(() => OfflineSync.loadQueue())).toEqual([]);
  await context.close();
});

test('入力と送信が終わってから届いた古い一覧応答でも変更を上書きしない', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await seed(context);
  let releaseStale, refreshRequests = 0;
  const staleRequested = new Promise(resolve => { releaseStale = { requested: resolve }; });
  await mockBackend(context, async () => ({ success: true }), {
    getSnapshot: async () => {
      refreshRequests++;
      if (refreshRequests === 1) return new Promise(resolve => {
        releaseStale.reply = () => resolve({ ...snapshot, morningList: [{ ...snapshot.morningList[0], reason: '古い一覧' }] });
        releaseStale.requested();
      });
      return { ...snapshot, morningList: [{ ...snapshot.morningList[0], reason: '新しい一覧' }] };
    }
  });
  const page = await context.newPage();
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await staleRequested;
  await page.evaluate(() => {
    window.appliedReasons = [];
    const original = App.applyData;
    App.applyData = function(data, render) { window.appliedReasons.push(data.morningList[0].reason); return original.call(App, data, render); };
    OfflineSync.enqueue('recordBTValue', ['900', '2026-10-09', 38.5]);
  });
  await expect.poll(() => page.evaluate(() => OfflineSync.loadQueue().length)).toBe(0);
  releaseStale.reply();
  await expect(page.locator('#sync-status')).toHaveText('同期済');
  await expect.poll(() => page.evaluate(() => Breeding.list[0].reason)).toBe('新しい一覧');
  expect(await page.evaluate(() => window.appliedReasons)).not.toContain('古い一覧');
  await context.close();
});

test('実際のIndexedDBで完了印は再起動後も残り、古いタブから記録を復活させない', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await seed(context);
  await mockBackend(context);
  const page = await context.newPage();
  await page.goto(appUrl);
  const first = await page.evaluate(async () => {
    const op = { id: 'fixture-idb-ack', type: 'recordBTValue', args: ['fixture-only'], updatedAt: 1, state: 'pending' };
    await PwaSyncStore.putOperation(op);
    await Promise.all([PwaSyncStore.acknowledge(op.id), PwaSyncStore.putOperation(op)]);
    return { rows: await PwaSyncStore.getOperations(), acks: await PwaSyncStore.consumeAcknowledgements() };
  });
  expect(first.rows).toEqual([]);
  expect(first.acks).toContain('fixture-idb-ack');
  await page.reload();
  const after = await page.evaluate(async () => ({
    restored: await PwaSyncStore.putOperation({ id: 'fixture-idb-ack', updatedAt: Date.now() }),
    rows: await PwaSyncStore.getOperations(), acks: await PwaSyncStore.consumeAcknowledgements()
  }));
  expect(after.restored).toBe(false);
  expect(after.rows).toEqual([]);
  expect(after.acks).toContain('fixture-idb-ack');
  const permanent = await page.evaluate(async () => {
    await PwaSyncStore.putOperation({ id: 'fixture-tie', state: 'failed', updatedAt: 100 });
    await PwaSyncStore.putOperation({ id: 'fixture-tie', state: 'pending', updatedAt: 100 });
    const sameTime = (await PwaSyncStore.getOperations()).find(op => op.id === 'fixture-tie');
    await PwaSyncStore.putOperation({ id: 'fixture-tie', state: 'pending', updatedAt: 101 }, { explicitRetry: true });
    return { sameTime: sameTime.state, retried: (await PwaSyncStore.getOperations()).find(op => op.id === 'fixture-tie').state };
  });
  expect(permanent).toEqual({ sameTime: 'failed', retried: 'pending' });
  await context.close();
});

test('遅れて返ったSWの通信失敗は画面側の要確認を通信待ちへ戻さない', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  await seed(context);
  await mockBackend(context);
  const page = await context.newPage();
  await page.goto(appUrl);
  await page.evaluate(() => navigator.serviceWorker.ready);
  const worker = context.serviceWorkers()[0];
  const id = 'fixture-stale-worker-outcome';
  await page.evaluate(async id => {
    await PwaSyncStore.saveToken('fixture-token');
    await PwaSyncStore.putOperation({ id, type: 'recordBTValue', args: ['fixture-only'], state: 'pending', createdAt: '2026-10-09T00:00:00Z', updatedAt: 100 });
  }, id);
  await worker.evaluate(() => {
    const original = backendCall;
    self.fixtureRequestStarted = false;
    backendCall = async function(method, args, token, timeout) {
      if (method === 'executeQueuedOperation') {
        self.fixtureRequestStarted = true;
        return new Promise((resolve, reject) => { self.fixtureRejectRequest = () => reject(new Error('late timeout')); });
      }
      return original(method, args, token, timeout);
    };
    self.fixtureSync = syncPendingOperations().catch(error => error.message);
  });
  await expect.poll(() => worker.evaluate(() => self.fixtureRequestStarted)).toBe(true);
  await page.evaluate(async id => {
    await PwaSyncStore.putOperation({ id, type: 'recordBTValue', args: ['fixture-only'], state: 'failed', error: '入力値を確認してください', updatedAt: 101 });
  }, id);
  await worker.evaluate(async () => { self.fixtureRejectRequest(); await self.fixtureSync; });
  const result = await page.evaluate(async id => {
    const afterTimeout = (await PwaSyncStore.getOperations()).find(op => op.id === id);
    const automaticReset = await PwaSyncStore.putOperation({ ...afterTimeout, state: 'pending', updatedAt: Date.now() + 1 });
    const explicitReset = await PwaSyncStore.putOperation({ ...afterTimeout, state: 'pending', updatedAt: Date.now() + 2 }, { explicitRetry: true });
    return { afterTimeout, automaticReset, explicitReset };
  }, id);
  expect(result.afterTimeout.state).toBe('failed');
  expect(result.afterTimeout.error).toBe('入力値を確認してください');
  expect(result.automaticReset).toBe(false);
  expect(result.explicitReset).toBe(true);
  await context.close();
});

test('画面を閉じた後もService WorkerがIndexedDBの操作を送信し完了印を保存する', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  await seed(context);
  const delivered = [];
  await mockBackend(context, async op => { delivered.push(op.id); return { success: true }; });
  const page = await context.newPage();
  await page.goto(appUrl);
  await page.evaluate(() => navigator.serviceWorker.ready);
  const worker = context.serviceWorkers()[0];
  await page.evaluate(async () => {
    await PwaSyncStore.saveToken('fixture-token');
    await PwaSyncStore.putOperation({ id: 'fixture-closed-page', type: 'recordBTValue', args: ['fixture-only', '2026-10-09', 38.5], createdAt: '2026-10-09T00:00:00Z', state: 'pending', updatedAt: Date.now() });
  });
  await page.close();
  const result = await worker.evaluate(async () => {
    await syncPendingOperations();
    return { clients: (await self.clients.matchAll({ type: 'window' })).length, rows: await PwaSyncStore.getOperations(), acks: await PwaSyncStore.consumeAcknowledgements() };
  });
  expect(result.clients).toBe(0);
  expect(result.rows).toEqual([]);
  expect(result.acks).toContain('fixture-closed-page');
  expect(delivered).toEqual(['fixture-closed-page']);
  await context.close();
});

test('Service Worker更新は対象アプリの旧キャッシュだけを消し端末記録を保持する', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  await seed(context);
  await seedQueue(context, 'fixture-cache-upgrade', true);
  await context.route(/https:\/\/script\.google\.com\/|\/mock-backend/, route => route.abort('internetdisconnected'));
  await context.route(appUrl, route => route.fulfill({ contentType: 'text/html', body: '<p>準備用ページ</p>' }));
  const page = await context.newPage();
  await page.goto(appUrl);
  await page.evaluate(async () => {
    await caches.open('breeding-okayama-pwa-v5-history');
    await caches.open('other-farm-cache');
  });
  await context.unroute(appUrl);
  await page.goto(appUrl);
  await page.evaluate(() => navigator.serviceWorker.ready);
  const result = await page.evaluate(async namespace => {
    const cache = await caches.open('breeding-okayama-pwa-v6-autosync');
    return { names: await caches.keys(), assets: (await cache.keys()).map(request => new URL(request.url).pathname),
      token: localStorage.getItem(namespace + ':auth-token'), snapshot: JSON.parse(localStorage.getItem(namespace + ':data-snapshot')), queue: OfflineSync.loadQueue() };
  }, namespace);
  expect(result.names).toContain('other-farm-cache');
  expect(result.names).not.toContain('breeding-okayama-pwa-v5-history');
  for (const asset of ['index.html', 'js_snapshot.js', 'sync-store.js', 'pwa-runtime.js', 'pwa-hooks.js', 'js_offline.js', 'pwa.css']) {
    expect(result.assets).toContain('/hanshoku-kanri-okayama/' + asset);
  }
  expect(result.token).toBe('fixture-token');
  expect(result.snapshot.morningList[0].sowNo).toBe('900');
  expect(result.queue[0].id).toBe('fixture-cache-upgrade');
  await context.close();
});
