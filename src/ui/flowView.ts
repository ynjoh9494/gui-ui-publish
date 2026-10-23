import { COPY } from '../core/copy.ts';
import { FLOW_DEFAULT_TITLE, routeLink, sidePoint, type FlowCard, type FlowGrid, type FlowLink, type FlowRequest, type FlowSide } from '../core/flow.ts';
import type { GuiScreenInfo } from '../core/guiScreens.ts';

// 플로우 탭(2026-10-23 사용자 결정): 배포된 화면을 격자에 카드로 놓고 FigJam처럼 잇는다. 텍스트 편집처럼 부가 기능이다.
// - 왼쪽 배포 화면을 누르면 첫 빈 칸에, 끌어 놓으면 그 칸에 카드를 놓는다(같은 화면을 여러 번 놓을 수 있다).
// - 카드는 모두 같은 크기이고 격자 칸에만 놓인다. 끌어서 다른 칸으로 옮기며, 카드가 있는 칸에 놓으면 서로 바꾼다.
// - 카드 상하좌우 점을 끌어 다른 카드에 놓으면 꺾인 화살표로 잇는다. 점 위에 놓으면 그 변, 카드 위에 놓으면 마주 보는 변에 닿는다.
// - 고른 카드·화살표는 Delete(Backspace)로 지운다. 라벨은 없다(글은 캔버스의 빨간 더미 글자 칸에 쓴다).
// - 판은 끝없는 격자이고 Figma 캔버스처럼 움직인다: 가운데 버튼·Space+끌기, 휠(Shift+휠은 가로)·트랙패드. 스크롤 막대는 없다.
// 화살표 경로는 캔버스와 같은 규칙(core/flow.ts routeLink)이라 빈 칸 직선 통과를 포함해 창에서 본 모양 그대로 그려진다. 내용은 탭을 오가도 남는다(플러그인을 닫으면 지워짐).

export interface FlowView {
  render(open: boolean): void;
  setScreens(screens: GuiScreenInfo[]): void;
  // 플로우 탭의 버튼(data-action="flow-…"). 처리했으면 true
  handle(action: string, el: HTMLElement): boolean;
}

// 창 안 격자: 카드 크기와 칸 사이 통로. 라벨이 없으므로 통로는 화살표가 지날 만큼만 둔다(2026-10-23 사용자 요청: 이전 56·44의 절반).
const CARD = { w: 136, h: 48 };
const GAP = { x: 28, y: 22 };
const PITCH = { x: CARD.w + GAP.x, y: CARD.h + GAP.y };
const GRID: FlowGrid = { x0: GAP.x / 2 + 6, y0: GAP.y / 2 + 6, cellW: CARD.w, cellH: CARD.h, gapX: GAP.x, gapY: GAP.y };
// 화살촉 크기(px). 선 굵기와 관계없이 같은 크기로 그린다(2026-10-23 사용자 요청: 이전의 1/2 정도).
const HEAD = 5;
const DRAG_START = 4;

const X_ICON = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
const SIDES: FlowSide[] = ['top', 'right', 'bottom', 'left'];

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

const pathData = (points: [number, number][]) => points.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
const linkId = (l: FlowLink) => `${l.from}:${l.fromSide}>${l.to}:${l.toSide}`;
const cellX = (c: number) => GRID.x0 + c * PITCH.x;
const cellY = (r: number) => GRID.y0 + r * PITCH.y;
const typing = () => {
  const a = document.activeElement;
  return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || (a instanceof HTMLElement && a.isContentEditable);
};

// 점이 아닌 카드 위에 놓으면 출발 카드를 마주 보는 변에 닿는다.
function facingSide(from: { r: number; c: number }, to: { r: number; c: number }): FlowSide {
  const dc = to.c - from.c, dr = to.r - from.r;
  if (dc !== 0 && Math.abs(dc) >= Math.abs(dr)) return dc > 0 ? 'left' : 'right';
  return dr > 0 ? 'top' : 'bottom';
}

type Drag =
  | { kind: 'pan'; x: number; y: number; from: { x: number; y: number } }
  | { kind: 'screen'; uid: string; x: number; y: number; moved: boolean; ghost: HTMLElement | null }
  | { kind: 'card'; key: string; x: number; y: number; moved: boolean }
  | { kind: 'link'; from: string; side: FlowSide; moved: boolean };

export function flowView(root: HTMLElement, send: (request: FlowRequest) => void): FlowView {
  let screens: GuiScreenInfo[] = [];
  let cards: FlowCard[] = [];
  let links: FlowLink[] = [];
  let selected: { kind: 'card' | 'link'; id: string } | null = null;
  let query = '';
  const collapsedCategories = new Set<string>();
  let title = '';
  let seq = 0;
  let drag: Drag | null = null;
  // 끌고 있는 동안의 표시: 놓을 칸, 잇는 중인 화살표 미리보기
  let dropCell: { r: number; c: number } | null = null;
  let preview: [number, number][] | null = null;
  // 배포 화면을 끌어 놓은 직후의 click은 무시한다.
  let suppressClick = false;
  // 판을 움직인 만큼(px). 처음에는 칸 (0, 0)이 판 왼쪽 위에 보인다.
  let pan = { x: 0, y: 0 };
  // Space를 누르고 있으면 왼쪽 버튼으로 끌어도 판을 움직인다.
  let spaceDown = false;

  const view = () => root.querySelector<HTMLElement>('.flow-view');
  const board = () => view()?.querySelector<HTMLElement>('.flow-board') ?? null;
  const info = () => new Map(screens.map(s => [s.uid, s]));
  const published = () => screens.filter(s => s.status === 'active' && s.version > 0)
    .sort((a, b) => (a.category?.order ?? Infinity) - (b.category?.order ?? Infinity) || a.code.localeCompare(b.code, 'ko') || a.name.localeCompare(b.name, 'ko'));
  const cardAt = (r: number, c: number) => cards.find(x => x.r === r && x.c === c);

  // 첫 빈 칸: 칸 (0, 0)부터 위 줄부터, 줄 안에서는 왼쪽부터. 한 줄은 판 너비에 들어가는 칸 수(카드가 더 오른쪽에 있으면 거기까지)다.
  function firstEmpty(): { r: number; c: number } {
    const width = board()?.clientWidth ?? 0;
    const cols = Math.max(1, Math.floor((width - 2 * GRID.x0 + GAP.x) / PITCH.x), ...cards.map(c => c.c + 1));
    for (let r = 0; ; r++) for (let c = 0; c < cols; c++) if (!cardAt(r, c)) return { r, c };
  }

  // 창 좌표 → 판 좌표(움직인 만큼 뺀 값). 판 밖이면 null
  function boardPoint(x: number, y: number): [number, number] | null {
    const el = board();
    if (!el) return null;
    const box = el.getBoundingClientRect();
    if (x < box.left || y < box.top || x > box.right || y > box.bottom) return null;
    return [x - box.left - pan.x, y - box.top - pan.y];
  }

  // 창 좌표 → 격자 칸(통로 절반까지 그 칸으로 본다). 왼쪽·위로 움직여 음수 칸에도 놓을 수 있다(만들 때 왼쪽 위 카드를 첫 칸으로 당긴다).
  function cellFromPoint(x: number, y: number): { r: number; c: number } | null {
    const p = boardPoint(x, y);
    if (!p) return null;
    return { r: Math.floor((p[1] - GRID.y0 + GAP.y / 2) / PITCH.y), c: Math.floor((p[0] - GRID.x0 + GAP.x / 2) / PITCH.x) };
  }

  // 움직인 만큼 격자(카드·화살표)와 판 배경의 격자 선(칸 사이 통로 가운데)을 옮긴다. 다시 그리지 않는다.
  function applyPan() {
    const el = board();
    if (!el) return;
    el.style.backgroundSize = `${PITCH.x}px ${PITCH.y}px`;
    el.style.backgroundPosition = `${pan.x + GRID.x0 - GAP.x / 2}px ${pan.y + GRID.y0 - GAP.y / 2}px`;
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

  function paintBoard() {
    const el = board();
    if (!el) return;
    const byKey = new Map(cards.map(c => [c.key, c]));
    const screensBy = info();
    // 놓을 칸만 옅게 칠한다. 칸 틀은 그리지 않는다.
    const drop = dropCell ? `<div class="flow-drop" style="left:${cellX(dropCell.c)}px;top:${cellY(dropCell.r)}px"></div>` : '';
    const paths = links.flatMap(l => {
      const a = byKey.get(l.from), b = byKey.get(l.to);
      if (!a || !b) return [];
      const d = pathData(routeLink(GRID, a, l.fromSide, b, l.toSide, cards));
      const id = esc(linkId(l));
      const on = selected?.kind === 'link' && selected.id === linkId(l);
      return [`<path class="flow-link-hit" data-link="${id}" d="${d}"/><path class="flow-link${on ? ' selected' : ''}" d="${d}" marker-end="url(#flow-head${on ? '-on' : ''})"/>`];
    }).join('');
    const ghost = preview ? `<path class="flow-link preview" d="${pathData(preview)}" marker-end="url(#flow-head)"/>` : '';
    const cardHtml = cards.map(card => {
      const s = screensBy.get(card.uid);
      const on = selected?.kind === 'card' && selected.id === card.key;
      const moving = drag?.kind === 'card' && drag.moved && drag.key === card.key;
      return `<div class="flow-card${on ? ' selected' : ''}${moving ? ' moving' : ''}" data-key="${esc(card.key)}"${s?.thumb ? ` data-thumb="${esc(s.thumb.hash)}"` : ''} style="left:${cellX(card.c)}px;top:${cellY(card.r)}px">
          <span class="flow-card-id">${esc(s?.code ?? '')}</span><span class="flow-card-name" title="${esc(s?.name ?? card.uid)}">${esc(s?.name ?? card.uid)}</span>
          <button class="flow-card-remove" data-remove="${esc(card.key)}" title="${COPY.flow029}" aria-label="${COPY.flow029}">${X_ICON}</button>
          ${SIDES.map(side => `<span class="flow-dot" data-side="${side}"></span>`).join('')}</div>`;
    }).join('');
    // 화살표 SVG는 카드·경로를 모두 덮는 범위(음수 칸 포함)로 둔다.
    const xs = [0, ...cards.flatMap(c => [cellX(c.c) - GAP.x, cellX(c.c) + PITCH.x]), ...(preview ?? []).map(p => p[0])];
    const ys = [0, ...cards.flatMap(c => [cellY(c.r) - GAP.y, cellY(c.r) + PITCH.y]), ...(preview ?? []).map(p => p[1])];
    const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs) + 1, h: Math.max(...ys) - Math.min(...ys) + 1 };
    // 화살촉은 선 굵기와 관계없이 같은 크기(userSpaceOnUse)로 그린다.
    const marker = (id: string, on: boolean) => `<marker id="${id}" viewBox="0 0 10 10" refX="10" refY="5" markerUnits="userSpaceOnUse" markerWidth="${HEAD}" markerHeight="${HEAD}" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="flow-arrowhead${on ? ' on' : ''}"/></marker>`;
    el.innerHTML = `<div class="flow-grid${drag?.kind === 'link' ? ' linking' : ''}">${drop}
      <svg class="flow-links" style="left:${box.x}px;top:${box.y}px" width="${box.w}" height="${box.h}" viewBox="${box.x} ${box.y} ${box.w} ${box.h}"><defs>${marker('flow-head', false)}${marker('flow-head-on', true)}</defs>${paths}${ghost}</svg>${cardHtml}</div>`;
    applyPan();
    paintActions();
  }

  function paintActions() {
    const el = view();
    if (!el) return;
    el.querySelector('[data-action="flow-create"]')?.toggleAttribute('disabled', cards.length < 2);
    el.querySelector('[data-action="flow-clear"]')?.toggleAttribute('disabled', !cards.length);
  }

  function place(uid: string, at: { r: number; c: number } | null) {
    const spot = at && !cardAt(at.r, at.c) ? at : firstEmpty();
    const key = `f${++seq}`;
    cards.push({ key, uid, r: spot.r, c: spot.c });
    selected = { kind: 'card', id: key };
  }

  function removeCard(key: string) {
    cards = cards.filter(c => c.key !== key);
    links = links.filter(l => l.from !== key && l.to !== key);
    if (selected?.id === key) selected = null;
  }

  function moveCard(key: string, to: { r: number; c: number }) {
    const card = cards.find(c => c.key === key);
    if (!card || (card.r === to.r && card.c === to.c)) return;
    const other = cardAt(to.r, to.c);
    if (other) { other.r = card.r; other.c = card.c; }
    card.r = to.r;
    card.c = to.c;
  }

  function connect(from: string, side: FlowSide, target: HTMLElement | null) {
    const cardEl = target?.closest<HTMLElement>('.flow-card');
    const to = cardEl?.dataset.key;
    const a = cards.find(c => c.key === from), b = cards.find(c => c.key === to);
    if (!a || !b || a === b) return;
    const dot = target?.closest<HTMLElement>('.flow-dot')?.dataset.side as FlowSide | undefined;
    const link: FlowLink = { from, fromSide: side, to: b.key, toSide: dot ?? facingSide(a, b) };
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
    else if (dot && card) { drag = { kind: 'link', from: card.dataset.key!, side: dot.dataset.side as FlowSide, moved: false }; paintBoard(); }
    else if (card) drag = { kind: 'card', key: card.dataset.key!, x: ev.clientX, y: ev.clientY, moved: false };
    else if (hit) { selected = { kind: 'link', id: hit.dataset.link! }; paintBoard(); return; }
    else if (target.closest('.flow-board')) { selected = null; paintBoard(); return; }
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
      // 카드 위에 있으면 실제로 이어질 경로, 아니면 점에서 포인터까지 곧은 선을 보여 준다.
      const under = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      const over = under?.closest<HTMLElement>('.flow-card');
      const b = over && cards.find(c => c.key === over.dataset.key && c.key !== a.key);
      const dot = under?.closest<HTMLElement>('.flow-dot')?.dataset.side as FlowSide | undefined;
      const at = boardPoint(ev.clientX, ev.clientY);
      preview = b ? routeLink(GRID, a, drag.side, b, dot ?? facingSide(a, b), cards) : at ? [sidePoint(GRID, a, drag.side), at] : null;
      paintBoard();
      return;
    }
    if (!drag.moved && Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) < DRAG_START) return;
    drag.moved = true;
    if (drag.kind === 'screen') {
      if (!drag.ghost) {
        const s = info().get(drag.uid);
        drag.ghost = document.createElement('div');
        drag.ghost.className = 'flow-card flow-ghost';
        drag.ghost.innerHTML = `<span class="flow-card-id">${esc(s?.code ?? '')}</span><span class="flow-card-name">${esc(s?.name ?? '')}</span>`;
        root.appendChild(drag.ghost);
      }
      const r = root.getBoundingClientRect();
      drag.ghost.style.left = `${ev.clientX - r.left - CARD.w / 2}px`;
      drag.ghost.style.top = `${ev.clientY - r.top - CARD.h / 2}px`;
    }
    const cell = cellFromPoint(ev.clientX, ev.clientY);
    if (cell?.r !== dropCell?.r || cell?.c !== dropCell?.c) { dropCell = cell; paintBoard(); }
    if (drag.kind === 'card') {
      const el = board()?.querySelector<HTMLElement>(`.flow-card[data-key="${CSS.escape(drag.key)}"]`);
      if (el) el.style.transform = `translate(${ev.clientX - drag.x}px, ${ev.clientY - drag.y}px)`;
    }
  }

  function onPointerUp(ev: PointerEvent) {
    window.removeEventListener('pointermove', onPointerMove);
    const d = drag;
    drag = null;
    preview = null;
    const cell = cellFromPoint(ev.clientX, ev.clientY);
    dropCell = null;
    if (!d) return;
    if (d.kind === 'pan') { board()?.classList.remove('panning'); return; }
    if (d.kind === 'screen') {
      d.ghost?.remove();
      // 누르기만 했으면 click이 첫 빈 칸에 놓는다(튜토리얼처럼 click만 보내는 경우도 같은 경로).
      if (d.moved) { suppressClick = true; setTimeout(() => { suppressClick = false; }, 0); if (cell) place(d.uid, cell); }
    } else if (d.kind === 'card') {
      if (!d.moved) selected = { kind: 'card', id: d.key };
      else if (cell) moveCard(d.key, cell);
    } else if (d.moved) connect(d.from, d.side, document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null);
    paintBoard();
  }

  document.addEventListener('keydown', ev => {
    if (!view() || typing()) return;
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
          <div class="flow-actions"><button data-action="flow-clear">${COPY.flow033}</button><button class="primary" data-action="flow-create">${COPY.flow032}</button></div></div>
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
    // 휠·트랙패드로 판을 움직인다(Shift+휠은 가로). 가운데 버튼의 자동 스크롤은 막는다.
    const boardEl = el.querySelector<HTMLElement>('.flow-board')!;
    boardEl.addEventListener('wheel', ev => {
      ev.preventDefault();
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
      if (!open) { el?.remove(); return; }
      // 이미 열려 있으면 다시 그리지 않는다(입력 중인 커서 유지).
      if (el) return;
      el = document.createElement('div');
      el.className = 'flow-view';
      root.appendChild(el);
      build(el);
    },
    setScreens(next) {
      screens = next;
      paintScreens();
      paintBoard();
    },
    handle(action) {
      switch (action) {
        case 'flow-clear': cards = []; links = []; selected = null; paintBoard(); return true;
        case 'flow-create':
          if (cards.length >= 2) send({ title, cards: cards.map(c => ({ ...c })), links: links.map(l => ({ ...l })) });
          return true;
      }
      return false;
    },
  };
}
