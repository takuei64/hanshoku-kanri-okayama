(function(global) {
  'use strict';

  // Patches describe only one input's changes. Applying them to the latest
  // saved snapshot preserves independent inputs from another tab or window.
  var keyedLists = {
    morningList: 'sowNo', postMatingList: 'sowNo', farrowingList: 'sowNo',
    locationList: 'sowNo', reheatCheckList: 'sowNo', pregnancyCheckList: 'sowNo',
    penTaskList: 'penNo'
  };
  var own = function(value, key) { return Object.prototype.hasOwnProperty.call(value, key); };
  function copy(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
  function assign(object, key, value) {
    Object.defineProperty(object, key, { value: value, enumerable: true, writable: true, configurable: true });
  }
  function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function signature(value) {
    if (Array.isArray(value)) return '[' + value.map(signature).join(',') + ']';
    if (object(value)) return '{' + Object.keys(value).sort().map(function(key) { return JSON.stringify(key) + ':' + signature(value[key]); }).join(',') + '}';
    return JSON.stringify(value);
  }
  function index(items, key) {
    var result = Object.create(null);
    for (var i = 0; i < items.length; i++) {
      if (!object(items[i]) || items[i][key] === null || items[i][key] === undefined) return null;
      var id = String(items[i][key]);
      if (own(result, id)) return null;
      result[id] = items[i];
    }
    return result;
  }
  function counts(items) {
    var result = Object.create(null);
    items.forEach(function(item) {
      var id = signature(item);
      if (!result[id]) result[id] = { value: item, count: 0 };
      result[id].count++;
    });
    return result;
  }

  function diffArray(before, after, field) {
    var key = keyedLists[field], oldIndex = key && index(before, key), newIndex = key && index(after, key);
    if (oldIndex && newIndex) {
      var removed = [], changed = Object.create(null), added = [];
      Object.keys(oldIndex).forEach(function(id) {
        if (!own(newIndex, id)) removed.push(id);
        else {
          var patch = difference(oldIndex[id], newIndex[id], '');
          if (patch) changed[id] = patch;
        }
      });
      after.forEach(function(item) { if (!own(oldIndex, String(item[key]))) added.push(copy(item)); });
      if (!removed.length && !added.length && !Object.keys(changed).length) return null;
      return { kind: 'keyed', key: key, removed: removed, changed: changed, added: added, order: after.map(function(item) { return String(item[key]); }) };
    }
    var oldCounts = counts(before), newCounts = counts(after);
    var removals = [], additions = [], used = Object.create(null);
    var primitives = before.concat(after).every(function(item) { return item === null || typeof item !== 'object'; });
    Object.keys(oldCounts).forEach(function(id) {
      var number = oldCounts[id].count - (newCounts[id] ? newCounts[id].count : 0);
      if (number > 0) removals.push({ signature: id, count: number });
    });
    after.forEach(function(item, position) {
      var id = signature(item);
      used[id] = (used[id] || 0) + 1;
      if (used[id] <= (oldCounts[id] ? oldCounts[id].count : 0)) return;
      var next = null;
      for (var i = position + 1; i < after.length; i++) {
        var candidate = signature(after[i]);
        if (oldCounts[candidate]) { next = candidate; break; }
      }
      additions.push({ value: copy(item), before: next });
    });
    if (!removals.length && !additions.length) return null;
    return { kind: 'items', removed: removals, added: additions, unique: primitives };
  }

  function difference(before, after, field) {
    if (signature(before) === signature(after)) return null;
    if (Array.isArray(before) && Array.isArray(after)) return diffArray(before, after, field);
    if (object(before) && object(after)) {
      var fields = Object.create(null), removed = [];
      Object.keys(before).forEach(function(key) {
        if (key !== '__offlineApplied' && !own(after, key)) removed.push(key);
      });
      Object.keys(after).forEach(function(key) {
        if (key === '__offlineApplied') return;
        var patch = difference(before[key], after[key], key);
        if (patch) fields[key] = patch;
      });
      return removed.length || Object.keys(fields).length ? { kind: 'object', removed: removed, fields: fields } : null;
    }
    return { kind: 'value', value: copy(after) };
  }

  function applyValue(latest, patch) {
    if (!patch) return copy(latest);
    if (patch.kind === 'value') return copy(patch.value);
    if (patch.kind === 'object') {
      var result = object(latest) ? copy(latest) : {};
      patch.removed.forEach(function(key) { delete result[key]; });
      Object.keys(patch.fields).forEach(function(key) { assign(result, key, applyValue(result[key], patch.fields[key])); });
      return result;
    }
    var items = Array.isArray(latest) ? copy(latest) : [];
    if (patch.kind === 'keyed') {
      items = items.filter(function(item) { return patch.removed.indexOf(String(item[patch.key])) < 0; });
      items = items.map(function(item) {
        var id = String(item[patch.key]);
        return own(patch.changed, id) ? applyValue(item, patch.changed[id]) : item;
      });
      // A concurrent removal wins over a stale edit. Only actual additions may
      // create rows; edits to missing rows do not bring retired sows back.
      patch.added.forEach(function(item) {
        var id = String(item[patch.key]);
        if (items.some(function(row) { return String(row[patch.key]) === id; })) return;
        var position = -1, orderIndex = patch.order.indexOf(id);
        for (var i = orderIndex + 1; i < patch.order.length && position < 0; i++) {
          var nextId = patch.order[i];
          position = items.findIndex(function(row) { return String(row[patch.key]) === nextId; });
        }
        items.splice(position < 0 ? items.length : position, 0, copy(item));
      });
      return items;
    }
    if (patch.kind === 'items') {
      patch.removed.forEach(function(removal) {
        for (var i = 0; i < removal.count; i++) {
          var position = items.findIndex(function(item) { return signature(item) === removal.signature; });
          if (position >= 0) items.splice(position, 1);
        }
      });
      patch.added.forEach(function(addition) {
        var id = signature(addition.value);
        if (patch.unique && items.some(function(item) { return signature(item) === id; })) return;
        var position = addition.before === null ? -1 : items.findIndex(function(item) { return signature(item) === addition.before; });
        items.splice(position < 0 ? items.length : position, 0, copy(addition.value));
      });
      return items;
    }
    throw new Error('保存済み変更の形式を確認してください');
  }

  global.SnapshotPatch = {
    diff: function(before, after) { return { version: 1, change: difference(before || {}, after || {}, '') }; },
    apply: function(latest, patch, operationId) {
      var base = latest || {};
      if (!patch || patch.version !== 1) throw new Error('保存済み変更の形式を確認してください');
      var applied = Array.isArray(base.__offlineApplied) ? base.__offlineApplied.slice() : [];
      if (operationId && applied.indexOf(String(operationId)) >= 0) return copy(base);
      var result = applyValue(base, patch.change);
      if (operationId) applied.push(String(operationId));
      if (applied.length) result.__offlineApplied = applied;
      return result;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
