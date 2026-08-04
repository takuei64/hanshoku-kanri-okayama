/**
 * 母豚管理API
 * 個体カード（1頭分の全履歴）
 *
 * 繁殖管理シート: [日付, 母豚No, ペンNo, BT値, ステータス]
 */

/**
 * 母豚個体カード（1頭分の全履歴）
 * CacheServiceで5分キャッシュ（シートデータ部分）
 * @param {number} sowNo 母豚番号
 * @return {Object} 個体情報 + 各種履歴
 */
function getSowCard(sowNo, authToken) {
  requireAuth_(authToken);
  var ss = getSpreadsheet();

  // 母豚基本情報: まず母豚記録を参照、なければ種付記録から構築
  var sowInfo = null;
  try {
    var sowData = getSheetData(ss, '母豚記録');
    var sowHeaders = (sowData[0] || []).map(function(value) { return String(value || '').trim(); });
    function sowColumn_(patterns, fallback) {
      for (var column = 0; column < sowHeaders.length; column++) {
        for (var patternIndex = 0; patternIndex < patterns.length; patternIndex++) {
          if (sowHeaders[column].indexOf(patterns[patternIndex]) >= 0) return column;
        }
      }
      return fallback;
    }
    var sowNoColumn = sowColumn_(['母豚番号', '母豚No'], 0);
    var earTagColumn = sowColumn_(['耳刻', '耳標'], 1);
    var birthDateColumn = sowColumn_(['生年月日'], 2);
    var introductionParityColumn = sowColumn_(['導入産次', '導入時産歴'], 3);
    for (var i = 1; i < sowData.length; i++) {
      if (sowData[i][sowNoColumn] == sowNo) {
        sowInfo = {
          sowNo: sowData[i][sowNoColumn],
          earTag: sowData[i][earTagColumn] || '',
          birthDate: toDateString(sowData[i][birthDateColumn]),
          introductionParity: sowData[i][introductionParityColumn] || ''
        };
        break;
      }
    }
  } catch (e) {
    // 母豚記録シートが存在しない場合は無視
  }

  // 繁殖管理（移動・BT値・ステータス統合）
  var breedData = getSheetData(ss, '繁殖管理');
  var breedingRecords = [];
  var currentPen = '未登録';
  var latestPenDate = null;
  for (var i = 1; i < breedData.length; i++) {
    if (breedData[i][1] != sowNo) continue;
    var date = breedData[i][0];
    var penNo = breedData[i][2];
    var bt = breedData[i][3];
    var status = breedData[i][4];

    breedingRecords.push({
      date: toDateString(date),
      penNo: penNo || '',
      bt: bt || '',
      status: status || ''
    });

    if (penNo && date instanceof Date && (!latestPenDate || date >= latestPenDate)) {
      currentPen = penNo;
      latestPenDate = date;
    }
  }
  // 全イベントを1つのtimelineにまとめる
  var timeline = [];

  // 繁殖管理レコード
  for (var i = 0; i < breedingRecords.length; i++) {
    var r = breedingRecords[i];
    var details = [];
    if (r.penNo) details.push('Pen ' + r.penNo);
    if (r.bt) details.push('BT ' + r.bt);
    if (r.status) details.push(r.status);
    timeline.push({ date: r.date, event: '繁殖管理', detail: details.join(' / '), _penNo: r.penNo, _bt: r.bt, _status: r.status });
  }

  // 種付履歴（＋母豚記録にない場合の基本情報構築）
  var matingData = getSheetData(ss, '種付');
  var firstMatingDate = null;
  for (var i = 1; i < matingData.length; i++) {
    if (matingData[i][0] != sowNo) continue;
    var mateDate = matingData[i][1];
    if (mateDate instanceof Date && (!firstMatingDate || mateDate < firstMatingDate)) {
      firstMatingDate = mateDate;
    }
    var details = [];
    if (matingData[i][2]) details.push('再発情:' + matingData[i][2]);
    if (matingData[i][3]) details.push('流産:' + matingData[i][3]);
    timeline.push({ date: toDateString(mateDate), event: '種付', detail: details.join(' / ') });
  }

  // 母豚記録に未登録の場合、種付記録から基本情報を構築
  if (!sowInfo && firstMatingDate) {
    var birth = new Date(firstMatingDate.getTime());
    birth.setDate(birth.getDate() - 240);
    sowInfo = {
      sowNo: sowNo,
      earTag: '',
      birthDate: toDateString(birth) + '(推定)',
      introductionParity: ''
    };
  }

  // 分娩履歴
  var farrowData = getSheetData(ss, '分娩');
  for (var i = 1; i < farrowData.length; i++) {
    if (farrowData[i][0] != sowNo) continue;
    var total = farrowData[i][2] || 0;
    var still = farrowData[i][3] || 0;
    timeline.push({ date: toDateString(farrowData[i][1]), event: '分娩', detail: '総産子:' + total + ' 死産:' + still, _total: total, _still: still });
  }

  // 離乳履歴
  var weanData = getSheetData(ss, '離乳');
  for (var i = 1; i < weanData.length; i++) {
    if (weanData[i][0] != sowNo) continue;
    var weaned = weanData[i][2] || 0;
    var deaths = weanData[i][3] || 0;
    timeline.push({ date: toDateString(weanData[i][1]), event: '離乳', detail: '離乳頭数:' + weaned + ' 死亡:' + deaths, _weaned: weaned, _deaths: deaths });
  }

  // 日付昇順
  timeline.sort(function(a, b) { return (a.date || '').localeCompare(b.date || ''); });

  // sowInfoが未構築の場合（母豚記録にも種付記録にもない）
  if (!sowInfo) {
    if (timeline.length === 0) {
      return { error: '母豚番号 ' + sowNo + ' の記録は見つかりません' };
    }
    // 繁殖管理・分娩・離乳など他シートに記録がある場合
    sowInfo = {
      sowNo: sowNo,
      earTag: '',
      birthDate: '',
      introductionParity: ''
    };
  }

  return {
    info: sowInfo,
    currentPen: currentPen,
    timeline: timeline
  };
}

/**
 * ペンマスタ全件取得（後方互換用）
 */
function getPenList(authToken) {
  requireAuth_(authToken);
  var ss = getSpreadsheet();
  var data = getSheetData(ss, 'ペンマスタ');
  var result = [];
  for (var i = 1; i < data.length; i++) {
    result.push({ penNo: data[i][0], area: data[i][1] || '' });
  }
  return result;
}
