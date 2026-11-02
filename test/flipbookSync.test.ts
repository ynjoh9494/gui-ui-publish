import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deliveryMessage } from '../src/controller.ts';
import { COPY } from '../src/core/copy.ts';
import type { FlipbookView } from '../src/core/flipbook.ts';
import { EXISTING_KEY } from '../src/core/registerFlipbooks.ts';
import { FLIPBOOK_KEY, flipbookSession, syncFlipbook } from '../src/figma/flipbook.ts';
import type { TagKit } from '../src/figma/template.ts';

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
  async getMainComponentAsync() { return null; }
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
