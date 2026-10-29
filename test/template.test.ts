import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COPY } from '../src/core/copy.ts';
import { LINKS_KEY, PART_KEY, parseLinks } from '../src/core/templateParts.ts';
import type { FlipbookRow } from '../src/core/flipbook.ts';
import { syncMarkedRows, type TagKit } from '../src/figma/flipbook.ts';
import { selectionTarget } from '../src/figma/description.ts';
import { connectTemplateItem, describeTemplate, disconnectTemplateItem, flipbookParts, pdfHiddenParts, templateIssues } from '../src/figma/template.ts';

// 템플릿 연결(2026-10-28): 표식 템플릿은 역할 표식으로 칸을 찾고, 이름 규칙 템플릿은 처음 연결할 때 표식으로 바뀐다.
const NS = 'guiuipublish';

class Node {
  [key: string]: any;
  id: string;
  type: string;
  name: string;
  children: Node[] = [];
  parent: Node | null = null;
  removed = false;
  remote = false;
  characters = '';
  fontName = { family: 'Inter', style: 'Regular' };
  componentProperties: Record<string, { value: string }> = {};
  layoutMode = 'NONE';
  layoutSizingHorizontal = 'FIXED';
  data = new Map<string, string>();
  constructor(type: string, name: string, id: string) { this.type = type; this.name = name; this.id = id; }
  appendChild(n: Node) { this.insertChild(this.children.length, n); }
  insertChild(i: number, n: Node) {
    if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1);
    this.children.splice(i, 0, n); n.parent = this;
  }
  remove() {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null; this.removed = true;
  }
  setSharedPluginData(ns: string, key: string, value: string) { this.data.set(`${ns}:${key}`, value); }
  getSharedPluginData(ns: string, key: string) { return this.data.get(`${ns}:${key}`) ?? ''; }
  findChild(fn: (n: Node) => boolean) { return this.children.find(fn) ?? null; }
  findAll(fn: (n: Node) => boolean): Node[] { return this.children.flatMap(n => [...(fn(n) ? [n] : []), ...(n.children ? n.findAll(fn) : [])]); }
  findOne(fn: (n: Node) => boolean) { return this.findAll(fn)[0] ?? null; }
  getRangeAllFontNames() { return [this.fontName]; }
}

// 노드를 읽으면 실패한다. 찾을 때 내려가지 않아야 하는 칸(GUI 영역 등) 안에 둔다.
const poison = () => new Proxy({}, { get: () => { throw new Error('visited'); }, has: () => { throw new Error('visited'); } }) as unknown as Node;

function world() {
  let seq = 0;
  const nodes = new Map<string, Node>();
  const make = (type: string, name = '', children: Node[] = []) => {
    const node = new Node(type, name, `${++seq}:1`);
    nodes.set(node.id, node);
    for (const child of children) node.appendChild(child);
    return node;
  };
  const role = (node: Node, value: string) => { node.setSharedPluginData(NS, PART_KEY, value); return node; };
  // 인스턴스는 컴포넌트의 자식 구성과 표식을 그대로 이어받는다(실제 Figma와 같다).
  const copy = (node: Node, type = node.type): Node => {
    const out = make(type, node.name);
    out.characters = node.characters;
    out.data = new Map(node.data);
    for (const child of node.children) out.appendChild(copy(child));
    return out;
  };
  const component = (name: string, children: Node[] = []) => {
    const c = make('COMPONENT', name, children);
    c.createInstance = () => {
      const inst = copy(c, 'INSTANCE');
      inst.getMainComponentAsync = async () => c;
      return inst;
    };
    return c;
  };
  const page = make('PAGE', 'Page');
  page.loadAsync = async () => {};
  page.findAllWithCriteria = (criteria: { types?: string[] }) => page.findAll(n => !criteria.types || criteria.types.includes(n.type));
  let selection: Node[] = [];
  Object.assign(globalThis, { figma: {
    mixed: Symbol('mixed'),
    getNodeByIdAsync: async (id: string) => nodes.get(id) ?? null,
    loadFontAsync: async () => {},
    currentPage: { get selection() { return selection; } },
  } });
  return { make, role, component, page, select: (...picked: Node[]) => { selection = picked; } };
}

const text = (w: ReturnType<typeof world>, name: string, characters = name) => { const t = w.make('TEXT', name); t.characters = characters; return t; };

test('표식 템플릿에서 만든 플립북은 칸을 표식으로 찾고 GUI 영역·Description·Screen ID 칸·이력 행 안으로는 내려가지 않는다', () => {
  const w = world();
  const gui = w.role(w.make('FRAME', 'Area'), 'gui'); gui.children.push(poison());
  const description = w.role(w.make('FRAME', 'Notes'), 'description'); description.children.push(poison());
  const ids = w.role(w.make('FRAME', 'Codes'), 'ids'); ids.children.push(poison());
  const row = w.role(w.make('INSTANCE', 'Row'), 'row'); row.children.push(poison());
  const list = w.role(w.make('FRAME', 'Rows', [row]), 'history');
  const hidden = w.role(w.make('FRAME', 'Box', [list]), 'pdfHidden');
  const titles = [w.role(text(w, 'A'), 'title'), w.role(text(w, 'B'), 'title')];
  const chapter = w.role(text(w, 'C'), 'chapter');
  const status = w.role(w.make('INSTANCE', 'Tag'), 'status');
  const frame = w.make('FRAME', 'Book', [w.make('FRAME', 'Head', [...titles, chapter, status, ids]), w.make('FRAME', 'Body', [gui, description]), hidden]);
  frame.setSharedPluginData(NS, LINKS_KEY, '{"components":{}}');
  const p = flipbookParts(frame as unknown as FrameNode);
  assert.ok(p.links);
  assert.equal(p.named, null);
  assert.deepEqual(p.titles.map(n => n.name), ['A', 'B']);
  assert.equal(p.chapter?.name, 'C');
  assert.equal(p.status?.name, 'Tag');
  assert.equal(p.gui?.name, 'Area');
  assert.equal(p.ids?.name, 'Codes');
  assert.equal(p.description?.name, 'Notes');
  assert.equal(p.list?.name, 'Rows');
  assert.equal(p.previous, null);
  assert.deepEqual(pdfHiddenParts(frame as unknown as FrameNode).map(n => n.name), ['Box']);
});

function namedTemplate(w: ReturnType<typeof world>) {
  const rowComponent = w.component('isSystem=false', [
    w.make('FRAME', 'Comment', [text(w, 'Text')]), w.make('FRAME', 'Name', [text(w, 'Text')]), w.make('FRAME', 'Date', [text(w, 'Text')]),
    w.make('INSTANCE', 'Status'), w.make('INSTANCE', 'Team'),
  ]);
  const sample = rowComponent.createInstance(); sample.name = 'Update History';
  const previous = w.make('FRAME', 'Previous');
  const list = w.make('SLOT', 'List', [previous, sample]);
  const history = w.component('Update History List', [list]);
  const titleText = text(w, 'Text', 'Title');
  const status = w.make('INSTANCE', 'Status');
  const title = w.component('UI Title', [titleText, status]);
  const chapter = text(w, 'Text', 'Chapter');
  const page = text(w, 'Text', 'Page');
  const ids = w.make('SLOT', 'input-cell-id');
  const header = w.component('Flipbook-Title', [w.make('FRAME', 'input-cell-chapter', [chapter]), w.make('FRAME', 'input-cell-page', [page]), ids]);
  const gui = w.make('FRAME', 'GUI Image Slot');
  const note = text(w, 'Note');
  const template = w.make('FRAME', 'Flipbook-Template', [title, header, gui, history, note]);
  const big = w.component('TagBig', [text(w, 'Text')]);
  const small = w.component('TagSmall', [text(w, 'Text')]);
  const system = w.component('Tag=System', [text(w, 'Text')]);
  const team = w.make('COMPONENT_SET', 'Team', [system]);
  for (const node of [template, big, small, team, rowComponent]) w.page.appendChild(node);
  return { template, titleText, status, chapter, page, ids, gui, list, previous, title, history, note, big, small, system, rowComponent };
}

test('이름 규칙 템플릿에서 항목 하나를 연결하면 이름으로 찾은 칸을 모두 표식으로 바꾸고, 고른 레이어를 그 항목에 연결한다', async () => {
  const w = world();
  const t = namedTemplate(w);
  const before = await describeTemplate(t.template.id);
  assert.equal(before.linked, false);
  assert.deepEqual(before.items.find(i => i.key === 'gui')?.layers.map(l => l.name), ['GUI Image Slot']);
  assert.deepEqual(before.items.filter(i => i.problem).map(i => i.key), []);

  w.select(t.note);
  await connectTemplateItem(t.template.id, 'chapter');
  const links = parseLinks(t.template.getSharedPluginData(NS, LINKS_KEY));
  assert.deepEqual(links?.components, { statusTag: t.big.id, rowStatusTag: t.small.id, idTag: t.system.id, row: t.rowComponent.id });
  const roleOf = (n: Node) => n.getSharedPluginData(NS, PART_KEY);
  assert.deepEqual([t.titleText, t.page, t.status, t.ids, t.gui, t.list, t.previous, t.title, t.history].map(roleOf),
    ['title', 'title', 'status', 'ids', 'gui', 'history', 'previous', 'pdfHidden', 'pdfHidden']);
  assert.equal(roleOf(t.chapter), '', 'the previous chapter layer is released');
  assert.equal(roleOf(t.note), 'chapter');
  assert.equal(roleOf(t.rowComponent), 'row');
  assert.equal(roleOf(t.rowComponent.findOne((n: Node) => n.type === 'TEXT' && n.parent?.name === 'Comment')!), 'rowComment');
  assert.equal(roleOf(t.rowComponent.findOne((n: Node) => n.name === 'Team')!), 'rowTeam');

  const after = await describeTemplate(t.template.id);
  assert.equal(after.linked, true);
  assert.deepEqual(after.items.find(i => i.key === 'chapter')?.layers.map(l => l.name), ['Note']);
  assert.deepEqual(after.items.find(i => i.key === 'rowComment')?.layers.map(l => l.name), ['Comment › Text']);
  assert.deepEqual(await templateIssues(t.template.id), []);
});

test('연결은 템플릿 안·찾을 수 있는 자리의 맞는 종류 레이어만 받고, 필수 칸과 컴포넌트가 빠지면 알린다', async () => {
  const w = world();
  const inGui = text(w, 'Copy');
  const gui = w.role(w.make('FRAME', 'Area', [inGui]), 'gui');
  const lockedFrame = w.make('FRAME', 'Inner');
  const instance = w.make('INSTANCE', 'Card', [lockedFrame]);
  const a = text(w, 'A'), b = text(w, 'B');
  const box = w.make('FRAME', 'Box');
  const template = w.make('FRAME', 'Mine', [gui, instance, a, b, box]);
  const outside = text(w, 'Outside');
  w.page.appendChild(template); w.page.appendChild(outside);
  template.setSharedPluginData(NS, LINKS_KEY, '{"components":{}}');

  w.select(inGui);
  await assert.rejects(connectTemplateItem(template.id, 'title'), { message: COPY.figmaTemplate016 });
  w.select(outside);
  await assert.rejects(connectTemplateItem(template.id, 'title'), { message: COPY.figmaTemplate015 });
  w.select(box);
  await assert.rejects(connectTemplateItem(template.id, 'title'), { message: COPY.figmaTemplate002 });
  w.select(lockedFrame);
  await assert.rejects(connectTemplateItem(template.id, 'ids'), { message: COPY.figmaTemplate004 });
  w.select(a, b);
  await assert.rejects(connectTemplateItem(template.id, 'chapter'), { message: COPY.figmaTemplate014 });
  await connectTemplateItem(template.id, 'title');
  assert.deepEqual([a, b].map(n => n.getSharedPluginData(NS, PART_KEY)), ['title', 'title']);
  w.select(b);
  await connectTemplateItem(template.id, 'title');
  assert.deepEqual([a, b].map(n => n.getSharedPluginData(NS, PART_KEY)), ['', 'title'], 'reconnecting replaces the earlier layers');
  await assert.rejects(disconnectTemplateItem(template.id, 'gui'), { message: COPY.figmaTemplate021 });

  w.select(box);
  await connectTemplateItem(template.id, 'ids');
  assert.match((await templateIssues(template.id)).join('\n'), new RegExp(COPY.figmaTemplate008));
  gui.setSharedPluginData(NS, PART_KEY, '');
  assert.match((await templateIssues(template.id)).join('\n'), new RegExp(`${COPY.coreTemplate009}: ${COPY.figmaTemplate007}`));

  // 이력 행 칸은 연결한 이력 행 컴포넌트 안(템플릿에 놓인 그 인스턴스 안에서 골라도 된다)에서만 고른다.
  const comment = text(w, 'Comment');
  const row = w.component('Row', [w.make('FRAME', 'Cell', [comment])]);
  w.page.appendChild(row);
  w.select(comment);
  await assert.rejects(connectTemplateItem(template.id, 'rowComment'), { message: COPY.figmaTemplate017 });
  w.select(row);
  await connectTemplateItem(template.id, 'row');
  assert.equal(row.getSharedPluginData(NS, PART_KEY), 'row');
  const sample = row.createInstance();
  box.appendChild(sample);
  w.select(sample.children[0].children[0]);
  await connectTemplateItem(template.id, 'rowComment');
  assert.equal(comment.getSharedPluginData(NS, PART_KEY), 'rowComment', 'a layer picked inside the sample row marks the component layer');
});

test('이력 목록과 이전 이력칸은 슬롯 또는 슬롯 안 프레임을 연결하고 다른 항목은 슬롯 안 레이어를 거부한다', async () => {
  const w = world();
  const previousLayer = w.make('FRAME', 'Previous content');
  const previous = w.make('SLOT', 'Previous', [previousLayer]);
  const historyLayer = w.make('FRAME', 'History content');
  const history = w.make('SLOT', 'History', [historyLayer]);
  const template = w.make('FRAME', 'Mine', [previous, history]);
  w.page.appendChild(template);
  template.setSharedPluginData(NS, LINKS_KEY, '{"components":{}}');

  w.select(previousLayer);
  await connectTemplateItem(template.id, 'previous');
  assert.equal(previousLayer.getSharedPluginData(NS, PART_KEY), 'previous');
  w.select(previous);
  await connectTemplateItem(template.id, 'previous');
  assert.equal(previous.getSharedPluginData(NS, PART_KEY), 'previous', '슬롯 자체도 연결 가능');
  w.select(previousLayer);
  await connectTemplateItem(template.id, 'previous');

  w.select(historyLayer);
  await connectTemplateItem(template.id, 'history');
  assert.equal(historyLayer.getSharedPluginData(NS, PART_KEY), 'history');

  previousLayer.setSharedPluginData(NS, PART_KEY, '');
  historyLayer.setSharedPluginData(NS, PART_KEY, '');
  await assert.rejects(connectTemplateItem(template.id, 'chapter'), { message: COPY.figmaTemplate016 });
});

test('표식 템플릿의 이력은 이력 행 컴포넌트의 인스턴스만 다루고 머리 행은 두며, 둘째 기록부터 이전 이력 칸에 넣는다', async () => {
  const w = world();
  const label = text(w, 'Text', 'Tag');
  const row = w.role(w.component('Row', [
    w.role(w.make('INSTANCE', 'State', [label]), 'rowStatus'), w.role(text(w, 'Comment'), 'rowComment'), w.role(text(w, 'Team'), 'rowTeam'),
    w.role(text(w, 'Who'), 'rowWorker'), w.role(text(w, 'When'), 'rowDate'),
  ]), 'row');
  let made = 0;
  const create = row.createInstance;
  row.createInstance = () => { made++; return create(); };
  const head = w.make('FRAME', 'Head');
  const example = row.createInstance();
  const previous = w.role(w.make('FRAME', 'Older'), 'previous');
  const list = w.role(w.make('FRAME', 'Rows', [head, example, previous]), 'history');
  list.layoutMode = 'VERTICAL';
  made = 0;
  const kit = { template: w.make('FRAME'), links: { components: { row: row.id } }, big: null, small: null, idTag: null, row, defaults: { title: [], chapter: [] }, fonts: new Map() } as unknown as TagKit;
  const data = (v: number, team: 'GUI' | 'UI' = 'GUI'): FlipbookRow => ({ key: `${team}:batch${v}`, team, description: `change ${v}`, worker: 'User', at: `10/2${v} 12:00`, colorKey: 'Green', tag: { id: 't', name: `tag ${v}`, colorKey: 'Green', color: '#fff' } });
  const settings = { pageId: 'p', templateId: 't' };
  const notes = new Set<string>();
  await syncMarkedRows(NS, list as unknown as SceneNode, previous as unknown as SceneNode, settings, [data(2, 'UI'), data(1)], kit, notes);
  assert.equal(example.removed, true);
  assert.deepEqual(list.children.map((n: Node) => n.name), ['Head', 'Row', 'Older']);
  assert.equal(previous.children.length, 1);
  const [latest] = list.children.filter((n: Node) => n.name === 'Row');
  const cell = (r: Node, name: string) => r.findOne((n: Node) => n.name === name)!.characters;
  assert.deepEqual(['Comment', 'Team', 'Who', 'When', 'Text'].map(n => cell(latest, n)), ['change 2', 'UI', 'User', '10/22 12:00', 'tag 2']);
  assert.equal(cell(previous.children[0], 'Team'), 'GUI');
  assert.equal(latest.layoutSizingHorizontal, 'FILL');
  assert.equal(previous.children[0].layoutSizingHorizontal, 'FIXED', 'rows in a frame without auto layout keep their width');
  assert.equal(made, 2);
  await syncMarkedRows(NS, list as unknown as SceneNode, previous as unknown as SceneNode, settings, [data(3), data(2, 'UI'), data(1)], kit, notes);
  assert.equal(made, 3, 'existing rows are reused');
  assert.deepEqual(previous.children.map((n: Node) => cell(n, 'Comment')), ['change 2', 'change 1']);
  assert.deepEqual([...notes], []);
});

test('표식 템플릿에서 만든 플립북의 텍스트 편집 대상은 「Description 본문」에 연결한 칸이다', () => {
  const w = world();
  const copy = text(w, 'Description');
  const gui = w.role(w.make('FRAME', 'Area', [w.make('FRAME', 'Screen', [copy])]), 'gui');
  const notes = w.role(w.make('FRAME', 'Notes'), 'description');
  const frame = w.make('FRAME', 'Book One', [gui, w.make('FRAME', 'Side', [notes])]);
  frame.setSharedPluginData(NS, 'flipbookOf', 'fb1');
  frame.setSharedPluginData(NS, LINKS_KEY, '{"components":{}}');
  w.page.appendChild(frame);
  w.select(copy);
  assert.deepEqual(selectionTarget(), { kind: 'description', flipbookId: 'fb1', name: 'Book One' });
  notes.setSharedPluginData(NS, PART_KEY, '');
  w.select(copy);
  assert.deepEqual(selectionTarget(), { kind: 'error', message: COPY.figmaText006 });
});
