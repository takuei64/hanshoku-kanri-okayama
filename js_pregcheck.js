// 妊娠鑑定画面

var PregCheck = {
  list: [],
  selectedSow: null,

  render: function() {
    var container = document.getElementById('pregcheck-list');
    if (PregCheck.list.length === 0) {
      container.innerHTML =
        '<div class="empty-state">' +
          '<div class="icon">&#10003;</div>' +
          '<div>鑑定対象はありません</div>' +
        '</div>';
      return;
    }

    var html = '<div class="loc-group-header">鑑定対象 ' + PregCheck.list.length + '頭（種付25日以上）</div>';
    for (var i = 0; i < PregCheck.list.length; i++) {
      var s = PregCheck.list[i];
      html += '<div class="list-item" id="preg-' + s.sowNo + '" style="flex-wrap:wrap;gap:6px">';
      html += '<div style="flex:1">';
      html += '<strong style="color:var(--primary)">No.' + s.sowNo + '</strong>';
      html += '<span style="font-size:12px;color:var(--text-sub);margin-left:8px">Pen ' + s.penNo + '</span>';
      html += '<div style="font-size:12px;color:var(--text-sub);margin-top:2px">種付' + s.days + '日目（' + s.mateDate + '）</div>';
      html += '</div>';
      html += '<div style="display:flex;gap:4px">';
      html += '<button class="btn-move-sm" style="background:var(--success)" onclick="PregCheck.confirm(\'' + s.sowNo + '\',\'妊娠鑑定済\')">合格</button>';
      html += '<button class="btn-move-sm" style="background:var(--danger)" onclick="PregCheck.confirm(\'' + s.sowNo + '\',\'空胎\')">空胎</button>';
      html += '</div>';
      html += '</div>';
    }
    container.innerHTML = html;
  },

  confirm: function(sowNo, status) {
    var el = document.getElementById('preg-' + sowNo);
    if (el) el.style.opacity = '0.4';
    var pregRow = null;
    for (var i = 0; i < PregCheck.list.length; i++) {
      if (String(PregCheck.list[i].sowNo) === String(sowNo)) {
        pregRow = PregCheck.list[i];
        break;
      }
    }

    var dateStr = App.today();
    App.toast(status + ' No.' + sowNo);

    // ローカルで除去
    PregCheck.list = PregCheck.list.filter(function(s) { return s.sowNo !== sowNo; });
    setTimeout(function() { PregCheck.render(); }, 500);

    if (status === '空胎' && pregRow && typeof Breeding !== 'undefined') {
      Breeding.list = Breeding.list.filter(function(s) { return String(s.sowNo) !== String(sowNo); });
      Breeding.list.push({
        sowNo: String(sowNo),
        penNo: pregRow.penNo || '不明',
        reason: '空胎 0日目',
        group: 0,
        days: 0,
        status: '空胎',
        btHistory: []
      });
      // 並び順は統合リストの描画時にペン番号昇順へ揃えられる
    }

    OfflineSync.enqueue('recordStatusChange', [sowNo, status, dateStr]);
  }
};
