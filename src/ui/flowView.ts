import { COPY } from '../core/copy.ts';
import { flowArrows, flowImageSize, routeLink, sidePoint, FLOW_DEFAULT_TITLE, FLOW_LAYOUT, FLOW_SNAP, type FlowBox, type FlowCard, type FlowLink, type FlowListItem, type FlowPoint, type FlowRequest, type FlowSide } from '../core/flow.ts';
import type { GuiScreenInfo } from '../core/guiScreens.ts';
import { esc } from './html.ts';

// 플로우 탭(2026-10-23 사용자 결정): 배포된 화면을 판에 놓고 FigJam처럼 잇는다. 텍스트 편집처럼 부가 기능이다.
// - 판에는 카드 대신 GUI 썸네일을 캔버스와 같은 비율·크기 관계로 놓는다(2026-10-26 사용자 요청). 격자는 칸이 아니라 놓는 위치를 맞추는 스냅이다.
// - 왼쪽 배포 화면을 누르면 첫 빈 자리에, 끌어 놓으면 놓은 자리(격자에 맞춤)에 썸네일을 놓는다(같은 화면을 여러 번 놓을 수 있다).
// - 썸네일을 끌면 격자 간격으로 따라오고 화살표도 함께 다시 그린다. 다른 썸네일과 겹쳐 놓을 수도 있다.
// - 썸네일 상하좌우 점을 끌어 다른 썸네일에 놓으면 꺾인 화살표로 잇는다. 점 위에 놓으면 그 변, 썸네일 위에 놓으면 마주 보는 변에 닿는다.
// - 고른 썸네일·화살표는 Delete(Backspace)로 지운다. 라벨은 없다(글은 캔버스의 빨간 더미 글자 칸에 쓴다).
// - 판은 끝없는 격자이고 Figma 캔버스처럼 움직인다: 가운데 버튼·Space+끌기, 휠(Shift+휠은 가로)·트랙패드, Ctrl(⌘)+휠·핀치로 확대·축소. 스크롤 막대는 없다.
// 화살표 경로는 캔버스와 같은 규칙(core/flow.ts routeLink)이라 창에서 본 모양 그대로 그려진다. 내용은 탭을 오가도 남는다(플러그인을 닫으면 지워짐).
// - 머리의 이력 아이콘은 만든 플로우 목록(2026-10-23 사용자 요청: 무엇이 동기화되는지 보이게)을 모달로 연다. 플로우·화면을 누르면 캔버스의 그 자리로 간다.

export interface FlowView {
  render(open: boolean): void;
  setScreens(screens: GuiScreenInfo[]): void;
  // 만든 플로우 목록(본체가 캔버스에서 지워진 플로우를 뺀 결과)
  setFlows(flows: FlowListItem[]): void;
  // 판에서 쓰는 썸네일 이미지를 받았을 때만 다시 그린다.
  thumbsLoaded(hashes: string[]): void;
  // 플로우 탭의 버튼(data-action="flow-…"). 처리했으면 true
  handle(action: string, el: HTMLElement): boolean;
}

export interface FlowActions {
  create(request: FlowRequest): void;
  list(): void;
  reveal(flowId: string, uid?: string): void;
  time(ms: number): string;
  // 썸네일 이미지 주소. 아직 없으면 받아 오도록 요청하고 null(받으면 thumbsLoaded)
  thumb(hash: string): string | null;
}

// 판 배율(판 px / 캔버스 단위, 구현 기본값). 1920×1080 화면의 1/4 썸네일(480×270)이 144×81로 보이고 격자 40은 12px이다.
const SCALE = { initial: 0.3, min: 0.1, max: 1 };
// 칸 (0, 0)을 판 왼쪽 위에서 조금 띄운다(썸네일 위 제목 칸 자리).
const INSET = { x: 12, y: 20 };
// 판 배경 격자 선의 최소 간격(px). 축소해서 더 촘촘해지면 격자 두 칸마다 긋는다.
const MIN_LINE_GAP = 8;
// 화살촉 크기(px). 선 굵기와 관계없이 같은 크기로 그린다(2026-10-23 사용자 요청: 이전의 1/2 정도).
const HEAD = 5;
const DRAG_START = 4;
// Ctrl+휠 한 칸(deltaY 100)에 약 0.78배·1.28배
const ZOOM_SPEED = 0.0025;

const X_ICON = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
// 이력(시계와 되감기 화살표) 아이콘: 만든 플로우 목록
const HISTORY_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>';
const SIDES: FlowSide[] = ['top', 'right', 'bottom', 'left'];

const linkId = (l: FlowLink) => `${l.from}:${l.fromSide}>${l.to}:${l.toSide}`;
const snap = (v: number) => Math.round(v / FLOW_SNAP) * FLOW_SNAP;
const typing = () => {
  const a = document.activeElement;
  return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || (a instanceof HTMLElement && a.isContentEditable);
};

// 점이 아닌 썸네일 위에 놓으면 출발 썸네일을 마주 보는 변에 닿는다.
function facingSide(from: FlowBox, to: FlowBox): FlowSide {
  const dx = to.x + to.w / 2 - (from.x + from.w / 2), dy = to.y + to.h / 2 - (from.y + from.h / 2);
  if (dx !== 0 && Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'left' : 'right';
  return dy > 0 ? 'top' : 'bottom';
}

type Drag =
  | { kind: 'pan'; x: number; y: number; from: { x: number; y: number } }
  | { kind: 'screen'; uid: string; x: number; y: number; moved: boolean; ghost: HTMLElement | null }
  // grab: 누른 점과 썸네일 왼쪽 위의 차이(캔버스 단위)
  | { kind: 'card'; key: string; x: number; y: number; moved: boolean; grab: FlowPoint }
  | { kind: 'link'; from: string; side: FlowSide; moved: boolean };

export function flowView(root: HTMLElement, actions: FlowActions): FlowView {
  let screens: GuiScreenInfo[] = [];
  // 만든 플로우 목록 모달. null이면 본체 응답을 기다리는 중이다.
  let listOpen = false;
  let flowItems: FlowListItem[] | null = null;
  let cards: FlowCard[] = [];
  let links: FlowLink[] = [];
  let selected: { kind: 'card' | 'link'; id: string } | null = null;
  let query = '';
  const collapsedCategories = new Set<string>();
  let title = '';
  let seq = 0;
  let drag: Drag | null = null;
  // 끌고 있는 동안의 표시: 배포 화면을 놓을 자리, 잇는 중인 화살표 미리보기(캔버스 단위)
  let dropBox: FlowBox | null = null;
  let preview: FlowPoint[] | null = null;
  // 배포 화면을 끌어 놓은 직후의 click은 무시한다.
  let suppressClick = false;
  // 판을 움직인 만큼(px)과 배율. 처음에는 (0, 0)이 판 왼쪽 위에 보인다.
  let pan = { ...INSET };
  let scale = SCALE.initial;
  // Space를 누르고 있으면 왼쪽 버튼으로 끌어도 판을 움직인다.
  let spaceDown = false;

  const view = () => root.querySelector<HTMLElement>('.flow-view');
  const board = () => view()?.querySelector<HTMLElement>('.flow-board') ?? null;
  // 배포 화면 uid → 정보. 그릴 때마다 썸네일마다 찾으므로 화면 목록을 받을 때 한 번만 만든다.
  let byUid = new Map<string, GuiScreenInfo>();
  const info = () => byUid;
  // 마지막으로 계산한 화살표 경로. 썸네일 자리·크기와 연결이 같으면 다시 계산하지 않는다(경로 찾기가 판에서 가장 비싸다).
  let arrowCache: { sig: string; arrows: ReturnType<typeof flowArrows> } | null = null;
  // 잇는 중인 미리보기 경로의 대상(썸네일 key·변). 같으면 경로를 다시 찾지 않는다.
  let previewTarget = '';
  const published = () => screens.filter(s => s.status === 'active' && s.version > 0)
    .sort((a, b) => (a.category?.order ?? Infinity) - (b.category?.order ?? Infinity) || a.code.localeCompare(b.code, 'ko') || a.name.localeCompare(b.name, 'ko'));
  const sizeOf = (uid: string) => flowImageSize(info().get(uid)?.thumb ?? null);
  const imageOf = (card: FlowCard): FlowBox => ({ x: card.x, y: card.y, ...sizeOf(card.uid) });
  const images = () => new Map(cards.map(c => [c.key, imageOf(c)]));
  const px = (v: number) => Math.round(v * scale * 100) / 100;

  // 첫 빈 자리: 위에서부터, 같은 높이에서는 왼쪽부터 격자점을 살펴 다른 썸네일과 화면 간격(가로·세로 80) 이상 떨어진 곳.
  // 한 줄은 판 너비까지(썸네일이 더 오른쪽에 있으면 거기까지)이고, 줄 맨 앞(0)에는 너비와 관계없이 놓는다.
  function firstFree(size: { w: number; h: number }): FlowPoint {
    const L = FLOW_LAYOUT;
    const boxes = cards.map(imageOf);
    const limit = Math.max(((board()?.clientWidth ?? 0) - 2 * INSET.x) / scale, ...boxes.map(b => b.x + b.w));
    const free = (x: number, y: number) => boxes.every(b => x >= b.x + b.w + L.gapX || b.x >= x + size.w + L.gapX || y >= b.y + b.h + L.gapY || b.y >= y + size.h + L.gapY);
    for (let y = 0; ; y += FLOW_SNAP) for (let x = 0; x === 0 || x + size.w <= limit; x += FLOW_SNAP) if (free(x, y)) return [x, y];
  }

  // 창 좌표 → 판 좌표(캔버스 단위). inside면 판 밖일 때 null
  function boardPoint(x: number, y: number, inside = true): FlowPoint | null {
    const el = board();
    if (!el) return null;
    const box = el.getBoundingClientRect();
    if (inside && (x < box.left || y < box.top || x > box.right || y > box.bottom)) return null;
    return [(x - box.left - pan.x) / scale, (y - box.top - pan.y) / scale];
  }

  // 움직인 만큼 썸네일·화살표와 판 배경의 격자 선(격자점 = 썸네일 왼쪽 위가 맞는 자리)을 옮긴다. 다시 그리지 않는다.
  function applyPan() {
    const el = board();
    if (!el) return;
    let gap = FLOW_SNAP * scale;
    while (gap < MIN_LINE_GAP) gap *= 2;
    el.style.backgroundSize = `${gap}px ${gap}px`;
    el.style.backgroundPosition = `${pan.x}px ${pan.y}px`;
    const grid = el.querySelector<HTMLElement>('.flow-grid');
    if (grid) grid.style.transform = `translate(${pan.x}px, ${pan.y}px)`;
  }

  function paintScreens() {
    const box = view()?.querySelector<HTMLElement>('.flow-screens');
    if (!box) return;
    const all = published();
    const q = query.trim().toLocaleLowerCase();
    const shown = q ? all.filter(s => `${s.code} ${s.name}`.toLocaleLowerCase().includes(q)) : all;
    if (!shown.length) { box.innerHTML = `<p class="empty">${all.length ? COPY.flow036 : COPY.flow035}</p>`; return; }
    const grouped = new Map<string, { name: string; order: number; items: GuiScreenInfo[] }>();
    for (const screen of shown) {
      const key = screen.category?.id ?? '';
      let group = grouped.get(key);
      if (!group) { group = { name: screen.category?.name ?? COPY.coreList001, order: screen.category?.order ?? -1, items: [] }; grouped.set(key, group); }
      group.items.push(screen);
    }
    const row = (s: GuiScreenInfo) => `<div class="flow-screen" data-uid="${esc(s.uid)}"${s.thumb ? ` data-thumb="${esc(s.thumb.hash)}"` : ''} title="${esc(s.name)}"><span class="id-tag">${esc(s.code)}</span><span class="label">${esc(s.name)}</span></div>`;
    box.innerHTML = [...grouped].sort(([keyA, a], [keyB, b]) => a.order - b.order || a.name.localeCompare(b.name, 'ko') || keyA.localeCompare(keyB))
      .map(([key, group]) => {
        const open = !!q || !collapsedCategories.has(key);
        return `<div class="group flow-category" data-category-key="${esc(key)}"><div class="group-bar"><button class="group-head flow-category-label" aria-expanded="${open}"><span class="caret">${open ? '▾' : '▸'}</span><span class="group-name">${esc(group.name)}</span><span class="count">${group.items.length}</span></button></div>${open ? group.items.map(row).join('') : ''}</div>`;
      }).join('');
  }

  // 썸네일 내용: 이미지(받는 중이면 회색), 왼쪽 위 Screen ID
  function thumbHtml(s: GuiScreenInfo | undefined, uid: string): string {
    const url = s?.thumb ? actions.thumb(s.thumb.hash) : null;
    const image = url ? `<img src="${url}" alt="" draggable="false">` : `<span class="flow-card-empty">${s?.thumb ? '' : COPY.flow005}</span>`;
    return `${image}<span class="flow-card-id">${esc(s?.code || s?.name || uid)}</span>`;
  }

  const pathData = (points: FlowPoint[]) => points.map((p, i) => `${i ? 'L' : 'M'}${px(p[0])} ${px(p[1])}`).join(' ');

  // 지금 썸네일·연결의 화살표 경로(캔버스 단위라 배율과 관계없다)
  function currentArrows(boxes: Map<string, FlowBox>) {
    const sig = [[...boxes].map(([key, b]) => `${key}:${b.x},${b.y},${b.w},${b.h}`).join(';'), links.map(linkId).join(';')].join('|');
    if (arrowCache?.sig !== sig) arrowCache = { sig, arrows: flowArrows(boxes, links, 0) };
    return arrowCache.arrows;
  }

  // 배포 화면을 놓을 자리만 옅게 칠한다.
  const dropStyle = (b: FlowBox) => `left:${px(b.x)}px;top:${px(b.y)}px;width:${px(b.w)}px;height:${px(b.h)}px`;

  function paintBoard() {
    const el = board();
    if (!el) return;
    const screensBy = info();
    const boxes = images();
    const drop = dropBox ? `<div class="flow-drop" style="${dropStyle(dropBox)}"></div>` : '';
    const arrows = currentArrows(boxes);
    const paths = arrows.map(({ link, points }) => {
      const d = pathData(points);
      const id = esc(linkId(link));
      const on = selected?.kind === 'link' && selected.id === linkId(link);
      return `<path class="flow-link-hit" data-link="${id}" d="${d}"/><path class="flow-link${on ? ' selected' : ''}" data-line="${id}" d="${d}" marker-end="url(#flow-head${on ? '-on' : ''})"/>`;
    }).join('');
    const ghost = preview ? `<path class="flow-link preview" d="${pathData(preview)}" marker-end="url(#flow-head)"/>` : '';
    const cardHtml = cards.map(card => {
      const s = screensBy.get(card.uid);
      const box = boxes.get(card.key)!;
      const on = selected?.kind === 'card' && selected.id === card.key;
      const moving = drag?.kind === 'card' && drag.moved && drag.key === card.key;
      return `<div class="flow-card${on ? ' selected' : ''}${moving ? ' moving' : ''}" data-key="${esc(card.key)}" title="${esc(s ? `${s.code} ${s.name}`.trim() : card.uid)}" style="left:${px(box.x)}px;top:${px(box.y)}px;width:${px(box.w)}px;height:${px(box.h)}px">
          ${thumbHtml(s, card.uid)}
          <button class="flow-card-remove" data-remove="${esc(card.key)}" title="${COPY.flow029}" aria-label="${COPY.flow029}">${X_ICON}</button>
          ${SIDES.map(side => `<span class="flow-dot" data-side="${side}"></span>`).join('')}</div>`;
    }).join('');
    const area = linksBox([...arrows.map(a => a.points), ...(preview ? [preview] : [])], [...boxes.values()]);
    // 화살촉은 선 굵기와 관계없이 같은 크기(userSpaceOnUse)로 그린다.
    const marker = (id: string, on: boolean) => `<marker id="${id}" viewBox="0 0 10 10" refX="10" refY="5" markerUnits="userSpaceOnUse" markerWidth="${HEAD}" markerHeight="${HEAD}" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="flow-arrowhead${on ? ' on' : ''}"/></marker>`;
    el.innerHTML = `<div class="flow-grid${drag?.kind === 'link' ? ' linking' : ''}">${drop}
      <svg class="flow-links" style="left:${area.x}px;top:${area.y}px" width="${area.w}" height="${area.h}" viewBox="${area.x} ${area.y} ${area.w} ${area.h}"><defs>${marker('flow-head', false)}${marker('flow-head-on', true)}</defs>${paths}${ghost}</svg>${cardHtml}</div>`;
    applyPan();
    paintActions();
  }

  // 화살표 SVG는 썸네일·경로를 모두 덮는 범위(px, 음수 자리 포함)로 둔다.
  function linksBox(paths: FlowPoint[][], boxes: FlowBox[]): { x: number; y: number; w: number; h: number } {
    const margin = 2 * HEAD;
    const xs = [0, ...paths.flat().map(p => px(p[0])), ...boxes.flatMap(b => [px(b.x), px(b.x + b.w)])];
    const ys = [0, ...paths.flat().map(p => px(p[1])), ...boxes.flatMap(b => [px(b.y), px(b.y + b.h)])];
    const x = Math.floor(Math.min(...xs) - margin), y = Math.floor(Math.min(...ys) - margin);
    return { x, y, w: Math.ceil(Math.max(...xs) + margin - x), h: Math.ceil(Math.max(...ys) + margin - y) };
  }

  // 잇는 중에는 포인터가 움직일 때마다 미리보기 경로와 SVG 범위만 바꾼다(판 전체를 다시 그리지 않는다).
  function paintPreview() {
    const svg = board()?.querySelector<SVGSVGElement>('.flow-links');
    if (!svg) { paintBoard(); return; }
    let path = svg.querySelector<SVGPathElement>('.flow-link.preview');
    if (!preview) { path?.remove(); return; }
    if (!path) {
      path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'flow-link preview');
      path.setAttribute('marker-end', 'url(#flow-head)');
      svg.appendChild(path);
    }
    path.setAttribute('d', pathData(preview));
    const boxes = images();
    const area = linksBox([...currentArrows(boxes).map(a => a.points), preview], [...boxes.values()]);
    svg.style.left = `${area.x}px`;
    svg.style.top = `${area.y}px`;
    svg.setAttribute('width', String(area.w));
    svg.setAttribute('height', String(area.h));
    svg.setAttribute('viewBox', `${area.x} ${area.y} ${area.w} ${area.h}`);
  }

  // 고른 썸네일·화살표 표시만 바꾼다(판 전체를 다시 그리지 않는다).
  function paintSelection() {
    const el = board();
    if (!el) return;
    for (const card of el.querySelectorAll<HTMLElement>('.flow-card[data-key]')) card.classList.toggle('selected', selected?.kind === 'card' && selected.id === card.dataset.key);
    for (const line of el.querySelectorAll<SVGPathElement>('.flow-link[data-line]')) {
      const on = selected?.kind === 'link' && selected.id === line.dataset.line;
      line.classList.toggle('selected', on);
      line.setAttribute('marker-end', `url(#flow-head${on ? '-on' : ''})`);
    }
  }

  // 배포 화면을 끄는 동안 놓을 자리 표시만 옮긴다.
  function paintDrop() {
    const grid = board()?.querySelector<HTMLElement>('.flow-grid');
    if (!grid) { paintBoard(); return; }
    let el = grid.querySelector<HTMLElement>('.flow-drop');
    if (!dropBox) { el?.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.className = 'flow-drop';
      grid.prepend(el);
    }
    el.setAttribute('style', dropStyle(dropBox));
  }

  function flowItem(f: FlowListItem): string {
    const meta = [f.pageName, actions.time(f.createdAt), f.actor.name, `${COPY.flow052} ${f.screens.length}${COPY.flow053}`].filter(Boolean).map(esc).join(' · ');
    const chips = f.screens.map(s => `<button class="flow-list-screen" data-action="flow-reveal" data-flow="${esc(f.id)}" data-uid="${esc(s.uid)}" title="${esc(s.name)}">${s.code ? `<span class="id-tag">${esc(s.code)}</span>` : ''}<span class="label">${esc(s.name)}</span></button>`).join('');
    return `<li><button class="link flow-list-title" data-action="flow-reveal" data-flow="${esc(f.id)}">${esc(f.title)}</button><small>${meta}</small><div class="flow-list-screens">${chips}</div></li>`;
  }

  function paintList() {
    let overlay = root.querySelector<HTMLElement>('.flow-list-overlay');
    if (!listOpen) { overlay?.remove(); return; }
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'overlay flow-list-overlay';
      root.appendChild(overlay);
    }
    const body = !flowItems ? `<p class="note">${COPY.uiApp001}</p>`
      : flowItems.length ? `<ul class="flow-list">${flowItems.map(flowItem).join('')}</ul>` : `<p class="empty">${COPY.flow049}</p>`;
    overlay.innerHTML = `<div class="dialog flow-list-dialog" role="dialog" aria-modal="true" aria-label="${COPY.flow047}">
      <h2>${COPY.flow047}</h2><p class="note">${COPY.flow050}</p>${body}
      <div class="dialog-actions"><button data-action="flow-list-close">${COPY.flow051}</button></div></div>`;
  }

  function closeList() {
    listOpen = false;
    paintList();
  }

  function paintActions() {
    const el = view();
    if (!el) return;
    el.querySelector('[data-action="flow-create"]')?.toggleAttribute('disabled', cards.length < 2);
    el.querySelector('[data-action="flow-clear"]')?.toggleAttribute('disabled', !cards.length);
  }

  // at: 놓을 썸네일 왼쪽 위(격자에 맞춘 값). 없으면 첫 빈 자리
  function place(uid: string, at: FlowPoint | null) {
    const [x, y] = at ?? firstFree(sizeOf(uid));
    const key = `f${++seq}`;
    cards.push({ key, uid, x, y });
    selected = { kind: 'card', id: key };
  }

  // 배포 화면을 끌어 놓을 자리: 포인터가 썸네일 가운데가 되게 하고 왼쪽 위를 격자에 맞춘다.
  function dropSpot(uid: string, x: number, y: number): FlowBox | null {
    const p = boardPoint(x, y);
    if (!p) return null;
    const size = sizeOf(uid);
    return { x: snap(p[0] - size.w / 2), y: snap(p[1] - size.h / 2), ...size };
  }

  function removeCard(key: string) {
    cards = cards.filter(c => c.key !== key);
    links = links.filter(l => l.from !== key && l.to !== key);
    if (selected?.id === key) selected = null;
  }

  function connect(from: string, side: FlowSide, target: HTMLElement | null) {
    const cardEl = target?.closest<HTMLElement>('.flow-card');
    const to = cardEl?.dataset.key;
    const a = cards.find(c => c.key === from), b = cards.find(c => c.key === to);
    if (!a || !b || a === b) return;
    const dot = target?.closest<HTMLElement>('.flow-dot')?.dataset.side as FlowSide | undefined;
    const link: FlowLink = { from, fromSide: side, to: b.key, toSide: dot ?? facingSide(imageOf(a), imageOf(b)) };
    if (!links.some(l => linkId(l) === linkId(link))) links.push(link);
    selected = { kind: 'link', id: linkId(link) };
  }

  function listen() {
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
  }

  function onPointerDown(ev: PointerEvent) {
    const target = ev.target as HTMLElement;
    // 판 움직이기: 가운데 버튼, 또는 Space를 누른 채 왼쪽 버튼(Figma 캔버스와 같다)
    if (target.closest('.flow-board') && (ev.button === 1 || (ev.button === 0 && spaceDown))) {
      drag = { kind: 'pan', x: ev.clientX, y: ev.clientY, from: { ...pan } };
      board()?.classList.add('panning');
      ev.preventDefault();
      listen();
      return;
    }
    if (ev.button !== 0) return;
    const removeKey = target.closest<HTMLElement>('[data-remove]')?.dataset.remove;
    if (removeKey) { removeCard(removeKey); paintBoard(); ev.preventDefault(); return; }
    const screen = target.closest<HTMLElement>('.flow-screen');
    const dot = target.closest<HTMLElement>('.flow-dot');
    const card = target.closest<HTMLElement>('.flow-card');
    const hit = target.closest<SVGElement>('[data-link]');
    if (screen) drag = { kind: 'screen', uid: screen.dataset.uid!, x: ev.clientX, y: ev.clientY, moved: false, ghost: null };
    else if (dot && card) {
      drag = { kind: 'link', from: card.dataset.key!, side: dot.dataset.side as FlowSide, moved: false };
      previewTarget = '';
      board()?.querySelector('.flow-grid')?.classList.add('linking');
    }
    else if (card) {
      const c = cards.find(x => x.key === card.dataset.key);
      const p = boardPoint(ev.clientX, ev.clientY, false);
      if (!c || !p) return;
      drag = { kind: 'card', key: c.key, x: ev.clientX, y: ev.clientY, moved: false, grab: [p[0] - c.x, p[1] - c.y] };
    } else if (hit) { selected = { kind: 'link', id: hit.dataset.link! }; paintSelection(); return; }
    else if (target.closest('.flow-board')) { selected = null; paintSelection(); return; }
    else return;
    ev.preventDefault();
    listen();
  }

  function onPointerMove(ev: PointerEvent) {
    if (!drag) return;
    if (drag.kind === 'pan') {
      pan = { x: drag.from.x + ev.clientX - drag.x, y: drag.from.y + ev.clientY - drag.y };
      applyPan();
      return;
    }
    if (drag.kind === 'link') {
      drag.moved = true;
      const from = drag.from;
      const a = cards.find(c => c.key === from);
      if (!a) return;
      // 썸네일 위에 있으면 실제로 이어질 경로, 아니면 점에서 포인터까지 곧은 선을 보여 준다.
      const under = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      const over = under?.closest<HTMLElement>('.flow-card');
      const b = over && cards.find(c => c.key === over.dataset.key && c.key !== a.key);
      const dot = under?.closest<HTMLElement>('.flow-dot')?.dataset.side as FlowSide | undefined;
      const at = boardPoint(ev.clientX, ev.clientY);
      const boxA = imageOf(a);
      if (b) {
        const boxB = imageOf(b);
        const toSide = dot ?? facingSide(boxA, boxB);
        // 같은 썸네일·변 위에서 움직이는 동안은 경로가 같다.
        const targetKey = `${b.key}:${toSide}`;
        if (targetKey === previewTarget) return;
        previewTarget = targetKey;
        const others = cards.filter(c => c !== a && c !== b).map(imageOf);
        preview = routeLink(boxA, drag.side, boxB, toSide, others);
      } else {
        previewTarget = '';
        preview = at ? [sidePoint(boxA, drag.side), at] : null;
      }
      paintPreview();
      return;
    }
    if (!drag.moved && Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) < DRAG_START) return;
    const started = !drag.moved;
    drag.moved = true;
    if (drag.kind === 'screen') {
      if (!drag.ghost) {
        const s = info().get(drag.uid);
        drag.ghost = document.createElement('div');
        drag.ghost.className = 'flow-card flow-ghost';
        drag.ghost.innerHTML = thumbHtml(s, drag.uid);
        root.appendChild(drag.ghost);
      }
      const size = sizeOf(drag.uid);
      const r = root.getBoundingClientRect();
      drag.ghost.style.width = `${px(size.w)}px`;
      drag.ghost.style.height = `${px(size.h)}px`;
      drag.ghost.style.left = `${ev.clientX - r.left - px(size.w) / 2}px`;
      drag.ghost.style.top = `${ev.clientY - r.top - px(size.h) / 2}px`;
      const spot = dropSpot(drag.uid, ev.clientX, ev.clientY);
      if (spot?.x !== dropBox?.x || spot?.y !== dropBox?.y) { dropBox = spot; paintDrop(); }
      return;
    }
    // 썸네일은 격자 간격으로 따라오고, 자리가 바뀔 때마다 화살표를 다시 그린다.
    const { key, grab } = drag;
    const card = cards.find(c => c.key === key);
    const p = boardPoint(ev.clientX, ev.clientY, false);
    if (!card || !p) return;
    const x = snap(p[0] - grab[0]), y = snap(p[1] - grab[1]);
    if (started || x !== card.x || y !== card.y) {
      card.x = x;
      card.y = y;
      paintBoard();
    }
  }

  function onPointerUp(ev: PointerEvent) {
    window.removeEventListener('pointermove', onPointerMove);
    const d = drag;
    drag = null;
    preview = null;
    dropBox = null;
    if (!d) return;
    if (d.kind === 'pan') { board()?.classList.remove('panning'); return; }
    if (d.kind === 'screen') {
      d.ghost?.remove();
      // 누르기만 했으면 click이 첫 빈 자리에 놓는다(튜토리얼처럼 click만 보내는 경우도 같은 경로).
      if (d.moved) {
        suppressClick = true;
        setTimeout(() => { suppressClick = false; }, 0);
        const spot = dropSpot(d.uid, ev.clientX, ev.clientY);
        if (spot) place(d.uid, [spot.x, spot.y]);
      }
    } else if (d.kind === 'card') {
      // 누르기만 했으면 고른 표시만 바꾼다.
      if (!d.moved) { selected = { kind: 'card', id: d.key }; paintSelection(); return; }
    } else if (d.moved) connect(d.from, d.side, document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null);
    paintBoard();
  }

  // 포인터 아래의 판 자리를 그대로 두고 배율을 바꾼다.
  function zoom(factor: number, clientX: number, clientY: number) {
    const el = board();
    if (!el) return;
    const next = Math.min(SCALE.max, Math.max(SCALE.min, scale * factor));
    if (next === scale) return;
    const box = el.getBoundingClientRect();
    const mx = clientX - box.left, my = clientY - box.top;
    pan = { x: mx - (mx - pan.x) * next / scale, y: my - (my - pan.y) * next / scale };
    scale = next;
    paintBoard();
  }

  document.addEventListener('keydown', ev => {
    if (!view()) return;
    // 목록 모달이 열려 있으면 Esc로 닫고, 판의 썸네일·화살표는 지우지 않는다.
    if (listOpen) {
      if (ev.key === 'Escape') { ev.preventDefault(); closeList(); }
      return;
    }
    if (typing()) return;
    // Space: 판 움직이기 준비. 누르는 동안 손 모양 커서를 보여 준다.
    if (ev.code === 'Space') {
      ev.preventDefault();
      if (!spaceDown) { spaceDown = true; board()?.classList.add('space-pan'); }
      return;
    }
    if (!selected || (ev.key !== 'Delete' && ev.key !== 'Backspace')) return;
    ev.preventDefault();
    if (selected.kind === 'card') removeCard(selected.id);
    else { const id = selected.id; links = links.filter(l => linkId(l) !== id); selected = null; }
    paintBoard();
  });
  document.addEventListener('keyup', ev => {
    if (ev.code !== 'Space') return;
    spaceDown = false;
    board()?.classList.remove('space-pan');
  });

  function build(el: HTMLElement) {
    el.innerHTML = `<section class="flow-pick">
        <div class="flow-head"><strong>${COPY.flow021}</strong></div>
        <input class="flow-search" type="search" data-flow="query" value="${esc(query)}" placeholder="${COPY.flow022}" aria-label="${COPY.flow022}">
        <div class="flow-screens"></div>
      </section>
      <section class="flow-order">
        <div class="flow-head"><div class="flow-head-title"><strong>${COPY.flow023}</strong><p class="note">${COPY.flow034}</p></div>
          <div class="flow-actions"><button class="icon-button" data-action="flow-list" title="${COPY.flow047}" aria-label="${COPY.flow047}">${HISTORY_ICON}</button><button data-action="flow-clear">${COPY.flow033}</button><button class="primary" data-action="flow-create">${COPY.flow032}</button></div></div>
        <div class="flow-form"><label>${COPY.flow030}<input data-flow="title" value="${esc(title)}" placeholder="${esc(FLOW_DEFAULT_TITLE)}"></label></div>
        <div class="flow-board"></div>
        <p class="note flow-hint">${COPY.flow024}<br>${COPY.flow037}<br>${COPY.flow046}</p>
      </section>`;
    el.addEventListener('input', ev => {
      const input = ev.target as HTMLInputElement;
      if (input.dataset.flow === 'query') { query = input.value; paintScreens(); }
      else if (input.dataset.flow === 'title') title = input.value;
    });
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('click', ev => {
      const categoryLabel = (ev.target as HTMLElement).closest<HTMLElement>('.flow-category-label');
      if (categoryLabel && !query.trim()) {
        const key = categoryLabel.closest<HTMLElement>('.flow-category')!.dataset.categoryKey!;
        if (collapsedCategories.has(key)) collapsedCategories.delete(key);
        else collapsedCategories.add(key);
        paintScreens();
        return;
      }
      const screen = (ev.target as HTMLElement).closest<HTMLElement>('.flow-screen');
      if (!screen || suppressClick) return;
      place(screen.dataset.uid!, null);
      paintBoard();
    });
    // 휠·트랙패드로 판을 움직이고(Shift+휠은 가로), Ctrl(⌘)+휠·핀치로 확대·축소한다. 가운데 버튼의 자동 스크롤은 막는다.
    const boardEl = el.querySelector<HTMLElement>('.flow-board')!;
    boardEl.addEventListener('wheel', ev => {
      ev.preventDefault();
      if (ev.ctrlKey || ev.metaKey) { zoom(Math.exp(-Math.max(-100, Math.min(100, ev.deltaY)) * ZOOM_SPEED), ev.clientX, ev.clientY); return; }
      const sideways = ev.shiftKey && !ev.deltaX;
      pan = { x: pan.x - (sideways ? ev.deltaY : ev.deltaX), y: pan.y - (sideways ? 0 : ev.deltaY) };
      applyPan();
    }, { passive: false });
    boardEl.addEventListener('mousedown', ev => { if (ev.button === 1) ev.preventDefault(); });
    paintScreens();
    paintBoard();
  }

  return {
    render(open) {
      root.classList.toggle('flowing-mode', open);
      let el = view();
      if (!open) { el?.remove(); if (listOpen) closeList(); return; }
      // 이미 열려 있으면 다시 그리지 않는다(입력 중인 커서 유지).
      if (el) return;
      el = document.createElement('div');
      el.className = 'flow-view';
      root.appendChild(el);
      build(el);
    },
    setScreens(next) {
      screens = next;
      byUid = new Map(screens.map(s => [s.uid, s]));
      paintScreens();
      paintBoard();
    },
    setFlows(next) {
      flowItems = next;
      paintList();
    },
    thumbsLoaded(hashes) {
      // 끄는 중에는 다시 그리지 않는다(놓을 때 그린다). 판에 없는 화면의 이미지는 영향이 없다.
      if (!view() || drag || !cards.length) return;
      const loaded = new Set(hashes);
      if (cards.some(card => loaded.has(info().get(card.uid)?.thumb?.hash ?? ''))) paintBoard();
    },
    handle(action, el) {
      switch (action) {
        case 'flow-clear': cards = []; links = []; selected = null; paintBoard(); return true;
        case 'flow-create':
          if (cards.length >= 2) actions.create({ title, cards: cards.map(c => ({ ...c })), links: links.map(l => ({ ...l })) });
          return true;
        case 'flow-list':
          listOpen = true;
          flowItems = null;
          paintList();
          root.querySelector<HTMLElement>('.flow-list-dialog .dialog-actions button')?.focus();
          actions.list();
          return true;
        case 'flow-list-close': closeList(); return true;
        case 'flow-reveal':
          if (el.dataset.flow) actions.reveal(el.dataset.flow, el.dataset.uid);
          return true;
      }
      return false;
    },
  };
}
