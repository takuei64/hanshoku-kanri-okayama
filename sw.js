'use strict';

const CACHE_NAME = 'breeding-okayama-pwa-v2';
const BASE_PATH = '/hanshoku-kanri-okayama/';
const APP_SHELL = [
  BASE_PATH,
  BASE_PATH + 'index.html',
  BASE_PATH + 'manifest.webmanifest',
  BASE_PATH + 'icon-192.png',
  BASE_PATH + 'icon-512.png',
  BASE_PATH + 'breeding.css',
  BASE_PATH + 'pwa.css',
  BASE_PATH + 'pwa-config.js',
  BASE_PATH + 'pwa-runtime.js',
  BASE_PATH + 'pwa-hooks.js',
  BASE_PATH + 'js_offline.js',
  BASE_PATH + 'js_app.js',
  BASE_PATH + 'js_breeding.js',
  BASE_PATH + 'js_postmating.js',
  BASE_PATH + 'js_reheatcheck.js',
  BASE_PATH + 'js_pregcheck.js',
  BASE_PATH + 'js_farrowing.js',
  BASE_PATH + 'js_weaning.js',
  BASE_PATH + 'js_sow.js',
  BASE_PATH + 'js_pentask.js'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) { return cache.addAll(APP_SHELL); })
      .then(function() { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys()
      .then(function(keys) {
        return Promise.all(keys.filter(function(key) { return key !== CACHE_NAME; }).map(function(key) {
          return caches.delete(key);
        }));
      })
      .then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(event) {
  var request = event.request;
  var url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      // 一度準備した端末では、通信確認より先に必ず端末内の画面を返す。
      // これにより圏外・認証画面へのリダイレクト・弱い電波の待ち時間を避ける。
      caches.match(BASE_PATH + 'index.html').then(function(cached) {
        if (cached) return cached;
        return fetch(BASE_PATH + 'index.html').catch(function() {
          return new Response('オフライン準備が未完了です', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(function(cached) {
      if (cached) return cached;
      return fetch(request).then(function(response) {
        if (response && response.ok) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(request, copy); });
        }
        return response;
      });
    })
  );
});
