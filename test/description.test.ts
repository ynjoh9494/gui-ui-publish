import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COPY } from '../src/core/copy.ts';
import { parseRichText, serializeRichText } from '../src/core/richText.ts';
import { addTextFrame, fillDescription, readDescription, selectedDescriptionRoot, selectedFrame, selectionTarget } from '../src/figma/description.ts';

type Font = { family: string; style: string };
type Char = { font: Font; list: string; indent: number };
const REGULAR = { family: 'Inter', style: 'Regular' }, BOLD = { family: 'Inter', style: 'Bold' };
const MIXED = Symbol('mixed');
let seq = 0;
let loaded = new Set<string>();
let fontLoads = 0;
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
  paddingTop = 0;
  paddingBottom = 0;
  itemSpacing = 0;
  layoutMode = 'NONE';
  layoutSizingHorizontal = 'FIXED';
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
  clone(): Node {
    const copy = new Node(this.type, this.name, this.children.map(child => child.clone()));
    copy.itemSpacing = this.itemSpacing;
    copy.paddingTop = this.paddingTop;
    copy.paddingBottom = this.paddingBottom;
    copy.width = this.width;
    copy.height = this.height;
    copy.data = new Map(this.data);
    return copy;
  }
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
  lineHeight: unknown = { unit: 'AUTO' };
  letterSpacing: unknown = { unit: 'PERCENT', value: 0 };
  fills: unknown = [];
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
  set fontName(font: Font) { assert.ok(loaded.has(key(font))); this.base = font; this.chars.forEach(char => { char.font = font; }); }
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
    copy.letterSpacing = this.letterSpacing;
    copy.width = this.width;
    copy.height = this.height;
    copy.data = new Map(this.data);
    return copy;
  }
  range(start: number, end: number) { assert.ok(start < end && end <= this.text.length); return this.chars.slice(start, end); }
  setRangeFontName(start: number, end: number, font: Font) { assert.ok(loaded.has(key(font))); this.range(start, end).forEach(char => { char.font = font; }); }
  setRangeListOptions(start: number, end: number, option: { type: string }) { this.range(start, end).forEach(char => { char.list = option.type; }); }
  setRangeIndentation(start: number, end: number, value: number) { this.range(start, end).forEach(char => { char.indent = value; }); }
  getRangeFontName(start: number, end: number) { const fonts = this.range(start, end).map(char => char.font); return new Set(fonts.map(key)).size > 1 ? MIXED : fonts[0]; }
  getRangeFontSize() { return this.fontSize; }
  getRangeLineHeight() { return this.lineHeight; }
  getRangeLetterSpacing() { return this.letterSpacing; }
  getRangeFills() { return this.fills; }
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
  fontLoads = 0;
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
    async loadFontAsync(font: Font) { fontLoads++; loaded.add(key(font)); },
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

test('첫 묶음 아래와 마지막 묶음 위에 템플릿처럼 여백 15를 두고, 제목 문구는 보지 않는다', async () => {
  const paddings = async (doc: string) => {
    const { root, area } = fixture();
    setup([root]);
    await fillDescription(root as unknown as SceneNode, parseRichText(doc));
    return area.children.map(group => [group.paddingTop, group.paddingBottom]);
  };
  assert.deepEqual(await paddings('**Policy**\n\n- 설명\n\n**1. 항목**\n\n- 내용\n\n**Navigation**\n\n- 이동'), [[0, 15], [0, 0], [15, 0]]);
  assert.deepEqual(await paddings('**1. 항목**\n\n- 내용\n\n**2. 항목**\n\n- 내용'), [[0, 15], [15, 0]]);
  assert.deepEqual(await paddings('**Policy**\n\n- 설명'), [[0, 0]]);
});

test('묶음이 많아도 글꼴은 묶음 수만큼 다시 불러오지 않는다', async () => {
  const counts: number[] = [];
  for (const doc of ['**하나**\n\n- 내용', Array.from({ length: 8 }, (_, i) => `**항목 ${i}**\n\n- 내용 ${i}`).join('\n\n')]) {
    const { root, area } = fixture();
    setup([root]);
    await fillDescription(root as unknown as SceneNode, parseRichText(doc));
    counts.push(fontLoads);
    assert.ok(area.children.every(group => group.getPluginData('guiUiPublishDescriptionGroup') === '1'));
    assert.equal(serializeRichText(readDescription(root as unknown as SceneNode)), serializeRichText(parseRichText(doc)));
  }
  assert.equal(counts[0], counts[1]);
});

test('텍스트 편집 대상: 플립북 안의 요소는 그 플립북, 플립북 밖 텍스트 하나는 그 레이어, 서로 다른 플립북은 오류', () => {
  const { root } = fixture();
  const header = new Node('TEXT', 'Page title');
  const flipbook = new Node('FRAME', '홈 메인', [header, root]);
  flipbook.setSharedPluginData('guiuipublish', 'flipbookOf', 'f1');
  setup([header]);
  assert.deepEqual(selectionTarget(), { kind: 'description', flipbookId: 'f1', name: '홈 메인' });
  const loose = new Text('메모', '아무 글');
  setup([loose]);
  assert.deepEqual(selectionTarget(), { kind: 'text', name: '메모' });
  setup([]);
  assert.deepEqual(selectionTarget(), { kind: 'none' });
  const other = new Node('FRAME', '검색', [fixture().root]);
  other.setSharedPluginData('guiuipublish', 'flipbookOf', 'f2');
  setup([header, other]);
  assert.deepEqual(selectionTarget(), { kind: 'error', message: COPY.figmaText007 });
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

test('플립북 밖 화면의 Description 그룹(본문 슬롯 없음) 안 텍스트는 그 텍스트 레이어가 대상이다', () => {
  const text = new Text('줄거리', '내용');
  const group = new Node('GROUP', 'Description', [text]);
  const screen = new Node('FRAME', 'VOD 상세', [group]);
  setup([text]);
  assert.equal(selectedDescriptionRoot(), null);
  assert.deepEqual(selectionTarget(), { kind: 'text', name: '줄거리' });
  setup([screen]);
  assert.deepEqual(selectionTarget(), { kind: 'frame', name: 'VOD 상세' });
  // 플립북 표식 안의 Description은 슬롯이 없어도 대상이다(적용할 때 본문 영역이 없다고 알린다).
  screen.setSharedPluginData('guiuipublish', 'flipbookOf', 'f1');
  setup([text]);
  assert.equal(selectedDescriptionRoot()?.id, group.id);
});

test('새 제목·본문 레이어는 슬롯에 있던 텍스트의 서식을 이어받고, 다시 적용해도 유지한다', async () => {
  const regular = { family: 'Pretendard', style: 'Regular' }, bold = { family: 'Pretendard', style: 'Bold' };
  const title = new Text('제목', 'Policy', bold);
  const sample = new Text('예시', '예시 문구', regular);
  const blue = [{ type: 'SOLID', color: { r: 0, g: 0, b: 1 } }];
  for (const node of [title, sample]) { node.fontSize = 14; node.lineHeight = { unit: 'PIXELS', value: 20 }; node.fills = blue; }
  const hidden = new Text('숨김', '숨긴 예시', REGULAR);
  hidden.visible = false;
  const area = new Node('SLOT', 'description area', [hidden, new Node('FRAME', '예시 묶음', [title, sample])]);
  const root = new Node('FRAME', 'Description', [area]);
  setup([root]);
  await fillDescription(root as unknown as SceneNode, parseRichText('**Policy**\n\n- 설명'));
  const check = () => {
    const groups = area.children.filter(node => !node.removed);
    for (const group of groups) for (const node of group.children as Text[]) {
      assert.equal(node.chars[0].font.family, 'Pretendard');
      assert.equal(node.fontSize, 14);
      assert.deepEqual(node.lineHeight, { unit: 'PIXELS', value: 20 });
      assert.deepEqual(node.fills, blue);
    }
    return groups;
  };
  const [group] = check();
  assert.equal((group.children[0] as Text).chars[0].font.style, 'Bold');
  assert.equal((group.children[1] as Text).chars[0].font.style, 'Regular');
  assert.equal(group.itemSpacing, 3);
  group.itemSpacing = 6;
  setup([root]);
  await fillDescription(root as unknown as SceneNode, parseRichText('**Navigation**\n\n- 이동'));
  assert.equal(check()[0].itemSpacing, 6, 'spacing follows the previous groups');

  const empty = new Node('SLOT', 'description area');
  const bare = new Node('FRAME', 'Description', [empty]);
  setup([bare]);
  await fillDescription(bare as unknown as SceneNode, parseRichText('본문만'));
  assert.equal((empty.children[0].children[0] as Text).fontSize, 16, 'defaults only when the slot has no text');
});

test('플립북 밖 프레임 하나는 프레임 대상이고, 인스턴스 안의 프레임은 오류, 여러 개나 플립북 안이면 프레임 대상이 아니다', () => {
  const memo = new Node('FRAME', '메모');
  setup([memo]);
  assert.equal(selectedFrame()?.id, memo.id);
  assert.deepEqual(selectionTarget(), { kind: 'frame', name: '메모' });
  setup([memo, new Node('FRAME', '다른 메모')]);
  assert.deepEqual(selectionTarget(), { kind: 'none' });
  const inner = new Node('FRAME', '안쪽');
  new Node('INSTANCE', '카드', [new Node('FRAME', '내용', [inner])]);
  setup([inner]);
  assert.deepEqual(selectionTarget(), { kind: 'error', message: COPY.figmaText009 });
  const { root } = fixture();
  const box = new Node('FRAME', '상자');
  const flipbook = new Node('FRAME', '홈 메인', [box, root]);
  flipbook.setSharedPluginData('guiuipublish', 'flipbookOf', 'f1');
  setup([box]);
  assert.deepEqual(selectionTarget(), { kind: 'description', flipbookId: 'f1', name: '홈 메인' });
});

test('프레임에는 묶음들을 오토 레이아웃 프레임으로 감싸 프레임 폭으로 맨 아래에 넣고, 적용할 때마다 새로 추가한다', async () => {
  const note = new Node('FRAME', '노트', [Object.assign(new Node('RECTANGLE', '배경'), { y: 20, height: 100 })]);
  const hidden = Object.assign(new Node('RECTANGLE', '숨김'), { y: 500, height: 100, visible: false });
  note.appendChild(hidden);
  setup([note]);
  const doc = parseRichText('**Policy**\n\n- 설명\n\t- 하위\n\n**1. 항목**\n\n- 내용\n\n**Navigation**\n\n- 이동');
  assert.deepEqual(await addTextFrame(note as unknown as FrameNode, doc), { kind: 'frame' });
  const wrapper = note.children[2] as Node & Record<string, unknown>;
  assert.equal(wrapper.getPluginData('guiUiPublishTextFrame'), '1');
  assert.equal(wrapper.name, COPY.figmaText011);
  assert.deepEqual(
    [wrapper.layoutMode, wrapper.primaryAxisSizingMode, wrapper.counterAxisSizingMode, wrapper.primaryAxisAlignItems, wrapper.counterAxisAlignItems],
    ['VERTICAL', 'AUTO', 'FIXED', 'MIN', 'MIN']);
  assert.deepEqual([wrapper.itemSpacing, wrapper.paddingLeft, wrapper.paddingTop, wrapper.paddingRight, wrapper.paddingBottom], [12, 12, 8, 12, 16]);
  assert.deepEqual(wrapper.fills, []);
  assert.deepEqual([wrapper.x, wrapper.y, wrapper.width], [0, 120, 440], 'below the visible content, at the frame width');
  assert.deepEqual(wrapper.children.map(group => group.name), ['Policy', '1. 항목', 'Navigation']);
  assert.deepEqual(wrapper.children.map(group => [group.paddingTop, group.paddingBottom]), [[0, 15], [0, 0], [15, 0]]);
  assert.ok(wrapper.children.every(group => group.getPluginData('guiUiPublishDescriptionGroup') === '1' && group.layoutSizingHorizontal === 'FILL'));
  const [title, body] = wrapper.children[0].children as Text[];
  assert.equal(title.chars[0].font.style, 'Bold');
  assert.equal(body.chars[0].list, 'UNORDERED');
  assert.equal(body.fontSize, 16, 'Description defaults when the frame has no earlier text frame');
  assert.equal(wrapper.children[0].itemSpacing, 3);

  body.fontSize = 14;
  wrapper.children[0].itemSpacing = 6;
  await addTextFrame(note as unknown as FrameNode, parseRichText('**추가**\n\n- 더'));
  assert.equal(note.children.length, 4, 'each apply adds another text frame');
  assert.equal(wrapper.removed, false);
  const next = note.children[3];
  assert.equal(next.y, wrapper.y + wrapper.height);
  assert.equal((next.children[0].children[1] as Text).fontSize, 14, 'style follows the last text frame');
  assert.equal(next.children[0].itemSpacing, 6);
});

test('오토 레이아웃 프레임에는 마지막 자식으로 넣고 폭을 채우며, 폭이 Hug면 안쪽 폭으로 고정한다', async () => {
  const fixed = Object.assign(new Node('FRAME', '세로'), { layoutMode: 'VERTICAL' });
  setup([fixed]);
  await addTextFrame(fixed as unknown as FrameNode, parseRichText('본문만'));
  assert.equal(fixed.children[0].layoutSizingHorizontal, 'FILL');
  const hug = Object.assign(new Node('FRAME', 'Hug'), { layoutMode: 'VERTICAL', layoutSizingHorizontal: 'HUG' });
  setup([hug]);
  await addTextFrame(hug as unknown as FrameNode, parseRichText('본문만'));
  assert.deepEqual([hug.children[0].layoutSizingHorizontal, hug.children[0].width], ['FIXED', 416]);
  assert.equal(hug.layoutSizingHorizontal, 'HUG');
});
