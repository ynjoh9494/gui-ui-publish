import { COPY } from '../core/copy.ts';
import type { GuiScreenInfo } from '../core/guiScreens.ts';
import type { FlipbookScale } from '../core/types.ts';
import { esc } from './html.ts';
import { ALL_CATEGORIES, filterPickerScreens, screenCategories, screenPickerControls, screenPickerEmpty, screenLinkButton } from './screenPicker.ts';

// GUI 붙이기 탭(2026-10-29 사용자 결정, Altimedia PRD 「화면 추적과 GUI 붙이기」 §4.3): 배포된 화면을 캔버스에 붙인다(추적 GUI).
// - 탭을 전환해도 창 크기를 바꾸지 않는다.
// - 전체 또는 선택한 카테고리에서 화면을 검색한다. 목록 보기는 마우스를 올리면 썸네일을 띄우고(app.ts의 data-thumb 미리보기), 그리드 보기는 썸네일을 늘어놓는다.
// - 기본 크기로 붙이고, 캔버스에서 K 단축키로 크기를 바꾼다.
// - 끌어서 창 밖(캔버스)에 놓으면 놓은 자리에(pluginDrop → 본체 figma.on('drop')), 누르면 보고 있는 화면 가운데에 붙인다.
// - 화면마다 캔버스에 붙은 수(추적 GUI와 그 화면 썸네일이 든 플로우를 합친 수)를 보여 주고, 옆의 목록 아이콘으로 그 화면의 추적 목록 팝업을 연다.
// 검색어·고른 카테고리·보기는 탭을 오가도 남는다(플러그인을 닫으면 처음으로).

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
  // 화면 줄의 목록 아이콘: 그 화면의 추적 목록 팝업을 연다.
  track(uid: string, name: string): void;
  // 창 밖(캔버스)에 놓았다. x·y는 창 기준 좌표
  drop(uid: string, scale: FlipbookScale, x: number, y: number): void;
  // 썸네일 이미지 주소. 아직 없으면 받아 오도록 요청하고 null(받으면 thumbsLoaded)
  thumb(hash: string): string | null;
}

export function pasteView(root: HTMLElement, actions: PasteActions): PasteView {
  let screens: GuiScreenInfo[] = [];
  let counts = new Map<string, number>();
  // 미분류는 빈 문자열로, 전체는 별도 값으로 구분한다.
  let category = ALL_CATEGORIES;
  let query = '';
  let layout: 'list' | 'grid' = 'list';
  // 끌고 있는 화면. 창 밖에 놓았을 때만 붙인다.
  let dragging: string | null = null;

  const view = () => root.querySelector<HTMLElement>('.paste-view');
  const published = () => screens.filter(s => s.status === 'active' && s.version > 0);
  const countHtml = (uid: string) => screenLinkButton('paste', uid, counts.get(uid) ?? 0);

  // 목록 보기 한 줄. data-thumb가 있으면 마우스를 올렸을 때 썸네일이 뜬다.
  const row = (s: GuiScreenInfo) => `<div class="paste-screen" draggable="true" data-uid="${esc(s.uid)}"${s.thumb ? ` data-thumb="${esc(s.thumb.hash)}"` : ''} title="${esc(s.name)}"><span class="id-tag">${esc(s.code)}</span><span class="label">${esc(s.name)}</span>${countHtml(s.uid)}</div>`;

  function card(s: GuiScreenInfo): string {
    const url = s.thumb ? actions.thumb(s.thumb.hash) : null;
    const image = url ? `<img src="${url}" alt="" draggable="false">` : `<span class="paste-thumb-empty">${s.thumb ? '' : COPY.flow005}</span>`;
    return `<div class="paste-card" draggable="true" data-uid="${esc(s.uid)}" title="${esc(`${s.code} ${s.name}`.trim())}"><div class="paste-thumb">${image}<span class="id-tag picker-thumb-id">${esc(s.code)}</span></div><div class="paste-card-meta"><span class="label">${esc(s.name)}</span>${countHtml(s.uid)}</div></div>`;
  }

  function paint() {
    const el = view();
    if (!el) return;
    const cats = screenCategories(published());
    const chosen = category === ALL_CATEGORIES || cats.some(([key]) => key === category) ? category : ALL_CATEGORIES;
    category = chosen;
    const select = el.querySelector<HTMLSelectElement>('[data-paste="category"]')!;
    select.innerHTML = [[ALL_CATEGORIES, COPY.paste009], ...cats].map(([key, name]) => `<option value="${esc(key)}"${key === chosen ? ' selected' : ''}>${esc(name)}</option>`).join('');
    select.disabled = !cats.length;
    for (const b of el.querySelectorAll<HTMLElement>('[data-action="paste-layout"]')) b.setAttribute('aria-pressed', String(b.dataset.layout === layout));
    const box = el.querySelector<HTMLElement>('.paste-screens')!;
    box.classList.toggle('grid', layout === 'grid');
    if (!published().length) { box.innerHTML = `<p class="empty">${COPY.flow035}</p>`; return; }
    const shown = filterPickerScreens(published(), chosen, query);
    box.innerHTML = shown.length ? shown.map(layout === 'grid' ? card : row).join('') : screenPickerEmpty('paste', chosen, query);
  }

  function build(el: HTMLElement) {
    el.innerHTML = `${screenPickerControls('paste', query)}
      <p class="note paste-hint">${COPY.paste007}</p>
      <div class="paste-screens"></div>
      <p class="note paste-tip"><span class="paste-tip-label">${COPY.paste013}</span> ${COPY.paste006}</p>`;
    el.addEventListener('input', ev => {
      const input = ev.target as HTMLInputElement;
      if (input.dataset.paste !== 'search') return;
      query = input.value;
      paint();
    });
    el.addEventListener('change', ev => {
      const select = ev.target as HTMLSelectElement;
      if (select.dataset.paste !== 'category') return;
      category = select.value;
      paint();
    });
    el.addEventListener('click', ev => {
      // 줄 안의 버튼(추적 목록)은 붙이지 않는다(app.ts가 data-action으로 처리한다).
      if ((ev.target as HTMLElement).closest('[data-action]')) return;
      const item = (ev.target as HTMLElement).closest<HTMLElement>('.paste-screens [data-uid]');
      if (item) actions.paste(item.dataset.uid!, 1);
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
      actions.drop(uid, 1, ev.clientX, ev.clientY);
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
        case 'paste-search-all': category = ALL_CATEGORIES; paint(); return true;
        case 'paste-layout': layout = el.dataset.layout === 'grid' ? 'grid' : 'list'; paint(); return true;
        case 'paste-track': {
          const screen = screens.find(s => s.uid === el.dataset.uid);
          if (screen && (counts.get(screen.uid) ?? 0) > 0) actions.track(screen.uid, screen.name);
          return true;
        }
      }
      return false;
    },
  };
}
