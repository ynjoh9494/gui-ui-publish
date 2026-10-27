import { COPY } from './copy.ts';
import type { Entry } from './compare.ts';
import { caseRelationError, findCategoryByName, systemTagId } from './registry.ts';
import { nextScreenCode } from './screenCode.ts';
import { parseFrameName } from './screenName.ts';
import type { State } from './store.ts';
import type { Team, WorkType } from './types.ts';

// 화면별 입력 초안. 행 전환·포함 해제·그룹 접기에도 유지하며 Publish 전까지 기록을 만들지 않는다.
export interface Draft {
  included: boolean;
  // 화면이 아님: 신규 후보 또는 이미 배포한 화면의 프레임을 제외 목록에 넣는다. 배포한 화면은 사용 안 함으로 바꾼다.
  notScreen?: boolean;
  excludeReason?: string;
  // 배포 취소: 원본이 있는 배포 화면을 사용 안 함으로 바꾸고 원본 연결을 끊는다. 프레임은 제외하지 않으므로 다시 신규 후보로 나온다.
  unpublish?: boolean;
  // GUI 신규 후보: 새 화면으로 등록할지 기존 화면을 교체할지. 원본이 있는 배포 화면도 'replace'로 다른 화면을 교체할 수 있다.
  link?: 'new' | 'replace';
  replaceScreenId?: string;
  // GUI 원본이 사라진 화면(삭제): 사용 안 함으로 기록할지 다른 프레임으로 교체할지
  retire?: 'delete' | 'replace';
  // 교체 짝의 이전 화면 쪽. 이 화면을 교체하는 신규 후보의 항목 키. 이전 화면에는 정보를 입력하지 않는다.
  replacedBy?: string;
  // Screen ID. 프레임 이름의 대괄호 ID를 먼저 채우고, 없으면 신규 화면은 카테고리(독립)·기본 화면(케이스)으로 자동 입력한다.
  code?: string;
  // 카테고리·케이스 선택으로 자동 입력한 값. 다시 고르거나 Screen ID 규칙이 바뀔 때 직접 수정한 ID는 유지한다.
  autoCode?: string;
  name?: string;
  categoryId?: string;
  newCategoryName?: string;
  relation?: 'standalone' | 'case';
  baseScreenId?: string;
  // 공통
  tagId?: string;
  workerId?: string;
  description?: string;
  extra?: Record<string, string>;
}

// 부가정보 필드. 각 Publish 입력 폼을 정의할 때 확정한다. 현재는 임시안.
export interface OptionalField { key: string; label: string; pattern?: RegExp; hint?: string }
// 참고 링크 입력은 없앴다(2026-10-20 사용자 결정). 부가정보 필드가 다시 생기면 여기에 둔다.
export const OPTIONAL_FIELDS: OptionalField[] = [];

export type InputStatus = 'excluded' | 'invalid' | 'ready' | 'ready-plus';
export { STATUS_LABEL } from './copy.ts';
import { STATUS_LABEL } from './copy.ts';

export interface Validation {
  status: InputStatus;
  missing: string[];
  errors: string[];
}

// 아직 등록되지 않은 프레임(신규 후보)인가
export function needsLink(entry: Entry): boolean {
  return entry.screenId === null;
}

// GUI 신규 화면 등록인가: 신규 후보에서 기존 화면 교체를 고르지 않은 경우
export function isNewRegistration(team: Team, entry: Entry, draft: Draft): boolean {
  return team === 'GUI' && needsLink(entry) && draft.link !== 'replace';
}

// 프레임을 화면이 아님으로 제외하는가. 신규 후보와 원본 프레임이 남아 있는 배포 화면에서 고를 수 있다.
export function isNotScreen(entry: Entry, draft: Draft): boolean {
  return !!draft.notScreen && !!entry.frame && entry.estimate !== 'retired';
}

// 원본이 있는 배포 화면의 배포를 취소하는가(2026-10-27 사용자 요청). 화면은 사용 안 함이 되고 프레임은 신규 후보로 돌아간다.
export function isUnpublish(entry: Entry, draft: Draft): boolean {
  return entry.screenId !== null && !!entry.frame && entry.estimate !== 'missing' && entry.estimate !== 'retired' && !!draft.unpublish;
}

// 원본이 사라진 등록 화면을 사용 안 함으로 기록하는가
export function isDeletion(entry: Entry, draft: Draft): boolean {
  return entry.screenId !== null && entry.estimate === 'missing' && draft.retire !== 'replace';
}

// 교체 짝의 이전 화면인가. 이전 화면은 기록을 만들지 않고 짝인 신규 후보가 그 화면의 새 버전이 된다.
export function isPrevious(entry: Entry, draft: Draft): boolean {
  return entry.screenId !== null && !!draft.replacedBy && (entry.estimate !== 'missing' || draft.retire === 'replace');
}

// 원본이 있는 배포 화면으로 다른 화면을 교체하는가(2026-10-27 사용자 요청: 잘못 신규로 배포한 화면 바로잡기).
// 교체할 화면이 이 원본으로 새 버전이 되고, 이 화면은 사용 안 함이 되며 플립북·플로우·케이스는 교체할 화면으로 옮긴다.
export function mergesInto(entry: Entry, draft: Draft): boolean {
  return entry.screenId !== null && !!entry.frame && entry.estimate !== 'missing' && entry.estimate !== 'retired'
    && draft.link === 'replace' && !draft.notScreen && !draft.unpublish;
}

// 이 프레임이 새 버전이 될 기존 화면. 신규 후보와 배포 화면 모두 교체를 골랐을 때만 있다.
export function replaceTarget(entry: Entry, draft: Draft): string | null {
  return (needsLink(entry) && draft.link === 'replace') || mergesInto(entry, draft) ? draft.replaceScreenId ?? null : null;
}

// 초안에서 정해지는 작업 종류. 화면 교체는 기존 화면의 변경으로 기록한다.
export function workTypeOf(entry: Entry, draft: Draft): WorkType {
  if (needsLink(entry)) return draft.link === 'replace' ? 'changed' : 'new';
  return isDeletion(entry, draft) ? 'deleted' : 'changed';
}

// 배포할 Screen ID. 직접 입력한 값(빈 값 포함) → 기존 저장값 순으로 쓴다. 등록 전 프레임만 이름의 대괄호 ID를 쓴다.
// 등록 화면의 Screen ID는 기록에만 있고 프레임 이름에서 읽지 않는다(2026-10-21 사용자 결정).
export function draftCode(state: State, entry: Entry, draft: Draft): string {
  if (draft.code !== undefined) return draft.code.trim();
  const parsed = !entry.screenId && entry.frame ? parseFrameName(entry.frame.name).code : null;
  if (parsed) return parsed;
  if (isNewRegistration('GUI', entry, draft)) return '';
  const target = replaceTarget(entry, draft) ?? entry.screenId;
  return (target ? state.screens.get(target)?.code : '') ?? '';
}

// 화면 이름은 입력값을 우선하고, 아직 수정하지 않은 등록 화면은 저장된 이름, 등록 전 프레임은 프레임 이름을 쓴다.
export function draftName(state: State, entry: Entry, draft: Draft): string {
  if (draft.name !== undefined) return draft.name.trim();
  if (isNewRegistration('GUI', entry, draft)) return '';
  if (entry.screenId) return state.screens.get(entry.screenId)?.name ?? '';
  return entry.frame ? parseFrameName(entry.frame.name).name : '';
}

// 같은 배포에서 기존 ID를 비우는 화면은 충돌로 보지 않는다. 최종 ID 중복은 buildPlan에서 다시 검사한다.
export interface DraftIndex { ownersByCode: Map<string, string[]>; entriesByKey: Map<string, Entry> }

export function draftIndex(state: State, entries: Entry[]): DraftIndex {
  const ownersByCode = new Map<string, string[]>();
  for (const screen of state.screens.values()) {
    if (screen.status !== 'active') continue;
    const owners = ownersByCode.get(screen.code) ?? [];
    owners.push(screen.id);
    ownersByCode.set(screen.code, owners);
  }
  return { ownersByCode, entriesByKey: new Map(entries.map(entry => [entry.key, entry])) };
}

export function codeOwner(state: State, code: string, self: string | null, drafts: Record<string, Draft> = {}, entries: Entry[] = [], index?: DraftIndex): string | null {
  const plannedCode = (key: string, draft: Draft): string => {
    const entry = index?.entriesByKey.get(key) ?? entries.find(item => item.key === key);
    return entry ? draftCode(state, entry, draft) : draft.code?.trim() ?? state.screens.get(key)?.code ?? '';
  };
  const owners = index ? index.ownersByCode.get(code) ?? [] : [...state.screens.values()].filter(s => s.status === 'active' && s.code === code).map(s => s.id);
  for (const id of owners) {
    const s = state.screens.get(id)!;
    if (s.id === self) continue;
    const draft = drafts[s.id];
    if (draft?.included) {
      if (draft.replacedBy) {
        const replacement = drafts[draft.replacedBy];
        if (replacement?.included && plannedCode(draft.replacedBy, replacement) !== code) continue;
      // 삭제·화면이 아님·배포 취소·다른 화면을 교체하는 배포 화면은 사용 안 함이 되므로 그 ID를 비운다.
      } else if (draft.retire === 'delete' || draft.notScreen || draft.unpublish || (draft.link === 'replace' && draft.replaceScreenId) || plannedCode(s.id, draft) !== code) continue;
    }
    return s.id;
  }
  return null;
}

// 확정된 ID와 같은 배포의 입력 초안을 확인해 다음 케이스 번호를 만든다.
export function suggestedCaseCode(state: State, baseScreenId: string | undefined, reserved: Iterable<string> = []): string {
  const base = baseScreenId ? state.screens.get(baseScreenId) : null;
  if (!base?.code) return '';
  const prefix = `${base.code}-`;
  let max = 0;
  for (const code of [...[...state.screens.values()].map(screen => screen.code), ...reserved]) {
    if (!code.startsWith(prefix)) continue;
    const suffix = code.slice(prefix.length);
    if (/^\d+$/.test(suffix)) max = Math.max(max, Number(suffix));
  }
  return `${prefix}${String(max + 1).padStart(2, '0')}`;
}

export function fillCaseCode(state: State, draft: Draft, reserved: Iterable<string> = []): void {
  const next = suggestedCaseCode(state, draft.baseScreenId, reserved);
  if (!draft.code?.trim() || draft.code === draft.autoCode) draft.code = next || undefined;
  draft.autoCode = next || undefined;
}

// 신규 등록의 자동 Screen ID. 케이스는 기본 화면의 다음 케이스 번호, 독립 화면은 카테고리의 다음 번호(`{Prefix}_{코드}_{번호}`)다.
export function autoCode(state: State, entry: Entry, draft: Draft, reserved: Iterable<string> = []): string {
  if (!isNewRegistration('GUI', entry, draft) || draft.notScreen) return '';
  return draft.relation === 'case' ? suggestedCaseCode(state, draft.baseScreenId, reserved) : nextScreenCode(state, draft.categoryId, reserved);
}

// 비어 있거나 자동 입력한 값이면 바꾸고, 직접 입력한 ID·프레임 이름의 대괄호 ID는 유지한다.
export function fillAutoCode(state: State, entry: Entry, draft: Draft, reserved: Iterable<string> = []): void {
  const next = autoCode(state, entry, draft, reserved);
  if (!draft.code?.trim() || draft.code === draft.autoCode) draft.code = next || undefined;
  draft.autoCode = next || undefined;
}

// 자동 입력한 Screen ID를 스캔한 캔버스 위치 순서대로 다시 매긴다. 카테고리(케이스는 기본 화면)마다 배포 화면의 다음 번호부터
// 배포에 포함한 화면 순서대로 이어 붙이므로, 앞 화면의 카테고리를 바꾸거나 포함을 풀어도 번호가 비지 않는다.
// 직접 입력한 ID와 프레임 이름의 대괄호 ID는 그대로 두고 그 번호는 건너뛴다. 포함하지 않은 화면은 포함한 화면 다음 번호를 보여 준다.
export function renumberAutoCodes(state: State, items: { entry: Entry; draft: Draft }[]): void {
  const auto = items.filter(({ entry, draft }) => isNewRegistration('GUI', entry, draft) && !draft.notScreen && (!draft.code?.trim() || draft.code === draft.autoCode));
  const targets = new Set(auto.map(item => item.draft));
  const reserved = items.filter(({ draft }) => draft.included && !targets.has(draft) && draft.code?.trim()).map(({ draft }) => draft.code!.trim());
  for (const { entry, draft } of [...auto.filter(item => item.draft.included), ...auto.filter(item => !item.draft.included)]) {
    draft.code = undefined;
    fillAutoCode(state, entry, draft, reserved);
    if (draft.included && draft.code) reserved.push(draft.code);
  }
}

export function clearAutoCaseCode(draft: Draft): void {
  if (draft.code === draft.autoCode) draft.code = undefined;
  draft.autoCode = undefined;
}

// 기존 화면 교체: 이전 화면의 Screen ID·카테고리를 입력란에 채운다(2026-10-20 사용자 요청). 사용자가 고칠 수 있다.
export function fillFromScreen(state: State, draft: Draft, screenId: string): void {
  const screen = state.screens.get(screenId);
  if (!screen) return;
  draft.autoCode = undefined;
  draft.code = screen.code;
  draft.categoryId = screen.categoryId && state.categories.get(screen.categoryId)?.active ? screen.categoryId : undefined;
}

// 교체를 풀면 채웠던 값을 되돌린다. 사용자가 고친 값은 둔다.
export function clearFill(state: State, entry: Entry, draft: Draft, screenId: string): void {
  const screen = state.screens.get(screenId);
  if (!screen) return;
  if (draft.code === screen.code) draft.code = undefined;
  if (draft.categoryId === screen.categoryId) draft.categoryId = undefined;
}

// 행을 처음 열 때 채우는 기본값. 기존 값이 유효하면 재입력을 요구하지 않는다.
// 신규 등록은 「추가」, 삭제는 「삭제」 기본 태그를 넣는다(다른 태그로 바꿀 수 있다).
export function defaultDraft(team: Team, state: State, entry: Entry, recentWorkerId?: string): Draft {
  const draft: Draft = { included: false, extra: {} };
  if (recentWorkerId && state.workers.get(recentWorkerId)?.active) draft.workerId = recentWorkerId;
  else {
    const activeWorkers = [...state.workers.values()].filter(worker => worker.active);
    if (activeWorkers.length === 1) draft.workerId = activeWorkers[0].id;
  }
  const screen = entry.screenId ? state.screens.get(entry.screenId) : null;
  if (team === 'GUI') {
    if (needsLink(entry)) {
      // 잘라내 붙인 프레임은 원래 화면의 교체로 고른다.
      draft.link = entry.pairKey ? 'replace' : 'new';
      if (!entry.pairKey) draft.tagId = systemTagId(state, 'add') ?? undefined;
      // 프레임 이름에 대괄호 ID가 있으면 입력란에도 채운다. 없으면 카테고리·케이스 선택의 자동 입력이나 직접 입력을 기다린다.
      const parsed = parseFrameName(entry.frame?.name ?? '');
      draft.code = parsed.code ?? undefined;
      draft.name = parsed.name;
      draft.relation = 'standalone';
      if (entry.pairKey) { draft.replaceScreenId = entry.pairKey; fillFromScreen(state, draft, entry.pairKey); }
    } else if (screen && entry.estimate === 'missing') {
      draft.retire = entry.pairKey ? 'replace' : 'delete';
      if (entry.pairKey) draft.replacedBy = entry.pairKey;
      else draft.tagId = systemTagId(state, 'delete') ?? undefined;
    } else if (screen && !entry.categoryMissing) {
      draft.categoryId = screen.categoryId ?? undefined;
    }
    if (screen && entry.estimate !== 'missing') {
      draft.relation = screen.baseScreenId ? 'case' : 'standalone';
      draft.baseScreenId = screen.baseScreenId ?? undefined;
    }
  } else {
    // 플립북 확인 완료의 상태는 기본 태그 「최신」을 먼저 고른다(2026-10-20 사용자 결정).
    draft.tagId = systemTagId(state, 'latest') ?? undefined;
  }
  return draft;
}

function filled(v: string | undefined): boolean { return !!v && v.trim().length > 0; }

// drafts: 같은 탭의 다른 초안. 교체 짝(신규 후보 ↔ 이전 화면)이 서로를 가리키는지 확인한다.
export function validateDraft(team: Team, state: State, entry: Entry, draft: Draft | undefined, drafts: Record<string, Draft> = {}, entries: Entry[] = [], index?: DraftIndex): Validation {
  if (!draft?.included) return { status: 'excluded', missing: [], errors: [] };
  if (team === 'GUI' && (isNotScreen(entry, draft) || isUnpublish(entry, draft)))
    return { status: 'ready', missing: [], errors: [] };
  if (team === 'GUI' && isPrevious(entry, draft)) {
    const partner = drafts[draft.replacedBy!];
    const ok = partner?.included && partner.link === 'replace' && partner.replaceScreenId === entry.key;
    return ok ? { status: 'ready', missing: [], errors: [] } : { status: 'invalid', missing: [], errors: [COPY.coreDrafts032] };
  }
  if (team === 'GUI' && entry.estimate === 'missing' && draft.retire === 'replace')
    return { status: 'invalid', missing: [COPY.coreDrafts031], errors: [] };
  const missing: string[] = [];
  const errors: string[] = [];

  const worker = draft.workerId ? state.workers.get(draft.workerId) : null;
  if (!worker) missing.push(COPY.coreDrafts003);
  else if (!worker.active) errors.push(COPY.coreDrafts004);

  const tag = draft.tagId ? state.tags.get(draft.tagId) : null;
  if (!tag) missing.push(COPY.coreDrafts005);
  else if (tag.team !== team) errors.push(`${team} ${COPY.coreDrafts006}`);
  else if (!tag.active) errors.push(COPY.coreDrafts007);

  // 설명은 선택 입력이다. GUI는 화면별이 아니라 배포 한 번에 하나를 아래 추가 설명 영역에 쓴다(2026-10-20 사용자 결정).

  if (team === 'UI') {
    const flipbook = entry.flipbookId ? state.flipbooks.get(entry.flipbookId) : null;
    if (!flipbook || flipbook.status !== 'active') errors.push(COPY.coreDrafts009);
  } else {
    validateGui(state, entry, draft, drafts, entries, missing, errors, index);
  }

  for (const field of OPTIONAL_FIELDS) {
    const value = draft.extra?.[field.key];
    if (filled(value) && field.pattern && !field.pattern.test(value!.trim())) errors.push(`${field.label} ${COPY.coreDrafts010} ${field.hint ?? COPY.coreDrafts011}`);
  }
  if (missing.length || errors.length) return { status: 'invalid', missing, errors };
  // UI Publish는 선택 입력을 하나라도 채우면 초록 ◉. GUI는 ◉를 쓰지 않는다(2026-10-20 사용자 결정).
  const plus = team === 'UI' && (OPTIONAL_FIELDS.some(f => filled(draft.extra?.[f.key])) || filled(draft.description));
  return { status: plus ? 'ready-plus' : 'ready', missing, errors };
}

function validateGui(state: State, entry: Entry, draft: Draft, drafts: Record<string, Draft>, entries: Entry[], missing: string[], errors: string[], index?: DraftIndex): void {
  const screen = entry.screenId ? state.screens.get(entry.screenId) : null;
  if (entry.estimate === 'retired') { errors.push(COPY.coreDrafts012); return; }
  // 삭제는 Screen ID·카테고리를 다시 입력하지 않는다.
  if (isDeletion(entry, draft)) { if (!screen) errors.push(COPY.coreDrafts028); return; }

  // Screen ID는 필수이고 이 파일의 다른 화면과 겹치면 안 된다.
  const code = draftCode(state, entry, draft);
  if (!code) missing.push(COPY.coreDrafts029);
  else {
    const self = replaceTarget(entry, draft) ?? (needsLink(entry) ? null : entry.screenId);
    const owner = codeOwner(state, code, self, drafts, entries, index);
    if (owner) errors.push(`${COPY.coreDrafts030} ${state.screens.get(owner)!.name}`);
  }
  if (!draftName(state, entry, draft)) missing.push(COPY.coreDrafts019);

  const merging = mergesInto(entry, draft);
  if (needsLink(entry) || merging) {
    if (draft.link === 'replace') {
      const target = draft.replaceScreenId ? state.screens.get(draft.replaceScreenId) : null;
      if (!target || target.id === entry.screenId) { missing.push(COPY.coreDrafts014); return; }
      if (target.status !== 'active') errors.push(COPY.coreDrafts015);
      if (draft.categoryId && !state.categories.get(draft.categoryId)?.active) errors.push(COPY.coreDrafts021);
      // 원본이 남아 있는 화면도 교체할 수 있다. 그 원본은 배포 뒤 목록에서 제외한다(2026-10-20 사용자 결정).
      const partner = drafts[target.id];
      if (partner && !(partner.included && partner.replacedBy === entry.key)) errors.push(COPY.coreDrafts032);
      // 다른 화면을 교체하는 배포 화면은 그 자신이 교체될 수 없다.
      if (merging && draft.replacedBy) errors.push(COPY.coreDrafts032);
      if (entry.frame?.error) errors.push(`${COPY.coreDrafts027} ${entry.frame.error}`);
      return;
    }
    if (!draft.categoryId && !filled(draft.newCategoryName)) missing.push(COPY.coreDrafts020);
    else if (draft.categoryId && !state.categories.get(draft.categoryId)?.active) errors.push(COPY.coreDrafts021);
    else if (!draft.categoryId && findCategoryByName(state, draft.newCategoryName!)) errors.push(COPY.coreDrafts022);
    if (!draft.relation) missing.push(COPY.coreDrafts023);
    else if (draft.relation === 'case') {
      if (!draft.baseScreenId) missing.push(COPY.coreDrafts024);
      else { const e = caseRelationError(state, null, draft.baseScreenId); if (e) errors.push(e); }
    }
    return;
  }

  if (entry.categoryMissing && !draft.categoryId) missing.push(COPY.coreDrafts020);
  else if (draft.categoryId && !state.categories.get(draft.categoryId)?.active) errors.push(COPY.coreDrafts021);
  if (draft.relation === 'case') {
    if (!draft.baseScreenId) missing.push(COPY.coreDrafts024);
    else { const e = caseRelationError(state, entry.screenId, draft.baseScreenId); if (e) errors.push(e); }
  }
  if (entry.frame?.error) errors.push(`${COPY.coreDrafts027} ${entry.frame.error}`);
  if (!screen) errors.push(COPY.coreDrafts028);
}
