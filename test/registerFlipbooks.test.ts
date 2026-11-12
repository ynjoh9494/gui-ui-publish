import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planExistingFlipbooks, EXISTING_KEY } from '../src/core/registerFlipbooks.ts';
import { Store, memoryKV, keys } from '../src/core/store.ts';
import { Controller, type Host } from '../src/controller.ts';
import { selectedFlipbooks, markExistingFlipbooks } from '../src/figma/registerFlipbooks.ts';
import { FLIPBOOK_KEY, NODE_KEY } from '../src/figma/flipbook.ts';
import { LINKS_KEY, PART_KEY, parseLinks } from '../src/core/templateParts.ts';
import type { ToUi } from '../src/core/wire.ts';

const actor = { id: 'u', name: 'Designer' };
const selection = [{ nodeId: '1:2', pageId: 'p', title: 'Manual book', flipbookId: null }];
const store = () => new Store(memoryKV({ project: JSON.stringify({ flipbookPageIds: ['p'], templateNodeId: 'tpl' }) }));

test('manual registration preserves title, is idempotent after reload, and accepts identical names as distinct frames', () => {
  const s = store();
  const result = planExistingFlipbooks(s.state, [...selection, ...selection, { ...selection[0], nodeId: '1:3' }], actor, 10);
  assert.equal(result.length, 2);
  assert.equal(result[0].record.title, 'Manual book');
  assert.equal(result[0].record.autoTitle, false);
  for (const item of result) s.put(keys.flipbook(item.record.id), item.record);
  s.reload();
  assert.equal(planExistingFlipbooks(s.state, selection, actor, 20).length, 0);
  assert.equal(planExistingFlipbooks(s.state, [{ ...selection[0], flipbookId: result[0].record.id }], actor, 20).length, 0);
});

test('registration rejects an empty selection, the configured template, and unconfigured pages before making records', () => {
  const s = store();
  for (const nodes of [[], [{ ...selection[0], nodeId: 'tpl' }], [...selection, { ...selection[0], pageId: 'other' }]])
    assert.throws(() => planExistingFlipbooks(s.state, nodes, actor, 0));
  assert.equal(s.state.flipbooks.size, 0);
});

test('registration separates existing Screen IDs from titles and keeps them after reopening', () => {
  const s = store();
  const cases = [
    ['ST_SE_001 · 검색', 'ST_SE_001', '검색'],
    ['ST_LI_MV_002 · 멀티뷰 - 포커스', 'ST_LI_MV_002', '멀티뷰 - 포커스'],
    ['ST_SE_POLICY_02 · 음성 검색', 'ST_SE_POLICY_02', '음성 검색'],
    ['[STB_HO_001] 홈', 'STB_HO_001', '홈'],
    ['WEB_LT_019', 'WEB_LT_019', 'WEB_LT_019'],
    ['mo_vd_001 상세', 'mo_vd_001', '상세'],
    ['ST_LI_001-02 · 케이스', 'ST_LI_001-02', '케이스'],
    ['검색 · 입력', undefined, '검색 · 입력'],
    ['[폐기] 검색', undefined, '[폐기] 검색'],
  ] as const;
  for (const [i, [title, screenId, expectedTitle]] of cases.entries()) {
    const [planned] = planExistingFlipbooks(s.state, [{ ...selection[0], nodeId: `n${i}`, title }], actor, 1);
    assert.equal(planned.record.title, expectedTitle);
    assert.equal(planned.record.screenId, screenId);
    s.put(keys.flipbook(planned.record.id), planned.record);
  }
  s.reload();
  assert.equal(s.state.flipbooks.get('canvas:n0')?.screenId, 'ST_SE_001');
  const [header] = planExistingFlipbooks(s.state, [{ ...selection[0], title: 'ST_SE_099 · 이전 제목', screenId: 'ST_SE_003', pageTitle: '헤더 제목' }], actor, 2);
  assert.equal(header.record.screenId, 'ST_SE_003');
  assert.equal(header.record.title, '헤더 제목');
  s.put(keys.flipbook(header.record.id), { ...header.record, status: 'retired' });
  const [restored] = planExistingFlipbooks(s.state, [{ ...selection[0], title: '변경된 이름', flipbookId: header.record.id }], actor, 3);
  assert.equal(restored.record.screenId, 'ST_SE_003', '읽을 ID가 없어도 보관된 ID를 잃지 않는다');
});

test('selection reads legacy header and marked ID slots without changing visible content or reading GUI references', async () => {
  const previous = (globalThis as any).figma;
  const page: any = { id: 'p', type: 'PAGE', selection: [] };
  let seq = 0;
  const make = (type: string, name: string, children: any[] = [], text = '', role = ''): any => {
    const node: any = { id: `field${seq++}`, type, name, characters: text, visible: true, children,
      getSharedPluginData: (_ns: string, key: string) => key === PART_KEY ? role : '',
    };
    for (const child of children) child.parent = node;
    return node;
  };
  const id = make('TEXT', 'Value', [], 'mo_vd_007');
  const title = make('TEXT', 'Value', [], '관련 콘텐츠');
  const header = make('INSTANCE', 'Flipbook-Title', [make('SLOT', 'input-cell-id', [id]), make('FRAME', 'input-cell-page', [title])]);
  const legacy = make('FRAME', 'ST_VD_001 · 이전 제목', [header]);
  const marked = make('FRAME', 'Unstructured name', [make('SLOT', 'renamed slot', [make('TEXT', 'Value', [], 'ST_SE_POLICY_02')], '', 'ids'), make('TEXT', 'renamed title', [], '음성 검색', 'title')]);
  marked.getSharedPluginData = (_ns: string, key: string) => key === LINKS_KEY ? '{"components":{}}' : '';
  const decoy = make('FRAME', 'Plain title', [make('FRAME', 'GUI Image Slot', [header])]);
  page.selection = [legacy, marked, decoy];
  for (const node of page.selection) node.parent = page;
  (globalThis as any).figma = { currentPage: page };
  try {
    const selected = await selectedFlipbooks();
    const planned = planExistingFlipbooks(store().state, selected, actor, 1).map(p => p.record);
    assert.deepEqual(planned.map(p => [p.screenId, p.title]), [['mo_vd_007', '관련 콘텐츠'], ['ST_SE_POLICY_02', '음성 검색'], [undefined, 'Plain title']]);
    id.visible = false;
    assert.equal((await selectedFlipbooks())[0].screenId, undefined, '숨긴 ID는 가져오지 않는다');
    assert.equal(legacy.name, 'ST_VD_001 · 이전 제목');
    assert.equal(id.characters, 'mo_vd_007');
    assert.equal(title.characters, '관련 콘텐츠');
  } finally { (globalThis as any).figma = previous; }
});

test('controller adds existing frames without syncing template content or duplicating records', async () => {
  const posted: ToUi[] = [];
  const marked = new Map<string, string>();
  let syncs = 0;
  const s = store();
  const host = {
    kv: s.kv, mode: 'UI', actor,
    post: (m: ToUi) => posted.push(m), pages: () => [{ id: 'p', name: 'Books' }],
    selectedFlipbooks: async () => selection,
    markExistingFlipbooks: async (items: { id: string; nodeId: string }[]) => { for (const item of items) marked.set(item.id, item.nodeId); },
    listFlipbooks: async () => new Map(marked),
    syncFlipbook: async () => { syncs++; throw new Error('must not sync content'); },
  } as unknown as Host;
  const c = new Controller(host);
  await c.handle({ type: 'registerFlipbooks' });
  await c.handle({ type: 'registerFlipbooks' });
  assert.deepEqual(posted.filter(m => m.type === 'error'), []);
  assert.equal(c.store.state.flipbooks.size, 1);
  assert.equal(syncs, 0);
  assert.equal(marked.get('canvas:1:2'), '1:2');
  const reopened = new Controller(host);
  assert.equal(reopened.store.state.flipbooks.get('canvas:1:2')?.title, 'Manual book');
});

// 등록은 플러그인 표식만 쓴다. 연결 기록이 없는 프레임은 반영이 표식으로만 칸을 찾으므로(2026-11-02) 이름으로 찾은 칸 표식과 연결 기록도 함께 쓴다.
test('host only writes registration marks and a links record, distinguishes a copied book, and validates all nodes before a batch', async () => {
  const previous = (globalThis as any).figma;
  const page = { id: 'p', type: 'PAGE', selection: [] as any[] };
  const make = (id: string, parent: any = page) => ({
    id, type: 'FRAME', name: 'Manual book', parent, data: new Map<string, string>(), children: [] as any[],
    getSharedPluginData(_ns: string, key: string) { return this.data.get(key) ?? ''; },
    setSharedPluginData(_ns: string, key: string, value: string) { this.data.set(key, value); },
  });
  const a = make('a'), b = make('b', a);
  const nodes = new Map([['a', a], ['b', b]]);
  (globalThis as any).figma = { root: { getSharedPluginData: () => '' }, currentPage: page, getNodeByIdAsync: async (id: string) => nodes.get(id) ?? null };
  try {
    page.selection = [a, b];
    assert.deepEqual((await selectedFlipbooks()).map(n => n.nodeId), ['a']);
    const visible = JSON.stringify({ name: a.name, type: a.type, parent: a.parent.id });
    await markExistingFlipbooks([{ nodeId: 'a', id: 'canvas:a', pageId: 'p' }]);
    assert.equal(a.data.get(EXISTING_KEY), 'true');
    assert.equal(a.data.get(FLIPBOOK_KEY), 'canvas:a');
    assert.equal(a.data.get(NODE_KEY), 'a');
    assert.deepEqual(parseLinks(a.data.get(LINKS_KEY) ?? ''), { components: {} }, '찾은 칸이 없어도 연결 기록을 남긴다');
    assert.equal(JSON.stringify({ name: a.name, type: a.type, parent: a.parent.id }), visible);
    assert.equal((await selectedFlipbooks())[0].flipbookId, 'canvas:a');
    b.data = new Map(a.data); page.selection = [b];
    assert.equal((await selectedFlipbooks())[0].flipbookId, null);
    b.data.clear();
    await assert.rejects(markExistingFlipbooks([{ nodeId: 'b', id: 'canvas:b', pageId: 'p' }, { nodeId: 'missing', id: 'missing', pageId: 'p' }]));
    assert.equal(b.data.size, 0);
    page.selection = [{ ...b, type: 'GROUP' }];
    await assert.rejects(selectedFlipbooks());
  } finally { (globalThis as any).figma = previous; }
});

test('같은 ID와 자기 노드 표식이 남은 다른 페이지의 복사본은 새 기록으로 등록하고 원본은 보존한다', async () => {
  const previous = (globalThis as any).figma;
  const data = (id: string) => new Map([[FLIPBOOK_KEY, 'shared'], [NODE_KEY, id]]);
  const originalPage: any = { id: 'original-page', type: 'PAGE', loadAsync: async () => {}, findAllWithCriteria: () => [original] };
  const page: any = { id: 'p', type: 'PAGE', selection: [] };
  const make = (id: string, parent: any) => ({ id, parent, type: 'FRAME', name: id, children: [], data: data(id),
    getSharedPluginData(_ns: string, key: string) { return this.data.get(key) ?? ''; },
    setSharedPluginData(_ns: string, key: string, value: string) { this.data.set(key, value); },
  });
  const original = make('original', originalPage), copy = make('copy', page);
  const nodes = new Map<string, any>([['original-page', originalPage], ['original', original], ['copy', copy]]);
  const s = store();
  const [before] = planExistingFlipbooks(s.state, [{ nodeId: 'original', pageId: 'p', title: 'Original', flipbookId: null }], actor, 1);
  s.put(keys.flipbook('shared'), { ...before.record, id: 'shared', pageId: 'original-page' });
  (globalThis as any).figma = { currentPage: page, root: { getSharedPluginData: (_ns: string, key: string) => s.kv.get(key) }, getNodeByIdAsync: async (id: string) => nodes.get(id) ?? null };
  try {
    page.selection = [copy];
    const selected = await selectedFlipbooks();
    assert.equal(selected[0].flipbookId, null);
    const [planned] = planExistingFlipbooks(s.state, selected, actor, 2);
    assert.equal(planned.record.id, 'canvas:copy');
    await markExistingFlipbooks([{ nodeId: 'copy', id: planned.record.id, pageId: 'p' }]);
    s.put(keys.flipbook(planned.record.id), planned.record);
    assert.equal(copy.data.get(FLIPBOOK_KEY), 'canvas:copy');
    assert.equal(original.data.get(FLIPBOOK_KEY), 'shared');
    assert.equal(s.state.flipbooks.get('shared')?.title, 'Original');
    assert.equal(planExistingFlipbooks(s.state, await selectedFlipbooks(), actor, 3).length, 0);
    // 원본 소유권이 등록 직전에 달라지면 표식을 덮어쓰지 않는다.
    copy.data.set(FLIPBOOK_KEY, 'shared');
    originalPage.findAllWithCriteria = () => [copy, original];
    await assert.rejects(markExistingFlipbooks([{ nodeId: 'copy', id: 'canvas:copy', pageId: 'p' }]));
    assert.equal(copy.data.get(FLIPBOOK_KEY), 'shared');
  } finally { (globalThis as any).figma = previous; }
});
