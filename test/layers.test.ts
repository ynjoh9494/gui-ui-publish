import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COPY } from '../src/core/copy.ts';
import { originalFlipbookFrames, pickFlipbookFrames, syncGui } from '../src/figma/flipbook.ts';
import { COPY_KEY, copyLayers } from '../src/figma/layers.ts';

// 레이어 복사의 호출 순서와 노드 생명주기를 검사한다. 실제 Figma의 복제·연결 끊기 결과는 별도로 확인한다.
let seq = 0;
class Node {
  [key: string]: any;
  id = String(++seq);
  name = '';
  children: Node[] = [];
  parent: Node | null = null;
  removed = false;
  visible = true;
  locked = false;
  x = 0; y = 0; width = 1920; height = 1080;
  data = new Map<string, string>();
  explicitVariableModes: Record<string, string> = {};
  resolvedVariableModes: Record<string, string> = {};
  type: string;
  constructor(type: string, name = '') { this.type = type; this.name = name; }
  add(...kids: Node[]) { kids.forEach(k => this.appendChild(k)); return this; }
  appendChild(n: Node) {
    if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1);
    this.children.push(n); n.parent = this;
  }
  remove() {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null; this.removed = true;
  }
  resize(w: number, h: number) { this.width = w; this.height = h; }
  resizeWithoutConstraints(w: number, h: number) { this.resize(w, h); }
  insertChild(i: number, n: Node) {
    if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1);
    this.children.splice(i, 0, n); n.parent = this;
  }
  // 실제 Figma처럼 하위까지 줄인다. stuck은 rescale 뒤 크기를 엉뚱하게 다시 계산하는 노드를 흉내 낸다.
  rescale(scale: number) { for (const n of [this, ...this.all()]) if (!n.stuck) { n.width *= scale; n.height *= scale; } }
  findAll(match: (n: Node) => boolean) { return this.all().filter(match); }
  characters = '';
  fontName = { family: 'Inter', style: 'Regular' };
  getRangeAllFontNames() { return [this.fontName]; }
  setSharedPluginData(ns: string, key: string, value: string) { if (value) this.data.set(`${ns}:${key}`, value); else this.data.delete(`${ns}:${key}`); }
  getSharedPluginData(ns: string, key: string) { return this.data.get(`${ns}:${key}`) ?? ''; }
  getSharedPluginDataKeys(ns: string) { return [...this.data.keys()].filter(k => k.startsWith(ns + ':')).map(k => k.slice(ns.length + 1)); }
  all(): Node[] { return this.children.flatMap(c => [c, ...c.all()]); }
  findAllWithCriteria(c: { types?: string[]; sharedPluginData?: { namespace: string } }) {
    return this.all().filter(n => (!c.types || c.types.includes(n.type)) && (!c.sharedPluginData || n.getSharedPluginDataKeys(c.sharedPluginData.namespace).length));
  }
  clone(): Node {
    const copy = new Node(this.type, this.name);
    Object.assign(copy, { x: this.x, y: this.y, width: this.width, height: this.height, explicitVariableModes: { ...this.explicitVariableModes } });
    for (const key of ['layoutSizingHorizontal', 'layoutSizingVertical', 'stuck', 'characters', 'fontName']) if (key in this) copy[key] = this[key];
    this.data.forEach((v, k) => copy.data.set(k, v));
    this.children.forEach(c => copy.appendChild(c.clone()));
    (this.parent ?? page).appendChild(copy);
    return copy;
  }
  detachInstance(): Node {
    if (this.type !== 'INSTANCE') throw new Error('not an instance');
    // 바깥 인스턴스를 끊기 전에는 안쪽 인스턴스를 끊을 수 없다고 가정한다.
    for (let p = this.parent; p; p = p.parent) if (p.type === 'INSTANCE') throw new Error('nested instance');
    detached.push(this.name);
    detachedModes.push({ name: this.name, modes: { ...this.explicitVariableModes } });
    this.type = 'FRAME';
    return this;
  }
  createInstance(): Node { const inst = this.clone(); inst.type = 'INSTANCE'; return inst; }
  setExplicitVariableModeForCollection(collection: { id: string }, modeId: string) { this.explicitVariableModes[collection.id] = modeId; }
}

let page: Node;
let detached: string[] = [];
let detachedModes: { name: string; modes: Record<string, string> }[] = [];

function setup() {
  seq = 0;
  detached = [];
  detachedModes = [];
  page = new Node('PAGE');
  const flipbookPage = new Node('PAGE');
  Object.assign(globalThis, { figma: {
    createFrame: () => new Node('FRAME'),
    loadFontAsync: async (f: FontName) => { if (f.family === 'Missing') throw new Error('font'); },
    variables: { getVariableCollectionByIdAsync: async (id: string) => (id === 'missing' ? null : { id }) },
  } });
  return flipbookPage as unknown as PageNode;
}

function screen() {
  const button = new Node('INSTANCE', 'Button').add(new Node('INSTANCE', 'Icon'));
  const card = new Node('INSTANCE', 'Card').add(new Node('TEXT', 'Title'), new Node('INSTANCE', 'Badge'));
  const root = new Node('FRAME', '홈').add(button, new Node('FRAME', 'Row').add(card));
  root.setSharedPluginData('ns', 'screenId', 's1');
  card.setSharedPluginData('ns', 'flipbookOf', 'other');
  root.resolvedVariableModes = { theme: 'dark', density: 'compact' };
  root.explicitVariableModes = { density: 'compact' };
  page.appendChild(root);
  return root;
}

test('바깥 인스턴스부터 연결을 끊고, 원본 표식을 지우고, 물려받던 변수 모드를 직접 지정한다', async () => {
  setup();
  const source = screen();
  const holder = new Node('FRAME', 'GUI Image Slot');
  const copy = await copyLayers('ns', source as unknown as SceneNode, holder as unknown as FrameNode, 's1@2', 'STB_HO_001 GUI') as unknown as Node;
  assert.deepEqual(detached, ['Button', 'Card', 'Icon', 'Badge']);
  assert.equal(copy.findAllWithCriteria({ types: ['INSTANCE'] }).length, 0);
  assert.equal(copy.getSharedPluginData('ns', 'screenId'), '');
  assert.equal(copy.findAllWithCriteria({ sharedPluginData: { namespace: 'ns' } }).length, 0);
  assert.equal(copy.getSharedPluginData('ns', COPY_KEY), 's1@2');
  assert.deepEqual(copy.explicitVariableModes, { density: 'compact', theme: 'dark' });
  assert.deepEqual([copy.name, copy.parent], ['STB_HO_001 GUI', holder]);
  // 원본은 그대로다.
  assert.equal(source.findAllWithCriteria({ types: ['INSTANCE'] }).length, 4);
  assert.equal(source.getSharedPluginData('ns', 'screenId'), 's1');
});

test('컴포넌트 원본은 인스턴스를 만들어 끊고, 복사 중 실패하면 만든 노드를 지운다', async () => {
  setup();
  const holder = new Node('FRAME', 'GUI Image Slot');
  const component = new Node('COMPONENT', '팝업').add(new Node('INSTANCE', 'Button'));
  component.resolvedVariableModes = { theme: 'dark' };
  page.appendChild(component);
  const copy = await copyLayers('ns', component as unknown as SceneNode, holder as unknown as FrameNode, 's3@1', 'GUI') as unknown as Node;
  assert.equal(copy.type, 'FRAME');
  assert.deepEqual(detached, ['팝업', 'Button']);
  assert.deepEqual(detachedModes[0], { name: '팝업', modes: { theme: 'dark' } }, '원본 모드를 먼저 고정하고 분리한다');

  const broken = screen();
  broken.resolvedVariableModes = { theme: 'dark' };
  (globalThis as any).figma.variables.getVariableCollectionByIdAsync = async () => { throw new Error('mode failed'); };
  await assert.rejects(copyLayers('ns', broken as unknown as SceneNode, holder as unknown as FrameNode, 's1@1', 'GUI'), /mode failed/);
  assert.equal(holder.children.length, 1, 'failed copy is removed');
  assert.equal(page.children.filter(n => n.name === '홈').length, 1, 'only the source remains');
});

test('GUI 영역에는 원본을 바로 복사해 넣고, 같은 표식이면 다시 복사하지 않으며 마커는 그대로 둔다', async () => {
  setup();
  const source = screen();
  const nodes = new Map([[source.id, source]]);
  (globalThis as any).figma.getNodeByIdAsync = async (id: string) => nodes.get(id) ?? null;
  const area = new Node('FRAME', 'GUI Image Slot');
  const marker = new Node('FRAME', 'Marker');
  area.appendChild(marker);
  const gui = [{ uid: 's1', code: 'STB_HO_001', version: 2, key: 's1@2', sourceNodeId: source.id }];
  await syncGui('ns', area as unknown as FrameNode, gui, 0.5);
  const placed = area.children.find(n => n.getSharedPluginData('ns', COPY_KEY))!;
  assert.deepEqual([placed.getSharedPluginData('ns', COPY_KEY), placed.name, placed.locked, placed.width], ['s1@2', 'STB_HO_001 GUI', false, 954]);
  assert.ok(area.children.includes(marker), 'user marker stays');
  await syncGui('ns', area as unknown as FrameNode, gui, 0.5);
  assert.equal(area.children.find(n => n.getSharedPluginData('ns', COPY_KEY)), placed, 'same key and scale keeps the existing copy');
  // 새 버전은 이전 복사본만 바꾼다.
  await syncGui('ns', area as unknown as FrameNode, [{ ...gui[0], version: 3, key: 's1@3' }], 1);
  const next = area.children.filter(n => n.getSharedPluginData('ns', COPY_KEY));
  assert.deepEqual(next.map(n => n.getSharedPluginData('ns', COPY_KEY)), ['s1@3']);
  assert.equal(placed.removed, true);
  assert.ok(area.children.includes(marker));
  // 원본 프레임이 없으면 알리고 이전 복사본을 남긴다.
  await assert.rejects(syncGui('ns', area as unknown as FrameNode, [{ ...gui[0], version: 4, key: 's1@4', sourceNodeId: 'gone' }], 1), /STB_HO_001/);
  assert.equal(area.children.filter(n => n.getSharedPluginData('ns', COPY_KEY)).length, 1);
  // 한 플립북에 넣은 화면마다 서로 다른 크기를 적용한다.
  await syncGui('ns', area as unknown as FrameNode, [
    { ...gui[0], scale: 0.5 },
    { ...gui[0], uid: 's2', code: 'STB_HO_002', key: 's2@2', scale: 0.25 },
  ], 1);
  assert.deepEqual(area.children.filter(n => n.getSharedPluginData('ns', COPY_KEY)).map(n => n.width), [954, 471]);
});

test('여러 화면 중 바뀐 복사본만 교체하고 준비 중 실패하면 기존 GUI를 보존한다', async () => {
  setup();
  const first = screen();
  const second = screen();
  const nodes = new Map([[first.id, first], [second.id, second]]);
  (globalThis as any).figma.getNodeByIdAsync = async (id: string) => nodes.get(id) ?? null;
  const area = new Node('FRAME', 'GUI Image Slot');
  const gui = [
    { uid: 's1', code: 'STB_HO_001', version: 1, key: 's1@1', sourceNodeId: first.id },
    { uid: 's2', code: 'STB_HO_002', version: 1, key: 's2@1', sourceNodeId: second.id },
  ];
  const copies = () => area.children.filter(n => n.getSharedPluginData('ns', COPY_KEY));
  await syncGui('ns', area as unknown as FrameNode, gui, 0.5);
  const [oldFirst, oldSecond] = copies();
  const signature = area.getSharedPluginData('ns', 'flipbookImage');
  const changed = [{ ...gui[0] }, { ...gui[1], key: 's2@2', version: 2 }];
  const clone = second.clone;
  second.clone = () => { throw new Error('copy failed'); };
  await assert.rejects(syncGui('ns', area as unknown as FrameNode, changed, 0.5), /copy failed/);
  assert.deepEqual(copies(), [oldFirst, oldSecond]);
  assert.equal(area.getSharedPluginData('ns', 'flipbookImage'), signature);
  second.clone = clone;
  await syncGui('ns', area as unknown as FrameNode, changed, 0.5);
  assert.equal(copies()[0], oldFirst);
  assert.notEqual(copies()[1], oldSecond);
  assert.equal(oldSecond.removed, true);
});

test('GUI 이미지는 1920 안에서 순서대로 줄바꿈하고 긴 행 아래에 다음 행을 놓는다', async () => {
  setup();
  const source = screen();
  (globalThis as any).figma.getNodeByIdAsync = async () => source;
  const area = new Node('FRAME', 'GUI Image Slot');
  const scales = [1, 0.5, 0.5, 0.25, 0.25, 0.25, 0.25] as const;
  const gui = scales.map((itemScale, index) => ({
    uid: `s${index}`, code: `STB_HO_00${index}`, version: 1,
    key: `s${index}@1`, sourceNodeId: source.id, scale: itemScale,
  }));
  await syncGui('ns', area as unknown as FrameNode, gui, 1);
  const placed = area.children.filter(n => n.getSharedPluginData('ns', COPY_KEY));
  assert.deepEqual(placed.map(n => Math.round(n.x)), [0, 0, 966, 0, 483, 966, 1449]);
  assert.deepEqual(placed.map(n => Math.round(n.y)), [0, 1092, 1092, 1641, 1641, 1641, 1641]);
  assert.ok(placed.every(n => n.x + n.width <= 1920 + 0.01));
  assert.ok(area.height >= Math.max(...placed.map(n => n.y + n.height)));
});

test('줄인 GUI는 고정 크기 노드를 원래 크기×배율로 맞추고, 글꼴이 없으면 알리고 다음 반영 때 다시 복사한다', async () => {
  setup();
  const tile = Object.assign(new Node('FRAME', 'app dazn'), { width: 270, height: 270, layoutSizingHorizontal: 'FIXED', layoutSizingVertical: 'FIXED', stuck: true });
  const row = Object.assign(new Node('FRAME', 'List'), { width: 2034, height: 270, layoutSizingHorizontal: 'HUG', layoutSizingVertical: 'HUG', stuck: true }).add(tile);
  const title = Object.assign(new Node('TEXT', 'OTT'), { characters: 'OTT', fontName: { family: 'Missing', style: 'Bold' } });
  const source = new Node('FRAME', '홈').add(row, title);
  page.appendChild(source);
  (globalThis as any).figma.getNodeByIdAsync = async () => source;
  const area = new Node('FRAME', 'GUI Image Slot');
  const notes = new Set<string>();
  const gui = [{ uid: 's1', code: 'STB_HO_003', version: 1, key: 's1@1', sourceNodeId: source.id }];
  await syncGui('ns', area as unknown as FrameNode, gui, 0.5, notes);
  const copy = area.children[0];
  const [copyRow] = copy.children;
  assert.deepEqual([copyRow.children[0].width, copyRow.children[0].height], [270 * 954 / 1920, 270 * 954 / 1920], 'fixed tile is corrected');
  assert.equal(copyRow.width, 2034, 'hug row is left to auto layout');
  assert.deepEqual([...notes], [`${COPY.figmaFlipbook026} Missing Bold`]);
  assert.equal(area.getSharedPluginData('ns', 'flipbookImage'), '', 'no signature so the next sync copies again');
  await syncGui('ns', area as unknown as FrameNode, gui, 0.5, notes);
  assert.notEqual(area.children[0], copy, 'copied again');
});

test('GUI 슬롯이 한 열 너비여도 1920으로 넓혀 1/2 화면 두 장을 같은 행에 둔다', async () => {
  setup();
  const source = screen();
  (globalThis as any).figma.getNodeByIdAsync = async () => source;
  const area = new Node('FRAME', 'GUI Image Slot');
  area.width = 950;
  const parent = new Node('FRAME', 'Template Column');
  parent.layoutMode = 'HORIZONTAL';
  parent.appendChild(area);
  const gui = [0, 1].map(index => ({
    uid: `s${index}`, code: `STB_HO_00${index}`, version: 1,
    key: `s${index}@1`, sourceNodeId: source.id, scale: 0.5 as const,
  }));
  await syncGui('ns', area as unknown as FrameNode, gui, 1);
  const placed = area.children.filter(n => n.getSharedPluginData('ns', COPY_KEY));
  assert.equal(area.width, 1920);
  assert.equal(area.layoutSizingHorizontal, 'FIXED');
  assert.deepEqual(placed.map(n => Math.round(n.x)), [0, 966]);
  assert.deepEqual(placed.map(n => n.y), [0, 0]);
});

test('설정한 1x 폭(1440)으로 GUI 영역을 맞추고 1/2x 두 장·1/4x 네 장이 간격 포함 한 행에 꼭 들어간다', async () => {
  setup();
  const source = screen();
  (globalThis as any).figma.getNodeByIdAsync = async () => source;
  const area = new Node('FRAME', 'GUI Image Slot');
  const scales = [1, 0.5, 0.5, 0.25, 0.25, 0.25, 0.25] as const;
  const gui = scales.map((itemScale, index) => ({
    uid: `s${index}`, code: `STB_HO_00${index}`, version: 1,
    key: `s${index}@1`, sourceNodeId: source.id, scale: itemScale,
  }));
  await syncGui('ns', area as unknown as FrameNode, gui, 1, new Set(), 1440);
  const placed = area.children.filter(n => n.getSharedPluginData('ns', COPY_KEY));
  assert.equal(area.width, 1440);
  assert.deepEqual(placed.map(n => Math.round(n.width)), [1440, 714, 714, 351, 351, 351, 351]);
  assert.deepEqual(placed.map(n => Math.round(n.x)), [0, 0, 726, 0, 363, 726, 1089]);
  assert.deepEqual(placed.map(n => Math.round(n.y)), [0, 822, 822, 1236, 1236, 1236, 1236]);
  // 폭을 바꾸면 같은 화면도 다시 복사해 새 크기로 놓는다.
  const before = placed[0];
  await syncGui('ns', area as unknown as FrameNode, gui, 1, new Set(), 1920);
  assert.equal(before.removed, true);
  assert.equal(area.width, 1920);
});

test('복제한 플립북 프레임 대신 원본을 고른다', () => {
  const frame = (id: string, data: Record<string, string>) => {
    const map = new Map(Object.entries(data));
    return { id, map, getSharedPluginData: (_ns: string, key: string) => map.get(key) ?? '', setSharedPluginData: (_ns: string, key: string, value: string) => { map.set(key, value); } };
  };
  // 원본(자기 노드 ID를 적어 둠)과, 그 값을 그대로 가져간 복사본. 복사본이 나중에 놓여도 원본을 고른다.
  const original = frame('1:1', { flipbookOf: 'fb', flipbookNode: '1:1' });
  const copy = frame('1:2', { flipbookOf: 'fb', flipbookNode: '1:1' });
  assert.equal(pickFlipbookFrames('ns', [original, copy]).get('fb'), original);
  assert.equal(pickFlipbookFrames('ns', [copy, original]).get('fb'), original);
  assert.equal(copy.map.get('flipbookNode'), '1:1');

  // 노드 ID를 적기 전 프레임을 복제했으면 먼저 놓인 프레임을 고르고, 그 프레임에 노드 ID를 적어 다음에도 같은 프레임을 고른다.
  const legacy = frame('2:1', { flipbookOf: 'old' });
  const legacyCopy = frame('2:2', { flipbookOf: 'old' });
  assert.equal(pickFlipbookFrames('ns', [legacy, legacyCopy]).get('old'), legacy);
  assert.equal(legacy.map.get('flipbookNode'), '2:1');
  assert.equal(pickFlipbookFrames('ns', [legacyCopy, legacy]).get('old'), legacy);

  // 원본을 지우고 복사본만 남으면 복사본을 플립북으로 본다.
  assert.equal(pickFlipbookFrames('ns', [copy]).get('fb'), copy);
  assert.equal(copy.map.get('flipbookNode'), '1:2');
});

test('플립북 페이지 일부만 읽을 때는 원본 프레임만 고르고 표식은 고치지 않는다', () => {
  const frame = (id: string, data: Record<string, string>) => {
    const map = new Map(Object.entries(data));
    return { id, map, getSharedPluginData: (_ns: string, key: string) => map.get(key) ?? '' };
  };
  const original = frame('1:1', { flipbookOf: 'fb', flipbookNode: '1:1' });
  const copy = frame('1:2', { flipbookOf: 'fb', flipbookNode: '1:1' });
  assert.equal(originalFlipbookFrames('ns', [copy, original]).get('fb'), original);
  // 원본은 읽지 않은 페이지에 있을 수 있으므로 복사본만 있으면 찾지 못한 것으로 둔다.
  assert.equal(originalFlipbookFrames('ns', [copy]).has('fb'), false);
  // 노드 ID를 적기 전 프레임도 고르지 않는다(모든 페이지를 읽을 때 적는다).
  const legacy = frame('2:1', { flipbookOf: 'old' });
  assert.equal(originalFlipbookFrames('ns', [legacy]).has('old'), false);
  assert.deepEqual([copy.map.get('flipbookNode'), legacy.map.has('flipbookNode')], ['1:1', false]);
});

test('폭을 바꿔 다시 복사하면 마커는 크기를 두고 같은 화면의 같은 상대 위치로 옮긴다', async () => {
  setup();
  const source = screen();
  (globalThis as any).figma.getNodeByIdAsync = async () => source;
  const area = new Node('FRAME', 'GUI Image Slot');
  const one = [{ uid: 's1', code: 'STB_HO_001', version: 1, key: 's1@1', sourceNodeId: source.id }];
  await syncGui('ns', area as unknown as FrameNode, one, 1, new Set(), 1920);
  const marker = Object.assign(new Node('FRAME', 'Marker'), { x: 940, y: 520, width: 40, height: 40 });
  area.appendChild(marker);
  await syncGui('ns', area as unknown as FrameNode, one, 1, new Set(), 1440);
  assert.deepEqual([marker.x, marker.y, marker.width, marker.height], [700, 385, 40, 40], 'center 960,540 → 720,405 and size kept');
  // 같은 폭·같은 화면으로 다시 반영하면 움직이지 않는다.
  await syncGui('ns', area as unknown as FrameNode, [{ ...one[0], version: 2, key: 's1@2' }], 1, new Set(), 1440);
  assert.deepEqual([marker.x, marker.y], [700, 385]);
});

test('여러 화면 플립북의 마커는 자기 화면을 따라가고, 화면 순서가 바뀌어도 같은 화면에 남는다', async () => {
  setup();
  const source = screen();
  (globalThis as any).figma.getNodeByIdAsync = async () => source;
  const area = new Node('FRAME', 'GUI Image Slot');
  const half = (uid: string) => ({ uid, code: uid, version: 1, key: `${uid}@1`, sourceNodeId: source.id, scale: 0.5 as const });
  await syncGui('ns', area as unknown as FrameNode, [half('s0'), half('s1')], 1, new Set(), 1920);
  // 두 번째 화면(x 966, 폭 954)의 왼쪽 위에서 (100, 50) 떨어진 곳
  const marker = Object.assign(new Node('FRAME', 'Marker'), { x: 966 + 100 - 20, y: 50 - 20, width: 40, height: 40 });
  area.appendChild(marker);
  await syncGui('ns', area as unknown as FrameNode, [half('s1'), half('s0')], 1, new Set(), 1440);
  const ratio = 714 / 954;
  assert.ok(Math.abs(marker.x + 20 - 100 * ratio) < 0.01, 's1 is now first at x 0');
  assert.ok(Math.abs(marker.y + 20 - 50 * ratio) < 0.01);
  assert.deepEqual([marker.width, marker.height], [40, 40]);
});

test('플립북 프레임에 절대 위치로 놓은 노드는 중심이 GUI 영역 안일 때만 화면을 따라간다', async () => {
  setup();
  const source = screen();
  (globalThis as any).figma.getNodeByIdAsync = async () => source;
  const frame = Object.assign(new Node('FRAME', 'Flipbook'), { absoluteTransform: [[1, 0, 0], [0, 1, 0]] });
  const area = Object.assign(new Node('FRAME', 'GUI Image Slot'), { absoluteTransform: [[1, 0, 100], [0, 1, 200]] });
  frame.appendChild(area);
  const one = [{ uid: 's1', code: 'STB_HO_001', version: 1, key: 's1@1', sourceNodeId: source.id }];
  await syncGui('ns', area as unknown as FrameNode, one, 1, new Set(), 1920);
  const onScreen = Object.assign(new Node('FRAME', 'Marker'), { x: 100 + 960 - 20, y: 200 + 540 - 20, width: 40, height: 40 });
  const beside = Object.assign(new Node('FRAME', 'Note'), { x: 2500, y: 300, width: 200, height: 100 });
  frame.add(onScreen, beside);
  await syncGui('ns', area as unknown as FrameNode, one, 1, new Set(), 1440, [onScreen, beside] as unknown as SceneNode[]);
  assert.deepEqual([onScreen.x, onScreen.y, onScreen.width], [100 + 720 - 20, 200 + 405 - 20, 40]);
  assert.deepEqual([beside.x, beside.y], [2500, 300], 'outside the GUI area stays');
});
