import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Controller, type Host } from '../src/controller.ts';
import type { FlipbookSpot } from '../src/core/compare.ts';
import { planFlipbooks } from '../src/core/flipbooks.ts';
import { keys, memoryKV, Store } from '../src/core/store.ts';
import type { ToUi } from '../src/core/wire.ts';

async function setup(pageCount = 3) {
  const actor = { id: 'u', name: 'Designer' };
  const store = new Store(memoryKV());
  const pages = Array.from({ length: pageCount }, (_, i) => ({ id: `p${i}`, name: `UI ${i}` }));
  store.saveProject({ ...store.state.project, templateNodeId: 'tpl', flipbookPageId: 'p0', flipbookPageIds: pages.map(p => p.id) });
  const frames = new Map<string, { nodeId: string; spot: FlipbookSpot }>();
  for (const page of pages) {
    const [fb] = planFlipbooks({ pageId: page.id, rows: [{ uids: [], multi: false, scale: 1, title: page.name }] }, new Map(), actor, 100, () => `fb:${page.id}`);
    store.put(keys.flipbook(fb.id), fb);
    frames.set(fb.id, { nodeId: `n:${fb.id}`, spot: { pageId: page.id, section: fb.category.key, sectionIndex: 0, index: 0 } });
  }
  const reads: string[][] = [], posted: ToUi[] = [], writes: string[] = [];
  const host = {
    kv: store.kv, actor, mode: 'UI', pages: () => pages, post: (msg: ToUi) => posted.push(msg),
    templateIssues: async () => [],
    inspectFlipbooks: async (pageIds: string[], originalsOnly?: boolean) => {
      reads.push([...pageIds]);
      if (pageIds.length < pages.length) assert.equal(originalsOnly, true, '부분 조회는 다른 페이지 원본 대신 복사본을 채택하지 않는다');
      const selected = [...frames].filter(([, frame]) => pageIds.includes(frame.spot.pageId!));
      return { found: new Map(selected.map(([id, frame]) => [id, frame.nodeId])), spots: Object.fromEntries(selected.map(([, frame]) => [frame.nodeId, { ...frame.spot }])) };
    },
    syncFlipbook: async (settings: { pageId: string }, view: { flipbookId: string; category: { key: string } }) => {
      const frame = { nodeId: `n:${view.flipbookId}`, spot: { pageId: settings.pageId, section: view.category.key, sectionIndex: 0, index: 1 } };
      frames.set(view.flipbookId, frame);
      return { nodeId: frame.nodeId, notes: [] };
    },
    uiFingerprint: async () => ({ fingerprint: 'initial', error: null }),
    moveFlipbook: async (move: { flipbookId: string; pageId: string; category: { key: string } }) => {
      frames.get(move.flipbookId)!.spot = { pageId: move.pageId, section: move.category.key, sectionIndex: 0, index: 1 };
      return true;
    },
  } as unknown as Host;
  const controller = new Controller(host);
  await controller.handle({ type: 'ready' });
  const scans = () => {
    const msg = posted.filter((msg): msg is Extract<ToUi, { type: 'uiScan' }> => msg.type === 'uiScan').pop();
    assert.ok(msg);
    return msg.scans;
  };
  assert.ok(!posted.some(msg => msg.type === 'error'));
  reads.length = 0; writes.length = 0;
  return { controller, host, store, frames, reads, posted, writes, scans };
}

for (const pageCount of [3, 30]) {
  test(`creation reads only its page and preserves unrelated links and positions (${pageCount} pages)`, async () => {
    const { controller, frames, reads, posted, scans } = await setup(pageCount);
    const before = scans().filter(scan => scan.spot?.pageId !== 'p0');
    frames.get('fb:p0')!.spot.index = 2;
    await controller.handle({ type: 'createFlipbooks', request: { pageId: 'p0', rows: [{ uids: [], multi: false, scale: 1, title: 'New' }] } });
    assert.deepEqual(reads, [['p0']]);
    assert.deepEqual(scans().filter(scan => scan.spot?.pageId !== 'p0'), before);
    assert.equal(scans().find(scan => scan.flipbookId === 'fb:p0')?.spot?.index, 2);
    const result = posted.find((msg): msg is Extract<ToUi, { type: 'flipbooksCreated' }> => msg.type === 'flipbooksCreated');
    assert.ok(result?.ids.length === 1);
    assert.equal(scans().find(scan => scan.flipbookId === result.ids[0])?.fingerprint, 'initial');
    assert.ok(!posted.some(msg => msg.type === 'error'));
  });
}

test('moving reads only the source and destination pages and preserves other pages', async () => {
  const { controller, reads, scans } = await setup();
  const before = scans().find(scan => scan.flipbookId === 'fb:p2');
  const fb = controller.store.state.flipbooks.get('fb:p0')!;
  await controller.handle({ type: 'createFlipbooks', request: { pageId: 'p0', rows: [], moves: [{ flipbookId: fb.id, pageId: 'p1', section: fb.category, after: null }] } });
  assert.deepEqual(reads, [['p0', 'p1']]);
  assert.equal(scans().find(scan => scan.flipbookId === fb.id)?.spot?.pageId, 'p1');
  assert.deepEqual(scans().find(scan => scan.flipbookId === 'fb:p2'), before);
});

for (const withFrames of [false, true]) {
  test(`deletion changes registration without any canvas reads or writes (withFrames=${withFrames})`, async () => {
    const { controller, host, reads, writes, scans, posted } = await setup(30);
    const before = scans().filter(scan => scan.flipbookId !== 'fb:p0');
    host.listFlipbooks = async () => { throw new Error('unexpected list read'); };
    host.flipbookSpots = async () => { throw new Error('unexpected position read'); };
    host.scanCopies = async () => { throw new Error('unexpected GUI scan'); };
    await controller.handle({ type: 'removeFlipbooks', ids: ['fb:p0'], withFrames });
    assert.deepEqual(reads, []);
    assert.deepEqual(writes, []);
    assert.equal(controller.store.state.flipbooks.get('fb:p0')?.status, 'deleted');
    assert.deepEqual(scans(), before);
    assert.ok(posted.some(msg => msg.type === 'flipbooksRemoved' && msg.ids.includes('fb:p0')));
    assert.ok(!posted.some(msg => msg.type === 'error'));
  });
}
