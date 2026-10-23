import { COPY } from '../core/copy.ts';
import { FLOW_DUMMY, FLOW_LAYOUT, layoutFlow, type FlowPlan, type FlowThumb } from '../core/flow.ts';
import { formatFrameName } from '../core/screenName.ts';
import type { FlowRecord } from '../core/types.ts';
import { loadFonts } from './data.ts';
import { loadThumbnailPage } from './thumbs.ts';

// 플로우 프레임(2026-10-23 사용자 결정). 썸네일은 GUI 배포 때 만든 이미지를 그대로 채우고, 다시 배포되면 그 채움만 바꾼다.
// 제목·설명·조건은 빨간(#ff0000) 더미 글자 레이어만 만들고 플러그인은 그 뒤 내용을 고치지 않는다.

const FLOW_KEY = 'flowOf';
const SCREEN_KEY = 'flowScreen';
const VERSION_KEY = 'flowVersion';
// 썸네일이 없을 때 이미지 대신 두는 안내 글자. 썸네일을 채우면 지운다.
const EMPTY_KEY = 'flowEmpty';
// 썸네일이 없는 화면(이 기능 전에 배포한 화면 등)의 자리 크기: 1920×1080의 1/4
const PLACEHOLDER = { width: 480, height: 270 };
const INK: RGB = { r: 0.1, g: 0.1, b: 0.1 };
const gray = (l: number): SolidPaint[] => [{ type: 'SOLID', color: { r: l, g: l, b: l } }];
const imageFill = (hash: string): ImagePaint[] => [{ type: 'IMAGE', imageHash: hash, scaleMode: 'FIT' }];

function text(parent: FrameNode, font: FontName, chars: string, size: number, name: string, width?: number, align: 'LEFT' | 'CENTER' | 'RIGHT' = 'LEFT', color: RGB = INK): TextNode {
  const t = figma.createText();
  parent.appendChild(t);
  t.fontName = font;
  t.fontSize = size;
  t.characters = chars;
  t.fills = [{ type: 'SOLID', color }];
  t.name = name;
  if (width) {
    t.resize(Math.max(1, width), t.height);
    t.textAutoResize = 'HEIGHT';
    t.textAlignHorizontal = align;
  }
  return t;
}

// Figma Stroke End Point의 Triangle arrow를 마지막 꼭짓점에만 설정한다.
async function arrowLine(parent: FrameNode, points: [number, number][]): Promise<VectorNode> {
  const minX = Math.min(...points.map(p => p[0])), minY = Math.min(...points.map(p => p[1]));
  const v = figma.createVector();
  parent.appendChild(v);
  await v.setVectorNetworkAsync({
    vertices: points.map((point, index) => ({ x: point[0] - minX, y: point[1] - minY, strokeCap: index === points.length - 1 ? 'TRIANGLE_FILLED' : 'NONE' })),
    segments: points.slice(1).map((_, index) => ({ start: index, end: index + 1 })),
  });
  v.x = minX;
  v.y = minY;
  return v;
}

// 플러그인 창에서 정한 격자 칸에 화면을 놓고, 같은 규칙(core/flow.ts)으로 통로를 따라 꺾인 화살표를 그린다.
export async function createFlow(ns: string, plan: FlowPlan): Promise<{ nodeId: string; pageId: string; notes: string[] }> {
  const L = FLOW_LAYOUT;
  const fonts = await loadFonts();
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
    // 설명 칸의 높이를 재야 칸 높이를 정할 수 있다. 먼저 만들어 재고 자리는 배치 뒤에 정한다.
    const captions = plan.cells.map(() => text(frame, fonts.regular, COPY.flow013, L.captionSize, COPY.flow013, cellW, 'LEFT', FLOW_DUMMY));
    const cellH = L.cellTitle + imageH + L.captionGap + Math.max(...captions.map(c => c.height));
    const layout = layoutFlow(plan.cells, plan.links, { w: cellW, h: cellH });
    frame.resize(layout.width, layout.height);
    const heading = text(frame, fonts.bold, plan.title, L.titleSize, plan.title);
    heading.x = L.pad;
    heading.y = L.pad;
    const g = layout.grid;
    plan.cells.forEach((cell, i) => {
      const x = g.x0 + cell.c * (g.cellW + g.gapX), y = g.y0 + cell.r * (g.cellH + g.gapY);
      const title = text(frame, fonts.bold, COPY.flow012, L.cellTitleSize, COPY.flow012, cellW, 'LEFT', FLOW_DUMMY);
      title.x = x;
      title.y = y;
      const rect = figma.createRectangle();
      frame.appendChild(rect);
      rect.name = `${COPY.flow016} ${formatFrameName(cell.code, cell.name)}`;
      rect.resize(sizes[i].w, sizes[i].h);
      rect.x = x;
      rect.y = y + L.cellTitle;
      rect.strokes = gray(0.475);
      rect.strokeWeight = 1;
      rect.setSharedPluginData(ns, SCREEN_KEY, cell.uid);
      const thumb = thumbs[i];
      if (thumb) {
        rect.fills = imageFill(thumb.hash);
        rect.setSharedPluginData(ns, VERSION_KEY, String(cell.version));
      } else {
        rect.fills = gray(0.86);
        const note = text(frame, fonts.regular, COPY.flow005, L.captionSize, COPY.flow005, sizes[i].w, 'CENTER');
        note.x = x;
        note.y = rect.y + (sizes[i].h - note.height) / 2;
        note.setSharedPluginData(ns, EMPTY_KEY, rect.id);
      }
      captions[i].x = x;
      captions[i].y = rect.y + sizes[i].h + L.captionGap;
    });
    const byKey = new Map(plan.cells.map(c => [c.key, c]));
    for (const arrow of layout.arrows) {
      const line = await arrowLine(frame, arrow.points);
      line.fills = [];
      line.strokes = gray(0.1);
      line.strokeWeight = L.line;
      line.name = `${COPY.flow015} ${byKey.get(arrow.link.from)?.code ?? ''}→${byKey.get(arrow.link.to)?.code ?? ''}`;
      const spot = arrow.label;
      const label = text(frame, fonts.regular, COPY.flow014, L.labelSize, COPY.flow014, spot.width, spot.align === 'right' ? 'RIGHT' : 'LEFT', FLOW_DUMMY);
      label.x = spot.x;
      label.y = spot.anchor === 'bottom' ? spot.y - label.height : spot.y;
    }
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
