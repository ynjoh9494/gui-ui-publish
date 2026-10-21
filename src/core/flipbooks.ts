// 플립북 만들기와 GUI 갱신 반영. Figma에 닿지 않는 기록 부분만 다룬다.
import { COPY } from './copy.ts';
import { defaultTitle, NO_CATEGORY_KEY, POLICY_CATEGORY_KEY } from './flipbook.ts';
import { importedRecord, recordsToImport, type GuiRecordInfo, type GuiScreenInfo } from './guiScreens.ts';
import { keys, type State, type Store } from './store.ts';
import type { Actor, Flipbook, FlipbookKind, FlipbookReview, FlipbookScale, ImportedGuiRecord, TagSnapshot, UiRecord, UiState } from './types.ts';

// 플립북을 놓는 Section(2026-10-21 사용자 요청: 페이지 안에서 섹션을 나눈다). 기본은 첫 화면의 GUI 카테고리이고,
// 페이지의 다른 Section이나 새 이름의 Section을 고를 수 있다. 큰 제목 위 Chapter에도 이 이름을 쓴다.
export type FlipbookSection = Flipbook['category'];
// 새로 만든 Section의 키 머리. 카테고리 ID·정책·미분류 키와 겹치지 않는다.
export const CUSTOM_SECTION_PREFIX = 'section:';
const CUSTOM_SECTION_ORDER = Number.MAX_SAFE_INTEGER - 2;

// 플립북 만들기 목록의 한 항목. 화면을 비우면 정책 플립북, 여러 화면은 선택 순서대로 한 플립북에 넣는다.
export interface FlipbookRowRequest {
  uids: string[];
  multi: boolean;
  scale: FlipbookScale;
  scales?: Record<string, FlipbookScale>;
  // 비우면 첫 번째 화면의 이름을 쓴다. 정책(화면 없음)은 필수다.
  title?: string;
  // 이 항목을 만들 페이지. 비우면 요청의 페이지다.
  pageId?: string;
  // 놓을 Section. 비우면 첫 화면의 카테고리(정책은 「정책」)다.
  section?: FlipbookSection | null;
  // Section 안에서 놓을 자리: 이 플립북(기존 플립북 ID 또는 `row:앞 행 번호`) 바로 다음. null이면 맨 앞, 비우면 맨 뒤다.
  after?: string | null;
}

export interface FlipbookRequest {
  // 플립북을 만들 페이지
  pageId: string;
  rows: FlipbookRowRequest[];
}

const SCALES: FlipbookScale[] = [1, 0.5, 0.25];

export function rowKind(row: FlipbookRowRequest): FlipbookKind {
  if (!row.uids.length) return 'policy';
  return row.multi ? 'multi' : 'single';
}

// 따로 고르지 않았을 때의 Section: 첫 화면의 카테고리, 정책은 「정책」
export function defaultSection(kind: FlipbookKind, first: GuiScreenInfo | undefined): FlipbookSection {
  if (kind === 'policy') return { key: POLICY_CATEGORY_KEY, name: COPY.coreFlipbooks001, order: Number.MAX_SAFE_INTEGER - 1 };
  const c = first?.category;
  return c ? { key: c.id, name: c.name, order: c.order } : { key: NO_CATEGORY_KEY, name: COPY.coreFlipbook003, order: Number.MAX_SAFE_INTEGER };
}

// 새 Section. 키는 페이지에서 Section을 다시 찾는 표식이고, 이름은 Section·Chapter에 쓴다.
export function customSection(name: string, key = `${CUSTOM_SECTION_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`): FlipbookSection {
  return { key, name: name.trim(), order: CUSTOM_SECTION_ORDER };
}

// 페이지에 있는 Section: 그 페이지의 사용 중인 플립북이 놓인 Section
export function pageSections(state: State, pageId: string): FlipbookSection[] {
  const out = new Map<string, FlipbookSection>();
  for (const fb of state.flipbooks.values()) {
    if (fb.status !== 'active' || (fb.pageId ?? state.project.flipbookPageId) !== pageId || out.has(fb.category.key)) continue;
    out.set(fb.category.key, fb.category);
  }
  return [...out.values()];
}

// 표의 행마다 플립북 기록 하나를 만든다. 잘못된 행이 있으면 행 번호와 함께 알리고 아무것도 만들지 않는다.
export function planFlipbooks(request: FlipbookRequest, screens: Map<string, GuiScreenInfo>, actor: Actor, now: number, newId: () => string): Flipbook[] {
  if (!request.rows.length) throw new Error(COPY.coreFlipbooks005);
  return request.rows.map((row, index) => {
    try { return planRow(row, row.pageId || request.pageId, screens, actor, now, newId); }
    catch (e) { throw new Error(`${index + 1}${COPY.coreFlipbooks009} ${e instanceof Error ? e.message : String(e)}`); }
  });
}

function planRow(row: FlipbookRowRequest, pageId: string, screens: Map<string, GuiScreenInfo>, actor: Actor, now: number, newId: () => string): Flipbook {
  const kind = rowKind(row);
  const chosen = row.uids.map(uid => {
    const s = screens.get(uid);
    if (!s) throw new Error(COPY.coreFlipbooks002);
    if (s.status !== 'active') throw new Error(`${COPY.coreFlipbooks003} ${s.code}`);
    if (!s.sourceNodeId) throw new Error(`${COPY.coreFlipbooks004} ${s.code}`);
    return s;
  });
  if (kind === 'single' && chosen.length !== 1) throw new Error(COPY.coreFlipbooks005);
  if (new Set(chosen.map(s => s.uid)).size !== chosen.length) throw new Error(COPY.coreFlipbooks006);
  const scale = kind === 'multi' ? row.scale : 1;
  if (!SCALES.includes(scale)) throw new Error(COPY.coreFlipbooks007);
  for (const s of chosen) if (!SCALES.includes(row.scales?.[s.uid] ?? scale)) throw new Error(COPY.coreFlipbooks007);
  const typed = (row.title ?? '').trim();
  if (kind === 'policy' && !typed) throw new Error(COPY.coreFlipbooks008);
  const auto = defaultTitle(kind, chosen);
  const title = typed || auto;
  const autoTitle = kind !== 'policy' && title === auto;
  return {
    id: newId(), rev: 1, kind, title, autoTitle, titleNames: autoTitle ? [title] : [], scale, category: sectionOf(row, kind, chosen[0]),
    screens: chosen.map(s => ({ uid: s.uid, code: s.code, name: s.name, version: s.version, scale: row.scales?.[s.uid] ?? scale })),
    pageId, status: 'active', createdAt: now, actor,
  };
}

// 고른 Section이 있으면 그 Section, 없으면 첫 화면의 카테고리
function sectionOf(row: FlipbookRowRequest, kind: FlipbookKind, first: GuiScreenInfo | undefined): FlipbookSection {
  if (!row.section) return defaultSection(kind, first);
  const name = row.section.name.trim();
  if (!row.section.key || !name) throw new Error(COPY.coreFlipbooks011);
  return { key: row.section.key, name, order: Number.isFinite(row.section.order) ? row.section.order : CUSTOM_SECTION_ORDER };
}

// 플립북 제목을 바꾼다(2026-10-21 사용자 요청). 비우면 첫 화면 이름(자동 제목)으로 돌아가며, 정책 플립북은 제목이 필수다.
// 캔버스의 큰 제목·Page title은 반영할 때 새 제목으로 바꾼다.
export function renameFlipbook(store: Store, flipbookId: string, title: string, actor: Actor): Flipbook {
  const before = store.state.flipbooks.get(flipbookId);
  if (!before || before.status !== 'active') throw new Error(COPY.coreFlipbook002);
  const typed = title.trim();
  if (before.kind === 'policy' && !typed) throw new Error(COPY.coreFlipbooks008);
  const auto = defaultTitle(before.kind, before.screens);
  const next = typed || auto;
  const autoTitle = before.kind !== 'policy' && next === auto;
  const after: Flipbook = { ...before, rev: before.rev + 1, title: next, autoTitle, titleNames: before.titleNames.includes(next) ? before.titleNames : [...before.titleNames, next] };
  store.put(keys.flipbook(flipbookId), after);
  store.audit(actor, 'flipbook.rename', flipbookId, before.title, next);
  return after;
}

// 일괄 만들기 범위. categories는 고른 카테고리 ID(미지정은 ''), kind는 기본·케이스 화면 구분이다.
export type ScreenKind = 'all' | 'base' | 'case';
export interface ScreenFilter { categories: ReadonlySet<string>; kind: ScreenKind; query: string }

export const screenCategoryKey = (s: GuiScreenInfo): string => s.category?.id ?? '';

// 플립북이 없는 화면: 사용 중인 플립북에 들어 있지 않고 원본이 있는 GUI 화면. exclude(생성 목록에 고른 화면)도 뺀다.
// 카테고리 순서 → Screen ID 순으로 돌려준다.
export function uncreatedScreens(state: State, screens: Iterable<GuiScreenInfo>, exclude: Iterable<string> = []): GuiScreenInfo[] {
  const used = new Set([...state.flipbooks.values()].filter(fb => fb.status === 'active').flatMap(fb => fb.screens.map(s => s.uid)));
  for (const uid of exclude) used.add(uid);
  const last = Number.MAX_SAFE_INTEGER;
  return [...screens].filter(s => s.status === 'active' && s.sourceNodeId && !used.has(s.uid)).sort((a, b) =>
    (a.category?.order ?? last) - (b.category?.order ?? last) || (a.category?.name ?? '').localeCompare(b.category?.name ?? '', 'ko')
    || a.code.localeCompare(b.code, 'ko', { numeric: true }) || a.name.localeCompare(b.name, 'ko'));
}

export function filterScreens(screens: GuiScreenInfo[], filter: ScreenFilter): GuiScreenInfo[] {
  const q = filter.query.trim().toLocaleLowerCase();
  return screens.filter(s => filter.categories.has(screenCategoryKey(s))
    && (filter.kind === 'all' || (filter.kind === 'case') === s.isCase)
    && (!q || `${s.code} ${s.name}`.toLocaleLowerCase().includes(q)));
}

export interface ImportResult {
  // 플립북 반영이 필요한가(새 GUI 버전, 이력·제목 변경)
  changed: boolean;
  // 새로 쌓은 GUI 기록 수
  added: number;
  // 기록에서 사라졌거나 사용 종료된 화면의 Screen ID
  missing: string[];
}

// GUI 배포 상태를 플립북 기록에 반영한다. 새 버전의 기록은 이 플립북에 쌓고,
// 이미 가진 버전은 정정된 설명만 맞춘다. 화면 ID·이름이 바뀌면 함께 바꾼다.
export function importGuiUpdates(store: Store, flipbookId: string, screens: Map<string, GuiScreenInfo>, records: GuiRecordInfo[]): ImportResult {
  const before = store.state.flipbooks.get(flipbookId);
  if (!before) throw new Error(COPY.coreFlipbook002);
  const result: ImportResult = { changed: false, added: 0, missing: [] };
  const held = store.state.imported.get(flipbookId) ?? [];
  const next = before.screens.map(fs => {
    const s = screens.get(fs.uid);
    // 삭제로 배포한 화면은 마지막 GUI를 그대로 두고 알리지 않는다. 화면이 모두 삭제된 플립북은 retireFlipbooks가 사용 안 함으로 바꾼다.
    if (!s || s.status !== 'active') { if (s?.status !== 'deleted') result.missing.push(fs.code); return fs; }
    const mine = new Map<number, ImportedGuiRecord>(held.filter(r => r.uid === fs.uid).map(r => [r.version, r]));
    const { add, update } = recordsToImport(mine, fs.version, records.filter(r => r.uid === fs.uid));
    const version = Math.max(fs.version, s.version);
    for (const r of [...add.filter(r => r.version <= version), ...update]) {
      store.put(keys.imported(flipbookId, r.uid, r.version), importedRecord(flipbookId, r));
      result.changed = true;
    }
    result.added += add.filter(r => r.version <= version).length;
    if (version !== fs.version || s.code !== fs.code || s.name !== fs.name) result.changed = true;
    return { ...fs, code: s.code, name: s.name, version };
  });
  if (!result.changed) return result;
  const autoTitle = before.autoTitle ? defaultTitle(before.kind, next) : before.title;
  const after: Flipbook = {
    ...before, rev: before.rev + 1, screens: next, title: autoTitle,
    titleNames: before.titleNames.includes(autoTitle) ? before.titleNames : [...before.titleNames, autoTitle],
  };
  store.put(keys.flipbook(flipbookId), after);
  return result;
}

// 확인이 필요한 GUI 기록: 플립북을 만든 뒤 이 플립북에 쌓인 기록 중 마지막 확인 완료의 버전보다 새것.
// 확인 완료는 시각이 아니라 화면별 버전으로 비교해 작업자 PC의 시계 차이에 영향받지 않는다.
// 확인 완료 기록이 없고 이전 버전의 UI 배포 기록만 있으면 그 시각까지는 확인한 것으로 본다.
export function unreviewed(state: State, flipbookId: string): ImportedGuiRecord[] {
  const fb = state.flipbooks.get(flipbookId);
  if (!fb || fb.status !== 'active') return [];
  const review = state.reviews.get(flipbookId);
  const since = review ? fb.createdAt : Math.max(fb.createdAt, ...(state.ui.get(flipbookId) ?? []).map(r => r.committedAt));
  const reviewed = review?.versions ?? {};
  return (state.imported.get(flipbookId) ?? []).filter(r => r.committedAt > since && r.version > (reviewed[r.uid] ?? 0));
}

// 화면이 수정되었는가: 빨간 점(「화면이 수정되었습니다」)을 표시한다. 확인 완료를 누르면 풀린다(2026-10-20 사용자 결정).
export function needsReview(state: State, flipbookId: string): boolean {
  return unreviewed(state, flipbookId).length > 0;
}

// 확인 완료 한 건: 상태(UI 태그, 필수)와 코멘트(선택)
export interface ReviewRequest { flipbookId: string; tagId: string; comment: string }

// 플립북을 확인 완료로 기록하고 기록한 플립북 ID를 돌려준다(2026-10-20 사용자 결정).
// 그때까지 쌓인 GUI 버전을 확인한 것으로 남겨 빨간 점을 풀고, 상태·코멘트는 UI 이력 한 줄과 플립북 Status로 남긴다.
// 화면이 수정되지 않은 플립북도 상태를 바꿀 수 있다.
export function markReviewed(store: Store, requests: ReviewRequest[], actor: Actor, batchId: string): string[] {
  const done: string[] = [];
  const seen = new Set<string>();
  for (const req of requests) {
    if (seen.has(req.flipbookId)) continue;
    seen.add(req.flipbookId);
    const fb = store.state.flipbooks.get(req.flipbookId);
    if (!fb || fb.status !== 'active') throw new Error(COPY.coreFlipbook002);
    const tag = store.state.tags.get(req.tagId);
    if (!tag || tag.team !== 'UI' || !tag.active) throw new Error(COPY.coreFlipbooks010);
    const id = fb.id;
    const before = store.state.reviews.get(id) ?? null;
    const versions: Record<string, number> = { ...before?.versions };
    for (const s of fb.screens) versions[s.uid] = Math.max(versions[s.uid] ?? 0, s.version);
    for (const r of store.state.imported.get(id) ?? []) versions[r.uid] = Math.max(versions[r.uid] ?? 0, r.version);
    const now = store.now();
    store.put(keys.review(id), { flipbookId: id, versions, actor, reviewedAt: now } satisfies FlipbookReview);
    const state = store.state.uiStates.get(id);
    const version = Math.max(state?.version ?? 0, ...(store.state.ui.get(id) ?? []).map(r => r.version)) + 1;
    const snapshot: TagSnapshot = { id: tag.id, name: tag.name, color: tag.color, colorKey: tag.colorKey };
    store.put(keys.ui(id, version), {
      flipbookId: id, version, batchId, workType: 'changed', tag: snapshot, description: req.comment.trim(),
      worker: { id: actor.id, name: actor.name }, actor, committedAt: now, extra: {}, corrections: [],
    } satisfies UiRecord);
    store.put(keys.uiState(id), { flipbookId: id, rev: (state?.rev ?? 0) + 1, version, tag: snapshot } satisfies UiState);
    store.audit(actor, 'flipbook.review', id, before?.versions ?? null, { versions, tag: tag.name });
    done.push(id);
  }
  return done;
}

// 화면이 모두 삭제된 플립북을 사용 안 함으로 바꾸고 바꾼 플립북 ID를 돌려준다(2026-10-20 사용자 결정).
// 플립북 프레임은 지우지 않으며 목록에서만 뺀다.
export function retireFlipbooks(store: Store, actor: Actor): string[] {
  const out: string[] = [];
  for (const fb of store.state.flipbooks.values()) {
    if (fb.status !== 'active' || !fb.screens.length) continue;
    if (!fb.screens.every(x => store.state.screens.get(x.uid)?.status === 'deleted')) continue;
    store.put(keys.flipbook(fb.id), { ...fb, rev: fb.rev + 1, status: 'deleted' } satisfies Flipbook);
    store.audit(actor, 'flipbook.retire', fb.id, 'active', 'deleted');
    out.push(fb.id);
  }
  return out;
}

// 연결이 끊긴(캔버스에서 프레임을 찾지 못한) 플립북을 목록에서 빼고 뺀 플립북 ID를 돌려준다(2026-10-20 사용자 결정).
// 기록은 지우지 않고 사용 안 함으로 바꾼다. linked: 지금 프레임이 있는 플립북. 프레임이 남은 플립북은 빼지 않는다.
export function removeFlipbooks(store: Store, ids: string[], linked: Set<string>, actor: Actor): string[] {
  const out: string[] = [];
  for (const id of new Set(ids)) {
    const fb = store.state.flipbooks.get(id);
    if (!fb || fb.status !== 'active' || linked.has(id)) continue;
    store.put(keys.flipbook(id), { ...fb, rev: fb.rev + 1, status: 'deleted' } satisfies Flipbook);
    store.audit(actor, 'flipbook.remove', id, 'active', 'deleted');
    out.push(id);
  }
  return out;
}
