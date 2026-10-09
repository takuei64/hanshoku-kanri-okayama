(function(global) {
  'use strict';

  // Background Sync cannot access localStorage. This mirror is additive: failed
  // writes never remove the foreground queue, and acknowledgements are durable.
  var namespace = String((global.OKAYAMA_APP_CONFIG || {}).storageNamespace || 'hanshoku-kanri-okayama-v1');
  var database;
  function open() {
    if (database) return database;
    database = new Promise(function(resolve, reject) {
      if (!global.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
      var request = global.indexedDB.open(namespace + ':background-sync', 1);
      request.onupgradeneeded = function() {
        var db = request.result;
        if (!db.objectStoreNames.contains('operations')) db.createObjectStore('operations', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('acknowledgements')) db.createObjectStore('acknowledgements', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
      };
      request.onsuccess = function() { resolve(request.result); };
      request.onerror = function() { database = null; reject(request.error); };
      request.onblocked = function() { database = null; reject(new Error('IndexedDB blocked')); };
    });
    return database;
  }

  function transaction(names, mode, work) {
    return open().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(names, mode);
        var result;
        tx.oncomplete = function() { resolve(result); };
        tx.onerror = tx.onabort = function() { reject(tx.error || new Error('IndexedDB transaction failed')); };
        work(tx, function(value) { result = value; });
      });
    });
  }

  global.PwaSyncStore = {
    putOperation: function(op, options) {
      options = options || {};
      return transaction(['operations', 'acknowledgements'], 'readwrite', function(tx, done) {
        var request = tx.objectStore('acknowledgements').get(op.id);
        request.onsuccess = function() {
          if (request.result) { done(false); return; }
          var existing = tx.objectStore('operations').get(op.id);
          existing.onsuccess = function() {
            // A worker's result only updates the exact version that it sent.
            // A late timeout cannot downgrade a newer foreground failure.
            if (Object.prototype.hasOwnProperty.call(options, 'expectedUpdatedAt') &&
                (!existing.result || Number(existing.result.updatedAt || 0) !== Number(options.expectedUpdatedAt || 0))) { done(false); return; }
            if (existing.result && Number(existing.result.updatedAt || 0) > Number(op.updatedAt || 0)) { done(false); return; }
            if (existing.result && !options.explicitRetry &&
                ((existing.result.state === 'failed' && op.state !== 'failed') ||
                 (existing.result.state === 'auth' && (op.state === 'pending' || op.state === 'sending')))) { done(false); return; }
            var severity = { failed: 3, auth: 2, pending: 1, sending: 1 };
            if (existing.result && Number(existing.result.updatedAt || 0) === Number(op.updatedAt || 0) &&
                (severity[existing.result.state] || 0) > (severity[op.state] || 0)) { done(false); return; }
            tx.objectStore('operations').put(op);
            done(true);
          };
        };
      });
    },
    removeOperation: function(id) { return this.acknowledge(id); },
    acknowledge: function(id) {
      return transaction(['operations', 'acknowledgements'], 'readwrite', function(tx) {
        tx.objectStore('acknowledgements').put({ id: id, at: Date.now() });
        tx.objectStore('operations').delete(id);
      });
    },
    getOperations: function() {
      return transaction(['operations'], 'readonly', function(tx, done) {
        var request = tx.objectStore('operations').getAll();
        request.onsuccess = function() { done(request.result || []); };
      });
    },
    // Keep tombstones: an old tab must never resurrect an acknowledged record.
    consumeAcknowledgements: function() {
      return transaction(['acknowledgements'], 'readonly', function(tx, done) {
        var request = tx.objectStore('acknowledgements').getAllKeys();
        request.onsuccess = function() { done(request.result || []); };
      });
    },
    saveToken: function(token) {
      return transaction(['settings'], 'readwrite', function(tx) { tx.objectStore('settings').put(String(token || ''), 'auth-token'); });
    },
    getToken: function() {
      return transaction(['settings'], 'readonly', function(tx, done) {
        var request = tx.objectStore('settings').get('auth-token');
        request.onsuccess = function() { done(request.result || ''); };
      });
    }
  };
})(typeof window !== 'undefined' ? window : self);
