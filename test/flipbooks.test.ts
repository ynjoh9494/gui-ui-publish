import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFrameName, formatFrameName } from '../src/core/screenName.ts';
import { guiRecordInfos, guiScreens, type GuiRecordInfo, type GuiScreenInfo } from '../src/core/guiScreens.ts';
import { filterScreens, planFlipbooks, importGuiUpdates, markReviewed, needsReview, removeFlipbooks, retireFlipbooks, uncreatedScreens, unreviewed } from '../src/core/flipbooks.ts';
import { flipbookView } from '../src/core/flipbook.ts';
import { flipbookHistoryRows } from '../src/core/history.ts';
import { acknowledgeChange, buildPlan, commitPlan } from '../src/core/publish.ts';
import { keys, memoryKV, Store } from '../src/core/store.ts';
import { dataModel } from '../src/core/data.ts';
import { buildList } from '../src/core/list.ts';
import { changeDetected, classify, entryName, ignoreBlock, uncheckedEntries, uiEntries, type Entry } from '../src/core/compare.ts';
import { clearAutoCaseCode, clearFill, defaultDraft, draftCode, draftName, fillCaseCode, fillFromScreen, isPrevious, suggestedCaseCode, validateDraft, type Draft } from '../src/core/drafts.ts';
import { ensureSystemTags, removeExclusion, systemTagId, updateTag } from '../src/core/registry.ts';
import type { GuiRecord, Screen } from '../src/core/types.ts';
import { Controller, type Host } from '../src/controller.ts';
import { screenRoots } from '../src/figma/host.ts';
import { sortScreenItems } from '../src/ui/app.ts';
import { guiState, uiListState } from '../src/ui/estimate.ts';
import { fromWire, toUiWire, type ToUi } from '../src/core/wire.ts';

const actor = { id: 'u', name: 'Designer' };
const tag = { id: 't', name: '변경', color: '#00ff00', colorKey: 'Green' };
const thumb = (uid: string, version: number) => ({ hash: `${uid}-${version}`, width: 480, height: 270 });
const screen = (uid: string, code: string, version = 1): GuiScreenInfo => ({
  uid, code, name: `화면 ${uid}`, category: { id: 'home', name: '홈', order: 1 }, status: 'active', isCase: false, version, thumb: thumb(uid, version), sourceNodeId: `node-${uid}`,
});
const record = (uid: string, code: string, version: number, batchId = `b${version}`): GuiRecordInfo => ({
  batchId, uid, code, version, name: `화면 ${uid}`, workType: 'changed', tag, description: `GUI v${version}`,
  original: `GUI v${version}`, corrected: false, worker: 'Designer', committedAt: version * 1000,
});
const row = (uids: string[], multi = false, title?: string) => ({ uids, multi, scale: (multi ? 0.5 : 1) as 1 | 0.5, title });

test('UI 목록은 페이지명과 같은 카테고리를 한 번만 표시하고 플립북 삭제를 기록한다', () => {
  const store = new Store(memoryKV());
  const [fb] = planFlipbooks({ pageId: 'page', rows: [row([], false, '홈 정책')] }, new Map(), actor, 1000, () => 'fb');
  store.put(keys.flipbook(fb.id), { ...fb, category: { key: 'home', name: 'HOME', order: 1 } });
  store.put(keys.worker('w'), { id: 'w', name: 'Designer', alias: '', active: true });
  store.put(keys.tag('ui-tag'), { id: 'ui-tag', team: 'UI', name: '수정', colorKey: 'Green', color: '#00ff00', active: true });
  const [entry] = uiEntries(store.state, new Map([['fb', { flipbookId: 'fb', nodeId: null, fingerprint: null, error: null }]]));
  const draft = { included: true, tagId: 'ui-tag', workerId: 'w' };
  assert.equal(entry.estimate, 'missing');
  assert.equal(uiListState(entry, undefined), 'detected-delete');
  assert.equal(uiListState(entry, draft), 'deleted');
  const list = (pageName: string) => buildList('UI', store.state, [entry], () => 'excluded', {
    collapsed: new Set(), query: '', changedOnly: false, pages: [{ id: 'page', name: pageName }],
  });
  assert.equal(list('Home').groups[0].name, 'Home');
  assert.equal(list('Screens').groups[0].name, 'Screens · HOME');

  const plan = buildPlan('UI', store.state, [entry], { fb: draft }, actor, 'delete-fb');
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.counts.deleted, 1);
  assert.equal(commitPlan(store, plan, { fingerprints: {}, thumbs: {}, uiNodeIds: { fb: 'restored' } }).ok, false);
  assert.equal(store.state.flipbooks.get('fb')?.status, 'active');
  const committed = commitPlan(store, plan, { fingerprints: {}, thumbs: {}, uiNodeIds: { fb: null } });
  assert.equal(committed.ok, true);
  assert.deepEqual(committed.deliveries, []);
  assert.equal(store.state.flipbooks.get('fb')?.status, 'deleted');
  assert.equal(store.state.ui.get('fb')?.[0].workType, 'deleted');
  assert.equal(buildList('UI', store.state, uiEntries(store.state, new Map()), () => 'excluded', {
    collapsed: new Set(), query: '', changedOnly: false, pages: [{ id: 'page', name: 'Home' }],
  }).groups.length, 0);
});

test('일괄 만들기는 플립북이 없는 화면을 카테고리·유형·검색으로 고른다', () => {
  const store = new Store(memoryKV());
  const epg = { id: 'epg', name: 'EPG', order: 0 };
  const screens = [
    screen('a', 'STB_HO_002'), screen('b', 'STB_HO_001'), { ...screen('c', 'STB_HO_001-01'), isCase: true },
    { ...screen('d', 'STB_LI_001'), category: epg }, { ...screen('e', 'STB_HO_003'), category: null },
    { ...screen('f', 'STB_HO_004'), sourceNodeId: null }, { ...screen('g', 'STB_HO_005'), status: 'deleted' as const },
    screen('used', 'STB_HO_006'), screen('retired', 'STB_HO_007'), screen('planned', 'STB_HO_008'),
  ];
  const [used, retired] = planFlipbooks({ pageId: 'page', rows: [row(['used']), row(['retired'])] }, new Map(screens.map(s => [s.uid, s])), actor, 1000, (() => { let n = 0; return () => `fb${++n}`; })());
  store.put(keys.flipbook(used.id), used);
  store.put(keys.flipbook(retired.id), { ...retired, status: 'deleted' });
  const candidates = uncreatedScreens(store.state, screens, ['planned']);
  assert.deepEqual(candidates.map(s => s.uid), ['d', 'b', 'c', 'a', 'retired', 'e'], '카테고리 순서 → Screen ID 순, 사용 안 함 플립북의 화면은 다시 후보');
  const all = new Set(['epg', 'home', '']);
  assert.deepEqual(filterScreens(candidates, { categories: new Set(['home']), kind: 'all', query: '' }).map(s => s.uid), ['b', 'c', 'a', 'retired']);
  assert.deepEqual(filterScreens(candidates, { categories: new Set(['']), kind: 'all', query: '' }).map(s => s.uid), ['e'], '미지정 카테고리');
  assert.deepEqual(filterScreens(candidates, { categories: all, kind: 'case', query: '' }).map(s => s.uid), ['c']);
  assert.deepEqual(filterScreens(candidates, { categories: all, kind: 'base', query: ' stb_li ' }).map(s => s.uid), ['d']);
});

test('Screen ID가 있는 프레임과 없는 프레임의 이름을 분리한다', () => {
  assert.deepEqual(parseFrameName(' [ STB_HO_001 ] 홈 화면 -1 '), { code: 'STB_HO_001', name: '홈 화면 -1' });
  assert.deepEqual(parseFrameName('홈 화면 -1'), { code: null, name: '홈 화면 -1' });
  assert.deepEqual(parseFrameName('[임의 ID]  화면'), { code: '임의 ID', name: '화면' });
  assert.deepEqual(parseFrameName('[  ] 화면'), { code: null, name: '화면' });
  assert.equal(formatFrameName(' STB_HO_001 ', ' 홈 화면 -1 '), '[STB_HO_001] 홈 화면 -1');
  assert.equal(formatFrameName(undefined, '이전 화면'), '이전 화면');
});

test('GUI 목록은 배포된 화면의 ID 태그와 입력 중 이름·ID를 표시하고 ID 순으로 정렬한다', () => {
  const store = new Store(memoryKV());
  store.put(keys.screen('base'), { id: 'base', code: 'STB_HO_010', name: '기본', status: 'active' });
  store.put(keys.screen('earlier'), { id: 'earlier', code: 'STB_HO_002', name: '앞 화면', status: 'active' });
  store.put(keys.screen('case'), { id: 'case', code: 'STB_HO_010-01', name: '케이스', baseScreenId: 'base', status: 'active' });
  const entries = [
    guiEntry('base', '[STB_HO_010] 기본', 'fp', 'base'),
    guiEntry('case', '[STB_HO_010-01] 케이스', 'fp', 'case'),
    guiEntry('earlier', '[STB_HO_002] 앞 화면', 'fp', 'earlier'),
    guiEntry('new', '원본 이름', 'fp'),
  ];
  const view = { collapsed: new Set<string>(), query: '', changedOnly: false };
  const rows = () => buildList('GUI', store.state, entries, () => 'excluded', view).groups.flatMap(group => group.rows);
  assert.deepEqual(rows().map(row => [row.code, row.name, row.depth]), [
    ['STB_HO_002', '앞 화면', 0], ['STB_HO_010', '기본', 0], ['STB_HO_010-01', '케이스', 1], ['', '원본 이름', 0],
  ]);
  const edited = buildList('GUI', store.state, entries, () => 'excluded', {
    ...view,
    guiDisplay: (entry, saved) => entry.key === 'earlier' ? { ...saved, code: 'STB_HO_012' }
      : entry.key === 'new:new' ? { ...saved, name: '입력 이름' } : saved,
  });
  assert.deepEqual(edited.groups.flatMap(group => group.rows).map(row => [row.code, row.name]), [
    ['STB_HO_010', '기본'], ['STB_HO_010-01', '케이스'], ['STB_HO_012', '앞 화면'], ['', '입력 이름'],
  ]);
  assert.deepEqual(buildList('GUI', store.state, entries, () => 'excluded', { ...view, query: '012', guiDisplay: (entry, saved) => ({ ...saved, code: entry.key === 'earlier' ? 'STB_HO_012' : saved.code }) }).groups.flatMap(group => group.rows).map(row => row.entry.key), ['earlier']);
});

test('GUI 신규 후보는 이름과 관계없이 스캔한 캔버스 순서로 표시한다', () => {
  const store = new Store(memoryKV());
  const entries = [guiEntry('right', '가 화면', 'fp'), guiEntry('left', '나 화면', 'fp')];
  const rows = buildList('GUI', store.state, entries, () => 'excluded', { collapsed: new Set(), query: '', changedOnly: false })
    .groups.flatMap(group => group.rows);
  assert.deepEqual(rows.map(row => row.entry.key), entries.map(entry => entry.key));
});

test('GUI 목록은 입력 중인 카테고리·케이스 관계로 그룹과 들여쓰기를 정한다', () => {
  const store = new Store(memoryKV());
  store.put(keys.category('home'), { id: 'home', name: '홈', order: 1, active: true });
  store.put(keys.category('vod'), { id: 'vod', name: 'VOD', order: 2, active: true });
  store.put(keys.screen('base'), { id: 'base', code: 'STB_HO_010', name: '기본', categoryId: 'home', status: 'active' });
  store.put(keys.screen('other'), { id: 'other', code: 'STB_HO_002', name: '다른 화면', categoryId: 'home', status: 'active' });
  store.put(keys.screen('vod'), { id: 'vod', code: 'STB_VO_001', name: 'VOD 기본', categoryId: 'vod', status: 'active' });
  const entries = [
    guiEntry('base', '[STB_HO_010] 기본', 'fp', 'base'),
    guiEntry('other', '[STB_HO_002] 다른 화면', 'fp', 'other'),
    guiEntry('vod', '[STB_VO_001] VOD 기본', 'fp', 'vod'),
    guiEntry('new', '새 케이스', 'fp'),
  ];
  const view = { collapsed: new Set<string>(), query: '', changedOnly: false };
  const groups = (guiPlace?: Parameters<typeof buildList>[4]['guiPlace']) => buildList('GUI', store.state, entries, () => 'excluded', { ...view, guiPlace })
    .groups.map(group => [group.key, group.rows.map(row => [row.entry.key, row.depth])]);
  assert.deepEqual(groups(), [
    ['__none__', [['new:new', 0]]], ['home', [['other', 0], ['base', 0]]], ['vod', [['vod', 0]]],
  ]);
  // 신규 후보를 기본 화면의 케이스로, 다른 화면을 같은 기본 화면의 케이스로 바꾸면 Screen ID 순서와 관계없이 기본 화면 바로 아래에 둔다.
  assert.deepEqual(groups((entry, saved) => entry.key === 'new:new' ? { categoryId: 'home', baseScreenId: 'base' }
    : entry.key === 'other' ? { ...saved, baseScreenId: 'base' } : saved), [
    ['home', [['base', 0], ['other', 1], ['new:new', 1]]], ['vod', [['vod', 0]]],
  ]);
  // 기본 화면이 다른 카테고리에 있으면 옮겨 간 그룹에서 들여쓰지 않는다.
  assert.deepEqual(groups((entry, saved) => entry.key === 'other' ? { categoryId: 'vod', baseScreenId: 'base' } : saved), [
    ['__none__', [['new:new', 0]]], ['home', [['base', 0]]], ['vod', [['other', 0], ['vod', 0]]],
  ]);
});

test('배포된 화면은 프레임 이름이 아니라 저장된 이름을 기본값으로 쓰고, 입력값을 Publish 이름에 사용하며 빈 이름은 필수 오류로 처리한다', () => {
  const store = new Store(memoryKV());
  store.put(keys.screen('home'), { id: 'home', code: 'STB_HO_001', name: '저장된 이름', status: 'active' });
  const entry = guiEntry('home', '[STB_HO_001] 프레임 이름', 'fp', 'home');
  const draft = { included: true, code: 'STB_HO_001' } as Draft;
  assert.equal(draftName(store.state, entry, draft), '저장된 이름');
  draft.name = '수정한 이름';
  assert.equal(draftName(store.state, entry, draft), '수정한 이름');
  draft.name = '';
  assert.ok(validateDraft('GUI', store.state, entry, draft).missing.includes('화면 이름'));
});

test('케이스 기본 화면 선택은 현재 카테고리를 먼저, 각 그룹 안에서는 Screen ID 순으로 보여 준다', () => {
  const items = [
    { value: 'a', code: 'STB_HO_010', name: '다른 화면', categoryId: 'other' },
    { value: 'b', code: 'STB_HO_003', name: '선택한 카테고리 2', categoryId: 'home' },
    { value: 'c', code: 'STB_HO_001', name: '선택한 카테고리 1', categoryId: 'home' },
    { value: 'd', code: 'STB_HO_002', name: '다른 화면 2', categoryId: 'other' },
  ];
  assert.deepEqual(sortScreenItems(items, 'home').map(item => item.value), ['c', 'b', 'd', 'a']);
  assert.deepEqual(sortScreenItems(items).map(item => item.value), ['c', 'd', 'b', 'a']);
});

test('중첩 Section의 화면 루트를 찾고 프레임 안의 하위 요소는 화면으로 보지 않는다', () => {
  const node = (id: string, type: string, children: unknown[] = []) => ({ id, type, children });
  const page = node('page', 'PAGE', [
    node('top', 'FRAME', [node('inside-frame', 'FRAME')]),
    node('outer', 'SECTION', [node('outer-screen', 'FRAME'), node('inner', 'SECTION', [node('inner-screen', 'FRAME')])]),
  ]) as unknown as PageNode;
  assert.deepEqual([...screenRoots(page, new Set())].map(item => item.id), ['top', 'outer-screen', 'inner-screen']);
  assert.deepEqual([...screenRoots(page, new Set(['inner']))].map(item => item.id), ['inner-screen']);
  assert.deepEqual([...screenRoots(page, new Set(['outer']))].map(item => item.id), ['outer-screen', 'inner-screen']);
});

test('캔버스에서 선택한 미등록 화면을 목록에 올리고 선택한 화면만 비교한다', async () => {
  const posted: ToUi[] = [];
  const fingerprinted: string[] = [];
  const frames = ['new-a', 'new-b'].map(nodeId => ({ nodeId, pageId: 'page', name: nodeId, width: 100, height: 100, screenTag: null, fingerprint: null, error: null }));
  const host = {
    kv: memoryKV({ project: JSON.stringify({ scopePageIds: ['page'] }) }), mode: 'GUI', actor,
    post: (message: ToUi) => posted.push(message), pages: () => [{ id: 'page', name: '원본' }],
    selectionNodeIds: () => frames.map(frame => ({ nodeId: frame.nodeId, flipbookId: null })),
    listFrames: async () => frames,
    fingerprint: async (nodeId: string) => { fingerprinted.push(nodeId); return { fingerprint: `fp:${nodeId}`, error: null }; },
  } as unknown as Host;
  const controller = new Controller(host);
  await controller.handle({ type: 'ready' });
  assert.equal(controller.entries.length, 0);
  await controller.canvasSelectionChanged();
  assert.deepEqual(controller.entries.map(entry => entry.key), ['node:new-a', 'node:new-b']);
  assert.deepEqual((posted.filter(message => message.type === 'canvasSelection').pop() as Extract<ToUi, { type: 'canvasSelection' }>).entryKeys, ['node:new-a', 'node:new-b']);
  await controller.handle({ type: 'scanSelected', team: 'GUI', entryKeys: ['node:new-a', 'node:new-b'] });
  assert.deepEqual(fingerprinted, ['new-a', 'new-b']);
  assert.ok(controller.partialAt);
  assert.equal(controller.checkedAt, null);
});

test('프레임 이름의 대괄호 Screen ID를 자동 입력하고 직접 비우거나 수정한 값은 유지한다', () => {
  const store = new Store(memoryKV());
  const entry = guiEntry('bracketed', '[STB_HO_002-01] 새 화면', 'fp');
  const draft = defaultDraft('GUI', store.state, entry);
  assert.equal(draft.code, 'STB_HO_002-01');
  assert.equal(draftCode(store.state, entry, draft), 'STB_HO_002-01');
  assert.equal(draftCode(store.state, entry, { included: true, link: 'new' }), 'STB_HO_002-01');
  draft.included = true;
  draft.code = '';
  assert.equal(draftCode(store.state, entry, draft), '');
  assert.ok(validateDraft('GUI', store.state, entry, draft).missing.includes('Screen ID'));
  draft.code = 'CUSTOM-01';
  assert.equal(draftCode(store.state, entry, draft), 'CUSTOM-01');
});

test('여러 화면의 Screen ID를 한 칸씩 밀어 배포하고 일부 충돌 시 의존 화면은 보류한다', () => {
  const setup = (idsInFrameNames = false) => {
    const store = new Store(memoryKV());
    store.put(keys.category('home'), { id: 'home', name: '홈', order: 1, active: true });
    store.put(keys.worker('w'), { id: 'w', name: 'Designer', alias: '', active: true });
    store.put(keys.tag('t'), { id: 't', team: 'GUI', name: '변경', colorKey: 'Green', color: '#00ff00', active: true });
    const entries: Entry[] = [];
    const drafts: Record<string, Draft> = {};
    for (let n = 1; n <= 5; n++) {
      const id = `s${n}`;
      const code = `STB_HO_001-${String(n).padStart(2, '0')}`;
      store.put(keys.screen(id), {
        id, rev: 1, code, name: `화면 ${n}`, categoryId: 'home', baseScreenId: null, status: 'active',
        source: { nodeId: `${n}:1`, pageId: '0:1' }, guiVersion: 1, guiTag: null, createdAt: 1000,
      });
      const frameCode = idsInFrameNames ? `STB_HO_001-${String(n + 1).padStart(2, '0')}` : code;
      entries.push(guiEntry(`${n}:1`, `[${frameCode}] 화면 ${n}`, `fp${n}`, id));
    }
    for (let n = 1; n <= 5; n++) {
      const entry = entries[n - 1];
      drafts[entry.key] = {
        ...defaultDraft('GUI', store.state, entry), included: true,
        code: idsInFrameNames ? undefined : `STB_HO_001-${String(n + 1).padStart(2, '0')}`,
        tagId: 't', workerId: 'w',
      };
    }
    const plan = buildPlan('GUI', store.state, entries, drafts, actor, 'shift');
    const input = { fingerprints: Object.fromEntries(entries.map((entry, index) => [entry.key, `fp${index + 1}`])), thumbs: {} };
    return { store, entries, drafts, plan, input };
  };
  const full = setup();
  assert.equal(validateDraft('GUI', full.store.state, full.entries[0], full.drafts.s1, full.drafts).status, 'ready');
  assert.deepEqual(full.plan.blockers, []);
  assert.equal(commitPlan(full.store, full.plan, full.input).ok, true);
  assert.deepEqual([...full.store.state.screens.values()].map(screen => screen.code), ['STB_HO_001-02', 'STB_HO_001-03', 'STB_HO_001-04', 'STB_HO_001-05', 'STB_HO_001-06']);

  // 등록 화면의 Screen ID는 기록에만 있다. 프레임 이름의 대괄호 ID를 바꿔도 읽지 않는다(2026-10-21 사용자 결정).
  const fromFrames = setup(true);
  assert.deepEqual(fromFrames.plan.blockers, []);
  assert.equal(commitPlan(fromFrames.store, fromFrames.plan, fromFrames.input).ok, true);
  assert.deepEqual([...fromFrames.store.state.screens.values()].map(screen => screen.code), ['STB_HO_001-01', 'STB_HO_001-02', 'STB_HO_001-03', 'STB_HO_001-04', 'STB_HO_001-05']);

  const duplicate = setup();
  duplicate.drafts.s2.code = 'STB_HO_001-02';
  assert.equal(validateDraft('GUI', duplicate.store.state, duplicate.entries[0], duplicate.drafts.s1, duplicate.drafts, duplicate.entries).status, 'invalid');
  assert.ok(buildPlan('GUI', duplicate.store.state, duplicate.entries, duplicate.drafts, actor, 'duplicate').blockers.length);

  const partial = setup();
  const second = partial.store.state.screens.get('s2')!;
  partial.store.put(keys.screen('s2'), { ...second, rev: second.rev + 1 });
  const result = commitPlan(partial.store, partial.plan, partial.input);
  assert.deepEqual(new Set(result.conflicts.map(conflict => conflict.entryKey)), new Set(['s1', 's2']));
  assert.deepEqual([...partial.store.state.screens.values()].map(screen => screen.code), ['STB_HO_001-01', 'STB_HO_001-02', 'STB_HO_001-04', 'STB_HO_001-05', 'STB_HO_001-06']);
});

test('대괄호 ID가 없는 신규 화면은 비어 있고 케이스 기본 화면을 고르면 다음 ID를 자동 입력한다', () => {
  const store = new Store(memoryKV());
  const add = (id: string, code: string) => store.put(keys.screen(id), { id, code, name: code, status: 'active' });
  add('base', 'STB_HO_001');
  add('case1', 'STB_HO_001-01');
  add('case2', 'STB_HO_001-02');
  const entry = guiEntry('new', '새 화면', 'fp');
  const draft = defaultDraft('GUI', store.state, entry);
  assert.equal(draft.code, undefined);
  assert.equal(draftCode(store.state, entry, draft), '');
  assert.equal(suggestedCaseCode(store.state, undefined), '');
  draft.relation = 'case';
  draft.baseScreenId = 'base';
  assert.equal(suggestedCaseCode(store.state, draft.baseScreenId), 'STB_HO_001-03');
  fillCaseCode(store.state, draft);
  assert.equal(draftCode(store.state, entry, draft), 'STB_HO_001-03');
  assert.equal(suggestedCaseCode(store.state, draft.baseScreenId, ['STB_HO_001-03']), 'STB_HO_001-04');
  draft.code = 'CUSTOM-01';
  fillCaseCode(store.state, draft);
  assert.equal(draft.code, 'CUSTOM-01', '직접 수정한 ID는 덮어쓰지 않는다');
  clearAutoCaseCode(draft);
  assert.equal(draft.code, 'CUSTOM-01');
});

test('기존 단일 UI 페이지 설정을 지정 페이지 목록으로 가져온다', () => {
  const old = new Store(memoryKV({ project: JSON.stringify({ flipbookPageId: 'ui-old' }) }));
  assert.deepEqual(old.state.project.flipbookPageIds, ['ui-old']);
  old.saveProject({ ...old.state.project, flipbookPageIds: [], flipbookPageId: null });
  old.reload();
  assert.deepEqual(old.state.project.flipbookPageIds, []);
});

test('관리에서 지정한 UI 페이지만 플립북 만들기 요청을 받는다', async () => {
  const posted: ToUi[] = [];
  const host = {
    kv: memoryKV({ project: JSON.stringify({ templateNodeId: 'template' }) }), actor,
    pages: () => [{ id: 'ui-a', name: 'UI A' }, { id: 'ui-b', name: 'UI B' }],
    post: (message: ToUi) => posted.push(message),
  } as unknown as Host;
  const controller = new Controller(host);
  await controller.handle({ type: 'admin', action: { op: 'setFlipbookPages', pageIds: ['ui-a'] } });
  assert.deepEqual(controller.store.state.project.flipbookPageIds, ['ui-a']);
  await controller.handle({ type: 'createFlipbooks', request: { pageId: 'ui-b', rows: [row([], false, '정책')] } });
  assert.equal(posted[posted.length - 2]?.type, 'error');
  assert.equal(controller.store.state.flipbooks.size, 0);
  await controller.handle({ type: 'admin', action: { op: 'setFlipbookPages', pageIds: ['ui-a', 'ui-b'] } });
  assert.deepEqual(controller.store.state.project.flipbookPageIds, ['ui-a', 'ui-b']);
});

test('이전 버전의 Screen ID 없는 저장 데이터도 실행 목록과 DATA 페이지에 표시한다', () => {
  const old = { id: 'old', name: '이전 화면', categoryId: null, status: 'active', source: { nodeId: '1:1', pageId: '0:1' }, guiVersion: 0, guiTag: null };
  const other = { ...old, id: 'other', name: '다른 화면', source: { nodeId: '1:2', pageId: '0:1' } };
  const store = new Store(memoryKV({ 'scr:old': JSON.stringify(old), 'scr:other': JSON.stringify(other) }));
  assert.deepEqual(uncheckedEntries(store.state).map(x => x.frame?.name), ['이전 화면', '다른 화면']);
  assert.deepEqual(dataModel(store.state, actor, 0).screens.map(x => x.name).sort(), ['다른 화면', '이전 화면']);
});

test('플립북 만들기 표의 행마다 플립북을 만든다. 화면을 비워도 만들고(제목 기본값 「새 플립북」, Section 기본값 미분류), 여러 화면은 선택 순서와 크기대로', () => {
  const screens = new Map([screen('a', 'A'), screen('b', 'B')].map(s => [s.uid, s]));
  let id = 0;
  const next = () => `fb${++id}`;
  const made = planFlipbooks({ pageId: 'p2', rows: [row(['b']), { ...row(['b', 'a'], true), scales: { b: 0.25, a: 0.5 } }, row([], false, '정책')] }, screens, actor, 100, next);
  assert.deepEqual(made.map(f => [f.kind, f.pageId, f.scale]), [['single', 'p2', 1], ['multi', 'p2', 0.5], ['policy', 'p2', 1]]);
  assert.deepEqual(made[1].screens, [{ uid: 'b', code: 'B', name: '화면 b', version: 1, scale: 0.25 }, { uid: 'a', code: 'A', name: '화면 a', version: 1, scale: 0.5 }]);
  assert.deepEqual([made[0].title, made[1].title, made[2].title], ['화면 b', '화면 b', '정책']);
  const blank = planFlipbooks({ pageId: 'p', rows: [row([])] }, screens, actor, 100, next)[0];
  assert.deepEqual([blank.title, blank.autoTitle, blank.category.name], ['새 플립북', true, '미분류']);
  assert.throws(() => planFlipbooks({ pageId: 'p', rows: [row(['a', 'a'], true)] }, screens, actor, 100, next), /두 번/);
  // GUI 원본 프레임이 없는 화면으로는 만들 수 없다.
  const noSource = new Map([['a', { ...screen('a', 'A'), sourceNodeId: null }]]);
  assert.throws(() => planFlipbooks({ pageId: 'p', rows: [row(['a'])] }, noSource, actor, 100, next), /원본/);
});

test('같은 GUI를 쓰는 두 플립북에 새 GUI 기록을 각각 한 번만 쌓고, 확인 완료 전까지 화면 수정 표시를 한다', () => {
  let now = 100;
  const store = new Store(memoryKV(), () => now, () => 'unused');
  const initial = screen('a', 'STB_HO_001');
  let id = 0;
  const one = () => planFlipbooks({ pageId: 'p', rows: [row(['a'])] }, new Map([['a', initial]]), actor, 100, () => `fb${++id}`)[0];
  const first = one(), second = one();
  store.put(keys.flipbook(first.id), first);
  store.put(keys.flipbook(second.id), second);
  assert.equal(needsReview(store.state, first.id), false);
  const latest = screen('a', 'STB_HO_001', 2);
  const screens = new Map([['a', latest]]);
  const records = [record('a', latest.code, 1), record('a', latest.code, 2)];
  const firstResult = importGuiUpdates(store, first.id, screens, records);
  const secondResult = importGuiUpdates(store, second.id, screens, records);
  assert.deepEqual([firstResult.added, secondResult.added], [1, 1]);
  assert.deepEqual([store.state.imported.get(first.id)?.length, store.state.imported.get(second.id)?.length], [1, 1]);
  assert.equal(importGuiUpdates(store, first.id, screens, records).added, 0);
  assert.equal(needsReview(store.state, first.id), true);
  assert.deepEqual(unreviewed(store.state, first.id).map(r => r.version), [2]);
  // 확인 완료를 누르면 그 플립북만 풀린다. 같은 플립북을 두 번 보내도 한 번만 기록한다.
  now = 9000;
  ensureSystemTags(store, actor);
  const latestTag = systemTagId(store.state, 'latest')!;
  assert.deepEqual([store.state.tags.get(latestTag)?.name, store.state.tags.get(latestTag)?.team, store.state.tags.get(latestTag)?.colorKey], ['최신', 'UI', 'Black']);
  // 확인 완료는 상태(필수)와 코멘트(선택)를 UI 이력 한 줄과 플립북 Status로 남긴다.
  assert.throws(() => markReviewed(store, [{ flipbookId: first.id, tagId: '', comment: '' }], actor, 'r0'), /상태/);
  assert.deepEqual(markReviewed(store, [{ flipbookId: first.id, tagId: latestTag, comment: ' 콜아웃 확인 ' }, { flipbookId: first.id, tagId: latestTag, comment: '' }], actor, 'r1'), [first.id]);
  assert.deepEqual([needsReview(store.state, first.id), needsReview(store.state, second.id)], [false, true]);
  assert.deepEqual(store.state.reviews.get(first.id)?.versions, { a: 2 });
  assert.deepEqual([store.state.ui.get(first.id)?.[0].description, store.state.ui.get(first.id)?.[0].tag.name, store.state.uiStates.get(first.id)?.version], ['콜아웃 확인', '최신', 1]);
  // 수정된 화면이 없어도 상태를 바꿀 수 있다.
  assert.deepEqual(markReviewed(store, [{ flipbookId: first.id, tagId: latestTag, comment: '' }], actor, 'r2'), [first.id]);
  assert.equal(store.state.uiStates.get(first.id)?.version, 2);
  // 기본 태그 「최신」으로 시작한다.
  assert.equal(defaultDraft('UI', store.state, uiEntries(store.state, new Map()).find(e => e.flipbookId === second.id)!).tagId, latestTag);
  // UI에는 확인하지 않은 기록만 보낸다.
  const wired = fromWire(toUiWire(store.state));
  assert.deepEqual([wired.imported.get(first.id), wired.imported.get(second.id)?.map(r => r.version)], [[], [2]]);
  assert.deepEqual([needsReview(wired, first.id), needsReview(wired, second.id)], [false, true]);
  // 확인 뒤 다시 배포되면 다시 표시한다. 배포한 PC의 시계가 확인한 PC보다 늦어도 버전으로 판단한다.
  const third = screen('a', 'STB_HO_001', 3);
  importGuiUpdates(store, first.id, new Map([['a', third]]), [...records, record('a', third.code, 3)]);
  assert.equal(store.state.imported.get(first.id)?.slice(-1)[0]?.committedAt, 3000);
  assert.equal(needsReview(store.state, first.id), true);
  assert.deepEqual(unreviewed(store.state, first.id).map(r => r.version), [3]);
});

test('이전 버전의 UI 배포 기록이 있으면 그 시각까지는 확인한 것으로 본다', () => {
  const store = new Store(memoryKV(), () => 100, () => 'unused');
  const [fb] = planFlipbooks({ pageId: 'p', rows: [row(['a'])] }, new Map([['a', screen('a', 'STB_HO_001')]]), actor, 100, () => 'fb1');
  store.put(keys.flipbook(fb.id), fb);
  importGuiUpdates(store, fb.id, new Map([['a', screen('a', 'STB_HO_001', 2)]]), [record('a', 'STB_HO_001', 2)]);
  store.put(keys.ui(fb.id, 1), { flipbookId: fb.id, version: 1, batchId: 'u1', tag, description: '', worker: { id: 'w', name: 'W' }, actor, committedAt: 5000, extra: {}, corrections: [] });
  assert.equal(needsReview(store.state, fb.id), false);
});

test('같은 배포에서 바뀐 여러 화면은 플립북 이력 한 줄이며 Screen ID·버전을 쓰지 않는다', () => {
  const store = new Store(memoryKV(), () => 100, () => 'unused');
  const [fb] = planFlipbooks({ pageId: 'p', rows: [row(['a', 'b'], true)] }, new Map([screen('a', 'A'), screen('b', 'B')].map(s => [s.uid, s])), actor, 100, () => 'fb1');
  store.put(keys.flipbook(fb.id), fb);
  const screens = new Map([screen('a', 'A', 2), screen('b', 'B', 2)].map(s => [s.uid, s]));
  importGuiUpdates(store, fb.id, screens, [record('a', 'A', 2, 'same'), record('b', 'B', 2, 'same')]);
  const rows = flipbookHistoryRows(store.state, fb.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, null);
  const view = flipbookView(store.state, fb.id);
  assert.deepEqual(Object.keys(view.rows[0]).sort(), ['at', 'colorKey', 'description', 'key', 'tag', 'team', 'worker']);
  assert.deepEqual(view.gui.map(g => g.code), ['A', 'B']);
});

// GUI Publish → 썸네일 기록 → 플립북은 원본 정보를 받는다. 같은 파일의 원기록만으로 이어지는지 확인한다.
function guiEntry(nodeId: string, name: string, fingerprint: string, screenId: string | null = null): Entry {
  return {
    key: screenId ?? `new:${nodeId}`, screenId, estimate: screenId ? 'changed' : 'new',
    frame: { nodeId, pageId: '0:1', name, width: 1920, height: 1080, screenTag: screenId, fingerprint, error: null },
  } as unknown as Entry;
}

test('GUI Publish는 썸네일과 배포 한 번의 추가 설명을 기록하고, 플립북은 원본 프레임 정보를 받는다', () => {
  let n = 0;
  const store = new Store(memoryKV(), () => 1000 + n, () => `id${++n}`);
  store.saveProject({ ...store.state.project, scopePageIds: ['0:1'] });
  store.put(keys.category('home'), { id: 'home', name: '홈', order: 1, active: true });
  store.put(keys.tag('t'), { id: 't', team: 'GUI', name: '신규', colorKey: 'Green', color: '#00ff00', active: true });
  store.put(keys.worker('w'), { id: 'w', name: 'Designer', alias: '', active: true });
  store.reload();
  const draft = { included: true, link: 'new', relation: 'screen', code: 'STB_HO_001', name: '홈', categoryId: 'home', tagId: 't', workerId: 'w' } as never;
  const entry = guiEntry('1:1', '홈', 'fp1');
  const comment = { description: '첫 배포', extra: {} };
  const plan = buildPlan('GUI', store.state, [entry], { [entry.key]: draft }, actor, 'b1', comment);
  // 플립북 페이지가 없어도 배포할 수 있다.
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.items[0].needsThumb, true);
  assert.equal(plan.items[0].description, '첫 배포');
  const screenId = plan.items[0].screenId;

  // 썸네일을 만들지 못해도 확정한다.
  const result = commitPlan(store, plan, { fingerprints: { [entry.key]: 'fp1' }, thumbs: {} });
  assert.equal(result.ok, true);
  assert.deepEqual(result.deliveries, []);
  const gui = store.state.gui.get(screenId)![0] as GuiRecord;
  assert.deepEqual([gui.thumb, gui.fingerprint, gui.description, gui.extra], [null, 'fp1', '첫 배포', {}]);

  const [fb] = planFlipbooks({ pageId: 'p', rows: [row([screenId])] }, guiScreens(store.state), actor, 2000, () => 'fb1');
  store.put(keys.flipbook(fb.id), fb);
  assert.deepEqual(flipbookView(store.state, fb.id).gui, [{ uid: screenId, code: 'STB_HO_001', version: 1, key: `${screenId}@1`, sourceNodeId: '1:1', scale: 1 }]);

  // 변경 Publish: 썸네일을 기록하고, 반영하면 새 버전 표식을 받는다.
  const screen = store.state.screens.get(screenId) as Screen;
  const changed = guiEntry('1:1', '[STB_HO_001] 홈', 'fp2', screenId);
  const plan2 = buildPlan('GUI', store.state, [changed], { [changed.key]: { included: true, tagId: 't', workerId: 'w' } as never }, actor, 'b2');
  assert.deepEqual(plan2.blockers, [], 'comment is optional');
  assert.equal(plan2.items[0].toVersion, screen.guiVersion + 1);
  commitPlan(store, plan2, { fingerprints: { [changed.key]: 'fp2' }, thumbs: { [changed.key]: thumb(screenId, 2) } });
  assert.deepEqual(guiScreens(store.state).get(screenId)?.thumb, thumb(screenId, 2));
  const pulled = importGuiUpdates(store, fb.id, guiScreens(store.state), guiRecordInfos(store.state, new Set([screenId])));
  assert.equal(pulled.added, 1);
  assert.deepEqual(flipbookView(store.state, fb.id).gui.map(g => g.key), [`${screenId}@2`]);
});

// 기본 태그·작업자·카테고리가 있는 저장소에 GUI 화면 하나를 v1로 등록한다.
function seeded() {
  let n = 0;
  const store = new Store(memoryKV(), () => 1000 + n, () => `id${++n}`);
  store.saveProject({ ...store.state.project, scopePageIds: ['0:1'], flipbookPageId: '0:2' });
  store.put(keys.category('home'), { id: 'home', name: '홈', order: 1, active: true });
  store.put(keys.worker('w'), { id: 'w', name: 'Designer', alias: '', active: true });
  store.reload();
  ensureSystemTags(store, actor);
  const first = guiEntry('1:1', '[STB_HO_001] 홈', 'fp1');
  const draft = defaultDraft('GUI', store.state, first);
  Object.assign(draft, { included: true, code: 'STB_HO_001', categoryId: 'home', workerId: 'w' });
  const created = buildPlan('GUI', store.state, [first], { [first.key]: draft }, actor, 'b1');
  assert.deepEqual(created.blockers, []);
  const screenId = created.items[0].screenId;
  commitPlan(store, created, { fingerprints: { [first.key]: 'fp1' }, thumbs: { [first.key]: thumb(screenId, 1) } });
  const frame = (nodeId: string, name: string, fingerprint: string, screenTag: string | null = screenId) =>
    ({ nodeId, pageId: '0:1', name, width: 1920, height: 1080, screenTag, fingerprint, error: null });
  return { store, screenId, frame };
}

test('배포된 화면의 독립·케이스 관계를 다시 지정하고 GUI 기록과 목록에 반영한다', () => {
  const { store, screenId: baseId } = seeded();
  store.put(keys.screen('other'), {
    id: 'other', rev: 1, code: 'STB_HO_002', name: '다른 화면', categoryId: 'home', baseScreenId: null,
    status: 'active', source: { nodeId: '2:1', pageId: '0:1' }, guiVersion: 1,
    guiTag: null, createdAt: 1000,
  });
  const entry = guiEntry('2:1', '[STB_HO_002] 다른 화면', 'fp2', 'other');
  const draft = defaultDraft('GUI', store.state, entry);
  assert.deepEqual([draft.relation, draft.baseScreenId], ['standalone', undefined]);
  Object.assign(draft, { included: true, tagId: systemTagId(store.state, 'add'), workerId: 'w', relation: 'case', baseScreenId: baseId });
  assert.equal(validateDraft('GUI', store.state, entry, draft).status, 'ready');
  const asCase = buildPlan('GUI', store.state, [entry], { other: draft }, actor, 'relation-case');
  assert.deepEqual(asCase.blockers, []);
  assert.equal(asCase.items[0].metadataChanged, true);
  assert.equal(asCase.items[0].baseScreenId, baseId);
  assert.equal(commitPlan(store, asCase, { fingerprints: { other: 'fp2' }, thumbs: {} }).ok, true);
  assert.equal(store.state.screens.get('other')?.baseScreenId, baseId);
  assert.equal(store.state.gui.get('other')?.slice(-1)[0]?.base?.id, baseId);
  const baseEntry = guiEntry('1:1', '[STB_HO_001] 홈', 'fp1', baseId);
  const depths = () => buildList('GUI', store.state, [baseEntry, entry], () => 'excluded', { collapsed: new Set(), query: '', changedOnly: false }).groups.flatMap(group => group.rows).map(row => row.depth);
  assert.deepEqual(depths(), [0, 1]);

  store.put(keys.screen('base2'), {
    ...store.state.screens.get(baseId)!, id: 'base2', code: 'STB_HO_003', name: '새 기본 화면',
    source: { nodeId: '3:1', pageId: '0:1' }, baseScreenId: null,
  });
  const reparent = defaultDraft('GUI', store.state, entry);
  assert.deepEqual([reparent.relation, reparent.baseScreenId], ['case', baseId]);
  Object.assign(reparent, { included: true, tagId: systemTagId(store.state, 'add'), workerId: 'w', baseScreenId: 'base2' });
  const moved = buildPlan('GUI', store.state, [entry], { other: reparent }, actor, 'relation-moved');
  assert.equal(moved.items[0].metadataChanged, true);
  assert.equal(commitPlan(store, moved, { fingerprints: { other: 'fp2' }, thumbs: {} }).ok, true);
  assert.equal(store.state.screens.get('other')?.baseScreenId, 'base2');

  const savedDraft = defaultDraft('GUI', store.state, entry);
  assert.deepEqual([savedDraft.relation, savedDraft.baseScreenId], ['case', 'base2']);
  Object.assign(savedDraft, { included: true, tagId: systemTagId(store.state, 'add'), workerId: 'w', relation: 'standalone' });
  const standalone = buildPlan('GUI', store.state, [entry], { other: savedDraft }, actor, 'relation-standalone');
  assert.equal(standalone.items[0].baseScreenId, null);
  assert.equal(standalone.items[0].metadataChanged, true);
  assert.equal(commitPlan(store, standalone, { fingerprints: { other: 'fp2' }, thumbs: {} }).ok, true);
  assert.equal(store.state.screens.get('other')?.baseScreenId, null);
  assert.equal(store.state.gui.get('other')?.slice(-1)[0]?.base, null);
  assert.deepEqual(depths(), [0, 0]);
  const nested = defaultDraft('GUI', store.state, baseEntry);
  Object.assign(nested, { included: true, tagId: systemTagId(store.state, 'add'), workerId: 'w', relation: 'case', baseScreenId: baseId });
  assert.equal(validateDraft('GUI', store.state, baseEntry, nested).status, 'invalid', '자기 자신을 기본 화면으로 고를 수 없다');
});

test('기본 태그 추가·삭제를 넣고 신규 등록에는 추가 태그를 기본으로 쓴다. 기본 태그는 바꿀 수 없다', () => {
  const { store, screenId } = seeded();
  const add = systemTagId(store.state, 'add')!, del = systemTagId(store.state, 'delete')!;
  const tag = (id: string) => [store.state.tags.get(id)?.name, store.state.tags.get(id)?.colorKey];
  assert.deepEqual([...tag(add), ...tag(del)], ['추가', 'Teal', '삭제', 'Red']);
  assert.equal(store.state.gui.get(screenId)![0].tag.id, add);
  assert.throws(() => updateTag(store, add, { name: '신규' }, actor), /기본 태그/);
  assert.throws(() => updateTag(store, del, { active: false }, actor), /기본 태그/);
  assert.equal(ensureSystemTags(store, actor), false, 'already present');
});

test('변경 무시는 버전·기록 없이 현재 지문을 비교 기준으로 남기고, 프레임 이름만 바꾼 화면은 변경으로 보지 않는다', () => {
  const { store, screenId, frame } = seeded();
  const [noisy] = classify(store.state, [frame('1:1', '[STB_HO_001] 홈', 'fp1-noise')]);
  assert.equal(changeDetected(noisy), true);
  assert.equal(ignoreBlock(store.state, noisy), null);
  acknowledgeChange(store, screenId, 'fp1-noise', actor);
  assert.equal(store.state.screens.get(screenId)!.guiVersion, 1);
  assert.equal(store.state.gui.get(screenId)!.length, 1);
  assert.ok(store.state.audit.some(a => a.action === 'gui.ignoreChange'));
  assert.equal(classify(store.state, [frame('1:1', '[STB_HO_001] 홈', 'fp1-noise')])[0].estimate, 'unchanged');
  // 화면 이름·Screen ID는 기록에만 있다. 프레임 이름을 바꿔도 화면 이름은 그대로다(2026-10-21 사용자 결정).
  const [renamed] = classify(store.state, [frame('1:1', 'Frame 12', 'fp1-noise')]);
  assert.equal(changeDetected(renamed), false);
  assert.equal(entryName(store.state, renamed), '[STB_HO_001] 홈');
});

test('원본이 사라진 화면을 삭제로 배포하면 사용 안 함이 되고, 그 화면만 쓰던 플립북도 사용 안 함이 된다', () => {
  const { store, screenId } = seeded();
  const [fb] = planFlipbooks({ pageId: 'p', rows: [row([screenId])] }, guiScreens(store.state), actor, 2000, () => 'fb1');
  store.put(keys.flipbook(fb.id), fb);
  const [gone] = classify(store.state, []);
  assert.equal(gone.estimate, 'missing');
  const draft = defaultDraft('GUI', store.state, gone);
  assert.deepEqual([draft.retire, draft.tagId], ['delete', systemTagId(store.state, 'delete')]);
  draft.included = true;
  assert.equal(validateDraft('GUI', store.state, gone, draft).status, 'ready', 'description optional, no Screen ID input');
  const plan = buildPlan('GUI', store.state, [gone], { [gone.key]: draft }, actor, 'b2');
  assert.deepEqual([plan.items[0].workType, plan.items[0].needsThumb, plan.counts.deleted], ['deleted', false, 1]);
  assert.equal(commitPlan(store, plan, { fingerprints: {}, thumbs: {} }).ok, true);
  assert.equal(store.state.screens.get(screenId)!.status, 'deleted');
  assert.deepEqual(retireFlipbooks(store, actor), ['fb1']);
  assert.equal(store.state.flipbooks.get('fb1')!.status, 'deleted');
  assert.equal(classify(store.state, [])[0].estimate, 'retired');
});

test('잘라내 붙인 프레임은 삭제·신규 짝으로 나오고, 교체 배포하면 같은 화면의 새 버전이 된다', () => {
  const { store, screenId, frame } = seeded();
  const entries = classify(store.state, [frame('2:1', '[STB_HO_001] 홈', 'fp2')]);
  const old = entries.find(e => e.screenId === screenId)!, moved = entries.find(e => !e.screenId)!;
  assert.deepEqual([old.estimate, old.pairKey, moved.estimate, moved.pairKey], ['missing', moved.key, 'new', screenId]);
  const drafts = { [old.key]: defaultDraft('GUI', store.state, old), [moved.key]: defaultDraft('GUI', store.state, moved) };
  assert.deepEqual([drafts[old.key].retire, drafts[old.key].replacedBy, drafts[moved.key].link, drafts[moved.key].replaceScreenId], ['replace', moved.key, 'replace', screenId]);
  // 이전 화면의 Screen ID·카테고리를 채운다.
  assert.deepEqual([drafts[moved.key].code, drafts[moved.key].categoryId], ['STB_HO_001', 'home']);
  drafts[old.key].included = true;
  Object.assign(drafts[moved.key], { included: true, workerId: 'w', tagId: systemTagId(store.state, 'add'), description: '위치 이동' });
  assert.equal(isPrevious(old, drafts[old.key]), true);
  // 짝이 한쪽만 포함되면 막는다.
  const half = { ...drafts, [old.key]: { ...drafts[old.key], included: false } };
  assert.match(validateDraft('GUI', store.state, moved, half[moved.key], half).errors.join(), /교체 짝/);
  const plan = buildPlan('GUI', store.state, entries, drafts, actor, 'b3');
  assert.deepEqual(plan.blockers, []);
  assert.deepEqual(plan.items.map(i => [i.screenId, i.workType, i.fromVersion, i.toVersion]), [[screenId, 'changed', 1, 2]]);
  commitPlan(store, plan, { fingerprints: { [moved.key]: 'fp2' }, thumbs: { [moved.key]: thumb(screenId, 2) } });
  assert.equal(store.state.screens.get(screenId)!.source?.nodeId, '2:1');
});

test('원본이 남은 화면도 교체할 수 있고, 남은 원본 프레임은 제외 목록에 넣는다', () => {
  const { store, screenId, frame } = seeded();
  const entries = classify(store.state, [frame('1:1', '[STB_HO_001] 홈', 'fp1'), frame('3:1', '홈 개편', 'fp3', null)]);
  const live = entries.find(e => e.screenId === screenId)!, fresh = entries.find(e => !e.screenId)!;
  const drafts: Record<string, Draft> = {
    [live.key]: { ...defaultDraft('GUI', store.state, live), included: true, replacedBy: fresh.key },
    // 신규 등록으로 케이스를 골랐다가 교체로 바꾼 경우: 숨은 화면 관계 값은 배포에 쓰지 않는다.
    [fresh.key]: { ...defaultDraft('GUI', store.state, fresh), included: true, link: 'replace', replaceScreenId: screenId, relation: 'case', baseScreenId: screenId, workerId: 'w', tagId: systemTagId(store.state, 'add')!, description: '개편' },
  };
  fillFromScreen(store.state, drafts[fresh.key], screenId);
  assert.deepEqual([drafts[fresh.key].code, drafts[fresh.key].categoryId], ['STB_HO_001', 'home']);
  // 교체를 풀면 채웠던 값을 되돌린다.
  const undone = { ...drafts[fresh.key] };
  clearFill(store.state, fresh, undone, screenId);
  assert.deepEqual([undone.code, undone.categoryId], [undefined, undefined]);
  const plan = buildPlan('GUI', store.state, entries, drafts, actor, 'b4');
  assert.deepEqual(plan.blockers, []);
  assert.deepEqual(plan.items.map(i => [i.screenId, i.baseScreenId]), [[screenId, null]]);
  assert.deepEqual(plan.exclusions.map(x => [x.nodeId, x.replacedBy]), [['1:1', screenId]]);
  assert.equal(commitPlan(store, plan, { fingerprints: { [fresh.key]: 'fp3' }, thumbs: { [fresh.key]: thumb(screenId, 2) } }).ok, true);
  assert.equal(store.state.screens.get(screenId)!.source?.nodeId, '3:1');
  assert.ok([...store.state.exclusions.values()].some(x => x.nodeId === '1:1' && x.active));
});

test('이미 배포한 화면을 화면이 아님으로 배포하면 프레임을 제외하고 화면과 그 화면만 쓰던 플립북을 사용 안 함으로 바꾼다', () => {
  const { store, screenId, frame } = seeded();
  const [fb] = planFlipbooks({ pageId: 'p', rows: [row([screenId])] }, guiScreens(store.state), actor, 2000, () => 'fb1');
  store.put(keys.flipbook(fb.id), fb);
  const entries = classify(store.state, [frame('1:1', '[STB_HO_001] 홈', 'fp1'), frame('4:1', '[STB_HO_001] 홈 새', 'fp4', null)]);
  const live = entries.find(e => e.screenId === screenId)!, fresh = entries.find(e => !e.screenId)!;
  const drafts: Record<string, Draft> = {
    [live.key]: { ...defaultDraft('GUI', store.state, live), included: true, notScreen: true, excludeReason: '가이드 프레임', workerId: undefined },
    [fresh.key]: { ...defaultDraft('GUI', store.state, fresh), included: true, categoryId: 'home' },
  };
  assert.equal(guiState(live, drafts[live.key]), 'not-screen');
  assert.equal(validateDraft('GUI', store.state, live, drafts[live.key]).status, 'ready', 'no worker, tag or Screen ID input');
  // 사용 안 함이 되는 화면의 Screen ID는 같은 배포의 다른 화면이 쓸 수 있다.
  assert.equal(validateDraft('GUI', store.state, fresh, drafts[fresh.key], drafts, entries).status, 'ready');
  const plan = buildPlan('GUI', store.state, entries, drafts, actor, 'b5');
  assert.deepEqual(plan.blockers, []);
  assert.deepEqual(plan.exclusions.map(x => [x.nodeId, x.screenId, x.reason]), [['1:1', screenId, '가이드 프레임']]);
  assert.deepEqual(plan.items.map(i => [i.workType, i.code]), [['new', 'STB_HO_001']]);

  // 최종 확인 뒤 다른 작업이 화면을 바꿨으면 확정하지 않는다.
  const stale = new Store(memoryKV());
  stale.put(keys.screen(screenId), { ...store.state.screens.get(screenId)!, rev: 99 });
  const blocked = commitPlan(stale, { ...plan, items: [] }, { fingerprints: {}, thumbs: {} });
  assert.deepEqual([blocked.ok, blocked.conflicts.map(c => c.messages.join())], [false, ['다른 작업이 먼저 이 화면을 갱신했습니다. 다시 확인하세요.']]);

  const newId = plan.items[0].screenId;
  assert.equal(commitPlan(store, plan, { fingerprints: { [fresh.key]: 'fp4' }, thumbs: { [fresh.key]: thumb(newId, 1) } }).ok, true);
  const retired = store.state.screens.get(screenId)!;
  assert.deepEqual([retired.status, retired.source, retired.guiVersion, store.state.gui.get(screenId)!.length], ['deleted', null, 1, 1], 'no GUI version is added');
  assert.equal(store.state.screens.get(newId)!.code, 'STB_HO_001');
  assert.ok(store.state.audit.some(a => a.action === 'screen.notScreen' && a.target === screenId));
  assert.deepEqual(retireFlipbooks(store, actor), ['fb1']);
  const after = classify(store.state, [frame('1:1', '[STB_HO_001] 홈', 'fp1'), frame('4:1', '[STB_HO_001] 홈 새', 'fp4', newId)]);
  assert.deepEqual(after.map(e => [e.screenId, e.estimate, e.frame?.nodeId ?? null]), [[screenId, 'retired', null], [newId, 'unchanged', '4:1']]);
  // 제외를 해제하면 그 프레임은 신규 후보로 다시 나온다.
  removeExclusion(store, [...store.state.exclusions.values()].find(x => x.nodeId === '1:1')!.id, actor);
  assert.deepEqual(classify(store.state, [frame('1:1', '[STB_HO_001] 홈', 'fp1')]).filter(e => !e.screenId).map(e => e.frame!.nodeId), ['1:1']);
});

test('UI 목록의 「업데이트된 화면만 보기」는 확인이 필요한 플립북만 남기고, 검색은 Screen ID도 찾는다', () => {
  const store = new Store(memoryKV(), () => 100, () => 'unused');
  let id = 0;
  const made = planFlipbooks({ pageId: 'p', rows: [row(['a']), row(['b'])] }, new Map([screen('a', 'STB_HO_001'), screen('b', 'STB_HO_002')].map(s => [s.uid, s])), actor, 100, () => `fb${++id}`);
  for (const fb of made) store.put(keys.flipbook(fb.id), fb);
  importGuiUpdates(store, 'fb2', new Map([['b', screen('b', 'STB_HO_002', 2)]]), [record('b', 'STB_HO_002', 2)]);
  const view = (changedOnly: boolean, query = '') => buildList('UI', store.state, uiEntries(store.state, new Map()), () => 'excluded', {
    collapsed: new Set(), query, changedOnly, pages: [{ id: 'p', name: 'UI' }], changed: e => needsReview(store.state, e.flipbookId!),
  }).groups.flatMap(g => g.visibleRows.map(r => r.entry.key));
  assert.deepEqual(view(false), ['fb1', 'fb2']);
  assert.deepEqual(view(true), ['fb2']);
  assert.deepEqual(view(false, 'ho_001'), ['fb1']);
});

test('연결이 끊긴 플립북만 목록에서 삭제하고, 프레임이 남은 플립북과 이미 삭제한 플립북은 건너뛴다', () => {
  const store = new Store(memoryKV());
  let n = 0;
  for (const fb of planFlipbooks({ pageId: 'p', rows: [row([], false, '정책 A'), row([], false, '정책 B')] }, new Map(), actor, 1000, () => `fb${++n}`)) store.put(keys.flipbook(fb.id), fb);
  store.reload();
  assert.deepEqual(removeFlipbooks(store, ['fb1', 'fb2', 'fb1'], new Set(['fb2']), actor), ['fb1']);
  assert.deepEqual([store.state.flipbooks.get('fb1')!.status, store.state.flipbooks.get('fb2')!.status], ['deleted', 'active']);
  assert.deepEqual(removeFlipbooks(store, ['fb1'], new Set(), actor), []);
  assert.equal(uiEntries(store.state, new Map()).find(e => e.key === 'fb1')!.estimate, 'retired');
});

test('UI Flipbook은 열 때 프레임이 없는 플립북을 연결 끊김으로 알리고, 삭제 직전 플립북 페이지만 한 번 다시 찾는다', async () => {
  const posted: ToUi[] = [];
  const store = new Store(memoryKV());
  let n = 0;
  for (const fb of planFlipbooks({ pageId: 'ui', rows: [row([], false, '있음'), row([], false, '없음'), row([], false, '복구')] }, new Map(), actor, 1000, () => `fb${++n}`)) store.put(keys.flipbook(fb.id), fb);
  const searched: string[][] = [];
  const frames: Record<string, Record<string, string>> = { ui: { fb1: '1:1' }, other: { fb3: '9:9' } };
  const host = {
    kv: store.kv, mode: 'UI', actor,
    post: (message: ToUi) => posted.push(message),
    pages: () => [{ id: 'ui', name: 'UI' }, { id: 'other', name: '다른 페이지' }],
    listFlipbooks: async (pageIds: string[]) => { searched.push(pageIds); return new Map(pageIds.flatMap(id => Object.entries(frames[id] ?? {}))); },
  } as unknown as Host;
  const controller = new Controller(host);
  await controller.handle({ type: 'ready' });
  const scans = (posted.filter(m => m.type === 'uiScan').pop() as Extract<ToUi, { type: 'uiScan' }>).scans;
  assert.deepEqual(scans.map(u => [u.flipbookId, u.nodeId]), [['fb1', '1:1'], ['fb2', null], ['fb3', null]]);
  frames.ui.fb3 = '9:9'; // 삭제 전에 플립북 페이지로 되돌린 프레임
  const before = searched.length;
  await controller.handle({ type: 'removeFlipbooks', ids: ['fb2', 'fb3'] });
  assert.deepEqual(searched.slice(before), [['ui']], 'only flipbook pages are searched, once');
  const done = posted.filter(m => m.type === 'flipbooksRemoved').pop() as Extract<ToUi, { type: 'flipbooksRemoved' }>;
  assert.deepEqual(done.ids, ['fb2']);
  assert.match(done.message, /복구/);
  assert.deepEqual([...controller.store.state.flipbooks.values()].map(fb => fb.status), ['active', 'deleted', 'active']);
  const after = (posted.filter(m => m.type === 'uiScan').pop() as Extract<ToUi, { type: 'uiScan' }>).scans;
  assert.deepEqual(after.map(u => [u.flipbookId, u.nodeId]), [['fb1', '1:1'], ['fb2', null], ['fb3', '9:9']], 'links come from the same search');
});

test('템플릿에 문제가 있으면 UI Flipbook을 열 때 알리고, 플립북을 만들지 않으며, 반영은 대기로 남긴다', async () => {
  const posted: ToUi[] = [];
  let issues = ['템플릿에 필요한 영역이 없습니다: input-cell-id을(를) 슬롯으로 바꿔 주세요'];
  const store = new Store(memoryKV());
  store.saveProject({ ...store.state.project, templateNodeId: 'tpl', flipbookPageIds: ['ui'], flipbookPageId: 'ui' });
  const [policy] = planFlipbooks({ pageId: 'ui', rows: [row([], false, '정책')] }, new Map(), actor, 1000, () => 'fb1');
  store.put(keys.flipbook(policy.id), policy);
  store.put(keys.delivery('b1', 'fb1'), { batchId: 'b1', kind: 'flipbook', targetId: 'fb1', team: 'UI', version: 0, state: 'pending', error: null, updatedAt: 1000 });
  let synced = 0;
  const host = {
    kv: store.kv, mode: 'UI', actor,
    post: (message: ToUi) => posted.push(message),
    pages: () => [{ id: 'ui', name: 'UI' }],
    listFlipbooks: async () => new Map([['fb1', '1:1']]),
    templateIssues: async () => issues,
    syncFlipbook: async () => { synced++; return { nodeId: '1:1', notes: [] }; },
  } as unknown as Host;
  const controller = new Controller(host);
  await controller.handle({ type: 'ready' });
  assert.deepEqual((posted.find(m => m.type === 'templateIssues') as Extract<ToUi, { type: 'templateIssues' }>).issues, issues);
  await controller.handle({ type: 'createFlipbooks', request: { pageId: 'ui', rows: [row([], false, '새 정책')] } });
  assert.equal(posted.filter(m => m.type === 'error').length, 1);
  assert.equal(controller.store.state.flipbooks.size, 1, 'no flipbook is made from a broken template');
  const report = await controller.deliverFlipbooks({ batchId: 'b1' });
  assert.match(report.skipped ?? '', /슬롯/);
  assert.equal(synced, 0);
  assert.equal(JSON.parse(store.kv.get(keys.delivery('b1', 'fb1'))!).state, 'pending');
  issues = [];
  assert.equal((await controller.deliverFlipbooks({ batchId: 'b1' })).done, 1, 'after the template is fixed the waiting delivery goes through');
  assert.deepEqual((posted.filter(m => m.type === 'templateIssues').pop() as Extract<ToUi, { type: 'templateIssues' }>).issues, []);
});

test('고른 플립북만 설정한 1x 크기로 다시 반영하고 반영한 크기를 남긴다. 사용 안 함·연결 끊김 플립북은 건너뛴다', async () => {
  const posted: ToUi[] = [];
  const store = new Store(memoryKV());
  store.saveProject({ ...store.state.project, templateNodeId: 'tpl', flipbookPageIds: ['ui'], flipbookPageId: 'ui', guiWidth: 1440 });
  let n = 0;
  const made = planFlipbooks({ pageId: 'ui', rows: ['A', 'B', 'C', 'D'].map(t => row([], false, `정책 ${t}`)) }, new Map(), actor, 1000, () => `fb${++n}`);
  for (const fb of made) store.put(keys.flipbook(fb.id), fb.id === 'fb3' ? { ...fb, status: 'deleted' } : fb);
  const synced: [string, number][] = [];
  const host = {
    kv: store.kv, mode: 'UI', actor,
    post: (message: ToUi) => posted.push(message),
    pages: () => [{ id: 'ui', name: 'UI' }],
    templateIssues: async () => [],
    // fb4는 캔버스에 프레임이 없다.
    listFlipbooks: async () => new Map([['fb1', '1:1'], ['fb2', '1:2'], ['fb3', '1:3']]),
    syncFlipbook: async (_: unknown, view: { flipbookId: string; guiWidth: number }) => { synced.push([view.flipbookId, view.guiWidth]); return { nodeId: '1:1', notes: [] }; },
  } as unknown as Host;
  const controller = new Controller(host);
  await controller.handle({ type: 'resizeFlipbooks', ids: ['fb1', 'fb3', 'fb4'] });
  assert.deepEqual(synced, [['fb1', 1440]], 'only the chosen, active, linked flipbook');
  assert.equal(controller.store.state.flipbooks.get('fb1')?.guiWidth, 1440);
  assert.equal(controller.store.state.flipbooks.get('fb2')?.guiWidth, undefined, 'not chosen');
  assert.equal(posted.some(m => m.type === 'error'), false);
  await controller.handle({ type: 'resizeFlipbooks', ids: ['fb4'] });
  assert.equal(synced.length, 1, 'an unlinked flipbook is not recreated');
});

test('플립북 만들기에서 새 행이 잘못되면 기존 플립북도 옮기지 않고, 옮기다 실패하면 이미 옮긴 플립북은 기록에 남긴다', async () => {
  const posted: ToUi[] = [];
  const store = new Store(memoryKV());
  store.saveProject({ ...store.state.project, templateNodeId: 'tpl', flipbookPageIds: ['ui'], flipbookPageId: 'ui' });
  let n = 0;
  for (const fb of planFlipbooks({ pageId: 'ui', rows: [row([], false, '정책 A'), row([], false, '정책 B')] }, new Map(), actor, 1000, () => `fb${++n}`)) store.put(keys.flipbook(fb.id), fb);
  const moved: string[] = [];
  let failOn = '';
  const host = {
    kv: store.kv, mode: 'UI', actor,
    post: (message: ToUi) => posted.push(message),
    pages: () => [{ id: 'ui', name: 'UI' }],
    templateIssues: async () => [],
    listFlipbooks: async () => new Map([['fb1', '1:1'], ['fb2', '1:2']]),
    syncFlipbook: async (_: unknown, view: { flipbookId: string }) => ({ nodeId: view.flipbookId === 'fb1' ? '1:1' : '1:2', notes: [] }),
    moveFlipbook: async (move: { flipbookId: string }) => {
      if (move.flipbookId === failOn) throw new Error('page gone');
      moved.push(move.flipbookId);
      return true;
    },
    ensureDataPage: async () => 'data',
    renderData: async () => {},
  } as unknown as Host;
  const controller = new Controller(host);
  const section = { key: 'custom', name: '새 Section', order: 1 };
  const moves = [{ flipbookId: 'fb1', pageId: 'ui', section, after: null }, { flipbookId: 'fb2', pageId: 'ui', section, after: 'fb1' }];

  await controller.handle({ type: 'createFlipbooks', request: { pageId: 'ui', rows: [row(['missing'])], moves } });
  assert.equal(posted.filter(m => m.type === 'error').length, 1);
  assert.deepEqual(moved, [], 'an invalid new row stops the moves too');
  assert.notEqual(controller.store.state.flipbooks.get('fb1')?.category.key, 'custom');

  failOn = 'fb2';
  await controller.handle({ type: 'createFlipbooks', request: { pageId: 'ui', rows: [], moves } });
  assert.equal(posted.filter(m => m.type === 'error').length, 2);
  assert.deepEqual(moved, ['fb1']);
  assert.equal(controller.store.state.flipbooks.get('fb1')?.category.key, 'custom', 'the frame that moved keeps its new record');
  assert.notEqual(controller.store.state.flipbooks.get('fb2')?.category.key, 'custom', 'the frame that did not move keeps its old record');
});

test('새 플립북의 기본 Section은 그 페이지에 같은 카테고리 Section이 있으면 그 Section 이름을 쓴다(카테고리 이름과 독립)', () => {
  const screens = new Map([['s1', screen('s1', 'STB_HO_001')]]);
  const existing = { key: 'home', name: '메인 화면', order: 1 };
  const [kept] = planFlipbooks({ pageId: 'ui', rows: [row(['s1'])] }, screens, actor, 1000, () => 'fb1', pageId => (pageId === 'ui' ? [existing] : []));
  assert.deepEqual(kept.category, existing);
  const [fresh] = planFlipbooks({ pageId: 'other', rows: [row(['s1'])] }, screens, actor, 1000, () => 'fb2', pageId => (pageId === 'ui' ? [existing] : []));
  assert.equal(fresh.category.name, '홈', 'a page without that Section starts from the category name');
});

test('캔버스에서 다른 Section·페이지로 옮긴 플립북은 기록이 캔버스를 따라가고, 프레임을 원래 Section으로 되돌리지 않는다', async () => {
  const store = new Store(memoryKV());
  store.saveProject({ ...store.state.project, templateNodeId: 'tpl', flipbookPageIds: ['ui', 'ui2'], flipbookPageId: 'ui' });
  let n = 0;
  for (const fb of planFlipbooks({ pageId: 'ui', rows: [row([], false, 'A'), row([], false, 'B'), row([], false, 'C')] }, new Map(), actor, 1000, () => `fb${++n}`)) {
    store.put(keys.flipbook(fb.id), { ...fb, category: fb.id === 'fb3' ? { key: 'epg', name: 'EPG', order: 2 } : { key: 'home', name: '홈', order: 1 } });
  }
  const synced: [string, string, string, string][] = [];
  const host = {
    kv: store.kv, mode: 'UI', actor, post: () => {},
    pages: () => [{ id: 'ui', name: 'UI' }, { id: 'ui2', name: 'UI 2' }],
    templateIssues: async () => [],
    inspectFlipbooks: async () => ({
      found: new Map([['fb1', '1:1'], ['fb2', '1:2'], ['fb3', '1:3']]),
      spots: {
        '1:1': { pageId: 'ui', section: 'home', sectionName: '홈', sectionIndex: 0, index: 0 },
        // fb2: 같은 페이지의 EPG Section으로, fb3: 다른 페이지에 새로 그린 Section으로 옮겼다.
        '1:2': { pageId: 'ui', section: 'epg', sectionName: 'EPG', sectionIndex: 1, index: 1 },
        '1:3': { pageId: 'ui2', section: 'section:new', sectionName: '새 묶음', sectionIndex: 0, index: 0 },
      },
    }),
    listFlipbooks: async () => new Map(),
    syncFlipbook: async (settings: { pageId: string }, view: { flipbookId: string; category: { key: string; name: string } }) => {
      synced.push([view.flipbookId, settings.pageId, view.category.key, view.category.name]);
      return { nodeId: '1:0', notes: [] };
    },
    ensureDataPage: async () => 'data', renderData: async () => {},
  } as unknown as Host;
  const controller = new Controller(host);
  await controller.handle({ type: 'ready' });
  const fb2 = controller.store.state.flipbooks.get('fb2')!;
  const fb3 = controller.store.state.flipbooks.get('fb3')!;
  assert.deepEqual([fb2.pageId, fb2.category], ['ui', { key: 'epg', name: 'EPG', order: 2 }], 'EPG Section의 정렬 순서를 따른다');
  assert.deepEqual([fb3.pageId, fb3.category.key, fb3.category.name], ['ui2', 'section:new', '새 묶음']);
  assert.deepEqual(synced.sort(), [['fb2', 'ui', 'epg', 'EPG'], ['fb3', 'ui2', 'section:new', '새 묶음']], 'Chapter만 다시 반영하며 캔버스의 페이지에서 찾는다');
});

test('캔버스 선택으로 찾은 Section 이름 변경은 Chapter만 다시 쓰고, 전체 반영으로 대신하면 반영 중 표시를 닫는다', async () => {
  for (const light of [true, false]) {
    const posted: ToUi[] = [];
    const store = new Store(memoryKV());
    store.saveProject({ ...store.state.project, templateNodeId: 'tpl', flipbookPageIds: ['ui'], flipbookPageId: 'ui' });
    for (const fb of planFlipbooks({ pageId: 'ui', rows: [row([], false, '정책 A')] }, new Map(), actor, 1000, () => 'fb1')) {
      store.put(keys.flipbook(fb.id), { ...fb, category: { key: 'home', name: '홈', order: 1 } });
    }
    let canvasName = '홈';
    const chapters: unknown[] = [];
    const synced: string[] = [];
    const host = {
      kv: store.kv, mode: 'UI', actor,
      post: (message: ToUi) => posted.push(message),
      pages: () => [{ id: 'ui', name: 'UI' }],
      selectionNodeIds: () => [],
      templateIssues: async () => [],
      inspectFlipbooks: async () => ({ found: new Map([['fb1', '1:1']]), spots: { '1:1': { pageId: 'ui', section: 'home', sectionName: canvasName, sectionIndex: 0, index: 0 } } }),
      listFlipbooks: async () => new Map(),
      syncFlipbook: async (_: unknown, view: { flipbookId: string }) => { synced.push(view.flipbookId); return { nodeId: '1:1', notes: [] }; },
      ...(light ? { syncChapters: async (items: unknown[]) => { chapters.push(...items); } } : {}),
      ensureDataPage: async () => 'data', renderData: async () => {},
    } as unknown as Host;
    const controller = new Controller(host);
    await controller.handle({ type: 'ready' });
    posted.length = 0;
    canvasName = '홈 메인';
    await controller.canvasSelectionChanged();
    await controller.syncCanvasSections();
    assert.equal(controller.store.state.flipbooks.get('fb1')?.category.name, '홈 메인');
    if (light) {
      assert.deepEqual(chapters, [{ pageId: 'ui', flipbookId: 'fb1', name: '홈 메인' }]);
      assert.deepEqual(synced, [], 'GUI·이력까지 다시 반영하지 않는다');
    } else assert.deepEqual(synced, ['fb1']);
    const busy = posted.filter((m): m is Extract<ToUi, { type: 'busy' }> => m.type === 'busy');
    assert.equal(busy[busy.length - 1]?.label ?? null, null, '반영 중 표시가 남지 않는다');
  }
});

test('캔버스에서 바꾼 Section 이름을 플러그인을 열 때 그 Section 플립북의 기록과 Chapter에 반영하고, 캔버스 이름은 덮어쓰지 않는다', async () => {
  const posted: ToUi[] = [];
  const store = new Store(memoryKV());
  store.saveProject({ ...store.state.project, templateNodeId: 'tpl', flipbookPageIds: ['ui'], flipbookPageId: 'ui' });
  let n = 0;
  for (const fb of planFlipbooks({ pageId: 'ui', rows: [row([], false, '정책 A'), row([], false, '정책 B')] }, new Map(), actor, 1000, () => `fb${++n}`)) {
    store.put(keys.flipbook(fb.id), { ...fb, category: fb.id === 'fb1' ? { key: 'home', name: '홈', order: 1 } : { key: 'epg', name: 'EPG', order: 2 } });
  }
  let canvasName = '홈 메인';
  const chapters: [string, string][] = [];
  const host = {
    kv: store.kv, mode: 'UI', actor,
    post: (message: ToUi) => posted.push(message),
    pages: () => [{ id: 'ui', name: 'UI' }],
    templateIssues: async () => [],
    inspectFlipbooks: async () => ({
      found: new Map([['fb1', '1:1'], ['fb2', '1:2']]),
      spots: { '1:1': { section: 'home', sectionName: canvasName, sectionIndex: 0, index: 0 }, '1:2': { section: 'epg', sectionName: 'EPG', sectionIndex: 1, index: 0 } },
    }),
    listFlipbooks: async () => new Map([['fb1', '1:1'], ['fb2', '1:2']]),
    syncFlipbook: async (_: unknown, view: { flipbookId: string; category: { name: string } }) => { chapters.push([view.flipbookId, view.category.name]); return { nodeId: view.flipbookId === 'fb1' ? '1:1' : '1:2', notes: [] }; },
    ensureDataPage: async () => 'data',
    renderData: async () => {},
  } as unknown as Host;
  const controller = new Controller(host);
  await controller.handle({ type: 'ready' });
  assert.equal(controller.store.state.flipbooks.get('fb1')?.category.name, '홈 메인');
  assert.equal(controller.store.state.flipbooks.get('fb2')?.category.name, 'EPG');
  assert.deepEqual(chapters, [['fb1', '홈 메인']], 'only the renamed Section is delivered again (Chapter)');
  assert.equal(posted.some(m => m.type === 'error'), false);

  chapters.length = 0;
  await controller.canvasSelectionChanged().catch(() => {});
  await controller.syncCanvasSections();
  assert.deepEqual(chapters, [], 'nothing to do when the names already match');
  canvasName = '  ';
  await controller.handle({ type: 'ready' });
  assert.equal(controller.store.state.flipbooks.get('fb1')?.category.name, '홈 메인', 'an empty canvas name is not followed');
});
