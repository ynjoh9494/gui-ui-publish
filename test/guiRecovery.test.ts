import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Controller } from '../src/controller.ts';
import { classify } from '../src/core/compare.ts';
import { COPY } from '../src/core/copy.ts';
import { defaultDraft } from '../src/core/drafts.ts';
import { pendingRows, queueGuiDelivery, restoreGuiWrite, retryableDeliveries } from '../src/core/guiDelivery.ts';
import { buildPlan, commitPlan } from '../src/core/publish.ts';
import { FINGERPRINT_VERSION } from '../src/core/fingerprint.ts';
import { keys, memoryKV, Store } from '../src/core/store.ts';
import type { Delivery, Flipbook, GuiRecord, Screen } from '../src/core/types.ts';
import { toUiWire, type ToUi } from '../src/core/wire.ts';
import type { CopyUpdate, Host } from '../src/host.ts';

const actor = { id: 'u', name: 'Designer' };
const tag = { id: 't', name: 'Changed', color: '#00ff00', colorKey: 'Green' };

function fixture(confirmed = true) {
  const kv = memoryKV(), store = new Store(kv);
  store.saveProject({ ...store.state.project, templateNodeId: 'tpl', flipbookPageIds: ['ui'], flipbookPageId: 'ui', dataPageId: 'data' });
  store.put(keys.category('c'), { id: 'c', name: 'Home', code: 'HO', active: true, order: 0 });
  store.put(keys.worker('w'), { id: 'w', name: actor.name, alias: '', active: true });
  store.put(keys.tag('t'), { ...tag, team: 'GUI', active: true });
  const before: Screen = { id: 's1', code: 'STB_HO_001', name: 'Home', categoryId: 'c', baseScreenId: null, status: 'active', source: { nodeId: 'source', pageId: 'gui' }, guiVersion: 1, guiTag: tag, createdAt: 1, rev: 1 };
  const after: Screen = { ...before, guiVersion: 2, rev: 2 };
  const record: GuiRecord = { screenId: 's1', version: 2, batchId: 'b2', workType: 'changed', fingerprint: 'fp2', fpVersion: 2, thumb: { hash: 'h2', width: 100, height: 100 }, width: 100, height: 100, code: before.code, name: before.name, category: { id: 'c', name: 'Home' }, base: null, tag, description: 'Change', worker: actor, actor, committedAt: 1000, extra: {}, corrections: [] };
  store.put(keys.screen('s1'), before);
  store.put(keys.gui('s1', 1), { ...record, version: 1, batchId: 'b1', fingerprint: 'fp1', committedAt: 1 });
  store.put(keys.flipbook('fb'), { id: 'fb', rev: 1, kind: 'single', title: 'Home', autoTitle: true, titleNames: ['Home'], scale: 1, category: { key: 'c', name: 'Home', order: 0 }, screens: [{ uid: 's1', code: before.code, name: before.name, version: 1 }], pageId: 'ui', status: 'active', createdAt: 0, actor, tracked: true } satisfies Flipbook);
  store.put(keys.track('t1'), { id: 't1', uid: 's1', nodeId: 'copy', pageId: 'ui', createdAt: 10, actor });
  store.put(keys.flow('flow'), { id: 'flow', nodeId: 'flow-node', pageId: 'ui', title: 'Flow', uids: ['s1'], createdAt: 1, actor });
  if (confirmed) {
    queueGuiDelivery(store, 'b2', before, after, record);
    store.put(keys.gui('s1', 2), record);
    store.put(keys.screen('s1'), after);
  }
  let failure = '', fingerprint = 'fp2', copyVersion = 1;
  let copies = 0, syncs = 0;
  const posted: ToUi[] = [];
  const hit = (stage: string) => { if (failure === stage) throw new Error(`interrupted ${stage}`); };
  const host = {
    kv, actor, mode: 'GUI', pages: () => [{ id: 'gui', name: 'GUI' }, { id: 'ui', name: 'UI' }], post: (m: ToUi) => posted.push(m),
    tagSource: async () => {}, fingerprint: async () => ({ fingerprint, error: null }),
    scanCopies: async () => [{ nodeId: copyVersion === 1 ? 'copy' : 'new-copy', pageId: 'ui', uid: 's1', version: copyVersion, trackId: 't1', flipbookId: 'fb' }],
    markTracked: async () => {},
    updateCopies: async (items: CopyUpdate[]) => {
      hit('copies');
      if (failure === 'incomplete') return { updated: [], notes: ['missing source'] };
      copies++; copyVersion = 2;
      return { updated: items.flatMap(item => item.copies.map(copy => ({ trackId: copy.trackId, nodeId: 'new-copy' }))), notes: [] };
    },
    inspectFlipbooks: async () => ({ found: new Map([['fb', 'frame']]), spots: {} }), templateIssues: async () => [],
    syncFlipbook: async () => { hit('flipbook'); syncs++; return { nodeId: 'frame', notes: [], tracked: true }; },
    updateFlow: async () => { hit('flow'); return 1; },
    ensureDataPage: async () => 'data', renderData: async () => { hit('data'); },
  } as unknown as Host;
  return { store, kv, host, before, after, record, posted, fail: (stage: string) => { failure = stage; }, changeSource: () => { fingerprint = 'unpublished edit'; }, counts: () => ({ copies, syncs }) };
}

for (const stage of ['copies', 'flipbook', 'flow', 'data', 'incomplete']) test(`GUI ${stage} 중단 후 재실행은 버전·이력을 중복하지 않고 미완료 반영을 마친다`, async () => {
  const f = fixture();
  f.fail(stage);
  await new Controller(f.host).handle({ type: 'retry' });
  f.store.reload();
  assert.equal(f.store.state.deliveries.get(keys.guiDelivery('b2', 's1'))?.state, 'failed');
  assert.equal(f.store.state.gui.get('s1')?.length, 2);
  assert.ok(retryableDeliveries(f.store.state).length > 0);
  f.fail('');
  await new Controller(f.host).handle({ type: 'retry' });
  f.store.reload();
  assert.equal(f.store.state.deliveries.get(keys.guiDelivery('b2', 's1'))?.state, 'done');
  assert.equal(retryableDeliveries(f.store.state).length, 0);
  assert.equal(f.store.state.gui.get('s1')?.length, 2);
  assert.equal(f.store.state.imported.get('fb')?.length, 1);
  assert.equal(f.store.state.flipbooks.get('fb')?.screens[0].version, 2);
  assert.deepEqual(f.counts(), { copies: 1, syncs: 1 });
  assert.equal(f.store.state.deliveries.get(keys.guiDelivery('b2', 's1'))?.intent, undefined, 'completed jobs retain only a small summary');
});

for (const cut of ['gv:s1:2', 'scr:s1', 'bat:b2']) test(`commitPlan이 ${cut} 기록 직전에 종료되어도 저장한 의도로 재시도한다`, async () => {
  const f = fixture(false);
  const frame = { nodeId: 'source', pageId: 'gui', name: 'Home', width: 100, height: 100, screenTag: 's1', fingerprint: 'fp2', error: null };
  const [entry] = classify(f.store.state, [frame]);
  const draft = { ...defaultDraft('GUI', f.store.state, entry), included: true, workerId: 'w', tagId: 't', categoryId: 'c' };
  const plan = buildPlan('GUI', f.store.state, [entry], { [entry.key]: draft }, actor, 'b2');
  assert.deepEqual(plan.blockers, []);
  const set = f.kv.set;
  f.kv.set = (key, value) => { if (key === cut) throw new Error('closed'); set(key, value); };
  assert.throws(() => commitPlan(f.store, plan, { fingerprints: { [entry.key]: 'fp2' }, thumbs: {} }), /closed/);
  f.kv.set = set;
  assert.ok(new Store(f.kv).state.deliveries.has(keys.guiDelivery('b2', 's1')), 'write-ahead job precedes history and screen writes');
  await new Controller(f.host).handle({ type: 'retry' });
  f.store.reload();
  assert.equal(retryableDeliveries(f.store.state).length, 0);
  assert.equal(f.store.state.gui.get('s1')?.length, 2);
  assert.equal(f.store.state.screens.get('s1')?.guiVersion, 2);
  assert.equal(f.store.state.batches.get('b2')?.items.length, 1);
});

test('재시도 전 원본이 바뀌면 과거 버전 이름으로 미배포 내용을 복사하지 않는다', async () => {
  const f = fixture(); f.changeSource();
  f.store.put(keys.delivery('resume:b2', 'fb'), { batchId: 'resume:b2', kind: 'flipbook', targetId: 'fb', team: 'GUI', version: 2, state: 'failed', error: null, updatedAt: 0 } satisfies Delivery);
  await new Controller(f.host).handle({ type: 'retry' });
  f.store.reload();
  assert.equal(f.counts().copies, 0);
  assert.equal(f.counts().syncs, 0, 'force delivery cannot bypass the failed GUI safety check');
  assert.equal(f.store.state.deliveries.get(keys.guiDelivery('b2', 's1'))?.state, 'failed');
  assert.match(f.store.state.deliveries.get(keys.guiDelivery('b2', 's1'))?.error ?? '', /원본이 변경/);
});

test('미반영 재시도에서 여러 묶음이 같은 이유로 실패해도 안내 앞머리와 이유는 한 번만 쓴다', async () => {
  const f = fixture(); f.changeSource();
  queueGuiDelivery(f.store, 'b3', f.before, f.after, f.record);
  await new Controller(f.host).handle({ type: 'retry' });
  f.store.reload();
  assert.equal(f.store.state.deliveries.get(keys.guiDelivery('b2', 's1'))?.state, 'failed');
  assert.equal(f.store.state.deliveries.get(keys.guiDelivery('b3', 's1'))?.state, 'failed');
  const message = (f.posted.filter(m => m.type === 'error').pop() as { message: string }).message;
  assert.equal(message.split(COPY.recoveryPending).length - 1, 1);
  assert.equal(message.split(COPY.recoverySourceChanged).length - 1, 1);
  assert.ok(message.includes(`${COPY.recoverySourceChanged} (STB_HO_001)`), '원본이 바뀐 화면의 Screen ID를 함께 알린다');
});

test('사용 안 함·삭제된 플립북 26건은 집계와 재시도 대상 모두에서 제외하고 원기록은 보존한다', () => {
  const f = fixture(false);
  for (let i = 0; i < 26; i++) f.store.put(keys.delivery('old', `gone${i}`), { batchId: 'old', kind: 'flipbook', targetId: `gone${i}`, team: 'GUI', version: 1, state: 'applying', error: null, updatedAt: 0 } satisfies Delivery);
  assert.equal(retryableDeliveries(f.store.state).length, 0);
  assert.equal(toUiWire(f.store.state).deliveries.length, 0);
  assert.equal(f.store.state.deliveries.size, 26);
});

test('중단 후 다른 사용자가 수정한 Screen은 저장한 이전 의도로 덮어쓰지 않는다', () => {
  const f = fixture(false);
  queueGuiDelivery(f.store, 'b2', f.before, f.after, f.record);
  f.store.put(keys.screen('s1'), { ...f.before, rev: 9, name: 'Other user' });
  const job = f.store.state.deliveries.get(keys.guiDelivery('b2', 's1'))!;
  assert.throws(() => restoreGuiWrite(f.store, job), /덮어쓰지/);
  assert.equal(f.store.state.screens.get('s1')?.name, 'Other user');
});

test('같은 묶음의 원본 하나가 달라도 정상 화면은 완료하고 무관한 플립북은 반영하지 않는다', async () => {
  const f = fixture();
  const other: Screen = { ...f.after, id: 's2', code: 'STB_HO_002', source: { nodeId: 'source2', pageId: 'gui' } };
  const record: GuiRecord = { ...f.record, screenId: 's2', code: other.code, fingerprint: 'fp-other' };
  f.store.put(keys.screen('s2'), other);
  f.store.put(keys.gui('s2', 2), record);
  queueGuiDelivery(f.store, 'b2', other, other, record);
  const fb = f.store.state.flipbooks.get('fb')!;
  f.store.put(keys.flipbook('blocked-book'), { ...fb, id: 'blocked-book', screens: [{ uid: 's2', code: other.code, name: 'Other', version: 1 }] });
  const fingerprinted: string[] = [];
  f.host.fingerprint = async id => { fingerprinted.push(id); return { fingerprint: id === 'source' ? 'fp2' : 'unpublished', error: null }; };
  const synced: string[] = [];
  const sync = f.host.syncFlipbook;
  f.host.syncFlipbook = async (settings, view) => { synced.push(view.flipbookId); return sync(settings, view); };
  await new Controller(f.host).handle({ type: 'retry' });
  f.store.reload();
  assert.equal(f.store.state.deliveries.get(keys.guiDelivery('b2', 's1'))?.state, 'done');
  assert.equal(f.store.state.deliveries.get(keys.guiDelivery('b2', 's2'))?.state, 'failed');
  assert.deepEqual(synced, ['fb']);
  assert.equal(f.store.state.flipbooks.get('blocked-book')?.screens[0].version, 1);
  assert.deepEqual(fingerprinted.sort(), ['source', 'source2']);
  assert.equal(retryableDeliveries(f.store.state).length, 1);
});

test('한 플립북의 이전 형식 오류는 다른 화면의 복구 완료를 막지 않는다', async () => {
  const f = fixture();
  const other: Screen = { ...f.after, id: 's2', code: 'STB_HO_002', source: { nodeId: 'source2', pageId: 'gui' } };
  const record: GuiRecord = { ...f.record, screenId: 's2', code: other.code };
  f.store.put(keys.screen('s2'), other);
  f.store.put(keys.gui('s2', 2), record);
  queueGuiDelivery(f.store, 'b2', other, other, record);
  const fb = f.store.state.flipbooks.get('fb')!;
  f.store.put(keys.flipbook('legacy'), { ...fb, id: 'legacy', screens: [{ uid: 's2', code: other.code, name: 'Other', version: 1 }] });
  const scan = f.host.scanCopies!;
  f.host.scanCopies = async (...args) => [...await scan(...args), { nodeId: 'legacy-copy', pageId: 'ui', uid: 's2', version: 2, trackId: 't2', flipbookId: 'legacy' }];
  const sync = f.host.syncFlipbook;
  f.host.syncFlipbook = async (settings, view) => {
    if (view.flipbookId === 'legacy') throw new Error('이전 형식 플립북');
    return sync(settings, view);
  };
  await new Controller(f.host).handle({ type: 'retry' });
  f.store.reload();
  assert.equal(f.store.state.deliveries.get(keys.guiDelivery('b2', 's1'))?.state, 'done');
  assert.equal(f.store.state.deliveries.get(keys.guiDelivery('b2', 's2'))?.state, 'failed');
  assert.equal(f.store.state.deliveries.get(keys.delivery('resume:pending', 'legacy'))?.state, 'failed');
});

test('같은 화면의 과거 복구 기록 여럿은 원본·복사본·플립북을 한 번만 읽어 완료한다', async () => {
  const f = fixture();
  for (let i = 0; i < 20; i++) queueGuiDelivery(f.store, `old-${i}`, f.before, f.after, f.record);
  let fingerprints = 0;
  f.host.fingerprint = async () => { fingerprints++; return { fingerprint: 'fp2', error: null }; };
  await new Controller(f.host).handle({ type: 'retry' });
  f.store.reload();
  assert.equal(retryableDeliveries(f.store.state).length, 0);
  assert.equal(fingerprints, 1);
  assert.deepEqual(f.counts(), { copies: 1, syncs: 1 });
});

test('상단 배너의 재시도는 남은 작업이 없으면 화면 전체를 다시 맞추지 않는다', async () => {
  const f = fixture(false);
  let fingerprints = 0;
  f.host.fingerprint = async () => { fingerprints++; return { fingerprint: 'fp1', error: null }; };
  await new Controller(f.host).handle({ type: 'retry' });
  f.store.reload();
  assert.equal(fingerprints, 0);
  assert.equal(f.store.state.deliveries.size, 0);
  assert.deepEqual(f.counts(), { copies: 0, syncs: 0 });
  assert.equal((f.posted.filter(m => m.type === 'notice').pop() as { message: string }).message, COPY.controller007);
});

test('관리의 전체 점검은 배포 뒤 원본을 고친 화면을 미완료로 남기지 않는다', async () => {
  const f = fixture(false);
  const other: Screen = { ...f.before, id: 's2', code: 'STB_HO_002', source: { nodeId: 'source2', pageId: 'gui' } };
  f.store.put(keys.screen('s2'), other);
  f.store.put(keys.gui('s2', 1), { ...f.record, screenId: 's2', version: 1, batchId: 'b1', code: other.code, fingerprint: 'fp-s2' });
  f.store.put(keys.track('t2'), { id: 't2', uid: 's2', nodeId: 'copy2', pageId: 'ui', createdAt: 10, actor });
  // s1은 배포(fp1) 뒤 원본을 고쳤고 s2는 배포 때 그대로다.
  f.host.fingerprint = async id => ({ fingerprint: id === 'source2' ? 'fp-s2' : 'next version', error: null });
  await new Controller(f.host).handle({ type: 'retry', reconcile: true });
  f.store.reload();
  const gui = [...f.store.state.deliveries.values()].filter(d => d.kind === 'gui');
  assert.deepEqual(gui.map(d => [d.targetId, d.state]), [['s2', 'done']]);
  assert.equal(retryableDeliveries(f.store.state).length, 0);
  assert.ok(!(f.posted.filter(m => m.type === 'error').pop() as { message: string } | undefined)?.message.includes(COPY.recoverySourceChanged));
});

test('남은 작업이 있으면 관리에서 눌러도 전체 점검 없이 그 작업만 반영한다', async () => {
  const f = fixture();
  const other: Screen = { ...f.before, id: 's2', code: 'STB_HO_002', source: { nodeId: 'source2', pageId: 'gui' } };
  f.store.put(keys.screen('s2'), other);
  f.store.put(keys.gui('s2', 1), { ...f.record, screenId: 's2', version: 1, batchId: 'b1', code: other.code, fingerprint: 'fp-s2' });
  f.store.put(keys.track('t2'), { id: 't2', uid: 's2', nodeId: 'copy2', pageId: 'ui', createdAt: 10, actor });
  const fingerprinted: string[] = [];
  f.host.fingerprint = async id => { fingerprinted.push(id); return { fingerprint: 'fp2', error: null }; };
  await new Controller(f.host).handle({ type: 'retry', reconcile: true });
  f.store.reload();
  assert.deepEqual(fingerprinted, ['source']);
  assert.ok(![...f.store.state.deliveries.keys()].some(key => key.includes('reconcile:')));
});

test('이전 전체 점검이 남긴 원본 변경 실패는 건수·재시도 대상에서 빼고 원기록은 보존한다', () => {
  const f = fixture(false);
  f.store.put(keys.guiDelivery('reconcile:old', 's1'), { batchId: 'reconcile:old', kind: 'gui', targetId: 's1', team: 'GUI', version: 1, state: 'failed', error: COPY.recoverySourceChanged, updatedAt: 0 } satisfies Delivery);
  f.store.put(keys.guiDelivery('reconcile:old', 's9'), { batchId: 'reconcile:old', kind: 'gui', targetId: 's9', team: 'GUI', version: 1, state: 'failed', error: 'copy failed', updatedAt: 0 } satisfies Delivery);
  f.store.put(keys.guiDelivery('b2', 's1'), { batchId: 'b2', kind: 'gui', targetId: 's1', team: 'GUI', version: 2, state: 'failed', error: COPY.recoverySourceChanged, updatedAt: 0 } satisfies Delivery);
  assert.deepEqual(retryableDeliveries(f.store.state).map(d => `${d.batchId}:${d.targetId}`).sort(), ['b2:s1', 'reconcile:old:s9']);
  assert.equal(f.store.state.deliveries.size, 3);
});

test('원본이 바뀐 화면이 없는 대기 플립북은 다른 화면의 실패와 상관없이 반영한다', async () => {
  const f = fixture(); f.changeSource();
  const fb = f.store.state.flipbooks.get('fb')!;
  const other: Screen = { ...f.before, id: 's2', code: 'STB_HO_002', source: { nodeId: 'source2', pageId: 'gui' } };
  f.store.put(keys.screen('s2'), other);
  f.store.put(keys.flipbook('other'), { ...fb, id: 'other', title: 'Other', screens: [{ uid: 's2', code: other.code, name: 'Other', version: 1 }] });
  for (const id of ['fb', 'other']) f.store.put(keys.delivery('old', id), { batchId: 'old', kind: 'flipbook', targetId: id, team: 'UI', version: 1, state: 'failed', error: null, updatedAt: 0 } satisfies Delivery);
  const synced: string[] = [];
  f.host.syncFlipbook = async (_settings, view) => { synced.push(view.flipbookId); return { nodeId: 'frame', notes: [], tracked: true }; };
  await new Controller(f.host).handle({ type: 'retry' });
  f.store.reload();
  assert.deepEqual(synced, ['other']);
  assert.equal(f.store.state.deliveries.get(keys.delivery('old', 'other'))?.state, 'done');
  assert.equal(f.store.state.deliveries.get(keys.delivery('old', 'fb'))?.state, 'failed');
  const message = (f.posted.filter(m => m.type === 'error').pop() as { message: string }).message;
  assert.ok(message.includes(`${COPY.recoveryFlipbooksHeld} (Home)`));
});

test('미반영 재시도는 원본 확인 개수와 단계를 진행 표시로 알린다', async () => {
  const f = fixture();
  await new Controller(f.host).handle({ type: 'retry' });
  const labels = f.posted.filter(m => m.type === 'busy').map(m => (m as { label: string | null }).label);
  assert.equal(labels[0], COPY.recoveryRunning);
  for (const label of [`${COPY.recoveryChecking} 1/1`, COPY.recoveryCopies, COPY.recoveryFlows, COPY.controller005]) assert.ok(labels.includes(label), label);
});

test('미완료 목록은 같은 대상의 기록을 한 줄로 묶고 최근 상태를 이유로 쓴다', () => {
  const f = fixture(false);
  f.store.put(keys.guiDelivery('a', 's1'), { batchId: 'a', kind: 'gui', targetId: 's1', team: 'GUI', version: 1, state: 'applying', error: null, updatedAt: 1 } satisfies Delivery);
  f.store.put(keys.guiDelivery('b', 's1'), { batchId: 'b', kind: 'gui', targetId: 's1', team: 'GUI', version: 1, state: 'failed', error: 'boom', updatedAt: 2 } satisfies Delivery);
  f.store.put(keys.delivery('c', 'fb'), { batchId: 'c', kind: 'flipbook', targetId: 'fb', team: 'GUI', version: 1, state: 'pending', error: null, updatedAt: 0 } satisfies Delivery);
  assert.deepEqual(pendingRows(f.store.state), [
    { key: 'flipbook:fb', kind: 'flipbook', name: 'Home', reason: COPY.recoveryStoppedBefore, count: 1 },
    { key: 'gui:s1', kind: 'gui', name: 'STB_HO_001 Home', reason: 'boom', count: 2 },
  ]);
});

test('화면 반영 건너뛰기로 확정한 화면은 붙인 화면의 레이어를 복사하지 않고 표식만 바꾸며 플립북은 반영한다', async () => {
  const f = fixture(false);
  // 건너뛰기는 지난 버전과 원본이 같을 때만 기록된다.
  f.store.put(keys.gui('s1', 1), { ...f.record, version: 1, batchId: 'b1', committedAt: 1 });
  const record = { ...f.record, skipLayers: true };
  queueGuiDelivery(f.store, 'b2', f.before, f.after, record);
  f.store.put(keys.gui('s1', 2), record);
  f.store.put(keys.screen('s1'), f.after);
  const retagged: CopyUpdate[] = [];
  (f.host as { retagCopies?: Host['retagCopies'] }).retagCopies = async items => {
    retagged.push(...items);
    return { updated: items.flatMap(item => item.copies.map(copy => ({ trackId: copy.trackId, nodeId: copy.nodeId }))), notes: [] };
  };
  await new Controller(f.host).handle({ type: 'retry' });
  f.store.reload();
  assert.equal(f.store.state.deliveries.get(keys.guiDelivery('b2', 's1'))?.state, 'done');
  assert.deepEqual(retagged.map(item => [item.key, item.copies.map(c => c.nodeId)]), [['s1@2', ['copy']]]);
  assert.deepEqual(f.counts(), { copies: 0, syncs: 1 });
  assert.equal(f.store.state.flipbooks.get('fb')?.screens[0].version, 2);
  assert.equal(f.store.state.imported.get('fb')?.length, 1, '히스토리는 남긴다');
});

test('화면 반영 건너뛰기여도 새 버전과 내용이 다른 버전의 복사본은 레이어를 새로 복사한다', async () => {
  const f = fixture(false);
  // v2 반영이 복사본에 닿지 않아 복사본은 v1(fp1) 내용이다. v3는 v2(fp2)와 같아 건너뛰기로 확정했다.
  f.store.put(keys.gui('s1', 2), f.record);
  const record = { ...f.record, version: 3, batchId: 'b3', skipLayers: true };
  const after = { ...f.after, guiVersion: 3, rev: 3 };
  queueGuiDelivery(f.store, 'b3', { ...f.after }, after, record);
  f.store.put(keys.gui('s1', 3), record);
  f.store.put(keys.screen('s1'), after);
  const retagged: CopyUpdate[] = [];
  (f.host as { retagCopies?: Host['retagCopies'] }).retagCopies = async items => {
    retagged.push(...items);
    return { updated: items.flatMap(item => item.copies.map(copy => ({ trackId: copy.trackId, nodeId: copy.nodeId }))), notes: [] };
  };
  await new Controller(f.host).handle({ type: 'retry' });
  f.store.reload();
  assert.equal(f.store.state.deliveries.get(keys.guiDelivery('b3', 's1'))?.state, 'done');
  assert.deepEqual(retagged, []);
  assert.equal(f.counts().copies, 1);
});

test('원본 변경이 없는 배포에서만 화면 반영 건너뛰기를 고를 수 있고 지난 버전과 지문이 같은 화면만 기록한다', () => {
  for (const [fingerprint, unchanged] of [['fp1', true], ['fp-new', false]] as const) {
    const f = fixture(false);
    f.store.put(keys.gui('s1', 1), { ...f.record, version: 1, batchId: 'b1', fingerprint: 'fp1', fpVersion: FINGERPRINT_VERSION, committedAt: 1 });
    const frame = { nodeId: 'source', pageId: 'gui', name: 'Home', width: 100, height: 100, screenTag: 's1', fingerprint, error: null };
    const [entry] = classify(f.store.state, [frame]);
    const draft = { ...defaultDraft('GUI', f.store.state, entry), included: true, workerId: 'w', tagId: 't', categoryId: 'c', name: 'Home 2' };
    const plan = buildPlan('GUI', f.store.state, [entry], { [entry.key]: draft }, actor, 'b2');
    assert.deepEqual(plan.blockers, []);
    assert.equal(!!plan.layersUnchanged, unchanged);
    plan.skipLayers = true;
    commitPlan(f.store, plan, { fingerprints: { [entry.key]: fingerprint }, thumbs: {} });
    assert.equal(!!f.store.state.gui.get('s1')?.find(r => r.version === 2)?.skipLayers, unchanged);
  }
});
