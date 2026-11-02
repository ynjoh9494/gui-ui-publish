import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deliveryMessage } from '../src/controller.ts';
import { COPY } from '../src/core/copy.ts';
import type { FlipbookView } from '../src/core/flipbook.ts';
import { EXISTING_KEY } from '../src/core/registerFlipbooks.ts';
import { deliveryKit, FLIPBOOK_KEY, flipbookSession, syncFlipbook, TEMPLATE_KEY } from '../src/figma/flipbook.ts';
import type { Parts, TagKit } from '../src/figma/template.ts';

// 플립북 반영(2026-11-02 사용자 결정): 꼭 있어야 하는 칸은 GUI 복사본을 넣을 GUI 영역뿐이다.
// 제목·Status·이력 칸이 없으면 그 칸만 건너뛰고 나머지를 반영한다.
const NS = 'guiuipublish';

class Node {
  [key: string]: any;
  id: string;
  type: string;
  name: string;
  children: Node[] = [];
  parent: Node | null = null;
  locked = true;
  width = 1920;
  height = 1080;
  x = 0;
  y = 0;
  layoutMode = 'NONE';
  data = new Map<string, string>();
  constructor(type: string, name: string, id: string) { this.type = type; this.name = name; this.id = id; }
  async getMainComponentAsync(): Promise<{ id: string } | null> { return null; }
  appendChild(n: Node) { n.parent = this; this.children.push(n); }
  setSharedPluginData(ns: string, key: string, value: string) { this.data.set(`${ns}:${key}`, value); }
  getSharedPluginData(ns: string, key: string) { return this.data.get(`${ns}:${key}`) ?? ''; }
  findChild(fn: (n: Node) => boolean) { return this.children.find(fn) ?? null; }
  findAll(fn: (n: Node) => boolean): Node[] { return this.children.flatMap(n => [...(fn(n) ? [n] : []), ...n.findAll(fn)]); }
  findOne(fn: (n: Node) => boolean) { return this.findAll(fn)[0] ?? null; }
}

function setup(parts: { gui?: boolean; registered?: boolean }) {
  let seq = 0;
  const make = (type: string, name: string, parent?: Node) => {
    const node = new Node(type, name, `${++seq}:1`);
    parent?.appendChild(node);
    return node;
  };
  const page = make('PAGE', 'UI');
  const frame = make('FRAME', 'Home', page);
  frame.setSharedPluginData(NS, FLIPBOOK_KEY, 'fb');
  if (parts.registered) frame.setSharedPluginData(NS, EXISTING_KEY, 'true');
  // 큰 제목 텍스트·Status가 없는 UI Title, 이력 영역(Update History List)은 없다.
  make('INSTANCE', 'UI Title', frame);
  const gui = parts.gui ? make('FRAME', 'GUI Image Slot', frame) : null;
  const session = flipbookSession();
  session.pages.set('ui', page as unknown as PageNode);
  session.frames.set('ui', new Map([['fb', frame as unknown as FrameNode]]));
  session.kits.set('tpl', { fonts: new Map() } as unknown as TagKit);
  const view = {
    flipbookId: 'fb', kind: 'single', name: 'Home', titleNames: ['Home'], category: { key: 'c', name: 'Home', order: 0 }, chapter: 'Home',
    pageId: 'ui', gui: [], scale: 1, guiWidth: 1440, status: { tag: { name: '현행' }, colorKey: 'Black' }, rows: [],
  } as unknown as FlipbookView;
  const run = () => syncFlipbook(NS, { pageId: 'ui', templateId: 'tpl' }, view, session);
  return { frame, gui, run };
}

test('이전 템플릿 플립북에 제목·Status·이력 칸이 없어도 GUI 영역이 있으면 반영한다', async () => {
  const { frame, gui, run } = setup({ gui: true });
  const result = await run();
  assert.equal(result.nodeId, frame.id);
  assert.deepEqual(result.notes, []);
  assert.equal(frame.locked, false);
  assert.equal(gui!.locked, false);
  assert.notEqual(gui!.getSharedPluginData(NS, 'flipbookImage'), '', 'GUI 영역은 맞춘다');
});

test('이전 템플릿 플립북에 GUI 영역이 없으면 그 칸만 짚어 알린다', async () => {
  const { run } = setup({});
  await assert.rejects(run(), new Error(COPY.figmaFlipbook021));
});

test('등록한 기존 프레임은 GUI 영역이 없어도 있는 칸만 반영하고 따로 알리지 않는다', async () => {
  const { frame, run } = setup({ registered: true });
  const result = await run();
  assert.deepEqual(result, { nodeId: frame.id, notes: [], tracked: true, copies: [] });
});

test('같은 이유로 실패한 플립북은 이유를 한 번만 쓰고 이름은 앞의 세 개와 나머지 개수로 줄인다', () => {
  const reason = COPY.figmaFlipbook021;
  const failed = ['A', 'B', 'C', 'D', 'E'].map(name => ({ name, text: reason }));
  const message = deliveryMessage({ screens: 6, done: 0, failed: [...failed, { name: 'F', text: 'other' }], notes: [{ name: 'A', text: 'note' }, { name: 'B', text: 'note' }], skipped: null });
  assert.equal(message.split(reason).length - 1, 1);
  assert.match(message, new RegExp(`\\(A, B, C ${COPY.deliveryMore} 2${COPY.uiApp015}\\)`));
  assert.match(message, /other \(F\)/);
  assert.match(message, /note \(A, B\)$/);
});

// 템플릿 폴백(2026-11-02 사용자 결정): 이미 있는 플립북은 만든 템플릿(현재·이전 템플릿 중 구조가 맞는 첫 템플릿)으로 반영한다.
const kitOf = (id: string, links?: Record<string, string>, row?: string) =>
  ({ template: { id }, links: links ? { components: links } : null, row: row ? { id: row } : null, fonts: new Map() }) as unknown as TagKit;

function namedFlipbook(rowComponent: string | null) {
  const frame = new Node('FRAME', 'Home', 'f:1');
  const history = new Node('INSTANCE', 'Update History List', 'h:1');
  if (rowComponent) {
    const row = new Node('INSTANCE', 'Update History', 'r:1');
    row.componentProperties = {};
    row.getMainComponentAsync = async () => ({ id: rowComponent });
    history.appendChild(row);
  }
  frame.appendChild(history);
  return { frame, p: { links: null, named: { history } } as unknown as Parts };
}

function markedFlipbook(components: Record<string, string>) {
  return { frame: new Node('FRAME', 'Home', 'f:2'), p: { links: { components }, named: null } as unknown as Parts };
}

function fallbackSession(kits: Record<string, TagKit | null>, rows: Record<string, string> = {}) {
  const session = flipbookSession();
  for (const [id, kit] of Object.entries(kits)) session.fallbackKits.set(id, Promise.resolve(kit));
  for (const [id, row] of Object.entries(rows)) session.templateRows.set(id, Promise.resolve({ id: row } as unknown as ComponentNode));
  return session;
}

const pick = (f: { frame: Node; p: Parts }, current: TagKit, fallbacks: string[], session: ReturnType<typeof flipbookSession>) =>
  deliveryKit(NS, f.frame as unknown as FrameNode, f.p, current, fallbacks, session);

test('이전 템플릿이 없으면 구조를 보지 않고 현재 템플릿으로 반영한다', async () => {
  const current = kitOf('new', { row: 'row-new' }, 'row-new');
  assert.equal(await pick(namedFlipbook('row-old'), current, [], fallbackSession({})), current);
});

test('이름 규칙 플립북은 이력 행 컴포넌트가 같은 이전 템플릿으로 반영한다', async () => {
  const current = kitOf('new', { row: 'row-new' }, 'row-new');
  const old = kitOf('old');
  const session = fallbackSession({ old }, { old: 'row-old' });
  assert.equal(await pick(namedFlipbook('row-old'), current, ['old'], session), old);
});

test('이름 규칙 템플릿을 연결로 바꾼 현재 템플릿은 이력 행이 같으면 그대로 쓴다', async () => {
  const current = kitOf('new', { row: 'row-old' }, 'row-old');
  const session = fallbackSession({ old: kitOf('old') }, { old: 'row-old' });
  assert.equal(await pick(namedFlipbook('row-old'), current, ['old'], session), current);
});

test('표식 플립북은 이어받은 연결 컴포넌트가 겹치는 이전 템플릿으로 반영한다', async () => {
  const current = kitOf('new', { row: 'c-new', statusTag: 'tag-new' }, 'c-new');
  const older = kitOf('older', { row: 'c-older' }, 'c-older');
  const old = kitOf('old', { row: 'c-old', statusTag: 'tag-old' }, 'c-old');
  const session = fallbackSession({ old, older });
  assert.equal(await pick(markedFlipbook({ row: 'c-old', statusTag: 'tag-old' }), current, ['older', 'old'], session), old);
});

test('만든 템플릿을 적어 둔 플립북은 구조와 관계없이 그 템플릿으로 반영한다', async () => {
  const current = kitOf('new', { row: 'row-new' }, 'row-new');
  const old = kitOf('old');
  const recorded = kitOf('recorded', { row: 'x' }, 'x');
  const f = namedFlipbook('row-old');
  f.frame.setSharedPluginData(NS, TEMPLATE_KEY, 'recorded');
  assert.equal(await pick(f, current, ['old', 'recorded'], fallbackSession({ old, recorded }, { old: 'row-old' })), recorded);
});

test('맞는 템플릿이 없거나 이전 템플릿을 읽지 못하면 현재 템플릿으로 있는 칸만 반영한다', async () => {
  const current = kitOf('new', { row: 'row-new' }, 'row-new');
  const session = fallbackSession({ gone: null, old: kitOf('old') }, { old: 'row-old' });
  assert.equal(await pick(namedFlipbook('row-other'), current, ['gone', 'old'], session), current);
});

test('이력 행이 없는 이름 규칙 플립북은 처음 맞는 이름 규칙 템플릿으로 반영한다', async () => {
  const current = kitOf('new', { row: 'row-new' }, 'row-new');
  const old = kitOf('old');
  assert.equal(await pick(namedFlipbook(null), current, ['old'], fallbackSession({ old })), old);
});
