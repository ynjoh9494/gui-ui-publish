import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deliveryMessage } from '../src/controller.ts';
import { COPY } from '../src/core/copy.ts';
import type { FlipbookView } from '../src/core/flipbook.ts';
import { EXISTING_KEY } from '../src/core/registerFlipbooks.ts';
import { deliveryKit, FLIPBOOK_KEY, flipbookSession, syncFlipbook, TEMPLATE_KEY } from '../src/figma/flipbook.ts';
import { LINKS_KEY } from '../src/core/templateParts.ts';
import type { Parts, TagKit } from '../src/figma/template.ts';

// 플립북 반영(2026-11-02 사용자 결정): 칸은 표식으로만 찾고, 없는 칸은 건너뛴다. 이름 규칙(이전 형식) 플립북은
// 플립북 상세의 「새 형식으로 변환」을 거쳐야 반영한다. 연결 기록 없이 등록한 기존 프레임은 반영할 때 표식을 단다.
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
  session.kits.set('tpl', { template: { id: 'tpl' }, links: { components: {} }, defaults: { title: [], chapter: [] }, fonts: new Map() } as unknown as TagKit);
  const view = {
    flipbookId: 'fb', kind: 'single', name: 'Home', titleNames: ['Home'], category: { key: 'c', name: 'Home', order: 0 }, chapter: 'Home',
    pageId: 'ui', gui: [], scale: 1, guiWidth: 1440, status: { tag: { name: '현행' }, colorKey: 'Black' }, rows: [],
  } as unknown as FlipbookView;
  const run = () => syncFlipbook(NS, { pageId: 'ui', templateId: 'tpl' }, view, session);
  return { frame, gui, run };
}

test('이전 형식 플립북(연결 기록 없음)은 칸을 찾지 않고 반영하지 않으며 새 형식으로 변환하라고 알린다', async () => {
  const { frame, gui, run } = setup({ gui: true });
  await assert.rejects(run(), new Error(COPY.legacyNeedsConvert));
  assert.equal(gui!.getSharedPluginData(NS, 'flipbookImage'), '', 'GUI 영역을 다시 배치하지 않는다');
  assert.equal(frame.getSharedPluginData(NS, LINKS_KEY), '', '묻지 않고 바꾸지 않는다');
});

test('연결 기록 없이 등록한 기존 프레임은 반영할 때 이름으로 찾은 칸에 표식을 달고, 있는 칸만 반영하며 GUI는 넣지 않는다', async () => {
  const { frame, gui, run } = setup({ registered: true, gui: true });
  const result = await run();
  assert.deepEqual(result, { nodeId: frame.id, notes: [], tracked: true, copies: [] });
  assert.notEqual(frame.getSharedPluginData(NS, LINKS_KEY), '');
  assert.equal(gui!.getSharedPluginData(NS, 'templatePart'), 'gui');
  assert.equal(gui!.getSharedPluginData(NS, 'flipbookImage'), '', 'GUI는 넣지 않는다');
});

test('같은 이유로 실패한 플립북은 이유를 한 번만 쓰고 이름은 앞의 세 개와 나머지 개수로 줄인다', () => {
  const reason = COPY.legacyNeedsConvert;
  const failed = ['A', 'B', 'C', 'D', 'E'].map(name => ({ name, text: reason }));
  const message = deliveryMessage({ screens: 6, done: 0, failed: [...failed, { name: 'F', text: 'other' }], notes: [{ name: 'A', text: 'note' }, { name: 'B', text: 'note' }], skipped: null });
  assert.equal(message.split(reason).length - 1, 1);
  assert.match(message, new RegExp(`\\(A, B, C ${COPY.deliveryMore} 2${COPY.uiApp015}\\)`));
  assert.match(message, /other \(F\)/);
  assert.match(message, /note \(A, B\)$/);
});

// 템플릿 폴백(2026-11-02 사용자 결정): 이미 있는 플립북은 만든 템플릿(대표·나머지 템플릿 중 이력 행 컴포넌트가 같은 첫 템플릿)으로 반영한다.
// 이전 형식 플립북은 변환할 때 만든 템플릿의 연결 기록을 이어받으므로(figma/legacyConvert.ts) 여기서는 표식 플립북만 본다.
const kitOf = (id: string, links: Record<string, string> = {}, row?: string) =>
  ({ template: { id }, links: { components: links }, row: row ? { id: row } : null, fonts: new Map() }) as unknown as TagKit;

function markedFlipbook(components: Record<string, string>) {
  return { frame: new Node('FRAME', 'Home', 'f:2'), p: { links: { components } } as unknown as Parts };
}

function fallbackSession(kits: Record<string, TagKit | null>) {
  const session = flipbookSession();
  for (const [id, kit] of Object.entries(kits)) session.fallbackKits.set(id, Promise.resolve(kit));
  return session;
}

const pick = (f: { frame: Node; p: Parts }, current: TagKit, fallbacks: string[], session: ReturnType<typeof flipbookSession>) =>
  deliveryKit(NS, f.frame as unknown as FrameNode, f.p, current, fallbacks, session);

test('대표 말고 템플릿이 없으면 구조를 보지 않고 대표 템플릿으로 반영한다', async () => {
  const current = kitOf('new', { row: 'row-new' }, 'row-new');
  assert.equal(await pick(markedFlipbook({ row: 'row-old' }), current, [], fallbackSession({})), current);
});

test('대표 템플릿과 연결 컴포넌트가 겹치면 나머지 템플릿을 보지 않고 대표로 반영한다', async () => {
  const current = kitOf('new', { row: 'row-old' }, 'row-old');
  const old = kitOf('old', { row: 'row-old' }, 'row-old');
  assert.equal(await pick(markedFlipbook({ row: 'row-old' }), current, ['old'], fallbackSession({ old })), current);
});

test('표식 플립북은 이어받은 연결 컴포넌트가 겹치는 이전 템플릿으로 반영한다', async () => {
  const current = kitOf('new', { row: 'c-new', statusTag: 'tag-new' }, 'c-new');
  const older = kitOf('older', { row: 'c-older' }, 'c-older');
  const old = kitOf('old', { row: 'c-old', statusTag: 'tag-old' }, 'c-old');
  const session = fallbackSession({ old, older });
  assert.equal(await pick(markedFlipbook({ row: 'c-old', statusTag: 'tag-old' }), current, ['older', 'old'], session), old);
});

// 2026-11-03 사용자 결정: 태그 컴포넌트는 템플릿 프레임 밖에 두고 여러 템플릿이 함께 쓸 수 있으므로 이력 행 컴포넌트로 판별한다.
test('태그 컴포넌트를 함께 쓰는 템플릿끼리는 이력 행 컴포넌트가 같은 템플릿으로 반영한다', async () => {
  const shared = { statusTag: 'tag', rowStatusTag: 'small', idTag: 'id' };
  const current = kitOf('new', { ...shared, row: 'row-new' }, 'row-new');
  const old = kitOf('old', { ...shared, row: 'row-old' }, 'row-old');
  const session = fallbackSession({ old });
  assert.equal(await pick(markedFlipbook({ ...shared, row: 'row-old' }), current, ['old'], session), old);
  assert.equal(await pick(markedFlipbook({ ...shared, row: 'row-gone' }), current, ['old'], session), current, '이력 행이 같은 템플릿이 없으면 태그가 같아도 대표로 반영한다');
});

test('연결 기록에 이력 행이 없는 플립북은 다른 연결 컴포넌트가 같은 템플릿으로 반영한다', async () => {
  const current = kitOf('new', { row: 'row-new', statusTag: 'tag-new' }, 'row-new');
  const old = kitOf('old', { row: 'row-old', statusTag: 'tag-old' }, 'row-old');
  assert.equal(await pick(markedFlipbook({ statusTag: 'tag-old' }), current, ['old'], fallbackSession({ old })), old);
});

test('만든 템플릿을 적어 둔 플립북은 구조와 관계없이 그 템플릿으로 반영한다', async () => {
  const current = kitOf('new', { row: 'row-new' }, 'row-new');
  const old = kitOf('old');
  const recorded = kitOf('recorded', { row: 'x' }, 'x');
  const f = markedFlipbook({ row: 'row-old' });
  f.frame.setSharedPluginData(NS, TEMPLATE_KEY, 'recorded');
  assert.equal(await pick(f, current, ['old', 'recorded'], fallbackSession({ old, recorded })), recorded);
});

test('맞는 템플릿이 없거나 이전 템플릿을 읽지 못하면 현재 템플릿으로 있는 칸만 반영한다', async () => {
  const current = kitOf('new', { row: 'row-new' }, 'row-new');
  const session = fallbackSession({ gone: null, old: kitOf('old', { row: 'row-old' }, 'row-old') });
  assert.equal(await pick(markedFlipbook({ row: 'row-other' }), current, ['gone', 'old'], session), current);
});
