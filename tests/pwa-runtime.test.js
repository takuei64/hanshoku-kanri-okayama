const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.join(__dirname, '..');
const snapshot = { morningList: [{ sowNo: 'fixture-only', penNo: '1' }], locationList: [] };

function runtime({ saved = true, online = true, token = '' } = {}) {
  const storage = new Map();
  const prefix = 'hanshoku-kanri-okayama-v1:';
  if (saved) storage.set(prefix + 'data-snapshot', JSON.stringify(snapshot));
  if (token) storage.set(prefix + 'auth-token', token);
  const elements = new Map(), scripts = [], timers = [], listeners = {};
  function element(tag) {
    return { tagName: tag, hidden: false, style: {}, contentWindow: {}, children: [], addEventListener() {},
      appendChild(child) { this.children.push(child); child.parentNode = this; if (child.id) elements.set(child.id, child); },
      removeChild(child) { child.parentNode = null; },
      querySelector(selector) { return get(selector.replace(/^[.#]/, '')); }
    };
  }
  function get(id) { if (!elements.has(id)) elements.set(id, element('div')); return elements.get(id); }
  const c = vm.createContext({ URL, Promise, Date, Proxy, Math,
    OKAYAMA_APP_CONFIG: { backendUrl: 'https://script.google.com/macros/s/fixture/exec', pingTimeoutMs: 3500 },
    navigator: { onLine: online },
    document: { body: element('body'), createElement: element, getElementById: get,
      head: { appendChild(script) { scripts.push(script); script.parentNode = { removeChild() {} }; } } },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) },
    setTimeout(fn, ms) { const task = { fn, ms }; timers.push(task); return task; }, clearTimeout(task) { if (task) task.cleared = true; },
    addEventListener(name, fn) { listeners[name] = fn; },
    OfflineSync: { queue: [], hasUnresolved() { return this.queue.length > 0; }, updateStatus() {}, refreshCompleted() {}, retryPendingNow(auth) { this.authRetry = auth; } },
    App: { authToken: token, toast() {}, navigateTo() {} },
    Breeding: { list: [] }, PostMating: { list: [] }, Farrowing: { list: [] }, SowLocation: { list: [] },
    ReheatCheck: { list: [] }, PregCheck: { list: [] }, PenTask: { list: [] }
  });
  c.window = c;
  vm.runInContext(fs.readFileSync(path.join(root, 'pwa-runtime.js'), 'utf8'), c);
  function reply(result, envelope = {}) {
    const script = scripts[scripts.length - 1];
    const id = new URL(script.src).searchParams.get('requestId');
    c.PwaJsonp.handle({ requestId: id, ok: true, result, ...envelope });
  }
  return { c, elements, scripts, storage, timers, reply, listeners };
}

test('snapshot opens immediately even when navigator says online and backend never replies', async () => {
  const { c, timers, scripts } = runtime();
  c.PwaShell.init();
  assert.equal(c.PwaShell.gate.hidden, true);
  assert.equal(c.PwaAuth.overlay.hidden, true);
  assert.equal(c.PwaAuth.frame.src, undefined);
  assert.equal(new URL(scripts[0].src).searchParams.get('method'), 'ping');
  const pending = c.PwaNetwork.pending;
  timers.find(task => task.ms === 3500).fn();
  assert.equal((await pending).state, 'offline');
  assert.equal(c.PwaAuth.overlay.hidden, true);
  assert.equal(c.PwaStore.hasSnapshot(), true);
});

test('complete offline snapshot boot requires no backend or login request', () => {
  const { c, scripts } = runtime({ online: false });
  c.PwaShell.init();
  assert.equal(c.PwaShell.gate.hidden, true);
  assert.equal(c.PwaAuth.overlay.hidden, true);
  assert.equal(scripts.length, 0);
});

test('reachable expired auth shows a nonblocking prompt; explicit login has offline exit', async () => {
  const { c, reply } = runtime({ token: 'expired-fixture' });
  c.PwaShell.init();
  reply({ reachable: true, authenticated: false, status: 'auth' });
  await c.PwaNetwork.pending;
  await Promise.resolve();
  assert.equal(c.PwaAuth.overlay.hidden, true);
  assert.equal(c.PwaAuth.prompt.hidden, false);
  const login = c.PwaAuth.showLogin(true);
  reply({ reachable: true, authenticated: false, status: 'auth' });
  await login;
  assert.equal(c.PwaAuth.overlay.hidden, false);
  assert.equal(c.document.getElementById('pwa-login-footer').hidden, false);
  c.PwaAuth.continueOffline();
  assert.equal(c.PwaAuth.overlay.hidden, true);
  assert.equal(c.PwaShell.gate.hidden, true);
});

test('a late server snapshot cannot overwrite input queued during its request', async () => {
  const { c, reply, storage } = runtime({ token: 'fixture-token' });
  const refreshing = c.PwaShell.backgroundRefresh(false);
  reply({ reachable: true, authenticated: true, status: 'online' });
  await c.PwaNetwork.pending;
  await Promise.resolve();
  c.OfflineSync.queue.push({ id: 'new-input' });
  reply({ morningList: [], locationList: [] });
  assert.equal(await refreshing, false);
  assert.deepEqual(JSON.parse(storage.get('hanshoku-kanri-okayama-v1:data-snapshot')), snapshot);
});

test('stale auth errors cannot clear a token renewed while a request was in flight', () => {
  const { c, reply } = runtime({ token: 'old-fixture' });
  let failure;
  c.PwaJsonp.call('getInitialDataCached', ['old-fixture'], () => {}, error => { failure = error; });
  c.PwaAuth.saveToken('renewed-fixture');
  reply(null, { ok: false, authRequired: true, error: '認証が切れました' });
  assert.equal(c.PwaAuth.loadToken(), 'renewed-fixture');
  assert.equal(failure.retryable, true);
  assert.equal(failure.category, 'network');
});

test('refresh replies from before a completed local change are rejected even after queue drains', async () => {
  const { c, reply, storage } = runtime({ token: 'fixture-token' });
  let revision = 'before-input';
  c.OfflineSync.mutationRevision = () => revision;
  const refreshing = c.PwaShell.backgroundRefresh(false);
  reply({ reachable: true, authenticated: true, status: 'online' });
  await c.PwaNetwork.pending;
  await Promise.resolve();
  revision = 'input-already-sent';
  reply({ morningList: [], locationList: [] });
  assert.equal(await refreshing, false);
  assert.deepEqual(JSON.parse(storage.get('hanshoku-kanri-okayama-v1:data-snapshot')), snapshot);
});

test('snapshot capture delegates to the shared merge-aware writer', () => {
  const { c, storage } = runtime();
  let captures = 0;
  c.App.captureSnapshot = () => { captures++; return false; };
  assert.equal(c.PwaStore.captureCurrentData(), false);
  assert.equal(captures, 1);
  assert.deepEqual(JSON.parse(storage.get('hanshoku-kanri-okayama-v1:data-snapshot')), snapshot);
});

test('first preparation cannot report success when the shared snapshot writer fails', async () => {
  const { c, reply } = runtime({ saved: false, token: 'fixture-token' });
  const toasts = [];
  let completed = 0, written = 0;
  c.App.toast = message => toasts.push(message);
  c.App.applyData = () => {};
  c.App.writeSnapshot = () => { written++; return false; };
  c.OfflineSync.refreshCompleted = () => completed++;
  c.PwaStore.saveSnapshot = () => { throw new Error('must use the shared writer'); };
  const refreshing = c.PwaShell.backgroundRefresh(true);
  reply({ reachable: true, authenticated: true, status: 'online' });
  await c.PwaNetwork.pending;
  await Promise.resolve();
  reply(snapshot);
  assert.equal(await refreshing, false);
  assert.equal(written, 1);
  assert.equal(completed, 0);
  assert.equal(c.PwaStore.hasSnapshot(), false);
  assert.equal(c.PwaShell.gate.hidden, false);
  assert.equal(c.document.getElementById('pwa-gate-title').textContent, '端末保存に失敗しました');
  assert.ok(!toasts.includes('オフライン準備が完了しました'));
});

function worker(operations, respond) {
  const handlers = {}, records = new Map(operations.map(op => [op.id, structuredClone(op)])), acks = new Set(), calls = [], messages = [];
  const c = vm.createContext({ URL, Promise, Date, AbortController, setTimeout, clearTimeout, importScripts() {},
    fetch: async url => {
      const parsed = new URL(url), method = parsed.searchParams.get('method'), payload = JSON.parse(parsed.searchParams.get('payload'));
      calls.push({ method, payload, transport: parsed.searchParams.get('transport') });
      const body = method === 'ping' ? { ok: true, result: { reachable: true, authenticated: true, status: 'online' } } : await respond(payload[0]);
      return { ok: true, json: async () => body };
    },
    self: { OKAYAMA_APP_CONFIG: { backendUrl: 'https://script.google.com/macros/s/fixture/exec' },
      addEventListener(name, handler) { handlers[name] = handler; },
      clients: { matchAll: async () => [{ postMessage(message) { messages.push(message); } }] },
      PwaSyncStore: {
        getOperations: async () => structuredClone([...records.values()]), getToken: async () => 'fixture-token',
        consumeAcknowledgements: async () => [...acks],
        putOperation: async op => { if (!acks.has(op.id)) records.set(op.id, structuredClone(op)); },
        acknowledge: async id => { acks.add(id); records.delete(id); }
      }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), c);
  return { c, records, acks, calls, messages, handlers };
}

const queued = id => ({ id, type: 'recordBTValue', args: ['fixture-only', '2026-10-09', 38.5], createdAt: '2026-10-09T00:00:00Z', state: 'pending' });

test('background sync executes every mirrored record without any page, same concurrent sync shares one run', async () => {
  const { c, records, acks, calls } = worker([queued('a'), queued('b')], async () => ({ ok: true, result: { success: true } }));
  c.self.clients.matchAll = async () => [];
  const first = c.syncPendingOperations(), second = c.syncPendingOperations();
  assert.equal(first, second);
  await first;
  assert.equal(records.size, 0);
  assert.deepEqual([...acks], ['a', 'b']);
  assert.deepEqual(calls.filter(call => call.method === 'executeQueuedOperation').map(call => call.payload[0].id), ['a', 'b']);
  assert.ok(calls.every(call => call.transport === 'json'));
});

test('lost response preserves background operation ID until a retry acknowledgement arrives', async () => {
  let attempts = 0;
  const { c, records, acks, calls } = worker([queued('lost-response')], async () => {
    if (++attempts === 1) throw new Error('response lost after server commit');
    return { ok: true, result: { success: true, duplicate: true } };
  });
  await assert.rejects(c.syncPendingOperations());
  assert.equal(records.get('lost-response').state, 'pending');
  await c.syncPendingOperations();
  assert.equal(acks.has('lost-response'), true);
  assert.deepEqual(calls.filter(call => call.method === 'executeQueuedOperation').map(call => call.payload[0].id), ['lost-response', 'lost-response']);
});

test('background permanent errors stay for review and do not block independent valid records', async () => {
  const { c, records, calls, acks } = worker([queued('a-invalid'), queued('b-valid')], async op => ({ ok: true, result: op.id === 'a-invalid' ? { success: false, error: '対象なし', retryable: false } : { success: true } }));
  await c.syncPendingOperations();
  assert.equal(records.get('a-invalid').state, 'failed');
  assert.equal(records.get('a-invalid').errorKind, 'permanent');
  assert.ok(records.get('a-invalid').updatedAt > 0);
  assert.equal(acks.has('b-valid'), true);
  const before = calls.length;
  await c.syncPendingOperations();
  assert.equal(calls.length, before);
});

test('background auth errors preserve records for login instead of acknowledging them', async () => {
  const { c, records, acks } = worker([queued('needs-auth')], async () => ({ ok: false, authRequired: true, error: '認証が切れました' }));
  await c.syncPendingOperations();
  assert.equal(records.get('needs-auth').state, 'auth');
  assert.equal(acks.size, 0);
});
