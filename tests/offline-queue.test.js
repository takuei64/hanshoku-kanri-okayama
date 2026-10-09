const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'js_offline.js'), 'utf8');
const key = 'hanshoku-kanri-okayama-v1:offline-queue';
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function makeStore() {
  const values = new Map();
  return { values, get length() { return values.size; }, key(i) { return [...values.keys()][i]; },
    getItem(k) { return values.get(k) ?? null; }, setItem(k,v) { values.set(k, String(v)); }, removeItem(k) { values.delete(k); } };
}
function setup(storage = makeStore()) {
  const events = {}, timers = [], calls = [], status = {}, documentEvents = {};
  let response = { success: true }, network = 'online', success, failure;
  const run = { withSuccessHandler(fn) { success = fn; return this; }, withFailureHandler(fn) { failure = fn; return this; },
    executeQueuedOperation(op, token) { calls.push({ op, token }); const ok=success, bad=failure; if (response === 'lost') return;
      if (response instanceof Error) bad(response); else ok(response); } };
  const context = { localStorage: storage, navigator: {onLine:true}, Promise, Date, Math, JSON,
    window: {addEventListener(n, f) { events[n] = f; }, crypto: {randomUUID:()=> 'test-'+ Math.random()}},
    document: {hidden:false, addEventListener(n,f) {documentEvents[n]=f;}, getElementById() {return status;}},
    setTimeout(fn, delay) {const timer={fn,delay,active:true}; timers.push(timer); return timer;}, clearTimeout(t) {t.active=false;}, setInterval() {},
    App: {authToken:'mock-session', captureSnapshot() {}, toast() {}, refreshQuietly() { context.OfflineSync.refreshCompleted(); }},
    PwaNetwork: {invalidate() {}, check() {return Promise.resolve({state:network});}},
    google: {script:{run}} };
  vm.createContext(context); vm.runInContext(source, context); const sync=context.OfflineSync; sync.init();
  return {context, sync, storage, events, documentEvents, timers, calls, status,
    setResponse(value) {response=value;}, setNetwork(value) {network=value;},
    async tick(max=100) { for(let i=0;i<max;i++) {await settle(); const t=timers.find(t=>t.active && t.delay<100); if(!t) break; t.active=false; t.fn();} await settle();} };
}

test('legacy migration preserves IDs, auth queue and missing-delete failures without deleting entries', () => {
  const store=makeStore(); const legacy=[{id:'a',state:'sending',type:'recordMovement',args:['900','2','2026-10-09']},
    {id:'b',state:'failed',error:'認証が切れました'}, {id:'c',state:'failed',type:'deleteMatingRecord',error:'該当する種付記録が見つかりません'}];
  store.setItem(key,JSON.stringify(legacy)); const {sync}=setup(store);
  assert.equal(sync.queue.length,3); assert.equal(sync.queue.find(x=>x.id==='a').state,'pending');
  assert.equal(sync.queue.find(x=>x.id==='b').state,'auth'); assert.equal(sync.failedCount(),1);
});
test('corrupt queue is preserved verbatim and refuses false saved success', () => {
  const store=makeStore(); store.setItem(key,'[broken'); const {sync}=setup(store); let applied=false;
  assert.equal(sync.enqueue('recordBTValue',[],{applyLocal(){applied=true;}}),null);
  assert.equal(applied,false); assert.equal(store.getItem(key),'[broken');
});
test('durable storage failure never applies local changes or claims saved success', () => {
  const {sync,storage}=setup(); storage.setItem=()=>{throw new Error('quota');}; let applied=false;
  assert.equal(sync.enqueue('recordBTValue',[],{applyLocal(){applied=true;}}),null); assert.equal(applied,false);
});
test('two stale tabs retain both operations; completion cannot resurrect or remove the other input', () => {
  const storage=makeStore(), a=setup(storage), b=setup(storage);
  const idA=a.sync.enqueue('recordMovement',['900','2','2026-10-09']); const stale=a.sync.queue[0];
  const idB=b.sync.enqueue('recordBTValue',['901',38.5,'2026-10-09']);
  assert.equal(a.sync.loadQueue().length,2); a.sync.removeOperation(idA);
  assert.equal(b.sync.persist(stale),false); assert.equal(a.sync.loadQueue().length,1); assert.equal(a.sync.loadQueue()[0].id,idB);
});
test('stale timeout from another tab cannot turn permanent error into automatic retry', () => {
  const storage=makeStore(), a=setup(storage), b=setup(storage);
  const id=a.sync.enqueue('recordMovement',['900','2','2026-10-09']); const stale=b.sync.loadQueue()[0];
  const failed=a.sync.queue[0]; failed.state='failed'; failed.error='対象データなし'; a.sync.persist(failed);
  stale.state='pending'; stale.error='timeout'; assert.equal(b.sync.persist(stale),false);
  assert.equal(b.sync.loadQueue()[0].state,'failed'); a.sync.retryFailed(id); assert.equal(a.sync.loadQueue()[0].state,'pending');
});
test('all lifecycle wakeups clear transient backoff but retain permanent errors', async () => {
  for (const event of ['online','pageshow','focus','visibilitychange']) {
    const h=setup(); h.setNetwork('offline');
    h.sync.enqueue('recordMovement',['900','2','2026-10-09']);
    const op=h.sync.queue[0]; op.nextAttemptAt=Date.now()+60000; h.sync.persist(op);
    const bad={id:'permanent',type:'recordMovement',args:[],state:'failed',nextAttemptAt:60000}; h.sync.persist(bad);
    (event==='visibilitychange'?h.documentEvents[event]:h.events[event])(); await settle();
    assert.equal(h.sync.loadQueue().find(x=>x.id===op.id).nextAttemptAt,0,event);
    assert.equal(h.sync.loadQueue().find(x=>x.id==='permanent').state,'failed',event);
  }
});
test('queue drains to the last operation then refreshes automatically without a status click', async () => {
  const h=setup(); for(let i=0;i<4;i++) h.sync.enqueue('recordBTValue',['mock-'+i,38+i,'2026-10-09']);
  await h.tick(); assert.equal(h.calls.length,4); assert.equal(h.sync.queue.length,0); assert.equal(h.status.textContent,'同期済');
});
test('reachable expired authentication retains operations; login reuses IDs with the new token', async () => {
  const h=setup(); h.setNetwork('auth'); const id=h.sync.enqueue('recordMovement',['900','2','2026-10-09']);
  await h.tick(); assert.equal(h.calls.length,0); assert.equal(h.sync.queue[0].state,'auth'); assert.match(h.status.textContent,/認証待ち/);
  h.context.App.authToken='renewed-mock-session'; h.setNetwork('online'); h.sync.retryPendingNow(true); await h.tick();
  assert.equal(h.calls[0].op.id,id); assert.equal(h.calls[0].token,'renewed-mock-session'); assert.equal(h.sync.queue.length,0);
});
test('response loss and timeout retain original operation ID through restart and resend', async () => {
  const h=setup(); h.setResponse('lost'); const id=h.sync.enqueue('recordMovement',['900','2','2026-10-09']); await h.tick();
  const timer=h.timers.find(t=>t.active && t.delay===25000); assert.ok(timer); timer.active=false; timer.fn();
  assert.equal(h.sync.queue[0].id,id); assert.equal(h.sync.queue[0].errorKind,'network');
  const restarted=setup(h.storage); await restarted.tick(); assert.equal(restarted.calls[0].op.id,id); assert.equal(restarted.sync.queue.length,0);
});
test('navigator online with failed ping never sends, keeps saved records, and retries automatically', async () => {
  const h=setup(); h.setNetwork('offline'); h.sync.enqueue('recordBTValue',['900',39,'2026-10-09']); await h.tick();
  assert.equal(h.calls.length,0); assert.equal(h.sync.queue.length,1); assert.match(h.status.textContent,/通信待ち/);
  h.setNetwork('online'); h.events.focus(); await h.tick(); assert.equal(h.calls.length,1); assert.equal(h.sync.queue.length,0);
});
test('permanent server response remains for review and does not block the next independent input', async () => {
  const h=setup(); h.setResponse({success:false,error:'対象データなし',retryable:false}); h.sync.enqueue('recordMovement',['missing','2','2026-10-09']); await h.tick();
  assert.equal(h.sync.queue[0].state,'failed'); h.setResponse({success:true}); h.sync.enqueue('recordBTValue',['900',39,'2026-10-09']); await h.tick();
  assert.equal(h.sync.queue.length,1); assert.equal(h.calls.length,2); h.events.focus(); await h.tick(); assert.equal(h.calls.length,2);
});
test('mutation revision changes even when an input was enqueued and fully drained during an old read', async () => {
  const h=setup(), before=h.sync.mutationRevision(); h.sync.enqueue('recordBTValue',['900',39,'2026-10-09']); await h.tick();
  assert.equal(h.sync.queue.length,0); assert.notEqual(h.sync.mutationRevision(),before);
});
