/** 一覧用の繁殖経過。現在状態を書き換えず、元記録を全件読んで集計する。 */
function attachReproductiveHistory_(ss, lists) {
  var targets = Object.create(null);
  lists.forEach(function(list) {
    list.forEach(function(s) { targets[String(s.sowNo)] = true; });
  });
  if (!Object.keys(targets).length) return;
  var data = {};
  ['種付', '分娩', '離乳', '繁殖管理', '母豚記録'].forEach(function(name) {
    data[name] = getSheetData(ss, name);
  });
  var histories = buildReproductiveHistories_(data, targets);
  lists.forEach(function(list) {
    list.forEach(function(s) { s.reproductiveHistory = histories[String(s.sowNo)]; });
  });
}

function buildReproductiveHistories_(data, targets) {
  var bySow = Object.create(null);
  Object.keys(targets).forEach(function(sn) {
    bySow[sn] = { events: [], farrow: '', wean: '', parity: null };
  });
  function date(value) {
    var ds = toDateString(value);
    return /^\d{4}-\d{2}-\d{2}$/.test(ds) ? ds : '';
  }
  function each(name, sowCol, fn) {
    (data[name] || []).slice(1).forEach(function(row, index) {
      var sn = normalizeSowNo(row[sowCol]);
      if (bySow[sn]) fn(bySow[sn], row, index);
    });
  }
  function add(s, ds, type, order, note) {
    if (ds) s.events.push({ date: ds, type: type, order: order, note: note || '' });
  }
  each('母豚記録', 0, function(s, r) {
    if (r[3] !== '' && r[3] !== null && r[3] !== undefined && isFinite(Number(r[3]))) s.parity = Number(r[3]);
  });
  each('分娩', 0, function(s, r) { var ds = date(r[1]); if (ds > s.farrow) s.farrow = ds; });
  each('離乳', 0, function(s, r) { var ds = date(r[1]); if (ds > s.wean) s.wean = ds; });
  each('繁殖管理', 1, function(s, r, i) {
    var ds = date(r[0]);
    var status = String(r[4] || '').trim();
    var type = { '空胎': 'empty', '再発': 'return', '再発情': 'return', '再発確認': 'return',
      '再発情確認': 'return', '流産': 'abortion', '妊娠鑑定済': 'pregnant',
      '再発情確認終了': 'checked', '離乳': 'wean', '育成': 'gilt' }[status];
    // 通常・BT・測定終了は種付失敗を意味しない。
    if (type === 'wean' && ds > s.wean) s.wean = ds;
    if (type) add(s, ds, type, i);
  });
  each('種付', 0, function(s, r, i) {
    var ds = date(r[1]);
    add(s, ds, 'mating', i);
    // 種付シートの再発情・流産列は日付がある場合だけ日付付きの事実として扱う。
    ['return', 'abortion'].forEach(function(type, j) {
      var resultDate = date(r[j + 2]);
      if (resultDate && resultDate >= ds) add(s, resultDate, type, i);
      else if (r[j + 2] && !/^(0|なし|無|false|FALSE|－|-)$/.test(String(r[j + 2]))) {
        add(s, ds, type, i, '日付不明・種付記録の記載');
      }
    });
  });

  var result = Object.create(null);
  Object.keys(bySow).forEach(function(sn) {
    var s = bySow[sn];
    var boundary = s.wean > s.farrow ? s.wean : s.farrow;
    var events = s.events.filter(function(e) { return !boundary || e.date >= boundary; });
    var priorities = { wean: 0, gilt: 0, mating: 1, checked: 2, pregnant: 3, empty: 4, return: 4, abortion: 4 };
    events.sort(function(a, b) {
      return a.date.localeCompare(b.date) || priorities[a.type] - priorities[b.type] || a.order - b.order;
    });
    var h = { origin: boundary ? (s.wean >= s.farrow ? '離乳' : '分娩後') :
      (s.parity === 0 || events.some(function(e) { return e.type === 'gilt'; }) ? '育成' : '導入／記録開始'),
      originDate: boundary, attempts: 0, returns: 0, empties: 0, events: [], estimated: true,
      sameDayUncertain: events.some(function(e) {
        return !e.note && /^(empty|return|abortion|pregnant)$/.test(e.type) && events.some(function(m) {
          return m.type === 'mating' && m.date === e.date;
        });
      }) };
    var attemptStart = '', failed = false, seen = Object.create(null), counted = Object.create(null);
    var labels = { checked: '再発チェック済', pregnant: '妊娠鑑定済', empty: '空胎', return: '再発', abortion: '流産' };
    events.forEach(function(e) {
      if (e.type === 'wean' || e.type === 'gilt') return;
      var key = e.date + ':' + e.type + ':' + e.note;
      if (seen[key]) return;
      seen[key] = true;
      var label;
      if (e.type === 'mating') {
        var gap = attemptStart ? (Date.parse(e.date) - Date.parse(attemptStart)) / 86400000 : Infinity;
        // 過去記録には追い種付の区別がない。初日から3日以内を同一回の目安とする。
        if (!attemptStart || gap > 3 || failed) {
          h.attempts++;
          attemptStart = e.date;
          label = '種付' + h.attempts + '回目';
        } else {
          label = '追い種付（目安）';
        }
        failed = false;
      } else {
        label = labels[e.type];
        if (!e.note && (e.type === 'empty' || e.type === 'return' || e.type === 'abortion')) failed = true;
        var countKey = h.attempts + ':' + e.type;
        if (!counted[countKey]) {
          if (e.type === 'empty') h.empties++;
          if (e.type === 'return') h.returns++;
          counted[countKey] = true;
        }
      }
      h.events.push({ date: e.note ? '' : e.date, label: label, type: e.type, note: e.note });
    });
    result[sn] = h;
  });
  return result;
}
