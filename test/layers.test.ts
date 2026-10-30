import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COPY } from '../src/core/copy.ts';
import { originalFlipbookFrames, pickFlipbookFrames, syncFreeGui, syncGui } from '../src/figma/flipbook.ts';
import { pasteCopy, updateCopies } from '../src/figma/tracked.ts';
import { COPY_KEY, copyLayers, rescaleExact } from '../src/figma/layers.ts';

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
    Object.assign(copy, { x: this.x, y: this.y, width: this.width, height: this.height, visible: this.visible, locked: this.locked, explicitVariableModes: { ...this.explicitVariableModes } });
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
    createRectangle: () => new Node('RECTANGLE'),
    createText: () => new Node('TEXT'),
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
  assert.deepEqual([placed.getSharedPluginData('ns', COPY_KEY), placed.name, placed.locked, placed.width], ['s1@2', 'STB_HO_001 GUI', false, 940.8]);
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
  assert.deepEqual(area.children.filter(n => n.getSharedPluginData('ns', COPY_KEY)).map(n => n.width), [940.8, 940.8]);
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
  assert.deepEqual(placed.map(n => Math.round(n.x)), [0, 0, 953, 0, 953, 0, 953]);
  assert.deepEqual(placed.map(n => Math.round(n.y)), [0, 1092, 1092, 1633, 1633, 2174, 2174]);
  assert.ok(placed.every(n => n.x + n.width <= 1920 + 0.01));
  assert.deepEqual([area.width, area.height], [1920, 1080], 'GUI 영역은 복사본이 넘쳐도 템플릿 크기를 유지한다');
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
  assert.deepEqual([copyRow.children[0].width, copyRow.children[0].height], [270 * 940.8 / 1920, 270 * 940.8 / 1920], 'fixed tile is corrected');
  assert.equal(copyRow.width, 2034, 'hug row is left to auto layout');
  assert.deepEqual([...notes], [`${COPY.figmaFlipbook026} Missing Bold`]);
  assert.equal(area.getSharedPluginData('ns', 'flipbookImage'), '', 'no signature so the next sync copies again');
  await syncGui('ns', area as unknown as FrameNode, gui, 0.5, notes);
  assert.notEqual(area.children[0], copy, 'copied again');
});

test('GUI 슬롯의 폭과 sizing 설정을 유지하고 복사본만 기존 영역 폭에 맞춰 줄바꿈한다', async () => {
  setup();
  const source = screen();
  (globalThis as any).figma.getNodeByIdAsync = async () => source;
  const area = new Node('FRAME', 'GUI Image Slot');
  area.width = 950;
  area.layoutSizingHorizontal = 'FILL';
  area.resizeWithoutConstraints = () => { throw new Error('GUI area must not be resized'); };
  const parent = new Node('FRAME', 'Template Column');
  parent.layoutMode = 'HORIZONTAL';
  parent.appendChild(area);
  const gui = [0, 1].map(index => ({
    uid: `s${index}`, code: `STB_HO_00${index}`, version: 1,
    key: `s${index}@1`, sourceNodeId: source.id, scale: 0.5 as const,
  }));
  await syncGui('ns', area as unknown as FrameNode, gui, 1);
  const placed = area.children.filter(n => n.getSharedPluginData('ns', COPY_KEY));
  assert.deepEqual([area.width, area.height], [950, 1080]);
  assert.equal(area.layoutSizingHorizontal, 'FILL');
  assert.deepEqual(placed.map(n => Math.round(n.x)), [0, 0]);
  assert.deepEqual(placed.map(n => Math.round(n.y)), [0, 541]);
});

test('최대 폭은 복사본에만 적용하고 이전 1/2·1/4 선택도 기본의 0.49배로 배치한다', async () => {
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
  assert.deepEqual([area.width, area.height], [1920, 1080]);
  assert.deepEqual(placed.map(n => Math.round(n.width)), [1440, 706, 706, 706, 706, 706, 706]);
  assert.deepEqual(placed.map(n => Math.round(n.x)), [0, 0, 718, 0, 718, 0, 718]);
  assert.deepEqual(placed.map(n => Math.round(n.y)), [0, 822, 822, 1231, 1231, 1640, 1640]);
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
  const marker = Object.assign(new Node('FRAME', 'Marker'), { x: 952.8 + 100 - 20, y: 50 - 20, width: 40, height: 40 });
  area.appendChild(marker);
  await syncGui('ns', area as unknown as FrameNode, [half('s1'), half('s0')], 1, new Set(), 1440);
  const ratio = 705.6 / 940.8;
  assert.ok(Math.abs(marker.x + 20 - 100 * ratio) < 0.01, 's1 is now first at x 0');
  assert.ok(Math.abs(marker.y + 20 - 50 * ratio) < 0.01);
  assert.deepEqual([marker.width, marker.height], [40, 40]);
});

test('교체로 바뀐 자리의 마커는 이어받은 화면을 따라가고, 이어받은 화면이 이미 있으면 빠진 자리의 마커는 제자리에 둔다', async () => {
  setup();
  const source = screen();
  (globalThis as any).figma.getNodeByIdAsync = async () => source;
  const half = (uid: string, extra: object = {}) => ({ uid, code: uid, version: 1, key: `${uid}@1`, sourceNodeId: source.id, scale: 0.5 as const, ...extra });
  const s1 = half('s1', { version: 2, key: 's1@2', formerUids: ['old'] });
  // 두 번째 화면(x 952.8)의 왼쪽 위에서 (100, 50) 떨어진 곳의 마커
  const markerOn = (area: Node) => {
    const marker = Object.assign(new Node('FRAME', 'Marker'), { x: 952.8 + 100 - 20, y: 50 - 20, width: 40, height: 40 });
    area.appendChild(marker);
    return marker;
  };
  const swapped = new Node('FRAME', 'GUI Image Slot');
  await syncGui('ns', swapped as unknown as FrameNode, [half('s0'), half('old')], 1, new Set(), 1920);
  const follows = markerOn(swapped);
  // old 자리를 s1이 이어받고 맨 앞으로 왔다.
  await syncGui('ns', swapped as unknown as FrameNode, [s1, half('s0')], 1, new Set(), 1920);
  assert.deepEqual([follows.x + 20, follows.y + 20], [100, 50]);

  const both = new Node('FRAME', 'GUI Image Slot');
  await syncGui('ns', both as unknown as FrameNode, [half('s1'), half('old')], 1, new Set(), 1920);
  const stays = markerOn(both);
  await syncGui('ns', both as unknown as FrameNode, [s1], 1, new Set(), 1920);
  assert.deepEqual([stays.x, stays.y], [952.8 + 100 - 20, 50 - 20], 's1 keeps its own markers; the removed slot does not take them');
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

test('화면을 플립북 위에 얹을 때도 GUI 영역 크기를 유지하고 바깥 플립북만 늘린다', async () => {
  setup();
  const wide = screen();
  const mobile = new Node('FRAME', '모바일'); mobile.width = 390; mobile.height = 844; page.appendChild(mobile);
  const third = new Node('FRAME', '세 번째'); page.appendChild(third);
  const nodes = new Map([[wide.id, wide], [mobile.id, mobile], [third.id, third]]);
  (globalThis as any).figma.getNodeByIdAsync = async (id: string) => nodes.get(id) ?? null;
  const frame = new Node('FRAME', 'Book'); frame.layoutMode = 'NONE'; frame.width = 1920; frame.height = 1500;
  const area = new Node('FRAME', 'GUI Area'); area.x = 24; area.y = 200; area.width = 1488; area.height = 858;
  const table = new Node('FRAME', '표'); area.appendChild(table);
  frame.appendChild(area);
  const g = (uid: string, source: Node, version = 1, scale?: 1 | 0.5) => ({ uid, code: uid.toUpperCase(), version, key: `${uid}@${version}`, sourceNodeId: source.id, scale });
  const copies = () => frame.children.filter(n => n.getSharedPluginData('ns', COPY_KEY));
  const sync = (gui: ReturnType<typeof g>[]) => syncFreeGui('ns', frame as unknown as FrameNode, area as unknown as FrameNode, gui, 1, new Set(), 1440);

  await sync([g('a', wide), g('b', mobile)]);
  const [a, b] = copies();
  assert.deepEqual([a.x, a.y, a.width, a.height], [48, 224, 1440, 810], 'wide screen is clamped to the max width at the area corner');
  assert.deepEqual([b.x, b.y, b.width, b.height], [48, 1046, 390, 844], 'narrow screen keeps its size and wraps below');
  assert.ok(area.children.includes(table), 'area content stays');
  assert.deepEqual([area.width, area.height], [1488, 858], 'GUI 영역은 템플릿 크기를 유지한다');
  assert.equal(frame.height, 1046 + 844 + 24, 'frame without auto layout grows too');

  // 사용자가 옮긴 화면은 새 버전에서도 그 자리를 지키고 위의 마커도 따라간다. 넘친 만큼 플립북 폭을 늘린다.
  b.x = 1600; b.y = 300;
  const marker = new Node('FRAME', 'Marker'); marker.x = 1700; marker.y = 400; marker.width = 20; marker.height = 20; frame.appendChild(marker);
  await sync([g('a', wide), g('b', mobile, 2)]);
  const b2 = copies().find(n => n.getSharedPluginData('ns', COPY_KEY) === 'b@2')!;
  assert.equal(b.removed, true);
  assert.deepEqual([b2.x, b2.y], [1600, 300]);
  assert.deepEqual([marker.x, marker.y], [1700, 400]);
  assert.equal(frame.width, 1600 + 390 + 24);
  assert.equal(copies()[0], a, 'unchanged screen is not copied again');

  // 작게는 최대 폭으로 줄인 크기의 0.49배이고 자리는 그대로다. 새 화면은 앞 화면 뒤(넘치면 다음 줄)에 놓는다.
  await sync([g('a', wide, 1, 0.5), g('b', mobile, 2), g('c', third)]);
  const [a2, , c] = copies();
  assert.deepEqual([a2.x, a2.y, Math.round(a2.width * 10) / 10], [48, 224, 705.6]);
  assert.deepEqual([c.x, c.y, c.width], [48, 300 + 844 + 12, 1440]);
});


test('추적 GUI 재배포는 K로 바꾼 폭·자리·순서·잠금과 마커를 보존하고 원본이 없으면 기존 레이어를 남긴다', async () => {
  setup();
  const source = screen();
  const frame = new Node('FRAME', '플립북'); page.appendChild(frame);
  const before = new Node('FRAME', 'Description'); frame.appendChild(before);
  const old = new Node('FRAME', '사용자 이름'); old.width = 600; old.height = 400; old.x = 120; old.y = 230; old.locked = true;
  old.setSharedPluginData('ns', COPY_KEY, 's1@1'); frame.appendChild(old);
  const marker = new Node('FRAME', 'Marker'); marker.x = 150; marker.y = 260; frame.appendChild(marker);
  (globalThis as any).figma.getNodeByIdAsync = async (id: string) => [page, ...page.all()].find(n => n.id === id) ?? null;
  const result = await updateCopies('ns', [{ uid: 's1', code: 'STB_HO_001', key: 's1@2', sourceNodeId: source.id, copies: [{ nodeId: old.id, trackId: 't1' }] }]);
  const copy = frame.children[1];
  assert.equal(old.removed, true);
  assert.deepEqual([copy.width, copy.x, copy.y, copy.name, copy.locked], [600, 120, 230, '사용자 이름', true]);
  assert.deepEqual(frame.children, [before, copy, marker]);
  assert.deepEqual([marker.x, marker.y], [150, 260]);
  assert.equal(copy.getSharedPluginData('ns', COPY_KEY), 's1@2');
  assert.equal(copy.getSharedPluginData('ns', 'trackOf'), 't1');
  assert.deepEqual(result.updated, [{ trackId: 't1', nodeId: copy.id }]);
  const failed = await updateCopies('ns', [{ uid: 's1', code: 'STB_HO_001', key: 's1@3', sourceNodeId: 'missing', copies: [{ nodeId: copy.id, trackId: 't1' }] }]);
  assert.equal(failed.updated.length, 0);
  assert.equal(copy.removed, false);
  assert.deepEqual(frame.children, [before, copy, marker]);
});

test('GUI 붙이기는 Auto Layout 구조와 숨긴 Screen ID를 만들고 재배포 때 유지한다', async () => {
  setup();
  const source = screen();
  source.width = 360; source.height = 720;
  (globalThis as any).figma.currentPage = page;
  (globalThis as any).figma.viewport = { center: { x: 500, y: 500 } };
  (globalThis as any).figma.getNodeByIdAsync = async (id: string) => [page, ...page.all()].find(n => n.id === id) ?? null;
  const placed = await pasteCopy('ns', { key: 's1@1', code: 'MO_MY_002', name: 'Purchase step1 _Mobile', sourceNodeId: source.id, trackId: 't1', scale: 1, maxWidth: 1440 }, null);
  const root = page.all().find(n => n.id === placed.nodeId)!;
  assert.deepEqual([root.name, root.width, root.height, root.getSharedPluginData('ns', COPY_KEY), root.getSharedPluginData('ns', 'trackOf')], ['🔗 GUI · 자동 업데이트', 360, 761, 's1@1', 't1']);
  assert.deepEqual(root.children.map(n => n.name), ['Label', 'Screen']);
  assert.deepEqual([root.layoutMode, root.itemSpacing, root.primaryAxisSizingMode, root.counterAxisSizingMode], ['VERTICAL', 16, 'AUTO', 'AUTO']);
  assert.equal(root.getSharedPluginData('ns', 'pasteLayout'), 'labeled-v2');
  const [label, mobile] = root.children;
  assert.deepEqual([label.layoutMode, label.itemSpacing, label.layoutSizingHorizontal, label.layoutSizingVertical], ['VERTICAL', 4, 'FILL', 'HUG']);
  assert.deepEqual(label.children.map(n => n.name), ['Screen ID', 'Screen Title']);
  assert.equal(label.children[0].visible, false);
  assert.equal(label.children[0].layoutMode, 'HORIZONTAL');
  assert.deepEqual(label.children[0].children.map(n => n.name), ['bg', 'text']);
  assert.equal(label.children[0].children[0].layoutPositioning, 'ABSOLUTE');
  assert.equal(label.children[0].children[1].characters, 'MO_MY_002');
  assert.equal(label.children[1].characters, 'Purchase step1 _Mobile');
  assert.equal(mobile.layoutMode, 'VERTICAL');
  assert.equal(mobile.children[0].name, 'GUI');
  assert.equal(mobile.children[0].getSharedPluginData('ns', COPY_KEY), '', '추적 표식은 바깥 GUI 프레임에만 둔다');

  root.name = '내가 바꾼 프레임 이름';
  root.visible = false;
  label.visible = false;
  label.children[1].characters = '내가 수정한 화면명';
  label.children[1].visible = false;
  mobile.visible = false;
  const beforeGui = mobile.children[0];
  beforeGui.name = '내가 바꾼 GUI 이름';
  beforeGui.visible = false;
  root.setSharedPluginData('ns', 'pasteLayout', 'mobile-v1'); // 이전 빌드에서 붙인 래퍼도 계속 반영한다.
  source.appendChild(new Node('FRAME', 'Version 2'));
  const result = await updateCopies('ns', [{ uid: 's1', code: 'MO_MY_002', key: 's1@2', sourceNodeId: source.id, copies: [{ nodeId: root.id, trackId: 't1' }] }]);
  assert.deepEqual(result.updated, [{ trackId: 't1', nodeId: root.id }], '표식이 있는 바깥 프레임은 교체하지 않는다');
  assert.equal(root.removed, false);
  assert.deepEqual([root.name, root.visible, label.visible, label.children[1].characters, label.children[1].visible, mobile.visible],
    ['내가 바꾼 프레임 이름', false, false, '내가 수정한 화면명', false, false]);
  assert.equal(root.getSharedPluginData('ns', COPY_KEY), 's1@2');
  assert.equal(label.children[0].visible, false);
  assert.equal(beforeGui.removed, true);
  assert.deepEqual([mobile.children[0].name, mobile.children[0].visible], ['내가 바꾼 GUI 이름', false]);
  assert.ok(mobile.children[0].all().some(n => n.name === 'Version 2'), 'GUI 내부만 새 버전으로 교체한다');
});


test('이전 템플릿도 모바일 원본 크기를 유지하고 오래된 축소 복사본을 다시 만든다', async () => {
  setup();
  const source = Object.assign(screen(), { width: 360, height: 720 });
  (globalThis as any).figma.getNodeByIdAsync = async () => source;
  const area = new Node('FRAME', 'GUI Image Slot');
  const old = Object.assign(new Node('FRAME', 'old GUI'), { width: 270, height: 540 });
  old.setSharedPluginData('ns', COPY_KEY, 's1@1');
  area.appendChild(old);
  area.setSharedPluginData('ns', 'flipbookImage', JSON.stringify(['rows-v7', 1440, [['s1@1', 1]]]));
  const gui = [{ uid: 's1', code: 'MO_MY_009', version: 1, key: 's1@1', sourceNodeId: source.id }];
  await syncGui('ns', area as unknown as FrameNode, gui, 1, new Set(), 1440);
  assert.equal(old.removed, true);
  assert.deepEqual([area.children[0].width, area.children[0].height], [360, 720]);
  await syncGui('ns', area as unknown as FrameNode, gui, 0.5, new Set(), 1440);
  assert.deepEqual([area.children[0].width, area.children[0].height], [176.4, 352.8]);
});

test('부모 크기 보정 뒤 절대 위치 레이어의 크기와 위치를 복원한다', async () => {
  setup();
  const interaction = Object.assign(new Node('FRAME', 'Interaction'), {
    width: 328, height: 42, x: 0, y: 0, layoutPositioning: 'ABSOLUTE',
    layoutSizingHorizontal: 'FIXED', layoutSizingVertical: 'FIXED',
  });
  const root = Object.assign(new Node('FRAME', 'Button'), {
    width: 328, height: 42, layoutSizingHorizontal: 'FIXED', layoutSizingVertical: 'FIXED',
  }).add(interaction);
  root.rescale = () => { root.width = 246; root.height = 32; interaction.width = 246; interaction.height = 32; interaction.y = -0.5; };
  root.resizeWithoutConstraints = (w: number, h: number) => {
    root.resize(w, h);
    interaction.height = 32; interaction.y = -0.5;
  };
  await rescaleExact(root as unknown as FrameNode, 0.75);
  assert.deepEqual([root.width, root.height], [246, 31.5]);
  assert.deepEqual([interaction.layoutPositioning, interaction.width, interaction.height, interaction.x, interaction.y], ['ABSOLUTE', 246, 31.5, 0, 0]);
});
