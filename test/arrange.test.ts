import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GuiScreenInfo } from '../src/core/guiScreens.ts';
import { customSection, planFlipbooks, renameFlipbook } from '../src/core/flipbooks.ts';
import { flipbookView, POLICY_CATEGORY_KEY } from '../src/core/flipbook.ts';
import { arrangeFlipbooks, buildList, placeDrafts } from '../src/core/list.ts';
import { uiEntries } from '../src/core/compare.ts';
import { keys, memoryKV, Store } from '../src/core/store.ts';
import { Controller, type Host } from '../src/controller.ts';
import type { ToUi } from '../src/core/wire.ts';

// 플립북 목록에 합친 플립북 만들기(2026-10-21): Section 선택, 캔버스 순서, 만들기 전 새 플립북의 자리, 제목 변경

const actor = { id: 'u', name: 'Designer' };
const screen = (uid: string, code: string): GuiScreenInfo => ({
  uid, code, name: `화면 ${uid}`, category: { id: 'home', name: '홈', order: 1 }, status: 'active', isCase: false, version: 1,
  thumb: { hash: `${uid}-1`, width: 480, height: 270 }, sourceNodeId: `node-${uid}`,
});
const row = (uids: string[], title?: string) => ({ uids, multi: uids.length > 1, scale: 1 as const, title });
type Spot = { section: string; sectionIndex: number; index: number };

test('새 플립북은 고른 페이지·Section에 만들고, Section 이름이 비면 만들지 않는다', () => {
  const screens = new Map([screen('a', 'STB_HO_001')].map(s => [s.uid, s]));
  let id = 0;
  const next = () => `fb${++id}`;
  const banner = customSection(' 배너 ', 'section:banner');
  const made = planFlipbooks({ pageId: 'p1', rows: [row(['a']), { ...row(['a']), pageId: 'p2', section: banner }, { ...row([], '정책'), section: { key: 'home', name: '홈', order: 1 } }] }, screens, actor, 100, next);
  assert.deepEqual(made.map(f => [f.pageId, f.category.key, f.category.name]), [['p1', 'home', '홈'], ['p2', 'section:banner', '배너'], ['p1', 'home', '홈']]);
  assert.equal(made[2].kind, 'policy', '정책 플립북도 고른 Section에 놓는다');
  assert.throws(() => planFlipbooks({ pageId: 'p1', rows: [{ ...row(['a']), section: customSection('  ', 'section:x') }] }, screens, actor, 100, next), /섹션 이름/);
});

test('UI 목록은 캔버스의 Section·플립북 순서를 따르고, 위치를 모르는 플립북은 Section 뒤에 Screen ID 순으로 둔다', () => {
  const store = new Store(memoryKV());
  let id = 0;
  const screens = new Map([screen('a', 'STB_HO_001'), screen('b', 'STB_HO_002'), screen('c', 'STB_HO_003')].map(s => [s.uid, s]));
  const banner = customSection('배너', 'section:banner');
  const made = planFlipbooks({ pageId: 'p', rows: [row(['a']), row(['b']), row(['c']), { ...row(['a']), section: banner }] }, screens, actor, 100, () => `fb${++id}`);
  for (const fb of made) store.put(keys.flipbook(fb.id), fb);
  const pages = [{ id: 'p', name: 'UI' }];
  // 캔버스: 배너 Section이 위, 홈 Section에는 fb2 → fb1 순서. fb3은 프레임을 찾지 못했다.
  const spots: Record<string, Spot> = {
    fb4: { section: 'section:banner', sectionIndex: 0, index: 0 }, fb2: { section: 'home', sectionIndex: 1, index: 0 }, fb1: { section: 'home', sectionIndex: 1, index: 1 },
  };
  const groups = arrangeFlipbooks(store.state, pages, fbId => spots[fbId]);
  assert.deepEqual(groups.map(g => [g.name, g.items]), [['UI · 배너', ['fb4']], ['UI · 홈', ['fb2', 'fb1', 'fb3']]]);
  const listed = buildList('UI', store.state, uiEntries(store.state, new Map()), () => 'excluded', { collapsed: new Set(), query: '', changedOnly: false, pages, spots: fbId => spots[fbId] });
  assert.deepEqual(listed.groups.map(g => g.rows.map(r => r.entry.key)), [['fb4'], ['fb2', 'fb1', 'fb3']], '목록도 같은 순서');
  // 위치를 모르면 이전처럼 Screen ID 순이다.
  assert.deepEqual(arrangeFlipbooks(store.state, pages).find(g => g.section.key === 'home')!.items, ['fb1', 'fb2', 'fb3']);
  // 캔버스에서 다른 Section으로 드래그해 놓은 프레임은 기록의 Section 기준으로 묶고 위치를 모르는 것으로 본다.
  spots.fb1 = { section: 'section:banner', sectionIndex: 0, index: 1 };
  assert.deepEqual(arrangeFlipbooks(store.state, pages, fbId => spots[fbId]).find(g => g.section.key === 'home')!.items, ['fb2', 'fb1', 'fb3']);
});

test('만들기 전 새 플립북을 정한 자리에 끼워 넣고, 없는 Section은 그 페이지의 마지막 Section 뒤에 둔다', () => {
  const home = { key: 'home', name: '홈', order: 1 };
  const pages = [{ id: 'p1', name: 'UI 1' }, { id: 'p2', name: 'UI 2' }];
  const groups = [
    { key: 'p1|home', pageId: 'p1', section: home, name: 'UI 1 · 홈', items: ['fb1', 'fb2'] },
    { key: 'p2|home', pageId: 'p2', section: home, name: 'UI 2 · 홈', items: ['fb3'] },
  ];
  const placed = placeDrafts(groups, [
    { key: 'new:1', pageId: 'p1', section: home, after: 'fb1' },
    { key: 'new:2', pageId: 'p1', section: home, after: 'new:1' },
    { key: 'new:3', pageId: 'p1', section: home, after: null },
    { key: 'new:4', pageId: 'p1', section: home },
    { key: 'new:5', pageId: 'p1', section: customSection('팝업', 'section:popup') },
    { key: 'new:6', pageId: 'p1', section: home, after: 'gone' },
  ], pages);
  assert.deepEqual(placed.map(g => [g.key, g.items]), [
    ['p1|home', ['new:3', 'fb1', 'new:1', 'new:2', 'fb2', 'new:4', 'new:6']],
    ['p1|section:popup', ['new:5']],
    ['p2|home', ['fb3']],
  ]);
  assert.equal(placed[1].name, 'UI 1 · 팝업');
  assert.deepEqual(groups[0].items, ['fb1', 'fb2'], '원래 목록은 바꾸지 않는다');
  // 플립북이 없는 페이지의 새 Section은 페이지 순서대로 들어간다.
  const first = placeDrafts([groups[1]], [{ key: 'new:7', pageId: 'p1', section: home }], pages);
  assert.deepEqual(first.map(g => g.key), ['p1|home', 'p2|home']);
});

test('플립북 제목을 바꾸고, 비우면 첫 화면 이름(화면이 없으면 「새 플립북」)으로 돌아간다', () => {
  const store = new Store(memoryKV());
  let id = 0;
  const made = planFlipbooks({ pageId: 'p', rows: [row(['a']), row([], '정책')] }, new Map([screen('a', 'STB_HO_001')].map(s => [s.uid, s])), actor, 100, () => `fb${++id}`);
  for (const fb of made) store.put(keys.flipbook(fb.id), fb);
  const renamed = renameFlipbook(store, 'fb1', '  홈 메인  ', actor);
  assert.deepEqual([renamed.title, renamed.autoTitle, renamed.rev], ['홈 메인', false, 2]);
  assert.ok(renamed.titleNames.includes('홈 메인'), '플러그인이 쓴 제목으로 남긴다');
  assert.deepEqual([renameFlipbook(store, 'fb1', '', actor).title, store.state.flipbooks.get('fb1')!.autoTitle], ['화면 a', true]);
  assert.deepEqual([renameFlipbook(store, 'fb2', ' ', actor).title, store.state.flipbooks.get('fb2')!.autoTitle], ['새 플립북', true]);
  assert.equal(flipbookView(store.state, 'fb1').name, '화면 a');
});

test('항목마다 페이지·Section·자리를 정해 만들고, 같은 요청의 앞 행 뒤에 놓을 수 있다. 제목 변경은 캔버스 제목도 바꾼다', async () => {
  const posted: ToUi[] = [];
  const store = new Store(memoryKV());
  store.saveProject({ ...store.state.project, templateNodeId: 'tpl', flipbookPageIds: ['ui', 'ui2'], flipbookPageId: 'ui' });
  const [existing] = planFlipbooks({ pageId: 'ui', rows: [row([], '기존')] }, new Map(), actor, 100, () => 'old');
  store.put(keys.flipbook(existing.id), existing);
  const views: { flipbookId: string; pageId: string; section: string; after: string | null | undefined; retitle?: boolean }[] = [];
  const host = {
    kv: store.kv, mode: 'UI', actor,
    post: (message: ToUi) => posted.push(message),
    pages: () => [{ id: 'ui', name: 'UI' }, { id: 'ui2', name: 'UI 2' }, { id: 'gui', name: 'GUI' }],
    templateIssues: async () => [],
    listFlipbooks: async () => new Map(views.map(v => [v.flipbookId, `n:${v.flipbookId}`])),
    flipbookSpots: async () => Object.fromEntries(views.map((v, i) => [`n:${v.flipbookId}`, { section: v.section, sectionIndex: 0, index: i }])),
    syncFlipbook: async (settings: { pageId: string }, view: { flipbookId: string; category: { key: string }; after?: string | null; retitle?: boolean }) => {
      views.push({ flipbookId: view.flipbookId, pageId: settings.pageId, section: view.category.key, after: view.after, retitle: view.retitle });
      return { nodeId: `n:${view.flipbookId}`, notes: [] };
    },
    uiFingerprint: async () => ({ fingerprint: null, error: null }),
    ensureDataPage: async () => 'data', renderData: async () => {},
  } as unknown as Host;
  const controller = new Controller(host);
  const policy = { key: POLICY_CATEGORY_KEY, name: '정책', order: 1 };
  await controller.handle({ type: 'createFlipbooks', request: { pageId: 'ui', rows: [
    { ...row([], '첫째'), section: policy, after: 'old' },
    { ...row([], '둘째'), section: policy, after: 'row:0' },
    { ...row([], '다른 페이지'), pageId: 'ui2', section: customSection('배너', 'section:b'), after: null },
  ] } });
  assert.equal(posted.some(m => m.type === 'error'), false, JSON.stringify(posted.filter(m => m.type === 'error')));
  const made = [...controller.store.state.flipbooks.values()].filter(fb => fb.id !== 'old');
  assert.deepEqual(views.map(v => [v.pageId, v.section, v.after]), [['ui', POLICY_CATEGORY_KEY, 'old'], ['ui', POLICY_CATEGORY_KEY, made[0].id], ['ui2', 'section:b', null]]);
  const scans = (posted.filter(m => m.type === 'uiScan').pop() as Extract<ToUi, { type: 'uiScan' }>).scans;
  assert.ok(scans.filter(s => s.flipbookId !== 'old').every(s => s.spot), '만든 뒤 캔버스 위치를 함께 보낸다');
  // 지정하지 않은 페이지에는 만들지 않는다.
  const before = controller.store.state.flipbooks.size;
  await controller.handle({ type: 'createFlipbooks', request: { pageId: 'ui', rows: [{ ...row([], '잘못'), pageId: 'gui' }] } });
  assert.equal(posted[posted.length - 2]?.type, 'error');
  assert.equal(controller.store.state.flipbooks.size, before);
  views.length = 0;
  await controller.handle({ type: 'renameFlipbook', id: made[0].id, title: '첫 정책' });
  assert.deepEqual(views.map(v => [v.flipbookId, v.retitle]), [[made[0].id, true]]);
  assert.equal(controller.store.state.flipbooks.get(made[0].id)?.title, '첫 정책');
});

test('목록에서 옮긴 기존 플립북을 목록 순서대로 캔버스에서 옮기고, Section이 바뀐 플립북만 다시 반영한다. 잘못된 요청은 아무것도 옮기지 않는다', async () => {
  const posted: ToUi[] = [];
  const store = new Store(memoryKV());
  store.saveProject({ ...store.state.project, templateNodeId: 'tpl', flipbookPageIds: ['ui', 'ui2'], flipbookPageId: 'ui' });
  const home = { key: 'home', name: '홈', order: 1 };
  const banner = customSection('배너', 'section:banner');
  let id = 0;
  const made = planFlipbooks({ pageId: 'ui', rows: [{ ...row([], 'A'), section: home }, { ...row([], 'B'), section: home }, { ...row([], 'C'), section: banner }] }, new Map(), actor, 100, () => `fb${++id}`);
  for (const fb of made) store.put(keys.flipbook(fb.id), fb);
  const moved: { flipbookId: string; fromPageId: string; pageId: string; section: string; after: string | null }[] = [];
  const synced: string[] = [];
  const host = {
    kv: store.kv, mode: 'UI', actor,
    post: (message: ToUi) => posted.push(message),
    pages: () => [{ id: 'ui', name: 'UI' }, { id: 'ui2', name: 'UI 2' }, { id: 'gui', name: 'GUI' }],
    templateIssues: async () => [],
    listFlipbooks: async () => new Map(made.map(fb => [fb.id, `n:${fb.id}`])),
    flipbookSpots: async () => ({}),
    moveFlipbook: async (move: { flipbookId: string; fromPageId: string; pageId: string; category: { key: string }; after: string | null }) => {
      moved.push({ flipbookId: move.flipbookId, fromPageId: move.fromPageId, pageId: move.pageId, section: move.category.key, after: move.after });
      return true;
    },
    syncFlipbook: async (_: unknown, view: { flipbookId: string }) => { synced.push(view.flipbookId); return { nodeId: `n:${view.flipbookId}`, notes: [] }; },
    uiFingerprint: async () => ({ fingerprint: null, error: null }),
    ensureDataPage: async () => 'data', renderData: async () => {},
  } as unknown as Host;
  const controller = new Controller(host);
  // 다른 페이지로 옮기는 요청에 플립북 페이지가 아닌 페이지가 있으면 아무것도 옮기지 않는다.
  await controller.handle({ type: 'createFlipbooks', request: { pageId: 'ui', rows: [], moves: [{ flipbookId: 'fb2', pageId: 'gui', section: home, after: null }] } });
  assert.ok(posted.some(m => m.type === 'error'));
  assert.deepEqual(moved, []);
  posted.length = 0;
  // B를 홈 맨 앞으로, C(배너)를 다른 페이지의 홈 Section B 다음으로 옮긴다. 새 플립북 없이 옮기기만 한다.
  await controller.handle({ type: 'createFlipbooks', request: { pageId: 'ui', rows: [], moves: [
    { flipbookId: 'fb2', pageId: 'ui', section: home, after: null },
    { flipbookId: 'fb3', pageId: 'ui2', section: home, after: 'fb2' },
  ] } });
  assert.equal(posted.some(m => m.type === 'error'), false, JSON.stringify(posted.filter(m => m.type === 'error')));
  assert.deepEqual(moved, [
    { flipbookId: 'fb2', fromPageId: 'ui', pageId: 'ui', section: 'home', after: null },
    { flipbookId: 'fb3', fromPageId: 'ui', pageId: 'ui2', section: 'home', after: 'fb2' },
  ], '목록 순서대로, 원래 페이지에서 옮긴다');
  const c = controller.store.state.flipbooks.get('fb3')!;
  assert.deepEqual([c.pageId, c.category.key, c.category.name], ['ui2', 'home', '홈'], '옮긴 페이지·Section을 기록한다');
  assert.deepEqual(synced, ['fb3'], 'Section이 바뀐 플립북만 다시 반영해 Chapter를 맞춘다');
  const done = posted.find(m => m.type === 'flipbooksCreated') as Extract<ToUi, { type: 'flipbooksCreated' }>;
  assert.deepEqual([done.ids, done.moved], [[], ['fb2', 'fb3']]);
});

test('캔버스 위치는 페이지의 루트 Section을 위에서부터, 안의 Section은 없는 것으로 보고 루트 Section 기준으로 센다', async () => {
  const { flipbookSpots } = await import('../src/figma/flipbook.ts');
  const node = (values: Record<string, string>) => ({
    getSharedPluginData: (_ns: string, key: string) => values[key] ?? '',
    setSharedPluginData: (_ns: string, key: string, value: string) => { values[key] = value; },
  });
  const frame = (id: string, flipbook: string, x: number, y: number) => ({ id, type: 'FRAME', x, y, ...node({ flipbookOf: flipbook }) });
  const section = (key: string, x: number, y: number, children: unknown[], name = key) => ({ type: 'SECTION', name, x, y, children, ...node(key ? { categoryOf: key } : {}) });
  const drawn = section('', 0, 9000, [frame('9:1', 'fb9', 3000, 0), section('', 0, 1000, [frame('9:2', 'fb8', 100, 0)])], '직접 만든 Section');
  const copy = section('home', 0, 7000, [frame('7:1', 'fb7', 0, 0)], '홈 복사본');
  const empty = section('', 0, 20000, [], '빈 Section');
  const page = {
    id: 'p', type: 'PAGE', loadAsync: async () => {},
    children: [
      // 홈 Section 안에 사용자가 만든 Section(안쪽 기준 (0, 0)이 루트 기준 (0, 900))
      section('home', 0, 5000, [frame('2:2', 'fb2', 900, 300), frame('2:1', 'fb1', 300, 300), section('', 0, 900, [frame('2:3', 'fb3', 300, 300)])], '홈 화면'),
      section('section:banner', 0, 0, [frame('1:1', 'fb4', 300, 300)]),
      drawn, copy, empty,
    ],
  };
  (globalThis as unknown as { figma: unknown }).figma = { getNodeByIdAsync: async (id: string) => (id === 'p' ? page : null) };
  const spots = await flipbookSpots('guiuipublish', ['p', 'missing']);
  const drawnKey = drawn.getSharedPluginData('guiuipublish', 'categoryOf');
  const copyKey = copy.getSharedPluginData('guiuipublish', 'categoryOf');
  assert.match(drawnKey, /^section:/, '플립북이 든 직접 만든 Section에 표식을 붙인다');
  assert.ok(copyKey.startsWith('section:') && copyKey !== drawnKey, '같은 키의 아래쪽 Section(복제본)은 새 키를 받는다');
  assert.equal(empty.getSharedPluginData('guiuipublish', 'categoryOf'), '', '플립북이 없는 Section은 그대로 둔다');
  assert.deepEqual(spots, {
    '1:1': { pageId: 'p', section: 'section:banner', sectionName: 'section:banner', sectionIndex: 0, index: 0 },
    '2:1': { pageId: 'p', section: 'home', sectionName: '홈 화면', sectionIndex: 1, index: 0 },
    '2:2': { pageId: 'p', section: 'home', sectionName: '홈 화면', sectionIndex: 1, index: 1 },
    '2:3': { pageId: 'p', section: 'home', sectionName: '홈 화면', sectionIndex: 1, index: 2 },
    '7:1': { pageId: 'p', section: copyKey, sectionName: '홈 복사본', sectionIndex: 2, index: 0 },
    '9:1': { pageId: 'p', section: drawnKey, sectionName: '직접 만든 Section', sectionIndex: 3, index: 0 },
    '9:2': { pageId: 'p', section: drawnKey, sectionName: '직접 만든 Section', sectionIndex: 3, index: 1 },
  });
});
