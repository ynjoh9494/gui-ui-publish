import { COPY } from '../core/copy.ts';
import type { GuiScreenInfo } from '../core/guiScreens.ts';
import { esc } from './html.ts';

export const ALL_CATEGORIES = '__all__';
export function screenCategories(screens: GuiScreenInfo[]): [string, string][] {
  const found = new Map<string, { name: string; order: number }>();
  for (const s of screens) {
    const key = s.category?.id ?? '';
    if (!found.has(key)) found.set(key, { name: s.category?.name ?? COPY.coreList001, order: s.category?.order ?? -1 });
  }
  return [...found].sort(([ka, a], [kb, b]) => a.order - b.order || a.name.localeCompare(b.name, 'ko') || ka.localeCompare(kb)).map(([key, c]) => [key, c.name]);
}
export function filterPickerScreens(screens: GuiScreenInfo[], category: string, query: string): GuiScreenInfo[] {
  const q = query.trim().toLocaleLowerCase();
  return screens.filter(s => (category === ALL_CATEGORIES || (s.category?.id ?? '') === category) && (!q || s.code.toLocaleLowerCase().includes(q) || s.name.toLocaleLowerCase().includes(q)))
    .sort((a, b) => a.code.localeCompare(b.code, 'ko') || a.name.localeCompare(b.name, 'ko'));
}
const LIST_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>';
const GRID_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>';
// 플립북 만들기(create)도 같은 형식을 쓴다(2026-11-04 사용자 요청).
export type PickerScope = 'paste' | 'flow' | 'create';
// 목록/그리드 보기 아이콘. 플립북 만들기는 두 열에 함께 적용하므로 두 열 위의 공통 머리에 따로 둔다(2026-11-04 사용자 요청).
export function screenLayoutToggle(scope: PickerScope): string {
  return `<div class="paste-toggle" role="group"><button class="icon-button" data-action="${scope}-layout" data-layout="list" title="${COPY.paste003}" aria-label="${COPY.paste003}">${LIST_ICON}</button><button class="icon-button" data-action="${scope}-layout" data-layout="grid" title="${COPY.paste004}" aria-label="${COPY.paste004}">${GRID_ICON}</button></div>`;
}
const searchInput = (scope: PickerScope, query: string) =>
  `<input class="paste-search" type="search" data-${scope}="${scope === 'flow' ? 'query' : 'search'}" value="${esc(query)}" placeholder="${COPY.paste010}" aria-label="${COPY.paste010}">`;
export function screenPickerControls(scope: PickerScope, query: string): string {
  return `<div class="paste-bar"><select data-${scope}="category" aria-label="${COPY.paste002}" title="${COPY.paste002}"></select>${screenLayoutToggle(scope)}</div>${searchInput(scope, query)}`;
}
// 보기 아이콘 없이 카테고리와 검색을 한 줄에 둔다(플립북 만들기의 「화면 선택」 열).
export function screenPickerFilters(scope: PickerScope, query: string): string {
  return `<div class="paste-bar"><select data-${scope}="category" aria-label="${COPY.paste002}" title="${COPY.paste002}"></select>${searchInput(scope, query)}</div>`;
}
export function screenPickerEmpty(scope: PickerScope, category: string, query: string): string {
  return `<div class="empty" role="status">${query.trim() && category !== ALL_CATEGORIES ? `<button class="link" data-action="${scope}-search-all">${COPY.paste011}</button>` : COPY.paste012}</div>`;
}

const LINK_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7 .1l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7-.1l-3 3a5 5 0 0 0 7 7l2-2"/></svg>';
export function screenLinkButton(scope: 'paste' | 'flow', uid: string, count: number): string {
  return `<button class="paste-track" data-action="${scope}-track" data-uid="${esc(uid)}" draggable="false" title="${COPY.trackList006}" aria-label="${COPY.trackList006} ${count}"${count ? '' : ' disabled'}>${LINK_ICON}<span class="paste-count">${count}</span></button>`;
}
