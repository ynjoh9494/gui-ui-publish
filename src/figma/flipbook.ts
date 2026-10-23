import { COPY } from '../core/copy.ts';
import type { FlipbookSpot } from '../core/compare.ts';
import { GUI_GAP, guiTargetWidth, type FlipbookGui, type FlipbookRow, type FlipbookView } from '../core/flipbook.ts';
import { newSectionKey } from '../core/flipbooks.ts';
import { TAG_PALETTE } from '../core/palette.ts';
import type { NodeSnapshot } from '../core/fingerprint.ts';
import { sha256 } from '../core/hash.ts';
import { COPY_KEY, copyLayers, rescaleExact } from './layers.ts';
import { Snapshotter } from './snapshot.ts';

// 플립북 페이지 반영. 시스템 영역(제목·Status·Chapter·Page title·Screen ID·GUI 영역·이력 목록)만 고치고,
// Description 슬롯과 마커·콜아웃은 건드리지 않는다.
//
// 템플릿(2026-10-20 사용자 결정)은 일반 프레임이다. 그 안의 UI Title·Flipbook-Title·Update History List는 컴포넌트이고,
// GUI Image Slot은 컴포넌트가 아닌 프레임이다. 플립북은 템플릿 프레임을 복제하고 안의 컴포넌트를 인스턴스로 바꿔 만든다.

// 플러그인 ID가 바뀌어도 데이터가 남도록 pluginData 대신 네임스페이스가 있는 sharedPluginData를 쓴다.
export const NS = 'guiuipublish';
export const FLIPBOOK_KEY = 'flipbookOf';
// 플립북 프레임이 자기 노드 ID를 적어 두는 키. 캔버스에서 복제한 프레임은 원본의 값을 그대로 가져가므로 자기 ID와 다르다.
const NODE_KEY = 'flipbookNode';
const CATEGORY_KEY = 'categoryOf';
const IMAGE_KEY = 'flipbookImage';
const IDS_KEY = 'flipbookIds';
const CHAPTER_KEY = 'flipbookChapter';

// 배치(2026-10-19 사용자 결정): Section 안쪽 여백 300, 화면 사이 200, Section 사이 800, 한 행에 화면 10개
const PAD = 300;
const GAP = 200;
const SECTION_GAP = 800;
const COLUMNS = 10;
// 배율 기준인 STB 원본 화면 폭. 1920 원본은 1x 설정 폭과 같은 너비가 되고, 다른 폭의 원본도 같은 비율로 줄인다.
const SOURCE_WIDTH = 1920;
const GUI_BASE_HEIGHT_KEY = 'flipbookImageBaseHeight';

export interface FlipbookSettings { pageId: string; templateId: string; force?: boolean }

// 한 번의 전달 작업 안에서만 공유한다. 다음 작업은 파일의 최신 상태를 다시 읽는다.
export function flipbookSession() {
  return { pages: new Map<string, PageNode>(), frames: new Map<string, Map<string, FrameNode>>(), kits: new Map<string, TagKit>() };
}
export type FlipbookSession = ReturnType<typeof flipbookSession>;

function pageOf(node: BaseNode): PageNode | null {
  let current: BaseNode | null = node;
  while (current && current.type !== 'PAGE') current = current.parent;
  return current as PageNode | null;
}

export async function loadedPage(pageId: string): Promise<PageNode> {
  const page = await figma.getNodeByIdAsync(pageId);
  if (!page || page.type !== 'PAGE') throw new Error(COPY.figmaFlipbook001);
  await page.loadAsync();
  return page;
}

// ── 템플릿 ─────────────────────────────────────────────

const TITLE = 'UI Title';
const HEADER = 'Flipbook-Title';
export const GUI_AREA = 'GUI Image Slot';
export const DESCRIPTION_AREA = 'description area';
const HISTORY = 'Update History List';
const ID_CELL = 'input-cell-id';

// 이름으로 찾되 GUI 영역 안으로는 내려가지 않는다. GUI 영역에는 화면 레이어 복사본이 통째로 들어 있어
// 화면마다 전체를 훑으면 반영이 크게 느려진다.
function findPart(root: ChildrenMixin, match: (n: SceneNode) => boolean): SceneNode | null {
  for (const child of root.children) {
    if (match(child)) return child;
    if ('children' in child && child.name !== GUI_AREA) {
      const found = findPart(child, match);
      if (found) return found;
    }
  }
  return null;
}

const named = (name: string, types?: string[]) => (n: SceneNode) => n.name === name && (!types || types.includes(n.type));
const COMPONENTISH = ['COMPONENT', 'INSTANCE'];

interface Parts {
  title: ComponentNode | InstanceNode | null;
  titleText: TextNode | null;
  status: InstanceNode | null;
  header: ComponentNode | InstanceNode | null;
  chapter: TextNode | null;
  page: TextNode | null;
  ids: SceneNode | null;
  gui: FrameNode | null;
  description: SceneNode | null;
  history: ComponentNode | InstanceNode | null;
  list: SceneNode | null;
}

const cellText = (header: ChildrenMixin | null, cell: string) =>
  (header ? findPart(header, n => n.type === 'TEXT' && n.parent?.name === cell) : null) as TextNode | null;

function parts(root: ChildrenMixin): Parts {
  const title = findPart(root, named(TITLE, COMPONENTISH)) as ComponentNode | InstanceNode | null;
  const header = findPart(root, named(HEADER, COMPONENTISH)) as ComponentNode | InstanceNode | null;
  const history = findPart(root, named(HISTORY, COMPONENTISH)) as ComponentNode | InstanceNode | null;
  return {
    title,
    titleText: (title?.findChild(n => n.type === 'TEXT') ?? null) as TextNode | null,
    status: (title?.findOne(n => n.type === 'INSTANCE' && n.name === 'Status') ?? null) as InstanceNode | null,
    header,
    chapter: cellText(header, 'input-cell-chapter'),
    page: cellText(header, 'input-cell-page'),
    ids: header ? findPart(header, named(ID_CELL)) : null,
    gui: findPart(root, named(GUI_AREA, ['FRAME'])) as FrameNode | null,
    description: findPart(root, named(DESCRIPTION_AREA, ['SLOT'])),
    history,
    list: history ? findPart(history, named('List')) : null,
  };
}

export async function templateFrame(id: string): Promise<FrameNode> {
  const node = await figma.getNodeByIdAsync(id);
  if (!node || node.type !== 'FRAME') throw new Error(COPY.figmaFlipbook002);
  await pageOf(node)?.loadAsync();
  return node;
}

// 반영에 필요한 시스템 영역이 있는지 확인한다. 인스턴스 안에 행·태그를 넣으려면 List·input-cell-id가 슬롯이어야 한다.
export function templateProblems(root: FrameNode): string[] {
  const p = parts(root);
  const out: string[] = [];
  if (!p.titleText) out.push(COPY.figmaFlipbook003);
  if (!p.status) out.push(COPY.figmaFlipbook004);
  if (!p.chapter || !p.page) out.push(COPY.figmaFlipbook024);
  if (!p.ids) out.push(ID_CELL);
  else if (p.ids.type !== 'SLOT') out.push(`${ID_CELL} ${COPY.figmaFlipbook025}`);
  if (!p.gui) out.push(COPY.figmaFlipbook005);
  if (!p.list) out.push(COPY.figmaFlipbook006);
  else if (p.list.type !== 'SLOT') out.push(`List ${COPY.figmaFlipbook025}`);
  return out;
}

// 캔버스에서 고른 템플릿 프레임(또는 그 안의 노드)을 확인한다.
export async function templateFromSelection(): Promise<{ id: string; name: string }> {
  const node = figma.currentPage.selection[0];
  if (!node) throw new Error(COPY.figmaFlipbook007);
  let frame: BaseNode | null = node;
  let problems: string[] = [];
  while (frame && frame.type !== 'PAGE') {
    if (frame.type === 'FRAME' && parts(frame).history) {
      problems = templateProblems(frame);
      if (!problems.length) break;
    }
    frame = frame.parent;
  }
  if (!frame || frame.type !== 'FRAME') throw new Error(problems.length ? `${COPY.figmaFlipbook009} ${problems.join(', ')}` : COPY.figmaFlipbook008);
  await tagKit(frame.id);
  return { id: frame.id, name: frame.name };
}

async function variantOptions(instance: InstanceNode, property: string): Promise<string[]> {
  const main = await instance.getMainComponentAsync();
  const owner = main?.parent?.type === 'COMPONENT_SET' ? main.parent : null;
  return owner?.componentPropertyDefinitions[property]?.variantOptions ?? [];
}

// 태그 표시 컴포넌트: 상단 Status는 TagBig, 이력 행은 TagSmall, Screen ID는 Team(Tag=System).
// 템플릿과 같은 페이지에서 이름으로 찾는다.
export interface TagKit {
  template: FrameNode; big: ComponentNode; small: ComponentNode; idTag: ComponentNode;
  fonts: Map<string, Promise<void>>;
}

// 템플릿과 같은 페이지의 태그 컴포넌트. 없는 컴포넌트가 있으면 그 이름을 넣은 안내를 함께 돌려준다.
function tagComponents(template: FrameNode) {
  const page = pageOf(template)!;
  const components = page.findAllWithCriteria({ types: ['COMPONENT'] });
  const big = components.find(c => c.name === 'TagBig');
  const small = components.find(c => c.name === 'TagSmall');
  const idTag = components.find(c => c.name === 'Tag=System' && c.parent?.type === 'COMPONENT_SET' && c.parent.name === 'Team');
  const missing = [!big && 'TagBig', !small && 'TagSmall', !idTag && 'Team / Tag=System'].filter(Boolean);
  return { big, small, idTag, problem: missing.length ? `${COPY.figmaFlipbook010}${missing.join('·')}${COPY.figmaFlipbook011}${page.name}${COPY.figmaFlipbook012}` : null };
}

// 지정한 템플릿으로 플립북을 만들거나 반영할 수 있는지 확인한다. 템플릿 컴포넌트를 고쳐 시스템 영역이 없어지거나 슬롯이 아니게 되면
// 반영이 중간에 멈추므로, 관리 화면이 아니어도 미리 알린다. 템플릿을 지정하지 않았으면 확인하지 않는다.
export async function templateIssues(templateId: string | null): Promise<string[]> {
  if (!templateId) return [];
  let template: FrameNode;
  try { template = await templateFrame(templateId); }
  catch (e) { return [e instanceof Error ? e.message : String(e)]; }
  const problems = templateProblems(template);
  const tags = tagComponents(template).problem;
  return [...(problems.length ? [`${COPY.figmaFlipbook009} ${problems.join(', ')}`] : []), ...(tags ? [tags] : [])];
}

export async function tagKit(templateId: string): Promise<TagKit> {
  const template = await templateFrame(templateId);
  const { big, small, idTag, problem } = tagComponents(template);
  if (problem) throw new Error(problem);
  return { template, big: big!, small: small!, idTag: idTag!, fonts: new Map() };
}

const PALETTE_HEXES = new Set<string>(TAG_PALETTE.map(c => c.hex));

function rgbHex({ r, g, b }: RGB): string {
  return `#${[r, g, b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function hexRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16 & 255) / 255, g: (n >> 8 & 255) / 255, b: (n & 255) / 255 };
}

// 칠 중 팔레트 색인 단색만 선택한 색으로 바꾼다(흰 바탕 등은 그대로). 색 변수에 연결된 칠은 연결을 끊고 hex를 직접 넣는다.
// 바꿀 칠이 없으면 null.
export function recolorTagFills(fills: readonly Paint[], colorKey: string): Paint[] | null {
  const target = TAG_PALETTE.find(c => c.key === colorKey)?.hex;
  if (!target) return null;
  let changed = false;
  const next = fills.map(paint => {
    if (paint.type !== 'SOLID') return paint;
    const hex = rgbHex(paint.color);
    if (!PALETTE_HEXES.has(hex) || (hex === target && !paint.boundVariables?.color)) return paint;
    changed = true;
    const { boundVariables, ...rest } = paint;
    return { ...rest, color: hexRgb(target) };
  });
  return changed ? next : null;
}

// 태그 자리의 인스턴스를 태그 컴포넌트로 바꾸고 이름과 색을 넣는다. 미리 만든 태그를 고르지 않는다.
// 배경·글자 중 팔레트 색인 칠만 선택한 색으로 바꾼다(흰 바탕 등은 그대로).
async function applyTag(slot: InstanceNode, component: ComponentNode, kit: TagKit, text: string, colorKey: string): Promise<void> {
  if ((await slot.getMainComponentAsync())?.id !== component.id) {
    slot.swapComponent(component);
    // 다음 반영에서도 같은 자리를 찾도록 이름을 유지한다.
    slot.name = 'Status';
  }
  await setText(slot.findOne(n => n.type === 'TEXT' && n.name === 'Text') as TextNode | null, text, kit.fonts);
  const painted = [slot as SceneNode, ...slot.findAll(n => 'fills' in n)];
  for (const node of painted) {
    if (!('fills' in node) || !Array.isArray(node.fills)) continue;
    const fills = recolorTagFills(node.fills as Paint[], colorKey);
    if (fills) (node as GeometryMixin).fills = fills;
  }
}

async function setVariant(instance: InstanceNode, property: string, value: string): Promise<boolean> {
  if (!(await variantOptions(instance, property)).includes(value)) return false;
  if (instance.componentProperties[property]?.value !== value) instance.setProperties({ [property]: value });
  return true;
}

async function setText(node: TextNode | null, value: string, cache: Map<string, Promise<void>>): Promise<void> {
  if (!node || node.characters === (value || ' ')) return;
  const fonts = node.characters.length ? node.getRangeAllFontNames(0, node.characters.length) : [node.fontName as FontName];
  await Promise.all(fonts.map(f => {
    const key = JSON.stringify(f);
    if (!cache.has(key)) {
      const pending = figma.loadFontAsync(f);
      cache.set(key, pending);
      void pending.catch(() => { if (cache.get(key) === pending) cache.delete(key); });
    }
    return cache.get(key)!;
  }));
  node.characters = value || ' ';
}

// ── 배치 ───────────────────────────────────────────────

// 루트 Section(페이지 바로 아래 Section) 안의 플립북 프레임. Section 안의 Section은 없는 것으로 보고(2026-10-23 사용자 결정)
// 그 안의 프레임도 루트 Section에 놓인 것으로 센다. 위치는 루트 Section 기준 좌표로 읽고 쓴다.
// 놓인 순서(위 행부터, 행 안에서는 왼쪽부터)로 돌려준다.
interface Placed extends Box { readonly node: FrameNode }
function placed(node: FrameNode, dx: number, dy: number): Placed {
  return {
    node,
    get x() { return node.x + dx; }, set x(v) { node.x = v - dx; },
    get y() { return node.y + dy; }, set y(v) { node.y = v - dy; },
    get width() { return node.width; }, get height() { return node.height; },
  };
}
function flipbookFrames(section: SectionNode, ns: string): Placed[] {
  const out: Placed[] = [];
  const walk = (container: SectionNode, dx: number, dy: number) => {
    for (const n of container.children) {
      if (n.type === 'FRAME' && n.getSharedPluginData(ns, FLIPBOOK_KEY)) out.push(placed(n, dx, dy));
      else if (n.type === 'SECTION') walk(n, dx + n.x, dy + n.y);
    }
  };
  walk(section, 0, 0);
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
}

// 노드가 들어 있는 루트 Section. 페이지 바로 아래에 있거나 Section 밖이면 null.
function rootSection(node: BaseNode): SectionNode | null {
  let found: SectionNode | null = null;
  for (let n = node.parent; n && n.type !== 'PAGE'; n = n.parent) found = n.type === 'SECTION' ? n : null;
  return found;
}

function categorySection(ns: string, page: PageNode, category: { key: string; name: string }): SectionNode {
  const sections = page.children.filter((n): n is SectionNode => n.type === 'SECTION');
  const found = sections.find(s => s.getSharedPluginData(ns, CATEGORY_KEY) === category.key);
  // 있는 Section의 이름은 바꾸지 않는다. Section 이름은 캔버스에서 바꾸고 기록이 따라간다(2026-10-22 사용자 결정).
  if (found) return found;
  const section = figma.createSection();
  section.name = category.name;
  section.setSharedPluginData(ns, CATEGORY_KEY, category.key);
  page.appendChild(section);
  const others = page.children.filter(n => n !== section);
  section.x = others.length ? Math.min(...others.map(n => n.x)) : 0;
  section.y = others.length ? Math.max(...others.map(n => n.y + n.height)) + SECTION_GAP : 0;
  return section;
}

// 플립북 배치(2026-10-21 사용자 결정): 사용자가 Section 안에서 일부러 띄워 두거나 다음 행으로 옮긴 배치를 정리하지 않는다.
// 새 프레임은 빈 칸에 놓고, 그 칸이 차 있을 때만 같은 행의 뒤쪽 프레임을 한 칸씩 민다. 크기가 바뀐 프레임은 이웃과 간격이
// 모자랄 때만 오른쪽·아래 프레임을 필요한 만큼 함께 민다. 다른 프레임은 움직이지 않는다.
interface Box { x: number; y: number; readonly width: number; readonly height: number }

// 두 상자가 간격(GAP)보다 가까운지
const crowded = (a: Box, b: Box) => a.x < b.x + b.width + GAP && b.x < a.x + a.width + GAP && a.y < b.y + b.height + GAP && b.y < a.y + a.height + GAP;
// 같은 행: 윗변이 화면 사이 간격보다 가까운 프레임
const sameRow = (a: Box, b: Box) => Math.abs(a.y - b.y) < GAP;

// 새 프레임(frame)을 Section의 기존 프레임(frames, 놓인 순서) 사이에 놓는다.
// after: 이 프레임 바로 다음 칸, null이면 Section 맨 앞, undefined면 맨 뒤.
// 맨 뒤는 마지막 프레임 오른쪽 칸이 비어 있고 한 행 COLUMNS개를 넘지 않으면 그 칸에, 아니면 가장 아래 프레임 밑에 새 행을 연다.
// 중간은 고른 프레임 오른쪽 칸이 비어 있으면 그 칸에 놓는다. 차 있거나 맨 앞이면 그 칸에 넣고 같은 행의 뒤쪽 프레임을 한 칸씩 민다
// (그 행만 COLUMNS개를 넘을 수 있다). 다른 행의 긴 화면이 내려와 막은 칸은 건너뛴다.
export function placeFrame(frames: readonly Box[], frame: Box, after: Box | null | undefined): void {
  if (!frames.length) { frame.x = PAD; frame.y = PAD; return; }
  const column = Math.max(...frames.map(f => f.width)) + GAP;
  if (after === undefined) {
    const last = frames[frames.length - 1];
    const cell = { x: last.x + column, y: last.y, width: frame.width, height: frame.height };
    if (Math.round((cell.x - PAD) / column) < COLUMNS && !frames.some(f => crowded(cell, f))) { frame.x = cell.x; frame.y = cell.y; return; }
    frame.x = Math.min(...frames.map(f => f.x));
    frame.y = Math.max(...frames.map(f => f.y + f.height)) + GAP;
    return;
  }
  if (after) {
    const cell = { x: after.x + column, y: after.y, width: frame.width, height: frame.height };
    if (!frames.some(f => crowded(cell, f))) { frame.x = cell.x; frame.y = cell.y; return; }
  }
  const lead = after ?? frames[0];
  const row = frames.filter(f => f !== after && sameRow(f, lead) && (after ? f.x > after.x : f.x >= lead.x)).sort((a, b) => a.x - b.x);
  const others = frames.filter(f => !row.includes(f));
  const blocked = (x: number, box: Box) => others.some(f => crowded({ x, y: lead.y, width: box.width, height: box.height }, f));
  let next = after ? after.x + column : lead.x;
  const moves: [Box, number][] = [[frame, next]];
  for (const f of row) moves.push([f, f.x + column]);
  for (const move of moves) {
    let x = Math.max(move[1], next);
    while (blocked(x, move[0])) x += column;
    move[1] = x;
    next = x + column;
  }
  frame.y = lead.y;
  for (const [box, x] of moves) box.x = x;
}

// 크기가 바뀐 프레임(before: 바뀌기 전 크기)이 이웃과 간격보다 가까워지면, 같은 높이대의 오른쪽 프레임과 그 아래 프레임을
// 각각 한 덩어리로 필요한 만큼 민다. 덩어리 안의 간격은 그대로이고, 간격이 넉넉하면 아무것도 움직이지 않는다.
// 미는 거리는 늘어난 크기까지다. 사용자가 간격보다 촘촘하게 둔 프레임은 그 간격을 유지한다.
export function makeRoom(frames: readonly Box[], frame: Box, before: { width: number; height: number }): void {
  const rest = frames.filter(f => f !== frame);
  const right = rest.filter(f => f.x >= frame.x + before.width && f.y < frame.y + frame.height && frame.y < f.y + f.height);
  const dx = Math.min(frame.width - before.width, Math.max(0, ...right.map(f => frame.x + frame.width + GAP - f.x)));
  if (dx > 0) for (const f of right) f.x += dx;
  const below = rest.filter(f => f.y >= frame.y + before.height);
  const dy = Math.min(frame.height - before.height, Math.max(0, ...below.filter(f => f.x < frame.x + frame.width && frame.x < f.x + f.width).map(f => frame.y + frame.height + GAP - f.y)));
  if (dy > 0) for (const f of below) f.y += dy;
}

export function fitSection(ns: string, section: SectionNode, exact = false): void {
  const kids = section.children;
  if (!kids.length) return;
  const right = Math.max(...kids.map(n => n.x + n.width)) + PAD;
  const bottom = Math.max(...kids.map(n => n.y + n.height)) + PAD;
  const width = exact ? right : Math.max(section.width, right);
  const height = exact ? bottom : Math.max(section.height, bottom);
  if (width === section.width && height === section.height) return;
  const before = section.y + section.height;
  section.resizeWithoutConstraints(width, height);
  pushSectionsBelow(ns, section, before);
}

// Section이 아래로 늘어나 아래 카테고리 Section과 가까워지면 아래 Section들을 함께 내려 간격을 유지한다.
function pushSectionsBelow(ns: string, section: SectionNode, before: number): void {
  const page = section.parent;
  if (!page || page.type !== 'PAGE') return;
  const below = page.children.filter(n => n !== section && n.type === 'SECTION' && !!n.getSharedPluginData(ns, CATEGORY_KEY) && n.y >= before);
  if (!below.length) return;
  const shift = section.y + section.height + SECTION_GAP - Math.min(...below.map(n => n.y));
  if (shift > 0) for (const n of below) n.y += shift;
}

// 복제한 템플릿 안의 컴포넌트(복제로 새로 생긴 메인 컴포넌트)를 원래 컴포넌트의 인스턴스로 바꾼다.
function instantiate(original: ChildrenMixin, copy: ChildrenMixin): void {
  const sources = [...original.children];
  const targets = [...copy.children];
  for (let i = 0; i < sources.length && i < targets.length; i++) {
    const source = sources[i], target = targets[i];
    if (source.type === 'COMPONENT') {
      const instance = source.createInstance();
      const parent = target.parent as BaseNode & ChildrenMixin;
      parent.insertChild(parent.children.indexOf(target), instance);
      if ('layoutPositioning' in target && target.layoutPositioning === 'ABSOLUTE') { instance.layoutPositioning = 'ABSOLUTE'; instance.x = target.x; instance.y = target.y; }
      else if (parent.type !== 'PAGE' && 'layoutMode' in parent && parent.layoutMode !== 'NONE') {
        const sized = target as FrameNode;
        instance.layoutSizingHorizontal = sized.layoutSizingHorizontal;
        instance.layoutSizingVertical = sized.layoutSizingVertical;
      } else { instance.x = target.x; instance.y = target.y; }
      target.remove();
    } else if ('children' in source && 'children' in target && source.type !== 'INSTANCE') {
      instantiate(source, target);
    }
  }
}

async function createFlipbook(ns: string, page: PageNode, template: FrameNode, view: FlipbookView): Promise<FrameNode> {
  const frame = template.clone();
  instantiate(template, frame);
  frame.name = view.name;
  frame.setSharedPluginData(ns, FLIPBOOK_KEY, view.flipbookId);
  frame.setSharedPluginData(ns, NODE_KEY, frame.id);
  // 템플릿 GUI 영역의 예시 내용은 비운다.
  const gui = parts(frame).gui;
  if (gui) for (const child of [...gui.children]) child.remove();

  const section = categorySection(ns, page, view.category);
  const frames = flipbookFrames(section, ns);
  section.appendChild(frame);
  // 만들기 목록에서 정한 자리: 지정한 플립북 바로 다음(null이면 맨 앞). 그 플립북이 Section에 없으면 맨 뒤에 둔다.
  const anchor = view.after ? frames.find(f => f.node.getSharedPluginData(ns, FLIPBOOK_KEY) === view.after) : undefined;
  placeFrame(frames, frame, view.after === null ? null : anchor);
  fitSection(ns, section);
  return frame;
}

// 목록에서 옮긴 기존 플립북(2026-10-22 사용자 요청)을 캔버스에서도 옮긴다. 새 플립북을 넣을 때와 같은 규칙이다:
// 그 Section의 정한 플립북(after) 바로 다음 칸(null이면 맨 앞)에 놓고, 칸이 차 있으면 같은 행의 뒤쪽 프레임만 민다.
// 빠진 자리는 정리하지 않고, 원래 Section은 빠진 만큼만 줄인다. 다른 페이지로도 옮긴다.
// 프레임을 찾지 못하면 false. 프레임 안의 UI 작성 내용은 함께 옮겨진다.
export async function moveFlipbookFrame(ns: string, move: { flipbookId: string; fromPageId: string; pageId: string; category: { key: string; name: string }; after: string | null }): Promise<boolean> {
  const from = await loadedPage(move.fromPageId);
  const frame = pageFlipbooks(ns, from).get(move.flipbookId);
  if (!frame) return false;
  const page = move.pageId === move.fromPageId ? from : await loadedPage(move.pageId);
  const target = categorySection(ns, page, move.category);
  const source = rootSection(frame);
  const frames = flipbookFrames(target, ns).filter(f => f.node !== frame);
  const anchor = move.after ? frames.find(f => f.node.getSharedPluginData(ns, FLIPBOOK_KEY) === move.after) : undefined;
  if (frame.parent !== target) target.appendChild(frame);
  placeFrame(frames, frame, move.after === null ? null : anchor);
  fitSection(ns, target);
  if (source && source !== target) fitSection(ns, source, true);
  return true;
}

// 플립북 ID → 플립북 프레임. 캔버스에서 플립북 프레임을 복제하면 복사본도 같은 플립북 ID를 가진다.
// 같은 ID의 프레임이 여럿이면 적어 둔 노드 ID가 자기와 같은 프레임(원본)을 고르고, 그런 프레임이 없으면(노드 ID를 적기 전 프레임) 먼저 놓인 프레임을 고른다.
// 고른 프레임에는 자기 노드 ID를 적어 다음에도 같은 프레임을 고르게 한다. 하나뿐인 프레임은 잘라 붙여 노드 ID가 바뀌었어도 그대로 플립북으로 본다.
export function pickFlipbookFrames<T extends { id: string; getSharedPluginData(ns: string, key: string): string; setSharedPluginData(ns: string, key: string, value: string): void }>(ns: string, frames: readonly T[]): Map<string, T> {
  const groups = new Map<string, T[]>();
  for (const n of frames) {
    const id = n.getSharedPluginData(ns, FLIPBOOK_KEY);
    if (!id) continue;
    const group = groups.get(id);
    if (group) group.push(n); else groups.set(id, [n]);
  }
  const out = new Map<string, T>();
  for (const [id, group] of groups) {
    const frame = group.find(n => n.getSharedPluginData(ns, NODE_KEY) === n.id) ?? group[0];
    if (frame.getSharedPluginData(ns, NODE_KEY) !== frame.id) frame.setSharedPluginData(ns, NODE_KEY, frame.id);
    out.set(id, frame);
  }
  return out;
}

function flipbookCandidates(ns: string, page: PageNode): FrameNode[] {
  return page.findAllWithCriteria({ types: ['FRAME'], sharedPluginData: { namespace: ns, keys: [FLIPBOOK_KEY] } });
}

function pageFlipbooks(ns: string, page: PageNode): Map<string, FrameNode> {
  return pickFlipbookFrames(ns, flipbookCandidates(ns, page));
}

// 여러 페이지의 플립북 ID → 플립북 프레임. 다른 플립북 페이지에 붙여 넣은 복사본도 함께 견준다.
export async function listFlipbooks(ns: string, pageIds: string[]): Promise<Map<string, string>> {
  const frames: FrameNode[] = [];
  for (const pageId of new Set(pageIds)) {
    const page = await figma.getNodeByIdAsync(pageId);
    if (!page || page.type !== 'PAGE') continue;
    await page.loadAsync();
    frames.push(...flipbookCandidates(ns, page));
  }
  return new Map([...pickFlipbookFrames(ns, frames)].map(([id, frame]) => [id, frame.id]));
}

// 플립북이 든 루트 Section에 표식이 없으면(캔버스에서 직접 만든 Section) 새 키를 붙여 플러그인 Section으로 본다. 같은 페이지에
// 같은 키의 루트 Section이 여럿이면(복제한 Section) 위쪽(같으면 왼쪽) Section만 그 키를 두고 나머지에 새 키를 붙인다(2026-10-23 사용자 결정).
// 표식만 붙이고 캔버스 배치는 바꾸지 않는다.
function pageFlipbookSpots(ns: string, page: PageNode, spots: Record<string, FlipbookSpot>): void {
  const seen = new Set<string>();
  let sectionIndex = 0;
  const roots = page.children.filter((n): n is SectionNode => n.type === 'SECTION').sort((a, b) => a.y - b.y || a.x - b.x);
  for (const section of roots) {
    const frames = flipbookFrames(section, ns);
    let key = section.getSharedPluginData(ns, CATEGORY_KEY);
    if (key ? seen.has(key) : frames.length) {
      key = newSectionKey();
      section.setSharedPluginData(ns, CATEGORY_KEY, key);
    }
    if (!key) continue;
    seen.add(key);
    frames.forEach((frame, index) => { spots[frame.node.id] = { pageId: page.id, section: key, sectionName: section.name, sectionIndex, index }; });
    sectionIndex++;
  }
}

// 연결 상태와 목록 위치를 같은 페이지 로드에서 읽는다.
export async function inspectFlipbooks(ns: string, pageIds: string[]): Promise<{ found: Map<string, string>; spots: Record<string, FlipbookSpot> }> {
  const frames: FrameNode[] = [];
  const spots: Record<string, FlipbookSpot> = {};
  for (const pageId of new Set(pageIds)) {
    const page = await figma.getNodeByIdAsync(pageId);
    if (!page || page.type !== 'PAGE') continue;
    await page.loadAsync();
    frames.push(...flipbookCandidates(ns, page));
    pageFlipbookSpots(ns, page, spots);
  }
  return { found: new Map([...pickFlipbookFrames(ns, frames)].map(([id, frame]) => [id, frame.id])), spots };
}

// 플립북 프레임의 캔버스 위치(노드 ID → 위치). 페이지 바로 아래의 플러그인 Section과 그 안의 플립북 프레임만 본다.
// Section은 위→아래(같으면 왼쪽부터), Section 안은 놓인 순서(위 행부터, 행 안에서는 왼쪽부터)다.
export async function flipbookSpots(ns: string, pageIds: string[]): Promise<Record<string, FlipbookSpot>> {
  const spots: Record<string, FlipbookSpot> = {};
  for (const pageId of new Set(pageIds)) {
    const page = await figma.getNodeByIdAsync(pageId);
    if (!page || page.type !== 'PAGE') continue;
    await page.loadAsync();
    pageFlipbookSpots(ns, page, spots);
  }
  return spots;
}

export async function findFlipbook(ns: string, pageId: string, flipbookId: string): Promise<FrameNode | null> {
  return pageFlipbooks(ns, await loadedPage(pageId)).get(flipbookId) ?? null;
}

// UI 작성 영역: Description 슬롯 안의 내용과 GUI 영역 위에 놓은 마커·콜아웃(GUI 복사본이 아닌 노드),
// 플립북 프레임에 절대 위치로 놓은 노드. 플러그인이 바꾸는 영역은 넣지 않는다.
export async function uiAreaSnapshot(snapshotter: Snapshotter, frame: FrameNode, ns = NS): Promise<NodeSnapshot> {
  const p = parts(frame);
  const children: NodeSnapshot[] = [];
  if (p.description && 'children' in p.description)
    children.push({ type: 'DESCRIPTION', props: {}, children: await Promise.all(p.description.children.map(c => snapshotter.snapshot(c))) });
  if (p.gui) for (const child of p.gui.children) if (!child.getSharedPluginData(ns, COPY_KEY)) children.push(await snapshotter.snapshot(child));
  for (const child of frame.children) if ('layoutPositioning' in child && child.layoutPositioning === 'ABSOLUTE') children.push(await snapshotter.snapshot(child));
  return { type: 'FLIPBOOK_UI', props: {}, children };
}

// ── 시스템 영역 ─────────────────────────────────────────

// 마커가 따라갈 화면: 다시 복사하기 전의 복사본 위치와 크기
interface Anchor { uid: string; x: number; y: number; width: number }
interface Point { x: number; y: number }
// 마커와 묶은 화면. d는 마커 중심이 그 화면 왼쪽 위에서 떨어진 거리(GUI 영역 기준), from은 묶을 때의 GUI 영역 위치다.
interface Pin { node: SceneNode; anchor: number; d: Point; from: Point; offset: () => Point }

// 복사본 표식(uid@버전)의 화면 uid
const uidOf = (key: string) => key.slice(0, key.lastIndexOf('@'));

// 마커 중심을 품은 화면, 없으면 가장 가까운 화면에 묶는다. offset은 마커 부모 좌표에서 본 GUI 영역 위치다.
function pinTo(node: SceneNode, anchors: Anchor[], heights: number[], offset: () => Point): Pin | null {
  if (!anchors.length) return null;
  const from = offset();
  const cx = node.x + node.width / 2 - from.x;
  const cy = node.y + node.height / 2 - from.y;
  const distance = (a: Anchor, i: number) => Math.hypot(Math.max(a.x - cx, 0, cx - a.x - a.width), Math.max(a.y - cy, 0, cy - a.y - heights[i]));
  let best = 0;
  for (let i = 1; i < anchors.length; i++) if (distance(anchors[i], i) < distance(anchors[best], best)) best = i;
  return { node, anchor: best, d: { x: cx - anchors[best].x, y: cy - anchors[best].y }, from, offset };
}

// GUI 영역 좌표(왼쪽 위)를 플립북 프레임에 놓인 노드의 부모 좌표 기준으로 구한다. 회전은 고려하지 않는다.
function areaOffset(area: FrameNode, parent: BaseNode & ChildrenMixin): Point {
  const a = area.absoluteTransform, p = (parent as unknown as FrameNode).absoluteTransform;
  return { x: a[0][2] - p[0][2], y: a[1][2] - p[1][2] };
}

// 선택 순서대로 GUI 원본의 레이어 복사본을 GUI 영역에 넣는다. 표식이 같으면 다시 복사하지 않는다.
// 복사본은 따로 보관하지 않고 원본에서 바로 복사한다(2026-10-20 사용자 결정).
// 글꼴이 없어 글자를 줄이지 못하면 알리고 표식을 남기지 않아 다음 반영 때 다시 복사한다.
// 마커는 크기를 두고 위치만 화면을 따라간다(2026-10-21 사용자 결정): 다시 복사한 같은 화면에서 같은 상대 위치에 놓는다.
// overlays는 플립북 프레임에 절대 위치로 놓은 노드다. 중심이 GUI 영역 안에 있는 것만 같은 방식으로 옮긴다.
export async function syncGui(ns: string, area: FrameNode, gui: FlipbookGui[], scale: FlipbookView['scale'], notes = new Set<string>(), width = SOURCE_WIDTH, overlays: SceneNode[] = []): Promise<void> {
  const signature = JSON.stringify(['rows-v7', width, gui.map(g => [g.key, g.scale ?? scale])]);
  const copies = area.children.filter(n => !!n.getSharedPluginData(ns, COPY_KEY));
  if (area.getSharedPluginData(ns, IMAGE_KEY) === signature && copies.length === gui.length &&
      copies.every((copy, i) => copy.getSharedPluginData(ns, COPY_KEY) === gui[i].key)) {
    for (const copy of copies) copy.locked = false;
    return;
  }
  // 저장한 배치 규칙과 크기가 같으면 버전이 바뀌지 않은 화면 복사본은 그대로 쓴다.
  // 이전 버전의 서명도 읽어 기존 플립북을 한꺼번에 다시 복사하지 않는다.
  let previous: unknown;
  try { previous = JSON.parse(area.getSharedPluginData(ns, IMAGE_KEY)); } catch { previous = null; }
  const oldRows = Array.isArray(previous) && (previous[0] === 'rows-v6' || previous[0] === 'rows-v7') && previous[1] === width
    && Array.isArray(previous[2]) && previous[2].length === copies.length ? previous[2] as [string, number][] : [];
  const reusable = new Map<string, FrameNode[]>();
  oldRows.forEach(([key, itemScale], i) => {
    if (!Array.isArray(oldRows[i]) || copies[i].type !== 'FRAME' || copies[i].getSharedPluginData(ns, COPY_KEY) !== key) return;
    const token = JSON.stringify([key, itemScale]);
    const bucket = reusable.get(token) ?? [];
    bucket.push(copies[i] as FrameNode);
    reusable.set(token, bucket);
  });
  const retained = new Set<SceneNode>();
  const placed: FrameNode[] = [];
  const missingFonts = new Set<string>();
  // 새 레이어를 별도 임시 프레임에서 모두 준비한다. 복사·글꼴 오류가 나면 기존 GUI는 그대로 남는다.
  let staging: FrameNode | null = null;
  try {
    for (const g of gui) {
      const token = JSON.stringify([g.key, g.scale ?? scale]);
      const existing = reusable.get(token)?.shift();
      if (existing) { retained.add(existing); placed.push(existing); continue; }
      const source = g.sourceNodeId ? await figma.getNodeByIdAsync(g.sourceNodeId) : null;
      if (!source || !('visible' in source)) throw new Error(`${COPY.figmaFlipbook023} ${g.code}`);
      staging ??= figma.createFrame();
      const copy = await copyLayers(ns, source as SceneNode, staging, g.key, `${g.code} GUI`);
      const fittedScale = Math.min(guiTargetWidth(width, g.scale ?? scale) / SOURCE_WIDTH, width / copy.width);
      if (fittedScale !== 1) for (const font of await rescaleExact(copy, fittedScale)) missingFonts.add(font);
      placed.push(copy);
    }
  } catch (error) {
    staging?.remove();
    throw error;
  }
  // 마커·콜아웃 등 사용자가 넣은 노드는 두고 이전 복사본만 바꾼다.
  const first = copies.length ? area.children.indexOf(copies[0]) : 0;
  const baseHeight = Number(area.getSharedPluginData(ns, GUI_BASE_HEIGHT_KEY)) || area.height;
  area.setSharedPluginData(ns, GUI_BASE_HEIGHT_KEY, String(baseHeight));
  // 크기를 바꾸기 전에 마커마다 따라갈 화면과 그 화면 안의 위치를 기록한다.
  const anchors: Anchor[] = copies.map(c => ({ uid: uidOf(c.getSharedPluginData(ns, COPY_KEY)), x: c.x, y: c.y, width: c.width }));
  const anchorHeights = copies.map(c => c.height);
  const origin = () => ({ x: 0, y: 0 });
  const pins = area.children.filter(n => !n.getSharedPluginData(ns, COPY_KEY)).map(n => pinTo(n, anchors, anchorHeights, origin));
  for (const node of overlays) {
    const parent = node.parent;
    if (!parent || !('absoluteTransform' in parent) || !('absoluteTransform' in area)) continue;
    const offset = () => areaOffset(area, parent as BaseNode & ChildrenMixin);
    const o = offset();
    const cx = node.x + node.width / 2 - o.x, cy = node.y + node.height / 2 - o.y;
    if (cx >= 0 && cx <= area.width && cy >= 0 && cy <= area.height) pins.push(pinTo(node, anchors, anchorHeights, offset));
  }
  // GUI 영역 폭은 설정한 1x 폭으로 맞춘다. 템플릿의 슬롯이 한 열 너비로 시작해도 같다.
  if (area.parent && 'layoutMode' in area.parent && area.parent.layoutMode !== 'NONE') area.layoutSizingHorizontal = 'FIXED';
  if (area.width !== width) area.resizeWithoutConstraints(width, area.height);
  const rowWidth = width;
  let x = 0;
  let y = 0;
  let height = 0;
  for (const old of copies) if (!retained.has(old)) old.remove();
  for (const [i, copy] of placed.entries()) {
    const at = Math.min(first + i, area.children.length);
    if (area.children[at] !== copy) area.insertChild(at, copy);
    if (x && x + copy.width > rowWidth + 0.01) {
      x = 0;
      y += height + GUI_GAP;
      height = 0;
    }
    if (area.layoutMode !== 'NONE') copy.layoutPositioning = 'ABSOLUTE';
    copy.x = x;
    copy.y = y;
    x += copy.width + GUI_GAP;
    height = Math.max(height, copy.height);
    copy.locked = false;
  }
  staging?.remove();
  // 이전 화면마다 새 복사본을 찾는다. 같은 화면이 여러 번 들어 있으면 놓인 순서대로 짝짓는다.
  const used = new Set<number>();
  const target = anchors.map(a => {
    const index = gui.findIndex((g, i) => !used.has(i) && g.uid === a.uid);
    if (index < 0) return null;
    used.add(index);
    return placed[index];
  });
  for (const pin of pins) {
    if (!pin) continue;
    const copy = target[pin.anchor];
    if (!copy) continue;
    const old = anchors[pin.anchor];
    const ratio = copy.width / old.width;
    const to = pin.offset();
    // 중심 이동량 = (새 화면 기준 위치 + 새 영역 위치) − (이전 화면 기준 위치 + 이전 영역 위치)
    const shiftX = copy.x + pin.d.x * ratio + to.x - (old.x + pin.d.x + pin.from.x);
    const shiftY = copy.y + pin.d.y * ratio + to.y - (old.y + pin.d.y + pin.from.y);
    if (Math.abs(shiftX) > 0.01) pin.node.x += shiftX;
    if (Math.abs(shiftY) > 0.01) pin.node.y += shiftY;
  }
  const markerBottom = area.children.filter(n => !n.getSharedPluginData(ns, COPY_KEY)).reduce((bottom, n) => Math.max(bottom, n.y + n.height), 0);
  const targetHeight = Math.max(baseHeight, markerBottom, y + height);
  if (area.height !== targetHeight) area.resizeWithoutConstraints(area.width, targetHeight);
  if (missingFonts.size) notes.add(`${COPY.figmaFlipbook026} ${[...missingFonts].join(', ')}`);
  area.setSharedPluginData(ns, IMAGE_KEY, missingFonts.size ? '' : signature);
}

// 상단 input-cell-id 슬롯에 Screen ID 태그(Team / Tag=System)를 화면 순서대로 넣는다.
async function syncIds(ns: string, cell: SceneNode, codes: string[], kit: TagKit): Promise<void> {
  if (!('children' in cell)) return;
  const signature = JSON.stringify(codes);
  if (cell.getSharedPluginData(ns, IDS_KEY) === signature) return;
  for (const child of [...cell.children]) child.remove();
  for (const code of codes) {
    const tag = kit.idTag.createInstance();
    tag.name = 'Screen ID';
    (cell as unknown as ChildrenMixin).appendChild(tag);
    await setText(tag.findOne(n => n.type === 'TEXT') as TextNode | null, code, kit.fonts);
  }
  cell.setSharedPluginData(ns, IDS_KEY, signature);
}

const isRow = (n: SceneNode): n is InstanceNode => n.type === 'INSTANCE' && n.name === 'Update History';
const isSystemRow = (n: InstanceNode) => n.componentProperties.isSystem?.value === 'true';

async function rowComponent(history: ChildrenMixin, template: FrameNode): Promise<ComponentNode> {
  const fromNode = async (root: ChildrenMixin) => {
    const row = findPart(root, n => isRow(n) && !isSystemRow(n)) as InstanceNode | null;
    return row ? row.getMainComponentAsync() : null;
  };
  const found = await fromNode(history) ?? await fromNode(template);
  if (!found) throw new Error(COPY.figmaFlipbook017);
  return found;
}

// 이력 행: 상태 태그·코멘트·팀·작업자·날짜. Screen ID·버전은 쓰지 않는다(2026-10-20 사용자 결정).
async function fillRow(row: InstanceNode, data: FlipbookRow, kit: TagKit, notes: Set<string>): Promise<void> {
  const textIn = (frameName: string) => row.findOne(n => n.type === 'TEXT' && n.parent?.name === frameName) as TextNode | null;
  await setText(textIn('Comment'), data.description, kit.fonts);
  await setText(textIn('Name'), data.worker, kit.fonts);
  await setText(textIn('Date'), data.at, kit.fonts);
  const status = row.findOne(n => n.type === 'INSTANCE' && n.name === 'Status') as InstanceNode | null;
  if (status) await applyTag(status, kit.small, kit, data.tag.name, data.colorKey);
  const team = row.findOne(n => n.type === 'INSTANCE' && n.name === 'Team') as InstanceNode | null;
  if (team && !(await setVariant(team, 'Tag', data.team))) notes.add(`${COPY.figmaFlipbook018}${data.team}${COPY.figmaFlipbook019}`);
}

// 최신 기록 1개는 목록 맨 위, 나머지는 Previous에 최신순으로 둔다. 템플릿의 시스템 행은 그대로 둔다.
export async function syncRows(ns: string, history: ChildrenMixin, settings: FlipbookSettings, rows: FlipbookRow[], kit: TagKit, notes: Set<string>): Promise<void> {
  const list = findPart(history, n => n.type === 'SLOT' && n.name === 'List') as SlotNode | null;
  if (!list) throw new Error(COPY.figmaFlipbook020);
  const previous = list.findChild(n => n.type === 'FRAME' && n.name === 'Previous') as FrameNode | null;
  const component = await rowComponent(history, kit.template);
  const stale = [...list.children, ...(previous?.children ?? [])].filter((n): n is InstanceNode => isRow(n) && !isSystemRow(n));
  const byKey = new Map(stale.map(n => [n.getSharedPluginData(ns, 'historyKey'), n]));
  const used = new Set<InstanceNode>();
  // 'hex': 색 변수로 칠했던 기존 행도 한 번 다시 칠해 변수 연결을 끊는다.
  const kitKey = JSON.stringify([component.id, kit.small.id, 'hex']);
  for (let i = 0; i < rows.length; i++) {
    const data = rows[i];
    const key = data.key;
    const row = byKey.get(key) ?? component.createInstance();
    const signature = sha256(JSON.stringify([data, kitKey]));
    try {
      if (settings.force || row.getSharedPluginData(ns, 'historyValue') !== signature) {
        const rowNotes = new Set<string>();
        await fillRow(row, data, kit, rowNotes);
        for (const note of rowNotes) notes.add(note);
        // 경고가 있는 행은 다음 반영 때 다시 시도한다.
        row.setSharedPluginData(ns, 'historyValue', rowNotes.size ? '' : signature);
      }
      row.setSharedPluginData(ns, 'historyKey', key);
      const parent = i > 0 && previous ? previous : list;
      const index = i > 0 && previous ? i - 1 : i;
      if (parent.children[index] !== row) parent.insertChild(index, row);
      if (row.layoutSizingHorizontal !== 'FILL') row.layoutSizingHorizontal = 'FILL';
      used.add(row);
    } catch (error) {
      if (!byKey.has(key)) row.remove();
      throw error;
    }
  }
  for (const row of stale) if (!used.has(row)) row.remove();
}

// 플러그인이 쓴 값이거나 템플릿 기본값일 때만 바꾼다. 사용자가 고친 값은 둔다.
// force: 사용자가 플러그인에서 직접 바꾼 값이라 캔버스에서 고친 값도 바꾼다.
async function setOwnedText(ns: string, node: TextNode | null, value: string, known: string[], kit: TagKit, key: string, force = false): Promise<void> {
  if (!node) return;
  const written = node.getSharedPluginData(ns, key);
  if (!force && node.characters !== written && !known.includes(node.characters)) return;
  await setText(node, value, kit.fonts);
  node.setSharedPluginData(ns, key, value);
}

export interface SyncResult { nodeId: string; notes: string[] }

// 플립북의 현재 기록으로 플립북 페이지를 맞춘다. 몇 번을 실행해도 같은 결과가 된다.
export async function syncFlipbook(ns: string, settings: FlipbookSettings, view: FlipbookView, session = flipbookSession()): Promise<SyncResult> {
  let page = session.pages.get(settings.pageId);
  if (!page) { page = await loadedPage(settings.pageId); session.pages.set(settings.pageId, page); }
  let frames = session.frames.get(settings.pageId);
  if (!frames) {
    frames = pageFlipbooks(ns, page);
    session.frames.set(settings.pageId, frames);
  }
  let kit = session.kits.get(settings.templateId);
  if (!kit) { kit = await tagKit(settings.templateId); session.kits.set(settings.templateId, kit); }
  const existing = frames.get(view.flipbookId);
  // 기록과 다른 Section에 있어도 옮기지 않는다. 기록이 캔버스를 따라간다(2026-10-23 사용자 결정).
  const frame = existing ?? await createFlipbook(ns, page, kit.template, view);
  frames.set(view.flipbookId, frame);
  const p = parts(frame);
  if (!p.titleText || !p.status || !p.history || !p.gui) throw new Error(COPY.figmaFlipbook021);
  frame.locked = false;
  p.gui.locked = false;
  const notes = new Set<string>();
  const before = { width: frame.width, height: frame.height };

  // 큰 제목과 Page title에는 같은 플립북 제목을 넣는다. 사용자가 직접 고친 제목은 바꾸지 않는다.
  // 컴포넌트에 적힌 기본 글자도 템플릿 기본값으로 본다. 컴포넌트의 기본 글자를 바꿔도 사용자가 고친 글자로 오인하지 않는다.
  const titleMain = p.title?.type === 'INSTANCE' ? await p.title.getMainComponentAsync() : null;
  const headerMain = p.header?.type === 'INSTANCE' ? await p.header.getMainComponentAsync() : null;
  const defaults = (node: TextNode | null) => (node ? [node.characters] : []);
  // 플러그인에서 제목을 바꾸면 캔버스에서 고친 제목도 새 제목으로 바꾸고, 프레임 이름도 맞춘다(2026-10-21 사용자 요청).
  await setOwnedText(ns, p.titleText, view.name, [...view.titleNames, ...defaults((titleMain?.findChild(n => n.type === 'TEXT') ?? null) as TextNode | null)], kit, 'flipbookTitle', view.retitle);
  await setOwnedText(ns, p.page, view.name, [...view.titleNames, '-', ...defaults(cellText(headerMain, 'input-cell-page'))], kit, 'flipbookTitle', view.retitle);
  if (view.retitle && frame.name !== view.name) frame.name = view.name;
  await setOwnedText(ns, p.chapter, view.category.name, ['-', ...defaults(cellText(headerMain, 'input-cell-chapter'))], kit, CHAPTER_KEY);
  if (view.status) await applyTag(p.status, kit.big, kit, view.status.tag.name, view.status.colorKey);
  if (p.ids) await syncIds(ns, p.ids, view.gui.map(g => g.code), kit);
  const overlays = frame.children.filter(n => 'layoutPositioning' in n && n.layoutPositioning === 'ABSOLUTE');
  await syncGui(ns, p.gui, view.gui, view.scale, notes, view.guiWidth, overlays);
  await syncRows(ns, p.history, settings, view.rows, kit, notes);

  // 이미지·이력 길이에 따라 크기가 바뀐다. 크기가 바뀌면 이웃 화면과 겹치지 않게 필요한 만큼만 민다.
  // 이웃은 루트 Section 전체(안의 Section 포함)에서 찾고, 프레임을 담은 Section부터 루트 Section까지 크기를 맞춘다.
  const root = rootSection(frame);
  if (root) {
    const frames = flipbookFrames(root, ns);
    const self = frames.find(f => f.node === frame);
    if (self && (frame.width !== before.width || frame.height !== before.height)) makeRoom(frames, self, before);
    for (let s = frame.parent; s?.type === 'SECTION'; s = s.parent) fitSection(ns, s);
  }
  return { nodeId: frame.id, notes: [...notes] };
}
