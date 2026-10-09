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
      var data = PwaStore.loadInitialData();
      return Array.isArray(data.morningList) && Array.isArray(data.locationList);
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
      if (typeof App !== 'undefined' && typeof App.captureSnapshot === 'function') return App.captureSnapshot();
      if (typeof Breeding === 'undefined' || typeof SowLocation === 'undefined') return false;
      return PwaStore.saveSnapshot({
        morningList: Breeding.list || [],
        postMatingList: typeof PostMating !== 'undefined' ? (PostMating.list || []) : [],
        farrowingList: typeof Farrowing !== 'undefined' ? (Farrowing.list || []) : [],
        accidentList: typeof Farrowing !== 'undefined' ? (Farrowing.accidentList || []) : [],
        locationList: SowLocation.list || [],
        reheatCheckList: typeof ReheatCheck !== 'undefined' ? (ReheatCheck.list || []) : [],
        pregnancyCheckList: typeof PregCheck !== 'undefined' ? (PregCheck.list || []) : [],
        penTaskList: typeof PenTask !== 'undefined' ? (PenTask.list || []) : [],
        penList: typeof App !== 'undefined' ? (App.penList || []) : [],
        penTaskConfig: typeof PenTask !== 'undefined' ? {
          farrowingTypes: PenTask.farrowingTaskTypes || [], breedingTypes: PenTask.breedingTaskTypes || [], days: PenTask.dueDays || {}
        } : {},
        __offlineApplied: PwaStore.loadInitialData().__offlineApplied || []
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
    prompt: null,
    loginTimer: null,

    loadToken: function() {
      try { return localStorage.getItem(PwaAuth.storageKey) || ''; } catch (e) { return ''; }
    },

    saveToken: function(token) {
      try { localStorage.setItem(PwaAuth.storageKey, token); } catch (e) {}
      if (typeof App !== 'undefined') App.authToken = token;
      PwaNetwork.invalidate();
      if (global.PwaSyncStore) global.PwaSyncStore.saveToken(token).then(function() { PwaBackgroundSync.register(); }).catch(function() {});
    },

    clearToken: function() {
      try { localStorage.removeItem(PwaAuth.storageKey); } catch (e) {}
      if (typeof App !== 'undefined') App.authToken = '';
      if (global.PwaSyncStore) global.PwaSyncStore.saveToken('').catch(function() {});
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
          '<div class="pwa-login-footer" id="pwa-login-footer">' +
            '<button class="pwa-login-skip" type="button">オフラインで続ける（保存済みデータ）</button>' +
          '</div>' +
          '<iframe class="pwa-login-frame" id="pwa-login-frame" title="繁殖管理ログイン"></iframe>' +
        '</div>';
      document.body.appendChild(overlay);
      PwaAuth.overlay = overlay;
      PwaAuth.frame = document.getElementById('pwa-login-frame');
      PwaAuth.frame.addEventListener('load', function() { clearTimeout(PwaAuth.loginTimer); });
      overlay.querySelector('.pwa-login-skip').addEventListener('click', PwaAuth.continueOffline);
      var prompt = document.createElement('div');
      prompt.id = 'pwa-auth-prompt';
      prompt.className = 'pwa-auth-prompt';
      prompt.hidden = true;
      prompt.innerHTML = '<span>端末へ保存できます。同期には再ログインが必要です。</span><button type="button">ログイン</button>';
      prompt.querySelector('button').addEventListener('click', function() { PwaAuth.showLogin(true); });
      document.body.appendChild(prompt);
      PwaAuth.prompt = prompt;
    },

    showLogin: function(explicit) {
      PwaAuth.ensureUi();
      return PwaNetwork.check(!!explicit).then(function(network) {
        if (!network.reachable || network.state === 'server') {
          PwaAuth.hideLogin();
          if (!PwaStore.hasSnapshot()) PwaShell.showFirstUseGate(false);
          return;
        }
        if (PwaStore.hasSnapshot() && !explicit) {
          PwaShell.hideGate();
          PwaAuth.prompt.hidden = false;
          return;
        }
        if (!PwaAuth.overlay || !PwaAuth.frame || !PwaAuth.overlay.hidden) return;
        document.getElementById('pwa-login-footer').hidden = !PwaStore.hasSnapshot();
        PwaShell.hideGate();
        PwaAuth.overlay.hidden = false;
        PwaAuth.frame.src = BACKEND_URL + '?pwaLogin=1&_=' + Date.now();
        // Even a reachable API does not guarantee that the login iframe loads.
        // Cached users can always continue; a stalled iframe releases itself.
        // A loaded login form stays open while the user types.
        if (PwaStore.hasSnapshot()) PwaAuth.loginTimer = setTimeout(function() {
          PwaAuth.hideLogin();
          if (PwaAuth.prompt) PwaAuth.prompt.hidden = false;
        }, 8000);
      });
    },

    hideLogin: function() {
      if (PwaAuth.overlay) PwaAuth.overlay.hidden = true;
      clearTimeout(PwaAuth.loginTimer);
    },

    continueOffline: function() {
      PwaAuth.hideLogin();
      PwaShell.hideGate();
      if (typeof App !== 'undefined') App.toast('保存済みデータで続けます');
    },

    receiveMessage: function(event) {
      var data = event.data || {};
      if (data.type !== 'breeding-navigate' || !data.url) return;
      if (!PwaAuth.frame || !PwaAuth.frame.src) return;
      // Apps Script runs the form inside its own nested sandbox iframe.
      var source = event.source;
      var belongsToLogin = false;
      try {
        for (var depth = 0; source && depth < 5; depth++) {
          if (source === PwaAuth.frame.contentWindow) { belongsToLogin = true; break; }
          if (source === global || source === source.parent) break;
          source = source.parent;
        }
      } catch (e) {}
      if (!belongsToLogin) return;
      if (!/^https:\/\/(script\.google\.com|[a-z0-9-]+\.googleusercontent\.com)$/.test(event.origin || '')) return;
      try {
        var url = new URL(data.url);
        var backend = new URL(BACKEND_URL);
        if (url.origin !== backend.origin || url.pathname !== backend.pathname) return;
        var token = url.searchParams.get('token') || '';
        if (!token) return;
        try { event.source.postMessage({ type: 'breeding-wrapper-ack' }, '*'); } catch (e) {}
        PwaAuth.saveToken(token);
        PwaAuth.hideLogin();
        if (PwaAuth.prompt) PwaAuth.prompt.hidden = true;
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

    call: function(method, args, success, failure, options) {
      options = options || {};
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
          if (failure) failure({ message: 'オフラインです。保存済みデータを表示しています', category: 'network', retryable: true });
        }, 0);
        return;
      }

      if (!token && method !== 'ping') {
        PwaAuth.showLogin();
        setTimeout(function() {
          if (failure) failure({ message: '認証が必要です', category: 'auth', authRequired: true });
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
      }, options.timeoutMs || Number(APP_CONFIG.requestTimeoutMs) || 15000);

      PwaJsonp.calls[requestId] = {
        method: method,
        token: token,
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
        if (call.token !== PwaAuth.loadToken()) {
          PwaJsonp.finish(response.requestId, false, null, { message: '新しい認証で再送します', category: 'network', retryable: true });
          return;
        }
        PwaAuth.clearToken();
        PwaNetwork.result = { state: 'auth', reachable: true, authenticated: false };
        PwaNetwork.checkedAt = Date.now();
        PwaAuth.showLogin();
        PwaJsonp.finish(response.requestId, false, null, { message: response.error || '認証が切れました', category: 'auth', authRequired: true });
        return;
      }
      PwaJsonp.finish(response.requestId, response.ok === true, response.result, { message: response.error || '処理できませんでした', category: response.category || (response.retryable ? 'server' : 'validation'), retryable: !!response.retryable });
    },

    finish: function(requestId, ok, result, error) {
      var call = PwaJsonp.calls[requestId];
      if (!call) return;
      clearTimeout(call.timeoutId);
      if (call.script && call.script.parentNode) call.script.parentNode.removeChild(call.script);
      delete PwaJsonp.calls[requestId];

      if (ok) {
        if (call.success) call.success(result);
      } else if (call.failure) {
        call.failure(typeof error === 'object' ? error : { message: error || '通信エラー', category: 'network', retryable: true });
      }
    }
  };

  var PwaNetwork = {
    result: { state: 'unknown', reachable: false, authenticated: false },
    checkedAt: 0,
    pending: null,
    invalidate: function() { PwaNetwork.checkedAt = 0; },
    check: function(force) {
      if (navigator.onLine === false) {
        PwaNetwork.result = { state: 'offline', reachable: false, authenticated: false };
        PwaNetwork.checkedAt = Date.now();
        return Promise.resolve(PwaNetwork.result);
      }
      if (PwaNetwork.pending) return PwaNetwork.pending;
      if (!force && PwaNetwork.checkedAt && Date.now() - PwaNetwork.checkedAt < 10000) return Promise.resolve(PwaNetwork.result);
      if (!BACKEND_URL) return Promise.resolve({ state: 'offline', reachable: false, authenticated: false });
      var requestedToken = PwaAuth.loadToken();
      PwaNetwork.pending = new Promise(function(resolve) {
        function done(result) {
          PwaNetwork.result = result;
          PwaNetwork.checkedAt = Date.now();
          resolve(result);
        }
        PwaJsonp.call('ping', [requestedToken], function(result) {
          if (!result || result.reachable !== true) {
            done({ state: 'server', reachable: false, authenticated: false });
            return;
          }
          done({ state: result.status === 'server' ? 'server' : (result.authenticated ? 'online' : 'auth'), reachable: true, authenticated: result.authenticated === true });
        }, function(error) {
          done({ state: error && error.category === 'server' ? 'server' : 'offline', reachable: false, authenticated: false });
        }, { timeoutMs: Number(APP_CONFIG.pingTimeoutMs) || 3500 });
      }).then(function(result) {
        PwaNetwork.pending = null;
        if (requestedToken !== PwaAuth.loadToken()) return PwaNetwork.check(true);
        if (typeof OfflineSync !== 'undefined') OfflineSync.updateStatus();
        return result;
      });
      return PwaNetwork.pending;
    }
  };

  var PwaBackgroundSync = {
    register: function() {
      if (!navigator.serviceWorker) return Promise.resolve(false);
      return navigator.serviceWorker.ready.then(function(registration) {
        if (!registration.sync) return false;
        return registration.sync.register('okayama-pending-operations').then(function() { return true; });
      }).catch(function() { return false; });
    },
    init: function() {
      if (global.PwaSyncStore) global.PwaSyncStore.saveToken(PwaAuth.loadToken()).catch(function() {});
      if (!navigator.serviceWorker) return;
      navigator.serviceWorker.addEventListener('message', function(event) {
        var type = (event.data || {}).type || '';
        if (type.indexOf('pwa-sync-') === 0 && typeof OfflineSync !== 'undefined') OfflineSync.retryPendingNow();
        if (type === 'pwa-update-ready') PwaShell.showUpdateNotice();
      });
      var hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener('controllerchange', function() {
        if (hadController) PwaShell.showUpdateNotice();
        hadController = true;
      });
      PwaBackgroundSync.register();
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

    showUpdateNotice: function() {
      if (document.getElementById('pwa-update-notice')) return;
      var notice = document.createElement('button');
      notice.id = 'pwa-update-notice';
      notice.className = 'pwa-update-notice';
      notice.textContent = '更新があります。入力を保存してからタップして再読込';
      notice.addEventListener('click', function() {
        if (typeof App !== 'undefined' && App.captureSnapshot) App.captureSnapshot();
        global.location.reload();
      });
      document.body.appendChild(notice);
    },

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
        PwaNetwork.invalidate();
        PwaShell.backgroundRefresh(true);
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
      if (!data || typeof data !== 'object') return false;
      if (typeof App !== 'undefined' && typeof App.applyData === 'function') {
        App.applyData(data, false);
        var saved = typeof App.writeSnapshot === 'function' ? App.writeSnapshot(data) : PwaStore.saveSnapshot(data);
        App.navigateTo(App.currentPage || 'breeding');
        if (saved && typeof OfflineSync !== 'undefined') OfflineSync.refreshCompleted();
        return saved;
      }
      Breeding.list = data.morningList || [];
      PostMating.list = data.postMatingList || [];
      Farrowing.list = data.farrowingList || [];
      Farrowing.accidentList = data.accidentList || [];
      SowLocation.list = data.locationList || [];
      ReheatCheck.list = data.reheatCheckList || [];
      PregCheck.list = data.pregnancyCheckList || [];
      PenTask.list = data.penTaskList || [];
      if (typeof App !== 'undefined') App.penList = data.penList || [];
      if (data.penTaskConfig) {
        PenTask.farrowingTaskTypes = data.penTaskConfig.farrowingTypes || [];
        PenTask.breedingTaskTypes = data.penTaskConfig.breedingTypes || [];
        PenTask.dueDays = data.penTaskConfig.days || {};
      }
      var stored = PwaStore.saveSnapshot(data);
      if (typeof App !== 'undefined') App.navigateTo(App.currentPage || 'breeding');
      if (stored && typeof OfflineSync !== 'undefined') OfflineSync.refreshCompleted();
      return stored;
    },

    backgroundRefresh: function(firstSetup) {
      if (PwaShell.refreshing) return Promise.resolve(false);
      if (typeof OfflineSync !== 'undefined' && OfflineSync.hasUnresolved()) return Promise.resolve(false);
      var mutationRevision = typeof OfflineSync !== 'undefined' && OfflineSync.mutationRevision ? OfflineSync.mutationRevision() : '';
      PwaShell.refreshing = true;
      if (!PwaStore.hasSnapshot()) PwaShell.showFirstUseGate(true);
      return PwaNetwork.check(false).then(function(network) {
        if (!network.authenticated || network.state !== 'online') {
          PwaShell.refreshing = false;
          if (!PwaStore.hasSnapshot()) PwaShell.showFirstUseGate(false);
          if (network.state === 'auth') PwaAuth.showLogin();
          return false;
        }
        return new Promise(function(resolve) {
          PwaJsonp.call('getInitialDataCached', [PwaAuth.loadToken()], function(data) {
            PwaShell.refreshing = false;
            // An input made during this request takes precedence over its reply.
            if (typeof OfflineSync !== 'undefined' && (OfflineSync.hasUnresolved() ||
                (OfflineSync.mutationRevision && mutationRevision !== OfflineSync.mutationRevision()))) {
              if (OfflineSync.schedule) OfflineSync.schedule(100);
              resolve(false); return;
            }
            var saved = PwaShell.applyData(data);
            if (!saved) {
              if (!PwaStore.hasSnapshot()) {
                PwaShell.showFirstUseGate(false);
                document.getElementById('pwa-gate-title').textContent = '端末保存に失敗しました';
                document.getElementById('pwa-gate-message').textContent = 'まだオフライン準備は完了していません。端末の空き容量を確認して再試行してください。';
              }
              if (typeof App !== 'undefined') App.toast('一覧を端末へ保存できませんでした。保存済みの記録は保持しています');
              resolve(false); return;
            }
            PwaShell.hideGate();
            if (firstSetup && typeof App !== 'undefined') App.toast('オフライン準備が完了しました');
            resolve(true);
          }, function() {
            PwaShell.refreshing = false;
            if (!PwaStore.hasSnapshot()) PwaShell.showFirstUseGate(false);
            resolve(false);
          });
        });
      });
    },

    onAuthenticated: function() {
      if (typeof OfflineSync !== 'undefined') OfflineSync.retryPendingNow(true);
      PwaShell.backgroundRefresh(!PwaStore.hasSnapshot());
    },

    init: function() {
      PwaShell.ensureGate();
      PwaAuth.init();
      PwaBackgroundSync.init();
      if (PwaStore.hasSnapshot()) {
        PwaShell.hideGate();
        PwaAuth.hideLogin();
        PwaShell.backgroundRefresh(false);
      } else {
        PwaShell.backgroundRefresh(true);
      }

      global.addEventListener('online', function() {
        PwaNetwork.invalidate();
        PwaShell.backgroundRefresh(!PwaStore.hasSnapshot());
      });
      global.addEventListener('offline', function() {
        if (!PwaStore.hasSnapshot()) PwaShell.showFirstUseGate(false);
        PwaAuth.hideLogin();
        PwaNetwork.invalidate();
      });
    }
  };

  global.PwaStore = PwaStore;
  global.PwaAuth = PwaAuth;
  global.PwaJsonp = PwaJsonp;
  global.PwaShell = PwaShell;
  global.PwaNetwork = PwaNetwork;
  global.PwaBackgroundSync = PwaBackgroundSync;
  global.google = global.google || {};
  global.google.script = global.google.script || {};
  global.google.script.run = createScriptRunner(null, null);
})(window);
