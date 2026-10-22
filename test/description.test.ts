import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COPY } from '../src/core/copy.ts';
import { parseRichText, serializeRichText } from '../src/core/richText.ts';
import { fillDescription, readDescription, selectedDescriptionRoot } from '../src/figma/description.ts';

type Font = { family: string; style: string };
type Char = { font: Font; list: string; indent: number };
const REGULAR = { family: 'Inter', style: 'Regular' }, BOLD = { family: 'Inter', style: 'Bold' };
const MIXED = Symbol('mixed');
let seq = 0;
let loaded = new Set<string>();
const key = (font: Font) => `${font.family}/${font.style}`;

class Node {
  id = `n:${++seq}`;
  visible = true;
  removed = false;
  x = 0;
  y = 0;
  width = 440;
  height = 1200;
  paddingLeft = 12;
  paddingRight = 12;
  parent: Node | null = null;
  children: Node[] = [];
  data = new Map<string, string>();
  shared = new Map<string, string>();
  type: string;
  name: string;
  constructor(type: string, name: string, children: Node[] = []) {
    this.type = type;
    this.name = name;
    children.forEach(child => this.appendChild(child));
  }
  appendChild(node: Node) { node.parent?.removeChild(node); node.parent = this; this.children.push(node); }
  removeChild(node: Node) { this.children.splice(this.children.indexOf(node), 1); node.parent = null; }
  remove() { this.parent?.removeChild(this); this.removed = true; }
  resize(width: number, height: number) { this.width = width; this.height = height; }
  getPluginData(name: string) { return this.data.get(name) ?? ''; }
  setPluginData(name: string, value: string) { this.data.set(name, value); }
  getSharedPluginData(namespace: string, name: string) { return this.shared.get(`${namespace}/${name}`) ?? ''; }
  setSharedPluginData(namespace: string, name: string, value: string) { this.shared.set(`${namespace}/${name}`, value); }
  get absoluteBoundingBox() { return { x: this.x, y: this.y, width: this.width, height: this.height }; }
  findOne(match: (node: Node) => boolean): Node | null {
    for (const child of this.children) { if (match(child)) return child; const nested = child.findOne(match); if (nested) return nested; }
    return null;
  }
  findAllWithCriteria({ types }: { types: string[] }): Node[] {
    const found: Node[] = [];
    const visit = (node: Node) => { for (const child of node.children) { if (types.includes(child.type)) found.push(child); visit(child); } };
    visit(this);
    return found;
  }
}

class Text extends Node {
  hasMissingFont = false;
  fontSize = 12;
  lineHeight: unknown;
  fills: unknown;
  textAutoResize = 'NONE';
  chars: Char[];
  text: string;
  base: Font;
  constructor(name: string, text = '', base: Font = REGULAR) {
    super('TEXT', name);
    this.text = text;
    this.base = base;
    this.chars = [...text].map(() => ({ font: base, list: 'NONE', indent: 0 }));
  }
  get fontName() { return this.chars[0]?.font ?? this.base; }
  get characters() { return this.text; }
  set characters(value: string) {
    for (const char of this.chars) assert.ok(loaded.has(key(char.font)));
    const first = this.chars[0] ?? { font: this.base, list: 'NONE', indent: 0 };
    this.text = value;
    this.chars = [...value].map(() => ({ ...first }));
  }
  resize(width: number, height: number) { this.width = width; this.height = height; }
  clone(): Text {
    const copy = new Text(this.name, this.text, this.base);
    copy.chars = this.chars.map(char => ({ ...char }));
    copy.fontSize = this.fontSize;
    copy.lineHeight = this.lineHeight;
    copy.fills = this.fills;
    copy.width = this.width;
    copy.height = this.height;
    copy.data = new Map(this.data);
    return copy;
  }
  range(start: number, end: number) { assert.ok(start < end && end <= this.text.length); return this.chars.slice(start, end); }
  setRangeFontName(start: number, end: number, font: Font) { assert.ok(loaded.has(key(font))); this.range(start, end).forEach(char => { char.font = font; }); }
  setRangeListOptions(start: number, end: number, option: { type: string }) { this.range(start, end).forEach(char => { char.list = option.type; }); }
  setRangeIndentation(start: number, end: number, value: number) { this.range(start, end).forEach(char => { char.indent = value; }); }
  getRangeListOptions(start: number, end: number) { const values = new Set(this.range(start, end).map(char => char.list)); return values.size > 1 ? MIXED : { type: [...values][0] }; }
  getRangeIndentation(start: number, end: number) { const values = new Set(this.range(start, end).map(char => char.indent)); return values.size > 1 ? MIXED : [...values][0]; }
  getStyledTextSegments() {
    const found: { start: number; end: number; fontName: Font }[] = [];
    this.chars.forEach((char, index) => {
      const prior = found[found.length - 1];
      if (prior && key(prior.fontName) === key(char.font)) prior.end = index + 1;
      else found.push({ start: index, end: index + 1, fontName: char.font });
    });
    return found;
  }
}

function setup(selection: Node[]) {
  loaded = new Set();
  (globalThis as any).figma = {
    mixed: MIXED,
    currentPage: { selection },
    createText: () => {
      const node = new Text('Text');
      let size = node.fontSize;
      Object.defineProperty(node, 'fontSize', {
        get: () => size,
        set: (value: number) => {
          if (!loaded.has(key(node.fontName))) throw new Error('Font must be loaded before setting fontSize');
          size = value;
        },
      });
      return node;
    },
    createFrame: () => new Node('FRAME', 'Frame'),
    async loadFontAsync(font: Font) { loaded.add(key(font)); },
  };
}

function fixture() {
  const example = new Node('FRAME', 'Anything', [new Text('A', 'Example', BOLD), new Text('B', '더미 텍스트')]);
  const custom = new Node('FRAME', 'Custom layout', [new Text('C', '제목 아님'), new Text('D', '본문')]);
  const area = new Node('SLOT', 'description area', [example, custom]);
  const header = new Node('FRAME', 'Title', [new Text('Header', 'Description')]);
  const root = new Node('FRAME', 'Description', [new Node('INSTANCE', 'Description/Head', [header, area])]);
  return { root, area, header, example, custom };
}

test('Description 선택은 해당 프레임 안으로 제한한다', () => {
  const { root, area } = fixture();
  const page = new Node('FRAME', 'Flipbook', [root, fixture().root]);
  setup([area.children[0]]);
  assert.equal(selectedDescriptionRoot()?.id, root.id);
  setup([page]);
  assert.equal(selectedDescriptionRoot(), null);
  setup([root, page]);
  assert.equal(selectedDescriptionRoot(), null);
});

test('플립북 안의 임의 레이어와 같은 플립북의 다중 선택에서 Description을 찾는다', () => {
  const { root, area } = fixture();
  const gui = new Node('FRAME', 'GUI Image Slot', [fixture().root]);
  const header = new Node('TEXT', 'Page title');
  const flipbook = new Node('FRAME', 'Flipbook', [header, gui, root]);
  flipbook.setSharedPluginData('guiuipublish', 'flipbookOf', 'f1');
  setup([flipbook]);
  assert.equal(selectedDescriptionRoot()?.id, root.id);
  setup([header]);
  assert.equal(selectedDescriptionRoot()?.id, root.id);
  setup([header, area]);
  assert.equal(selectedDescriptionRoot()?.id, root.id);
  flipbook.setSharedPluginData('guiuipublish', 'flipbookOf', '');
  setup([header]);
  assert.equal(selectedDescriptionRoot()?.id, root.id);
  flipbook.setSharedPluginData('guiuipublish', 'flipbookOf', 'f1');
  const other = new Node('FRAME', 'Flipbook', [fixture().root]);
  other.setSharedPluginData('guiuipublish', 'flipbookOf', 'f2');
  setup([header, other]);
  assert.throws(selectedDescriptionRoot, { message: COPY.figmaText007 });
});

test('굵은 제목 줄마다 제목·본문 레이어를 묶고 문구는 검사하지 않는다', async () => {
  const { root, area, header, example, custom } = fixture();
  setup([root.children[0]]);
  const first = parseRichText('**Policy**\n\n- 설명\n\t- 하위\n\n**원하는 이름**\n\n- 내용\n\n**Navigation**\n\n- 이동');
  assert.deepEqual(await fillDescription(root as unknown as SceneNode, first), { kind: 'description' });
  assert.equal(header.children[0].visible, true);
  assert.equal(example.removed, true);
  assert.equal(custom.removed, true);
  const groups = area.children.filter(node => node.visible);
  assert.equal(groups.length, 3);
  assert.deepEqual(groups.map(group => group.name), ['Policy', '원하는 이름', 'Navigation']);
  assert.ok(groups.every(group => group.type === 'FRAME' && group.children.length === 2));
  const written = groups[0].children[0] as Text;
  const body = groups[0].children[1] as Text;
  assert.equal(serializeRichText(readDescription(root as unknown as SceneNode)), serializeRichText(first));
  assert.equal(written.chars[0].font.style, 'Bold');
  assert.equal(body.chars[0].list, 'UNORDERED');

  const second = parseRichText('제목 없는 본문\n- 목록');
  assert.deepEqual(await fillDescription(root as unknown as SceneNode, second), { kind: 'description' });
  assert.equal(groups[0].removed, true);
  assert.equal(area.children.filter(node => node.visible).length, 1);
  assert.equal(serializeRichText(readDescription(root as unknown as SceneNode)), serializeRichText(second));
});

test('기존 내용 불러오기는 임의 텍스트를 읽고, 본문 슬롯이 없으면 수정하지 않는다', async () => {
  const { root, area, header } = fixture();
  setup([root]);
  assert.equal(readDescription(root as unknown as SceneNode).map(p => p.text).filter(Boolean).join('|'), 'Example|더미 텍스트|제목 아님|본문');
  area.name = 'other';
  await assert.rejects(fillDescription(root as unknown as SceneNode, parseRichText('새 내용')));
  assert.equal(header.children[0].visible, true);
  assert.equal(area.children[0].visible, true);
});
