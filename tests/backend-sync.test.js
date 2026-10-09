const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

// Entirely in-memory Apps Script doubles. No HTTP calls or production data.
function sheet(rows = []) {
  return {
    rows, beforeWrite: null,
    getLastRow() { return rows.length; },
    getDataRange() { return this.getRange(1, 1, rows.length, 20); },
    getRange(row, column, height = 1, width = 1) {
      const owner = this;
      const range = {
        getValues() { return Array.from({ length: height }, (_, r) => Array.from({ length: width }, (_, c) => rows[row - 1 + r]?.[column - 1 + c] ?? '')); },
        getDisplayValues() { return this.getValues().map(r => r.map(String)); },
        getValue() { return this.getValues()[0][0]; },
        setValues(values) {
          owner.beforeWrite?.(values, row, column);
          values.forEach((valuesRow, r) => {
            rows[row - 1 + r] ||= [];
            valuesRow.forEach((value, c) => { rows[row - 1 + r][column - 1 + c] = value; });
          });
          return range;
        },
        setValue(value) { return this.setValues([[value]]); },
        setFontWeight() { return range; }, setBackground() { return range; }, setFontColor() { return range; }, setNumberFormat() { return range; },
        createTextFinder(value) {
          return {
            matchEntireCell() { return this; }, useRegularExpression() { return this; },
            findNext() {
              const index = rows.findIndex((r, i) => i >= row - 1 && i < row - 1 + height && String(r[column - 1]) === value);
              return index < 0 ? null : { getRow: () => index + 1 };
            }
          };
        }
      };
      return range;
    },
    appendRow(value) { this.getRange(rows.length + 1, 1).setValues([value]); },
    deleteRow(row) { rows.splice(row - 1, 1); },
    setFrozenRows() {}, hideSheet() {}
  };
}

function environment() {
  const sheets = {
    '繁殖管理': sheet([['date', 'sow', 'pen', 'bt', 'status']]),
    '種付': sheet([['sow', 'date']]),
    '分娩': sheet([['sow', 'date', 'total', 'still']]),
    '離乳': sheet([['sow', 'date', 'weaned', 'deaths']]),
    'ほ育事故': sheet([['sow', 'date', 'count']]),
    'ペン作業': sheet([['date', 'pen', 'type']]),
    'ペンマスタ': sheet([['pen', 'area'], ['1', '繁殖舎'], ['1001', '分娩舎']]),
    '作業マスタ': sheet([['area', 'type', 'day', 'order', 'enabled'], ['繁殖舎', 'test-task', 7, 1, true]])
  };
  const state = { sheets, held: false, lockAcquisitions: 0, lockReleases: 0, authServiceFailure: false };
  state.createApi = function () {
    const api = {
      Date, JSON, String, Number, Math, Array, isFinite, isNaN,
      LockService: {
        getScriptLock: () => ({
          waitLock() { if (state.held) throw new Error('Lock timeout'); state.held = true; state.lockAcquisitions++; },
          releaseLock() { state.held = false; state.lockReleases++; }
        }),
        getUserLock() { throw new Error('A per-user lock must never be used'); }
      },
      SpreadsheetApp: { flush() {} },
      Utilities: {
        DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
        computeDigest: (_kind, value) => Array.from(crypto.createHash('sha256').update(value).digest()),
        formatDate: date => date.toISOString().slice(0, 10)
      },
      CacheService: { getScriptCache: () => ({ get() { if (state.authServiceFailure) throw new Error('Cache unavailable'); return '1'; }, remove() {}, put() {} }) },
      ContentService: { MimeType: { JSON: 'json', JAVASCRIPT: 'javascript' }, createTextOutput: text => ({ text, setMimeType(type) { this.type = type; return this; } }) },
      getSpreadsheet: () => ({ getSheetByName: name => sheets[name] || null, insertSheet: name => (sheets[name] = sheet()) }),
      getSheetData: (_ss, name) => sheets[name]?.rows || [],
      normalizeSowNo: value => String(value ?? '').trim(), normalizePenNo: value => String(value ?? '').trim(),
      toDateString: date => date instanceof Date ? [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-') : String(date)
    };
    vm.createContext(api);
    for (const file of ['auth.js', 'offline_sync.js', 'webapp.js', 'api_breeding.js', 'api_pentask.js', 'api_sow.js']) {
      vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script-project', file), 'utf8'), api, { filename: file });
    }
    api.upsertCurrentRow_ = () => {};
    api.addBtToCurrent_ = () => {};
    api.syncCurrentStatusForSow_ = () => {};
    api.invalidateInitialCache_ = () => {};
    api.removeCurrentRow_ = () => {};
    api.isRetiredStatus_ = () => false;
    api.isPostMatingDoneStatus_ = () => false;
    api.isReheatCheckDoneStatus_ = () => false;
    return api;
  };
  return state;
}

const op = (id = 'operation_test_001', type = 'recordBTValue', args = ['TEST-ONLY', 38.5, '2026-10-09']) => ({ id, type, args });
const call = (api, operation) => api.executeQueuedOperation(operation, 'mock-only');

test('lost response, timeout retry, application restart: the same operation writes once', () => {
  const env = environment();
  let api = env.createApi();
  assert.equal(call(api, op()).success, true); // Discard the first response, as if the network lost it.
  assert.equal(call(api, op()).duplicate, true);
  api = env.createApi(); // A fresh server execution has no in-memory deduplication state.
  assert.equal(call(api, op()).success, true);
  assert.equal(env.sheets['繁殖管理'].rows.length, 2);
  assert.equal(env.lockAcquisitions, 3);
  assert.equal(env.lockAcquisitions, env.lockReleases);
});

test('tab/SW and another user contend for one global lock; retry observes completed history', () => {
  const env = environment();
  const page = env.createApi(), worker = env.createApi();
  let competingResult;
  env.sheets['繁殖管理'].beforeWrite = () => { competingResult = call(worker, op()); };
  assert.equal(call(page, op()).success, true);
  assert.equal(competingResult.errorKind, 'network');
  assert.equal(competingResult.retryable, true);
  assert.equal(call(worker, op()).duplicate, true);
  assert.equal(env.sheets['繁殖管理'].rows.length, 2);
});

test('old operation IDs beyond 5000 later entries still deduplicate and are not pruned', () => {
  const env = environment();
  const api = env.createApi();
  assert.equal(call(api, op()).success, true);
  for (let i = 0; i < 5501; i++) env.sheets['アプリ同期履歴'].rows.push(['other_' + i, '', 'recordBTValue', '{"success":true}']);
  assert.equal(call(api, op()).duplicate, true);
  assert.equal(env.sheets['繁殖管理'].rows.length, 2);
  assert.equal(env.sheets['アプリ同期履歴'].rows.length, 5503);
});

test('ID reused with different payload is rejected without a second write', () => {
  const env = environment(), api = env.createApi();
  call(api, op());
  const result = call(api, op('operation_test_001', 'recordBTValue', ['TEST-ONLY', 99, '2026-10-09']));
  assert.equal(result.code, 'OPERATION_ID_CONFLICT');
  assert.equal(result.errorKind, 'permanent');
  assert.equal(env.sheets['繁殖管理'].rows.length, 2);
});

test('completion journal failure or partial business write never replays the mutation', () => {
  for (const failure of ['journal', 'current-status']) {
    const env = environment(), api = env.createApi();
    const journal = (env.sheets['アプリ同期履歴'] = sheet([['id', 'time', 'type', 'result']]));
    if (failure === 'journal') journal.beforeWrite = values => { if (JSON.parse(values[0][3]).state === 'completed') throw new Error('Sheet temporary failure'); };
    else api.addBtToCurrent_ = () => { throw new Error('Service unavailable'); };
    assert.equal(call(api, op()).code, 'OPERATION_OUTCOME_UNKNOWN');
    journal.beforeWrite = null;
    assert.equal(call(env.createApi(), op()).code, 'OPERATION_OUTCOME_UNKNOWN');
    assert.equal(env.sheets['繁殖管理'].rows.length, 2);
  }
});

test('pre-mutation temporary failures retry; auth and input errors are distinct and no entry is discarded', () => {
  const env = environment(), api = env.createApi();
  api.getPenAreaForCurrent_ = () => { throw new Error('Unexpected backend outage'); };
  const movement = op('operation_move_001', 'recordMovement', ['TEST-ONLY', '1', '2026-10-09']);
  let result = call(api, movement);
  assert.equal(result.errorKind, 'network');
  assert.equal(result.retryable, true);
  api.getPenAreaForCurrent_ = () => '繁殖舎';
  assert.equal(call(api, movement).success, true);
  result = api.executeQueuedOperation(op(), '');
  assert.equal(result.errorKind, 'auth');
  assert.equal(result.authRequired, true);
  result = call(api, op('operation_bad_001', 'deleteMatingRecord', ['NOT-A-REAL-SOW', '2026-10-09']));
  assert.equal(result.errorKind, 'permanent');
  assert.equal(result.success, false);
  assert.equal(result.retryable, false);
  assert.equal(env.sheets['アプリ同期履歴'].rows.length, 3);
});

test('a rejected operation can be explicitly retried with the same ID after a master correction', () => {
  const env = environment(), api = env.createApi();
  const movement = op('operation_master_001', 'recordMovement', ['TEST-ONLY', '9', '2026-10-09']);
  const rejected = call(api, movement);
  assert.equal(rejected.errorKind, 'permanent');
  assert.equal(rejected.retryable, false);
  assert.equal(env.sheets['繁殖管理'].rows.length, 1);
  assert.equal(JSON.parse(env.sheets['アプリ同期履歴'].rows[1][3]).state, 'rejected');
  env.sheets['ペンマスタ'].rows.push(['9', '繁殖舎']);
  assert.equal(call(api, movement).success, true);
  assert.equal(call(env.createApi(), movement).duplicate, true);
  assert.equal(env.sheets['繁殖管理'].rows.length, 2);
  assert.equal(env.sheets['アプリ同期履歴'].rows.length, 2);
});

test('missing destination sheet is reviewable before any write, then retry succeeds after repair', () => {
  const env = environment(), api = env.createApi();
  const operation = op('operation_missing_sheet', 'recordMating', ['TEST-ONLY', '2026-10-09']);
  const original = env.sheets['繁殖管理'];
  delete env.sheets['繁殖管理'];
  const result = call(api, operation);
  assert.equal(result.errorKind, 'permanent');
  assert.equal(result.retryable, false);
  assert.equal(result.code, undefined);
  assert.equal(env.sheets['種付'].rows.length, 1);
  env.sheets['繁殖管理'] = original;
  assert.equal(call(api, operation).success, true);
  assert.equal(call(api, operation).duplicate, true);
  assert.equal(env.sheets['種付'].rows.length, 2);
  assert.equal(env.sheets['繁殖管理'].rows.length, 2);
});

test('same successful deletion does not delete a second identical-looking row on replay', () => {
  const env = environment(), api = env.createApi();
  env.sheets['種付'].rows.push(['TEST-ONLY', new Date('2026-10-09')], ['TEST-ONLY', new Date('2026-10-09')]);
  const deletion = op('operation_delete_001', 'deleteMatingRecord', ['TEST-ONLY', '2026-10-09']);
  assert.equal(call(api, deletion).success, true);
  assert.equal(call(env.createApi(), deletion).duplicate, true);
  assert.equal(env.sheets['種付'].rows.length, 2);
});

test('corrupt legacy history is held for review, never silently acknowledged or executed', () => {
  const env = environment(), api = env.createApi();
  env.sheets['アプリ同期履歴'] = sheet([['id', 'time', 'type', 'result'], ['operation_test_001', '', 'recordBTValue', 'broken-json']]);
  assert.equal(call(api, op()).code, 'OPERATION_OUTCOME_UNKNOWN');
  assert.equal(env.sheets['繁殖管理'].rows.length, 1);
});

test('ping is read-only and distinguishes valid auth, missing auth, and an auth-service outage', () => {
  const env = environment(), api = env.createApi();
  api.getSpreadsheet = () => { throw new Error('Ping must not open a spreadsheet'); };
  assert.equal(api.ping('mock-only').status, 'online');
  assert.equal(api.ping('').status, 'auth');
  env.authServiceFailure = true;
  const result = api.ping('mock-only');
  assert.equal(result.status, 'server');
  assert.equal(result.authRequired, false);
  assert.equal(result.retryable, true);
});

test('JSON and JSONP routes share the restricted API and allow ping without credentials', () => {
  const env = environment(), api = env.createApi();
  for (const transport of ['json', '']) {
    const output = api.doGet({ parameter: { action: 'pwa', method: 'ping', requestId: 'request_test_001', payload: '[]', transport } });
    const response = JSON.parse(transport ? output.text : output.text.slice('PwaJsonp.handle('.length, -2));
    assert.equal(response.ok, true);
    assert.equal(response.result.status, 'auth');
    assert.equal(output.type, transport ? 'json' : 'javascript');
  }
  const denied = api.doGet({ parameter: { action: 'pwa', method: 'executeQueuedOperation', requestId: 'request_test_001', payload: JSON.stringify([op()]), transport: 'json' } });
  assert.equal(JSON.parse(denied.text).authRequired, true);
  assert.equal(env.sheets['繁殖管理'].rows.length, 1);
});

test('all append operations and combined weaning/movement replay without duplicate business rows', () => {
  const env = environment(), api = env.createApi();
  api.ensureCurrentStatusSheet_ = () => ({});
  api.findCurrentRow_ = () => ({ row: { area: '分娩舎' } });
  const operations = [
    ['recordMovement', ['TEST-ONLY', '1', '2026-10-09']],
    ['recordBTValue', ['TEST-ONLY', 38, '2026-10-09']],
    ['recordStatusChange', ['TEST-ONLY', '妊娠鑑定済', '2026-10-09']],
    ['recordMating', ['TEST-ONLY', '2026-10-09']],
    ['recordFarrowing', ['TEST-ONLY', '2026-10-09', 10, 1]],
    ['recordWeaning', ['TEST-ONLY', '2026-10-09', 8, '1']],
    ['recordNursingAccident', ['TEST-ONLY', '2026-10-09', 1]],
    ['recordPenTasks', ['1', ['test-task'], '2026-10-09']]
  ];
  operations.forEach(([type, args], i) => {
    const operation = op('operation_append_' + i, type, args);
    assert.equal(call(api, operation).success, true, type);
    const counts = Object.values(env.sheets).map(s => s.rows.length);
    assert.equal(call(api, operation).duplicate, true, type);
    assert.deepEqual(Object.values(env.sheets).map(s => s.rows.length), counts, type);
  });
});

test('invalid dates and counts are rejected before journaling or business writes', () => {
  const env = environment(), api = env.createApi();
  for (const operation of [
    op('invalid_date_001', 'recordBTValue', ['TEST-ONLY', 38, '2026-02-30']),
    op('invalid_count_001', 'recordFarrowing', ['TEST-ONLY', '2026-10-09', 3, 4]),
    op('invalid_count_002', 'recordNursingAccident', ['TEST-ONLY', '2026-10-09', -1])
  ]) {
    assert.equal(call(api, operation).errorKind, 'permanent');
  }
  assert.equal(env.sheets['アプリ同期履歴'], undefined);
  assert.equal(env.sheets['繁殖管理'].rows.length, 1);
});

test('initial snapshot cards read each sheet once and match individual cards without opening each card', () => {
  const env = environment(), api = env.createApi();
  env.sheets['母豚記録'] = sheet([['耳標', '母豚番号', '生年月日', '導入産次'], ['test-ear', 'TEST-A', new Date('2025-01-01'), 1]]);
  env.sheets['繁殖管理'].rows.push([new Date('2026-10-01'), 'TEST-A', '1', 38, ''], [new Date('2026-10-02'), 'TEST-B', '1001', '', '']);
  env.sheets['種付'].rows.push(['TEST-A', new Date('2026-06-01')]);
  env.sheets['分娩'].rows.push(['TEST-B', new Date('2026-10-03'), 10, 1]);
  env.sheets['離乳'].rows.push(['TEST-A', new Date('2026-09-01'), 9, 0]);
  const reads = {};
  api.getSheetData = (_ss, name) => { reads[name] = (reads[name] || 0) + 1; return env.sheets[name]?.rows || []; };
  const cards = api.buildOfflineSowCards_(api.getSpreadsheet(), [{ sowNo: 'TEST-A' }, { sowNo: 'TEST-B' }]);
  assert.equal(Object.keys(cards).length, 2);
  assert.deepEqual(Object.values(reads), [1, 1, 1, 1, 1]);
  assert.deepEqual(JSON.parse(JSON.stringify(cards['TEST-A'])), JSON.parse(JSON.stringify(api.getSowCard('TEST-A', 'mock-only'))));
  assert.deepEqual(JSON.parse(JSON.stringify(cards['TEST-B'])), JSON.parse(JSON.stringify(api.getSowCard('TEST-B', 'mock-only'))));
  assert.equal(cards['TEST-A'].currentPen, '1');
  assert.equal(cards['TEST-B'].timeline[1].event, '分娩');
});

test('location snapshot exposes dates used by offline movement and pen-task reconstruction', () => {
  const env = environment(), api = env.createApi();
  api.daysSince_ = () => 1;
  const location = api.buildLocationListFromCurrent_([{ sowNo: 'TEST-ONLY', penNo: '1', area: '繁殖舎', latestMoveDate: '2026-10-09', latestMatingDate: '2026-09-01', latestFarrowingDate: '2026-01-01' }])[0];
  assert.equal(location.latestMoveDate, '2026-10-09');
  assert.equal(location.latestMatingDate, '2026-09-01');
  assert.equal(location.latestFarrowingDate, '2026-01-01');
});
