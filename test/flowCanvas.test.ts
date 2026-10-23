import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFlow, flowNode, updateFlow } from '../src/figma/flow.ts';
import type { FlowPlan } from '../src/core/flow.ts';
import type { FlowRecord } from '../src/core/types.ts';

// 플로우 그룹의 생성·실패 정리·썸네일 교체·찾기를 Figma 노드 모의 객체로 확인한다. 글자 크기·그룹 경계 계산은 실제 Figma에서 확인한다.

const NS = 'test';
const actor = { id: 'u', name: 'Designer' };

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
    { key: 'a', uid: 's1', r: 0, c: 0, code: 'STB_HO_001', name: '홈', version: 1, thumb: { hash: 'h1', width: 480, height: 270 } },
    { key: 'b', uid: 's2', r: 0, c: 1, code: 'STB_HO_002', name: '상세', version: 1, thumb: null },
  ],
  links: [{ from: 'a', fromSide: 'right', to: 'b', toSide: 'left' }],
};

test('플로우 그룹을 만들고, 다시 배포된 화면만 썸네일을 바꾸며 「썸네일 없음」 글자를 지운다', async () => {
  const m = mockFigma();
  m.images.add('h1');
  const placed = await createFlow(NS, plan);
  assert.deepEqual(placed.notes, ['썸네일 이미지를 파일에서 찾지 못한 화면: STB_HO_002']);
  const root = m.page.children.find(n => n.id === placed.nodeId)!;
  assert.equal(root.type, 'GROUP');
  assert.equal(root.getSharedPluginData(NS, 'flowOf'), 'f1');
  const rect = (uid: string) => root.findOne(n => n.type === 'RECTANGLE' && n.getSharedPluginData(NS, 'flowScreen') === uid)!;
  assert.equal(root.findAll(n => n.getSharedPluginData(NS, 'flowEmpty') === rect('s2').id).length, 1);

  const record: FlowRecord = { id: 'f1', nodeId: placed.nodeId, pageId: placed.pageId, title: plan.title, uids: ['s1', 's2'], createdAt: 1, actor };
  m.images.add('h2');
  const thumbs = [{ uid: 's2', version: 2, thumb: { hash: 'h2', width: 480, height: 270 } }, { uid: 's1', version: 1, thumb: { hash: 'h1', width: 480, height: 270 } }];
  assert.equal(await updateFlow(NS, record, thumbs), 1, 'only the newer version is replaced');
  assert.deepEqual(rect('s2').fills, [{ type: 'IMAGE', imageHash: 'h2', scaleMode: 'FIT' }]);
  assert.equal(root.findAll(n => !!n.getSharedPluginData(NS, 'flowEmpty')).length, 0);
  assert.equal(await updateFlow(NS, record, thumbs), 0, 'running again changes nothing');

  assert.equal(await flowNode(NS, record), root.id);
  assert.equal(await flowNode(NS, record, 's2'), rect('s2').parent!.id, 'a screen opens its card group');
  // 복제했거나 같은 ID를 다른 노드가 얻었으면(표식이 다르면) 그 플로우로 보지 않는다.
  const copy = m.make('GROUP');
  m.page.appendChild(copy);
  copy.setSharedPluginData(NS, 'flowOf', 'other');
  assert.equal(await flowNode(NS, { ...record, nodeId: copy.id }), null);
  root.remove();
  assert.equal(await updateFlow(NS, record, thumbs), null);
  assert.equal(await flowNode(NS, record), null);
});

test('플로우를 그리다 실패하면 만든 노드를 모두 지운다', async () => {
  const m = mockFigma({ failArrow: true });
  m.images.add('h1');
  await assert.rejects(createFlow(NS, plan), /vector failed/);
  assert.deepEqual(m.page.children, []);
});
