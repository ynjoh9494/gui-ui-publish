import { COPY } from '../core/copy.ts';
import type { GuiScreenInfo } from '../core/guiScreens.ts';
import type { FlipbookScale } from '../core/types.ts';
import { esc } from './html.ts';

// GUI 붙이기 탭(2026-10-29 사용자 결정, Altimedia PRD 「화면 추적과 GUI 붙이기」 §4.3): 배포된 화면을 캔버스에 붙인다(추적 GUI).
// - 창은 오른쪽 영역을 접은 것처럼 목록 너비로만 보이고 펼치는 버튼이 없다(app.ts applyCollapse).
// - 카테고리 하나의 화면만 보여 준다. 목록 보기는 마우스를 올리면 썸네일을 띄우고(app.ts의 data-thumb 미리보기), 그리드 보기는 썸네일을 늘어놓는다.
// - 화면 크기 기본·작게는 새로 붙일 때만 쓴다. 붙인 뒤에는 캔버스에서 K(크기 조절)로 바꾼다.
// - 끌어서 창 밖(캔버스)에 놓으면 놓은 자리에(pluginDrop → 본체 figma.on('drop')), 누르면 보고 있는 화면 가운데에 붙인다.
// - 화면마다 캔버스에 붙은 수(추적 GUI와 그 화면 썸네일이 든 플로우를 합친 수)를 보여 준다.
// 고른 카테고리·보기·크기는 탭을 오가도 남는다(플러그인을 닫으면 처음으로).

export interface PasteView {
  render(open: boolean): void;
  setScreens(screens: GuiScreenInfo[], counts: Map<string, number>): void;
  // 그리드 보기의 썸네일 이미지를 받았을 때만 다시 그린다.
  thumbsLoaded(hashes: string[]): void;
  // GUI 붙이기 탭의 버튼(data-action="paste-…"). 처리했으면 true
  handle(action: string, el: HTMLElement): boolean;
}

export interface PasteActions {
  paste(uid: string, scale: FlipbookScale): void;
  // 창 밖(캔버스)에 놓았다. x·y는 창 기준 좌표
  drop(uid: string, scale: FlipbookScale, x: number, y: number): void;
  // 썸네일 이미지 주소. 아직 없으면 받아 오도록 요청하고 null(받으면 thumbsLoaded)
  thumb(hash: string): string | null;
}

const LIST_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>';
const GRID_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>';

export function pasteView(root: HTMLElement, actions: PasteActions): PasteView {
  let screens: GuiScreenInfo[] = [];
  let counts = new Map<string, number>();
  // 고른 카테고리(미분류는 ''). 없어진 카테고리면 첫 카테고리를 보여 준다.
  let category: string | null = null;
  let layout: 'list' | 'grid' = 'list';
  let scale: FlipbookScale = 1;
  // 끌고 있는 화면. 창 밖에 놓았을 때만 붙인다.
  let dragging: string | null = null;

  const view = () => root.querySelector<HTMLElement>('.paste-view');
  const published = () => screens.filter(s => s.status === 'active' && s.version > 0);
  const keyOf = (s: GuiScreenInfo) => s.category?.id ?? '';

  // 배포된 화면이 있는 카테고리. 순서는 플로우 탭의 화면 목록과 같다(미분류가 맨 앞, 카테고리 순서, 이름).
  function categories(): [string, string][] {
    const found = new Map<string, { name: string; order: number }>();
    for (const s of published()) if (!found.has(keyOf(s))) found.set(keyOf(s), { name: s.category?.name ?? COPY.coreList001, order: s.category?.order ?? -1 });
    return [...found].sort(([ka, a], [kb, b]) => a.order - b.order || a.name.localeCompare(b.name, 'ko') || ka.localeCompare(kb)).map(([key, c]) => [key, c.name]);
  }

  function countHtml(uid: string): string {
    const n = counts.get(uid) ?? 0;
    return `<span class="paste-count${n ? '' : ' none'}" title="${esc(`${COPY.paste008} ${n}${COPY.flow053}`)}">${n}</span>`;
  }

  // 목록 보기 한 줄. data-thumb가 있으면 마우스를 올렸을 때 썸네일이 뜬다.
  const row = (s: GuiScreenInfo) => `<div class="paste-screen" draggable="true" data-uid="${esc(s.uid)}"${s.thumb ? ` data-thumb="${esc(s.thumb.hash)}"` : ''} title="${esc(s.name)}"><span class="id-tag">${esc(s.code)}</span><span class="label">${esc(s.name)}</span>${countHtml(s.uid)}</div>`;

  function card(s: GuiScreenInfo): string {
    const url = s.thumb ? actions.thumb(s.thumb.hash) : null;
    const image = url ? `<img src="${url}" alt="" draggable="false">` : `<span class="paste-thumb-empty">${s.thumb ? '' : COPY.flow005}</span>`;
    return `<div class="paste-card" draggable="true" data-uid="${esc(s.uid)}" title="${esc(`${s.code} ${s.name}`.trim())}"><div class="paste-thumb">${image}</div><div class="paste-card-meta"><span class="id-tag">${esc(s.code)}</span>${countHtml(s.uid)}</div><span class="label">${esc(s.name)}</span></div>`;
  }

  function paint() {
    const el = view();
    if (!el) return;
    const cats = categories();
    const chosen = cats.find(([key]) => key === category)?.[0] ?? cats[0]?.[0] ?? null;
    const select = el.querySelector<HTMLSelectElement>('[data-paste="category"]')!;
    select.innerHTML = cats.map(([key, name]) => `<option value="${esc(key)}"${key === chosen ? ' selected' : ''}>${esc(name)}</option>`).join('');
    select.disabled = !cats.length;
    for (const b of el.querySelectorAll<HTMLElement>('[data-action="paste-layout"]')) b.setAttribute('aria-pressed', String(b.dataset.layout === layout));
    for (const b of el.querySelectorAll<HTMLElement>('[data-action="paste-scale"]')) b.setAttribute('aria-pressed', String(Number(b.dataset.scale) === scale));
    const box = el.querySelector<HTMLElement>('.paste-screens')!;
    box.classList.toggle('grid', layout === 'grid');
    if (chosen === null) { box.innerHTML = `<p class="empty">${COPY.flow035}</p>`; return; }
    const shown = published().filter(s => keyOf(s) === chosen).sort((a, b) => a.code.localeCompare(b.code, 'ko') || a.name.localeCompare(b.name, 'ko'));
    box.innerHTML = shown.map(layout === 'grid' ? card : row).join('');
  }

  function build(el: HTMLElement) {
    el.innerHTML = `<div class="paste-bar">
        <select data-paste="category" aria-label="${COPY.paste002}" title="${COPY.paste002}"></select>
        <div class="paste-toggle" role="group"><button class="icon-button" data-action="paste-layout" data-layout="list" title="${COPY.paste003}" aria-label="${COPY.paste003}">${LIST_ICON}</button><button class="icon-button" data-action="paste-layout" data-layout="grid" title="${COPY.paste004}" aria-label="${COPY.paste004}">${GRID_ICON}</button></div>
      </div>
      <div class="paste-size"><span>${COPY.paste005}</span><div class="paste-toggle" role="group" aria-label="${COPY.paste005}"><button data-action="paste-scale" data-scale="1">${COPY.uiApp403}</button><button data-action="paste-scale" data-scale="0.5">${COPY.uiApp404}</button></div></div>
      <p class="note paste-tip">${COPY.paste006}</p>
      <div class="paste-screens"></div>
      <p class="note paste-hint">${COPY.paste007}</p>`;
    el.addEventListener('change', ev => {
      const select = ev.target as HTMLSelectElement;
      if (select.dataset.paste !== 'category') return;
      category = select.value;
      paint();
    });
    el.addEventListener('click', ev => {
      const item = (ev.target as HTMLElement).closest<HTMLElement>('.paste-screens [data-uid]');
      if (item) actions.paste(item.dataset.uid!, scale);
    });
    el.addEventListener('dragstart', ev => {
      const item = (ev.target as HTMLElement).closest<HTMLElement>('.paste-screens [data-uid]');
      if (!item || !ev.dataTransfer) return;
      dragging = item.dataset.uid!;
      ev.dataTransfer.effectAllowed = 'copy';
      ev.dataTransfer.setData('text/plain', item.querySelector('.id-tag')?.textContent ?? '');
      // 끄는 동안에는 목록 썸네일 미리보기를 닫는다.
      root.querySelector('.thumb-hover')?.remove();
    });
    el.addEventListener('dragend', ev => {
      const uid = dragging;
      dragging = null;
      // 창 안에 놓았으면 붙이지 않는다(그 자리에 붙이려면 누른다).
      if (!uid || (ev.clientX >= 0 && ev.clientY >= 0 && ev.clientX <= window.innerWidth && ev.clientY <= window.innerHeight)) return;
      actions.drop(uid, scale, ev.clientX, ev.clientY);
    });
    paint();
  }

  return {
    render(open) {
      root.classList.toggle('pasting-mode', open);
      let el = view();
      if (!open) { el?.remove(); return; }
      if (el) return;
      el = document.createElement('div');
      el.className = 'paste-view';
      root.appendChild(el);
      build(el);
    },
    setScreens(next, nextCounts) {
      screens = next;
      counts = nextCounts;
      paint();
    },
    thumbsLoaded(hashes) {
      if (!view() || layout !== 'grid' || dragging) return;
      const loaded = new Set(hashes);
      if (published().some(s => s.thumb && loaded.has(s.thumb.hash))) paint();
    },
    handle(action, el) {
      switch (action) {
        case 'paste-layout': layout = el.dataset.layout === 'grid' ? 'grid' : 'list'; paint(); return true;
        case 'paste-scale': scale = el.dataset.scale === '1' ? 1 : 0.5; paint(); return true;
      }
      return false;
    },
  };
}
