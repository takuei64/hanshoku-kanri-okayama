// 母豚現在地・個体カード

// === 画面2: 現在地一覧 ===
var SowLocation = {
  list: [],

  render: function() {
    SowLocation.filter();
  },

  moveSowNo: null,
  actionSowNo: null,

  filter: function() {
    var query = (document.getElementById('location-search').value || '').trim();
    var filtered = SowLocation.list;
    if (query) {
      filtered = SowLocation.list.filter(function(s) {
        return String(s.sowNo).indexOf(query) >= 0 || String(s.penNo).indexOf(query) >= 0;
      });
    }

    var container = document.getElementById('location-list');
    var countEl = document.getElementById('location-count');

    if (filtered.length === 0) {
      countEl.textContent = '';
      container.innerHTML = '<div class="empty-state"><div>該当する母豚がいません</div></div>';
      return;
    }

    countEl.textContent = 'アクティブ母豚 ' + filtered.length + '頭';

    // ペン番号昇順フラットリスト
    var html = '';
    for (var i = 0; i < filtered.length; i++) {
      var s = filtered[i];
      var statusBadge = '';
      if (s.status) {
        var cls = App.getStatusBadgeClass(s.status);
        statusBadge = '<span class="status-badge ' + cls + '" style="font-size:10px;padding:1px 4px;margin-left:6px">' + s.status + '</span>';
      }
      var areaLabel = s.area ? '<span style="font-size:10px;color:var(--text-sub);margin-left:4px">' + s.area + '</span>' : '';
      html += '<div class="list-item" onclick="SowLocation.openActionSheet(\'' + s.sowNo + '\')">';
      html += '<div style="flex:1"><strong>No.' + s.sowNo + '</strong>' + statusBadge;
      html += '<div style="font-size:11px;color:var(--text-sub)">' + s.info + '</div>';
      html += '</div>';
      if (s.penNo !== '未登録') {
        html += '<div class="pen-tap" onclick="event.stopPropagation();SowLocation.openMoveModal(\'' + s.sowNo + '\',\'' + s.penNo + '\')">Pen ' + s.penNo + areaLabel + '</div>';
      }
      html += '</div>';
    }
    container.innerHTML = html;
  },

  openActionSheet: function(sowNo) {
    SowLocation.actionSowNo = sowNo;
    document.getElementById('loc-action-sow-label').textContent = 'No.' + sowNo;
    App.showModal('loc-action-sheet');
  },

  actionCard: function() {
    App.hideModal('loc-action-sheet');
    App.navigateTo('sowcard', {sowNo: SowLocation.actionSowNo});
  },

  actionFarrowing: function() {
    App.hideModal('loc-action-sheet');
    Farrowing.openRecordModal(SowLocation.actionSowNo);
  },

  actionDeath: function() {
    App.hideModal('loc-action-sheet');
    SowLocation.openDeathModal(SowLocation.actionSowNo);
  },

  actionRetire: function() {
    App.hideModal('loc-action-sheet');
    var sowNo = SowLocation.actionSowNo;
    if (!confirm('No.' + sowNo + ' を廃用にしますか？')) return;
    SowLocation.removeSowLocal(sowNo);
    OfflineSync.enqueue('recordStatusChange', [sowNo, '廃用', App.today()]);
    App.toast('廃用を記録しました');
  },

  removeSowLocal: function(sowNo) {
    sowNo = String(sowNo);
    SowLocation.list = SowLocation.list.filter(function(s) { return String(s.sowNo) !== sowNo; });
    Breeding.list = Breeding.list.filter(function(s) { return String(s.sowNo) !== sowNo; });
    Farrowing.list = Farrowing.list.filter(function(s) { return String(s.sowNo) !== sowNo; });
    ReheatCheck.list = ReheatCheck.list.filter(function(s) { return String(s.sowNo) !== sowNo; });
    PostMating.list = PostMating.list.filter(function(s) { return String(s.sowNo) !== sowNo; });
    PregCheck.list = PregCheck.list.filter(function(s) { return String(s.sowNo) !== sowNo; });
    for (var i = 0; i < PenTask.list.length; i++) {
      PenTask.list[i].sows = PenTask.list[i].sows.filter(function(no) { return String(no) !== sowNo; });
    }
    PenTask.list = PenTask.list.filter(function(p) { return p.sows.length > 0; });
    if (App.currentPage === 'location') SowLocation.render();
    if (App.currentPage === 'breeding') Breeding.render();
    if (App.currentPage === 'farrowing') Farrowing.render();
    if (App.currentPage === 'pregcheck') PregCheck.render();
    if (App.currentPage === 'pentask') PenTask.render();
  },

  actionMating: function() {
    App.hideModal('loc-action-sheet');
    Mating.open(SowLocation.actionSowNo);
  },

  actionPenTask: function() {
    App.hideModal('loc-action-sheet');
    var sowNo = SowLocation.actionSowNo;
    // 現在地リストから対象母豚のペンを引く
    var penNo = null;
    var area = '';
    for (var i = 0; i < SowLocation.list.length; i++) {
      if (String(SowLocation.list[i].sowNo) === String(sowNo)) {
        penNo = SowLocation.list[i].penNo;
        area = SowLocation.list[i].area || '';
        break;
      }
    }
    if (!penNo || penNo === '未登録') { App.toast('ペンが未登録です'); return; }
    // PenTask.list に該当ペンが無ければ追加（分娩舎以外も記録可能にする）
    var found = false;
    for (var j = 0; j < PenTask.list.length; j++) {
      if (String(PenTask.list[j].penNo) === String(penNo)) { found = true; break; }
    }
    if (!found) {
      var penNum = parseInt(penNo, 10) || 0;
      var isBreeding = area === 'ストール' || area === '交配舎' || area === '種付舎' ||
        (!area && penNum >= 1 && penNum <= 200);
      var areaType = isBreeding ? 'breeding' : 'farrowing';
      var taskTypes = isBreeding ? PenTask.breedingTaskTypes : PenTask.farrowingTaskTypes;
      var tasks = {};
      for (var k = 0; k < taskTypes.length; k++) {
        tasks[taskTypes[k]] = { date: '', state: 'pending', dueDay: PenTask.dueDays[taskTypes[k]] || 21 };
      }
      PenTask.list.push({
        areaType: areaType,
        penNo: penNo,
        sows: [String(sowNo)],
        startDate: '',
        ageDays: 0,
        dayLabel: isBreeding ? '種付後' : '日齢',
        taskTypes: taskTypes.slice(),
        tasks: tasks
      });
    }
    PenTask.openModal(penNo);
  },

  openDeathModal: function(sowNo) {
    SowLocation.actionSowNo = sowNo;
    document.getElementById('death-sow-label').textContent = 'No.' + sowNo;
    document.getElementById('death-count').value = '';
    document.getElementById('death-submit').disabled = false;
    App.setDateDefault('death-date');
    App.showModal('death-modal');
  },

  submitDeath: function() {
    var sowNo = SowLocation.actionSowNo;
    var dateStr = document.getElementById('death-date').value;
    var count = parseInt(document.getElementById('death-count').value) || 0;

    if (count <= 0) { App.toast('頭数を入力してください'); return; }

    OfflineSync.enqueue('recordNursingAccident', [sowNo, dateStr, count]);
    App.hideModal('death-modal');
    Farrowing.accidentList.unshift({ sowNo: sowNo, date: dateStr, count: count });
    App.toast('子豚死亡を登録しました');
  },

  openMoveModal: function(sowNo, currentPen) {
    SowLocation.moveSowNo = sowNo;
    document.getElementById('loc-move-sow-label').textContent = 'No.' + sowNo + '（現在 Pen ' + currentPen + '）';
    document.getElementById('loc-move-pen').value = '';
    App.setDateDefault('loc-move-date');
    App.showModal('loc-move-modal');
  },

  submitMove: function() {
    var penNo = document.getElementById('loc-move-pen').value.trim();
    var dateStr = document.getElementById('loc-move-date').value;
    if (!penNo) { App.toast('ペンNoを入力してください'); return; }

    App.hideModal('loc-move-modal');
    var sowNo = SowLocation.moveSowNo;

    for (var i = 0; i < SowLocation.list.length; i++) {
      if (SowLocation.list[i].sowNo === sowNo) {
        SowLocation.list[i].penNo = penNo;
        break;
      }
    }
    SowLocation.render();
    OfflineSync.enqueue('recordMovement', [sowNo, penNo, dateStr]);
    App.toast('移動を記録しました');
  }
};

// === 画面3: 個体カード ===
var SowCard = {
  search: function(sowNo) {
    if (!sowNo) {
      sowNo = parseInt(document.getElementById('card-search-input').value);
    } else {
      document.getElementById('card-search-input').value = sowNo;
    }
    if (!sowNo) { App.toast('母豚番号を入力してください'); return; }

    App.showLoading();
    google.script.run
      .withSuccessHandler(function(data) {
        App.hideLoading();
        if (data.error) {
          App.toast(data.error);
          document.getElementById('card-result').innerHTML =
            '<div class="empty-state"><div>' + data.error + '</div></div>';
          return;
        }
        SowCard.render(data);
      })
      .withFailureHandler(function(e) {
        App.hideLoading();
        App.toast('エラー: ' + e.message);
      })
      .getSowCard(sowNo, App.authToken);
  },

  render: function(data) {
    var c = document.getElementById('card-result');
    var html = '';

    // 基本情報
    html += '<div class="card">';
    html += '<div class="card-header">';
    html += '<span class="sow-no">No.' + data.info.sowNo + '</span>';
    html += '<span class="pen-no">Pen ' + data.currentPen + '</span>';
    html += '</div>';
    if (data.info.earTag) html += '<div style="font-size:13px;color:var(--text-sub)">耳刻: ' + data.info.earTag + '</div>';
    if (data.info.birthDate) html += '<div style="font-size:13px;color:var(--text-sub)">生年月日: ' + data.info.birthDate + '</div>';
    html += '<div style="display:flex;gap:6px;margin-top:8px">';
    html += '<button class="btn-mate" onclick="Mating.open(\'' + data.info.sowNo + '\')">種付登録</button>';
    html += '</div>';
    html += '</div>';

    // タイムライン（全イベント日付昇順）
    var tl = data.timeline || [];
    if (tl.length === 0) {
      html += '<div class="history-item" style="color:var(--text-sub)">記録なし</div>';
    } else {
      var eventColors = { '種付': '#d93025', '分娩': '#1a73e8', '離乳': '#0d904f', '繁殖管理': '#5f6368' };
      for (var i = 0; i < tl.length; i++) {
        var t = tl[i];
        var color = eventColors[t.event] || '#5f6368';
        html += '<div class="tl-item">';
        html += '<div class="tl-date">' + (t.date || '') + '</div>';
        html += '<span class="tl-event" style="background:' + color + '">' + t.event + '</span>';
        if (t.detail) html += '<span class="tl-detail">' + t.detail + '</span>';
        if (t.event === '繁殖管理') {
          html += '<span class="tl-delete" onclick="SowCard.confirmDelete(\'' + data.info.sowNo + '\',\'' + (t.date || '') + '\',\'' + (t._penNo || '') + '\',\'' + (t._bt || '') + '\',\'' + (t._status || '') + '\')">&times;</span>';
        }
        if (t.event === '種付') {
          html += '<span class="tl-delete" onclick="SowCard.confirmDeleteMating(\'' + data.info.sowNo + '\',\'' + (t.date || '') + '\')">&times;</span>';
        }
        if (t.event === '分娩') {
          html += '<span class="tl-delete" onclick="SowCard.confirmDeleteFarrowing(\'' + data.info.sowNo + '\',\'' + (t.date || '') + '\',\'' + (t._total || '') + '\',\'' + (t._still || '') + '\')">&times;</span>';
        }
        if (t.event === '離乳') {
          html += '<span class="tl-delete" onclick="SowCard.confirmDeleteWeaning(\'' + data.info.sowNo + '\',\'' + (t.date || '') + '\',\'' + (t._weaned || '') + '\',\'' + (t._deaths || '') + '\')">&times;</span>';
        }
        html += '</div>';
      }
    }

    c.innerHTML = html;
  },

  refreshIfVisible: function(sowNo) {
    var cardPage = document.getElementById('page-sowcard');
    var input = document.getElementById('card-search-input');
    if (cardPage && cardPage.classList.contains('active') && input && String(input.value) === String(sowNo)) {
      SowCard.search(sowNo);
    }
  },

  confirmDelete: function(sowNo, dateStr, penNo, bt, status) {
    var desc = [];
    if (penNo) desc.push('Pen ' + penNo);
    if (bt) desc.push('BT ' + bt);
    if (status) desc.push(status);
    if (!confirm(dateStr + '「' + desc.join(' / ') + '」を削除しますか？')) return;

    OfflineSync.enqueue('deleteBreedingRecord', [sowNo, dateStr, penNo, bt || '', status], {
      onSuccess: function() { SowCard.refreshIfVisible(sowNo); }
    });
    App.toast('削除を記録しました');
  },

  confirmDeleteMating: function(sowNo, dateStr) {
    if (!confirm(dateStr + ' の種付記録を削除しますか？')) return;
    OfflineSync.enqueue('deleteMatingRecord', [sowNo, dateStr], {
      onSuccess: function() { SowCard.refreshIfVisible(sowNo); }
    });
    App.toast('種付記録の削除を受け付けました');
  },

  confirmDeleteFarrowing: function(sowNo, dateStr, total, still) {
    if (!confirm(dateStr + ' の分娩記録を削除しますか？')) return;
    OfflineSync.enqueue('deleteFarrowingRecord', [sowNo, dateStr, total, still], {
      onSuccess: function() { SowCard.refreshIfVisible(sowNo); }
    });
    App.toast('分娩記録の削除を受け付けました');
  },

  confirmDeleteWeaning: function(sowNo, dateStr, weaned, deaths) {
    if (!confirm(dateStr + ' の離乳記録を削除しますか？')) return;
    OfflineSync.enqueue('deleteWeaningRecord', [sowNo, dateStr, weaned, deaths], {
      onSuccess: function() { SowCard.refreshIfVisible(sowNo); }
    });
    App.toast('離乳記録の削除を受け付けました');
  }
};

// === 共通: 種付登録モーダル ===
var Mating = {
  sowNo: null,

  open: function(sowNo) {
    Mating.sowNo = sowNo;
    document.getElementById('mating-sow-label').textContent = 'No.' + sowNo;
    App.setDateDefault('mating-date');
    App.showModal('mating-modal');
  },

  submit: function() {
    var sowNo = Mating.sowNo;
    var dateStr = document.getElementById('mating-date').value;
    if (!sowNo) return;

    App.hideModal('mating-modal');
    App.toast('種付を記録しました');
    OfflineSync.enqueue('recordMating', [sowNo, dateStr], {
      onSuccess: function() { SowCard.refreshIfVisible(sowNo); }
    });
  }
};
