import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createdFlowCells, createFlow, scanFlowCells, updateFlowCells } from '../src/figma/flow.ts';
import type { FlowPlan } from '../src/core/flow.ts';

// 플로우 그룹의 생성·실패 정리, 칸 찾기(그룹을 풀거나 잘라 붙여도)·썸네일 교체를 Figma 노드 모의 객체로 확인한다. 글자 크기·그룹 경계 계산은 실제 Figma에서 확인한다.

const NS = 'test';

class Node {
  [key: string]: any;
  id: string;
  type: string;
  name = '';
  children: Node[] = [];
  parent: Node | null = null;
  removed = false;
  x = 0; y = 0; width = 100; height = 20;
  characters = '';
  fills: unknown[] = [];
  data = new Map<string, string>();
  constructor(type: string, id: string) { this.type = type; this.id = id; }
  appendChild(n: Node) {
    if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1);
    this.children.push(n); n.parent = this;
  }
  // Figma처럼 자식이 모두 빠진 그룹은 함께 사라진다.
  remove() {
    const parent = this.parent;
    if (parent) parent.children.splice(parent.children.indexOf(this), 1);
    this.parent = null; this.removed = true;
    for (const child of [...this.children]) child.remove();
    if (parent?.type === 'GROUP' && !parent.children.length) parent.remove();
  }
  resize(w: number, h: number) { this.width = w; this.height = h; }
  setSharedPluginData(_ns: string, key: string, value: string) { this.data.set(key, value); }
  getSharedPluginData(_ns: string, key: string) { return this.data.get(key) ?? ''; }
  findAll(fn: (n: Node) => boolean): Node[] { return this.children.flatMap(n => [...(fn(n) ? [n] : []), ...n.findAll(fn)]); }
  findOne(fn: (n: Node) => boolean) { return this.findAll(fn)[0] ?? null; }
  findAllWithCriteria(c: { types: string[]; sharedPluginData?: { keys: string[] } }) {
    return this.findAll(n => c.types.includes(n.type) && (!c.sharedPluginData || c.sharedPluginData.keys.some(k => n.data.has(k))));
  }
  async loadAsync() {}
}

function mockFigma(options: { failArrow?: boolean } = {}) {
  let seq = 0;
  const all: Node[] = [];
  const make = (type: string) => { const n = new Node(type, `${++seq}:1`); all.push(n); return n; };
  const page = make('PAGE');
  const images = new Set<string>();
  const onPage = (type: string) => { const n = make(type); page.appendChild(n); return n; };
  Object.assign(globalThis, { figma: {
    root: { children: [page] }, currentPage: page,
    viewport: { center: { x: 0, y: 0 }, scrollAndZoomIntoView() {} },
    loadFontAsync: async () => {},
    getImageByHash: (hash: string) => (images.has(hash) ? {} : null),
    getNodeByIdAsync: async (id: string) => all.find(n => n.id === id && !n.removed) ?? null,
    createText: () => onPage('TEXT'),
    createRectangle: () => onPage('RECTANGLE'),
    createVector: () => {
      const v = onPage('VECTOR');
      v.setVectorNetworkAsync = async () => { if (options.failArrow) throw new Error('vector failed'); };
      return v;
    },
    group: (nodes: Node[], parent: Node) => {
      const g = make('GROUP');
      parent.appendChild(g);
      for (const n of nodes) g.appendChild(n);
      return g;
    },
  } });
  return { page, images, make };
}

const plan: FlowPlan = {
  id: 'f1', title: '홈 진입',
  cells: [
    { key: 'a', uid: 's1', x: 0, y: 0, w: 480, h: 270, code: 'STB_HO_001', name: '홈', version: 1, thumb: { hash: 'h1', width: 480, height: 270 } },
    { key: 'b', uid: 's2', x: 560, y: 40, w: 480, h: 800, code: 'STB_HO_002', name: '상세', version: 1, thumb: { hash: 'h-missing', width: 480, height: 800 } },
  ],
  links: [{ from: 'a', fromSide: 'right', to: 'b', toSide: 'left' }],
};

const thumbs = [{ uid: 's2', code: 'STB_HO_002', name: '상세', version: 2, thumb: { hash: 'h2', width: 480, height: 270 } }, { uid: 's1', code: 'STB_HO_001', name: '홈', version: 1, thumb: { hash: 'h1', width: 480, height: 270 } }];

test('플로우 그룹을 만들고 칸마다 플로우 표식을 적으며, 다시 배포된 화면의 칸만 썸네일을 바꾸고 「썸네일 없음」 글자를 지운다', async () => {
  const m = mockFigma();
  m.images.add('h1');
  const placed = await createFlow(NS, plan);
  assert.deepEqual(placed.notes, ['썸네일 이미지를 파일에서 찾지 못한 화면: STB_HO_002']);
  const root = m.page.children.find(n => n.type === 'GROUP' && n.name === plan.title)!;
  assert.equal(root.type, 'GROUP');
  assert.equal(root.getSharedPluginData(NS, 'flowOf'), '', 'new groups have no flow connection mark');
  const rect = (uid: string) => root.findOne(n => n.type === 'RECTANGLE' && n.getSharedPluginData(NS, 'flowScreen') === uid)!;
  assert.equal(rect('s1').name, '🔗 STB_HO_001 · 홈');
  assert.deepEqual([rect('s1').getSharedPluginData(NS, 'flowOf'), rect('s2').getSharedPluginData(NS, 'flowOf')], ['f1', 'f1']);
  assert.equal(root.findAll(n => n.getSharedPluginData(NS, 'flowEmpty') === rect('s2').id).length, 1);
  // 판의 자리를 그대로 옮기고 화면마다 제 썸네일 크기를 쓴다(이미지를 찾지 못해도 기록된 크기).
  assert.deepEqual([rect('s2').x - rect('s1').x, rect('s2').y - rect('s1').y], [560, 40]);
  assert.deepEqual([rect('s1').width, rect('s1').height, rect('s2').width, rect('s2').height], [480, 270, 480, 800]);

  const cells = await scanFlowCells(NS, [m.page.id]);
  assert.deepEqual(cells.map(c => [c.flowId, c.uid, c.pageId, c.rootId, c.title]), [
    ['f1', 's1', m.page.id, null, null],
    ['f1', 's2', m.page.id, null, null],
  ]);
  m.images.add('h2');
  const ids = cells.map(c => c.nodeId);
  assert.equal(await updateFlowCells(NS, ids, thumbs), 1, 'only the newer version is replaced');
  assert.deepEqual(rect('s2').fills, [{ type: 'IMAGE', imageHash: 'h2', scaleMode: 'FIT' }]);
  assert.equal(root.findAll(n => !!n.getSharedPluginData(NS, 'flowEmpty')).length, 0);
  assert.equal(await updateFlowCells(NS, ids, thumbs), 0, 'running again changes nothing');
  rect('s1').name = 'IMAGE';
  const oldFills = rect('s1').fills;
  assert.equal(await updateFlowCells(NS, [rect('s1').id], thumbs), 1, 'an old layer name is corrected even when its thumbnail version is current');
  assert.equal(rect('s1').name, '🔗 STB_HO_001 · 홈');
  assert.deepEqual(rect('s1').fills, oldFills);
});

test('이 변경 전에 만든 플로우는 읽을 때 그룹 표식을 칸에 옮겨 적어, 그 뒤 그룹을 풀어도 칸으로 찾는다', async () => {
  const m = mockFigma();
  m.images.add('h1');
  const placed = await createFlow(NS, plan);
  const root = m.page.children.find(n => n.type === 'GROUP' && n.name === plan.title)!;
  root.setSharedPluginData(NS, 'flowOf', plan.id);
  const rects = root.findAll(n => n.type === 'RECTANGLE');
  for (const r of rects) r.data.delete('flowOf');
  assert.equal((await scanFlowCells(NS, null)).length, 2);
  assert.deepEqual(rects.map(r => r.getSharedPluginData(NS, 'flowOf')), ['f1', 'f1']);

  // 그룹을 풀었다: 화면 그룹은 페이지로 나오고 플로우 그룹은 사라진다.
  for (const card of root.children.filter(n => n.type === 'GROUP' && n.findAll(c => c.type === 'RECTANGLE').length)) m.page.appendChild(card);
  root.remove();
  const cells = await scanFlowCells(NS, null);
  assert.deepEqual(cells.map(c => [c.flowId, c.uid, c.rootId, c.title]), [
    ['f1', 's1', null, null],
    ['f1', 's2', null, null],
  ]);
  // 표식이 없는 사각형(플로우를 알 수 없음)은 칸으로 보지 않는다.
  const stray = m.make('RECTANGLE');
  m.page.appendChild(stray);
  stray.setSharedPluginData(NS, 'flowScreen', 's1');
  assert.equal((await scanFlowCells(NS, null)).length, 2);
});

test('잘라 붙여 사각형 ID가 바뀐 칸도 그 화면 그룹의 「썸네일 없음」 글자를 지우고, 새로 생긴 노드 안의 칸은 한 번씩 읽는다', async () => {
  const m = mockFigma();
  m.images.add('h1');
  const placed = await createFlow(NS, plan);
  const root = m.page.children.find(n => n.type === 'GROUP' && n.name === plan.title)!;
  const old = root.findOne(n => n.type === 'RECTANGLE' && n.getSharedPluginData(NS, 'flowScreen') === 's2')!;
  const card = old.parent!;
  // 잘라 붙이기: 같은 표식의 새 사각형(새 ID)이 되고 글자는 옛 사각형 ID를 가리킨다.
  const pasted = m.make('RECTANGLE');
  for (const [k, v] of old.data) pasted.data.set(k, v);
  card.appendChild(pasted);
  old.remove();
  const found = await createdFlowCells(NS, [root.id, card.id, pasted.id]);
  assert.deepEqual(found.map(c => [c.uid, c.flowId]), [['s1', 'f1'], ['s2', 'f1']], 'parent and child created together are read once');
  assert.equal(found[1].nodeId, pasted.id);
  m.images.add('h2');
  assert.equal(await updateFlowCells(NS, [pasted.id], thumbs), 1);
  assert.equal(card.findAll(n => !!n.getSharedPluginData(NS, 'flowEmpty')).length, 0);
});

test('교체로 사용 안 함이 된 화면의 칸은 이어받은 화면의 썸네일로 바꾸고 칸의 표식도 그 화면으로 바꾼다', async () => {
  const m = mockFigma();
  m.images.add('h1');
  const placed = await createFlow(NS, plan);
  const root = m.page.children.find(n => n.type === 'GROUP' && n.name === plan.title)!;
  const rect = (uid: string) => root.findOne(n => n.type === 'RECTANGLE' && n.getSharedPluginData(NS, 'flowScreen') === uid);
  const ids = (await scanFlowCells(NS, [m.page.id])).map(c => c.nodeId);
  m.images.add('h9');
  // 버전은 화면마다 따로 매기므로 s9가 버전 1이어도 옛 칸은 새로 넣는 것으로 본다.
  const next = [{ uid: 's9', code: 'STB_HO_009', name: '신규', version: 1, thumb: { hash: 'h9', width: 480, height: 270 }, formerUids: ['s1'] }];
  assert.equal(await updateFlowCells(NS, ids, next), 1);
  assert.equal(rect('s1'), null);
  assert.equal(rect('s9')!.name, '🔗 STB_HO_009 · 신규');
  assert.deepEqual([rect('s9')!.fills, rect('s9')!.getSharedPluginData(NS, 'flowVersion')], [[{ type: 'IMAGE', imageHash: 'h9', scaleMode: 'FIT' }], '1']);
  assert.equal(await updateFlowCells(NS, ids, next), 0, 'running again changes nothing');
});

test('플로우를 그리다 실패하면 만든 노드를 모두 지운다', async () => {
  const m = mockFigma({ failArrow: true });
  m.images.add('h1');
  await assert.rejects(createFlow(NS, plan), /vector failed/);
  assert.deepEqual(m.page.children, []);
});
