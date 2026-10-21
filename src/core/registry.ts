import { COPY } from './copy.ts';
import { isColorKey, paletteHex } from './palette.ts';
import { activeCategoryCodes, CATEGORY_CODE_PATTERN, codeRenames, generateCategoryCode, inferCategoryCode, inferScreenIdPrefix, renameConflicts, renumberRenames, SCREEN_ID_PREFIX_PATTERN, type CanvasPosition, type CodeRename } from './screenCode.ts';
import { keys, type State, type Store } from './store.ts';
import type { Actor, Category, Exclusion, GuiRecord, ProjectConfig, Screen, SystemTag, TagDef, Team, UiRecord, Worker } from './types.ts';

export class RegistryError extends Error {}

function clean(name: string, label: string): string {
  const value = name.trim();
  if (!value) throw new RegistryError(`${label}${COPY.coreRegistry001}`);
  return value;
}

export function workerLabel(worker: Worker): string {
  return worker.alias ? `${worker.name} (${worker.alias})` : worker.name;
}

// ── 카테고리 ─────────────────────────────────────────────

export function findCategoryByName(state: State, name: string): Category | null {
  const target = name.trim();
  for (const category of state.categories.values()) if (category.active && category.name === target) return category;
  return null;
}

export function addCategory(store: Store, name: string, actor: Actor): Category {
  const value = clean(name, COPY.coreRegistry002);
  if (findCategoryByName(store.state, value)) throw new RegistryError(`${COPY.coreRegistry003} ${value}`);
  const order = Math.max(0, ...[...store.state.categories.values()].map(c => c.order + 1));
  const category: Category = { id: store.newId(), name: value, order, active: true, code: generateCategoryCode(value, activeCategoryCodes(store.state)) };
  store.put(keys.category(category.id), category);
  store.audit(actor, 'category.add', category.id, null, category);
  return category;
}

export function renameCategory(store: Store, id: string, name: string, actor: Actor): Category {
  const before = store.state.categories.get(id);
  if (!before) throw new RegistryError(COPY.coreRegistry004);
  const value = clean(name, COPY.coreRegistry002);
  const same = findCategoryByName(store.state, value);
  if (same && same.id !== id) throw new RegistryError(`${COPY.coreRegistry003} ${value}`);
  const after = { ...before, name: value };
  store.put(keys.category(id), after);
  store.audit(actor, 'category.rename', id, before, after);
  return after;
}

// 삭제는 사용 중지로 남긴다. 과거 이력은 당시 이름을 그대로 보여 주고, 배정된 화면은 새 카테고리를 지정하도록 표시된다.
export function setCategoryActive(store: Store, id: string, active: boolean, actor: Actor): void {
  const before = store.state.categories.get(id);
  if (!before) throw new RegistryError(COPY.coreRegistry004);
  store.put(keys.category(id), { ...before, active });
  store.audit(actor, 'category.active', id, before.active, active);
}

// Screen ID 규칙을 정하기 전에 만든 프로젝트를 실행할 때 빠진 Prefix·카테고리 코드를 채운다. 바꾼 것이 있으면 true
export function ensureScreenIdRules(store: Store, actor: Actor): boolean {
  const prefix = ensureScreenIdPrefix(store, actor);
  return ensureCategoryCodes(store, actor) || prefix;
}

// Prefix를 저장한 적 없는 프로젝트는 기존 배포 화면의 Screen ID에서 Prefix를 읽어 저장한다(2026-10-21 사용자 요청). 바꾼 것이 있으면 true
export function ensureScreenIdPrefix(store: Store, actor: Actor): boolean {
  if (typeof store.readFresh<Partial<ProjectConfig>>(keys.project)?.screenIdPrefix === 'string') return false;
  const prefix = inferScreenIdPrefix(store.state);
  if (prefix === null) return false;
  store.saveProject({ ...store.state.project, screenIdPrefix: prefix });
  store.audit(actor, 'project.screenIdPrefix', 'project', null, prefix);
  return true;
}

// 코드가 없는 카테고리(이 기능 전에 만든 카테고리)에 코드를 만든다. 기존 배포 화면의 Screen ID에 쓴 코드가 있으면 그 코드를, 없으면 이름으로 만든다.
// 바꾼 것이 있으면 true
export function ensureCategoryCodes(store: Store, actor: Actor): boolean {
  let changed = false;
  const categories = [...store.state.categories.values()].filter(c => c.active && !c.code).sort((a, b) => a.order - b.order);
  for (const before of categories) {
    const used = activeCategoryCodes(store.state);
    const inferred = inferCategoryCode(store.state, before.id);
    const code = inferred && !used.some(c => c.toUpperCase() === inferred) ? inferred : generateCategoryCode(before.name, used);
    const after = { ...before, code };
    store.put(keys.category(before.id), after);
    store.audit(actor, 'category.code', before.id, null, after.code);
    changed = true;
  }
  return changed;
}

// 카테고리 코드 수정. 그 카테고리의 배포 화면 중 현재 규칙으로 만든 Screen ID를 새 코드로 바로 바꾼다(2026-10-20 사용자 결정).
// 바뀐 화면 목록을 돌려준다. 원본 프레임 이름과 플립북은 호출한 쪽이 맞춘다.
export function setCategoryCode(store: Store, id: string, code: string, actor: Actor): CodeRename[] {
  const before = store.state.categories.get(id);
  if (!before) throw new RegistryError(COPY.coreRegistry004);
  const value = code.trim();
  if (!CATEGORY_CODE_PATTERN.test(value)) throw new RegistryError(COPY.coreRegistry031);
  if (activeCategoryCodes(store.state, id).some(other => other.toUpperCase() === value.toUpperCase()))
    throw new RegistryError(`${COPY.coreRegistry032} ${value}`);
  if (value === before.code) return [];
  const renames = before.code ? codeRenames(store.state, { categoryId: id, code: value }) : [];
  checkRenames(store.state, renames);
  store.put(keys.category(id), { ...before, code: value });
  store.audit(actor, 'category.code', id, before.code ?? null, value);
  applyRenames(store, renames, actor, 'category.code');
  return renames;
}

// 플랫폼 Prefix 수정. 현재 규칙으로 만든 배포 화면의 Screen ID를 새 Prefix로 바로 바꾼다.
export function setScreenIdPrefix(store: Store, prefix: string, actor: Actor): CodeRename[] {
  const value = prefix.trim();
  if (!SCREEN_ID_PREFIX_PATTERN.test(value)) throw new RegistryError(COPY.coreRegistry033);
  const before = store.state.project;
  if (value === before.screenIdPrefix) return [];
  const renames = codeRenames(store.state, { prefix: value });
  checkRenames(store.state, renames);
  store.saveProject({ ...before, screenIdPrefix: value });
  store.audit(actor, 'project.screenIdPrefix', 'project', before.screenIdPrefix, value);
  applyRenames(store, renames, actor, 'project.screenIdPrefix');
  return renames;
}

// 배포 화면의 Screen ID 번호를 카테고리마다 원본 프레임의 캔버스 배치 순서로 001부터 다시 매긴다(2026-10-21 사용자 결정).
// 바뀐 화면 목록을 돌려준다. 원본 프레임 이름과 플립북은 호출한 쪽이 맞춘다.
export function renumberScreenIds(store: Store, positions: Map<string, CanvasPosition>, actor: Actor): CodeRename[] {
  const renames = renumberRenames(store.state, positions);
  checkRenames(store.state, renames);
  if (renames.length) store.audit(actor, 'project.renumberScreenIds', 'project', null, renames.length);
  applyRenames(store, renames, actor, 'project.renumberScreenIds');
  return renames;
}

function checkRenames(state: State, renames: CodeRename[]): void {
  const conflicts = renameConflicts(state, renames);
  if (conflicts.length) throw new RegistryError(`${COPY.coreRegistry034} ${conflicts.join(', ')}`);
}

// 과거 GUI 기록은 당시 Screen ID를 그대로 둔다.
function applyRenames(store: Store, renames: CodeRename[], actor: Actor, reason: string): void {
  for (const r of renames) updateScreen(store, r.screenId, s => ({ ...s, code: r.to }), actor, 'screen.code', reason);
}

// ── 작업자 ───────────────────────────────────────────────

export function addWorker(store: Store, name: string, alias: string, actor: Actor): Worker {
  const value = clean(name, COPY.coreRegistry005);
  const sub = alias.trim();
  for (const w of store.state.workers.values())
    if (w.active && w.name === value)
      throw new RegistryError(COPY.coreRegistry006);
  const worker: Worker = { id: store.newId(), name: value, alias: sub, active: true };
  store.put(keys.worker(worker.id), worker);
  store.audit(actor, 'worker.add', worker.id, null, worker);
  return worker;
}

export function renameWorker(store: Store, id: string, name: string, alias: string, actor: Actor): Worker {
  const before = store.state.workers.get(id);
  if (!before) throw new RegistryError(COPY.coreRegistry008);
  const after = { ...before, name: clean(name, COPY.coreRegistry005), alias: alias.trim() };
  for (const w of store.state.workers.values())
    if (w.id !== id && w.active && w.name === after.name)
      throw new RegistryError(COPY.coreRegistry009);
  store.put(keys.worker(id), after);
  store.audit(actor, 'worker.rename', id, before, after);
  return after;
}

export function setWorkerActive(store: Store, id: string, active: boolean, actor: Actor): void {
  const before = store.state.workers.get(id);
  if (!before) throw new RegistryError(COPY.coreRegistry008);
  store.put(keys.worker(id), { ...before, active });
  store.audit(actor, 'worker.active', id, before.active, active);
}

// ── 태그 ─────────────────────────────────────────────────


// 태그는 이름과 팔레트 색만 갖는다. 완료·삭제 같은 의미로 상태를 자동 전환하지 않는다.
export function addTag(store: Store, team: Team, name: string, colorKey: string, actor: Actor): TagDef {
  const value = clean(name, COPY.coreRegistry010);
  if (!isColorKey(colorKey)) throw new RegistryError(COPY.coreRegistry011);
  for (const t of store.state.tags.values())
    if (t.active && t.team === team && t.name === value) throw new RegistryError(`${COPY.coreRegistry012} ${team} ${COPY.coreRegistry013} ${value}`);
  const tag: TagDef = { id: store.newId(), team, name: value, colorKey, color: paletteHex(colorKey), active: true };
  store.put(keys.tag(tag.id), tag);
  store.audit(actor, 'tag.add', tag.id, null, tag);
  return tag;
}

export function updateTag(store: Store, id: string, patch: { name?: string; colorKey?: string; active?: boolean }, actor: Actor): TagDef {
  const before = store.state.tags.get(id);
  if (!before) throw new RegistryError(COPY.coreRegistry014);
  if (before.system) throw new RegistryError(COPY.coreRegistry027);
  const after = { ...before };
  if (patch.name !== undefined) after.name = clean(patch.name, COPY.coreRegistry010);
  if (patch.colorKey !== undefined) {
    if (!isColorKey(patch.colorKey)) throw new RegistryError(COPY.coreRegistry011);
    after.colorKey = patch.colorKey;
    after.color = paletteHex(patch.colorKey);
  }
  if (patch.active !== undefined) after.active = patch.active;
  store.put(keys.tag(id), after);
  store.audit(actor, 'tag.update', id, before, after);
  return after;
}

// GUI 기본 태그: 추가(Teal)·삭제(Red). 신규 등록·삭제의 기본 태그로 넣고 이름·색 변경·사용 중지를 막는다(2026-10-20 사용자 결정).
// UI 「최신」(검정)은 플립북 확인 완료의 기본 상태다(2026-10-20 사용자 결정).
const SYSTEM_TAGS: { kind: SystemTag; team: Team; name: string; colorKey: 'Teal' | 'Red' | 'Black' }[] = [
  { kind: 'add', team: 'GUI', name: COPY.coreRegistry028, colorKey: 'Teal' },
  { kind: 'delete', team: 'GUI', name: COPY.coreRegistry029, colorKey: 'Red' },
  { kind: 'latest', team: 'UI', name: COPY.coreRegistry030, colorKey: 'Black' },
];

export function systemTagId(state: State, kind: SystemTag): string | null {
  for (const t of state.tags.values()) if (t.system === kind && t.active) return t.id;
  return null;
}

// 기본 태그가 없으면 만든다. 같은 팀에 같은 이름의 태그가 이미 있으면 그 태그를 기본 태그로 지정하고 색은 그대로 둔다.
// 바꾼 것이 있으면 true
export function ensureSystemTags(store: Store, actor: Actor): boolean {
  let changed = false;
  for (const def of SYSTEM_TAGS) {
    if (systemTagId(store.state, def.kind)) continue;
    const same = [...store.state.tags.values()].find(t => t.team === def.team && t.name === def.name && !t.system);
    const tag: TagDef = same
      ? { ...same, active: true, system: def.kind }
      : { id: store.newId(), team: def.team, name: def.name, colorKey: def.colorKey, color: paletteHex(def.colorKey), active: true, system: def.kind };
    store.put(keys.tag(tag.id), tag);
    store.audit(actor, 'tag.system', tag.id, same ?? null, tag);
    changed = true;
  }
  return changed;
}

// ── 화면 관계 ────────────────────────────────────────────

// 초기 버전은 기본 화면 ↔ 케이스 한 단계만 허용한다.
export function caseRelationError(state: State, screenId: string | null, baseId: string): string | null {
  if (screenId && screenId === baseId) return COPY.coreRegistry015;
  const base = state.screens.get(baseId);
  if (!base) return COPY.coreRegistry016;
  if (base.status !== 'active') return COPY.coreRegistry017;
  if (base.baseScreenId) return COPY.coreRegistry018;
  if (screenId && [...state.screens.values()].some(s => s.baseScreenId === screenId && s.status === 'active'))
    return COPY.coreRegistry019;
  return null;
}

function updateScreen(store: Store, id: string, change: (s: Screen) => Screen, actor: Actor, action: string, reason: string): Screen {
  const before = store.state.screens.get(id);
  if (!before) throw new RegistryError(COPY.coreRegistry020);
  const after = { ...change(before), rev: before.rev + 1 };
  store.put(keys.screen(id), after);
  store.audit(actor, action, id, before, after, reason);
  return after;
}

export function setCaseRelation(store: Store, screenId: string, baseId: string | null, actor: Actor, reason: string): Screen {
  if (baseId) {
    const error = caseRelationError(store.state, screenId, baseId);
    if (error) throw new RegistryError(error);
  }
  return updateScreen(store, screenId, s => ({ ...s, baseScreenId: baseId }), actor, 'screen.case', reason);
}

export function setScreenCategory(store: Store, screenId: string, categoryId: string | null, actor: Actor, reason = ''): Screen {
  if (categoryId && !store.state.categories.get(categoryId)?.active) throw new RegistryError(COPY.coreRegistry004);
  return updateScreen(store, screenId, s => ({ ...s, categoryId }), actor, 'screen.category', reason);
}

// 관리자 연결 정정. UI Description은 옮기지 않고 원본 연결만 바꾼다.
export function relinkSource(store: Store, screenId: string, nodeId: string, pageId: string, actor: Actor, reason: string): Screen {
  if (!reason.trim()) throw new RegistryError(COPY.coreRegistry021);
  for (const other of store.state.screens.values())
    if (other.id !== screenId && other.source?.nodeId === nodeId)
      throw new RegistryError(`${COPY.coreRegistry022} ${other.name}`);
  return updateScreen(store, screenId, s => ({ ...s, source: { nodeId, pageId } }), actor, 'screen.relink', reason);
}

// ── 제외 설정 ────────────────────────────────────────────

// 제외는 화면 목록이 아니며 화면 ID를 만들지 않는다.
export function addExclusion(store: Store, nodeId: string, name: string, reason: string, actor: Actor): Exclusion {
  for (const e of store.state.exclusions.values()) if (e.active && e.nodeId === nodeId) return e;
  const exclusion: Exclusion = { id: store.newId(), nodeId, name, reason: reason.trim(), createdAt: store.now(), active: true };
  store.put(keys.exclusion(exclusion.id), exclusion);
  store.audit(actor, 'exclusion.add', exclusion.id, null, exclusion);
  return exclusion;
}

export function removeExclusion(store: Store, id: string, actor: Actor): void {
  const before = store.state.exclusions.get(id);
  if (!before) throw new RegistryError(COPY.coreRegistry023);
  store.put(keys.exclusion(id), { ...before, active: false });
  store.audit(actor, 'exclusion.remove', id, before, null);
}

export function excludedNodeIds(state: State): Set<string> {
  const out = new Set<string>();
  for (const e of state.exclusions.values()) if (e.active) out.add(e.nodeId);
  return out;
}

// ── 이력 정정 ────────────────────────────────────────────

// 원기록을 덮어쓰지 않고 정정 기록을 덧붙인다.
export function correctRecord(store: Store, team: Team, screenId: string, version: number, description: string, reason: string, actor: Actor): void {
  const text = clean(description, COPY.coreRegistry024);
  if (!reason.trim()) throw new RegistryError(COPY.coreRegistry025);
  const key = team === 'GUI' ? keys.gui(screenId, version) : keys.ui(screenId, version);
  const before = store.readFresh<GuiRecord | UiRecord>(key);
  if (!before) throw new RegistryError(COPY.coreRegistry026);
  const after = { ...before, corrections: [...before.corrections, { at: store.now(), actor, description: text, reason: reason.trim() }] };
  store.put(key, after);
  store.audit(actor, 'record.correct', key, before.corrections, after.corrections, reason);
}
