(function() {
  'use strict';

  // 未送信がなくても、圏外であることは左上へ明示する。
  var originalUpdateStatus = OfflineSync.updateStatus;
  OfflineSync.updateStatus = function() {
    originalUpdateStatus.apply(OfflineSync, arguments);
    if ((navigator.onLine !== false && PwaNetwork.result.state !== 'offline' && PwaNetwork.result.state !== 'server') || OfflineSync.pendingCount() || OfflineSync.failedCount() || OfflineSync.needsRefresh || !OfflineSync.storageAvailable) return;
    var status = document.getElementById('sync-status');
    if (!status) return;
    status.textContent = 'オフライン';
    status.className = 'sync-status sync-waiting';
    status.title = '保存済みデータを表示しています';
  };

  var originalShowStatus = OfflineSync.showStatus;
  OfflineSync.showStatus = function() {
    if ((navigator.onLine === false || PwaNetwork.result.state === 'offline' || PwaNetwork.result.state === 'server') && !OfflineSync.pendingCount() && !OfflineSync.failedCount() && !OfflineSync.needsRefresh && OfflineSync.storageAvailable) {
      App.toast('オフラインです。保存済みデータを表示中です');
      return;
    }
    originalShowStatus.apply(OfflineSync, arguments);
  };

  document.addEventListener('DOMContentLoaded', function() {
    PwaShell.init();
    OfflineSync.updateStatus();
  });
})();
