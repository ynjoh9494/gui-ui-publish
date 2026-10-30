import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Controller } from '../src/controller.ts';
import { classify } from '../src/core/compare.ts';
import { defaultDraft } from '../src/core/drafts.ts';
import { queueGuiDelivery, restoreGuiWrite, retryableDeliveries } from '../src/core/guiDelivery.ts';
import { buildPlan, commitPlan } from '../src/core/publish.ts';
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
