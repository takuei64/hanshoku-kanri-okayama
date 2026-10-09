// 母豚現在地・個体カード

// === 画面2: 現在地一覧 ===
var SowLocation = {
  list: [],

  render: function() {
    SowLocation.filter();
  },

  moveSowNo: null,
  actionSowNo: null,

  findSow: function(sowNo) {
    return SowLocation.list.find(function(s) { return String(s.sowNo) === String(sowNo); });
  },

  penArea: function(penNo, fallback) {
    var pen = String(penNo);
    var master = App.penList || [];
    for (var i = 0; i < master.length; i++) {
      if (String(master[i].penNo) === pen) return master[i].area || '';
    }
    var known = SowLocation.list.find(function(s) { return String(s.penNo) === pen && s.area; });
    if (known) return known.area;
    var task = PenTask.findPen(pen);
    return task ? (task.areaType === 'breeding' ? '繁殖舎' : '分娩舎') : (fallback || '');
  },

  /** 全移動経路で同じ現在地を使い、作業の対象も移動先へ合わせる。 */
  applyMovementLocal: function(sowNo, penNo, dateStr, areaHint) {
    var sn = String(sowNo);
    var pen = String(penNo);
    var area = SowLocation.penArea(pen, areaHint);
    var location = SowLocation.findSow(sn);
    // 過去日付の記録は残すが、より新しい現在地を巻き戻さない。
    if (location && location.latestMoveDate && dateStr < location.latestMoveDate) return;
    var lists = [SowLocation.list, Breeding.list, PostMating.list, ReheatCheck.list, Farrowing.list, PregCheck.list];
    lists.forEach(function(list) {
      list.forEach(function(s) {
        if (String(s.sowNo) !== sn) return;
        s.penNo = pen;
        s.area = area;
        s.latestMoveDate = dateStr;
      });
    });
    if (!location) {
      location = { sowNo: sn, penNo: pen, area: area, latestMoveDate: dateStr, status: '', info: '' };
      SowLocation.list.push(location);
    }
    var isBreeding = /^(ストール|交配舎|種付舎|繁殖舎)$/.test(area);
    if (area && !isBreeding) {
      Breeding.list = Breeding.list.filter(function(s) { return String(s.sowNo) !== sn; });
    } else if (isBreeding && !Breeding.list.some(function(s) { return String(s.sowNo) === sn; })) {
      var movedAfterFarrow = location.latestFarrowingDate && (!location.latestMatingDate || location.latestFarrowingDate >= location.latestMatingDate);
      if (movedAfterFarrow || !location.latestMatingDate) {
        var days = Math.max(0, Math.floor((Date.parse(App.today()) - Date.parse(dateStr)) / 86400000)) || 0;
        Breeding.list.push({ sowNo: sn, penNo: pen, area: area, latestMoveDate: dateStr,
          reason: (movedAfterFarrow ? '離乳移動 ' : '育成/移動 ') + days + '日目',
          group: movedAfterFarrow ? 1 : 2, days: days, status: location.status || '', btHistory: [] });
      }
    }
    SowLocation.list.sort(function(a, b) { return (parseInt(a.penNo, 10) || 99999) - (parseInt(b.penNo, 10) || 99999); });
    PenTask.moveSowLocal(sn, pen, area, dateStr, location);
    var card = SowCard.loadCached(sn);
    if (card) {
      var baseline = JSON.parse(JSON.stringify(card));
      card.currentPen = pen;
      card.latestMoveDate = dateStr;
      SowCard.saveCached(sn, card, baseline);
    }
    SowLocation.renderRelated();
  },

  renderRelated: function() {
    if (App.currentPage === 'location') SowLocation.render();
    if (App.currentPage === 'breeding') Breeding.render();
    if (App.currentPage === 'farrowing') Farrowing.render();
    if (App.currentPage === 'weaning') Weaning.render();
    if (App.currentPage === 'pregcheck') PregCheck.render();
    if (App.currentPage === 'pentask') PenTask.render();
  },

  filter: function() {
    var query = (document.getElementById('location-search').value || '').trim();
    var filtered = SowLocation.list;
    if (query) {
      filtered = SowLocation.list.filter(function(s) {
        return String(s.sowNo).trim() === query;
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
    var query = (document.getElementById('location-search').value || '').trim();
    if (query && String(sowNo).trim() !== query) {
      App.toast('検索した母豚Noと選択した母豚Noが一致しません');
      return;
    }
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
    if (!OfflineSync.enqueue('recordStatusChange', [sowNo, '廃用', App.today()], {
      applyLocal: function() { SowLocation.removeSowLocal(sowNo); }
    })) return;
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
      var isBreeding = area === 'ストール' || area === '交配舎' || area === '種付舎' || area === '繁殖舎';
      var areaType = isBreeding ? 'breeding' : 'farrowing';
      var taskTypes = PenTask.getTaskTypes({ areaType: areaType });
      if (!taskTypes.length) { App.toast('作業マスタが未設定です'); return; }
      var tasks = {};
      for (var k = 0; k < taskTypes.length; k++) {
        tasks[taskTypes[k]] = { date: '', state: 'pending', dueDay: PenTask.dueDays[taskTypes[k]] || 0 };
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

    if (!OfflineSync.enqueue('recordNursingAccident', [sowNo, dateStr, count], {
      applyLocal: function() { Farrowing.accidentList.unshift({ sowNo: sowNo, date: dateStr, count: count }); }
    })) return;
    App.hideModal('death-modal');
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
    if (!dateStr) { App.toast('移動日を入力してください'); return; }

    var sowNo = SowLocation.moveSowNo;
    if (!OfflineSync.enqueue('recordMovement', [sowNo, penNo, dateStr], {
      applyLocal: function() { SowLocation.applyMovementLocal(sowNo, penNo, dateStr); }
    })) return;
    App.hideModal('loc-move-modal');
    App.toast('移動を記録しました');
  }
};

// === 画面3: 個体カード ===
var SowCard = {
  currentData: null,
  editIndex: -1,
  editOriginal: null,
  editBaseline: null,

  saveCached: function(sowNo, data, baseline) {
    try {
      var key = 'hanshoku-kanri-okayama-v1:sow-card:' + String(sowNo);
      // Local edits merge only their own changes into the latest card. Server
      // refreshes omit baseline and replace the card after the revision check.
      if (baseline && typeof SnapshotPatch !== 'undefined') {
        var latest = JSON.parse(localStorage.getItem(key) || 'null') || baseline;
        data = SnapshotPatch.apply(latest, SnapshotPatch.diff(baseline, data));
        if (data.timeline) data.timeline.sort(function(a, b) { return (a.date || '').localeCompare(b.date || ''); });
      }
      localStorage.setItem(key, JSON.stringify(data));
      if (SowCard.currentData && String(SowCard.currentData.info.sowNo) === String(sowNo)) SowCard.currentData = data;
      return true;
    } catch (e) { return false; }
  },

  loadCached: function(sowNo) {
    try {
      var saved = JSON.parse(localStorage.getItem('hanshoku-kanri-okayama-v1:sow-card:' + String(sowNo)) || 'null');
      if (saved) return saved;
    } catch (e) {}
    if (SowCard.currentData && String(SowCard.currentData.info.sowNo) === String(sowNo)) return SowCard.currentData;
    return null;
  },

  search: function(sowNo, refresh) {
    if (!sowNo) {
      sowNo = parseInt(document.getElementById('card-search-input').value);
    } else {
      document.getElementById('card-search-input').value = sowNo;
    }
    if (!sowNo) { App.toast('母豚番号を入力してください'); return; }

    var cached = SowCard.loadCached(sowNo);
    if (cached) {
      SowCard.render(cached);
      if (OfflineSync.queue.length || navigator.onLine === false) return;
    }

    var revision = OfflineSync.mutationRevision ? OfflineSync.mutationRevision() : '';
    if (!cached) App.showLoading();
    google.script.run
      .withSuccessHandler(function(data) {
        App.hideLoading();
        if (data.error) {
          App.toast(data.error);
          document.getElementById('card-result').innerHTML =
            '<div class="empty-state"><div>' + data.error + '</div></div>';
          return;
        }
        // 検索の通信中に入力された変更も、古い応答で上書きしない。
        if ((OfflineSync.mutationRevision && OfflineSync.mutationRevision() !== revision) ||
            (OfflineSync.queue.length && SowCard.loadCached(sowNo))) return;
        SowCard.saveCached(sowNo, data);
        SowCard.render(data);
      })
      .withFailureHandler(function(e) {
        App.hideLoading();
        App.toast('エラー: ' + e.message);
      })
      .getSowCard(sowNo, App.authToken);
  },

  render: function(data) {
    SowCard.currentData = data;
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
        var editable = SowCard.isEditable(t);
        html += '<div class="tl-item' + (editable ? ' tl-editable' : '') + '"' +
          (editable ? ' onclick="SowCard.openEdit(' + i + ')"' : '') + '>';
        html += '<div class="tl-date">' + (t.date || '') + '</div>';
        html += '<span class="tl-event" style="background:' + color + '">' + t.event + '</span>';
        if (t.detail) html += '<span class="tl-detail">' + t.detail + '</span>';
        if (editable) html += '<span class="tl-edit-hint">修正</span>';
        if (t.event === '繁殖管理') {
          html += '<span class="tl-delete" onclick="event.stopPropagation();SowCard.confirmDelete(\'' + data.info.sowNo + '\',\'' + (t.date || '') + '\',\'' + (t._penNo || '') + '\',\'' + (t._bt || '') + '\',\'' + (t._status || '') + '\')">&times;</span>';
        }
        if (t.event === '種付') {
          html += '<span class="tl-delete" onclick="event.stopPropagation();SowCard.confirmDeleteMating(\'' + data.info.sowNo + '\',\'' + (t.date || '') + '\')">&times;</span>';
        }
        if (t.event === '分娩') {
          html += '<span class="tl-delete" onclick="event.stopPropagation();SowCard.confirmDeleteFarrowing(\'' + data.info.sowNo + '\',\'' + (t.date || '') + '\',\'' + (t._total || '') + '\',\'' + (t._still || '') + '\')">&times;</span>';
        }
        if (t.event === '離乳') {
          html += '<span class="tl-delete" onclick="event.stopPropagation();SowCard.confirmDeleteWeaning(\'' + data.info.sowNo + '\',\'' + (t.date || '') + '\',\'' + (t._weaned || '') + '\',\'' + (t._deaths || '') + '\')">&times;</span>';
        }
        html += '</div>';
      }
    }

    c.innerHTML = html;
  },

  isEditable: function(record) {
    if (!record) return false;
    if (record.event === '種付' || record.event === '分娩' || record.event === '離乳') return true;
    return record.event === '繁殖管理' &&
      record._bt !== '' && record._bt !== null && record._bt !== undefined;
  },

  openEdit: function(index) {
    var data = SowCard.currentData;
    var record = data && data.timeline ? data.timeline[index] : null;
    if (!SowCard.isEditable(record)) return;

    SowCard.editIndex = index;
    SowCard.editOriginal = JSON.parse(JSON.stringify(record));
    SowCard.editBaseline = JSON.parse(JSON.stringify(data));
    var label = record.event === '繁殖管理' ? 'BT値' : record.event;
    document.getElementById('history-edit-title').textContent = label + 'を修正';
    document.getElementById('history-edit-sow').textContent = '母豚No.' + data.info.sowNo;

    var html = '<div class="form-group"><label>日付</label>' +
      '<input type="date" id="history-edit-date" value="' + (record.date || '') + '"></div>';
    if (record.event === '分娩') {
      html += '<div class="form-row">' +
        '<div class="form-group" style="flex:1"><label>総産子数</label><input type="number" id="history-edit-total" inputmode="numeric" min="1" step="1" value="' + record._total + '"></div>' +
        '<div class="form-group" style="flex:1"><label>死産数</label><input type="number" id="history-edit-still" inputmode="numeric" min="0" step="1" value="' + record._still + '"></div>' +
        '</div>';
    } else if (record.event === '離乳') {
      html += '<div class="form-row">' +
        '<div class="form-group" style="flex:1"><label>離乳頭数</label><input type="number" id="history-edit-weaned" inputmode="numeric" min="0" step="1" value="' + record._weaned + '"></div>' +
        '<div class="form-group" style="flex:1"><label>死亡数</label><input type="number" id="history-edit-deaths" inputmode="numeric" min="0" step="1" value="' + record._deaths + '"></div>' +
        '</div>';
    } else if (record.event === '繁殖管理') {
      html += '<div class="form-group"><label>BT値</label>' +
        '<input type="number" id="history-edit-bt" inputmode="decimal" step="0.1" value="' + record._bt + '"></div>';
    }
    document.getElementById('history-edit-fields').innerHTML = html;
    App.showModal('history-edit-modal');
  },

  readInteger: function(id, label, minimum) {
    var value = (document.getElementById(id).value || '').trim();
    var number = Number(value);
    if (value === '' || !isFinite(number) || Math.floor(number) !== number || number < minimum) {
      App.toast(label + 'を確認してください');
      return null;
    }
    return number;
  },

  editSummary: function(record) {
    if (record.event === '分娩') {
      return record.date + '／総産子 ' + record._total + '／死産 ' + record._still;
    }
    if (record.event === '離乳') {
      return record.date + '／離乳 ' + record._weaned + '／死亡 ' + record._deaths;
    }
    if (record.event === '繁殖管理') return record.date + '／BT ' + record._bt;
    return record.date;
  },

  submitEdit: function() {
    var data = SowCard.currentData;
    var original = SowCard.editOriginal;
    if (!data || !original || SowCard.editIndex < 0) return;
    var baseline = SowCard.editBaseline || JSON.parse(JSON.stringify(data));
    data = JSON.parse(JSON.stringify(baseline));

    var sowNo = String(data.info.sowNo);
    var newDate = document.getElementById('history-edit-date').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) { App.toast('日付を確認してください'); return; }

    var updated = JSON.parse(JSON.stringify(original));
    updated.date = newDate;
    var operationType = '';
    var operationArgs = [];
    var label = original.event === '繁殖管理' ? 'BT値' : original.event;

    if (original.event === '種付') {
      operationType = 'updateMatingRecord';
      operationArgs = [sowNo, original.date, newDate];
    } else if (original.event === '分娩') {
      var total = SowCard.readInteger('history-edit-total', '総産子数', 1);
      if (total === null) return;
      var still = SowCard.readInteger('history-edit-still', '死産数', 0);
      if (still === null) return;
      if (still > total) { App.toast('死産数は総産子数以下で入力してください'); return; }
      updated._total = total;
      updated._still = still;
      updated.detail = '総産子:' + total + ' 死産:' + still;
      operationType = 'updateFarrowingRecord';
      operationArgs = [sowNo, original.date, original._total, original._still, newDate, total, still];
    } else if (original.event === '離乳') {
      var weaned = SowCard.readInteger('history-edit-weaned', '離乳頭数', 0);
      if (weaned === null) return;
      var deaths = SowCard.readInteger('history-edit-deaths', '死亡数', 0);
      if (deaths === null) return;
      updated._weaned = weaned;
      updated._deaths = deaths;
      updated.detail = '離乳頭数:' + weaned + ' 死亡:' + deaths;
      operationType = 'updateWeaningRecord';
      operationArgs = [sowNo, original.date, original._weaned, original._deaths, newDate, weaned, deaths];
    } else if (original.event === '繁殖管理') {
      var btText = (document.getElementById('history-edit-bt').value || '').trim();
      var bt = Number(btText);
      if (btText === '' || !isFinite(bt) || bt <= 0) { App.toast('BT値を確認してください'); return; }
      updated._bt = bt;
      var details = [];
      if (updated._penNo) details.push('Pen ' + updated._penNo);
      details.push('BT ' + bt);
      if (updated._status) details.push(updated._status);
      updated.detail = details.join(' / ');
      operationType = 'updateBTRecord';
      operationArgs = [sowNo, original.date, original._bt, newDate, bt];
    } else {
      return;
    }

    if (!confirm(
      'No.' + sowNo + ' の' + label + 'を修正しますか？\n' +
      '変更前: ' + SowCard.editSummary(original) + '\n' +
      '変更後: ' + SowCard.editSummary(updated)
    )) return;

    if (!OfflineSync.enqueue(operationType, operationArgs, {
      applyLocal: function() {
        data.timeline[SowCard.editIndex] = updated;
        data.timeline.sort(function(a, b) { return (a.date || '').localeCompare(b.date || ''); });
        var saved = SowCard.saveCached(sowNo, data, baseline);
        SowCard.render(saved ? SowCard.loadCached(sowNo) : data);
        if (original.event === '繁殖管理') {
          Breeding.removeBTLocal(sowNo, original.date, original._bt);
          Breeding.addBTLocal(sowNo, updated._bt, newDate);
          PostMating.addBTLocal(sowNo, updated._bt, newDate);
          ReheatCheck.addBTLocal(sowNo, updated._bt, newDate);
        }
      },
      onSuccess: function() { SowCard.refreshIfVisible(sowNo); }
    })) return;
    App.hideModal('history-edit-modal');
    SowCard.editIndex = -1;
    SowCard.editOriginal = null;
    SowCard.editBaseline = null;
    App.toast(label + 'を修正しました');
  },

  refreshIfVisible: function(sowNo) {
    if (OfflineSync.queue.length) return;
    var cardPage = document.getElementById('page-sowcard');
    var input = document.getElementById('card-search-input');
    if (cardPage && cardPage.classList.contains('active') && input && String(input.value) === String(sowNo)) {
      SowCard.search(sowNo, true);
    }
  },

  removeRecordLocal: function(sowNo, event, dateStr, fields) {
    var data = SowCard.loadCached(sowNo);
    if (!data) return;
    var baseline = JSON.parse(JSON.stringify(data));
    var timeline = data.timeline || [];
    for (var i = timeline.length - 1; i >= 0; i--) {
      var record = timeline[i];
      if (record.event !== event || String(record.date) !== String(dateStr)) continue;
      var matches = Object.keys(fields || {}).every(function(key) {
        var expected = fields[key];
        return expected === '' || expected === null || expected === undefined || String(record[key]) === String(expected);
      });
      if (!matches) continue;
      timeline.splice(i, 1);
      break;
    }
    var saved = SowCard.saveCached(sowNo, data, baseline);
    if (App.currentPage === 'sowcard') SowCard.render(saved ? SowCard.loadCached(sowNo) : data);
  },

  confirmDelete: function(sowNo, dateStr, penNo, bt, status) {
    var desc = [];
    if (penNo) desc.push('Pen ' + penNo);
    if (bt) desc.push('BT ' + bt);
    if (status) desc.push(status);
    if (!confirm(dateStr + '「' + desc.join(' / ') + '」を削除しますか？')) return;

    if (!OfflineSync.enqueue('deleteBreedingRecord', [sowNo, dateStr, penNo, bt || '', status], {
      applyLocal: function() {
        SowCard.removeRecordLocal(sowNo, '繁殖管理', dateStr, { _penNo: penNo, _bt: bt, _status: status });
        if (bt !== '' && bt !== null && bt !== undefined) Breeding.removeBTLocal(sowNo, dateStr, bt);
      },
      onSuccess: function() { SowCard.refreshIfVisible(sowNo); }
    })) return;
    App.toast('削除を記録しました');
  },

  confirmDeleteMating: function(sowNo, dateStr) {
    if (!confirm(dateStr + ' の種付記録を削除しますか？')) return;
    if (!OfflineSync.enqueue('deleteMatingRecord', [sowNo, dateStr], {
      applyLocal: function() { SowCard.removeRecordLocal(sowNo, '種付', dateStr, {}); },
      onSuccess: function() { SowCard.refreshIfVisible(sowNo); }
    })) return;
    App.toast('種付記録の削除を受け付けました');
  },

  confirmDeleteFarrowing: function(sowNo, dateStr, total, still) {
    if (!confirm(dateStr + ' の分娩記録を削除しますか？')) return;
    if (!OfflineSync.enqueue('deleteFarrowingRecord', [sowNo, dateStr, total, still], {
      applyLocal: function() { SowCard.removeRecordLocal(sowNo, '分娩', dateStr, { _total: total, _still: still }); },
      onSuccess: function() { SowCard.refreshIfVisible(sowNo); }
    })) return;
    App.toast('分娩記録の削除を受け付けました');
  },

  confirmDeleteWeaning: function(sowNo, dateStr, weaned, deaths) {
    if (!confirm(dateStr + ' の離乳記録を削除しますか？')) return;
    if (!OfflineSync.enqueue('deleteWeaningRecord', [sowNo, dateStr, weaned, deaths], {
      applyLocal: function() { SowCard.removeRecordLocal(sowNo, '離乳', dateStr, { _weaned: weaned, _deaths: deaths }); },
      onSuccess: function() { SowCard.refreshIfVisible(sowNo); }
    })) return;
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

    if (!OfflineSync.enqueue('recordMating', [sowNo, dateStr], {
      onSuccess: function() { SowCard.refreshIfVisible(sowNo); }
    })) return;
    App.hideModal('mating-modal');
    App.toast('種付を記録しました');
  }
};
