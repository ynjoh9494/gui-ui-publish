import { COPY } from './copy.ts';
import { baseline, entryName, UI_FINGERPRINT_VERSION, type Entry } from './compare.ts';
import { draftCode, draftName, isNotScreen, isPrevious, needsLink, OPTIONAL_FIELDS, validateDraft, workTypeOf, type Draft } from './drafts.ts';
import { FINGERPRINT_VERSION, LEGACY_FINGERPRINT_VERSION } from './fingerprint.ts';
import { sha256 } from './hash.ts';
import { addCategory, addExclusion, caseRelationError, findCategoryByName, workerLabel } from './registry.ts';
import { keys, lastGui, type State, type Store } from './store.ts';
import type {
  Actor, Batch, Delivery, DeliveryKind, DeliveryState, GuiAck, GuiRecord, GuiThumb, Screen, Snapshot, TagSnapshot, Team, UiRecord, UiState, WorkType,
} from './types.ts';

export interface PlanFrame { nodeId: string; pageId: string; fingerprint: string | null; width: number; height: number; name: string }

export interface PlanItem {
  entryKey: string;
  team: Team;
  // GUI: 화면 ID, UI: 플립북 ID
  screenId: string;
  isNew: boolean;
  workType: WorkType | null;
  // 확정 직전 검사 기준. 신규는 null
  expectedRev: number | null;
  fromVersion: number;
  toVersion: number;
  frame: PlanFrame | null;
  // 확정 직전 원본으로 썸네일을 만든다(신규·변경). 플립북에는 확정 뒤 원본을 바로 복사한다.
  needsThumb: boolean;
  // GUI: Screen ID. UI: 빈 값
  code: string;
  name: string;
  categoryId: string | null;
  // 확정 전 카테고리. 기존 화면의 카테고리를 바꾸면 categoryId와 다르다.
  fromCategoryId: string | null;
  newCategoryName: string | null;
  baseScreenId: string | null;
  tag: TagSnapshot;
  worker: Snapshot;
  description: string;
  extra: Record<string, string>;
  metadataChanged: boolean;
}

export interface Blocker { entryKey: string; name: string; messages: string[] }

export interface Plan {
  batchId: string;
  team: Team;
  actor: Actor;
  items: PlanItem[];
  // replacedBy: 다른 프레임으로 교체되는 이전 화면의 ID. 그 화면의 원본 프레임을 제외 목록에 넣는다.
  // screenId: 화면이 아님으로 고른 배포 화면의 ID. 프레임을 제외하고 화면을 사용 안 함으로 바꾼다. expectedRev는 확정 직전 검사 기준이다.
  exclusions: { entryKey: string; nodeId: string; name: string; reason: string; replacedBy?: string; screenId?: string; expectedRev?: number }[];
  counts: { new: number; changed: number; deleted: number; metadata: number; ui: number };
  // 변경 후보이지만 이번에 포함하지 않은 항목 수
  held: number;
  blockers: Blocker[];
}

// 재실행해도 같은 신규 화면 ID가 나오도록 작업 ID와 항목 키에서 만든다.
export function newScreenId(batchId: string, entryKey: string): string {
  return 's' + sha256(`${batchId}|${entryKey}`).slice(0, 15);
}

function tagSnapshot(state: State, id: string): TagSnapshot {
  const tag = state.tags.get(id)!;
  return { id: tag.id, name: tag.name, color: tag.color, colorKey: tag.colorKey };
}

function workerSnapshot(state: State, id: string): Snapshot {
  const worker = state.workers.get(id)!;
  return { id: worker.id, name: workerLabel(worker) };
}

function toFrame(entry: Entry): PlanFrame | null {
  const f = entry.frame;
  return f ? { nodeId: f.nodeId, pageId: f.pageId, fingerprint: f.fingerprint, width: f.width, height: f.height, name: f.name } : null;
}

// GUI 배포의 추가 설명(설명·참고 링크). 화면별이 아니라 배포 한 번에 하나이며 선택 입력이다(2026-10-20 사용자 결정).
export interface BatchComment { description: string; extra: Record<string, string> }
export const emptyComment = (): BatchComment => ({ description: '', extra: {} });

export function buildPlan(
  team: Team, state: State, entries: Entry[], drafts: Record<string, Draft>, actor: Actor, batchId: string, comment: BatchComment = emptyComment(),
): Plan {
  const plan: Plan = {
    batchId, team, actor, items: [], exclusions: [], blockers: [], held: 0,
    counts: { new: 0, changed: 0, deleted: 0, metadata: 0, ui: 0 },
  };
  const targets = new Map<string, string>();
  const codes = new Map<string, string>();

  for (const entry of entries) {
    const draft = drafts[entry.key];
    if (!draft?.included) {
      if (team === 'GUI' && (entry.estimate === 'new' || entry.estimate === 'changed' || entry.estimate === 'missing')) plan.held++;
      continue;
    }
    if (team === 'GUI' && isNotScreen(entry, draft)) {
      const screen = entry.screenId ? state.screens.get(entry.screenId) : null;
      plan.exclusions.push({
        entryKey: entry.key, nodeId: entry.frame!.nodeId, name: entry.frame!.name, reason: draft.excludeReason?.trim() ?? '',
        ...(screen ? { screenId: screen.id, expectedRev: screen.rev } : {}),
      });
      continue;
    }
    const name = entryName(state, entry);
    const v = validateDraft(team, state, entry, draft, drafts, entries);
    if (v.status === 'invalid') {
      plan.blockers.push({ entryKey: entry.key, name, messages: [...v.missing.map(m => `${m} ${COPY.corePublish001}`), ...v.errors] });
      continue;
    }
    // 교체 짝의 이전 화면은 기록하지 않는다. 짝인 신규 후보가 그 화면의 새 버전이 되고, 남아 있는 원본 프레임은 제외한다.
    if (team === 'GUI' && isPrevious(entry, draft)) {
      if (entry.frame) plan.exclusions.push({ entryKey: entry.key, nodeId: entry.frame.nodeId, name: entry.frame.name, reason: COPY.corePublish016, replacedBy: entry.screenId! });
      continue;
    }
    const item = team === 'GUI' ? guiItem(state, entry, draft, batchId, comment) : uiItem(state, entry, draft);
    const previous = targets.get(item.screenId);
    if (previous) {
      plan.blockers.push({ entryKey: entry.key, name, messages: [`${COPY.corePublish002} ${item.name}`] });
      continue;
    }
    if (team === 'GUI') {
      // 같은 배포 안의 두 화면이 같은 Screen ID를 쓰면 막는다. 이미 등록된 화면과의 중복은 validateDraft가 막는다.
      if (item.workType !== 'deleted') {
        if (codes.has(item.code)) { plan.blockers.push({ entryKey: entry.key, name, messages: [`${COPY.corePublish015} ${item.code}`] }); continue; }
        codes.set(item.code, entry.key);
      }
    }
    targets.set(item.screenId, entry.key);
    plan.items.push(item);
    if (team === 'UI') {
      if (item.workType === 'deleted') plan.counts.deleted++;
      else plan.counts.ui++;
    }
    else plan.counts[item.workType!]++;
    if (item.metadataChanged) plan.counts.metadata++;
  }
  if (team === 'GUI') {
    const planned = new Map(plan.items.map(item => [item.screenId, item]));
    for (const item of plan.items) if (item.baseScreenId && planned.get(item.baseScreenId)?.baseScreenId)
      plan.blockers.push({ entryKey: item.entryKey, name: item.name, messages: [COPY.coreRegistry018] });
  }
  if (!plan.items.length && !plan.exclusions.length && !plan.blockers.length) plan.blockers.push({ entryKey: '', name: '', messages: [COPY.corePublish003] });
  if (team === 'GUI') for (const error of commentErrors(comment)) plan.blockers.push({ entryKey: '', name: '', messages: [error] });
  return plan;
}

function guiItem(state: State, entry: Entry, draft: Draft, batchId: string, comment: BatchComment): PlanItem {
  const description = comment.description.trim();
  const extra = cleanExtra(comment.extra);
  const workType = workTypeOf(entry, draft);
  if (workType === 'deleted') {
    // 원본이 사라진 화면을 사용 안 함으로 기록한다. 레이어 복사본은 만들지 않고 이전 확정본을 그대로 둔다.
    const screen = state.screens.get(entry.screenId!)!;
    return {
      entryKey: entry.key, team: 'GUI', screenId: screen.id, isNew: false, workType, expectedRev: screen.rev,
      fromVersion: screen.guiVersion, toVersion: screen.guiVersion + 1, frame: null, needsThumb: false,
      code: screen.code, name: screen.name, categoryId: screen.categoryId, fromCategoryId: screen.categoryId, newCategoryName: null,
      baseScreenId: screen.baseScreenId, tag: tagSnapshot(state, draft.tagId!), worker: workerSnapshot(state, draft.workerId!),
      description, extra, metadataChanged: false,
    };
  }
  const common = {
    entryKey: entry.key, team: 'GUI' as const, workType, frame: toFrame(entry), code: draftCode(state, entry, draft), name: draftName(state, entry, draft),
    tag: tagSnapshot(state, draft.tagId!), worker: workerSnapshot(state, draft.workerId!), description, extra,
  };
  if (needsLink(entry) && draft.link === 'new') {
    return {
      ...common, screenId: newScreenId(batchId, entry.key), isNew: true, expectedRev: null, fromVersion: 0, toVersion: 1,
      needsThumb: true, categoryId: draft.categoryId ?? null, fromCategoryId: null,
      newCategoryName: draft.categoryId ? null : draft.newCategoryName!.trim(),
      baseScreenId: draft.relation === 'case' ? draft.baseScreenId! : null, metadataChanged: false,
    };
  }
  const screenId = needsLink(entry) ? draft.replaceScreenId! : entry.screenId!;
  const screen = state.screens.get(screenId)!;
  const categoryId = draft.categoryId ?? screen.categoryId;
  // 교체는 화면 관계를 입력받지 않으므로 이전 화면의 관계를 그대로 둔다. 신규 등록으로 골랐다가 남은 값은 쓰지 않는다.
  const baseScreenId = needsLink(entry) ? screen.baseScreenId
    : draft.relation === 'case' ? draft.baseScreenId ?? null : draft.relation === 'standalone' ? null : screen.baseScreenId;
  return {
    ...common, screenId, isNew: false, expectedRev: screen.rev, fromVersion: screen.guiVersion, toVersion: screen.guiVersion + 1,
    needsThumb: workType === 'changed', categoryId, fromCategoryId: screen.categoryId, newCategoryName: null,
    baseScreenId,
    metadataChanged: common.name !== screen.name || common.code !== screen.code || categoryId !== screen.categoryId || baseScreenId !== screen.baseScreenId,
  };
}

function uiItem(state: State, entry: Entry, draft: Draft): PlanItem {
  const flipbook = state.flipbooks.get(entry.flipbookId!)!;
  const ui = state.uiStates.get(flipbook.id);
  return {
    entryKey: entry.key, team: 'UI', screenId: flipbook.id, isNew: false, workType: entry.estimate === 'missing' ? 'deleted' : 'changed',
    expectedRev: ui?.rev ?? 0, fromVersion: ui?.version ?? 0, toVersion: (ui?.version ?? 0) + 1,
    frame: null, needsThumb: false, code: '', name: flipbook.title, categoryId: null, fromCategoryId: null, newCategoryName: null,
    baseScreenId: null, tag: tagSnapshot(state, draft.tagId!), worker: workerSnapshot(state, draft.workerId!),
    description: (draft.description ?? '').trim(), extra: cleanExtra(draft.extra), metadataChanged: false,
  };
}

// 추가 설명의 부가정보 형식 검사(참고 링크)
export function commentErrors(comment: BatchComment): string[] {
  return OPTIONAL_FIELDS.flatMap(field => {
    const value = comment.extra[field.key]?.trim();
    return value && field.pattern && !field.pattern.test(value) ? [`${field.label} ${COPY.coreDrafts010} ${field.hint ?? COPY.coreDrafts011}`] : [];
  });
}

function cleanExtra(extra: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(extra ?? {})) if (v && v.trim()) out[k] = v.trim();
  return out;
}

// ── 확정 ─────────────────────────────────────────────────

export interface CommitInput {
  // 확정 직전 다시 계산한 지문. 최종 확인 이후 화면이 바뀌었는지 검사한다.
  fingerprints: Record<string, string | null>;
  // 확정 직전 만든 썸네일. 만들지 못해도 확정은 한다(썸네일 없음으로 기록).
  thumbs: Record<string, GuiThumb>;
  // UI Publish: 확정 직전 읽은 플립북 UI 작성 영역의 지문. 다음 비교의 기준이 된다.
  uiFingerprints?: Record<string, string | null>;
  // 확정 직전 실제로 존재한 플립북 프레임. 삭제 확정 때도 재확인한다.
  uiNodeIds?: Record<string, string | null>;
}

// 화면마다 따로 확정한다. 일부가 충돌해도 나머지는 확정하고, 실패한 항목은 conflicts로 돌려준다.
// ok: 한 건 이상 확정했다. committed: 확정한(또는 같은 작업 ID로 이미 확정된) 항목의 entryKey
export interface CommitResult {
  ok: boolean;
  replay: boolean;
  committed: string[];
  conflicts: Blocker[];
  batch: Batch | null;
  deliveries: Delivery[];
}

function recordKey(item: PlanItem): string {
  return item.team === 'GUI' ? keys.gui(item.screenId, item.toVersion) : keys.ui(item.screenId, item.toVersion);
}

// 같은 작업 ID로 이미 기록한 항목인가 (중단 후 재실행)
function alreadyWritten(store: Store, item: PlanItem, batchId: string): boolean {
  return store.readFresh<{ batchId: string }>(recordKey(item))?.batchId === batchId;
}

function checkItem(store: Store, item: PlanItem, input: CommitInput): string[] {
  const out: string[] = [];
  if (item.team === 'GUI') {
    if (item.isNew) {
      for (const s of store.state.screens.values())
        if (s.source?.nodeId === item.frame?.nodeId && s.status === 'active') out.push(`${COPY.corePublish004} ${s.name}`);
    } else {
      const fresh = store.readFresh<Screen>(keys.screen(item.screenId));
      if (!fresh) out.push(COPY.corePublish005);
      else if (fresh.rev !== item.expectedRev) out.push(COPY.corePublish006);
    }
    // 최종 확인 뒤 다른 작업자가 카테고리를 삭제했을 수 있다. 삭제는 카테고리를 다시 정하지 않는다.
    if (item.workType !== 'deleted' && item.categoryId && !store.state.categories.get(item.categoryId)?.active) out.push(COPY.corePublish007);
    if (item.workType !== 'deleted' && item.baseScreenId) {
      const error = caseRelationError(store.state, item.isNew ? null : item.screenId, item.baseScreenId);
      if (error) out.push(error);
    }
    if (item.needsThumb) {
      if (!item.frame) out.push(COPY.corePublish008);
      else if (input.fingerprints[item.entryKey] !== item.frame.fingerprint) out.push(COPY.corePublish009);
    }
  } else {
    const fresh = store.readFresh<UiState>(keys.uiState(item.screenId));
    if ((fresh?.rev ?? 0) !== item.expectedRev) out.push(COPY.corePublish011);
    const flipbook = store.readFresh<{ status: string; rev: number }>(keys.flipbook(item.screenId));
    if (!flipbook || flipbook.status !== 'active') out.push(COPY.coreDrafts009);
    const nodeId = input.uiNodeIds?.[item.entryKey] ?? null;
    if (item.workType === 'deleted' ? !!nodeId : !nodeId) out.push(COPY.corePublish017);
  }
  return out;
}

// 화면마다 검사해 통과한 화면만 확정한다. 충돌한 화면은 기록하지 않고 다음 Publish 후보로 남는다.
export function commitPlan(store: Store, plan: Plan, input: CommitInput): CommitResult {
  if (plan.blockers.length) return { ok: false, replay: false, committed: [], conflicts: plan.blockers, batch: null, deliveries: [] };
  store.reload();
  const existing = store.state.batches.get(plan.batchId);
  if (existing) {
    const deliveries = [...store.state.deliveries.values()].filter(d => d.batchId === plan.batchId);
    const done = new Set(existing.items.map(i => i.screenId));
    const committed = plan.items.filter(i => done.has(i.screenId)).map(i => i.entryKey);
    return { ok: true, replay: true, committed, conflicts: [], batch: existing, deliveries };
  }

  const conflicts: Blocker[] = [];
  const written: PlanItem[] = [];
  const ready: PlanItem[] = [];
  for (const item of plan.items) {
    if (alreadyWritten(store, item, plan.batchId)) { written.push(item); continue; }
    const messages = checkItem(store, item, input);
    if (messages.length) conflicts.push({ entryKey: item.entryKey, name: item.name, messages });
    else ready.push(item);
  }
  const exclusions = plan.exclusions.filter(exclusion => {
    // 다른 프레임으로 교체되는 화면의 원본은 같은 배포에서 새 프레임으로 연결되므로 제외할 수 있다.
    // 화면이 아님으로 고른 배포 화면은 자기 원본이므로 제외할 수 있다.
    const linked = [...store.state.screens.values()].find(s => s.status === 'active' && s.source?.nodeId === exclusion.nodeId && s.id !== exclusion.replacedBy && s.id !== exclusion.screenId);
    if (linked) conflicts.push({ entryKey: exclusion.entryKey, name: exclusion.name, messages: [`${COPY.corePublish012} ${linked.name}`] });
    const messages = exclusion.screenId ? retireCheck(store, exclusion.screenId, exclusion.expectedRev) : [];
    if (messages.length) conflicts.push({ entryKey: exclusion.entryKey, name: exclusion.name, messages });
    return !linked && !messages.length;
  });
  // 화면이 아님으로 사용 안 함이 되는 화면의 ID는 같은 배포의 다른 화면이 쓸 수 있다.
  const retiring = new Set(exclusions.flatMap(exclusion => exclusion.screenId ? [exclusion.screenId] : []));
  // 일부 화면이 충돌해 빠졌다면 그 화면이 아직 쓰는 ID를 받으려는 화면도 함께 보류한다.
  // 한 칸씩 밀기나 ID 맞교환은 관련 화면이 모두 확정될 때 허용한다.
  if (plan.team === 'GUI') {
    let removed = true;
    while (removed) {
      removed = false;
      const readyById = new Map(ready.map(item => [item.screenId, item]));
      for (let index = ready.length - 1; index >= 0; index--) {
        const item = ready[index];
        if (item.workType === 'deleted') continue;
        const owner = [...store.state.screens.values()].find(screen => screen.status === 'active' && !retiring.has(screen.id) && screen.id !== item.screenId && screen.code === item.code);
        if (!owner) continue;
        const ownerPlan = readyById.get(owner.id);
        if (ownerPlan && (ownerPlan.workType === 'deleted' || ownerPlan.code !== item.code)) continue;
        conflicts.push({ entryKey: item.entryKey, name: item.name, messages: [`${COPY.coreDrafts030} ${owner.name}`] });
        ready.splice(index, 1);
        removed = true;
      }
    }
  }
  const committed = [...written, ...ready];
  if (!committed.length && !exclusions.length) return { ok: false, replay: false, committed: [], conflicts, batch: null, deliveries: [] };

  const now = store.now();
  for (const exclusion of exclusions) {
    addExclusion(store, exclusion.nodeId, exclusion.name, exclusion.reason, plan.actor);
    if (exclusion.screenId) retireNotScreen(store, exclusion.screenId, exclusion.reason, plan.actor);
  }
  for (const item of ready) {
    if (item.team === 'GUI') writeGui(store, plan, item, input, now);
    else writeUi(store, plan, item, input, now);
  }

  // UI는 그 플립북 반영이 뒤따른다. GUI는 확정 뒤 그 화면을 쓰는 플립북마다 전달을 만든다(Controller.pullGui).
  const deliveries: Delivery[] = plan.team === 'GUI' ? [] : committed.filter(item => item.workType !== 'deleted').map(item => {
    const key = keys.delivery(plan.batchId, item.screenId);
    const found = store.state.deliveries.get(key);
    if (found) return found;
    const delivery: Delivery = { batchId: plan.batchId, kind: 'flipbook', targetId: item.screenId, team: plan.team, version: item.toVersion, state: 'pending', error: null, updatedAt: now };
    store.put(key, delivery);
    return delivery;
  });
  // 묶음 기록은 마지막에 쓴다. 이 키가 있으면 확정한 화면의 기록이 모두 끝난 것이다. 확정하지 못한 화면은 넣지 않는다.
  const batch: Batch = { id: plan.batchId, team: plan.team, actor: plan.actor, committedAt: now, items: committed.map(i => ({ screenId: i.screenId, version: i.toVersion })) };
  store.put(keys.batch(batch.id), batch);
  return { ok: true, replay: false, committed: [...committed, ...exclusions].map(i => i.entryKey), conflicts, batch, deliveries };
}

function writeGui(store: Store, plan: Plan, item: PlanItem, input: CommitInput, now: number): void {
  const state = store.state;
  let categoryId = item.categoryId;
  if (item.newCategoryName) categoryId = (findCategoryByName(state, item.newCategoryName) ?? addCategory(store, item.newCategoryName, plan.actor)).id;
  const before = item.isNew ? null : state.screens.get(item.screenId)!;
  const previous = item.isNew ? null : lastGui(state, item.screenId);
  const thumb = item.needsThumb ? input.thumbs[item.entryKey] ?? null : previous?.thumb ?? null;
  const captured = item.needsThumb && !!item.frame;
  const category = categoryId ? state.categories.get(categoryId) ?? null : null;
  const base = item.baseScreenId ? state.screens.get(item.baseScreenId) ?? null : null;

  const record: GuiRecord = {
    screenId: item.screenId, version: item.toVersion, batchId: plan.batchId, workType: item.workType!,
    fingerprint: captured ? item.frame!.fingerprint : previous?.fingerprint ?? null,
    fpVersion: captured ? FINGERPRINT_VERSION : previous?.fpVersion ?? 1,
    thumb,
    width: captured ? item.frame!.width : previous?.width ?? 0,
    height: captured ? item.frame!.height : previous?.height ?? 0,
    code: item.code,
    name: item.name,
    category: category ? { id: category.id, name: category.name } : null,
    base: base ? { id: base.id, name: base.name } : null,
    tag: item.tag, description: item.description, worker: item.worker, actor: plan.actor, committedAt: now,
    extra: item.extra, corrections: [],
  };
  store.put(keys.gui(item.screenId, item.toVersion), record);

  const screen: Screen = before
    ? {
      ...before, rev: before.rev + 1, code: item.code, name: item.name, categoryId, baseScreenId: item.baseScreenId, guiVersion: item.toVersion, guiTag: item.tag, ack: null,
      source: item.frame ? { nodeId: item.frame.nodeId, pageId: item.frame.pageId } : before.source,
      // 삭제로 배포한 화면은 사용 안 함으로 바꾸고 목록에서 뺀다.
      status: item.workType === 'deleted' ? 'deleted' : before.status,
    }
    : {
      id: item.screenId, rev: 1, code: item.code, name: item.name, categoryId, baseScreenId: item.baseScreenId, status: 'active',
      source: { nodeId: item.frame!.nodeId, pageId: item.frame!.pageId }, guiVersion: 1, guiTag: item.tag, createdAt: now,
    };
  store.put(keys.screen(screen.id), screen);
}

// 화면이 아님으로 고른 배포 화면의 확정 직전 검사. 최종 확인 뒤 다른 작업이 화면을 바꿨으면 확정하지 않는다.
function retireCheck(store: Store, screenId: string, expectedRev: number | undefined): string[] {
  const fresh = store.readFresh<Screen>(keys.screen(screenId));
  if (!fresh || fresh.status !== 'active') return [COPY.corePublish005];
  return fresh.rev === expectedRev ? [] : [COPY.corePublish006];
}

// 이미 배포한 화면을 화면이 아님으로 확정한다. GUI 버전·이력은 만들지 않고 사용 안 함으로 바꿔 목록에서 뺀다.
// 원본 연결을 끊어 두므로 제외를 해제하면 그 프레임은 신규 후보로 다시 나온다.
function retireNotScreen(store: Store, screenId: string, reason: string, actor: Actor): void {
  const before = store.state.screens.get(screenId)!;
  store.put(keys.screen(screenId), { ...before, rev: before.rev + 1, status: 'deleted', source: null } satisfies Screen);
  store.audit(actor, 'screen.notScreen', screenId, { status: before.status, source: before.source }, { status: 'deleted', source: null }, reason);
}

// 「변경 무시」: 변경 감지된 화면의 현재 지문을 지금 버전의 비교 기준으로 저장한다. 버전·이력·플립북은 그대로이며
// 최종 확인 없이 바로 쓰고 감사 기록에 남긴다(2026-10-20 사용자 결정).
export function acknowledgeChange(store: Store, screenId: string, fingerprint: string, actor: Actor): void {
  const before = store.readFresh<Screen>(keys.screen(screenId));
  if (!before) throw new Error(COPY.corePublish005);
  const ack: GuiAck = { version: before.guiVersion, fingerprint, fpVersion: FINGERPRINT_VERSION, actor, at: store.now() };
  store.put(keys.screen(screenId), { ...before, rev: before.rev + 1, ack } satisfies Screen);
  store.audit(actor, 'gui.ignoreChange', screenId, before.ack?.fingerprint ?? lastGui(store.state, screenId)?.fingerprint ?? null, fingerprint);
}

// 1 규칙으로 저장한 비교 기준을 같은 원본의 2 규칙 지문으로 옮긴다(FINGERPRINT_VERSION 참고).
// 원본의 1 규칙 지문이 기준과 같을 때만 옮기므로 판정은 바뀌지 않는다. 기준만 다시 적는 것이라 감사 기록은 남기지 않는다.
export function upgradeBaseline(store: Store, screenId: string, legacy: string, fingerprint: string, actor: Actor): boolean {
  const screen = store.state.screens.get(screenId);
  if (!screen || screen.status !== 'active') return false;
  const base = baseline(store.state, screen);
  if (!base?.fingerprint || (base.fpVersion ?? 1) !== LEGACY_FINGERPRINT_VERSION || base.fingerprint !== legacy) return false;
  const ack: GuiAck = { version: screen.guiVersion, fingerprint, fpVersion: FINGERPRINT_VERSION, actor, at: store.now() };
  store.put(keys.screen(screenId), { ...screen, rev: screen.rev + 1, ack } satisfies Screen);
  return true;
}

// UI Publish는 플립북의 UI 상태와 UI 이력만 쓴다.
function writeUi(store: Store, plan: Plan, item: PlanItem, input: CommitInput, now: number): void {
  const before = store.state.uiStates.get(item.screenId);
  const fingerprint = input.uiFingerprints?.[item.entryKey] ?? null;
  const record: UiRecord = {
    flipbookId: item.screenId, version: item.toVersion, batchId: plan.batchId, workType: item.workType === 'deleted' ? 'deleted' : 'changed',
    ...(fingerprint ? { fingerprint, fpVersion: UI_FINGERPRINT_VERSION } : {}),
    tag: item.tag, description: item.description,
    worker: item.worker, actor: plan.actor, committedAt: now, extra: item.extra, corrections: [],
  };
  store.put(keys.ui(item.screenId, item.toVersion), record);
  const ui: UiState = { flipbookId: item.screenId, rev: (before?.rev ?? 0) + 1, version: item.toVersion, tag: item.tag };
  store.put(keys.uiState(item.screenId), ui);
  if (item.workType === 'deleted') {
    const fb = store.state.flipbooks.get(item.screenId)!;
    store.put(keys.flipbook(fb.id), { ...fb, rev: fb.rev + 1, status: 'deleted' });
    for (const delivery of store.state.deliveries.values())
      if (delivery.targetId === fb.id && delivery.state !== 'done')
        store.put(keys.delivery(delivery.batchId, delivery.targetId), { ...delivery, state: 'done', error: null, updatedAt: now });
    store.audit(plan.actor, 'flipbook.retire', fb.id, 'active', 'deleted');
  }
}

// ── 전달 ─────────────────────────────────────────────────

export function addDelivery(store: Store, batchId: string, kind: DeliveryKind, team: Team, targetId: string, version: number): Delivery {
  const key = keys.delivery(batchId, targetId);
  const delivery: Delivery = { batchId, kind, targetId, team, version, state: 'pending', error: null, updatedAt: store.now() };
  store.put(key, delivery);
  return delivery;
}

export function setDeliveryState(store: Store, batchId: string, targetId: string, next: DeliveryState, error: string | null = null): Delivery {
  const key = keys.delivery(batchId, targetId);
  const before = store.state.deliveries.get(key);
  if (!before) throw new Error(COPY.corePublish013);
  const after: Delivery = { ...before, state: next, error, updatedAt: store.now() };
  store.put(key, after);
  return after;
}

// 끝나지 않은 전달. 같은 작업 ID로 실패 대상만 다시 반영한다.
export function unfinishedDeliveries(state: State, filter: { batchId?: string; kind?: DeliveryKind } = {}): Delivery[] {
  return [...state.deliveries.values()].filter(d => d.state !== 'done' && (!filter.batchId || d.batchId === filter.batchId) && (!filter.kind || d.kind === filter.kind));
}
