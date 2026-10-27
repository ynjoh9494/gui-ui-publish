import { COPY } from './copy.ts';
import { guiScreenInfo } from './guiScreens.ts';
import type { State } from './store.ts';
import type { Actor, FlowRecord, GuiThumb } from './types.ts';

// 플로우(2026-10-23 사용자 결정): 배포된 화면을 놓고 꺾인 화살표로 잇는 독립 그룹. UI Flipbook의 부가 기능이다.
// 플러그인 창에서 FigJam처럼 썸네일을 놓고 상하좌우 점을 끌어 다른 썸네일에 잇는다. 캔버스에는 같은 자리·경로를 그린다.
// 2026-10-26 사용자 요청: 칸마다 같은 크기 카드를 하나씩 넣는 대신 썸네일을 제 크기 그대로 놓는다. 격자는 놓는 위치를 맞추는 스냅 간격일 뿐이다.
// 화면은 레이어 복사본이 아니라 GUI 배포 때 만든 1/4 썸네일 이미지이고, 다시 배포되면 그 이미지만 바꾼다.
// 제목·설명·조건은 빨간 더미 글자 칸만 만들고 플러그인은 만든 뒤 내용을 고치지 않는다. 이력 행은 남기지 않고,
// 썸네일을 맞추고 있는 플로우는 플로우 목록(2026-10-23 사용자 요청)으로 보여 준다. 캔버스에서 지운 플로우는 묻지 않고 기록에서 뺀다.

export type FlowSide = 'top' | 'right' | 'bottom' | 'left';
// key: 플러그인 창에서 썸네일을 구분하는 값(같은 화면을 여러 번 놓을 수 있다). x·y: 썸네일 왼쪽 위(캔버스 단위 = 1/4 썸네일 px)
export interface FlowCard { key: string; uid: string; x: number; y: number }
export interface FlowLink { from: string; fromSide: FlowSide; to: string; toSide: FlowSide }
export interface FlowRequest { title: string; cards: FlowCard[]; links: FlowLink[] }

// w·h: 썸네일 크기(캔버스 단위)
export interface FlowCell extends FlowCard { code: string; name: string; version: number; thumb: GuiThumb | null; w: number; h: number }
export interface FlowPlan { id: string; title: string; cells: FlowCell[]; links: FlowLink[] }

// 캔버스 배치 값. 제목 → 이미지 → 설명은 참고 플로우 프레임의 구조를 따른다.
// 화면 간격 80×80은 이미지 사이 간격이다(2026-10-23 사용자 요청: 세로도 80. 참고 프레임의 세로는 120). 썸네일을 누르기만 해서 놓을 때 이 간격을 띄운다.
// 화살표는 이미지 가장자리에서 나가 도착 이미지 8px 앞에서 끝나고(arrowGap), 조건 글자는 출발점에서 8px 떨어진다.
// captionBand: 썸네일 아래 설명 칸(간격 4 + 한 줄). clearance: 꺾인 화살표가 다른 화면의 제목·이미지·설명과 띄우는 거리.
export const FLOW_LAYOUT = {
  pad: 0, titleSize: 16, titleGap: 56, cellTitle: 25, cellTitleSize: 16, captionGap: 4, captionSize: 16, captionBand: 25,
  gapX: 80, gapY: 80, line: 2, arrowGap: 8, labelSize: 16, labelGap: 8, labelMargin: 8, clearance: 8,
};
// 판의 격자(구현 기본값): 썸네일 왼쪽 위를 이 간격(캔버스 단위)에 맞춘다. 화면 간격 80의 절반이다.
export const FLOW_SNAP = 40;
// 썸네일이 없는 화면(썸네일 기능 전에 배포한 화면 등)의 자리 크기: 1920×1080의 1/4
export const FLOW_PLACEHOLDER = { w: 480, h: 270 };
export const flowImageSize = (thumb: GuiThumb | null): { w: number; h: number } => thumb ? { w: thumb.width, h: thumb.height } : { ...FLOW_PLACEHOLDER };
export const FLOW_DEFAULT_TITLE = COPY.flow001;

const SIDES: FlowSide[] = ['top', 'right', 'bottom', 'left'];
export const isSide = (v: unknown): v is FlowSide => SIDES.includes(v as FlowSide);

// 받은 자리는 가장 왼쪽·가장 위 썸네일이 (0, 0)이 되게 옮긴다. 사이의 빈 자리는 그대로 둔다(플러그인 창의 배치를 그대로 그린다).
export function planFlow(state: State, request: FlowRequest, newId: () => string): FlowPlan {
  if (request.cards.length < 2) throw new Error(COPY.flow002);
  if (request.cards.some(c => !Number.isFinite(c.x) || !Number.isFinite(c.y))) throw new Error(COPY.flow004);
  const minX = Math.min(...request.cards.map(c => c.x)), minY = Math.min(...request.cards.map(c => c.y));
  const cells = request.cards.map((card): FlowCell => {
    const screen = state.screens.get(card.uid);
    const info = screen ? guiScreenInfo(state, screen) : null;
    if (!info || info.status !== 'active' || !info.version) throw new Error(`${COPY.flow003} ${info?.code || card.uid}`);
    const size = flowImageSize(info.thumb);
    return { key: card.key, uid: info.uid, x: card.x - minX, y: card.y - minY, code: info.code, name: info.name, version: info.version, thumb: info.thumb, w: size.w, h: size.h };
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

// ── 화살표 경로 ─────────────────────────────────────

// 썸네일 이미지 자리. 화살표는 이미지 가장자리 가운데에서 나가고 들어온다.
export interface FlowBox { x: number; y: number; w: number; h: number }
export type FlowPoint = [number, number];

export function sidePoint(b: FlowBox, side: FlowSide): FlowPoint {
  switch (side) {
    case 'top': return [b.x + b.w / 2, b.y];
    case 'right': return [b.x + b.w, b.y + b.h / 2];
    case 'bottom': return [b.x + b.w / 2, b.y + b.h];
    case 'left': return [b.x, b.y + b.h / 2];
  }
}

// 화면 하나가 캔버스에서 차지하는 자리: 이미지 위 제목 칸과 아래 설명 칸까지. 꺾인 화살표는 이 자리를 피한다.
export function cardBox(img: FlowBox): FlowBox {
  const L = FLOW_LAYOUT;
  return { x: img.x, y: img.y - L.cellTitle, w: img.w, h: img.h + L.cellTitle + L.captionBand };
}

const horizontal = (side: FlowSide) => side === 'left' || side === 'right';
const OPPOSITE: Record<FlowSide, FlowSide> = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' };
// 변 바깥쪽 방향
const NORMAL: Record<FlowSide, FlowPoint> = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };

// 변 바깥으로 d만큼 나간 점
function outward(p: FlowPoint, side: FlowSide, d: number): FlowPoint {
  const [dx, dy] = NORMAL[side];
  return [p[0] + dx * d, p[1] + dy * d];
}

// b가 a에서 side 바깥쪽에 있는지
function ahead(side: FlowSide, a: FlowPoint, b: FlowPoint): boolean {
  const [dx, dy] = NORMAL[side];
  return (b[0] - a[0]) * dx + (b[1] - a[1]) * dy > 0;
}

// 가로·세로 선분이 자리(margin만큼 넓힌 열린 사각형)를 지나는지
function crosses(b: FlowBox, p: FlowPoint, q: FlowPoint, margin: number): boolean {
  return Math.max(p[0], q[0]) > b.x - margin && Math.min(p[0], q[0]) < b.x + b.w + margin
    && Math.max(p[1], q[1]) > b.y - margin && Math.min(p[1], q[1]) < b.y + b.h + margin;
}

// 선분이 o에서 side 바깥쪽으로 곧게 뻗은 반직선 위에 있는지(변에서 곧게 나가거나 들어오는 부분)
function onRay(p: FlowPoint, q: FlowPoint, o: FlowPoint, side: FlowSide): boolean {
  const [dx, dy] = NORMAL[side];
  return dx ? p[1] === o[1] && q[1] === o[1] && (p[0] - o[0]) * dx >= 0 && (q[0] - o[0]) * dx >= 0
    : p[0] === o[0] && q[0] === o[0] && (p[1] - o[1]) * dy >= 0 && (q[1] - o[1]) * dy >= 0;
}

// 한 번 꺾을 때마다 더하는 거리. 짧게 돌아가는 것보다 덜 꺾이는 경로를 고른다.
const BEND_COST = 100;

// 출발 화면 from의 변에서 도착 화면 to의 변까지 잇는 꺾인 경로. others: 나머지 화면의 이미지 자리. 도착점은 endGap만큼 앞에서 멈춘다.
// 판과 캔버스가 같은 규칙을 쓴다. 지나는 길(다른 화면의 제목·이미지·설명 자리)이 비었을 때 차례로
// 1) 마주 보는 변이 한 줄이면 직선, 2) 마주 보는 변은 출발점과 화살촉 끝의 가운데에서 두 번 꺾고(참고 프레임),
// 3) 위아래 변과 좌우 변은 한 번만 꺾는다(2026-10-23 사용자 요청). 4) 막혔거나 그 밖의 방향이면 화면 사이 통로 가운데를 따라 덜 꺾이는 길로 돌아간다.
export function routeLink(from: FlowBox, fromSide: FlowSide, to: FlowBox, toSide: FlowSide, others: readonly FlowBox[] = [], endGap = 0): FlowPoint[] {
  const s = sidePoint(from, fromSide), edge = sidePoint(to, toSide);
  const t = outward(edge, toSide, endGap);
  const a = cardBox(from), b = cardBox(to);
  const walls = others.map(cardBox);
  const m = FLOW_LAYOUT.clearance;
  // 변에서 곧게 나가는 부분은 출발 화면의 제목·설명 칸을, 곧게 들어오는 부분은 도착 화면의 칸을 지나도 된다.
  const clear = (p: FlowPoint, q: FlowPoint, obstacles = walls) => obstacles.every(w => !crosses(w, p, q, m))
    && (onRay(p, q, s, fromSide) || !crosses(a, p, q, m)) && (onRay(p, q, edge, toSide) || !crosses(b, p, q, m));
  const clearPath = (points: FlowPoint[]) => points.slice(1).every((q, i) => clear(points[i], q));
  for (const path of shortcuts(s, fromSide, t, toSide, edge)) if (clearPath(path)) return path;
  const boxes = [a, b, ...walls];
  return search(s, fromSide, t, toSide, boxes, clear)
    // 다른 화면과 겹쳐 놓여 길이 없으면 다른 화면은 무시한다.
    ?? search(s, fromSide, t, toSide, [a, b], (p, q) => clear(p, q, []))
    ?? simplify([s, horizontal(fromSide) ? [t[0], s[1]] : [s[0], t[1]], t]);
}

// 직선, 가운데에서 두 번 꺾기, 한 번 꺾기 중 방향이 맞는 경로
function shortcuts(s: FlowPoint, fromSide: FlowSide, t: FlowPoint, toSide: FlowSide, edge: FlowPoint): FlowPoint[][] {
  if (toSide === OPPOSITE[fromSide]) {
    if (!ahead(fromSide, s, t)) return [];
    if (horizontal(fromSide) ? s[1] === t[1] : s[0] === t[0]) return [[s, t]];
    if (horizontal(fromSide)) {
      const x = (s[0] + t[0]) / 2;
      return [[s, [x, s[1]], [x, t[1]], t]];
    }
    const y = (s[1] + t[1]) / 2;
    return [[s, [s[0], y], [t[0], y], t]];
  }
  if (horizontal(fromSide) === horizontal(toSide)) return [];
  const p: FlowPoint = horizontal(fromSide) ? [t[0], s[1]] : [s[0], t[1]];
  // 꺾이는 점이 출발 변 바깥쪽에 있고, 도착 변 바깥쪽에서 들어와야 한다.
  return ahead(fromSide, s, p) && ahead(toSide, edge, p) ? [[s, p, t]] : [];
}

// 후보 선(출발·도착점을 지나는 선, 화면 사이 통로 가운데, 모든 화면 바깥 통로) 위에서 꺾임과 거리를 더한 값이 가장 작은 경로를 찾는다(A*).
// 출발 변에서는 바깥쪽으로 나가고, 도착 변에는 바깥쪽에서 들어온다. 길이 없으면 null
function search(s: FlowPoint, fromSide: FlowSide, t: FlowPoint, toSide: FlowSide, boxes: FlowBox[], clear: (p: FlowPoint, q: FlowPoint) => boolean): FlowPoint[] | null {
  const lines = (lo: (b: FlowBox) => number, hi: (b: FlowBox) => number, ends: number[], outer: number) => {
    const edges = [...new Set(boxes.flatMap(b => [lo(b), hi(b)]))].sort((p, q) => p - q);
    const mids = edges.slice(1).map((e, i) => (edges[i] + e) / 2);
    return [...new Set([...ends, ...mids, edges[0] - outer, edges[edges.length - 1] + outer])].sort((p, q) => p - q);
  };
  const xs = lines(b => b.x, b => b.x + b.w, [s[0], t[0]], FLOW_LAYOUT.gapX / 2);
  const ys = lines(b => b.y, b => b.y + b.h, [s[1], t[1]], FLOW_LAYOUT.gapY / 2);
  // 방향: 0 오른쪽, 1 아래, 2 왼쪽, 3 위
  const STEP: FlowPoint[] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const dirOf = (v: FlowPoint) => STEP.findIndex(d => d[0] === v[0] && d[1] === v[1]);
  const start = { i: xs.indexOf(s[0]), j: ys.indexOf(s[1]), d: dirOf(NORMAL[fromSide]) };
  const goal = { i: xs.indexOf(t[0]), j: ys.indexOf(t[1]), d: dirOf(NORMAL[OPPOSITE[toSide]]) };
  const nx = xs.length, ny = ys.length;
  const id = (i: number, j: number, d: number) => (j * nx + i) * 4 + d;
  const point = (i: number, j: number): FlowPoint => [xs[i], ys[j]];
  const cost = new Map<number, number>([[id(start.i, start.j, start.d), 0]]);
  const prev = new Map<number, number>();
  const blocked = new Map<number, boolean>();
  const heap = new MinHeap();
  const guess = (i: number, j: number) => Math.abs(xs[i] - t[0]) + Math.abs(ys[j] - t[1]);
  heap.push(guess(start.i, start.j), id(start.i, start.j, start.d));
  while (heap.size) {
    const [f, key] = heap.pop();
    const d = key % 4, cell = (key - d) / 4, i = cell % nx, j = (cell - i) / nx;
    const g = cost.get(key)!;
    if (f > g + guess(i, j)) continue;
    if (i === goal.i && j === goal.j && d === goal.d) {
      const path: FlowPoint[] = [];
      for (let k: number | undefined = key; k !== undefined; k = prev.get(k)) {
        const c = (k - (k % 4)) / 4;
        path.push(point(c % nx, (c - (c % nx)) / nx));
      }
      return simplify(path.reverse());
    }
    const moves: [number, number, number, number][] = [];
    const ni = i + STEP[d][0], nj = j + STEP[d][1];
    if (ni >= 0 && ni < nx && nj >= 0 && nj < ny) {
      const edgeKey = id(Math.min(i, ni), Math.min(j, nj), d % 2);
      let shut = blocked.get(edgeKey);
      if (shut === undefined) blocked.set(edgeKey, shut = !clear(point(i, j), point(ni, nj)));
      if (!shut) moves.push([ni, nj, d, Math.abs(xs[ni] - xs[i]) + Math.abs(ys[nj] - ys[j])]);
    }
    // 출발점에서는 곧게 나가야 하고, 도착점에 닿으면 더 꺾지 않는다.
    if (!(i === start.i && j === start.j) && !(i === goal.i && j === goal.j)) moves.push([i, j, (d + 1) % 4, BEND_COST], [i, j, (d + 3) % 4, BEND_COST]);
    for (const [mi, mj, md, step] of moves) {
      const next = id(mi, mj, md), total = g + step;
      if (total >= (cost.get(next) ?? Infinity)) continue;
      cost.set(next, total);
      prev.set(next, key);
      heap.push(total + guess(mi, mj), next);
    }
  }
  return null;
}

class MinHeap {
  private items: [number, number][] = [];
  get size() { return this.items.length; }
  push(priority: number, value: number) {
    const a = this.items;
    a.push([priority, value]);
    for (let k = a.length - 1; k > 0;) {
      const up = (k - 1) >> 1;
      if (a[up][0] <= a[k][0]) break;
      [a[up], a[k]] = [a[k], a[up]];
      k = up;
    }
  }
  pop(): [number, number] {
    const a = this.items;
    const top = a[0], last = a.pop()!;
    if (a.length) {
      a[0] = last;
      for (let k = 0; ;) {
        const l = 2 * k + 1, r = l + 1;
        let min = k;
        if (l < a.length && a[l][0] < a[min][0]) min = l;
        if (r < a.length && a[r][0] < a[min][0]) min = r;
        if (min === k) break;
        [a[min], a[k]] = [a[k], a[min]];
        k = min;
      }
    }
    return top;
  }
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

// 조건 칸 자리(2026-10-23 사용자 결정): 출발 화면 가까이. 좌우로 나가면 화살표 위(칸 아래 끝이 y, 폭은 화면 간격 안), 위아래로 나가면 화살표 오른쪽(아래로 나가면 칸 위 끝, 위로 나가면 칸 아래 끝이 y, 폭은 이미지 절반).
export interface FlowLabelSpot { x: number; y: number; width: number; align: 'left' | 'right'; anchor: 'top' | 'bottom' }
export function labelSpot(from: FlowBox, start: FlowPoint, fromSide: FlowSide): FlowLabelSpot {
  const L = FLOW_LAYOUT, m = L.labelMargin;
  switch (fromSide) {
    case 'right': return { x: start[0] + m, y: start[1] - L.labelGap, width: L.gapX - 2 * m, align: 'left', anchor: 'bottom' };
    case 'left': return { x: start[0] - L.gapX + m, y: start[1] - L.labelGap, width: L.gapX - 2 * m, align: 'right', anchor: 'bottom' };
    case 'bottom': return { x: start[0] + m, y: start[1] + m, width: from.w / 2 - m, align: 'left', anchor: 'top' };
    case 'top': return { x: start[0] + m, y: start[1] - m, width: from.w / 2 - m, align: 'left', anchor: 'bottom' };
  }
}

// 화면 key의 이미지 자리(캔버스 단위)를 모아 화살표 경로를 정한다. 판과 캔버스가 함께 쓴다.
export function flowArrows(images: Map<string, FlowBox>, links: FlowLink[], endGap: number): { link: FlowLink; points: FlowPoint[] }[] {
  return links.flatMap(link => {
    const a = images.get(link.from), b = images.get(link.to);
    if (!a || !b) return [];
    const others = [...images].filter(([key]) => key !== link.from && key !== link.to).map(([, box]) => box);
    return [{ link, points: routeLink(a, link.fromSide, b, link.toSide, others, endGap) }];
  });
}

// 캔버스 배치: 판의 자리를 그대로 옮기고 화면마다 제 썸네일 크기를 쓴다. 플로우 제목 아래 titleGap 뒤에 첫 줄 화면의 제목 칸이 온다.
export interface FlowLayout { width: number; height: number; images: Map<string, FlowBox>; arrows: { link: FlowLink; points: FlowPoint[]; label: FlowLabelSpot }[] }
export function layoutFlow(cells: { key: string; x: number; y: number; w: number; h: number }[], links: FlowLink[]): FlowLayout {
  const L = FLOW_LAYOUT;
  const top = L.pad + L.titleGap + L.cellTitle;
  const images = new Map(cells.map(c => [c.key, { x: L.pad + c.x, y: top + c.y, w: c.w, h: c.h }]));
  const arrows = flowArrows(images, links, L.arrowGap).map(arrow => ({ ...arrow, label: labelSpot(images.get(arrow.link.from)!, arrow.points[0], arrow.link.fromSide) }));
  const boxes = [...images.values()];
  return {
    width: Math.max(...boxes.map(b => b.x + b.w)) + L.pad,
    height: Math.max(...boxes.map(b => b.y + b.h + L.captionBand)) + L.pad,
    images, arrows,
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
