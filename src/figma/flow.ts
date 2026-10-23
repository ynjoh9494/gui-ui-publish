import { COPY } from '../core/copy.ts';
import { FLOW_DUMMY, FLOW_LAYOUT, layoutFlow, type FlowPlan, type FlowThumb } from '../core/flow.ts';
import { formatFrameName } from '../core/screenName.ts';
import type { FlowRecord } from '../core/types.ts';
import { loadThumbnailPage } from './thumbs.ts';

// 플로우 프레임(2026-10-23 사용자 결정). 썸네일은 GUI 배포 때 만든 이미지를 그대로 채우고, 다시 배포되면 그 채움만 바꾼다.
// 예시의 화면·연결선별 레이어 구조와 Inter·반투명 빨간 안내 글자를 따른다. 플러그인은 만든 뒤 내용을 고치지 않는다.

const FLOW_KEY = 'flowOf';
const SCREEN_KEY = 'flowScreen';
const VERSION_KEY = 'flowVersion';
// 썸네일이 없을 때 이미지 대신 두는 안내 글자. 썸네일을 채우면 지운다.
const EMPTY_KEY = 'flowEmpty';
// 썸네일이 없는 화면(이 기능 전에 배포한 화면 등)의 자리 크기: 1920×1080의 1/4
const PLACEHOLDER = { width: 480, height: 270 };
const INK: RGB = { r: 0.2, g: 0.2, b: 0.2 };
const gray = (l: number): SolidPaint[] => [{ type: 'SOLID', color: { r: l, g: l, b: l } }];
const imageFill = (hash: string): ImagePaint[] => [{ type: 'IMAGE', imageHash: hash, scaleMode: 'FIT' }];

function text(parent: FrameNode, font: FontName, chars: string, size: number, name: string, width?: number, align: 'LEFT' | 'CENTER' | 'RIGHT' = 'LEFT', color: RGB = INK, opacity = 1): TextNode {
  const t = figma.createText();
  parent.appendChild(t);
  t.fontName = font;
  t.fontSize = size;
  t.characters = chars;
  t.fills = [{ type: 'SOLID', color, opacity }];
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
async function arrowLine(parent: FrameNode, points: [number, number][]): Promise<VectorNode> {
  const minX = Math.min(...points.map(p => p[0])), minY = Math.min(...points.map(p => p[1]));
  const v = figma.createVector();
  parent.appendChild(v);
  await v.setVectorNetworkAsync({
    vertices: points.map((point, index) => ({ x: point[0] - minX, y: point[1] - minY, strokeCap: index === points.length - 1 ? 'ARROW_EQUILATERAL' : 'NONE' })),
    segments: points.slice(1).map((_, index) => ({ start: index, end: index + 1 })),
  });
  v.x = minX;
  v.y = minY;
  return v;
}

// 플러그인 창에서 정한 격자 칸에 화면을 놓고, 같은 규칙(core/flow.ts)으로 통로를 따라 꺾인 화살표를 그린다.
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
  const frame = figma.createFrame();
  try {
    frame.name = plan.title;
    frame.fills = gray(1);
    frame.clipsContent = false;
    frame.setSharedPluginData(ns, FLOW_KEY, plan.id);
    page.appendChild(frame);
    const sizes = thumbs.map(t => t ? { w: t.width, h: t.height } : { w: PLACEHOLDER.width, h: PLACEHOLDER.height });
    const cellW = Math.max(...sizes.map(s => s.w));
    const imageH = Math.max(...sizes.map(s => s.h));
    const measure = text(frame, fonts.regular, COPY.flow013, L.captionSize, COPY.flow042, undefined, 'LEFT', FLOW_DUMMY, 0.5);
    const cellH = L.cellTitle + imageH + L.captionGap + measure.height;
    measure.remove();
    const layout = layoutFlow(plan.cells, plan.links, { w: cellW, h: cellH });
    frame.resize(layout.width, layout.height);
    const g = layout.grid;
    plan.cells.forEach((cell, i) => {
      const x = g.x0 + cell.c * (g.cellW + g.gapX), y = g.y0 + cell.r * (g.cellH + g.gapY);
      const card = figma.createFrame();
      frame.appendChild(card);
      card.name = formatFrameName(cell.code, cell.name);
      card.resize(cellW, cellH);
      card.x = x;
      card.y = y;
      card.fills = [];
      card.clipsContent = false;
      const title = text(card, fonts.bold, COPY.flow012, L.cellTitleSize, COPY.flow041, undefined, 'LEFT', FLOW_DUMMY, 0.5);
      title.x = 0;
      title.y = 0;
      const rect = figma.createRectangle();
      card.appendChild(rect);
      rect.name = COPY.flow016;
      rect.resize(sizes[i].w, sizes[i].h);
      rect.x = 0;
      rect.y = L.cellTitle;
      rect.strokes = gray(0.475);
      rect.strokeWeight = 1;
      rect.setSharedPluginData(ns, SCREEN_KEY, cell.uid);
      const thumb = thumbs[i];
      if (thumb) {
        rect.fills = imageFill(thumb.hash);
        rect.setSharedPluginData(ns, VERSION_KEY, String(cell.version));
      } else {
        rect.fills = gray(0.86);
        const note = text(card, fonts.regular, COPY.flow005, L.captionSize, COPY.flow005, sizes[i].w, 'CENTER');
        note.x = 0;
        note.y = rect.y + (sizes[i].h - note.height) / 2;
        note.setSharedPluginData(ns, EMPTY_KEY, rect.id);
      }
      const caption = text(card, fonts.regular, COPY.flow013, L.captionSize, COPY.flow042, undefined, 'LEFT', FLOW_DUMMY, 0.5);
      caption.x = 0;
      caption.y = rect.y + sizes[i].h + L.captionGap;
    });
    for (const arrow of layout.arrows) {
      const connector = figma.createFrame();
      frame.appendChild(connector);
      connector.name = COPY.flow044;
      connector.fills = [];
      connector.clipsContent = false;
      const line = await arrowLine(connector, arrow.points);
      line.fills = [];
      line.strokes = [{ type: 'SOLID', color: INK }];
      line.strokeWeight = L.line;
      line.name = COPY.flow015;
      const spot = arrow.label;
      const label = text(connector, fonts.regular, COPY.flow014, L.labelSize, COPY.flow043, undefined, 'LEFT', FLOW_DUMMY, 0.5);
      label.x = spot.align === 'right' ? spot.x + spot.width - label.width : spot.x;
      label.y = spot.anchor === 'bottom' ? spot.y - label.height : spot.y;
      const left = Math.min(line.x, label.x), top = Math.min(line.y, label.y);
      const right = Math.max(line.x + line.width, label.x + label.width), bottom = Math.max(line.y + line.height, label.y + label.height);
      connector.resize(Math.max(1, right - left), Math.max(1, bottom - top));
      connector.x = left;
      connector.y = top;
      line.x -= left;
      line.y -= top;
      label.x -= left;
      label.y -= top;
    }
    const heading = text(frame, fonts.bold, plan.title, L.titleSize, COPY.flow045);
    heading.x = L.pad;
    heading.y = L.pad;
    // 지금 보고 있는 곳 가운데에 놓는다.
    const center = figma.viewport.center;
    frame.x = Math.round(center.x - frame.width / 2);
    frame.y = Math.round(center.y - frame.height / 2);
  } catch (e) {
    if (!frame.removed) frame.remove();
    throw e;
  }
  figma.currentPage.selection = [frame];
  figma.viewport.scrollAndZoomIntoView([frame]);
  return { nodeId: frame.id, pageId: page.id, notes: missing.length ? [`${COPY.flow011} ${missing.join(', ')}`] : [] };
}

function pageOf(node: BaseNode): PageNode | null {
  let current: BaseNode | null = node;
  while (current && current.type !== 'PAGE') current = current.parent;
  return current as PageNode | null;
}

// 다시 배포된 화면의 썸네일만 바꾼다. 프레임을 찾지 못하면 null(기록을 지운다), 아니면 바꾼 썸네일 수.
// 칸 크기와 화살표는 그대로 두고, 비율이 바뀐 이미지는 칸 안에 맞춘다(FIT).
export async function updateFlow(ns: string, flow: FlowRecord, thumbs: FlowThumb[]): Promise<number | null> {
  const node = await figma.getNodeByIdAsync(flow.nodeId);
  if (!node || node.removed || node.type !== 'FRAME' || node.getSharedPluginData(ns, FLOW_KEY) !== flow.id) return null;
  await pageOf(node)?.loadAsync();
  await loadThumbnailPage(ns);
  const latest = new Map(thumbs.map(t => [t.uid, t]));
  let changed = 0;
  for (const rect of node.findAllWithCriteria({ types: ['RECTANGLE'], sharedPluginData: { namespace: ns, keys: [SCREEN_KEY] } })) {
    const next = latest.get(rect.getSharedPluginData(ns, SCREEN_KEY));
    if (!next || Number(rect.getSharedPluginData(ns, VERSION_KEY) || 0) >= next.version || !figma.getImageByHash(next.thumb.hash)) continue;
    rect.fills = imageFill(next.thumb.hash);
    rect.setSharedPluginData(ns, VERSION_KEY, String(next.version));
    for (const note of node.findAllWithCriteria({ types: ['TEXT'], sharedPluginData: { namespace: ns, keys: [EMPTY_KEY] } }))
      if (note.getSharedPluginData(ns, EMPTY_KEY) === rect.id) note.remove();
    changed++;
  }
  return changed;
}
