import assert from 'node:assert/strict';
import { test } from 'node:test';
import { figmaHost } from '../src/figma/host.ts';
import { Snapshotter } from '../src/figma/snapshot.ts';
import { createFingerprintReader } from '../src/figma/fingerprints.ts';
import { renderDataPage } from '../src/figma/data.ts';
import { fitSection, makeRoom, placeFrame, recolorTagFills, syncRows, templateProblems, type TagKit } from '../src/figma/flipbook.ts';
import type { DataModel } from '../src/core/data.ts';
import type { FlipbookRow } from '../src/core/flipbook.ts';
import { Store, memoryKV } from '../src/core/store.ts';

// Figma 브리지의 호출·노드 생명주기를 검사한다. 실제 레이아웃 엔진 검증은 별도다.
class Node {
  [key: string]: any;
  id: string;
  type: string;
  name = '';
  children: Node[] = [];
  parent: Node | null = null;
  removed = false;
  width = 100;
  height = 30;
  characters = '';
  fontName = { family: 'Inter', style: 'Regular' };
  componentProperties: Record<string, { value: string }> = {};
  data = new Map<string, string>();
  constructor(type: string, id: string) { this.type = type; this.id = id; }
  appendChild(n: Node) { this.insertChild(this.children.length, n); }
  insertChild(i: number, n: Node) {
    if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1);
    this.children.splice(i, 0, n); n.parent = this;
  }
  remove() {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null; this.removed = true;
  }
  resize(w: number, h: number) { this.width = w; this.height = h; }
  setRangeHyperlink(_start: number, _end: number, _link: { value: string }) {}
  setSharedPluginData(ns: string, key: string, value: string) { this.data.set(ns + ':' + key, value); }
  getSharedPluginData(ns: string, key: string) { return this.data.get(ns + ':' + key) ?? ''; }
  findChild(fn: (n: Node) => boolean) { return this.children.find(fn) ?? null; }
  findAll(fn: (n: Node) => boolean): Node[] { return this.children.flatMap(n => [...(fn(n) ? [n] : []), ...n.findAll(fn)]); }
  findOne(fn: (n: Node) => boolean) { return this.findAll(fn)[0] ?? null; }
  getRangeAllFontNames() { return [this.fontName]; }
  async loadAsync() {}
}

function mockFigma() {
  let seq = 0, searches = 0, fontLoads = 0;
  const all: Node[] = [];
  const make = (type: string, name = '') => {
    const node = new Node(type, String(++seq)); node.name = name; all.push(node); return node;
  };
  const page = make('PAGE');
  page.findAllWithCriteria = (criteria: any) => {
    searches++;
    return page.findAll(n => criteria.types.includes(n.type) &&
      criteria.sharedPluginData.keys.some((k: string) => n.getSharedPluginData(criteria.sharedPluginData.namespace, k)));
  };
  Object.assign(globalThis, { figma: {
    mixed: Symbol('mixed'), getNodeByIdAsync: async () => page,
    createFrame: () => make('FRAME'), createText: () => make('TEXT'),
    loadFontAsync: async () => { fontLoads++; }, getImageByHash: () => null,
  } });
  return { page, make, all, searches: () => searches, fontLoads: () => fontLoads };
}

test('동일 변수의 동시 조회를 합치고 실패한 조회는 재시도한다', async () => {
  let calls = 0, fail = true;
  Object.assign(globalThis, { figma: { mixed: Symbol('mixed'), variables: {
    getVariableByIdAsync: async () => { calls++; await Promise.resolve(); if (fail) throw new Error('temporary'); return { resolveForConsumer: () => ({ value: 1 }) }; },
  } } });
  const node = { type: 'RECTANGLE', visible: true, boundVariables: { opacity: { type: 'VARIABLE_ALIAS', id: 'v' } } } as unknown as SceneNode;
  const root = { type: 'FRAME', visible: true, children: Array.from({ length: 100 }, () => node) } as unknown as SceneNode;
  const snapshotter = new Snapshotter();
  await assert.rejects(snapshotter.snapshot(root), /temporary/);
  assert.equal(calls, 1);
  fail = false;
  const result = await snapshotter.snapshot(root);
  assert.equal(calls, 2);
  assert.equal(result.children?.length, 100);
  const hidden = { visible: false, type: 'FRAME', get fills() { throw new Error('must not read'); } } as unknown as SceneNode;
  assert.deepEqual(await snapshotter.snapshot(hidden), { type: 'FRAME', props: { visible: false } });
});

test('한 판독기로 여러 플립북의 UI 영역을 읽으면 같은 변수를 다시 조회하지 않는다', async () => {
  let calls = 0;
  Object.assign(globalThis, { figma: { mixed: Symbol('mixed'), variables: {
    getVariableByIdAsync: async () => { calls++; return { resolveForConsumer: () => ({ value: 1 }) }; },
  } } });
  const flipbook = (id: string) => {
    const note = { type: 'RECTANGLE', name: 'note', visible: true, boundVariables: { opacity: { type: 'VARIABLE_ALIAS', id: 'v' } } };
    return { id, type: 'FRAME', name: 'Flipbook', visible: true, children: [{ type: 'SLOT', name: 'description area', visible: true, children: [note] }] };
  };
  const frames = new Map(['1', '2', '3'].map(id => [id, flipbook(id) as unknown as SceneNode]));
  const reader = createFingerprintReader(async id => frames.get(id) ?? null);
  for (const id of frames.keys()) assert.ok((await reader.uiFingerprint(id)).fingerprint);
  assert.equal(calls, 1);
});

test('원기록이 그대로면 저장소 상태를 재구축하지 않고 외부 변경은 다시 읽는다', () => {
  const kv = memoryKV();
  const store = new Store(kv);
  const state = store.state;
  store.reload();
  assert.equal(store.state, state);
  store.put('cat:a', { id: 'a', name: 'A', active: true, order: 0 });
  const afterPut = store.state;
  store.reload();
  assert.equal(store.state, afterPut);
  kv.set('cat:b', JSON.stringify({ id: 'b', name: 'B', active: true, order: 1 }));
  store.reload();
  assert.notEqual(store.state, afterPut);
  assert.equal(store.state.categories.get('b')?.name, 'B');
});

test('DATA 증분 갱신은 같은 행을 유지하고 변경·삭제·수동 재생성을 반영한다', async () => {
  const m = mockFigma();
  const ns = 'test';
  const model: DataModel = {
    generatedAt: 'now', actor: { id: 'u', name: 'User' }, history: [],
    screens: ['a', 'b'].map(id => ({ id, name: id, category: 'Category', base: '', status: '사용', sourceNodeId: null,
      gui: 'GUI v1', guiTag: null, ui: '-', uiTag: null, delivery: '-' })),
  };
  await renderDataPage(ns, m.page.id, model);
  const table = () => m.page.children.find(n => n.getSharedPluginData(ns, 'role') === 'data-summary')!;
  const a = table().children[2], b = table().children[3];
  const count = m.all.length;
  await renderDataPage(ns, m.page.id, { ...model, generatedAt: 'later' });
  assert.equal(m.all.length, count, 'unchanged refresh creates no nodes');
  assert.equal(table().children[2], a);
  assert.equal(m.searches(), 0, 'DATA refresh does not search for preserved images');
  const changed = { ...model, screens: [{ ...model.screens[0], name: 'renamed' }] };
  await renderDataPage(ns, m.page.id, changed);
  assert.equal(a.removed, true);
  assert.equal(b.removed, true);
  assert.equal(table().children.length, 3);
  const before = table();
  await renderDataPage(ns, m.page.id, changed, true);
  assert.equal(before.removed, true);
  assert.notEqual(table(), before);
  await renderDataPage(ns, m.page.id, { ...model, screens: [] });
  assert.equal(table().children[2].characters, '기록 없음');
});

test('원본 프레임이 지워진 화면은 링크 없이 그리고 나머지 행은 링크를 건다', async () => {
  const m = mockFigma();
  const ns = 'test';
  const source = m.make('FRAME', 'source');
  const linked: string[] = [];
  const live = (id: string) => m.all.find(n => n.id === id && !n.removed) ?? null;
  // 원본 노드를 미리 찾으면 dynamic-page에서 원본 페이지를 모두 불러오므로 DATA 페이지 외에는 찾지 않는다.
  const lookups: string[] = [];
  Object.assign((globalThis as unknown as { figma: object }).figma, { getNodeByIdAsync: async (id: string) => { lookups.push(id); return live(id); } });
  // 실제 Figma처럼 없는 노드에 링크를 걸면 예외를 던진다.
  Node.prototype.setRangeHyperlink = (_s: number, _e: number, link: { value: string }) => {
    if (!live(link.value)) throw new Error('in setRangeHyperlink: Invalid hyperlink target node specified');
    linked.push(link.value);
  };
  try {
    const model: DataModel = {
      generatedAt: 'now', actor: { id: 'u', name: 'User' }, history: [],
      screens: [['kept', source.id], ['gone', '999:1']].map(([id, nodeId]) => ({ id, name: id, category: 'Category', base: '', status: '사용',
        sourceNodeId: nodeId, gui: 'GUI v1', guiTag: null, ui: '-', uiTag: null, delivery: '-' })),
    };
    await renderDataPage(ns, m.page.id, model);
    assert.deepEqual(linked, [source.id]);
    assert.deepEqual(lookups.filter(id => id !== m.page.id), [], 'source frames are not looked up');
    const table = m.page.children.find(n => n.getSharedPluginData(ns, 'role') === 'data-summary')!;
    assert.equal(table.children.length, 4);
    const history = m.page.children.find(n => n.getSharedPluginData(ns, 'role') === 'data-history')!;
    assert.deepEqual([history.x, history.y], [table.width + 120, 0], 'history sits beside the summary');
  } finally {
    Node.prototype.setRangeHyperlink = () => {};
  }
});

test('플립북 최신 행 이동·정정·재시도에서 기존 이력과 시스템 행을 재사용한다', async () => {
  const m = mockFigma();
  const instance = m.make('INSTANCE');
  const list = m.make('SLOT', 'List'), previous = m.make('FRAME', 'Previous');
  instance.appendChild(list); list.appendChild(previous);
  const component = m.make('COMPONENT');
  let instances = 0;
  component.createInstance = () => {
    instances++;
    const row = m.make('INSTANCE', 'Update History');
    row.getMainComponentAsync = async () => component;
    for (const name of ['Comment', 'Name', 'Date']) {
      const cell = m.make('FRAME', name), text = m.make('TEXT'); cell.appendChild(text); row.appendChild(cell);
    }
    return row;
  };
  const template = m.make('COMPONENT'); template.appendChild(component.createInstance());
  const system = m.make('INSTANCE', 'Update History'); system.componentProperties.isSystem = { value: 'true' }; list.appendChild(system);
  const legacy = component.createInstance(); list.appendChild(legacy);
  const kit = { template, small: component, big: component, fonts: new Map() } as unknown as TagKit;
  const data = (v: number): FlipbookRow => ({ key: `GUI:batch${v}`, team: 'GUI', description: `change ${v}`, worker: 'User', at: '10/19 12:00', colorKey: 'Green', tag: { id: 't', name: 'tag', colorKey: 'Green', color: '#fff' } });
  const settings = { pageId: 'p', templateId: template.id };
  const sync = (rows: FlipbookRow[], force = false) => syncRows('test', instance as unknown as ChildrenMixin, { ...settings, force }, rows, kit, new Set());
  await sync([data(1)]);
  const first = list.children[0], count = instances;
  assert.equal(legacy.removed, true);
  await sync([data(1)]);
  assert.equal(instances, count);
  await sync([data(2), data(1)]);
  assert.equal(instances, count + 1);
  assert.equal(previous.children[0], first);
  await sync([data(2), { ...data(1), description: 'corrected' }]);
  const comment = first.findOne(n => n.type === 'TEXT' && n.parent?.name === 'Comment')!;
  assert.equal(comment.characters, 'corrected');
  assert.equal(instances, count + 1);
  comment.characters = 'manual edit';
  await sync([data(2), { ...data(1), description: 'corrected' }], true);
  assert.equal(comment.characters, 'corrected');
  assert.equal(system.removed, false);
  assert.equal(system.parent, list);
  assert.equal(m.fontLoads(), 1, 'same font loads only once in the session');
});

// 템플릿 프레임(2026-10-20): UI Title·Flipbook-Title·Update History List 컴포넌트와 GUI Image Slot 프레임
function templateFixture(m: ReturnType<typeof mockFigma>, listType = 'SLOT', idType = 'SLOT') {
  const frame = m.make('FRAME', 'Flipbook-Template');
  const title = m.make('COMPONENT', 'UI Title');
  title.appendChild(m.make('TEXT', 'Text'));
  title.appendChild(m.make('INSTANCE', 'Status'));
  const book = m.make('FRAME', 'Flipbook');
  const header = m.make('COMPONENT', 'Flipbook-Title');
  for (const cell of ['input-cell-chapter', 'input-cell-page']) { const c = m.make('FRAME', cell); c.appendChild(m.make('TEXT', 'Text')); header.appendChild(c); }
  header.appendChild(m.make(idType, 'input-cell-id'));
  const body = m.make('FRAME', 'Flipbook-Body');
  const gui = m.make('FRAME', 'GUI Image Slot');
  // 복사본 안의 노드를 읽으면 실패하게 해 GUI 영역 안으로 내려가지 않는지 확인한다.
  const poison = new Proxy({}, { get: () => { throw new Error('visited GUI copy'); }, has: () => { throw new Error('visited GUI copy'); } });
  gui.children.push(poison as unknown as Node);
  const tables = m.make('FRAME', 'Tables');
  const history = m.make('COMPONENT', 'Update History List');
  const list = m.make(listType, 'List');
  history.appendChild(list);
  tables.appendChild(history);
  body.appendChild(gui); body.appendChild(tables);
  book.appendChild(header); book.appendChild(body);
  frame.appendChild(title); frame.appendChild(book);
  return { frame, history, list };
}

test('템플릿 구조를 찾을 때 GUI 영역 안의 레이어 복사본은 훑지 않고, List·input-cell-id는 슬롯이어야 한다', async () => {
  const m = mockFigma();
  const { frame, history, list } = templateFixture(m);
  assert.deepEqual(templateProblems(frame as unknown as FrameNode), []);
  assert.match(templateProblems(templateFixture(m, 'FRAME', 'FRAME').frame as unknown as FrameNode).join(), /input-cell-id.*슬롯.*List.*슬롯/);
  const component = m.make('COMPONENT');
  component.createInstance = () => {
    const row = m.make('INSTANCE', 'Update History');
    row.getMainComponentAsync = async () => component;
    for (const name of ['Comment', 'Name', 'Date']) {
      const cell = m.make('FRAME', name), text = m.make('TEXT'); cell.appendChild(text); row.appendChild(cell);
    }
    return row;
  };
  list.appendChild(component.createInstance());
  const kit = { template: frame, small: component, big: component, fonts: new Map() } as unknown as TagKit;
  const row: FlipbookRow = { key: 'GUI:batch1', team: 'GUI', description: 'd', worker: 'User', at: '10/19 12:00', colorKey: 'Green', tag: { id: 't', name: 'tag', colorKey: 'Green', color: '#fff' } };
  await syncRows('test', history as unknown as ChildrenMixin, { pageId: 'p', templateId: frame.id }, [row], kit, new Set());
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].findOne(n => n.type === 'TEXT' && n.parent?.name === 'Comment')!.characters, 'd');
});

test('태그 색은 색 변수 없이 팔레트 hex로 칠하고, 팔레트 색이 아닌 칠은 그대로 둔다', () => {
  const rgb = (hex: string) => { const n = parseInt(hex.slice(1), 16); return { r: (n >> 16 & 255) / 255, g: (n >> 8 & 255) / 255, b: (n & 255) / 255 }; };
  const solid = (hex: string, extra: object = {}) => ({ type: 'SOLID', color: rgb(hex), opacity: 1, visible: true, ...extra }) as unknown as Paint;
  const alias = { color: { type: 'VARIABLE_ALIAS', id: 'v' } };
  const white = solid('#FFFFFF'), image = { type: 'IMAGE', imageHash: 'h', scaleMode: 'FILL' } as unknown as Paint;
  const out = recolorTagFills([white, solid('#FF4BAE', { boundVariables: alias, opacity: 0.5 }), image, solid('#0088FF')], 'Green')!;
  assert.equal(out[0], white);
  assert.equal(out[2], image);
  for (const paint of [out[1], out[3]] as SolidPaint[]) {
    assert.deepEqual(paint.color, rgb('#18B567'));
    assert.equal(paint.boundVariables, undefined);
  }
  assert.equal((out[1] as SolidPaint).opacity, 0.5);
  // 이미 같은 색이면 바꾸지 않는다. 색 변수에 연결돼 있으면 같은 색이어도 연결을 끊는다.
  assert.equal(recolorTagFills([white, solid('#18B567')], 'Green'), null);
  assert.equal((recolorTagFills([solid('#18B567', { boundVariables: alias })], 'Green')![0] as SolidPaint).boundVariables, undefined);
  assert.equal(recolorTagFills([solid('#0088FF')], 'Unknown'), null);
});

// 플립북 배치: Section 안쪽 여백 300, 화면 사이 200, 한 행에 10개. 폭 100이면 한 칸은 300이다.
type Box = { x: number; y: number; width: number; height: number };
const box = (x: number, y: number, height = 500, width = 100): Box => ({ x, y, width, height });
const at = (boxes: Box[]) => boxes.map(b => [b.x, b.y]);

test('새 플립북을 맨 뒤에 놓을 때 다른 프레임은 움직이지 않는다', () => {
  // 첫 행을 다 채우지 않고 다음 행으로 띄워 옮겨 둔 배치
  const frames = [box(300, 300), box(600, 300), box(300, 1400)];
  const added = box(0, 0);
  placeFrame(frames, added, undefined);
  assert.deepEqual([added.x, added.y], [600, 1400], '마지막 프레임 오른쪽 칸');
  assert.deepEqual(at(frames), [[300, 300], [600, 300], [300, 1400]]);
  // 마지막 행이 10칸을 다 채웠으면 가장 아래 프레임 밑에 새 행을 연다.
  const full = Array.from({ length: 10 }, (_, i) => box(300 + i * 300, 300, i === 3 ? 900 : 500));
  const next = box(0, 0);
  placeFrame(full, next, undefined);
  assert.deepEqual([next.x, next.y], [300, 1400]);
  const first = box(0, 0);
  placeFrame([], first, undefined);
  assert.deepEqual([first.x, first.y], [300, 300], '빈 Section은 안쪽 여백에서 시작한다');
});

test('고른 플립북 다음 칸이 비어 있으면 그 칸에 놓고, 차 있으면 같은 행의 뒤쪽 프레임만 한 칸씩 민다', () => {
  const gap = [box(300, 300), box(600, 300), box(1500, 300)];
  const intoGap = box(0, 0);
  placeFrame(gap, intoGap, gap[1]);
  assert.deepEqual([intoGap.x, intoGap.y], [900, 300]);
  assert.deepEqual(at(gap), [[300, 300], [600, 300], [1500, 300]], '빈 칸이면 아무것도 밀지 않는다');

  const frames = [box(300, 300), box(600, 300), box(900, 300), box(1500, 300), box(300, 1000)];
  const added = box(0, 0);
  placeFrame(frames, added, frames[0]);
  assert.deepEqual([added.x, added.y], [600, 300]);
  // 뒤쪽 프레임은 띄워 둔 간격을 그대로 두고 한 칸씩 밀리며, 다른 행은 그대로다.
  assert.deepEqual(at(frames), [[300, 300], [900, 300], [1200, 300], [1800, 300], [300, 1000]]);

  const front = [box(300, 300), box(600, 300), box(300, 1000)];
  const head = box(0, 0);
  placeFrame(front, head, null);
  assert.deepEqual([head.x, head.y], [300, 300], '맨 앞');
  assert.deepEqual(at(front), [[600, 300], [900, 300], [300, 1000]]);
});

test('윗 행의 긴 화면이 막은 칸은 건너뛰고 민다', () => {
  // 600 열은 윗 행의 긴 화면(높이 1500)이 아래 행까지 내려와 있다.
  const frames = [box(300, 300), box(600, 300, 1500), box(900, 300), box(300, 1000), box(900, 1000)];
  const added = box(0, 0);
  placeFrame(frames, added, frames[3]);
  assert.deepEqual([added.x, added.y], [900, 1000]);
  assert.deepEqual(at(frames), [[300, 300], [600, 300], [900, 300], [300, 1000], [1200, 1000]]);
});

test('크기가 바뀐 프레임은 간격이 모자랄 때만 늘어난 만큼 오른쪽·아래 프레임을 함께 민다', () => {
  // 1행: 300·600·1200(띄워 둠), 2행: 300·600. 이력 한 줄로 0번이 40 길어진다.
  const frames = [box(300, 300), box(600, 300), box(1200, 300), box(300, 1000), box(600, 1000)];
  const grown = frames[0];
  grown.height = 540;
  makeRoom(frames, grown, { width: 100, height: 500 });
  assert.deepEqual(at(frames), [[300, 300], [600, 300], [1200, 300], [300, 1040], [600, 1040]], '아래 행 전체가 간격을 유지하며 내려간다');
  // 행의 가장 높은 화면보다 짧은 화면이 늘어나면 간격이 넉넉해 움직이지 않는다.
  const short = [box(300, 300, 400), box(600, 300), box(300, 1000)];
  short[0].height = 440;
  makeRoom(short, short[0], { width: 100, height: 400 });
  assert.deepEqual(at(short), [[300, 300], [600, 300], [300, 1000]]);
  // 폭이 넓어지면 같은 행의 오른쪽 프레임만 민다.
  const wide = [box(300, 300), box(600, 300), box(1200, 300), box(300, 1000)];
  wide[0].width = 150;
  makeRoom(wide, wide[0], { width: 100, height: 500 });
  assert.deepEqual(at(wide), [[300, 300], [650, 300], [1250, 300], [300, 1000]]);
  // 간격보다 촘촘하게 둔 프레임도 늘어난 만큼만 민다.
  const tight = [box(300, 300), box(300, 900)];
  tight[0].height = 540;
  makeRoom(tight, tight[0], { width: 100, height: 500 });
  assert.deepEqual(at(tight), [[300, 300], [300, 940]]);
});

test('Section이 아래로 늘어나면 아래 Section을 밀어 Section 사이 800을 유지한다', () => {
  const fixture = (bottom: number) => {
    const page = { type: 'PAGE', children: [] as unknown[] };
    const section = (y: number) => ({
      type: 'SECTION', x: 0, y, width: 1000, height: 1000, parent: page, children: [] as Box[],
      getSharedPluginData: (_ns: string, key: string) => (key === 'categoryOf' ? 'c' : ''),
      resizeWithoutConstraints(w: number, h: number) { this.width = w; this.height = h; },
    });
    const top = section(0), below = section(1800);
    page.children.push(top, below);
    top.children.push(box(300, bottom - 500));
    fitSection('test', top as unknown as SectionNode);
    return { top, below };
  };
  const { top, below } = fixture(2200);
  assert.equal(top.height, 2500);
  assert.equal(below.y, 3300);
  // 간격이 이미 넉넉하면 움직이지 않는다.
  assert.equal(fixture(600).below.y, 1800);
});


test('페이지 선택은 Figma 디바이더·자동 썸네일을 제외하고 일반 페이지 순서와 현재 페이지 표시는 유지한다', () => {
  const page = (id: string, name: string, divider = false, role = '') => ({ id, name, isPageDivider: divider, getSharedPluginData: (_ns: string, key: string) => key === 'role' ? role : '' });
  const normal = page('a', 'GUI');
  const separator = page('divider', '---', true);
  const namedLikeDivider = page('b', '---', false);
  const thumbnails = page('thumb', '자동 썸네일', false, 'thumbs');
  const ui = page('c', 'UI');
  Object.assign(globalThis, { figma: { root: { children: [normal, separator, namedLikeDivider, thumbnails, ui] }, currentPage: ui, currentUser: null } });
  assert.deepEqual(figmaHost('UI').pages(), [{ id: 'a', name: 'GUI' }, { id: 'b', name: '---' }, { id: 'c', name: 'UI', current: true }]);
});
