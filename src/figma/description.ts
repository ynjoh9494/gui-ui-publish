import { COPY } from '../core/copy.ts';
import { cloneLayout, DEFAULT_TEXT_LAYOUT, isSpacer, SPACER_TEXT, type SelectionTarget, type SelectionWrite, type TextLayout } from '../core/description.ts';
import type { RichParagraph } from '../core/richText.ts';
import { PART_KEY } from '../core/templateParts.ts';
import { FLIPBOOK_KEY } from './flipbook.ts';
import { applyRichText, BOLD_STYLE, readRichText, readTextLayout, textFonts, type TextFonts } from './richText.ts';
import { DESCRIPTION_AREA, GUI_AREA, NS, linksOf, markedPart } from './template.ts';

// 굵은 제목 줄마다 만든 제목·본문 묶음 표식. 레이어 하나로 넣었던 본문(OLD_BODY_MARKER)도 불러오기에서 읽는다.
const GROUP_MARKER = 'guiUiPublishDescriptionGroup';
const OLD_BODY_MARKER = 'guiUiPublishDescriptionBody';
// 이전 버전의 여백 프레임 표식. 새 내용은 다음 묶음의 Top Padding과 표식으로만 저장한다.
const SPACER_MARKER = 'guiUiPublishDescriptionSpacer';
const SPACER_HEIGHT = 'guiUiPublishDescriptionSpacerHeight';
const SPACER_COUNT = 'guiUiPublishDescriptionSpacerCount';
const TRAILING_SPACER_COUNT = 'guiUiPublishDescriptionTrailingSpacerCount';
const ITEM_TOP_PADDING = 15;
// 플립북 밖에서 고른 프레임에 넣는, 묶음들을 감싼 오토 레이아웃 프레임(세로, 왼쪽 위 정렬)의 표식과 간격·여백
const TEXT_FRAME_MARKER = 'guiUiPublishTextFrame';
// 서식 값을 받지 않았을 때(이전 호출)만 쓰는 값이다. 편집기는 서식 도구 값을 넘긴다.
const TEXT_FRAME = { itemSpacing: 0, paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 16 };

const isDescription = (node: BaseNode): boolean =>
  node.name === 'Description' && (node.type === 'FRAME' || node.type === 'INSTANCE' || node.type === 'GROUP');
const isFlipbook = (node: BaseNode): boolean => 'getSharedPluginData' in node && !!node.getSharedPluginData(NS, FLIPBOOK_KEY);
function flipbookFrameOf(node: BaseNode): SceneNode | null {
  for (let n: BaseNode | null = node; n && n.type !== 'PAGE' && n.type !== 'DOCUMENT'; n = n.parent) if (isFlipbook(n)) return n as SceneNode;
  return null;
}
const findBodyArea = (root: BaseNode): BaseNode | null =>
  'findOne' in root ? root.findOne(node => node.type === 'SLOT' && node.name === DESCRIPTION_AREA) : null;
// 플립북 표식 안에 있거나 본문 슬롯이 있는 Description만 대상이다. 표식 없는 플립북(템플릿에서 손으로 만든 것)도 슬롯으로 알아보고,
// 플립북 밖 화면에 같은 이름의 그룹이 있어도 그 안의 텍스트 레이어는 텍스트 레이어로 다룬다.
const isTarget = (node: BaseNode): boolean => !!flipbookFrameOf(node) || !!findBodyArea(node);

// skip: 바로 아래 단계에서 이미 찾아본 하위 트리. 위로 올라가며 같은 하위 트리를 다시 훑지 않는다.
function descriptionsIn(node: BaseNode, skip: BaseNode | null, out: SceneNode[] = []): SceneNode[] {
  if (!('children' in node)) return out;
  for (const child of node.children) {
    if (child === skip || child.name === GUI_AREA) continue;
    if (isDescription(child)) { if (isTarget(child)) out.push(child as SceneNode); } else descriptionsIn(child, null, out);
  }
  return out;
}

// label: 대상 표시에 쓸 이름(표식 템플릿이면 플립북·템플릿 프레임 이름)
type Found = { root: SceneNode; flipbook: SceneNode | null; label?: string };

// 고른 요소를 품은 표식 템플릿이나 그 템플릿에서 만든 플립북(연결 기록이 있는 프레임)
function linkedRootOf(node: BaseNode): SceneNode | null {
  for (let n: BaseNode | null = node; n && n.type !== 'PAGE' && n.type !== 'DOCUMENT'; n = n.parent) if (linksOf(n, NS)) return n as SceneNode;
  return null;
}

// 고른 요소가 속한 플립북의 Description(2026-10-22 사용자 요청: 플립북 안의 무엇을 골라도 그 플립북의 Description에 넣는다).
// 표식 템플릿과 그 템플릿에서 만든 플립북은 「Description 본문」에 연결한 칸이 대상이다(2026-10-28 사용자 결정).
// 그 밖에는 Description 안이면 그 Description, 아니면 위로 올라가며 Description이 하나뿐인 가장 가까운 묶음(플립북)에서 찾는다. Section·페이지까지는 올라가지 않는다.
// Description이 여럿인 묶음에 닿으면 정할 수 없다. 플립북 표식이 있는 프레임에 Description이 없으면 오류다.
function descriptionOf(node: SceneNode): Found | null {
  const linked = linkedRootOf(node);
  if (linked && 'children' in linked) {
    const area = markedPart(linked, 'description', NS);
    if (area) return { root: area, flipbook: isFlipbook(linked) ? linked : null, label: linked.name };
    if (isFlipbook(linked)) throw new Error(COPY.figmaText006);
  }
  const chain: BaseNode[] = [];
  for (let n: BaseNode | null = node; n && n.type !== 'PAGE' && n.type !== 'DOCUMENT' && n.type !== 'SECTION'; n = n.parent) chain.push(n);
  // GUI 영역 안은 원본 화면의 복사본이다. 그 안에 Description이라는 이름의 레이어가 있어도 플립북의 Description이 아니므로
  // 가장 바깥 GUI 영역까지 건너뛴다(GUI 영역의 하위 트리는 descriptionsIn도 보지 않는다).
  let start = 0;
  chain.forEach((n, i) => { if (n.name === GUI_AREA) start = i + 1; });
  for (let i = start; i < chain.length; i++) {
    const n = chain[i];
    if (isDescription(n)) {
      if (isTarget(n)) return { root: n as SceneNode, flipbook: flipbookFrameOf(n) };
      continue;
    }
    const found = descriptionsIn(n, chain[i - 1] ?? null);
    if (found.length === 1) return { root: found[0], flipbook: flipbookFrameOf(found[0]) };
    if (found.length > 1) return null;
    if (isFlipbook(n)) throw new Error(COPY.figmaText006);
  }
  return null;
}

// 고른 요소들(여러 개 가능)이 모두 한 플립북의 Description을 가리키면 그 Description. 정할 수 없는 요소가 섞이면 null(텍스트 레이어 하나로 본다),
// 서로 다른 플립북이면 오류다.
function selectedDescription(): Found | null {
  const selection = figma.currentPage.selection;
  if (!selection.length) return null;
  const found = selection.map(descriptionOf);
  if (found.some(f => !f)) return null;
  if (new Set(found.map(f => f!.root.id)).size > 1) throw new Error(COPY.figmaText007);
  return found[0];
}

// 목록에서 고른 플립북 프레임의 Description(편집기의 Description 영역, 2026-11-04 사용자 요청). 찾지 못하면 오류다.
export function flipbookDescriptionRoot(frame: SceneNode): SceneNode {
  const found = descriptionOf(frame);
  if (!found) throw new Error(COPY.figmaText006);
  return found.root;
}

export function selectedDescriptionRoot(): SceneNode | null {
  return selectedDescription()?.root ?? null;
}

// 고른 텍스트가 아닌 프레임 하나. 플립북 안의 선택은 그 플립북 Description이 대상이므로 selectedDescription 다음에 본다.
// 인스턴스 안의 프레임에는 레이어를 더할 수 없다.
export function selectedFrame(): FrameNode | null {
  const selection = figma.currentPage.selection;
  const [node] = selection;
  if (selection.length !== 1 || node.type !== 'FRAME') return null;
  for (let n: BaseNode | null = node.parent; n && n.type !== 'PAGE'; n = n.parent) if (n.type === 'INSTANCE') throw new Error(COPY.figmaText009);
  return node;
}

// 텍스트 편집 탭에 보여 줄 지금 선택의 대상
export function selectionTarget(): SelectionTarget {
  try {
    const found = selectedDescription();
    if (found) return { kind: 'description', flipbookId: found.flipbook?.getSharedPluginData(NS, FLIPBOOK_KEY) || null, name: found.label ?? (found.flipbook ?? found.root).name };
    const frame = selectedFrame();
    if (frame) return { kind: 'frame', name: frame.name };
    const selection = figma.currentPage.selection;
    if (selection.length === 1 && selection[0].type === 'TEXT') return { kind: 'text', name: selection[0].name };
    return { kind: 'none' };
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

// 본문 칸: 표식 템플릿에서 「Description 본문」에 연결한 칸이면 그 칸, 아니면 Description 안의 description area 슬롯
function bodyArea(root: SceneNode): SlotNode | FrameNode {
  if (root.getSharedPluginData(NS, PART_KEY) === 'description' && (root.type === 'SLOT' || root.type === 'FRAME')) return root;
  const area = findBodyArea(root);
  if (!area || area.type !== 'SLOT') throw new Error(COPY.figmaText005);
  return area;
}

function blank(): RichParagraph { return { text: '', depth: null, bold: [] }; }

function isHeading(p: RichParagraph): boolean {
  return (p.depth === null || (p.depth === 0 && p.list === 'ORDERED'))
    && !!p.text.trim() && p.bold.some(range => range.start === 0 && range.end === p.text.length);
}

// Figma의 번호 목록은 글자에 번호가 없고, 분리된 제목 레이어마다 1부터 다시 시작한다.
// Description 제목으로 읽을 때 번호를 글자로 고정해 제목의 의미와 표시를 함께 보존한다.
function normalizeHeadings(doc: RichParagraph[]): RichParagraph[] {
  let number = 0;
  return doc.map(p => {
    if (!isHeading(p) || p.list !== 'ORDERED') return p;
    number = p.number ?? number + 1;
    const prefix = `${number}. `;
    return { ...p, text: prefix + p.text, depth: null, list: undefined, number: undefined,
      bold: [{ start: 0, end: prefix.length + p.text.length }],
      ...(p.red ? { red: p.red.map(range => ({ start: range.start + prefix.length, end: range.end + prefix.length })) } : {}) };
  });
}

interface DescriptionGroup { title: RichParagraph | null; body: RichParagraph[] }
type DescriptionItem = { kind: 'group'; group: DescriptionGroup } | { kind: 'spacer' };

// A fully bold standalone line is an explicit grouping mark supplied by the editor.
// Its words are never compared with Policy, Navigation, numbered items, or layer names.
// 「---」 줄은 묶음을 끊고 그 자리에 여백을 둔다(2026-11-04 사용자 요청: 자동 여백 15 대신).
function splitItems(doc: RichParagraph[]): DescriptionItem[] {
  const items: DescriptionItem[] = [];
  let current: DescriptionGroup = { title: null, body: [] };
  const flush = () => {
    while (current.body[current.body.length - 1]?.text === '') current.body.pop();
    while (current.body[0]?.text === '') current.body.shift();
    if (current.title || current.body.some(p => p.text)) items.push({ kind: 'group', group: current });
  };
  for (const paragraph of normalizeHeadings(doc)) {
    if (isSpacer(paragraph)) {
      flush();
      items.push({ kind: 'spacer' });
      current = { title: null, body: [] };
    } else if (isHeading(paragraph)) {
      flush();
      current = { title: paragraph, body: [] };
    } else current.body.push(paragraph);
  }
  flush();
  return items;
}

const isGroup = (node: SceneNode): node is FrameNode => node.type === 'FRAME' && node.visible && node.getPluginData(GROUP_MARKER) === '1';
const isSpacerFrame = (node: SceneNode): node is FrameNode => node.type === 'FRAME' && node.visible && node.getPluginData(SPACER_MARKER) === '1';

function managedGroups(area: SlotNode | FrameNode): FrameNode[] {
  return area.children.filter(isGroup);
}
function managedItems(area: SlotNode | FrameNode): FrameNode[] {
  return area.children.filter((node): node is FrameNode => isGroup(node) || isSpacerFrame(node));
}

export function readDescription(root: SceneNode): RichParagraph[] {
  const area = bodyArea(root);
  const items = managedItems(area);
  const trailing = Math.max(0, Number(area.getPluginData(TRAILING_SPACER_COUNT)) || 0);
  if (items.length || trailing) {
    const result: RichParagraph[] = [];
    let afterSpacer = true;
    for (const item of items) {
      if (item.getPluginData(SPACER_MARKER) === '1') { result.push({ text: SPACER_TEXT, depth: null, bold: [] }); afterSpacer = true; continue; }
      const count = Math.max(0, Number(item.getPluginData(SPACER_COUNT)) || 0);
      for (let i = 0; i < count; i++) result.push({ text: SPACER_TEXT, depth: null, bold: [] });
      if (count) afterSpacer = true;
      const texts = item.children.filter((node): node is TextNode => node.type === 'TEXT' && node.visible);
      if (!afterSpacer) result.push(blank());
      afterSpacer = false;
      texts.forEach(node => {
        result.push(...readRichText(node));
      });
    }
    for (let i = 0; i < trailing; i++) result.push({ text: SPACER_TEXT, depth: null, bold: [] });
    return normalizeHeadings(result);
  }
  const oldBody = area.children.find((node): node is TextNode =>
    node.type === 'TEXT' && node.visible && node.getPluginData(OLD_BODY_MARKER) === '1');
  if (oldBody) return normalizeHeadings(readRichText(oldBody));
  const texts = area.findAllWithCriteria({ types: ['TEXT'] })
    .filter(node => isShown(node, area))
    .sort((a, b) => (a.absoluteBoundingBox?.y ?? 0) - (b.absoluteBoundingBox?.y ?? 0)
      || (a.absoluteBoundingBox?.x ?? 0) - (b.absoluteBoundingBox?.x ?? 0));
  const result: RichParagraph[] = [];
  for (const node of texts) {
    if (result.length) result.push(blank());
    result.push(...readRichText(node));
  }
  return normalizeHeadings(result);
}

// 담는 칸(본문 칸이나 감싼 프레임)과 그 안 글자에서 편집기 서식 도구 값을 읽는다. 읽지 못한 값은 기본값이다.
function containerLayout(container: SlotNode | FrameNode): TextLayout {
  const layout = cloneLayout(DEFAULT_TEXT_LAYOUT);
  if (container.layoutMode !== 'NONE') {
    layout.gap = 0;
    layout.padding = [container.paddingTop, container.paddingRight, container.paddingBottom, container.paddingLeft];
  }
  const texts = container.findAllWithCriteria({ types: ['TEXT'] }).filter(node => isShown(node, container) && node.characters.length > 0);
  const plain = texts.find(node => node.getStyledTextSegments(['fontName']).some(s => !BOLD_STYLE.test(s.fontName.style))) ?? texts[0];
  if (plain) Object.assign(layout, readTextLayout(plain));
  const spacer = container.children.find(node => node.type === 'FRAME' && node.visible
    && (node.getPluginData(SPACER_MARKER) === '1' || node.getPluginData(GROUP_MARKER) === '1' && !!node.getPluginData(SPACER_COUNT)));
  const stored = container.getPluginData(SPACER_HEIGHT) || spacer?.getPluginData(SPACER_HEIGHT);
  if (stored !== undefined && stored !== '' && Number.isFinite(Number(stored))) layout.spacer = Number(stored);
  else if (spacer && isSpacerFrame(spacer)) layout.spacer = spacer.height;
  return layout;
}

export function readDescriptionLayout(root: SceneNode): TextLayout {
  return containerLayout(bodyArea(root));
}

// 텍스트 편집 탭의 불러오기: 텍스트 레이어 하나의 글자 서식. 간격·여백은 기본값이다.
export function readTextNodeLayout(node: TextNode): TextLayout {
  return { ...cloneLayout(DEFAULT_TEXT_LAYOUT), ...readTextLayout(node) };
}

// 새 제목·본문 레이어의 서식. 슬롯에 있던 텍스트(템플릿의 예시 문구나 이전에 적용한 묶음)의 첫 글자 서식을 이어받는다.
interface TextStyle { font: FontName; fontSize: number; lineHeight: LineHeight; letterSpacing: LetterSpacing | null; fills: Paint[] }
interface DescriptionStyle { text: TextStyle | null; itemSpacing: number }
// 슬롯에 텍스트나 이전 묶음이 없을 때만 쓰는 구현 기본값(BEHAVIOR.md 「텍스트 편집」, 확인 필요).
const DEFAULT_TEXT = { fontSize: 16, lineHeight: { unit: 'PERCENT', value: 130 } as LineHeight, fills: [{ type: 'SOLID', color: { r: 0.12, g: 0.12, b: 0.12 } }] as Paint[] };
const DEFAULT_ITEM_SPACING = 3;

function isShown(node: BaseNode, area: BaseNode): boolean {
  for (let current: BaseNode | null = node; current && current.id !== area.id; current = current.parent) {
    if ('visible' in current && !current.visible) return false;
  }
  return true;
}

function textStyleOf(node: TextNode): TextStyle | null {
  const segments = node.characters.length ? node.getStyledTextSegments(['fontName']) : [];
  // 굵지 않은 글자가 있으면 그 글자의 서식을 쓴다. 제목 레이어만 남았으면 같은 계열에서 본문 글꼴을 찾는다(textFonts).
  const at = segments.find(s => !BOLD_STYLE.test(s.fontName.style))?.start ?? 0;
  const pick = <T>(ranged: T | typeof figma.mixed, whole: T | typeof figma.mixed): T | null =>
    ranged !== figma.mixed ? ranged : whole !== figma.mixed ? whole : null;
  const has = node.characters.length > 0;
  const font = pick(has ? node.getRangeFontName(at, at + 1) : figma.mixed, node.fontName);
  const fontSize = pick(has ? node.getRangeFontSize(at, at + 1) : figma.mixed, node.fontSize);
  const lineHeight = pick(has ? node.getRangeLineHeight(at, at + 1) : figma.mixed, node.lineHeight);
  const letterSpacing = pick(has ? node.getRangeLetterSpacing(at, at + 1) : figma.mixed, node.letterSpacing);
  const fills = pick(has ? node.getRangeFills(at, at + 1) : figma.mixed, node.fills);
  if (!font || fontSize === null || !lineHeight || !fills) return null;
  return { font, fontSize, lineHeight, letterSpacing, fills: [...fills] };
}

function styleOf(area: SlotNode | FrameNode): DescriptionStyle {
  const group = managedGroups(area)[0];
  const texts = area.findAllWithCriteria({ types: ['TEXT'] }).filter(node => isShown(node, area) && !node.hasMissingFont);
  // 본문 글자(굵지 않은 글자)가 있는 레이어를 먼저 본다. 굵은 제목 레이어만 있으면 그 서식을 쓴다.
  const plain = (node: TextNode) => node.characters.length > 0 && node.getStyledTextSegments(['fontName']).some(s => !BOLD_STYLE.test(s.fontName.style));
  let text: TextStyle | null = null;
  for (const node of [...texts.filter(plain), ...texts.filter(node => !plain(node))]) if ((text = textStyleOf(node))) break;
  return { text, itemSpacing: group ? group.itemSpacing : DEFAULT_ITEM_SPACING };
}

// 빈 제목·본문 레이어가 든 묶음 틀. 글꼴은 여기서 한 번만 불러오고, 묶음마다 이 틀을 복제해 글자만 넣는다.
async function makeTemplate(width: number, style: DescriptionStyle): Promise<{ template: FrameNode; fonts: TextFonts }> {
  const frame = figma.createFrame();
  try {
    frame.resize(width, 1);
    frame.layoutMode = 'VERTICAL';
    frame.primaryAxisSizingMode = 'AUTO';
    frame.counterAxisSizingMode = 'FIXED';
    frame.itemSpacing = style.itemSpacing;
    frame.fills = [];
    frame.clipsContent = false;
    const node = figma.createText();
    frame.appendChild(node);
    if (style.text) {
      try { await figma.loadFontAsync(style.text.font); } catch { throw new Error(`${COPY.figmaText003} ${style.text.font.family} ${style.text.font.style}`); }
      node.fontName = style.text.font;
    }
    const fonts = await textFonts(node);
    node.fontSize = style.text?.fontSize ?? DEFAULT_TEXT.fontSize;
    node.lineHeight = style.text?.lineHeight ?? DEFAULT_TEXT.lineHeight;
    if (style.text?.letterSpacing) node.letterSpacing = style.text.letterSpacing;
    node.fills = style.text?.fills ?? DEFAULT_TEXT.fills;
    node.resize(width, Math.max(1, node.height));
    node.textAutoResize = 'HEIGHT';
    frame.appendChild(node.clone());
    return { template: frame, fonts };
  } catch (error) {
    frame.remove();
    throw error;
  }
}

function makeGroup(template: FrameNode, group: DescriptionGroup, fonts: TextFonts, topPadding: number, layout?: TextLayout): FrameNode {
  const frame = template.clone();
  frame.name = group.title?.text ?? COPY.figmaText008;
  frame.setPluginData(GROUP_MARKER, '1');
  frame.paddingTop = topPadding;
  const [title, body] = frame.children as TextNode[];
  if (group.title) { title.name = group.title.text; applyRichText(title, [group.title], fonts, layout); } else title.remove();
  if (group.body.length) { body.name = COPY.figmaText008; applyRichText(body, group.body, fonts, layout); } else body.remove();
  return frame;
}

// 「---」는 다음 묶음의 Top Padding과 표식으로 저장한다. 별도 레이어를 만들지 않는다.
function makeItems(items: DescriptionItem[], template: FrameNode, fonts: TextFonts, layout: TextLayout | undefined, out: FrameNode[]): number {
  let seenGroup = false, count = 0;
  const height = Math.max(0, layout?.spacer ?? DEFAULT_TEXT_LAYOUT.spacer);
  for (const item of items) {
    if (item.kind === 'spacer') {
      count++;
    } else {
      const group = makeGroup(template, item.group, fonts, seenGroup ? ITEM_TOP_PADDING + count * height : 0, layout);
      if (count) group.setPluginData(SPACER_COUNT, String(count));
      out.push(group);
      seenGroup = true;
      count = 0;
    }
  }
  return count;
}

// 묶음을 차례로 넣고 폭을 채운다.
function placeItems(container: SlotNode | FrameNode, items: FrameNode[]): void {
  for (const item of items) {
    container.appendChild(item);
    item.layoutSizingHorizontal = 'FILL';
    for (const node of item.children) if (node.type === 'TEXT') node.layoutSizingHorizontal = 'FILL';
  }
}

// 서식 도구의 간격·여백을 오토 레이아웃 칸에 쓴다.
function applySpacing(container: SlotNode | FrameNode, layout: TextLayout): void {
  if (container.layoutMode === 'NONE') return;
  container.itemSpacing = 0;
  [container.paddingTop, container.paddingRight, container.paddingBottom, container.paddingLeft] = layout.padding;
}

// select: 텍스트 편집 탭에서 적용하면 적용한 Description을 고른다. 플립북 목록의 Description 영역에서는 선택을 바꾸지 않는다.
export async function fillDescription(root: SceneNode, doc: RichParagraph[], layout?: TextLayout, select = true): Promise<SelectionWrite> {
  const area = bodyArea(root);
  const before = { itemSpacing: area.itemSpacing, padding: [area.paddingTop, area.paddingRight, area.paddingBottom, area.paddingLeft] as TextLayout['padding'],
    spacerHeight: area.getPluginData(SPACER_HEIGHT), trailing: area.getPluginData(TRAILING_SPACER_COUNT) };
  const padding = layout && area.layoutMode !== 'NONE' ? layout.padding : before.padding;
  const width = Math.max(1, area.width - padding[1] - padding[3]);
  const { template, fonts } = await makeTemplate(width, styleOf(area));
  const prepared: FrameNode[] = [];
  try {
    const trailing = makeItems(splitItems(doc), template, fonts, layout, prepared);
    const old = [...area.children];
    if (layout) applySpacing(area, layout);
    else if (area.layoutMode !== 'NONE') area.itemSpacing = 0;
    placeItems(area, prepared);
    area.setPluginData(TRAILING_SPACER_COUNT, trailing ? String(trailing) : '');
    area.setPluginData(SPACER_HEIGHT, String(Math.max(0, layout?.spacer ?? DEFAULT_TEXT_LAYOUT.spacer)));
    for (const node of old) if (!node.removed) node.remove();
    if (select) figma.currentPage.selection = [root];
    return { kind: 'description' };
  } catch (error) {
    for (const item of prepared) if (!item.removed) item.remove();
    area.setPluginData(SPACER_HEIGHT, before.spacerHeight);
    area.setPluginData(TRAILING_SPACER_COUNT, before.trailing);
    if (area.layoutMode !== 'NONE') { area.itemSpacing = before.itemSpacing; if (layout) [area.paddingTop, area.paddingRight, area.paddingBottom, area.paddingLeft] = before.padding; }
    throw error;
  } finally {
    template.remove();
  }
}

// 플립북 밖에서 고른 프레임에 Description과 같은 제목·본문 묶음을 오토 레이아웃 프레임 하나로 감싸 넣는다.
// 적용할 때마다 새로 추가하고 이미 넣은 것은 그대로 둔다. 감싸는 프레임은 고른 프레임 폭에 맞춰 맨 아래에 놓고
// 고른 프레임 크기는 바꾸지 않는다. 서식은 그 프레임에 이전에 넣은 묶음이 있으면 마지막 것을, 없으면 Description 기본값을 쓴다.
// layout이 있으면 감싼 프레임의 간격·여백과 글자 서식은 그 값이다.
export async function addTextFrame(frame: FrameNode, doc: RichParagraph[], layout?: TextLayout): Promise<SelectionWrite> {
  const auto = frame.layoutMode !== 'NONE';
  // 폭을 내용에 맞추는(Hug) 오토 레이아웃 프레임에서는 Fill로 두면 그 프레임이 고정 폭으로 바뀌므로 지금 안쪽 폭으로 고정한다.
  const fill = auto && frame.layoutSizingHorizontal !== 'HUG';
  const width = Math.max(1, auto ? frame.width - frame.paddingLeft - frame.paddingRight : frame.width);
  const previous = frame.children.filter((node): node is FrameNode => node.type === 'FRAME' && node.getPluginData(TEXT_FRAME_MARKER) === '1').pop();
  const style = previous ? styleOf(previous) : { text: null, itemSpacing: DEFAULT_ITEM_SPACING };
  const spacing = layout
    ? { itemSpacing: 0, paddingTop: layout.padding[0], paddingRight: layout.padding[1], paddingBottom: layout.padding[2], paddingLeft: layout.padding[3] }
    : TEXT_FRAME;
  const inner = Math.max(1, width - spacing.paddingLeft - spacing.paddingRight);
  const { template, fonts } = await makeTemplate(inner, style);
  const wrapper = figma.createFrame();
  const prepared: FrameNode[] = [];
  try {
    wrapper.name = COPY.figmaText011;
    wrapper.setPluginData(TEXT_FRAME_MARKER, '1');
    wrapper.resize(width, 1);
    wrapper.layoutMode = 'VERTICAL';
    wrapper.primaryAxisSizingMode = 'AUTO';
    wrapper.counterAxisSizingMode = 'FIXED';
    wrapper.primaryAxisAlignItems = 'MIN';
    wrapper.counterAxisAlignItems = 'MIN';
    wrapper.itemSpacing = spacing.itemSpacing;
    wrapper.paddingLeft = spacing.paddingLeft;
    wrapper.paddingRight = spacing.paddingRight;
    wrapper.paddingTop = spacing.paddingTop;
    wrapper.paddingBottom = spacing.paddingBottom;
    wrapper.fills = [];
    wrapper.clipsContent = false;
    const trailing = makeItems(splitItems(doc), template, fonts, layout, prepared);
    wrapper.setPluginData(TRAILING_SPACER_COUNT, trailing ? String(trailing) : '');
    wrapper.setPluginData(SPACER_HEIGHT, String(Math.max(0, layout?.spacer ?? DEFAULT_TEXT_LAYOUT.spacer)));
    placeItems(wrapper, prepared);
    // 오토 레이아웃이 아니면 보이는 내용 아래(빈 프레임이면 왼쪽 위)에 놓는다.
    const bottom = Math.max(0, ...frame.children.filter(node => node.visible).map(node => node.y + node.height));
    frame.appendChild(wrapper);
    if (fill) wrapper.layoutSizingHorizontal = 'FILL';
    else if (!auto) { wrapper.x = 0; wrapper.y = bottom; }
    return { kind: 'frame' };
  } catch (error) {
    for (const item of prepared) if (!item.removed) item.remove();
    if (!wrapper.removed) wrapper.remove();
    throw error;
  } finally {
    template.remove();
  }
}
