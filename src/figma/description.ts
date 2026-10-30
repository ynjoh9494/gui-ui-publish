import { COPY } from '../core/copy.ts';
import type { SelectionTarget, SelectionWrite } from '../core/description.ts';
import type { RichParagraph } from '../core/richText.ts';
import { PART_KEY } from '../core/templateParts.ts';
import { FLIPBOOK_KEY } from './flipbook.ts';
import { applyRichText, BOLD_STYLE, readRichText, textFonts, type TextFonts } from './richText.ts';
import { DESCRIPTION_AREA, GUI_AREA, NS, linksOf, markedPart } from './template.ts';

// 굵은 제목 줄마다 만든 제목·본문 묶음 표식. 레이어 하나로 넣었던 본문(OLD_BODY_MARKER)도 불러오기에서 읽는다.
const GROUP_MARKER = 'guiUiPublishDescriptionGroup';
const OLD_BODY_MARKER = 'guiUiPublishDescriptionBody';
// 플립북 밖에서 고른 프레임에 넣는, 묶음들을 감싼 오토 레이아웃 프레임(세로, 왼쪽 위 정렬)의 표식과 간격·여백
const TEXT_FRAME_MARKER = 'guiUiPublishTextFrame';
const TEXT_FRAME = { itemSpacing: 12, paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 16 };

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
  return p.depth === null && !!p.text.trim() && p.bold.some(range => range.start === 0 && range.end === p.text.length);
}

interface DescriptionGroup { title: RichParagraph | null; body: RichParagraph[] }

// A fully bold standalone line is an explicit grouping mark supplied by the editor.
// Its words are never compared with Policy, Navigation, numbered items, or layer names.
function splitGroups(doc: RichParagraph[]): DescriptionGroup[] {
  const groups: DescriptionGroup[] = [];
  let current: DescriptionGroup = { title: null, body: [] };
  for (const paragraph of doc) {
    if (isHeading(paragraph)) {
      while (current.body[current.body.length - 1]?.text === '') current.body.pop();
      if (current.title || current.body.some(p => p.text)) groups.push(current);
      current = { title: paragraph, body: [] };
    } else current.body.push(paragraph);
  }
  while (current.body[current.body.length - 1]?.text === '') current.body.pop();
  if (current.title || current.body.some(p => p.text)) groups.push(current);
  for (const group of groups) while (group.body[0]?.text === '') group.body.shift();
  return groups;
}

function managedGroups(area: SlotNode | FrameNode): FrameNode[] {
  return area.children.filter((node): node is FrameNode =>
    node.type === 'FRAME' && node.visible && node.getPluginData(GROUP_MARKER) === '1');
}

export function readDescription(root: SceneNode): RichParagraph[] {
  const area = bodyArea(root);
  const groups = managedGroups(area);
  if (groups.length) {
    const result: RichParagraph[] = [];
    for (const group of groups) {
      const texts = group.children.filter((node): node is TextNode => node.type === 'TEXT' && node.visible);
      if (result.length) result.push(blank());
      for (const node of texts) {
        if (result.length && node !== texts[0]) result.push(blank());
        result.push(...readRichText(node));
      }
    }
    return result;
  }
  const oldBody = area.children.find((node): node is TextNode =>
    node.type === 'TEXT' && node.visible && node.getPluginData(OLD_BODY_MARKER) === '1');
  if (oldBody) return readRichText(oldBody);
  const texts = area.findAllWithCriteria({ types: ['TEXT'] })
    .filter(node => isShown(node, area))
    .sort((a, b) => (a.absoluteBoundingBox?.y ?? 0) - (b.absoluteBoundingBox?.y ?? 0)
      || (a.absoluteBoundingBox?.x ?? 0) - (b.absoluteBoundingBox?.x ?? 0));
  const result: RichParagraph[] = [];
  for (const node of texts) {
    if (result.length) result.push(blank());
    result.push(...readRichText(node));
  }
  return result;
}

// 새 제목·본문 레이어의 서식. 슬롯에 있던 텍스트(템플릿의 예시 문구나 이전에 적용한 묶음)의 첫 글자 서식을 이어받는다.
interface TextStyle { font: FontName; fontSize: number; lineHeight: LineHeight; letterSpacing: LetterSpacing | null; fills: Paint[] }
interface DescriptionStyle { text: TextStyle | null; itemSpacing: number }
// 슬롯에 텍스트나 이전 묶음이 없을 때만 쓰는 구현 기본값(BEHAVIOR.md 「텍스트 편집」, 확인 필요).
const DEFAULT_TEXT = { fontSize: 16, lineHeight: { unit: 'PERCENT', value: 130 } as LineHeight, fills: [{ type: 'SOLID', color: { r: 0.12, g: 0.12, b: 0.12 } }] as Paint[] };
const DEFAULT_ITEM_SPACING = 3;
// 플립북 템플릿처럼 첫 묶음 아래와 마지막 묶음 위에 두는 여백(템플릿의 Policy 아래·Navigation 위, 2026-10-26 사용자 결정).
// 제목 문구는 보지 않고 자리로만 정하며, 묶음이 하나면 두지 않는다.
const EDGE_GROUP_PADDING = 15;

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

function makeGroup(template: FrameNode, group: DescriptionGroup, fonts: TextFonts): FrameNode {
  const frame = template.clone();
  frame.name = group.title?.text ?? COPY.figmaText008;
  frame.setPluginData(GROUP_MARKER, '1');
  const [title, body] = frame.children as TextNode[];
  if (group.title) { title.name = group.title.text; applyRichText(title, [group.title], fonts); } else title.remove();
  if (group.body.length) { body.name = COPY.figmaText008; applyRichText(body, group.body, fonts); } else body.remove();
  return frame;
}

// 묶음을 차례로 넣고 폭을 채운다. 묶음이 둘 이상이면 첫 묶음 아래와 마지막 묶음 위에 여백을 둔다.
function placeGroups(container: SlotNode | FrameNode, groups: FrameNode[]): void {
  if (groups.length > 1) {
    groups[0].paddingBottom = EDGE_GROUP_PADDING;
    groups[groups.length - 1].paddingTop = EDGE_GROUP_PADDING;
  }
  for (const group of groups) {
    container.appendChild(group);
    group.layoutSizingHorizontal = 'FILL';
    for (const node of group.children) if (node.type === 'TEXT') node.layoutSizingHorizontal = 'FILL';
  }
}

export async function fillDescription(root: SceneNode, doc: RichParagraph[]): Promise<SelectionWrite> {
  const area = bodyArea(root);
  const width = Math.max(1, area.width - area.paddingLeft - area.paddingRight);
  const { template, fonts } = await makeTemplate(width, styleOf(area));
  const prepared: FrameNode[] = [];
  try {
    for (const group of splitGroups(doc)) prepared.push(makeGroup(template, group, fonts));
    const old = [...area.children];
    placeGroups(area, prepared);
    for (const node of old) if (!node.removed) node.remove();
    figma.currentPage.selection = [root];
    return { kind: 'description' };
  } catch (error) {
    for (const group of prepared) if (!group.removed) group.remove();
    throw error;
  } finally {
    template.remove();
  }
}

// 플립북 밖에서 고른 프레임에 Description과 같은 제목·본문 묶음을 오토 레이아웃 프레임 하나로 감싸 넣는다.
// 적용할 때마다 새로 추가하고 이미 넣은 것은 그대로 둔다. 감싸는 프레임은 고른 프레임 폭에 맞춰 맨 아래에 놓고
// 고른 프레임 크기는 바꾸지 않는다. 서식은 그 프레임에 이전에 넣은 묶음이 있으면 마지막 것을, 없으면 Description 기본값을 쓴다.
export async function addTextFrame(frame: FrameNode, doc: RichParagraph[]): Promise<SelectionWrite> {
  const auto = frame.layoutMode !== 'NONE';
  // 폭을 내용에 맞추는(Hug) 오토 레이아웃 프레임에서는 Fill로 두면 그 프레임이 고정 폭으로 바뀌므로 지금 안쪽 폭으로 고정한다.
  const fill = auto && frame.layoutSizingHorizontal !== 'HUG';
  const width = Math.max(1, auto ? frame.width - frame.paddingLeft - frame.paddingRight : frame.width);
  const previous = frame.children.filter((node): node is FrameNode => node.type === 'FRAME' && node.getPluginData(TEXT_FRAME_MARKER) === '1').pop();
  const style = previous ? styleOf(previous) : { text: null, itemSpacing: DEFAULT_ITEM_SPACING };
  const { template, fonts } = await makeTemplate(Math.max(1, width - TEXT_FRAME.paddingLeft - TEXT_FRAME.paddingRight), style);
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
    wrapper.itemSpacing = TEXT_FRAME.itemSpacing;
    wrapper.paddingLeft = TEXT_FRAME.paddingLeft;
    wrapper.paddingRight = TEXT_FRAME.paddingRight;
    wrapper.paddingTop = TEXT_FRAME.paddingTop;
    wrapper.paddingBottom = TEXT_FRAME.paddingBottom;
    wrapper.fills = [];
    wrapper.clipsContent = false;
    for (const group of splitGroups(doc)) prepared.push(makeGroup(template, group, fonts));
    placeGroups(wrapper, prepared);
    // 오토 레이아웃이 아니면 보이는 내용 아래(빈 프레임이면 왼쪽 위)에 놓는다.
    const bottom = Math.max(0, ...frame.children.filter(node => node.visible).map(node => node.y + node.height));
    frame.appendChild(wrapper);
    if (fill) wrapper.layoutSizingHorizontal = 'FILL';
    else if (!auto) { wrapper.x = 0; wrapper.y = bottom; }
    return { kind: 'frame' };
  } catch (error) {
    for (const group of prepared) if (!group.removed) group.remove();
    if (!wrapper.removed) wrapper.remove();
    throw error;
  } finally {
    template.remove();
  }
}
