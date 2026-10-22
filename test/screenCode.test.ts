import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify, type ScannedFrame } from '../src/core/compare.ts';
import { defaultDraft, draftCode, fillAutoCode, renumberAutoCodes } from '../src/core/drafts.ts';
import { importGuiUpdates, planFlipbooks } from '../src/core/flipbooks.ts';
import { guiRecordInfos, guiScreens } from '../src/core/guiScreens.ts';
import { addCategory, ensureCategoryCodes, ensureScreenIdPrefix, ensureScreenIdRules, renumberScreenIds, setCategoryCode, setScreenIdPrefix } from '../src/core/registry.ts';
import { canvasOrder, codeLetters, generateCategoryCode, nextScreenCode } from '../src/core/screenCode.ts';
import { keys, memoryKV, Store } from '../src/core/store.ts';
import type { Category, Screen } from '../src/core/types.ts';
import { Controller, type Host } from '../src/controller.ts';
import type { ToUi } from '../src/core/wire.ts';

const actor = { id: 'u', name: 'Designer' };

function category(store: Store, id: string, name: string, code?: string, order = 1): Category {
  const value: Category = { id, name, order, active: true, ...(code ? { code } : {}) };
  store.put(keys.category(id), value);
  return value;
}

function screen(store: Store, id: string, code: string, categoryId: string | null, extra: Partial<Screen> = {}): Screen {
  const value: Screen = {
    id, rev: 1, code, name: `화면 ${id}`, categoryId, baseScreenId: null, status: 'active', source: { nodeId: `node-${id}`, pageId: 'page' },
    guiVersion: 1, guiTag: null, createdAt: 1, ...extra,
  };
  store.put(keys.screen(id), value);
  return value;
}

const frame = (nodeId: string, name: string): ScannedFrame => ({ nodeId, pageId: 'page', name, width: 100, height: 100, screenTag: null, fingerprint: 'fp', error: null });

test('카테고리 이름에서 두 글자 코드를 만들고, 쓰인 코드는 피한다', () => {
  assert.equal(codeLetters('홈'), 'HOM');
  assert.equal(codeLetters('VOD 상세'), 'VODSANGSE');
  assert.equal(generateCategoryCode('홈', []), 'HO');
  assert.equal(generateCategoryCode('Home', []), 'HO');
  assert.equal(generateCategoryCode('검색', []), 'GE');
  assert.equal(generateCategoryCode('홈', ['HO']), 'HM');
  assert.equal(generateCategoryCode('홈', ['ho', 'HM']), 'HA');
  assert.equal(generateCategoryCode('★', []), 'AA');
});

test('카테고리를 만들 때 코드를 넣고, 코드가 없는 기존 카테고리는 실행 시 채운다', () => {
  const store = new Store(memoryKV());
  category(store, 'home', '홈');
  category(store, 'home2', 'Home', undefined, 2);
  assert.equal(ensureCategoryCodes(store, actor), true);
  assert.equal(store.state.categories.get('home')!.code, 'HO');
  assert.equal(store.state.categories.get('home2')!.code, 'HM');
  assert.equal(ensureCategoryCodes(store, actor), false);
  assert.equal(addCategory(store, '검색', actor).code, 'GE');
});

test('신규 독립 화면은 카테고리를 고르면 {Prefix}_{코드}_{번호}를 자동 입력하고, 직접 입력·대괄호 ID는 유지한다', () => {
  const store = new Store(memoryKV());
  setScreenIdPrefix(store, 'STB', actor);
  category(store, 'home', '홈', 'HO');
  category(store, 'search', '검색', 'SE', 2);
  screen(store, 'a', 'STB_HO_001', 'home');
  screen(store, 'b', 'STB_HO_002-01', 'home');
  screen(store, 'c', 'STB_HO_003', 'home', { status: 'deleted' });
  assert.equal(nextScreenCode(store.state, 'home'), 'STB_HO_004');
  assert.equal(nextScreenCode(store.state, 'home', ['STB_HO_004']), 'STB_HO_005');
  assert.equal(nextScreenCode(store.state, 'search'), 'STB_SE_001');

  const [plain, bracketed] = classify(store.state, [frame('n1', '새 화면'), frame('n2', '[MY_ID] 새 화면')]).filter(e => e.estimate === 'new');
  const draft = defaultDraft('GUI', store.state, plain);
  assert.equal(draftCode(store.state, plain, draft), '');
  draft.categoryId = 'home';
  fillAutoCode(store.state, plain, draft);
  assert.equal(draftCode(store.state, plain, draft), 'STB_HO_004');
  // 카테고리를 바꾸면 자동 입력한 ID도 바꾼다.
  draft.categoryId = 'search';
  fillAutoCode(store.state, plain, draft);
  assert.equal(draft.code, 'STB_SE_001');
  // 케이스로 바꾸면 기본 화면의 다음 케이스 번호
  draft.relation = 'case';
  draft.baseScreenId = 'a';
  fillAutoCode(store.state, plain, draft);
  assert.equal(draft.code, 'STB_HO_001-01');
  // 직접 고친 값은 유지한다.
  draft.relation = 'standalone';
  draft.code = 'CUSTOM_1';
  fillAutoCode(store.state, plain, draft);
  assert.equal(draft.code, 'CUSTOM_1');

  const kept = defaultDraft('GUI', store.state, bracketed);
  kept.categoryId = 'home';
  fillAutoCode(store.state, bracketed, kept);
  assert.equal(draftCode(store.state, bracketed, kept), 'MY_ID');
});

test('자동 입력한 ID는 카테고리마다 배포 화면 다음 번호부터 캔버스 순서대로 다시 매긴다', () => {
  const store = new Store(memoryKV());
  setScreenIdPrefix(store, 'STB', actor);
  category(store, 'home', '홈', 'HO');
  category(store, 'live', 'LIVE', 'LI', 2);
  category(store, 'vod', 'VOD', 'DE', 3);
  screen(store, 'h1', 'STB_HO_001', 'home');
  screen(store, 'h2', 'STB_HO_002', 'home');
  screen(store, 'l1', 'STB_LI_001', 'live');
  const news = classify(store.state, [frame('n1', 'Z'), frame('n2', 'A'), frame('n3', 'C'), frame('n4', '[STB_HO_009] D')]).filter(e => e.estimate === 'new');
  const items = news.map(entry => ({ entry, draft: { ...defaultDraft('GUI', store.state, entry), included: true } }));
  const [a, b, c, d] = items.map(item => item.draft);
  const codes = () => items.map(item => item.draft.code ?? '');
  a.categoryId = 'home'; b.categoryId = 'home'; c.categoryId = 'live'; d.categoryId = 'home';
  renumberAutoCodes(store.state, items);
  // 대괄호 ID(STB_HO_009)는 그대로 두고 그 번호 다음을 쓴다.
  assert.deepEqual(codes(), ['STB_HO_010', 'STB_HO_011', 'STB_LI_002', 'STB_HO_009']);
  d.included = false;
  renumberAutoCodes(store.state, items);
  assert.deepEqual(codes(), ['STB_HO_003', 'STB_HO_004', 'STB_LI_002', 'STB_HO_009']);
  // 앞 화면의 카테고리를 바꾸면 뒤 화면 번호가 당겨진다.
  a.categoryId = 'live';
  renumberAutoCodes(store.state, items);
  assert.deepEqual(codes(), ['STB_LI_002', 'STB_HO_003', 'STB_LI_003', 'STB_HO_009']);
  // 포함을 풀면 그 번호를 비우지 않고, 푼 화면은 다음 번호를 보여 준다.
  a.included = false;
  renumberAutoCodes(store.state, items);
  assert.deepEqual(codes(), ['STB_LI_003', 'STB_HO_003', 'STB_LI_002', 'STB_HO_009']);
  // 카테고리마다 001부터 시작한다.
  a.included = true; a.categoryId = 'vod';
  renumberAutoCodes(store.state, items);
  assert.equal(a.code, 'STB_DE_001');
  // 직접 입력한 ID는 유지한다.
  b.code = 'STB_HO_005';
  c.relation = 'case'; c.baseScreenId = 'l1';
  renumberAutoCodes(store.state, items);
  assert.deepEqual(codes(), ['STB_DE_001', 'STB_HO_005', 'STB_LI_001-01', 'STB_HO_009']);
});

test('Prefix를 저장한 적 없는 프로젝트는 실행 시 기존 화면 ID에서 Prefix·카테고리 코드를 읽는다', () => {
  const store = new Store(memoryKV({ project: JSON.stringify({ scopePageIds: ['page'] }) }));
  category(store, 'vod', 'VOD Details', undefined, 1);
  category(store, 'home', 'HOME', undefined, 2);
  category(store, 'search', '검색', undefined, 3);
  screen(store, 'v1', 'STB_DE_001', 'vod');
  screen(store, 'v2', 'STB_DE_001-01', 'home', { baseScreenId: 'v1' });
  screen(store, 'h1', 'STB_HO_001', 'home');
  screen(store, 'x', 'CUSTOM', 'home');
  assert.equal(ensureScreenIdRules(store, actor), true);
  assert.equal(store.state.project.screenIdPrefix, 'STB');
  assert.deepEqual(['vod', 'home', 'search'].map(id => store.state.categories.get(id)!.code), ['DE', 'HO', 'GE']);
  assert.equal(nextScreenCode(store.state, 'home'), 'STB_HO_002');
  assert.equal(nextScreenCode(store.state, 'search'), 'STB_GE_001');
  assert.equal(ensureScreenIdRules(store, actor), false);

  // 저장한 Prefix는 빈 값이어도 바꾸지 않는다.
  const empty = new Store(memoryKV({ project: JSON.stringify({ scopePageIds: ['page'], screenIdPrefix: '' }) }));
  screen(empty, 'h1', 'STB_HO_001', null);
  assert.equal(ensureScreenIdPrefix(empty, actor), false);
  assert.equal(empty.state.project.screenIdPrefix, '');
  // 배포 화면이 없으면 정하지 않는다.
  const fresh = new Store(memoryKV());
  assert.equal(ensureScreenIdPrefix(fresh, actor), false);
  assert.equal(fresh.readFresh('project'), null);
});

test('카테고리 코드를 고치면 그 카테고리의 배포 화면(케이스 포함) Screen ID를 바로 바꾸고, 다른 형식·사용 안 함 화면은 둔다', () => {
  const store = new Store(memoryKV());
  setScreenIdPrefix(store, 'STB', actor);
  category(store, 'home', '홈', 'HO');
  category(store, 'other', '기타', 'ET', 2);
  screen(store, 'a', 'STB_HO_001', 'home');
  screen(store, 'case', 'STB_HO_001-01', 'other', { baseScreenId: 'a' });
  screen(store, 'manual', 'HOME_MAIN', 'home');
  screen(store, 'gone', 'STB_HO_002', 'home', { status: 'deleted' });
  screen(store, 'et', 'STB_ET_001', 'other');

  const renames = setCategoryCode(store, 'home', 'HM', actor);
  assert.deepEqual(renames.map(r => [r.from, r.to]).sort(), [['STB_HO_001', 'STB_HM_001'], ['STB_HO_001-01', 'STB_HM_001-01']]);
  const code = (id: string) => store.state.screens.get(id)!.code;
  assert.equal(code('a'), 'STB_HM_001');
  assert.equal(code('case'), 'STB_HM_001-01');
  assert.equal(code('manual'), 'HOME_MAIN');
  assert.equal(code('gone'), 'STB_HO_002');
  assert.equal(code('et'), 'STB_ET_001');
  assert.equal(store.state.screens.get('a')!.rev, 2);
  assert.equal(store.state.categories.get('home')!.code, 'HM');
  assert.ok(store.state.audit.some(a => a.action === 'screen.code' && a.target === 'a'));
  // 새 화면 번호는 사용 안 함 화면의 이전 ID와 겹치지 않는다.
  assert.equal(nextScreenCode(store.state, 'home'), 'STB_HM_002');

  // Prefix를 바꾸면 모든 카테고리의 규칙 ID를 바꾼다.
  setScreenIdPrefix(store, 'MOB', actor);
  assert.equal(code('a'), 'MOB_HM_001');
  assert.equal(code('case'), 'MOB_HM_001-01');
  assert.equal(code('et'), 'MOB_ET_001');
  assert.equal(code('manual'), 'HOME_MAIN');
});

test('겹치는 코드·잘못된 코드·바꾸면 ID가 겹치는 경우는 저장하지 않는다', () => {
  const store = new Store(memoryKV());
  category(store, 'home', '홈', 'HO');
  category(store, 'search', '검색', 'SE', 2);
  screen(store, 'a', 'HO_001', 'home');
  screen(store, 'taken', 'XX_001', 'search');
  assert.throws(() => setCategoryCode(store, 'home', 'se', actor), /다른 카테고리가 쓰는 코드/);
  assert.throws(() => setCategoryCode(store, 'home', 'H_O', actor), /영문·숫자/);
  assert.throws(() => setScreenIdPrefix(store, 'S T B', actor), /플랫폼 Prefix/);
  assert.throws(() => setCategoryCode(store, 'home', 'XX', actor), /겹칩니다: XX_001/);
  assert.equal(store.state.categories.get('home')!.code, 'HO');
  assert.equal(store.state.screens.get('a')!.code, 'HO_001');
  // Prefix가 없던 ID도 Prefix를 넣으면 바뀐다.
  setScreenIdPrefix(store, 'STB', actor);
  assert.equal(store.state.screens.get('a')!.code, 'STB_HO_001');
});

test('설정에서 코드를 저장하면 기록·썸네일 이름과 플립북의 Screen ID를 맞추고, 원본 프레임 이름은 그대로 둔다', async () => {
  const kv = memoryKV({ project: JSON.stringify({ scopePageIds: ['page'], screenIdPrefix: 'STB' }) });
  const seed = new Store(kv);
  category(seed, 'home', '홈', 'HO');
  screen(seed, 'a', 'STB_HO_001', 'home');
  screen(seed, 'b', 'STB_HO_002', 'home');
  const names = new Map([['node-a', '[STB_HO_001] 이름 수정 중'], ['node-b', '[OTHER] 화면 b']]);
  const posted: ToUi[] = [];
  const thumbs = new Map<string, string>();
  const host = {
    kv, mode: 'GUI', actor, post: (message: ToUi) => posted.push(message), pages: () => [{ id: 'page', name: '원본' }],
    renameSource: async (nodeId: string, name: string | ((current: string) => string)) => {
      names.set(nodeId, typeof name === 'function' ? name(names.get(nodeId)!) : name);
    },
    renameThumbnails: async (labels: Map<string, string>) => { for (const [id, label] of labels) thumbs.set(id, label); },
  } as unknown as Host;
  const controller = new Controller(host);
  await controller.handle({ type: 'ready' });
  await controller.handle({ type: 'admin', action: { op: 'setCategoryCode', id: 'home', code: 'HM' } });
  // 화면 이름·Screen ID는 기록에만 둔다(2026-10-21 사용자 결정).
  assert.equal(names.get('node-a'), '[STB_HO_001] 이름 수정 중');
  assert.equal(names.get('node-b'), '[OTHER] 화면 b');
  // 썸네일 이름은 프레임 이름과 관계없이 화면의 현재 Screen ID·이름을 쓴다.
  assert.deepEqual([...thumbs], [['a', '[STB_HM_001] 화면 a'], ['b', '[STB_HM_002] 화면 b']]);
  assert.ok(posted.some(m => m.type === 'notice' && m.message.startsWith('2개 화면의 Screen ID')));

  // 플립북은 GUI 갱신 반영에서 화면의 현재 Screen ID를 받는다.
  const store = new Store(kv);
  const [fb] = planFlipbooks({ pageId: 'page', rows: [{ uids: [], multi: false, scale: 1, title: '홈' }] }, new Map(), actor, 1, () => 'fb');
  store.put(keys.flipbook('fb'), { ...fb, screens: [{ uid: 'a', code: 'STB_HO_001', name: '화면 a', version: 1 }] });
  const result = importGuiUpdates(store, 'fb', guiScreens(store.state), guiRecordInfos(store.state, new Set(['a'])));
  assert.equal(result.changed, true);
  assert.equal(store.state.flipbooks.get('fb')!.screens[0].code, 'STB_HM_001');
});

test('번호 다시 매기기는 카테고리마다 캔버스 배치 순서로 001부터 매기고, 케이스·다른 화면 번호·위치 없는 화면을 처리한다', () => {
  const store = new Store(memoryKV({ project: JSON.stringify({ scopePageIds: ['page'], screenIdPrefix: '' }) }));
  category(store, 'set', '설정', 'SO');
  category(store, 'my', 'MY', 'MY', 2);
  screen(store, 's41', 'SO_041', 'set');
  screen(store, 's42', 'SO_042', 'set');
  screen(store, 's43', 'SO_043', 'set');
  screen(store, 's50', 'SO_050', 'set');
  screen(store, 'case', 'SO_041-01', 'set', { baseScreenId: 's41' });
  screen(store, 'm44', 'MY_044', 'my');
  screen(store, 'm45', 'MY_045', 'my');
  screen(store, 'gone', 'MY_002', 'my', { status: 'deleted' });
  screen(store, 'manual', 'MY_MAIN', 'my');
  const at = (page: number, x: number, y: number) => ({ page, x, y, height: 1080 });
  // 첫 줄은 위쪽이 조금 어긋나도 같은 줄로 보고 왼쪽부터, 다음 페이지는 뒤에 둔다. MY_045는 원본 프레임을 찾지 못했다.
  const positions = new Map([['s41', at(0, 2000, 10)], ['s43', at(0, 0, 0)], ['s42', at(0, 0, 1500)], ['s50', at(1, 0, -500)], ['case', at(0, 4000, 0)], ['m44', at(0, 0, 3000)]]);
  const renames = renumberScreenIds(store, positions, actor);
  const code = (id: string) => store.state.screens.get(id)!.code;
  assert.deepEqual(['s43', 's41', 'case', 's42', 's50'].map(code), ['SO_001', 'SO_002', 'SO_002-01', 'SO_003', 'SO_004']);
  // 사용 안 함 화면이 가진 MY_002는 건너뛰고, 다른 형식 ID는 그대로 둔다.
  assert.deepEqual(['m44', 'm45', 'gone', 'manual'].map(code), ['MY_001', 'MY_003', 'MY_002', 'MY_MAIN']);
  assert.equal(renames.length, 7);
  assert.ok(store.state.audit.some(a => a.action === 'project.renumberScreenIds'));
  assert.deepEqual(renumberScreenIds(store, positions, actor), []);

  // 세로로 긴 프레임이 줄 첫머리여도 그 아래 줄 프레임은 다음 줄이다.
  const frames = [['tall', 0, 0, 7775], ['right', 2000, 0, 1080], ['below', 2000, 1700, 1080], ['next', 4000, 5, 1080]] as const;
  const order = canvasOrder([...frames], f => ({ page: 0, x: f[1], y: f[2], height: f[3] })).map(f => f[0]);
  assert.deepEqual(order, ['tall', 'right', 'next', 'below']);
});

test('설정의 번호 다시 매기기는 썸네일 이름도 맞추고 원본 프레임 이름은 그대로 두며, 바꿀 것이 없으면 알린다', async () => {
  const kv = memoryKV({ project: JSON.stringify({ scopePageIds: ['page'], screenIdPrefix: 'STB' }) });
  const seed = new Store(kv);
  category(seed, 'home', '홈', 'HO');
  screen(seed, 'a', 'STB_HO_141', 'home');
  screen(seed, 'b', 'STB_HO_142', 'home');
  const names = new Map([['node-a', '[STB_HO_141] 화면 a'], ['node-b', '[STB_HO_142] 화면 b']]);
  const posted: ToUi[] = [];
  const host = {
    kv, mode: 'GUI', actor, post: (message: ToUi) => posted.push(message), pages: () => [{ id: 'page', name: '원본' }],
    renameSource: async (nodeId: string, name: string | ((current: string) => string)) => {
      names.set(nodeId, typeof name === 'function' ? name(names.get(nodeId)!) : name);
    },
    canvasPositions: async () => new Map([['node-a', { page: 0, x: 0, y: 2000, height: 1080 }], ['node-b', { page: 0, x: 0, y: 0, height: 1080 }]]),
    renameThumbnails: async (labels: Map<string, string>) => { for (const [id, label] of labels) thumbs.set(id, label); },
  } as unknown as Host;
  const thumbs = new Map<string, string>();
  const controller = new Controller(host);
  await controller.handle({ type: 'ready' });
  await controller.handle({ type: 'admin', action: { op: 'renumberScreenIds' } });
  assert.equal(names.get('node-b'), '[STB_HO_142] 화면 b');
  assert.equal(names.get('node-a'), '[STB_HO_141] 화면 a');
  assert.equal(thumbs.get('b'), '[STB_HO_001] 화면 b');
  assert.equal(thumbs.get('a'), '[STB_HO_002] 화면 a');
  assert.ok(posted.some(m => m.type === 'notice' && m.message.startsWith('2개 화면의 Screen ID')));
  await controller.handle({ type: 'admin', action: { op: 'renumberScreenIds' } });
  assert.ok(posted.some(m => m.type === 'notice' && m.message.startsWith('다시 매길 Screen ID가 없습니다')));
});
