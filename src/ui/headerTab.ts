import { esc } from './html.ts';

type TabIcon = 'list' | 'versions' | 'book' | 'paste' | 'text' | 'flow' | 'pdf';
const paths: Record<TabIcon, string> = {
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  versions: '<rect x="8" y="3" width="12" height="15" rx="2"/><path d="M4 7v12a2 2 0 0 0 2 2h10M11 8h6M11 12h6"/>',
  book: '<path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1v15Z"/>',
  paste: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 15l5-5 5 5 3-3 5 5M16 7h.01"/>',
  text: '<path d="M4 5h16M12 5v15M8 20h8"/>',
  flow: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><path d="M6 9v9h9M13 5h6v6"/>',
  pdf: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z"/><path d="M14 3v6h6M8 13h8M8 17h6"/>',
};
export function headerTab(action: string, label: string, selected: boolean, icon: TabIcon): string {
  return `<button role="tab" data-action="${action}" title="${esc(label)}" aria-label="${esc(label)}" aria-selected="${selected}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[icon]}</svg><span class="tab-label">${esc(label)}</span></button>`;
}
