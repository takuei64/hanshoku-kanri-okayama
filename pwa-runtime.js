(function(global) {
  'use strict';

  var APP_CONFIG = global.OKAYAMA_APP_CONFIG || {};
  var BACKEND_URL = String(APP_CONFIG.backendUrl || '');
  var STORAGE_NAMESPACE = String(APP_CONFIG.storageNamespace || 'hanshoku-kanri-okayama-v1');

  var PwaStore = {
    snapshotKey: STORAGE_NAMESPACE + ':data-snapshot',
    snapshotTimeKey: STORAGE_NAMESPACE + ':data-snapshot-time',
    cardPrefix: STORAGE_NAMESPACE + ':sow-card:',

    loadInitialData: function() {
      try {
        var raw = localStorage.getItem(PwaStore.snapshotKey);
        var data = raw ? JSON.parse(raw) : null;
        return data && typeof data === 'object' ? data : {};
      } catch (e) {
        return {};
      }
    },

    hasSnapshot: function() {
      try { return !!localStorage.getItem(PwaStore.snapshotKey); } catch (e) { return false; }
    },

    saveSnapshot: function(data) {
      if (!data || typeof data !== 'object') return false;
      try {
        localStorage.setItem(PwaStore.snapshotKey, JSON.stringify(data));
        localStorage.setItem(PwaStore.snapshotTimeKey, new Date().toISOString());
        return true;
      } catch (e) {
        return false;
      }
    },

    captureCurrentData: function() {
      if (typeof Breeding === 'undefined' || typeof SowLocation === 'undefined') return false;
      return PwaStore.saveSnapshot({
        morningList: Breeding.list || [],
        postMatingList: typeof PostMating !== 'undefined' ? (PostMating.list || []) : [],
        farrowingList: typeof Farrowing !== 'undefined' ? (Farrowing.list || []) : [],
        accidentList: typeof Farrowing !== 'undefined' ? (Farrowing.accidentList || []) : [],
        locationList: SowLocation.list || [],
        reheatCheckList: typeof ReheatCheck !== 'undefined' ? (ReheatCheck.list || []) : [],
        pregnancyCheckList: typeof PregCheck !== 'undefined' ? (PregCheck.list || []) : [],
        penTaskList: typeof PenTask !== 'undefined' ? (PenTask.list || []) : []
      });
    },

    saveCard: function(sowNo, data) {
      try {
        localStorage.setItem(PwaStore.cardPrefix + String(sowNo), JSON.stringify(data));
      } catch (e) {}
    },

    loadCard: function(sowNo) {
      try {
        var raw = localStorage.getItem(PwaStore.cardPrefix + String(sowNo));
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    }
  };

  var PwaAuth = {
    storageKey: STORAGE_NAMESPACE + ':auth-token',
    overlay: null,
    frame: null,

    loadToken: function() {
      try { return localStorage.getItem(PwaAuth.storageKey) || ''; } catch (e) { return ''; }
    },

    saveToken: function(token) {
      try { localStorage.setItem(PwaAuth.storageKey, token); } catch (e) {}
      if (typeof App !== 'undefined') App.authToken = token;
    },

    clearToken: function() {
      try { localStorage.removeItem(PwaAuth.storageKey); } catch (e) {}
      if (typeof App !== 'undefined') App.authToken = '';
    },

    ensureUi: function() {
      if (PwaAuth.overlay || !document.body) return;
      var overlay = document.createElement('div');
      overlay.id = 'pwa-login-overlay';
      overlay.className = 'pwa-overlay';
      overlay.hidden = true;
      overlay.innerHTML =
        '<div class="pwa-login-card">' +
          '<div class="pwa-login-title">繁殖管理へログイン</div>' +
          '<iframe class="pwa-login-frame" id="pwa-login-frame" title="繁殖管理ログイン"></iframe>' +
          '<div class="pwa-login-footer" id="pwa-login-footer">' +
            '<button class="pwa-login-skip" type="button">保存済みデータで続ける</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      PwaAuth.overlay = overlay;
      PwaAuth.frame = document.getElementById('pwa-login-frame');
      overlay.querySelector('.pwa-login-skip').addEventListener('click', PwaAuth.continueOffline);
    },

    showLogin: function() {
      if (navigator.onLine === false) {
        if (!PwaStore.hasSnapshot()) PwaShell.showFirstUseGate(false);
        return;
      }
      PwaAuth.ensureUi();
      if (!PwaAuth.overlay || !PwaAuth.frame) return;
      if (!PwaAuth.overlay.hidden) return;
      if (!BACKEND_URL) {
        PwaShell.showConfigurationError();
        return;
      }
      document.getElementById('pwa-login-footer').hidden = !PwaStore.hasSnapshot();
      PwaAuth.overlay.hidden = false;
      PwaAuth.frame.src = BACKEND_URL + '?pwaLogin=1&_=' + Date.now();
    },

    hideLogin: function() {
      if (PwaAuth.overlay) PwaAuth.overlay.hidden = true;
    },

    continueOffline: function() {
      PwaAuth.hideLogin();
      if (typeof App !== 'undefined') App.toast('保存済みデータで続けます');
    },

    receiveMessage: function(event) {
      var data = event.data || {};
      if (data.type !== 'breeding-navigate' || !data.url) return;
      try {
        var url = new URL(data.url);
        if (url.hostname !== 'script.google.com') return;
        var token = url.searchParams.get('token') || '';
        if (!token) return;
        try { event.source.postMessage({ type: 'breeding-wrapper-ack' }, '*'); } catch (e) {}
        PwaAuth.saveToken(token);
        PwaAuth.hideLogin();
        PwaShell.onAuthenticated();
      } catch (e) {}
    },

    init: function() {
      PwaAuth.ensureUi();
      global.addEventListener('message', PwaAuth.receiveMessage);
    }
  };

  var PwaJsonp = {
    calls: {},

    createId: function() {
      return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    },

    call: function(method, args, success, failure) {
      var callArgs = Array.prototype.slice.call(args || []);
      var token = String(callArgs.pop() || PwaAuth.loadToken() || '');

      if (navigator.onLine === false) {
        if (method === 'getSowCard') {
          var cachedCard = PwaStore.loadCard(callArgs[0]);
          if (cachedCard) {
            setTimeout(function() { if (success) success(cachedCard); }, 0);
            return;
          }
        }
        setTimeout(function() {
          if (failure) failure({ message: 'オフラインです。保存済みデータを表示しています' });
        }, 0);
        return;
      }

      if (!token) {
        PwaAuth.showLogin();
        setTimeout(function() {
          if (failure) failure({ message: '認証が必要です' });
        }, 0);
        return;
      }

      var requestId = PwaJsonp.createId();
      var script = document.createElement('script');
      var url = new URL(BACKEND_URL);
      url.searchParams.set('action', 'pwa');
      url.searchParams.set('method', method);
      url.searchParams.set('requestId', requestId);
      url.searchParams.set('token', token);
      url.searchParams.set('payload', JSON.stringify(callArgs));
      url.searchParams.set('_', String(Date.now()));

      var timeoutId = setTimeout(function() {
        PwaJsonp.finish(requestId, false, null, '通信がタイムアウトしました');
      }, 22000);

      PwaJsonp.calls[requestId] = {
        method: method,
        args: callArgs,
        success: success,
        failure: failure,
        script: script,
        timeoutId: timeoutId
      };
      script.async = true;
      script.src = url.toString();
      script.onerror = function() {
        PwaJsonp.finish(requestId, false, null, '通信できませんでした');
      };
      document.head.appendChild(script);
    },

    handle: function(response) {
      if (!response || !response.requestId) return;
      var call = PwaJsonp.calls[response.requestId];
      if (!call) return;
      if (response.authRequired) {
        PwaAuth.clearToken();
        PwaAuth.showLogin();
        PwaJsonp.finish(response.requestId, false, null, response.error || '認証が切れました');
        return;
      }
      PwaJsonp.finish(response.requestId, response.ok === true, response.result, response.error || '処理できませんでした');
    },

    finish: function(requestId, ok, result, error) {
      var call = PwaJsonp.calls[requestId];
      if (!call) return;
      clearTimeout(call.timeoutId);
      if (call.script && call.script.parentNode) call.script.parentNode.removeChild(call.script);
      delete PwaJsonp.calls[requestId];

      if (ok) {
        if (call.method === 'refreshAllData' || call.method === 'getInitialDataCached') {
          PwaStore.saveSnapshot(result);
        }
        if (call.method === 'getSowCard' && call.args.length) {
          PwaStore.saveCard(call.args[0], result);
        }
        if (call.success) call.success(result);
      } else if (call.failure) {
        call.failure({ message: error || '通信エラー' });
      }
    }
  };

  function createScriptRunner(success, failure) {
    return new Proxy({}, {
      get: function(target, property) {
        if (property === 'withSuccessHandler') {
          return function(handler) { return createScriptRunner(handler, failure); };
        }
        if (property === 'withFailureHandler') {
          return function(handler) { return createScriptRunner(success, handler); };
        }
        return function() {
          PwaJsonp.call(String(property), arguments, success, failure);
        };
      }
    });
  }

  var PwaShell = {
    gate: null,
    refreshing: false,

    ensureGate: function() {
      if (PwaShell.gate || !document.body) return;
      var gate = document.createElement('div');
      gate.id = 'pwa-first-use';
      gate.className = 'pwa-overlay';
      gate.hidden = true;
      gate.innerHTML =
        '<div class="pwa-gate-card">' +
          '<div class="pwa-gate-icon">&#128246;</div>' +
          '<div class="pwa-gate-title" id="pwa-gate-title">初回準備が必要です</div>' +
          '<div class="pwa-gate-message" id="pwa-gate-message"></div>' +
          '<button class="pwa-gate-action" id="pwa-gate-action" type="button">再試行</button>' +
        '</div>';
      document.body.appendChild(gate);
      gate.querySelector('#pwa-gate-action').addEventListener('click', function() {
        if (navigator.onLine === false) {
          if (typeof App !== 'undefined') App.toast('まだ電波がありません');
          return;
        }
        if (!PwaAuth.loadToken()) PwaAuth.showLogin();
        else PwaShell.backgroundRefresh(true);
      });
      PwaShell.gate = gate;
    },

    showConfigurationError: function() {
      PwaShell.ensureGate();
      document.getElementById('pwa-gate-title').textContent = '公開設定が未完了です';
      document.getElementById('pwa-gate-message').textContent = '管理者が岡山版の接続先を設定しています。';
      document.getElementById('pwa-gate-action').hidden = true;
      PwaShell.gate.hidden = false;
    },

    showFirstUseGate: function(loading) {
      PwaShell.ensureGate();
      var title = document.getElementById('pwa-gate-title');
      var message = document.getElementById('pwa-gate-message');
      var action = document.getElementById('pwa-gate-action');
      title.textContent = loading ? 'データを準備中です' : '初回準備が必要です';
      message.textContent = loading
        ? '繁殖データをこの端末へ保存しています。'
        : 'この端末ではまだデータを保存していません。電波のある場所で一度ログインしてください。以後は圏外から起動できます。';
      action.hidden = !!loading;
      PwaShell.gate.hidden = false;
    },

    hideGate: function() {
      if (PwaShell.gate) PwaShell.gate.hidden = true;
    },

    applyData: function(data) {
      if (!data || typeof data !== 'object') return;
      Breeding.list = data.morningList || [];
      PostMating.list = data.postMatingList || [];
      Farrowing.list = data.farrowingList || [];
      Farrowing.accidentList = data.accidentList || [];
      SowLocation.list = data.locationList || [];
      ReheatCheck.list = data.reheatCheckList || [];
      PregCheck.list = data.pregnancyCheckList || [];
      PenTask.list = data.penTaskList || [];
      PwaStore.saveSnapshot(data);
      if (typeof App !== 'undefined') App.navigateTo(App.currentPage || 'breeding');
    },

    backgroundRefresh: function(firstSetup) {
      if (PwaShell.refreshing || navigator.onLine === false) return;
      if (typeof OfflineSync !== 'undefined' && OfflineSync.hasPending()) return;
      var token = PwaAuth.loadToken();
      if (!token) {
        PwaAuth.showLogin();
        return;
      }
      PwaShell.refreshing = true;
      if (firstSetup || !PwaStore.hasSnapshot()) PwaShell.showFirstUseGate(true);
      PwaJsonp.call('getInitialDataCached', [token], function(data) {
        PwaShell.refreshing = false;
        PwaShell.applyData(data);
        PwaShell.hideGate();
        if (firstSetup && typeof App !== 'undefined') App.toast('オフライン準備が完了しました');
      }, function(error) {
        PwaShell.refreshing = false;
        if (!PwaStore.hasSnapshot()) PwaShell.showFirstUseGate(false);
        if (firstSetup && typeof App !== 'undefined' && error && error.message !== '認証が必要です') {
          App.toast(error.message || 'データを取得できませんでした');
        }
      });
    },

    onAuthenticated: function() {
      PwaShell.backgroundRefresh(!PwaStore.hasSnapshot());
      if (typeof OfflineSync !== 'undefined') OfflineSync.retryPendingNow();
    },

    init: function() {
      PwaShell.ensureGate();
      PwaAuth.init();
      if (PwaStore.hasSnapshot()) {
        PwaShell.hideGate();
        if (navigator.onLine !== false) {
          if (PwaAuth.loadToken()) PwaShell.backgroundRefresh(false);
          else PwaAuth.showLogin();
        }
      } else if (navigator.onLine === false) {
        PwaShell.showFirstUseGate(false);
      } else if (PwaAuth.loadToken()) {
        PwaShell.backgroundRefresh(true);
      } else {
        PwaAuth.showLogin();
      }

      global.addEventListener('online', function() {
        if (!PwaAuth.loadToken()) PwaAuth.showLogin();
        else PwaShell.backgroundRefresh(!PwaStore.hasSnapshot());
      });
      global.addEventListener('offline', function() {
        if (!PwaStore.hasSnapshot()) PwaShell.showFirstUseGate(false);
        PwaAuth.hideLogin();
      });
    }
  };

  global.PwaStore = PwaStore;
  global.PwaAuth = PwaAuth;
  global.PwaJsonp = PwaJsonp;
  global.PwaShell = PwaShell;
  global.google = global.google || {};
  global.google.script = global.google.script || {};
  global.google.script.run = createScriptRunner(null, null);
})(window);
