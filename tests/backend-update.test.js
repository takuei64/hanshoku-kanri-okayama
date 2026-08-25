const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function dateText(value) {
  if (!(value instanceof Date) && Object.prototype.toString.call(value) !== '[object Date]') return String(value || '');
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function makeSheet(rows) {
  return {
    rows,
    getDataRange() { return { getValues: () => this.rows.map(row => row.slice()) }; },
    getRange(row, column) {
      return {
        setValue: value => { this.rows[row - 1][column - 1] = value; },
        setValues: values => {
          for (let r = 0; r < values.length; r++) {
            for (let c = 0; c < values[r].length; c++) this.rows[row - 1 + r][column - 1 + c] = values[r][c];
          }
        }
      };
    }
  };
}

function loadApi(sheets) {
  const context = {
    console,
    Date,
    Math,
    Number,
    String,
    JSON,
    isFinite,
    isNaN,
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    getSpreadsheet: () => ({ getSheetByName: name => sheets[name] || null }),
    requireAuth_: () => {},
    normalizeSowNo: value => String(value === null || value === undefined ? '' : value).trim(),
    parseInputDate: value => {
      const parts = String(value).split('-').map(Number);
      return new Date(parts[0], parts[1] - 1, parts[2]);
    },
    toDateString: dateText
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '..', 'apps-script-project', 'api_breeding.js'), 'utf8');
  vm.runInContext(source, context);
  context.syncCurrentStatusForSow_ = () => {};
  context.invalidateInitialCache_ = () => {};
  return context;
}

test('4種類の履歴を元データ一致で更新し、同じ操作の再送も成功扱いにする', () => {
  const sheets = {
    '種付': makeSheet([['母豚No', '日付'], ['27', new Date(2026, 6, 1), '', '']]),
    '分娩': makeSheet([['母豚No', '日付', '総産子', '死産'], ['27', new Date(2026, 7, 1), 10, 1]]),
    '離乳': makeSheet([['母豚No', '日付', '離乳', '死亡'], ['27', new Date(2026, 7, 20), 8, 2]]),
    '繁殖管理': makeSheet([
      ['日付', '母豚No', 'Pen', 'BT', '状態'],
      [new Date(2026, 6, 1), '27', '', '', '通常'],
      [new Date(2026, 6, 20), '27', '', 38.5, ''],
      [new Date(2026, 7, 20), '27', '12', '', '離乳']
    ])
  };
  const api = loadApi(sheets);

  assert.equal(api.updateMatingRecord('27', '2026-07-01', '2026-07-02', 'token').success, true);
  assert.equal(dateText(sheets['種付'].rows[1][1]), '2026-07-02');
  assert.equal(dateText(sheets['繁殖管理'].rows[1][0]), '2026-07-02');
  assert.equal(api.updateMatingRecord('27', '2026-07-01', '2026-07-02', 'token').alreadyUpdated, true);

  assert.equal(api.updateFarrowingRecord('27', '2026-08-01', 10, 1, '2026-08-02', 11, 0, 'token').success, true);
  assert.deepEqual(sheets['分娩'].rows[1].slice(2), [11, 0]);
  assert.equal(api.updateFarrowingRecord('27', '2026-08-01', 10, 1, '2026-08-02', 11, 0, 'token').alreadyUpdated, true);

  assert.equal(api.updateWeaningRecord('27', '2026-08-20', 8, 2, '2026-08-21', 9, 1, 'token').success, true);
  assert.deepEqual(sheets['離乳'].rows[1].slice(2), [9, 1]);
  assert.equal(dateText(sheets['繁殖管理'].rows[3][0]), '2026-08-21');
  assert.equal(api.updateWeaningRecord('27', '2026-08-20', 8, 2, '2026-08-21', 9, 1, 'token').alreadyUpdated, true);

  assert.equal(api.updateBTRecord('27', '2026-07-20', 38.5, '2026-07-21', 39, 'token').success, true);
  assert.equal(dateText(sheets['繁殖管理'].rows[2][0]), '2026-07-21');
  assert.equal(sheets['繁殖管理'].rows[2][3], 39);
  assert.equal(api.updateBTRecord('27', '2026-07-20', 38.5, '2026-07-21', 39, 'token').alreadyUpdated, true);
});
