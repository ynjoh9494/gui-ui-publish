import { COPY, GUI_STATE_HINT, GUI_STATE_LABEL, UI_STATE_HINT, UI_STATE_LABEL, type GuiState, type UiListState } from '../core/copy.ts';
import { changeDetected, ignoreBlock, UI_ESTIMATE_LABEL, type Entry, type Estimate } from '../core/compare.ts';
import { isNotScreen, isPrevious, type Draft } from '../core/drafts.ts';
import type { State } from '../core/store.ts';
import { esc } from './html.ts';

function icon(className: string, label: string, body: string): string {
  const tooltip = esc(label);
  return `<span class="estimate-icon ${className}" role="img" tabindex="0" title="${tooltip}" aria-label="${tooltip}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg></span>`;
}

// ── GUI 목록 상태(2026-10-20 사용자 결정) ─────────────────

const SQUARE = '<rect x="3" y="3" width="18" height="18" rx="4"/>';
const QUESTION = '<path d="M9.6 9.4a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1.1.9-1.1 1.6v.3"/><path d="M12 16.6h.01"/>';
const SWAP = '<path d="M7.5 9.5h9L14 7"/><path d="M16.5 14.5h-9L10 17"/>';
const WARNING = '<path d="m10.3 4-8 14a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>';
const GUI_ICON: Record<GuiState, { tone: string; body: string }> = {
  'detected-new': { tone: 'blue', body: SQUARE + QUESTION },
  'detected-change': { tone: 'yellow', body: SQUARE + QUESTION },
  'detected-delete': { tone: 'red', body: SQUARE + QUESTION },
  unchanged: { tone: 'gray', body: SQUARE + '<path d="M8 10h8M8 14h8"/>' },
  pending: { tone: 'gray', body: '<rect x="3" y="3" width="18" height="18" rx="4" stroke-dasharray="3 2.6"/>' },
  failed: { tone: 'orange', body: WARNING },
  added: { tone: 'blue', body: SQUARE + '<path d="M12 8v8M8 12h8"/>' },
  replaced: { tone: 'teal', body: SQUARE + SWAP },
  previous: { tone: 'gray', body: SQUARE + SWAP },
  'not-screen': { tone: 'gray', body: '<path d="m7 7 10 10M17 7 7 17"/>' },
  modified: { tone: 'teal', body: SQUARE + '<path d="m13.6 7.4 3 3L10.2 16.8H7.2v-3l6.4-6.4Z"/>' },
  deleted: { tone: 'red', body: SQUARE + '<path d="M8 12h8"/>' },
};

// 변경사항 확인 결과와 배포 입력(포함 여부·등록 방식)으로 정하는 GUI 목록 상태
export function guiState(entry: Entry, draft: Draft | undefined): GuiState {
  if (entry.estimate === 'pending') return 'pending';
  if (entry.estimate === 'failed') return 'failed';
  if (draft?.included) {
    if (!entry.screenId) return draft.notScreen ? 'not-screen' : draft.link === 'replace' ? 'replaced' : 'added';
    if (isNotScreen(entry, draft)) return 'not-screen';
    if (isPrevious(entry, draft)) return 'previous';
    if (entry.estimate === 'missing') return draft.retire === 'replace' ? 'previous' : 'deleted';
    return 'modified';
  }
  if (!entry.screenId) return 'detected-new';
  if (entry.estimate === 'missing') return 'detected-delete';
  return changeDetected(entry) ? 'detected-change' : 'unchanged';
}

export function guiStateBadge(state: State, entry: Entry, draft: Draft | undefined): string {
  const value = guiState(entry, draft);
  const lines = [GUI_STATE_LABEL[value], GUI_STATE_HINT[value]];
  if (value === 'detected-change' || value === 'modified') {
    if (entry.estimate === 'no-baseline') lines.push(COPY.uiEstimate008);
    if (entry.estimate === 'stale') lines.push(COPY.uiEstimate009);
    if (entry.categoryMissing) lines.push(ignoreBlock(state, entry) ?? '');
  }
  if (value === 'not-screen' && entry.screenId) lines.push(COPY.uiApp244);
  if (value === 'failed' && entry.frame?.error) lines.push(entry.frame.error);
  lines.push(...entry.notes);
  const { tone, body } = GUI_ICON[value];
  return icon(`estimate-${tone}`, lines.filter(Boolean).join('\n'), body);
}

// ── 플립북(UI) 목록: GUI와 같은 판정/배포 상태 구분 ────────

// 플립북 프레임을 찾지 못한 플립북(연결 끊김). GUI 목록의 원본 없음(삭제)과 같은 아이콘을 쓴다.
export function unlinkedBadge(): string {
  const { tone, body } = GUI_ICON['detected-delete'];
  return icon(`estimate-${tone}`, `${COPY.uiApp235}\n${COPY.uiApp236}`, body);
}

export function uiListState(entry: Entry, draft: Draft | undefined): UiListState {
  if (entry.estimate === 'pending') return 'pending';
  if (entry.estimate === 'failed' || entry.estimate === 'no-baseline' || entry.estimate === 'stale') return 'failed';
  if (draft?.included) return entry.estimate === 'missing' ? 'deleted' : 'modified';
  if (entry.estimate === 'missing') return 'detected-delete';
  return entry.estimate === 'changed' ? 'detected-change' : 'unchanged';
}

export function uiStateBadge(entry: Entry, draft: Draft | undefined): string {
  const value = uiListState(entry, draft);
  const lines = [UI_STATE_LABEL[value], UI_STATE_HINT[value]];
  if (value === 'failed') lines.push(UI_ESTIMATE_LABEL[entry.estimate]);
  lines.push(...entry.notes);
  const { tone, body } = GUI_ICON[value];
  return icon(`estimate-${tone}`, lines.filter(Boolean).join('\n'), body);
}

type Indicator = 'new' | 'changed' | 'unchanged' | 'pending' | 'attention' | 'retired';
const GROUP: Record<Estimate, Indicator> = {
  new: 'new', changed: 'changed', unchanged: 'unchanged', pending: 'pending',
  failed: 'attention', 'no-baseline': 'attention', stale: 'attention', missing: 'attention', retired: 'retired',
};
import { INDICATOR_LABEL as LABEL } from '../core/copy.ts';
const ICON: Record<Indicator, string> = {
  new: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 7v10M7 12h10"/>',
  changed: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14l-1 7Z"/>',
  unchanged: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M7 9h10M7 15h10"/>',
  pending: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  attention: WARNING,
  retired: '<circle cx="12" cy="12" r="9"/><path d="m6 6 12 12"/>',
};

export function estimateBadge(entry: Entry): string {
  const explanations: Record<Estimate, string> = {
    new: COPY.uiEstimate003,
    changed: `${COPY.uiEstimate001}${COPY.uiEstimate004}`,
    unchanged: COPY.uiEstimate005,
    pending: COPY.uiEstimate006,
    failed: `${COPY.uiEstimate001}${COPY.uiEstimate007}`,
    'no-baseline': COPY.uiEstimate008,
    stale: COPY.uiEstimate009,
    missing: COPY.uiEstimate011,
    retired: COPY.uiEstimate013,
  };
  const group = GROUP[entry.estimate];
  // 첫 줄이 표시 그룹 이름이므로, 결과 이름이 같으면 설명만 붙인다.
  const label = UI_ESTIMATE_LABEL[entry.estimate];
  const details = [label === LABEL[group] ? explanations[entry.estimate] : `${label}: ${explanations[entry.estimate]}`, ...entry.notes];
  return icon(`estimate-${group}`, `${LABEL[group]}\n${details.join('\n')}`, ICON[group]);
}
