import { COPY } from './copy.ts';
import { guiScreenInfo } from './guiScreens.ts';
import type { State } from './store.ts';
import type { Actor, FlowRecord, GuiThumb } from './types.ts';

// 플로우(2026-10-23 사용자 결정): 배포된 화면을 격자에 놓고 꺾인 화살표로 잇는 독립 프레임. UI Flipbook의 부가 기능이다.
// 플러그인 창에서 FigJam처럼 카드를 격자 칸에 놓고 카드 상하좌우 점을 끌어 다른 카드에 잇는다. 캔버스에는 같은 격자·경로를 그린다.
// 화면은 레이어 복사본이 아니라 GUI 배포 때 만든 1/4 썸네일 이미지이고, 다시 배포되면 그 이미지만 바꾼다.
// 제목·설명·조건은 빨간(#ff0000) 더미 글자 칸만 만들고 플러그인은 만든 뒤 내용을 고치지 않는다. 이력은 남기지 않는다.

export type FlowSide = 'top' | 'right' | 'bottom' | 'left';
// key: 플러그인 창에서 카드를 구분하는 값(같은 화면을 여러 번 놓을 수 있다). r·c: 격자 칸(0부터)
export interface FlowCard { key: string; uid: string; r: number; c: number }
export interface FlowLink { from: string; fromSide: FlowSide; to: string; toSide: FlowSide }
export interface FlowRequest { title: string; cards: FlowCard[]; links: FlowLink[] }

export interface FlowCell extends FlowCard { code: string; name: string; version: number; thumb: GuiThumb | null }
export interface FlowPlan { id: string; title: string; cells: FlowCell[]; links: FlowLink[] }

// 캔버스 배치 값. 간격·글자 크기는 uigui-sync 플러그인의 플로우와 같다(2026-10-23 사용자 결정: 우선 기본값을 따르고 설정으로 뺄 수 있다).
export const FLOW_LAYOUT = {
  pad: 24, titleSize: 20, titleGap: 44, cellTitle: 40, cellTitleSize: 18, captionGap: 12, captionSize: 15,
  gapX: 140, gapY: 90, line: 2, head: 14, labelSize: 15, labelGap: 6, labelMargin: 8,
};
export const FLOW_DEFAULT_TITLE = COPY.flow001;
// 더미 글자 색(2026-10-23 사용자 결정: 더미 글자는 무조건 #ff0000)
export const FLOW_DUMMY = { r: 1, g: 0, b: 0 };

const SIDES: FlowSide[] = ['top', 'right', 'bottom', 'left'];
export const isSide = (v: unknown): v is FlowSide => SIDES.includes(v as FlowSide);

// 받은 칸은 왼쪽 위 칸이 (0, 0)이 되게 옮긴다. 가운데 빈 줄·칸은 그대로 둔다(플러그인 창의 격자를 그대로 그린다).
export function planFlow(state: State, request: FlowRequest, newId: () => string): FlowPlan {
  if (request.cards.length < 2) throw new Error(COPY.flow002);
  const minR = Math.min(...request.cards.map(c => c.r)), minC = Math.min(...request.cards.map(c => c.c));
  const taken = new Set<string>();
  const cells = request.cards.map((card): FlowCell => {
    const screen = state.screens.get(card.uid);
    const info = screen ? guiScreenInfo(state, screen) : null;
    if (!info || info.status !== 'active' || !info.version) throw new Error(`${COPY.flow003} ${info?.code || card.uid}`);
    const r = card.r - minR, c = card.c - minC;
    if (!Number.isInteger(r) || !Number.isInteger(c) || taken.has(`${r},${c}`)) throw new Error(COPY.flow004);
    taken.add(`${r},${c}`);
    return { key: card.key, uid: info.uid, r, c, code: info.code, name: info.name, version: info.version, thumb: info.thumb };
  });
  const keys = new Set(cells.map(c => c.key));
  const seen = new Set<string>();
  const links = request.links.filter(l => {
    const id = `${l.from}:${l.fromSide}>${l.to}:${l.toSide}`;
    if (!keys.has(l.from) || !keys.has(l.to) || l.from === l.to || !isSide(l.fromSide) || !isSide(l.toSide) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return { id: newId(), title: request.title.trim() || FLOW_DEFAULT_TITLE, cells, links };
}

export function flowRecord(plan: FlowPlan, placed: { nodeId: string; pageId: string }, actor: Actor, at: number): FlowRecord {
  return { id: plan.id, nodeId: placed.nodeId, pageId: placed.pageId, title: plan.title, uids: [...new Set(plan.cells.map(c => c.uid))], createdAt: at, actor };
}

// ── 격자와 화살표 경로 ─────────────────────────────────────

// 칸(0, 0)의 왼쪽 위가 (x0, y0)이고 모든 칸의 크기가 같다. 칸 사이 통로(gap)의 가운데 선으로만 화살표가 지나므로 카드와 겹치지 않는다.
export interface FlowGrid { x0: number; y0: number; cellW: number; cellH: number; gapX: number; gapY: number }
export type FlowPoint = [number, number];
export type FlowDir = 'up' | 'right' | 'down' | 'left';

export function cellBox(g: FlowGrid, at: { r: number; c: number }): { x: number; y: number; w: number; h: number } {
  return { x: g.x0 + at.c * (g.cellW + g.gapX), y: g.y0 + at.r * (g.cellH + g.gapY), w: g.cellW, h: g.cellH };
}

export function sidePoint(g: FlowGrid, at: { r: number; c: number }, side: FlowSide): FlowPoint {
  const b = cellBox(g, at);
  switch (side) {
    case 'top': return [b.x + b.w / 2, b.y];
    case 'right': return [b.x + b.w, b.y + b.h / 2];
    case 'bottom': return [b.x + b.w / 2, b.y + b.h];
    case 'left': return [b.x, b.y + b.h / 2];
  }
}

const horizontal = (side: FlowSide) => side === 'left' || side === 'right';

// 칸 가장자리에서 통로 가운데까지 나간 점
function exit(g: FlowGrid, p: FlowPoint, side: FlowSide): FlowPoint {
  switch (side) {
    case 'top': return [p[0], p[1] - g.gapY / 2];
    case 'right': return [p[0] + g.gapX / 2, p[1]];
    case 'bottom': return [p[0], p[1] + g.gapY / 2];
    case 'left': return [p[0] - g.gapX / 2, p[1]];
  }
}

// 꺾인 화살표 경로: 출발 칸 가장자리 → 통로 가운데 → (통로 선을 따라) → 도착 칸 앞 통로 가운데 → 도착 칸 가장자리.
// 양쪽이 모두 세로 통로(좌우로 나감)면 두 칸 사이 가로 통로 중 가장 가까운 선으로 건너고, 가로 통로끼리면 세로 통로로 건넌다.
export function routeLink(g: FlowGrid, from: { r: number; c: number }, fromSide: FlowSide, to: { r: number; c: number }, toSide: FlowSide): FlowPoint[] {
  const s = sidePoint(g, from, fromSide), t = sidePoint(g, to, toSide);
  const s1 = exit(g, s, fromSide), t1 = exit(g, t, toSide);
  const mid: FlowPoint[] = [];
  const sh = horizontal(fromSide), th = horizontal(toSide);
  if (sh && th) {
    if (s1[0] !== t1[0]) {
      const y = nearestLine(s1[1], t1[1], Math.min(from.r, to.r), Math.max(from.r, to.r) + 1, k => g.y0 - g.gapY / 2 + k * (g.cellH + g.gapY));
      mid.push([s1[0], y], [t1[0], y]);
    }
  } else if (!sh && !th) {
    if (s1[1] !== t1[1]) {
      const x = nearestLine(s1[0], t1[0], Math.min(from.c, to.c), Math.max(from.c, to.c) + 1, k => g.x0 - g.gapX / 2 + k * (g.cellW + g.gapX));
      mid.push([x, s1[1]], [x, t1[1]]);
    }
  } else if (sh) mid.push([s1[0], t1[1]]);
  else mid.push([t1[0], s1[1]]);
  return simplify([s, s1, ...mid, t1, t]);
}

function nearestLine(a: number, b: number, from: number, to: number, line: (k: number) => number): number {
  let best = line(from);
  for (let k = from + 1; k <= to; k++) {
    const y = line(k);
    if (Math.abs(a - y) + Math.abs(b - y) < Math.abs(a - best) + Math.abs(b - best)) best = y;
  }
  return best;
}

// 겹친 점과 한 직선 위의 가운데 점을 뺀다.
function simplify(points: FlowPoint[]): FlowPoint[] {
  const out: FlowPoint[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    const prev = out[out.length - 2];
    if (prev && last && ((prev[0] === last[0] && last[0] === p[0]) || (prev[1] === last[1] && last[1] === p[1]))) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

export function direction(a: FlowPoint, b: FlowPoint): FlowDir {
  if (a[0] === b[0]) return b[1] > a[1] ? 'down' : 'up';
  return b[0] > a[0] ? 'right' : 'left';
}

// 화살촉 길이만큼 끝을 줄인 경로와 화살촉 방향
export function trimEnd(points: FlowPoint[], head: number): { points: FlowPoint[]; dir: FlowDir; tip: FlowPoint } {
  const tip = points[points.length - 1];
  const dir = direction(points[points.length - 2], tip);
  const back: FlowPoint = dir === 'right' ? [tip[0] - head, tip[1]] : dir === 'left' ? [tip[0] + head, tip[1]] : dir === 'down' ? [tip[0], tip[1] - head] : [tip[0], tip[1] + head];
  return { points: [...points.slice(0, -1), back], dir, tip };
}

// 조건 칸 자리(2026-10-23 사용자 결정): 출발 화면 가까이. 좌우로 나가면 화살표 위(칸 아래 끝이 y), 위아래로 나가면 화살표 오른쪽(아래로 나가면 칸 위 끝, 위로 나가면 칸 아래 끝이 y).
// 칸은 출발 칸 옆 통로 안에 두므로 카드와 겹치지 않는다.
export interface FlowLabelSpot { x: number; y: number; width: number; align: 'left' | 'right'; anchor: 'top' | 'bottom' }
export function labelSpot(g: FlowGrid, start: FlowPoint, fromSide: FlowSide): FlowLabelSpot {
  const m = FLOW_LAYOUT.labelMargin;
  switch (fromSide) {
    case 'right': return { x: start[0] + m, y: start[1] - FLOW_LAYOUT.labelGap, width: g.gapX - 2 * m, align: 'left', anchor: 'bottom' };
    case 'left': return { x: start[0] - g.gapX + m, y: start[1] - FLOW_LAYOUT.labelGap, width: g.gapX - 2 * m, align: 'right', anchor: 'bottom' };
    case 'bottom': return { x: start[0] + m, y: start[1] + m, width: g.cellW / 2 - m, align: 'left', anchor: 'top' };
    case 'top': return { x: start[0] + m, y: start[1] - m, width: g.cellW / 2 - m, align: 'left', anchor: 'bottom' };
  }
}

// 캔버스 배치: 모든 칸은 크기가 같다(가장 넓은 썸네일 폭 × 가장 높은 제목·썸네일·설명 높이). 바깥에도 통로 절반을 둔다.
export interface FlowLayout { width: number; height: number; grid: FlowGrid; arrows: { link: FlowLink; points: FlowPoint[]; label: FlowLabelSpot }[] }
export function layoutFlow(cells: { key: string; r: number; c: number }[], links: FlowLink[], cell: { w: number; h: number }): FlowLayout {
  const L = FLOW_LAYOUT;
  const nrow = Math.max(1, ...cells.map(c => c.r + 1)), ncol = Math.max(1, ...cells.map(c => c.c + 1));
  const grid: FlowGrid = { x0: L.pad + L.gapX / 2, y0: L.pad + L.titleGap + L.gapY / 2, cellW: cell.w, cellH: cell.h, gapX: L.gapX, gapY: L.gapY };
  const at = new Map(cells.map(c => [c.key, c]));
  const arrows = links.flatMap(link => {
    const a = at.get(link.from), b = at.get(link.to);
    if (!a || !b) return [];
    const points = routeLink(grid, a, link.fromSide, b, link.toSide);
    return [{ link, points, label: labelSpot(grid, points[0], link.fromSide) }];
  });
  return {
    width: 2 * grid.x0 + ncol * cell.w + (ncol - 1) * L.gapX,
    height: grid.y0 + nrow * cell.h + (nrow - 1) * L.gapY + L.gapY / 2 + L.pad,
    grid, arrows,
  };
}

// ── 다시 배포된 화면 ───────────────────────────────────

// 플로우 썸네일을 바꿀 화면: 마지막 배포에 썸네일이 있는 화면만. 사용 안 함이 된 화면은 마지막 이미지를 그대로 둔다.
export interface FlowThumb { uid: string; version: number; thumb: GuiThumb }
export function flowUpdates(state: State, uids: Set<string>): { flows: FlowRecord[]; thumbs: FlowThumb[] } {
  const thumbs: FlowThumb[] = [];
  for (const uid of uids) {
    const screen = state.screens.get(uid);
    const info = screen && guiScreenInfo(state, screen);
    if (info && info.status === 'active' && info.thumb) thumbs.push({ uid, version: info.version, thumb: info.thumb });
  }
  const wanted = new Set(thumbs.map(t => t.uid));
  return { flows: [...state.flows.values()].filter(f => f.uids.some(uid => wanted.has(uid))), thumbs };
}
