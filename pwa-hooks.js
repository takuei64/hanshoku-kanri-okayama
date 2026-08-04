(function() {
  'use strict';

  // 各画面の楽観的更新が終わった直後に、現在の一覧も端末へ保存する。
  var originalEnqueue = OfflineSync.enqueue;
  OfflineSync.enqueue = function() {
    var operationId = originalEnqueue.apply(OfflineSync, arguments);
    setTimeout(function() { PwaStore.captureCurrentData(); }, 0);
    return operationId;
  };

  // 未送信がなくても、圏外であることは左上へ明示する。
  var originalUpdateStatus = OfflineSync.updateStatus;
  OfflineSync.updateStatus = function() {
    originalUpdateStatus.apply(OfflineSync, arguments);
    if (navigator.onLine !== false || OfflineSync.pendingCount() || OfflineSync.failedCount()) return;
    var status = document.getElementById('sync-status');
    if (!status) return;
    status.textContent = 'オフライン';
    status.className = 'sync-status sync-waiting';
    status.title = '保存済みデータを表示しています';
  };

  var originalShowStatus = OfflineSync.showStatus;
  OfflineSync.showStatus = function() {
    if (navigator.onLine === false && !OfflineSync.pendingCount() && !OfflineSync.failedCount()) {
      App.toast('オフラインです。保存済みデータを表示中です');
      return;
    }
    originalShowStatus.apply(OfflineSync, arguments);
  };

  // 最後の未送信操作が届いたら、サーバー計算後の一覧へ静かに合わせる。
  var originalCompleteOperation = OfflineSync.completeOperation;
  OfflineSync.completeOperation = function() {
    originalCompleteOperation.apply(OfflineSync, arguments);
    PwaStore.captureCurrentData();
    if (!OfflineSync.hasPending() && navigator.onLine !== false) {
      setTimeout(function() { PwaShell.backgroundRefresh(false); }, 500);
    }
  };

  document.addEventListener('DOMContentLoaded', function() {
    PwaShell.init();
    OfflineSync.updateStatus();
  });
})();
