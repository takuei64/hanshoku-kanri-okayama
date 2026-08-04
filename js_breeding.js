// 繁殖管理画面（移動記録統合）

var Breeding = {
  list: [],
  selectedSow: null,
  pendingAction: null,
  moveFormOpen: false,

  /** 繁殖・種後・再発の3リストをペン番号昇順の1本に統合する
      （ブリードテスタ計測をストール順に一筆書きで回れるようにするため） */
  buildMergedList: function() {
    var merged = [];
    var i;
    for (i = 0; i < Breeding.list.length; i++) merged.push({ kind: 'breeding', s: Breeding.list[i] });
    for (i = 0; i < PostMating.list.length; i++) merged.push({ kind: 'postmating', s: PostMating.list[i] });
    for (i = 0; i < ReheatCheck.list.length; i++) merged.push({ kind: 'reheat', s: ReheatCheck.list[i] });
    merged.sort(function(a, b) {
      var penA = parseInt(a.s.penNo, 10) || 99999;
      var penB = parseInt(b.s.penNo, 10) || 99999;
      if (penA !== penB) return penA - penB;
      return (parseInt(a.s.sowNo, 10) || 0) - (parseInt(b.s.sowNo, 10) || 0);
    });
    return merged;
  },

  /** カードの種別（色分けクラスとラベル）。ステータス判定ロジック自体は従来のまま */
  typeInfo: function(item) {
    if (item.kind === 'postmating') return { cls: 'type-postmating', label: '種後' };
    if (item.kind === 'reheat') return { cls: 'type-reheat', label: '再発' };
    var reason = String(item.s.reason || '');
    if (reason.indexOf('空胎') >= 0) return { cls: 'type-empty', label: '空胎' };
    if (reason.indexOf('離乳') >= 0) return { cls: 'type-weaned', label: '離乳' };
    return { cls: 'type-rearing', label: '育成' };
  },

  /** キャッシュ済みデータで描画（サーバー呼出し不要） */
  render: function() {
    App.setDateDefault('move-date');

    var container = document.getElementById('breeding-list');
    var merged = Breeding.buildMergedList();
    if (merged.length === 0) {
      container.innerHTML =
        '<div class="empty-state">' +
          '<div class="icon">&#10003;</div>' +
          '<div>チェック対象はありません</div>' +
        '</div>';
      return;
    }

    // 種別サマリー（凡例を兼ねる）
    var counts = {};
    var order = ['離乳', '育成', '空胎', '種後', '再発'];
    var clsMap = { '離乳': 'type-weaned', '育成': 'type-rearing', '空胎': 'type-empty', '種後': 'type-postmating', '再発': 'type-reheat' };
    for (var m = 0; m < merged.length; m++) {
      var label = Breeding.typeInfo(merged[m]).label;
      counts[label] = (counts[label] || 0) + 1;
    }
    var html = '<div class="type-summary">';
    for (var o = 0; o < order.length; o++) {
      if (counts[order[o]]) {
        html += '<span class="type-chip ' + clsMap[order[o]] + '">' + order[o] + ' ' + counts[order[o]] + '</span>';
      }
    }
    html += '</div>';

    for (var i = 0; i < merged.length; i++) {
      var item = merged[i];
      var s = item.s;
      var t = Breeding.typeInfo(item);
      var cardId = item.kind === 'postmating' ? 'postmating-' + s.sowNo
                 : item.kind === 'reheat' ? 'reheat-' + s.sowNo
                 : 'card-' + s.sowNo;

      html += '<div class="card ' + t.cls + '" id="' + cardId + '">';
      html += '<div class="card-header">';
      html += '<span class="sow-no">No.' + s.sowNo + ' <span class="type-chip ' + t.cls + '">' + t.label + '</span></span>';
      html += '<span class="pen-no">Pen ' + s.penNo + '</span>';
      html += '</div>';

      if (item.kind === 'postmating') {
        html += '<div class="reason-label">種付' + s.days + '日目（' + s.mateDate + '）</div>';
      } else if (item.kind === 'reheat') {
        html += '<div class="reason-label">' + (s.detailPrefix || '種付後') + s.days + '日目（' + (s.eventDate || s.mateDate) + '）</div>';
      } else {
        html += '<div class="reason-label">' + s.reason + '</div>';
      }

      if (s.status) {
        html += '<span class="status-badge ' + App.getStatusBadgeClass(s.status) + '">' + s.status + '</span>';
      }

      if (s.btHistory && s.btHistory.length > 0) {
        html += '<div class="bt-history">';
        for (var j = 0; j < s.btHistory.length; j++) {
          var b = s.btHistory[j];
          html += '<span class="bt-chip bt-deletable" onclick="event.stopPropagation();Breeding.confirmDeleteBT(\'' + s.sowNo + '\',\'' + b.date + '\',' + b.bt + ')">' + (b.date || '').slice(5) + ' ' + b.bt + '</span>';
        }
        html += '</div>';
      }

      html += '<div class="action-buttons">';
      html += '<button class="btn-bt" onclick="Breeding.openBTModal(\'' + s.sowNo + '\')">BT値</button>';
      if (item.kind === 'postmating') {
        html += '<button class="btn-mate" onclick="Breeding.openMatingModal(\'' + s.sowNo + '\')">追い種付</button>';
        html += '<button class="btn-done" onclick="PostMating.confirmDone(\'' + s.sowNo + '\')">測定終了</button>';
      } else if (item.kind === 'reheat') {
        html += '<button class="btn-mate" onclick="Breeding.openMatingModal(\'' + s.sowNo + '\')">再種付</button>';
        html += '<button class="btn-pregnant" onclick="Breeding.openStatusModal(\'' + s.sowNo + '\', \'妊娠鑑定済\')">妊娠鑑定</button>';
        html += '<button class="btn-done" onclick="ReheatCheck.confirmDone(\'' + s.sowNo + '\')">再発情確認終了</button>';
      } else {
        html += '<button class="btn-mate" onclick="Breeding.openMatingModal(\'' + s.sowNo + '\')">種付</button>';
        html += '<button class="btn-done" onclick="Breeding.openStatusModal(\'' + s.sowNo + '\', \'測定終了\')">測定終了</button>';
      }
      html += '</div>';
      html += '</div>';
    }
    container.innerHTML = html;
  },

  getBadgeClass: function(status) {
    return App.getStatusBadgeClass(status);
  },

  /** カードをローカルで除去（サーバー再取得不要）
      統合リストでは再発・種後のリストにも同じ豚がいる可能性があるため全部から外す */
  removeCard: function(sowNo) {
    sowNo = String(sowNo);
    Breeding.list = Breeding.list.filter(function(s) { return String(s.sowNo) !== sowNo; });
    ReheatCheck.list = ReheatCheck.list.filter(function(s) { return String(s.sowNo) !== sowNo; });
    PostMating.list = PostMating.list.filter(function(s) { return String(s.sowNo) !== sowNo; });
    Breeding.render();
  },

  /** BT値をローカルのカードに追加表示 */
  addBTLocal: function(sowNo, bt, dateStr) {
    sowNo = String(sowNo);
    for (var i = 0; i < Breeding.list.length; i++) {
      if (String(Breeding.list[i].sowNo) === sowNo) {
        Breeding.list[i].btHistory.unshift({ date: dateStr, bt: bt });
        if (Breeding.list[i].btHistory.length > 7) Breeding.list[i].btHistory.pop();
        break;
      }
    }
    Breeding.render();
  },

  // --- 移動記録フォーム ---
  toggleMoveForm: function() {
    Breeding.moveFormOpen = !Breeding.moveFormOpen;
    document.getElementById('move-form').style.display = Breeding.moveFormOpen ? 'block' : 'none';
    document.getElementById('move-toggle-label').textContent =
      Breeding.moveFormOpen ? '－ 閉じる' : '＋ 移動記録を追加';
    if (Breeding.moveFormOpen) App.setDateDefault('move-date');
  },

  submitMove: function() {
    var sowNo = document.getElementById('move-sow').value.trim();
    var penNo = document.getElementById('move-pen').value.trim();
    var dateStr = document.getElementById('move-date').value;

    if (!sowNo) { App.toast('母豚番号を入力してください'); return; }
    if (!penNo) { App.toast('ペンNoを入力してください'); return; }

    OfflineSync.enqueue('recordMovement', [sowNo, penNo, dateStr]);
    document.getElementById('move-sow').value = '';
    document.getElementById('move-pen').value = '';
    App.toast('移動を記録しました');
  },

  // --- BT値入力 ---
  openBTModal: function(sowNo) {
    Breeding.selectedSow = sowNo;
    document.getElementById('bt-sow-label').textContent = 'No.' + sowNo;
    document.getElementById('bt-value').value = '';
    App.setDateDefault('bt-date');
    App.showModal('bt-modal');
  },

  submitBT: function() {
    var bt = parseFloat(document.getElementById('bt-value').value);
    var dateStr = document.getElementById('bt-date').value;
    if (isNaN(bt)) { App.toast('BT値を入力してください'); return; }

    var sowNo = Breeding.selectedSow;
    App.hideModal('bt-modal');

    // ローカル更新（即座に反映）
    Breeding.addBTLocal(sowNo, bt, dateStr);
    if (typeof ReheatCheck !== 'undefined' && ReheatCheck.addBTLocal) {
      ReheatCheck.addBTLocal(sowNo, bt, dateStr);
    }
    if (typeof PostMating !== 'undefined' && PostMating.addBTLocal) {
      PostMating.addBTLocal(sowNo, bt, dateStr);
    }
    App.toast('BT値を記録しました');

    OfflineSync.enqueue('recordBTValue', [sowNo, bt, dateStr]);
  },

  // --- 種付実施（モーダル） ---
  openMatingModal: function(sowNo) {
    Breeding.pendingAction = { type: 'mating', sowNo: sowNo };
    document.getElementById('status-modal-title').textContent = '種付実施 No.' + sowNo;
    document.getElementById('status-modal-desc').textContent = '種付シートにも追加されます';
    App.setDateDefault('status-date');
    App.showModal('status-modal');
  },

  // --- ステータス変更（モーダル） ---
  openStatusModal: function(sowNo, status) {
    Breeding.pendingAction = { type: 'status', sowNo: sowNo, status: status };
    document.getElementById('status-modal-title').textContent = status + ' No.' + sowNo;
    document.getElementById('status-modal-desc').textContent = 'チェック対象から外れます';
    App.setDateDefault('status-date');
    App.showModal('status-modal');
  },

  /** ステータス/種付モーダルの確定ボタン */
  confirmStatus: function() {
    var action = Breeding.pendingAction;
    if (!action) return;
    var dateStr = document.getElementById('status-date').value;
    App.hideModal('status-modal');

    if (action.type === 'mating') {
      App.toast('種付実施を記録しました');
      OfflineSync.enqueue('recordMating', [action.sowNo, dateStr]);
    } else {
      // ステータス変更のみチェック対象から外す。種付はリストに残す。
      if (action.status === '廃用' && typeof SowLocation !== 'undefined' && SowLocation.removeSowLocal) {
        SowLocation.removeSowLocal(action.sowNo);
      } else {
        Breeding.removeCard(action.sowNo);
      }
      App.toast(action.status + ' を記録しました');
      OfflineSync.enqueue('recordStatusChange', [action.sowNo, action.status, dateStr]);
    }
    Breeding.pendingAction = null;
  },

  /** 同じ母豚が複数区分に表示されていても、削除したBT値を全カードから消す */
  removeBTLocal: function(sowNo, dateStr, bt) {
    sowNo = String(sowNo);
    var lists = [Breeding.list];
    if (typeof PostMating !== 'undefined') lists.push(PostMating.list);
    if (typeof ReheatCheck !== 'undefined') lists.push(ReheatCheck.list);

    for (var l = 0; l < lists.length; l++) {
      for (var i = 0; i < lists[l].length; i++) {
        var sow = lists[l][i];
        if (String(sow.sowNo) !== sowNo || !sow.btHistory) continue;
        for (var j = 0; j < sow.btHistory.length; j++) {
          var item = sow.btHistory[j];
          var sameValue = Math.abs(Number(item.bt) - Number(bt)) <= 0.001;
          if (String(item.date) === String(dateStr) && sameValue) {
            sow.btHistory.splice(j, 1);
            break;
          }
        }
      }
    }
  },

  // --- タップ削除 ---
  confirmDeleteBT: function(sowNo, dateStr, bt) {
    if (!confirm('BT値 ' + bt + '（' + dateStr + '）を削除しますか？')) return;
    sowNo = String(sowNo);
    Breeding.removeBTLocal(sowNo, dateStr, bt);
    Breeding.render();
    App.toast('削除しました');
    OfflineSync.enqueue('deleteBreedingRecord', [sowNo, dateStr, '', bt, '']);
  }
};
