import { COPY } from '../core/copy.ts';
import type { TrackListItem } from '../core/tracks.ts';
import { esc } from './html.ts';

// 추적 목록 팝업(2026-10-29 사용자 결정, Altimedia PRD 「화면 추적과 GUI 붙이기」 §4.5): 화면 하나가 캔버스에 붙은 자리(추적 GUI)와
// 그 화면 썸네일이 든 플로우를 나눠 보여 준다. 제목은 화면 이름(Screen ID 없음)이다.
// 자리는 페이지 › Section(› 플립북) 경로로 한 줄에 보여 주고(길면 말줄임), 누르면 그 자리로 가서 그 레이어를 고른다.
// 캔버스에서 찾지 못한 항목은 본체가 묻지 않고 기록에서 뺀 뒤 보낸다. 팝업은 열어 둔 채 여러 항목을 오갈 수 있고 Esc·닫기로 닫는다.

export interface TrackListView {
  dispose(): void;
  open(uid: string, name: string): void;
  // 본체가 보낸 목록. 열린 화면의 것만 받는다.
  set(uid: string, items: TrackListItem[]): void;
  // 추적 목록 팝업의 버튼(data-action="track-…"). 처리했으면 true
  handle(action: string, el: HTMLElement): boolean;
}

export interface TrackListActions {
  load(uid: string): void;
  reveal(item: TrackListItem, uid: string): void;
}

export function trackListView(root: HTMLElement, actions: TrackListActions): TrackListView {
  const events = new AbortController();
  // 열린 화면. items가 null이면 본체 응답을 기다리는 중이다.
  let open: { uid: string; name: string; items: TrackListItem[] | null } | null = null;

  function section(kind: TrackListItem['kind'], label: string, empty: string): string {
    const items = open?.items?.filter(i => i.kind === kind) ?? null;
    const body = !items ? `<p class="note">${COPY.uiApp001}</p>`
      : items.length ? `<ul class="track-list">${items.map(item => {
        const path = item.path.join(' › ');
        return `<li><button class="track-place" data-action="track-reveal" data-id="${esc(item.id)}" title="${esc(path)}">${esc(path)}</button></li>`;
      }).join('')}</ul>` : `<p class="empty">${empty}</p>`;
    return `<section class="track-section"><h3>${label}${items ? ` <span class="count">${items.length}</span>` : ''}</h3>${body}</section>`;
  }

  function paint() {
    let overlay = root.querySelector<HTMLElement>('.track-list-overlay');
    if (!open) { overlay?.remove(); return; }
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'overlay track-list-overlay';
      root.appendChild(overlay);
    }
    overlay.innerHTML = `<div class="dialog track-list-dialog" role="dialog" aria-modal="true" aria-label="${esc(open.name)}">
      <h2>${esc(open.name)}</h2>
      ${section('screen', COPY.trackList001, COPY.trackList003)}${section('flow', COPY.trackList002, COPY.trackList004)}
      <div class="dialog-actions"><button data-action="track-list-close">${COPY.trackList005}</button></div></div>`;
  }

  function close() {
    open = null;
    paint();
  }

  document.addEventListener('keydown', ev => {
    if (!open || ev.key !== 'Escape') return;
    ev.preventDefault();
    close();
  }, { signal: events.signal });

  return {
    dispose() { events.abort(); close(); },
    open(uid, name) {
      open = { uid, name, items: null };
      paint();
      root.querySelector<HTMLElement>('.track-list-dialog .dialog-actions button')?.focus();
      actions.load(uid);
    },
    set(uid, items) {
      if (open?.uid !== uid) return;
      open.items = items;
      paint();
    },
    handle(action, el) {
      switch (action) {
        case 'track-list-close': close(); return true;
        case 'track-reveal': {
          const item = open?.items?.find(i => i.id === el.dataset.id);
          if (open && item) actions.reveal(item, open.uid);
          return true;
        }
      }
      return false;
    },
  };
}
