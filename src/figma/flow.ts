import { COPY } from '../core/copy.ts';
import { FLOW_LAYOUT, layoutFlow, type FlowPlan, type FlowThumb } from '../core/flow.ts';
import { formatFrameName } from '../core/screenName.ts';
import type { FlowRecord } from '../core/types.ts';
import { loadThumbnailPage } from './thumbs.ts';

// 플로우(2026-10-23 사용자 결정). 썸네일은 GUI 배포 때 만든 이미지를 그대로 채우고, 다시 배포되면 그 채움만 바꾼다.
// 예시의 레이어 구조를 따른다: 플로우·화면·Connector 모두 그룹이고(배경 없음, 크기를 바꾸면 화살표도 함께 늘어난다),
// Inter 글자를 쓴다. 플러그인은 만든 뒤 내용을 고치지 않는다.

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

// 기록의 플로우 그룹. 표식이 다르면(지운 뒤 다른 노드가 같은 ID를 얻은 경우 등) 없는 것으로 본다. 복제한 플로우는 기록의 노드 ID가 아니므로 찾지 않는다.
async function findFlow(ns: string, flow: FlowRecord): Promise<GroupNode | FrameNode | null> {
  const node = await figma.getNodeByIdAsync(flow.nodeId);
  // 이 변경 전에 만든 플로우는 프레임이다.
  if (!node || node.removed || (node.type !== 'GROUP' && node.type !== 'FRAME') || node.getSharedPluginData(ns, FLOW_KEY) !== flow.id) return null;
  return node;
}

// 다시 배포된 화면의 썸네일만 바꾼다. 플로우 그룹을 찾지 못하면 null(기록을 지운다), 아니면 바꾼 썸네일 수.
// 칸 크기와 화살표는 그대로 두고, 비율이 바뀐 이미지는 칸 안에 맞춘다(FIT).
export async function updateFlow(ns: string, flow: FlowRecord, thumbs: FlowThumb[]): Promise<number | null> {
  const node = await findFlow(ns, flow);
  if (!node) return null;
  await pageOf(node)?.loadAsync();
  await loadThumbnailPage(ns);
  const latest = new Map(thumbs.map(t => [t.uid, t]));
  // 「썸네일 없음」 글자는 그 글자가 가리던 사각형 ID로 찾는다. 사각형마다 플로우 전체를 다시 찾지 않는다.
  const notes = new Map<string, TextNode[]>();
  for (const note of node.findAllWithCriteria({ types: ['TEXT'], sharedPluginData: { namespace: ns, keys: [EMPTY_KEY] } })) {
    const rectId = note.getSharedPluginData(ns, EMPTY_KEY);
    notes.set(rectId, [...(notes.get(rectId) ?? []), note]);
  }
  let changed = 0;
  for (const rect of node.findAllWithCriteria({ types: ['RECTANGLE'], sharedPluginData: { namespace: ns, keys: [SCREEN_KEY] } })) {
    const next = latest.get(rect.getSharedPluginData(ns, SCREEN_KEY));
    if (!next || Number(rect.getSharedPluginData(ns, VERSION_KEY) || 0) >= next.version || !figma.getImageByHash(next.thumb.hash)) continue;
    rect.fills = imageFill(next.thumb.hash);
    rect.setSharedPluginData(ns, VERSION_KEY, String(next.version));
    for (const note of notes.get(rect.id) ?? []) note.remove();
    changed++;
  }
  return changed;
}

// 플로우 목록에서 누른 플로우(uid가 있으면 그 화면 칸)의 노드 ID. 화면 칸을 캔버스에서 지웠으면 플로우 그룹으로 간다.
export async function flowNode(ns: string, flow: FlowRecord, uid?: string): Promise<string | null> {
  const node = await findFlow(ns, flow);
  if (!node) return null;
  if (!uid) return node.id;
  await pageOf(node)?.loadAsync();
  const rect = node.findOne(n => n.type === 'RECTANGLE' && n.getSharedPluginData(ns, SCREEN_KEY) === uid);
  // 칸은 제목·이미지·설명을 묶은 그룹이다.
  return (rect?.parent && rect.parent !== node ? rect.parent.id : rect?.id) ?? node.id;
}
