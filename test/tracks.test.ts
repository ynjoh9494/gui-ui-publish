import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flipbookView, screenTags } from '../src/core/flipbook.ts';
import { importGuiUpdates, markReviewed, unreviewed } from '../src/core/flipbooks.ts';
import { ensureSystemTags, systemTagId } from '../src/core/registry.ts';
import type { GuiRecordInfo, GuiScreenInfo } from '../src/core/guiScreens.ts';
import { keys, memoryKV, Store } from '../src/core/store.ts';
import { dismissDeletedAlert, flagRetiredScreens, trackCounts, type FoundCopy } from '../src/core/tracks.ts';
import { COPY } from '../src/core/copy.ts';
import type { Flipbook, Screen, TrackRecord } from '../src/core/types.ts';
import type { CopyUpdate, Host } from '../src/host.ts';
import { TrackController } from '../src/trackController.ts';

// 추적 GUI(2026-10-29): 배포하면 붙인 화면을 모두 바꾸고, 그 순간 새 템플릿 플립북 안에 있는 화면이 그 플립북의 이력을 받는다.
const actor = { id: 'u', name: 'Designer' };
const tag = { id: 't', name: '변경', color: '#00ff00', colorKey: 'Green' };

function screenRecord(id: string, code: string, guiVersion: number, status: 'active' | 'deleted' = 'active'): Screen {
  return { id, rev: 1, code, name: `화면 ${id}`, categoryId: null, baseScreenId: null, status, source: { nodeId: `src-${id}`, pageId: 'gui' } as Screen['source'], guiVersion, guiTag: null, createdAt: 1 };
}
const info = (uid: string, code: string, version: number): GuiScreenInfo => ({
  uid, code, name: `화면 ${uid}`, category: null, status: 'active', isCase: false, version, thumb: null, sourceNodeId: `src-${uid}`,
});
const record = (uid: string, code: string, version: number): GuiRecordInfo => ({
  batchId: `b${version}`, uid, code, version, name: `화면 ${uid}`, workType: 'changed', tag, description: `GUI v${version}`,
  original: `GUI v${version}`, corrected: false, worker: 'Designer', committedAt: version * 1000,
});
function flipbook(id: string, pageId: string, screens: Flipbook['screens'] = []): Flipbook {
  return { id, rev: 1, kind: 'single', title: '새 플립북', autoTitle: true, titleNames: ['새 플립북'], scale: 1, category: { key: 'c', name: 'C', order: 0 }, screens, pageId, status: 'active', createdAt: 500, actor, tracked: true };
}

function setup(found: FoundCopy[]) {
  let clock = 5000, seq = 0;
  const store = new Store(memoryKV(), () => clock, () => `id${++seq}`);
  const calls = { scans: [] as string[][], updates: [] as CopyUpdate[], marks: [] as { nodeId: string; trackId: string }[] };
  const host = {
    actor,
    scanCopies: async (pages: string[]) => { calls.scans.push(pages); return found; },
    updateCopies: async (items: CopyUpdate[]) => {
      calls.updates.push(...items);
      return { updated: items.flatMap(i => i.copies.map(c => ({ trackId: c.trackId, nodeId: `${c.nodeId}-new` }))), notes: [] };
    },
    markTracked: async (items: { nodeId: string; trackId: string }[]) => { calls.marks.push(...items); },
  } as unknown as Host;
  return { store, host, calls, tracks: new TrackController(store, host), tick: (t: number) => { clock = t; } };
}

test('배포하면 바뀐 화면의 추적 GUI를 모두 바꾸고, 그 순간 플립북 안에 있는 화면이 그 플립북의 이력을 받는다', async () => {
  const found: FoundCopy[] = [
    { nodeId: 'n1', pageId: 'p1', uid: 's1', version: 1, trackId: 't1', flipbookId: 'fb' },
    // 캔버스에서 복제한 복사본(같은 trackOf, 다른 노드)
    { nodeId: 'n2', pageId: 'p1', uid: 's1', version: 1, trackId: 't1', flipbookId: null },
    // 삭제된 화면의 복사본은 표식이 남아 있어도 추적하지 않는다.
    { nodeId: 'n3', pageId: 'p1', uid: 's2', version: 1, trackId: '', flipbookId: 'fb' },
  ];
  const { store, calls, tracks } = setup(found);
  store.put(keys.screen('s1'), screenRecord('s1', 'STB_HO_001', 2));
  store.put(keys.screen('s2'), screenRecord('s2', 'STB_HO_002', 1, 'deleted'));
  store.put(keys.flipbook('fb'), flipbook('fb', 'p1'));
  store.put(keys.track('t1'), { id: 't1', uid: 's1', nodeId: 'n1', pageId: 'p1', createdAt: 600, actor } satisfies TrackRecord);
  store.put(keys.track('t9'), { id: 't9', uid: 's1', nodeId: 'gone', pageId: 'p1', createdAt: 600, actor } satisfies TrackRecord);

  const message = await tracks.publish(new Set(['s1']));
  assert.deepEqual(calls.scans, [['p1']], 'reads the pages of the tracks and of tracked flipbooks');
  assert.deepEqual(calls.updates.map(u => [u.uid, u.key, u.sourceNodeId, u.copies.map(c => c.nodeId)]), [['s1', 's1@2', 'src-s1', ['n1', 'n2']]]);
  const tracksNow = [...store.state.tracks.values()];
  assert.equal(store.state.tracks.get('t1')?.nodeId, 'n1-new');
  assert.equal(store.state.tracks.has('t9'), false, 'a track whose node is gone is dropped');
  const duplicate = tracksNow.find(t => t.nodeId === 'n2-new')!;
  assert.ok(duplicate && duplicate.id !== 't1', 'the duplicate gets its own track');
  assert.deepEqual(calls.marks, [{ nodeId: 'n2', trackId: duplicate.id }]);
  assert.equal(tracksNow.some(t => t.uid === 's2'), false);
  assert.match(message!, /2/);

  // 플립북 안의 복사본이 들어온 시각(추적 기록) 뒤의 배포를 이력으로 쌓고 확인 필요가 된다.
  const fb = store.state.flipbooks.get('fb')!;
  assert.deepEqual(fb.screens.map(s => [s.uid, s.version, s.addedAt]), [['s1', 1, 600]]);
  assert.equal(fb.title, '화면 s1', 'auto title follows the member');
  importGuiUpdates(store, 'fb', new Map([['s1', info('s1', 'STB_HO_001', 2)]]), [record('s1', 'STB_HO_001', 2)]);
  assert.deepEqual(unreviewed(store.state, 'fb').map(r => [r.uid, r.version]), [['s1', 2]]);
});

test('목록 새로고침은 플립북 안의 화면을 ID 이름순으로 맞추고, 넣고 빼기는 이력을 만들지 않는다', async () => {
  const found: FoundCopy[] = [
    { nodeId: 'b', pageId: 'p1', uid: 's2', version: 3, trackId: '', flipbookId: 'fb' },
    { nodeId: 'a', pageId: 'p1', uid: 's1', version: 1, trackId: '', flipbookId: 'fb' },
  ];
  const { store, tracks, tick } = setup(found);
  store.put(keys.screen('s1'), screenRecord('s1', 'STB_HO_001', 1));
  store.put(keys.screen('s2'), screenRecord('s2', 'STB_HO_002', 3));
  store.put(keys.screen('s3'), screenRecord('s3', 'STB_HO_003', 1));
  store.put(keys.flipbook('fb'), flipbook('fb', 'p1', [{ uid: 's3', code: 'STB_HO_003', name: '화면 s3', version: 1 }]));
  tick(7000);
  assert.deepEqual(await tracks.refresh(), ['fb']);
  const fb = store.state.flipbooks.get('fb')!;
  assert.deepEqual(fb.screens.map(s => [s.code, s.version, s.addedAt]), [['STB_HO_001', 1, 7000], ['STB_HO_002', 3, 7000]], 's3 moved out, s1·s2 moved in');
  assert.equal(fb.kind, 'multi');
  assert.equal(store.state.tracks.size, 2, 'copies found on the flipbook page are tracked');
  // 들어온 뒤의 배포가 없으므로 확인할 것이 없다.
  importGuiUpdates(store, 'fb', new Map([['s1', info('s1', 'STB_HO_001', 1)], ['s2', info('s2', 'STB_HO_002', 3)]]), [record('s2', 'STB_HO_002', 3)]);
  assert.deepEqual(unreviewed(store.state, 'fb'), []);
  assert.deepEqual(await tracks.refresh(), [], 'same canvas changes nothing');
});

test('GUI 붙이기는 추적 기록을 만들고, 새 템플릿 플립북 안에 붙이면 그 페이지의 플립북만 화면 목록을 다시 읽는다', async () => {
  const found: FoundCopy[] = [{ nodeId: 'np', pageId: 'p1', uid: 's1', version: 2, trackId: 'id1', flipbookId: 'fb' }];
  const { store, host, calls, tracks, tick } = setup(found);
  const pasted: unknown[] = [];
  Object.assign(host, { pasteGui: async (item: unknown, at: unknown) => { pasted.push([item, at]); return { nodeId: 'np', pageId: 'p1', flipbookId: 'fb', notes: [] }; } });
  store.put(keys.screen('s1'), screenRecord('s1', 'STB_HO_001', 2));
  store.put(keys.screen('s2'), screenRecord('s2', 'STB_HO_002', 0));
  store.put(keys.flipbook('fb'), flipbook('fb', 'p1'));
  // 다른 페이지의 플립북은 이번에 읽지 않았으므로 화면 목록을 건드리지 않는다.
  store.put(keys.flipbook('fb2'), flipbook('fb2', 'p2', [{ uid: 's1', code: 'STB_HO_001', name: '화면 s1', version: 1 }]));
  store.put(keys.flow('f1'), { id: 'f1', nodeId: 'flow', pageId: 'p3', title: '흐름', uids: ['s1', 's1'], createdAt: 1, actor });
  tick(9000);

  const result = await tracks.paste('s1', 0.5, { nodeId: 'frame', x: 10, y: 20 });
  assert.deepEqual(pasted, [[{ key: 's1@2', code: 'STB_HO_001', sourceNodeId: 'src-s1', trackId: 'id1', scale: 0.5, maxWidth: 1440 }, { nodeId: 'frame', x: 10, y: 20 }]]);
  assert.deepEqual(result, { changed: ['fb'], notes: [] });
  assert.deepEqual([...store.state.tracks.values()].map(t => [t.id, t.uid, t.nodeId, t.pageId, t.createdAt]), [['id1', 's1', 'np', 'p1', 9000]]);
  assert.deepEqual(calls.scans, [['p1']], 'reads only the page it pasted on');
  assert.deepEqual(calls.marks, [], 'the copy already carries its track ID');
  assert.deepEqual(store.state.flipbooks.get('fb')!.screens.map(s => [s.uid, s.version, s.addedAt]), [['s1', 2, 9000]], 'putting a screen in makes no history');
  assert.deepEqual(store.state.flipbooks.get('fb2')!.screens.map(s => s.uid), ['s1']);
  assert.deepEqual([...trackCounts(store.state)], [['s1', 2]], 'tracked copies and flows that hold the screen, each flow once');

  await assert.rejects(tracks.paste('s2', 1, null), { message: COPY.track003 }, 'a screen with no published GUI is not pasted');
});

test('추적 목록은 그 화면의 추적 GUI를 경로로 보여 주고, 지운 것은 묻지 않고 빼며, 다른 페이지로 옮긴 것은 기록의 페이지를 고친다', async () => {
  const { store, host, tracks } = setup([]);
  const live = new Map([
    ['n1', { pageId: 'p1', pageName: 'Flipbook', sections: ['Home'], flipbook: { id: 'fb', name: '프레임 이름' } }],
    ['n2', { pageId: 'p9', pageName: '회의', sections: [], flipbook: null }],
  ]);
  Object.assign(host, { nodePlaces: async (items: { nodeId: string }[]) => items.map(i => live.get(i.nodeId) ?? null) });
  store.put(keys.screen('s1'), screenRecord('s1', 'STB_HO_001', 2));
  store.put(keys.flipbook('fb'), { ...flipbook('fb', 'p1'), title: '홈 화면' });
  for (const [id, nodeId, createdAt] of [['t1', 'n1', 1], ['t2', 'n2', 2], ['t3', 'gone', 3]] as const)
    store.put(keys.track(id), { id, uid: 's1', nodeId, pageId: 'p1', createdAt, actor } satisfies TrackRecord);

  const listed = await tracks.places('s1');
  assert.deepEqual(listed, { items: [{ kind: 'screen', id: 't1', path: ['Flipbook', 'Home', '홈 화면'] }, { kind: 'screen', id: 't2', path: ['회의'] }], removed: 1 }, 'a flipbook shows its title');
  assert.equal(store.state.tracks.has('t3'), false);
  assert.equal(store.state.tracks.get('t2')?.pageId, 'p9', 'publishes read the page it moved to');
  assert.equal(await tracks.find('t1'), 'n1');
  live.delete('n1');
  assert.equal(await tracks.find('t1'), null, 'a copy deleted after the list opened is dropped when clicked');
  assert.equal(store.state.tracks.has('t1'), false);
});

test('기본 태그 「최신」은 「현행」으로 바뀌고, 새 템플릿 플립북은 만든 뒤 받은 기록이 없으면 「작성 전」, 화면 태그는 가장 최근 GUI 배포로 바뀐 화면에만 붙는다', () => {
  const { store } = setup([]);
  // 이미 쓰는 파일의 기본 태그(이전 이름 「최신」)도 이름이 바뀐다.
  store.put(keys.tag('old'), { id: 'old', team: 'UI', name: '최신', colorKey: 'Black', color: '#333333', active: true, system: 'latest' });
  assert.equal(ensureSystemTags(store, actor), true);
  const tag = (kind: 'draft' | 'latest') => store.state.tags.get(systemTagId(store.state, kind)!)!;
  assert.deepEqual([tag('latest').id, tag('latest').name, tag('draft').name, tag('draft').colorKey, tag('draft').team], ['old', '현행', '작성 전', 'Blue', 'UI']);
  assert.equal(ensureSystemTags(store, actor), false);

  store.put(keys.screen('s1'), screenRecord('s1', 'STB_HO_001', 2));
  store.put(keys.screen('s2'), screenRecord('s2', 'STB_HO_002', 1));
  store.put(keys.flipbook('fb'), flipbook('fb', 'p1', [{ uid: 's1', code: 'STB_HO_001', name: '화면 s1', version: 1 }, { uid: 's2', code: 'STB_HO_002', name: '화면 s2', version: 1 }]));
  assert.equal(flipbookView(store.state, 'fb').status?.tag.name, '작성 전');
  assert.equal(flipbookView(store.state, 'fb').rows.length, 0, '작성 전 is a status, not a history row');
  assert.equal(screenTags(store.state, 'fb').size, 0);
  importGuiUpdates(store, 'fb', new Map([['s1', info('s1', 'STB_HO_001', 2)], ['s2', info('s2', 'STB_HO_002', 1)]]), [record('s1', 'STB_HO_001', 2)]);
  assert.equal(flipbookView(store.state, 'fb').status?.tag.name, '변경');
  assert.deepEqual([...screenTags(store.state, 'fb')].map(([uid, t]) => [uid, t.name]), [['s1', '변경']], 'only the screen the latest publish changed');
  markReviewed(store, [{ flipbookId: 'fb', tagId: tag('latest').id, comment: '' }], actor, 'r1');
  assert.equal(flipbookView(store.state, 'fb').status?.tag.name, '현행');
  assert.equal(screenTags(store.state, 'fb').size, 0, 'a UI status tag goes on no screen');
  // 이전 템플릿 플립북은 지금처럼 마지막 기록이다(기록이 없으면 비어 있다).
  store.put(keys.flipbook('old'), { ...flipbook('old', 'p1'), tracked: false });
  assert.equal(flipbookView(store.state, 'old').status, null);
});

test('사용 안 함이 된 화면이 든 새 템플릿 플립북은 그 화면을 빼고 알림을 켜며, 확인하면 알림을 지운다. 플립북을 고르면 그 페이지만 읽는다', async () => {
  const { store, tracks, calls } = setup([]);
  store.put(keys.flipbook('fb'), flipbook('fb', 'p1', [{ uid: 's1', code: 'STB_HO_001', name: '화면 s1', version: 1 }, { uid: 's2', code: 'STB_HO_002', name: '화면 s2', version: 1 }]));
  store.put(keys.flipbook('old'), { ...flipbook('old', 'p1', [{ uid: 's1', code: 'STB_HO_001', name: '화면 s1', version: 1 }]), tracked: false });
  assert.deepEqual(flagRetiredScreens(store, new Set(['s1'])), ['fb']);
  const fb = store.state.flipbooks.get('fb')!;
  assert.deepEqual([fb.screens.map(s => s.uid), fb.kind, fb.title, fb.deletedAlert], [['s2'], 'single', '화면 s2', true]);
  assert.deepEqual(store.state.flipbooks.get('old')!.screens.map(s => s.uid), ['s1'], 'an old-template flipbook is left as it is');
  assert.equal(dismissDeletedAlert(store, 'fb'), true);
  assert.equal(store.state.flipbooks.get('fb')!.deletedAlert, false);
  assert.equal(dismissDeletedAlert(store, 'fb'), false);
  await tracks.refreshPage('p1');
  assert.deepEqual(calls.scans, [['p1']]);
});

test('플러그인이 열려 있는 동안 복제한 추적 GUI는 새 기록을 받고, 이미 기록된 노드와 사용 안 함 화면의 복사본은 그대로 둔다', async () => {
  const { store, host, tracks, calls } = setup([]);
  const created: FoundCopy[] = [
    { nodeId: 'n1', pageId: 'p1', uid: 's1', version: 2, trackId: 't1', flipbookId: null },
    { nodeId: 'dup', pageId: 'p2', uid: 's1', version: 2, trackId: 't1', flipbookId: null },
    { nodeId: 'old', pageId: 'p2', uid: 's2', version: 1, trackId: 't2', flipbookId: null },
  ];
  Object.assign(host, { createdCopies: async () => created });
  store.put(keys.screen('s1'), screenRecord('s1', 'STB_HO_001', 2));
  store.put(keys.screen('s2'), screenRecord('s2', 'STB_HO_002', 1, 'deleted'));
  store.put(keys.track('t1'), { id: 't1', uid: 's1', nodeId: 'n1', pageId: 'p1', createdAt: 1, actor } satisfies TrackRecord);
  assert.equal(await tracks.adopt(['n1', 'dup', 'old']), true);
  const dup = [...store.state.tracks.values()].find(t => t.nodeId === 'dup')!;
  assert.deepEqual([dup.uid, dup.pageId, store.state.tracks.size], ['s1', 'p2', 2]);
  assert.deepEqual(calls.marks, [{ nodeId: 'dup', trackId: dup.id }], 'the duplicate gets its own track ID');
  assert.equal(await tracks.adopt(['n1', 'dup']), false, 'nothing new the second time');
});


test('삭제 배포는 동기화 전 옮긴 GUI의 현재 소속에만 경고하고 추적을 멈춘다', async () => {
  const found: FoundCopy[] = [{ nodeId: 'n1', pageId: 'p2', uid: 's1', version: 1, trackId: 't1', flipbookId: 'b' }];
  const { store, tracks, calls } = setup(found);
  store.put(keys.screen('s1'), screenRecord('s1', 'STB_HO_001', 1, 'deleted'));
  store.put(keys.flipbook('a'), flipbook('a', 'p1', [{ uid: 's1', code: 'STB_HO_001', name: '화면 s1', version: 1 }]));
  store.put(keys.flipbook('b'), flipbook('b', 'p2'));
  store.put(keys.track('t1'), { id: 't1', uid: 's1', nodeId: 'n1', pageId: 'p1', createdAt: 1, actor } satisfies TrackRecord);
  assert.deepEqual(await tracks.retire(new Set(['s1'])), ['a', 'b']);
  assert.equal(!!store.state.flipbooks.get('a')!.deletedAlert, false);
  assert.equal(store.state.flipbooks.get('b')!.deletedAlert, true);
  assert.equal(store.state.flipbooks.get('a')!.screens.length, 0);
  assert.equal(store.state.tracks.size, 0);
  assert.deepEqual(calls.scans, [['p1', 'p2']]);
  assert.equal(store.state.imported.size, 0, 'no new history for a retired screen');
});
