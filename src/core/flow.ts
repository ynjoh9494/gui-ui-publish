import { COPY } from './copy.ts';
import { guiScreenInfo } from './guiScreens.ts';
import type { State } from './store.ts';
import type { Actor, FlowRecord, GuiThumb } from './types.ts';

// 플로우(2026-10-23 사용자 결정): 배포된 화면을 격자에 놓고 꺾인 화살표로 잇는 독립 그룹. UI Flipbook의 부가 기능이다.
// 플러그인 창에서 FigJam처럼 카드를 격자 칸에 놓고 카드 상하좌우 점을 끌어 다른 카드에 잇는다. 캔버스에는 같은 격자·경로를 그린다.
// 화면은 레이어 복사본이 아니라 GUI 배포 때 만든 1/4 썸네일 이미지이고, 다시 배포되면 그 이미지만 바꾼다.
// 제목·설명·조건은 빨간 더미 글자 칸만 만들고 플러그인은 만든 뒤 내용을 고치지 않는다. 이력 행은 남기지 않고,
// 썸네일을 맞추고 있는 플로우는 플로우 목록(2026-10-23 사용자 요청)으로 보여 준다. 캔버스에서 지운 플로우는 묻지 않고 기록에서 뺀다.

export type FlowSide = 'top' | 'right' | 'bottom' | 'left';
// key: 플러그인 창에서 카드를 구분하는 값(같은 화면을 여러 번 놓을 수 있다). r·c: 격자 칸(0부터)
export interface FlowCard { key: string; uid: string; r: number; c: number }
export interface FlowLink { from: string; fromSide: FlowSide; to: string; toSide: FlowSide }
export interface FlowRequest { title: string; cards: FlowCard[]; links: FlowLink[] }

export interface FlowCell extends FlowCard { code: string; name: string; version: number; thumb: GuiThumb | null }
export interface FlowPlan { id: string; title: string; cells: FlowCell[]; links: FlowLink[] }

// 캔버스 배치 값. 제목 → 이미지 → 설명은 참고 플로우 프레임의 구조를 따른다.
// 화면 간격 80×80은 이미지 사이 간격이다(2026-10-23 사용자 요청: 세로도 80. 참고 프레임의 세로는 120). 카드 틀 사이 세로는 제목·설명 높이만큼 좁다. 화살표는 이미지 가장자리에서 나가
// 도착 이미지 8px 앞에서 끝나고(arrowGap), 조건 글자는 출발점에서 8px 떨어진다.
export const FLOW_LAYOUT = {
  pad: 0, titleSize: 16, titleGap: 56, cellTitle: 25, cellTitleSize: 16, captionGap: 4, captionSize: 16,
  gapX: 80, gapY: 80, line: 2, arrowGap: 8, labelSize: 16, labelGap: 8, labelMargin: 8,
};
export const FLOW_DEFAULT_TITLE = COPY.flow001;
// 더미 글자 색 #ff0000. Figma 예시처럼 텍스트 채움 불투명도를 50%로 쓴다(2026-10-23 사용자 확인).
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

// 칸(0, 0)의 왼쪽 위가 (x0, y0)이고 모든 칸의 크기가 같다. gapX·gapY는 칸 틀 사이 간격이다. 빈 칸은 직선으로 통과하고, 꺾이는 경로는 칸 사이 통로를 쓴다.
// 화살표는 칸 안의 이미지(위에서 imgTop, 높이 imgH, 없으면 칸 전체)에 붙고, 도착점은 endGap만큼 앞에서 멈춘다.
export interface FlowGrid { x0: number; y0: number; cellW: number; cellH: number; gapX: number; gapY: number; imgTop?: number; imgH?: number; endGap?: number }
export type FlowPoint = [number, number];

export function cellBox(g: FlowGrid, at: { r: number; c: number }): { x: number; y: number; w: number; h: number } {
  return { x: g.x0 + at.c * (g.cellW + g.gapX), y: g.y0 + at.r * (g.cellH + g.gapY), w: g.cellW, h: g.cellH };
}

function imageBox(g: FlowGrid, at: { r: number; c: number }): { x: number; y: number; w: number; h: number } {
  const b = cellBox(g, at);
  return { x: b.x, y: b.y + (g.imgTop ?? 0), w: b.w, h: g.imgH ?? b.h };
}

export function sidePoint(g: FlowGrid, at: { r: number; c: number }, side: FlowSide): FlowPoint {
  const b = imageBox(g, at);
  switch (side) {
    case 'top': return [b.x + b.w / 2, b.y];
    case 'right': return [b.x + b.w, b.y + b.h / 2];
    case 'bottom': return [b.x + b.w / 2, b.y + b.h];
    case 'left': return [b.x, b.y + b.h / 2];
  }
}

const horizontal = (side: FlowSide) => side === 'left' || side === 'right';

// 이미지 사이 통로 폭: 가로는 칸 사이 간격, 세로는 위 이미지 아래 끝에서 아래 이미지 위 끝까지
const laneX = (g: FlowGrid) => g.gapX;
const laneY = (g: FlowGrid) => g.gapY + g.cellH - (g.imgH ?? g.cellH);

// 변 바깥으로 d만큼 나간 점
function outward(p: FlowPoint, side: FlowSide, d: number): FlowPoint {
  switch (side) {
    case 'top': return [p[0], p[1] - d];
    case 'right': return [p[0] + d, p[1]];
    case 'bottom': return [p[0], p[1] + d];
    case 'left': return [p[0] - d, p[1]];
  }
}

// 가장자리(출발점·화살촉 끝)에서 통로 가운데까지 나간 점. 출발점과 화살촉 끝 사이의 가운데에서 꺾이게 한다(참고 프레임).
function exit(g: FlowGrid, p: FlowPoint, side: FlowSide): FlowPoint {
  return outward(p, side, ((horizontal(side) ? laneX(g) : laneY(g)) - (g.endGap ?? 0)) / 2);
}

// 한 번만 꺾는 경로의 꺾이는 점. 위아래 변과 좌우 변을 잇고, 지나는 칸(꺾이는 칸 포함)이 모두 비었을 때만 쓴다(2026-10-23 사용자 요청).
function corner(from: { r: number; c: number }, fromSide: FlowSide, to: { r: number; c: number }, toSide: FlowSide, s: FlowPoint, t: FlowPoint, occupied: readonly { r: number; c: number }[]): FlowPoint | null {
  if (horizontal(fromSide) === horizontal(toSide)) return null;
  const vertical = !horizontal(fromSide);
  const p: FlowPoint = vertical ? [s[0], t[1]] : [t[0], s[1]];
  const ahead = (side: FlowSide, a: FlowPoint, b: FlowPoint) =>
    side === 'top' ? b[1] < a[1] : side === 'bottom' ? b[1] > a[1] : side === 'left' ? b[0] < a[0] : b[0] > a[0];
  // 꺾이는 점이 출발 변 바깥쪽에 있고, 도착 변 바깥쪽에서 들어와야 한다.
  if (!ahead(fromSide, s, p) || !ahead(toSide, t, p)) return null;
  const cells: { r: number; c: number }[] = [];
  const dr = Math.sign(to.r - from.r), dc = Math.sign(to.c - from.c);
  if (vertical) {
    for (let r = from.r + dr; r !== to.r + dr; r += dr) cells.push({ r, c: from.c });
    for (let c = from.c + dc; c !== to.c; c += dc) cells.push({ r: to.r, c });
  } else {
    for (let c = from.c + dc; c !== to.c + dc; c += dc) cells.push({ r: from.r, c });
    for (let r = from.r + dr; r !== to.r; r += dr) cells.push({ r, c: to.c });
  }
  return cells.some(cell => occupied.some(at => at.r === cell.r && at.c === cell.c)) ? null : p;
}

// 마주 보는 변 사이의 칸이 비었으면 직선으로, 위아래 변과 좌우 변 사이는 빈 칸을 지나 한 번 꺾어 잇는다. 막혔거나 방향이 다르면 칸 사이 통로를 따른다.
export function routeLink(g: FlowGrid, from: { r: number; c: number }, fromSide: FlowSide, to: { r: number; c: number }, toSide: FlowSide, occupied: readonly { r: number; c: number }[] = []): FlowPoint[] {
  const s = sidePoint(g, from, fromSide), edge = sidePoint(g, to, toSide);
  const t = outward(edge, toSide, g.endGap ?? 0);
  const clearRow = from.r === to.r && occupied.every(at => at.r !== from.r || at.c <= Math.min(from.c, to.c) || at.c >= Math.max(from.c, to.c));
  if (clearRow && ((from.c < to.c && fromSide === 'right' && toSide === 'left') || (from.c > to.c && fromSide === 'left' && toSide === 'right'))) return [s, t];
  const clearColumn = from.c === to.c && occupied.every(at => at.c !== from.c || at.r <= Math.min(from.r, to.r) || at.r >= Math.max(from.r, to.r));
  if (clearColumn && ((from.r < to.r && fromSide === 'bottom' && toSide === 'top') || (from.r > to.r && fromSide === 'top' && toSide === 'bottom'))) return [s, t];
  const bend = corner(from, fromSide, to, toSide, s, edge, occupied);
  if (bend) return [s, bend, t];
  const s1 = exit(g, s, fromSide), t1 = exit(g, t, toSide);
  const mid: FlowPoint[] = [];
  const sh = horizontal(fromSide), th = horizontal(toSide);
  if (sh && th) {
    if (s1[0] !== t1[0]) {
      const y = nearestLine(s1[1], t1[1], Math.min(from.r, to.r), Math.max(from.r, to.r) + 1, k => g.y0 + (g.imgTop ?? 0) - laneY(g) / 2 + k * (g.cellH + g.gapY));
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

// 캔버스 배치: 모든 칸은 크기가 같다(가장 넓은 썸네일 폭 × 가장 높은 제목·썸네일·설명 높이).
// cell.imgTop·imgH: 칸 안의 이미지 자리. 세로 간격은 이미지 사이이므로 칸 틀 사이는 제목·설명 높이만큼 좁다.
export interface FlowLayout { width: number; height: number; grid: FlowGrid; arrows: { link: FlowLink; points: FlowPoint[]; label: FlowLabelSpot }[] }
export function layoutFlow(cells: { key: string; r: number; c: number }[], links: FlowLink[], cell: { w: number; h: number; imgTop?: number; imgH?: number }): FlowLayout {
  const L = FLOW_LAYOUT;
  const nrow = Math.max(1, ...cells.map(c => c.r + 1)), ncol = Math.max(1, ...cells.map(c => c.c + 1));
  const imgH = cell.imgH ?? cell.h;
  const gapY = Math.max(0, L.gapY - (cell.h - imgH));
  const grid: FlowGrid = { x0: L.pad, y0: L.pad + L.titleGap, cellW: cell.w, cellH: cell.h, gapX: L.gapX, gapY, imgTop: cell.imgTop ?? 0, imgH, endGap: L.arrowGap };
  const at = new Map(cells.map(c => [c.key, c]));
  const arrows = links.flatMap(link => {
    const a = at.get(link.from), b = at.get(link.to);
    if (!a || !b) return [];
    const points = routeLink(grid, a, link.fromSide, b, link.toSide, cells);
    return [{ link, points, label: labelSpot(grid, points[0], link.fromSide) }];
  });
  return {
    width: grid.x0 + ncol * cell.w + (ncol - 1) * L.gapX + L.pad,
    height: grid.y0 + nrow * cell.h + (nrow - 1) * gapY + L.pad,
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

// ── 플로우 목록 ───────────────────────────────────────

// 썸네일을 맞추고 있는 플로우. 최근에 만든 것부터. 화면은 플로우에 넣은 순서이고, 기록에서 사라진 화면은 고정 ID로 보인다.
export interface FlowListItem {
  id: string; title: string; pageName: string; createdAt: number; actor: Actor;
  screens: { uid: string; code: string; name: string }[];
}
export function flowList(state: State, pageNames: Map<string, string>): FlowListItem[] {
  return [...state.flows.values()].sort((a, b) => b.createdAt - a.createdAt).map(flow => ({
    id: flow.id, title: flow.title, pageName: pageNames.get(flow.pageId) ?? '', createdAt: flow.createdAt, actor: flow.actor,
    screens: flow.uids.map(uid => {
      const screen = state.screens.get(uid);
      const info = screen ? guiScreenInfo(state, screen) : null;
      return { uid, code: info?.code ?? '', name: info?.name ?? uid };
    }),
  }));
}
