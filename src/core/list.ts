import { COPY } from './copy.ts';
import { changeDetected, entryName, type Entry, type FlipbookSpot } from './compare.ts';
import type { FlipbookSection } from './flipbooks.ts';
import type { InputStatus } from './drafts.ts';
import { parseFrameName } from './screenName.ts';
import type { State } from './store.ts';
import type { Team } from './types.ts';

export const UNCATEGORIZED = '__none__';
const nameCollator = new Intl.Collator('ko');
const codeCollator = new Intl.Collator('ko', { numeric: true });

export interface ListRow {
  entry: Entry;
  name: string;
  code: string;
  // 0: 독립·기본 화면, 1: 케이스
  depth: 0 | 1;
  status: InputStatus;
}

export interface ListGroup {
  key: string;
  name: string;
  expanded: boolean;
  // 그룹 전체 기준. 접혀 있거나 검색으로 숨겨진 행도 센다.
  total: number;
  included: number;
  rows: ListRow[];
  visibleRows: ListRow[];
}

export interface ListView {
  collapsed: Set<string>;
  query: string;
  changedOnly: boolean;
  // UI 목록: 파일의 페이지 순서와 이름. 플립북은 페이지 → Section으로 묶는다(2026-10-20 사용자 결정).
  pages?: { id: string; name: string }[];
  // UI 목록: 플립북 프레임의 캔버스 위치. Section과 Section 안의 순서를 캔버스대로 보여 준다(2026-10-21 사용자 요청).
  spots?: (flipbookId: string) => FlipbookSpot | null | undefined;
  // GUI 입력 중인 화면 이름·Screen ID를 목록에도 반영한다.
  guiDisplay?: (entry: Entry, saved: { name: string; code: string }) => { name: string; code: string };
  // GUI 입력 중인 카테고리·케이스 관계를 목록의 그룹·들여쓰기에도 반영한다.
  guiPlace?: (entry: Entry, saved: GuiPlace) => GuiPlace;
  // 「변경된 화면만 보기」(UI 목록은 「업데이트된 화면만 보기」)에 남길 항목. UI 목록은 화면이 수정된(확인이 필요한) 플립북이다.
  changed?: (entry: Entry) => boolean;
}

// GUI 목록에서 화면이 놓이는 카테고리와 기본 화면(케이스일 때)
export interface GuiPlace {
  categoryId: string | null;
  baseScreenId: string | null;
}

export interface ListModel {
  groups: ListGroup[];
  included: number;
  invalid: number;
}

// 「변경 추정만」에 남기는 항목: 신규·변경 감지·삭제(원본 없음). UI 목록은 플립북 비교 결과의 변경이다.
function needsChangeReview(entry: Entry): boolean {
  return entry.estimate === 'new' || entry.estimate === 'changed' || entry.estimate === 'missing' || changeDetected(entry);
}

export function flipbookGroupKey(pageId: string | null, categoryKey: string): string {
  return `${pageId ?? ''}|${categoryKey}`;
}

export function savedGuiPlace(state: State, screenId: string | null): GuiPlace {
  const screen = screenId ? state.screens.get(screenId) : null;
  return { categoryId: screen?.categoryId ?? null, baseScreenId: screen?.baseScreenId ?? null };
}

// 삭제된 카테고리의 화면은 새 카테고리를 지정할 때까지 미분류에 둔다.
export function guiGroupKey(state: State, categoryId: string | null): string {
  return categoryId && state.categories.get(categoryId)?.active ? categoryId : UNCATEGORIZED;
}

function groupKey(state: State, entry: Entry, place: (entry: Entry) => GuiPlace): string {
  if (entry.flipbookId) {
    const fb = state.flipbooks.get(entry.flipbookId);
    return fb ? flipbookGroupKey(fb.pageId ?? state.project.flipbookPageId, fb.category.key) : UNCATEGORIZED;
  }
  return guiGroupKey(state, place(entry).categoryId);
}

// 배포된 화면은 표시 중인 Screen ID 순으로, 신규 후보는 이름 순으로 정렬한다.
// 케이스는 같은 그룹에 있는 기본 화면 바로 아래에 둔다. 기본 화면이 다른 그룹에 있으면 들여쓰지 않는다.
function ordered(entries: Entry[], display: (entry: Entry) => { name: string; code: string }, place: (entry: Entry) => GuiPlace): { entry: Entry; depth: 0 | 1 }[] {
  const byName = (a: Entry, b: Entry) => nameCollator.compare(display(a).name, display(b).name);
  const byCode = (a: Entry, b: Entry) => codeCollator.compare(display(a).code, display(b).code) || byName(a, b);
  const sorted = (list: Entry[]) => [...list.filter(e => !!e.screenId).sort(byCode), ...list.filter(e => !e.screenId).sort(byName)];
  const roots = new Set(entries.filter(e => e.screenId && !place(e).baseScreenId).map(e => e.screenId!));
  const baseOf = (e: Entry) => {
    const base = place(e).baseScreenId;
    return base && base !== e.screenId && roots.has(base) ? base : null;
  };
  const cases = new Map<string, Entry[]>();
  for (const entry of entries) {
    const base = baseOf(entry);
    if (base) {
      const children = cases.get(base) ?? [];
      children.push(entry);
      cases.set(base, children);
    }
  }
  return sorted(entries.filter(e => !baseOf(e))).flatMap(entry => [
    { entry, depth: 0 as const },
    ...sorted((entry.screenId && cases.get(entry.screenId)) || []).map(child => ({ entry: child, depth: 1 as const })),
  ]);
}

// UI 목록의 그룹 하나: 페이지 안의 Section과 놓인 순서대로의 항목(플립북 ID, 만들기 전 새 플립북은 그 키)
export interface ArrangedGroup { key: string; pageId: string | null; section: FlipbookSection; name: string; items: string[] }

// 그룹 이름: 페이지명과 Section명이 같으면 한 번만 쓴다.
export function sectionGroupName(pages: { id: string; name: string }[], pageId: string | null, section: { name: string }): string {
  const page = pages.find(p => p.id === pageId);
  const sameName = page?.name.trim().toLocaleLowerCase() === section.name.trim().toLocaleLowerCase();
  return page && !sameName ? `${page.name} · ${section.name}` : page?.name ?? section.name;
}

// 사용 중인 플립북을 페이지 → Section → Section 안 순서로 늘어놓는다.
// Section과 플립북은 캔버스에 놓인 순서를 따르고, 위치를 모르는(프레임을 찾지 못한) 플립북은 그 Section 뒤에 첫 화면의 Screen ID 순으로 둔다.
export function arrangeFlipbooks(state: State, pages: { id: string; name: string }[], spots: (flipbookId: string) => FlipbookSpot | null | undefined = () => null): ArrangedGroup[] {
  const pageIndex = new Map(pages.map((p, i) => [p.id, i]));
  const groups = new Map<string, ArrangedGroup & { page: number; canvas: number }>();
  const spotOf = (id: string) => {
    const spot = spots(id);
    const fb = state.flipbooks.get(id);
    return spot && fb && spot.section === fb.category.key ? spot : null;
  };
  for (const fb of state.flipbooks.values()) {
    if (fb.status !== 'active') continue;
    const pageId = fb.pageId ?? state.project.flipbookPageId;
    const key = flipbookGroupKey(pageId, fb.category.key);
    let group = groups.get(key);
    if (!group) {
      group = { key, pageId, section: fb.category, name: sectionGroupName(pages, pageId, fb.category), items: [], page: pageIndex.get(pageId ?? '') ?? pages.length, canvas: Infinity };
      groups.set(key, group);
    }
    group.items.push(fb.id);
    const spot = spotOf(fb.id);
    if (spot) group.canvas = Math.min(group.canvas, spot.sectionIndex);
  }
  const code = (id: string) => state.flipbooks.get(id)?.screens[0]?.code ?? '';
  const title = (id: string) => state.flipbooks.get(id)?.title ?? '';
  for (const group of groups.values()) group.items.sort((a, b) => {
    const sa = spotOf(a), sb = spotOf(b);
    if (sa && sb) return sa.index - sb.index;
    if (sa || sb) return sa ? -1 : 1;
    return codeCollator.compare(code(a), code(b)) || nameCollator.compare(title(a), title(b));
  });
  return [...groups.values()]
    .sort((a, b) => a.page - b.page || a.canvas - b.canvas || a.section.order - b.section.order || a.name.localeCompare(b.name, 'ko'))
    .map(({ key, pageId, section, name, items }) => ({ key, pageId, section, name, items }));
}

// 만들기 전 새 플립북의 자리: 페이지·Section과 Section 안에서 바로 앞 항목(null이면 맨 앞, 비우면 맨 뒤)
export interface DraftPlace { key: string; pageId: string; section: FlipbookSection; after?: string | null }

// 새 플립북을 목록에 끼워 넣는다(만들기 전 미리보기). 배열 순서대로 놓으므로 앞 항목이 같은 새 플립북은 배열 순서를 따른다.
// 아직 없는 Section은 같은 페이지의 마지막 Section 뒤에 둔다(만들 때 캔버스에서도 페이지 맨 아래에 생긴다).
export function placeDrafts(groups: ArrangedGroup[], drafts: DraftPlace[], pages: { id: string; name: string }[]): ArrangedGroup[] {
  const out = groups.map(g => ({ ...g, items: [...g.items] }));
  const pageIndex = (pageId: string | null) => { const i = pages.findIndex(p => p.id === pageId); return i < 0 ? pages.length : i; };
  for (const draft of drafts) {
    const key = flipbookGroupKey(draft.pageId, draft.section.key);
    let group = out.find(g => g.key === key);
    if (!group) {
      group = { key, pageId: draft.pageId, section: draft.section, name: sectionGroupName(pages, draft.pageId, draft.section), items: [] };
      const lastOfPage = out.map(g => g.pageId).lastIndexOf(draft.pageId);
      const laterPage = out.findIndex(g => pageIndex(g.pageId) > pageIndex(draft.pageId));
      out.splice(lastOfPage >= 0 ? lastOfPage + 1 : laterPage >= 0 ? laterPage : out.length, 0, group);
    }
    const at = draft.after === undefined ? -1 : draft.after === null ? 0 : group.items.indexOf(draft.after) + 1;
    if (at <= 0 && draft.after !== null) group.items.push(draft.key);
    else group.items.splice(at, 0, draft.key);
  }
  return out;
}

// GUI 목록에 보이는 저장된 이름·Screen ID. 입력 중인 값은 ListView.guiDisplay가 덮어쓴다.
export function savedGuiDisplay(state: State, entry: Entry): { name: string; code: string } {
  return { name: parseFrameName(entryName(state, entry)).name, code: entry.screenId ? state.screens.get(entry.screenId)?.code ?? '' : '' };
}

// GUI 목록은 원본 화면, UI 목록은 플립북이다.
// 사용 안 함(삭제로 배포한 화면·플립북)은 목록에서 뺀다. 배포를 켠 항목은 「변경 추정만」에서도 보인다.
export function buildList(team: Team, state: State, entries: Entry[], statusOf: (entry: Entry) => InputStatus, view: ListView): ListModel {
  const visible = entries.filter(e => e.estimate !== 'retired' && (team !== 'UI' || !!e.flipbookId));
  const guiDisplayCache = new Map<string, { name: string; code: string }>();
  const guiDisplay = (entry: Entry) => {
    const cached = guiDisplayCache.get(entry.key);
    if (cached) return cached;
    const saved = savedGuiDisplay(state, entry);
    const display = view.guiDisplay?.(entry, saved) ?? saved;
    guiDisplayCache.set(entry.key, display);
    return display;
  };
  const guiPlaceCache = new Map<string, GuiPlace>();
  const guiPlace = (entry: Entry) => {
    const cached = guiPlaceCache.get(entry.key);
    if (cached) return cached;
    const saved = savedGuiPlace(state, entry.screenId);
    const place = view.guiPlace?.(entry, saved) ?? saved;
    guiPlaceCache.set(entry.key, place);
    return place;
  };
  const buckets = new Map<string, Entry[]>();
  for (const entry of visible) {
    const key = groupKey(state, entry, guiPlace);
    const bucket = buckets.get(key) ?? [];
    bucket.push(entry);
    buckets.set(key, bucket);
  }
  const query = view.query.trim().toLowerCase();
  const arranged = team === 'UI' ? arrangeFlipbooks(state, view.pages ?? [], view.spots) : [];
  const rank = new Map(arranged.flatMap(g => g.items.map((id, i) => [id, i] as const)));
  const groupNames = new Map<string, string>(team === 'UI'
    ? arranged.map(g => [g.key, g.name])
    : [...state.categories.values()].sort((a, b) => a.order - b.order).map(c => [c.id, c.name + (c.active ? '' : COPY.coreList002)]));
  const groupOrder = team === 'UI' ? [...groupNames.keys(), UNCATEGORIZED] : [UNCATEGORIZED, ...groupNames.keys()];
  const model: ListModel = { groups: [], included: 0, invalid: 0 };

  for (const key of groupOrder) {
    const bucket = buckets.get(key);
    // 화면이 없는 카테고리와 미분류는 보여주지 않는다.
    if (!bucket) continue;
    const sortedRows = team === 'UI' ? [...bucket].sort((a, b) => (rank.get(a.flipbookId!) ?? Infinity) - (rank.get(b.flipbookId!) ?? Infinity)).map(entry => ({ entry, depth: 0 as const })) : ordered(bucket, guiDisplay, guiPlace);
    // UI 목록의 code는 검색용으로 플립북에 든 화면의 Screen ID를 모은다.
    const flipbookCodes = (entry: Entry) => (entry.flipbookId ? state.flipbooks.get(entry.flipbookId)?.screens.map(x => x.code).join(' ') : '') ?? '';
    const rows = sortedRows.map(({ entry, depth }) => ({ entry, depth, name: team === 'GUI' ? guiDisplay(entry).name : entryName(state, entry), code: team === 'GUI' ? guiDisplay(entry).code : flipbookCodes(entry), status: statusOf(entry) }));
    const included = rows.filter(r => r.status !== 'excluded').length;
    model.included += included;
    model.invalid += rows.filter(r => r.status === 'invalid').length;
    const filtered = rows.filter(r =>
      (!query || r.name.toLowerCase().includes(query) || r.code.toLowerCase().includes(query)) &&
      (!view.changedOnly || (view.changed ? view.changed(r.entry) : r.status !== 'excluded' || needsChangeReview(r.entry))));
    if ((query || view.changedOnly) && !filtered.length) continue;
    // 검색 중에는 결과가 있는 그룹을 펼친다. 접힘 설정 자체는 바꾸지 않는다.
    const expanded = query ? true : !view.collapsed.has(key);
    model.groups.push({
      key, name: key === UNCATEGORIZED ? COPY.coreList001 : groupNames.get(key)!,
      expanded, total: rows.length, included, visibleRows: filtered, rows: expanded ? filtered : [],
    });
  }
  return model;
}
