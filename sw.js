'use strict';

importScripts('./pwa-config.js', './sync-store.js');

const CACHE_NAME = 'breeding-okayama-pwa-v6-autosync';
const BASE_PATH = '/hanshoku-kanri-okayama/';
const APP_SHELL = [
  '', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
  'breeding.css', 'pwa.css', 'pwa-config.js', 'sync-store.js', 'pwa-runtime.js',
  'pwa-hooks.js', 'js_snapshot.js', 'js_offline.js', 'js_app.js', 'js_breeding.js', 'js_postmating.js',
  'js_reheatcheck.js', 'js_pregcheck.js', 'js_farrowing.js', 'js_weaning.js',
  'js_sow.js', 'js_pentask.js'
].map(function(path) { return BASE_PATH + path; });

self.addEventListener('install', function(event) {
  // Install a whole release atomically. Never combine individually refreshed JS
  // with an old HTML shell. updateViaCache:none + registration.update() discovers
  // the new release; cached users can keep entering data during its download.
  event.waitUntil(caches.open(CACHE_NAME).then(function(cache) {
    return cache.addAll(APP_SHELL.map(function(path) { return new Request(path, { cache: 'reload' }); }));
  }).then(function() { return self.skipWaiting(); }));
});

function notifyClients(type) {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clients) {
    clients.forEach(function(client) { client.postMessage({ type: type }); });
  });
}

self.addEventListener('activate', function(event) {
  var replacingPreviousRelease = false;
  event.waitUntil(caches.keys().then(function(keys) {
    replacingPreviousRelease = keys.some(function(key) { return key.indexOf('breeding-okayama-pwa-') === 0 && key !== CACHE_NAME; });
    return Promise.all(keys.filter(function(key) {
      return key.indexOf('breeding-okayama-pwa-') === 0 && key !== CACHE_NAME;
    }).map(function(key) { return caches.delete(key); }));
  }).then(function() { return self.clients.claim(); }).then(function() { if (replacingPreviousRelease) return notifyClients('pwa-update-ready'); }));
});

self.addEventListener('fetch', function(event) {
  var request = event.request;
  var url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.indexOf(BASE_PATH) !== 0) return;
  if (request.mode === 'navigate') {
    event.respondWith(caches.open(CACHE_NAME).then(function(cache) {
      return cache.match(BASE_PATH + 'index.html');
    }).then(function(cached) {
      return cached || fetch(new Request(BASE_PATH + 'index.html', { cache: 'no-store' }));
    }).catch(function() {
      return new Response('オフライン準備が未完了です', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }));
    return;
  }
  if (APP_SHELL.indexOf(url.pathname) < 0) return;
  event.respondWith(caches.open(CACHE_NAME).then(function(cache) {
    return cache.match(url.pathname);
  }).then(function(cached) {
    return cached || fetch(new Request(request, { cache: 'no-store' }));
  }));
});

async function backendCall(method, args, token, timeoutMs) {
  var url = new URL(self.OKAYAMA_APP_CONFIG.backendUrl);
  url.searchParams.set('action', 'pwa');
  url.searchParams.set('transport', 'json');
  url.searchParams.set('method', method);
  url.searchParams.set('requestId', 'sw' + Date.now().toString(36));
  url.searchParams.set('payload', JSON.stringify(args));
  url.searchParams.set('token', token);
  url.searchParams.set('_', String(Date.now()));
  var controller = new AbortController();
  var timer = setTimeout(function() { controller.abort(); }, timeoutMs);
  try {
    var response = await fetch(url.toString(), { cache: 'no-store', credentials: 'omit', redirect: 'follow', signal: controller.signal });
    if (!response.ok) throw new Error('一時的なサーバー障害');
    return await response.json();
  } finally { clearTimeout(timer); }
}

var backgroundSyncRunning = null;
function saveBackgroundOperation(op) {
  var expectedUpdatedAt = Number(op.updatedAt || 0);
  op.updatedAt = Math.max(Date.now(), Number(op.updatedAt || 0) + 1);
  op.errorKind = op.errorCategory === 'validation' ? 'permanent' : op.errorCategory;
  return self.PwaSyncStore.putOperation(op, { expectedUpdatedAt: expectedUpdatedAt });
}
function syncPendingOperations() {
  if (backgroundSyncRunning) return backgroundSyncRunning;
  backgroundSyncRunning = runBackgroundSync().finally(function() { backgroundSyncRunning = null; });
  return backgroundSyncRunning;
}

async function runBackgroundSync() {
  var operations = await self.PwaSyncStore.getOperations();
  operations = operations.filter(function(op) { return op.state !== 'failed'; });
  if (!operations.length) return;
  operations.sort(function(a, b) { return String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id)); });
  var token = await self.PwaSyncStore.getToken();
  var probe = await backendCall('ping', [], token, Number(self.OKAYAMA_APP_CONFIG.pingTimeoutMs) || 3500);
  if (!probe.ok || !probe.result || probe.result.status === 'server' || !probe.result.reachable) throw new Error('疎通確認を再試行します');
  if (!probe.result.authenticated) {
    for (var a = 0; a < operations.length; a++) {
      operations[a].state = 'auth';
      operations[a].error = '再ログイン後に自動送信します';
      operations[a].errorCategory = 'auth';
      await saveBackgroundOperation(operations[a]);
    }
    await notifyClients('pwa-sync-auth');
    return;
  }
  for (var i = 0; i < operations.length; i++) {
    var op = operations[i];
    // A foreground tab may have completed this record since getOperations().
    if ((await self.PwaSyncStore.consumeAcknowledgements()).indexOf(op.id) >= 0) continue;
    var current = (await self.PwaSyncStore.getOperations()).find(function(item) { return item.id === op.id; });
    if (!current || current.state === 'failed') continue;
    op = current;
    var response;
    try {
      // Always reload the token: a foreground login may have renewed it.
      token = await self.PwaSyncStore.getToken();
      response = await backendCall('executeQueuedOperation', [{ id: op.id, type: op.type, args: op.args, createdAt: op.createdAt }], token, Number(self.OKAYAMA_APP_CONFIG.requestTimeoutMs) || 15000);
    } catch (error) {
      op.state = 'pending'; op.errorCategory = 'network'; op.error = '通信待ちです';
      await saveBackgroundOperation(op);
      await notifyClients('pwa-sync-waiting');
      throw error;
    }
    var result = response.result || {};
    if (response.ok && result.success) {
      await self.PwaSyncStore.acknowledge(op.id);
      continue;
    }
    op.error = result.error || response.error || '保存できませんでした';
    if (response.authRequired || result.authRequired || result.category === 'auth' || result.errorKind === 'auth') {
      if (token !== await self.PwaSyncStore.getToken()) { i--; continue; }
      op.state = 'auth'; op.errorCategory = 'auth';
      await saveBackgroundOperation(op);
      await notifyClients('pwa-sync-auth');
      return;
    }
    if (response.retryable || result.retryable) {
      op.state = 'pending'; op.errorCategory = 'network';
      await saveBackgroundOperation(op);
      await notifyClients('pwa-sync-waiting');
      throw new Error('一時的な保存エラー');
    }
    op.state = 'failed'; op.errorCategory = 'validation';
    await saveBackgroundOperation(op);
    await notifyClients('pwa-sync-failed');
  }
  await notifyClients('pwa-sync-complete');
}

self.addEventListener('sync', function(event) {
  if (event.tag === 'okayama-pending-operations') event.waitUntil(syncPendingOperations());
});
