import { COPY } from '../core/copy.ts';
import { FLOW_DEFAULT_TITLE, routeLink, sidePoint, type FlowCard, type FlowGrid, type FlowLink, type FlowRequest, type FlowSide } from '../core/flow.ts';
import type { GuiScreenInfo } from '../core/guiScreens.ts';

// 플로우 탭(2026-10-23 사용자 결정): 배포된 화면을 격자에 카드로 놓고 FigJam처럼 잇는다. 텍스트 편집처럼 부가 기능이다.
// - 왼쪽 배포 화면을 누르면 첫 빈 칸에, 끌어 놓으면 그 칸에 카드를 놓는다(같은 화면을 여러 번 놓을 수 있다).
// - 카드는 모두 같은 크기이고 격자 칸에만 놓인다. 끌어서 다른 칸으로 옮기며, 카드가 있는 칸에 놓으면 서로 바꾼다.
// - 카드 상하좌우 점을 끌어 다른 카드에 놓으면 꺾인 화살표로 잇는다. 점 위에 놓으면 그 변, 카드 위에 놓으면 마주 보는 변에 닿는다.
// - 고른 카드·화살표는 Delete(Backspace)로 지운다. 라벨은 없다(글은 캔버스의 빨간 더미 글자 칸에 쓴다).
// 화살표 경로는 캔버스와 같은 규칙(core/flow.ts routeLink)이라 창에서 본 모양 그대로 그려진다. 내용은 탭을 오가도 남는다(플러그인을 닫으면 지워짐).

export interface FlowView {
  render(open: boolean): void;
  setScreens(screens: GuiScreenInfo[]): void;
  // 플로우 탭의 버튼(data-action="flow-…"). 처리했으면 true
  handle(action: string, el: HTMLElement): boolean;
}

// 창 안 격자: 카드 크기와 칸 사이 통로. 화살표가 통로 가운데로 지나도록 넉넉히 둔다.
const CARD = { w: 136, h: 48 };
const GAP = { x: 56, y: 44 };
const GRID: FlowGrid = { x0: GAP.x / 2 + 6, y0: GAP.y / 2 + 6, cellW: CARD.w, cellH: CARD.h, gapX: GAP.x, gapY: GAP.y };
// 화면이 없어도 보이는 칸 수. 카드가 놓인 마지막 줄·칸 뒤에 한 줄·한 칸을 더 둔다.
const MIN = { rows: 3, cols: 3 };
const DRAG_START = 4;

const X_ICON = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
const SIDES: FlowSide[] = ['top', 'right', 'bottom', 'left'];

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

const pathData = (points: [number, number][]) => points.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
const linkId = (l: FlowLink) => `${l.from}:${l.fromSide}>${l.to}:${l.toSide}`;

// 점이 아닌 카드 위에 놓으면 출발 카드를 마주 보는 변에 닿는다.
function facingSide(from: { r: number; c: number }, to: { r: number; c: number }): FlowSide {
  const dc = to.c - from.c, dr = to.r - from.r;
  if (dc !== 0 && Math.abs(dc) >= Math.abs(dr)) return dc > 0 ? 'left' : 'right';
  return dr > 0 ? 'top' : 'bottom';
}

type Drag =
  | { kind: 'screen'; uid: string; x: number; y: number; moved: boolean; ghost: HTMLElement | null }
  | { kind: 'card'; key: string; x: number; y: number; moved: boolean }
  | { kind: 'link'; from: string; side: FlowSide; moved: boolean };

export function flowView(root: HTMLElement, send: (request: FlowRequest) => void): FlowView {
  let screens: GuiScreenInfo[] = [];
  let cards: FlowCard[] = [];
  let links: FlowLink[] = [];
  let selected: { kind: 'card' | 'link'; id: string } | null = null;
  let query = '';
  let title = '';
  let seq = 0;
  let drag: Drag | null = null;
  // 끌고 있는 동안의 표시: 놓을 칸, 잇는 중인 화살표 미리보기
  let dropCell: { r: number; c: number } | null = null;
  let preview: [number, number][] | null = null;
  // 배포 화면을 끌어 놓은 직후의 click은 무시한다.
  let suppressClick = false;

  const view = () => root.querySelector<HTMLElement>('.flow-view');
  const board = () => view()?.querySelector<HTMLElement>('.flow-board') ?? null;
  const info = () => new Map(screens.map(s => [s.uid, s]));
  const published = () => screens.filter(s => s.status === 'active' && s.version > 0)
    .sort((a, b) => (a.category?.order ?? Infinity) - (b.category?.order ?? Infinity) || a.code.localeCompare(b.code, 'ko') || a.name.localeCompare(b.name, 'ko'));
  const size = () => ({
    rows: Math.max(MIN.rows, ...cards.map(c => c.r + 2)),
    cols: Math.max(MIN.cols, ...cards.map(c => c.c + 2)),
  });
  const cardAt = (r: number, c: number) => cards.find(x => x.r === r && x.c === c);

  // 첫 빈 칸: 위 줄부터, 줄 안에서는 왼쪽부터. 지금 보이는 칸 수 안에서 찾고 없으면 아래에 새 줄을 쓴다.
  function firstEmpty(): { r: number; c: number } {
    const { rows, cols } = size();
    const usedCols = Math.max(MIN.cols, ...cards.map(c => c.c + 1));
    for (let r = 0; r < rows; r++) for (let c = 0; c < usedCols; c++) if (!cardAt(r, c)) return { r, c };
    return { r: rows, c: 0 };
  }

  // 창 좌표 → 격자 칸(통로 절반까지 그 칸으로 본다)
  function cellFromPoint(x: number, y: number): { r: number; c: number } | null {
    const el = view()?.querySelector<HTMLElement>('.flow-grid');
    if (!el) return null;
    const box = el.getBoundingClientRect();
    const px = x - box.left, py = y - box.top;
    if (px < 0 || py < 0 || px > box.width || py > box.height) return null;
    const c = Math.max(0, Math.floor((px - GRID.x0 + GAP.x / 2) / (CARD.w + GAP.x)));
    const r = Math.max(0, Math.floor((py - GRID.y0 + GAP.y / 2) / (CARD.h + GAP.y)));
    return { r, c };
  }

  function paintScreens() {
    const box = view()?.querySelector<HTMLElement>('.flow-screens');
    if (!box) return;
    const all = published();
    const q = query.trim().toLocaleLowerCase();
    const shown = q ? all.filter(s => `${s.code} ${s.name}`.toLocaleLowerCase().includes(q)) : all;
    box.innerHTML = shown.length
      ? shown.map(s => `<div class="flow-screen" data-uid="${esc(s.uid)}"${s.thumb ? ` data-thumb="${esc(s.thumb.hash)}"` : ''} title="${esc(s.name)}"><span class="id-tag">${esc(s.code)}</span><span class="label">${esc(s.name)}</span></div>`).join('')
      : `<p class="empty">${all.length ? COPY.flow036 : COPY.flow035}</p>`;
  }

  function paintBoard() {
    const el = board();
    if (!el) return;
    const { rows, cols } = size();
    const width = 2 * GRID.x0 + cols * CARD.w + (cols - 1) * GAP.x;
    const height = 2 * GRID.y0 + rows * CARD.h + (rows - 1) * GAP.y;
    const byKey = new Map(cards.map(c => [c.key, c]));
    const screensBy = info();
    const slots: string[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const drop = dropCell && dropCell.r === r && dropCell.c === c;
      slots.push(`<div class="flow-slot${drop ? ' drop' : ''}" style="left:${GRID.x0 + c * (CARD.w + GAP.x)}px;top:${GRID.y0 + r * (CARD.h + GAP.y)}px"></div>`);
    }
    const paths = links.flatMap(l => {
      const a = byKey.get(l.from), b = byKey.get(l.to);
      if (!a || !b) return [];
      const d = pathData(routeLink(GRID, a, l.fromSide, b, l.toSide));
      const id = esc(linkId(l));
      const on = selected?.kind === 'link' && selected.id === linkId(l);
      return [`<path class="flow-link-hit" data-link="${id}" d="${d}"/><path class="flow-link${on ? ' selected' : ''}" d="${d}" marker-end="url(#flow-head${on ? '-on' : ''})"/>`];
    }).join('');
    const ghost = preview ? `<path class="flow-link preview" d="${pathData(preview)}" marker-end="url(#flow-head)"/>` : '';
    const cardHtml = cards.map(card => {
      const s = screensBy.get(card.uid);
      const on = selected?.kind === 'card' && selected.id === card.key;
      const moving = drag?.kind === 'card' && drag.moved && drag.key === card.key;
      return `<div class="flow-card${on ? ' selected' : ''}${moving ? ' moving' : ''}" data-key="${esc(card.key)}"${s?.thumb ? ` data-thumb="${esc(s.thumb.hash)}"` : ''} style="left:${GRID.x0 + card.c * (CARD.w + GAP.x)}px;top:${GRID.y0 + card.r * (CARD.h + GAP.y)}px">
          <span class="flow-card-id">${esc(s?.code ?? '')}</span><span class="flow-card-name" title="${esc(s?.name ?? card.uid)}">${esc(s?.name ?? card.uid)}</span>
          <button class="flow-card-remove" data-remove="${esc(card.key)}" title="${COPY.flow029}" aria-label="${COPY.flow029}">${X_ICON}</button>
          ${SIDES.map(side => `<span class="flow-dot" data-side="${side}"></span>`).join('')}</div>`;
    }).join('');
    el.innerHTML = `<div class="flow-grid${drag?.kind === 'link' ? ' linking' : ''}" style="width:${width}px;height:${height}px">${slots.join('')}
      <svg class="flow-links" width="${width}" height="${height}"><defs>
        <marker id="flow-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="flow-head"/></marker>
        <marker id="flow-head-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="flow-head on"/></marker>
      </defs>${paths}${ghost}</svg>${cardHtml}</div>`;
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

  function onPointerDown(ev: PointerEvent) {
    if (ev.button !== 0) return;
    const target = ev.target as HTMLElement;
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
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
  }

  function onPointerMove(ev: PointerEvent) {
    if (!drag) return;
    if (drag.kind === 'link') {
      drag.moved = true;
      const from = drag.from;
      const a = cards.find(c => c.key === from);
      const grid = view()?.querySelector<HTMLElement>('.flow-grid')?.getBoundingClientRect();
      if (!a || !grid) return;
      // 카드 위에 있으면 실제로 이어질 경로, 아니면 점에서 포인터까지 곧은 선을 보여 준다.
      const over = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('.flow-card');
      const b = over && cards.find(c => c.key === over.dataset.key && c.key !== a.key);
      const dot = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('.flow-dot')?.dataset.side as FlowSide | undefined;
      preview = b ? routeLink(GRID, a, drag.side, b, dot ?? facingSide(a, b)) : [sidePoint(GRID, a, drag.side), [ev.clientX - grid.left, ev.clientY - grid.top]];
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
    if (d.kind === 'screen') {
      d.ghost?.remove();
      // 누르기만 했으면 click이 첫 빈 칸에 놓는다(튜토리얼·키보드 없이 누르는 경우도 같은 경로).
      if (d.moved) { suppressClick = true; setTimeout(() => { suppressClick = false; }, 0); if (cell) place(d.uid, cell); }
    } else if (d.kind === 'card') {
      if (!d.moved) selected = { kind: 'card', id: d.key };
      else if (cell) moveCard(d.key, cell);
    } else if (d.moved) connect(d.from, d.side, document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null);
    paintBoard();
  }

  function onKeyDown(ev: KeyboardEvent) {
    if (!view() || !selected || (ev.key !== 'Delete' && ev.key !== 'Backspace')) return;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || (active instanceof HTMLElement && active.isContentEditable)) return;
    ev.preventDefault();
    if (selected.kind === 'card') removeCard(selected.id);
    else { const id = selected.id; links = links.filter(l => linkId(l) !== id); selected = null; }
    paintBoard();
  }
  document.addEventListener('keydown', onKeyDown);

  function build(el: HTMLElement) {
    el.innerHTML = `<section class="flow-pick">
        <div class="flow-head"><strong>${COPY.flow021}</strong></div>
        <input class="flow-search" type="search" data-flow="query" value="${esc(query)}" placeholder="${COPY.flow022}" aria-label="${COPY.flow022}">
        <div class="flow-screens"></div>
      </section>
      <section class="flow-order">
        <div class="flow-head"><strong>${COPY.flow023}</strong><button data-action="flow-clear">${COPY.flow033}</button></div>
        <div class="flow-board"></div>
        <p class="note flow-hint">${COPY.flow024} ${COPY.flow037}</p>
        <div class="flow-form"><label>${COPY.flow030}<input data-flow="title" value="${esc(title)}" placeholder="${esc(FLOW_DEFAULT_TITLE)}"></label></div>
        <div class="flow-actions"><span class="note">${COPY.flow034}</span><button class="primary" data-action="flow-create">${COPY.flow032}</button></div>
      </section>`;
    el.addEventListener('input', ev => {
      const input = ev.target as HTMLInputElement;
      if (input.dataset.flow === 'query') { query = input.value; paintScreens(); }
      else if (input.dataset.flow === 'title') title = input.value;
    });
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('click', ev => {
      const screen = (ev.target as HTMLElement).closest<HTMLElement>('.flow-screen');
      if (!screen || suppressClick) return;
      place(screen.dataset.uid!, null);
      paintBoard();
    });
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
