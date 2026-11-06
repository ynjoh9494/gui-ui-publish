import { COPY } from '../core/copy.ts';
import { FLOW_LAYOUT, layoutFlow, type FlowPlan, type FlowThumb, type FoundFlowCell } from '../core/flow.ts';
import { formatFrameName } from '../core/screenName.ts';
import { loadPages } from './flipbook.ts';
import { loadThumbnailPage } from './thumbs.ts';

// 플로우(2026-10-23 사용자 결정). 썸네일은 GUI 배포 때 만든 이미지를 그대로 채우고, 다시 배포되면 그 채움만 바꾼다.
// 예시의 레이어 구조를 따른다: 플로우·화면·Connector 모두 그룹이고(배경 없음, 크기를 바꾸면 화살표도 함께 늘어난다),
// Inter 글자를 쓴다. 플러그인은 만든 뒤 내용을 고치지 않는다. 사용자는 만든 뒤 그룹을 풀거나 옮기는 등 얼마든지 고치므로
// 그 뒤로는 그룹이 아니라 썸네일 칸의 표식(flowOf·flowScreen)으로 찾는다(2026-11-05 사용자 결정).

const FLOW_KEY = 'flowOf';
const SCREEN_KEY = 'flowScreen';
const VERSION_KEY = 'flowVersion';
// 썸네일이 없을 때 이미지 대신 두는 안내 글자. 썸네일을 채우면 지운다.
const EMPTY_KEY = 'flowEmpty';
// 글자·화살표 색 #333333. 안내 글자도 불투명도 100%로 쓴다(2026-10-27 사용자 요청: 빨강 #ff0000·50%에서 바꿈).
const INK: RGB = { r: 0.2, g: 0.2, b: 0.2 };
const gray = (l: number): SolidPaint[] => [{ type: 'SOLID', color: { r: l, g: l, b: l } }];
const imageFill = (hash: string): ImagePaint[] => [{ type: 'IMAGE', imageHash: hash, scaleMode: 'FIT' }];

function text(parent: ChildrenMixin, font: FontName, chars: string, size: number, name: string, width?: number, align: 'LEFT' | 'CENTER' | 'RIGHT' = 'LEFT'): TextNode {
  const t = figma.createText();
  parent.appendChild(t);
  t.fontName = font;
  t.fontSize = size;
  t.characters = chars;
  t.fills = [{ type: 'SOLID', color: INK }];
  t.lineHeight = { unit: 'PERCENT', value: 130 };
  t.name = name;
  if (width) {
    t.resize(Math.max(1, width), t.height);
    t.textAutoResize = 'HEIGHT';
    t.textAlignHorizontal = align;
  } else t.textAutoResize = 'WIDTH_AND_HEIGHT';
  return t;
}

// Figma Stroke End Point의 Triangle arrow(ARROW_EQUILATERAL)를 도착점에만 설정한다.
async function arrowLine(parent: ChildrenMixin, points: [number, number][]): Promise<VectorNode> {
  const minX = Math.min(...points.map(p => p[0])), minY = Math.min(...points.map(p => p[1]));
  const v = figma.createVector();
  parent.appendChild(v);
  // 경로를 넣지 못하면 부른 쪽의 정리 목록에 들어가기 전이므로 여기서 지운다.
  try {
    await v.setVectorNetworkAsync({
      vertices: points.map((point, index) => ({ x: point[0] - minX, y: point[1] - minY, strokeCap: index === points.length - 1 ? 'ARROW_EQUILATERAL' : 'NONE' })),
      segments: points.slice(1).map((_, index) => ({ start: index, end: index + 1 })),
    });
  } catch (e) {
    v.remove();
    throw e;
  }
  v.x = minX;
  v.y = minY;
  return v;
}

// 플러그인 창에서 정한 자리에 화면을 제 썸네일 크기로 놓고, 같은 규칙(core/flow.ts)으로 꺾인 화살표를 그린다.
// 썸네일 크기는 기록된 크기이고, 썸네일이 없는 화면은 1920×1080의 1/4 자리를 쓴다(core/flow.ts flowImageSize).
export async function createFlow(ns: string, plan: FlowPlan): Promise<{ nodeId: string; pageId: string; notes: string[] }> {
  const L = FLOW_LAYOUT;
  const fonts = { regular: { family: 'Inter', style: 'Regular' }, bold: { family: 'Inter', style: 'Bold' } } satisfies { regular: FontName; bold: FontName };
  await Promise.all([figma.loadFontAsync(fonts.regular), figma.loadFontAsync(fonts.bold)]);
  // 썸네일 이미지는 썸네일 페이지에 있으므로 그 페이지를 불러와야 해시로 찾을 수 있다.
  await loadThumbnailPage(ns);
  const missing: string[] = [];
  const thumbs = plan.cells.map(cell => {
    const ok = !!cell.thumb && !!figma.getImageByHash(cell.thumb.hash);
    if (!ok) missing.push(cell.code || cell.name);
    return ok ? cell.thumb! : null;
  });
  const page = figma.currentPage;
  // 그룹은 자식이 있어야 만들 수 있으므로 페이지에 절대 위치로 놓은 뒤 화면·Connector·플로우 순서로 묶는다.
  // 레이어 순서도 예시와 같게 위에서부터 Connector, 화면, 플로우 제목이다(나중에 만든 노드가 위).
  const made: SceneNode[] = [];
  let root: GroupNode | null = null;
  try {
    const layout = layoutFlow(plan.cells, plan.links);
    // 지금 보고 있는 곳 가운데에 놓는다.
    const center = figma.viewport.center;
    const ox = Math.round(center.x - layout.width / 2), oy = Math.round(center.y - layout.height / 2);
    const heading = text(page, fonts.bold, plan.title, L.titleSize, COPY.flow045);
    heading.x = ox + L.pad;
    heading.y = oy + L.pad;
    made.push(heading);
    const cards = plan.cells.map((cell, i) => {
      const image = layout.images.get(cell.key)!;
      const x = ox + image.x, y = oy + image.y;
      const parts: SceneNode[] = [];
      const title = text(page, fonts.bold, COPY.flow012, L.cellTitleSize, COPY.flow041);
      title.x = x;
      title.y = y - L.cellTitle;
      parts.push(title);
      const rect = figma.createRectangle();
      page.appendChild(rect);
      rect.name = COPY.flow016;
      rect.resize(image.w, image.h);
      rect.x = x;
      rect.y = y;
      rect.strokes = gray(0.475);
      rect.strokeWeight = 1;
      rect.setSharedPluginData(ns, SCREEN_KEY, cell.uid);
      // 칸이 제 플로우를 기억한다. 그룹을 풀거나 옮겨도 칸으로 찾는다(2026-11-05 사용자 결정).
      rect.setSharedPluginData(ns, FLOW_KEY, plan.id);
      parts.push(rect);
      const thumb = thumbs[i];
      if (thumb) {
        rect.fills = imageFill(thumb.hash);
        rect.setSharedPluginData(ns, VERSION_KEY, String(cell.version));
      } else {
        rect.fills = gray(0.86);
        const note = text(page, fonts.regular, COPY.flow005, L.captionSize, COPY.flow005, image.w, 'CENTER');
        note.x = x;
        note.y = rect.y + (image.h - note.height) / 2;
        note.setSharedPluginData(ns, EMPTY_KEY, rect.id);
        parts.push(note);
      }
      const caption = text(page, fonts.regular, COPY.flow013, L.captionSize, COPY.flow042);
      caption.x = x;
      caption.y = rect.y + image.h + L.captionGap;
      parts.push(caption);
      made.push(...parts);
      const card = figma.group(parts, page);
      card.name = formatFrameName(cell.code, cell.name);
      return card;
    });
    const connectors: GroupNode[] = [];
    for (const arrow of layout.arrows) {
      const line = await arrowLine(page, arrow.points.map(([px, py]) => [ox + px, oy + py]));
      made.push(line);
      line.fills = [];
      line.strokes = [{ type: 'SOLID', color: INK }];
      line.strokeWeight = L.line;
      line.name = COPY.flow015;
      const spot = arrow.label;
      const label = text(page, fonts.regular, COPY.flow014, L.labelSize, COPY.flow043);
      made.push(label);
      label.x = ox + (spot.align === 'right' ? spot.x + spot.width - label.width : spot.x);
      label.y = oy + (spot.anchor === 'bottom' ? spot.y - label.height : spot.y);
      const connector = figma.group([line, label], page);
      connector.name = COPY.flow044;
      connectors.push(connector);
    }
    root = figma.group([heading, ...cards, ...connectors], page);
    root.name = plan.title;
    root.setSharedPluginData(ns, FLOW_KEY, plan.id);
  } catch (e) {
    if (root && !root.removed) root.remove();
    for (const node of made) if (!node.removed) node.remove();
    throw e;
  }
  figma.currentPage.selection = [root];
  figma.viewport.scrollAndZoomIntoView([root]);
  return { nodeId: root.id, pageId: page.id, notes: missing.length ? [`${COPY.flow011} ${missing.join(', ')}`] : [] };
}

function pageOf(node: BaseNode): PageNode | null {
  let current: BaseNode | null = node;
  while (current && current.type !== 'PAGE') current = current.parent;
  return current as PageNode | null;
}

const CELL_CRITERIA = (ns: string) => ({ types: ['RECTANGLE'] as 'RECTANGLE'[], sharedPluginData: { namespace: ns, keys: [SCREEN_KEY] } });

// 칸 하나만 품은 화면 그룹(제목·이미지·설명). 그룹을 풀었거나 여러 칸을 함께 묶었으면 null
function cardOf(ns: string, rect: SceneNode, root: BaseNode | null): GroupNode | null {
  const parent = rect.parent;
  return parent && parent !== root && parent.type === 'GROUP' && parent.findAllWithCriteria(CELL_CRITERIA(ns)).length === 1 ? parent : null;
}

// 칸 하나를 읽는다(2026-11-05 사용자 결정: 플로우는 그룹이 아니라 칸으로 기억한다). 칸에 플로우 ID가 없으면(이 변경 전에 만든 플로우)
// 그 칸을 품은 플로우 그룹의 표식을 칸에 옮겨 적는다. 그 뒤에는 그룹을 풀거나 다시 묶거나 옮겨도 칸이 제 플로우를 기억한다.
// 플로우를 알 수 없는 칸은 null이다.
function readCell(ns: string, rect: SceneNode, page: PageNode): FoundFlowCell | null {
  const uid = rect.getSharedPluginData(ns, SCREEN_KEY);
  const own = rect.getSharedPluginData(ns, FLOW_KEY);
  let flowId = own;
  let root: BaseNode | null = null;
  for (let n = rect.parent; n && n.type !== 'PAGE'; n = n.parent) {
    const mark = n.getSharedPluginData(ns, FLOW_KEY);
    if (mark && (!flowId || mark === flowId)) { flowId = mark; root = n; break; }
  }
  if (!uid || !flowId) return null;
  if (!own) rect.setSharedPluginData(ns, FLOW_KEY, flowId);
  return { nodeId: rect.id, pageId: page.id, flowId, uid, cardId: (cardOf(ns, rect, root) ?? rect).id, rootId: root?.id ?? null, title: root && 'name' in root ? root.name : null };
}

// 페이지들(null이면 모든 페이지)에서 플로우 화면 칸을 찾는다.
export async function scanFlowCells(ns: string, pageIds: string[] | null): Promise<FoundFlowCell[]> {
  const ids = pageIds ?? figma.root.children.filter(page => !page.isPageDivider).map(page => page.id);
  const out: FoundFlowCell[] = [];
  for (const page of await loadPages(ids)) {
    for (const rect of page.findAllWithCriteria(CELL_CRITERIA(ns))) {
      const cell = readCell(ns, rect, page);
      if (cell) out.push(cell);
    }
  }
  return out;
}

// 캔버스에서 새로 생긴 노드(붙여 넣기·복제) 안의 플로우 칸. 부모와 그 안의 노드가 함께 와도 칸은 한 번씩만 읽는다.
export async function createdFlowCells(ns: string, nodeIds: string[]): Promise<FoundFlowCell[]> {
  const nodes = await Promise.all([...new Set(nodeIds)].map(id => figma.getNodeByIdAsync(id)));
  const out: FoundFlowCell[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    if (!node || node.removed || node.type === 'PAGE' || node.type === 'DOCUMENT') continue;
    const page = pageOf(node);
    if (!page) continue;
    const rects = node.type === 'RECTANGLE' ? [node] : 'findAllWithCriteria' in node ? node.findAllWithCriteria(CELL_CRITERIA(ns)) : [];
    for (const rect of rects) {
      if (seen.has(rect.id)) continue;
      seen.add(rect.id);
      const cell = readCell(ns, rect, page);
      if (cell) out.push(cell);
    }
  }
  return out;
}

// 「썸네일 없음」 글자: 그 글자가 가리던 사각형 ID로 찾는다. 잘라 붙여 사각형 ID가 바뀌었어도 그 칸 하나만 품은 화면 그룹 안의 글자는 그 칸의 것이다.
function emptyNotes(ns: string, rect: SceneNode): SceneNode[] {
  const parent = rect.parent;
  if (!parent || !('findAllWithCriteria' in parent)) return [];
  const card = !!cardOf(ns, rect, null);
  return parent.findAllWithCriteria({ types: ['TEXT'], sharedPluginData: { namespace: ns, keys: [EMPTY_KEY] } })
    .filter(note => card || note.getSharedPluginData(ns, EMPTY_KEY) === rect.id);
}

// 다시 배포된 화면의 칸(cellIds) 썸네일만 바꾼다. 바꾼 칸 수. 칸 크기와 화살표는 그대로 두고, 비율이 바뀐 이미지는 칸 안에 맞춘다(FIT).
export async function updateFlowCells(ns: string, cellIds: string[], thumbs: FlowThumb[]): Promise<number> {
  await loadThumbnailPage(ns);
  const latest = new Map(thumbs.map(t => [t.uid, t]));
  // 교체해 사용 안 함이 된 화면의 칸은 이어받은 화면으로 읽는다. 버전은 화면마다 따로 매기므로 옛 칸은 처음 넣는 것으로 본다.
  for (const t of thumbs) for (const uid of t.formerUids ?? []) if (!latest.has(uid)) latest.set(uid, t);
  let changed = 0;
  for (const rect of await Promise.all(cellIds.map(id => figma.getNodeByIdAsync(id)))) {
    if (!rect || rect.removed || rect.type !== 'RECTANGLE') continue;
    const uid = rect.getSharedPluginData(ns, SCREEN_KEY);
    const next = latest.get(uid);
    const former = !!next && next.uid !== uid;
    if (!next || (!former && Number(rect.getSharedPluginData(ns, VERSION_KEY) || 0) >= next.version) || !figma.getImageByHash(next.thumb.hash)) continue;
    rect.fills = imageFill(next.thumb.hash);
    if (former) rect.setSharedPluginData(ns, SCREEN_KEY, next.uid);
    rect.setSharedPluginData(ns, VERSION_KEY, String(next.version));
    for (const note of emptyNotes(ns, rect)) note.remove();
    changed++;
  }
  return changed;
}
