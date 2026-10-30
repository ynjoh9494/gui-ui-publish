import { defaultTitle } from './flipbook.ts';
import { formerUids, type GuiScreenInfo } from './guiScreens.ts';
import { keys, type State, type Store } from './store.ts';
import type { Actor, Flipbook, FlipbookKind, FlipbookScreen, TrackRecord } from './types.ts';

// 추적 GUI(2026-10-29 사용자 결정, Altimedia PRD 「화면 추적과 GUI 붙이기」): 캔버스에 붙인 GUI 복사본은 GUI 배포를 따라가고,
// 새 템플릿 플립북 안에 있으면 그 플립북의 화면이 된다. 화면을 넣고 빼는 것(UI에서 한 일)은 이력을 남기지 않는다.

// 캔버스에서 찾은 GUI 복사본 하나. version은 지금 복사본의 버전, trackId는 노드에 적힌 추적 기록 ID(없으면 ''),
// flipbookId는 그 복사본을 품은 새 템플릿 플립북(밖이면 null)이다.
export interface FoundCopy { nodeId: string; pageId: string; uid: string; version: number; trackId: string; flipbookId: string | null }

// GUI 붙이기에서 창 밖(캔버스)에 놓은 자리: 놓인 노드와 캔버스 절대 좌표(figma.on('drop'))
export interface PasteSpot { nodeId: string; x: number; y: number }

// 노드가 놓인 자리: 페이지, 바깥부터 안쪽 순서의 Section 이름, 그 노드를 품은 플립북 프레임(표식의 플립북 ID와 프레임 이름)
export interface NodePlace { pageId: string; pageName: string; sections: string[]; flipbook: { id: string; name: string } | null }

// 추적 목록 팝업 한 줄(2026-10-29 사용자 결정, PRD §4.5): 화면(추적 GUI)과 플로우로 나누고 놓인 자리를 경로로 보여 준다.
// id: 추적 기록 ID 또는 플로우 ID, path: 페이지 › Section › 플립북(화면) 또는 페이지 › Section › 플로우 제목(플로우)
export interface TrackListItem { kind: 'screen' | 'flow'; id: string; path: string[] }

// 경로: 페이지 › Section(바깥부터) › 플립북. 플립북 이름은 기록의 제목(없으면 프레임 이름)이다.
export function placePath(state: State, place: NodePlace): string[] {
  const flipbook = place.flipbook ? state.flipbooks.get(place.flipbook.id)?.title ?? place.flipbook.name : null;
  return [place.pageName, ...place.sections, ...(flipbook ? [flipbook] : [])];
}

// 화면 ID → 지금 그 자리를 이어받은 화면 ID. 교체로 사용 안 함이 된 화면의 복사본은 이어받은 화면을 따라간다.
export function successorOf(state: State): (uid: string) => string {
  const map = new Map<string, string>();
  for (const [to, froms] of formerUids(state)) for (const from of froms) map.set(from, to);
  return uid => map.get(uid) ?? uid;
}

// 읽을 페이지: 이 화면들(없으면 모든 화면)의 추적 기록이 있는 페이지와 새 템플릿 플립북이 있는 페이지.
// 플립북 페이지도 읽어 플립북 안에 복제해 둔 복사본을 찾는다(PRD §7 A).
export function trackPages(state: State, uids: Set<string> | null): string[] {
  const pages = new Set<string>();
  for (const track of state.tracks.values()) if (!uids || uids.has(track.uid)) pages.add(track.pageId);
  for (const fb of state.flipbooks.values()) if (fb.status === 'active' && fb.tracked && fb.pageId) pages.add(fb.pageId);
  return [...pages];
}

export interface Reconciled {
  // 찾은 복사본(노드 ID) → 그 추적 기록
  records: Map<string, TrackRecord>;
  // 노드에 새 추적 기록 ID를 적어야 하는 복사본(기록이 없던 복사본, 캔버스에서 복제한 복사본)
  retag: { nodeId: string; trackId: string }[];
  // 찾지 못해 뺀 기록
  removed: TrackRecord[];
}

// 찾은 복사본을 추적 기록과 맞춘다. 기록이 없거나 노드가 기록과 다른(캔버스에서 복제·복사한) 복사본은 새 기록을 만든다.
// 읽은 페이지에 있어야 할 기록(uids가 있으면 그 화면만)인데 찾지 못하면 묻지 않고 뺀다.
export function reconcileTracks(store: Store, found: FoundCopy[], scanned: Set<string>, uids: Set<string> | null, actor: Actor, newId: () => string): Reconciled {
  const byNode = new Map([...store.state.tracks.values()].map(t => [t.nodeId, t]));
  const foundNodes = new Set(found.map(copy => copy.nodeId));
  const out: Reconciled = { records: new Map(), retag: [], removed: [] };
  const seen = new Set<string>();
  for (const copy of found) {
    let track = byNode.get(copy.nodeId);
    // A replacement may have removed the old node before its new node ID was
    // saved. Reattach the original record only when that old node is absent;
    // a user-created duplicate beside the original still gets a new ID.
    const marked = copy.trackId ? store.state.tracks.get(copy.trackId) : undefined;
    if (!track && marked && scanned.has(marked.pageId) && !foundNodes.has(marked.nodeId) && !seen.has(marked.id)) {
      track = { ...marked, nodeId: copy.nodeId, uid: copy.uid, pageId: copy.pageId };
      store.put(keys.track(track.id), track);
    }
    if (!track) {
      track = { id: newId(), uid: copy.uid, nodeId: copy.nodeId, pageId: copy.pageId, createdAt: store.now(), actor };
      store.put(keys.track(track.id), track);
      out.retag.push({ nodeId: copy.nodeId, trackId: track.id });
    } else if (track.pageId !== copy.pageId || track.uid !== copy.uid) {
      track = { ...track, pageId: copy.pageId, uid: copy.uid };
      store.put(keys.track(track.id), track);
    } else if (copy.trackId !== track.id) out.retag.push({ nodeId: copy.nodeId, trackId: track.id });
    seen.add(track.id);
    out.records.set(copy.nodeId, track);
  }
  for (const track of [...store.state.tracks.values()]) {
    if (seen.has(track.id) || !scanned.has(track.pageId) || (uids && !uids.has(track.uid))) continue;
    out.removed.push(track);
  }
  if (out.removed.length) store.remove(...out.removed.map(t => keys.track(t.id)));
  return out;
}

// 사용 안 함이 된 화면(삭제·화면이 아님·배포 취소)의 추적을 멈춘다. 캔버스의 레이어는 그대로 둔다(2026-10-29 사용자 결정).
export function forgetScreens(store: Store, uids: Set<string>): TrackRecord[] {
  const gone = [...store.state.tracks.values()].filter(t => uids.has(t.uid));
  if (gone.length) store.remove(...gone.map(t => keys.track(t.id)));
  return gone;
}

// 사용 안 함이 된 화면이 들어 있던 새 템플릿 플립북(2026-10-29 사용자 결정, PRD §4.2): 그 화면을 화면 목록에서 빼고(추적이 멈춘 화면이라 보여 주지 않음)
// 「삭제된 화면」 알림을 켠다. 쌓인 이력은 남긴다. 알림을 켠 플립북 ID(Screen ID 칸·자동 제목을 다시 반영한다)
export function flagRetiredScreens(store: Store, uids: Set<string>, found?: FoundCopy[]): string[] {
  const out: string[] = [];
  const owners = found ? new Set(found.filter(c => uids.has(c.uid)).map(c => c.flipbookId)) : null;
  for (const fb of [...store.state.flipbooks.values()]) {
    if (fb.status !== 'active' || !fb.tracked) continue;
    const alert = owners ? owners.has(fb.id) : fb.screens.some(s => uids.has(s.uid));
    if (!alert && !fb.screens.some(s => uids.has(s.uid))) continue;
    const screens = fb.screens.filter(s => !uids.has(s.uid));
    const kind = kindOf(fb, screens.length);
    const title = fb.autoTitle ? defaultTitle(kind, screens) : fb.title;
    store.put(keys.flipbook(fb.id), {
      ...fb, rev: fb.rev + 1, kind, screens, title, deletedAlert: fb.deletedAlert || alert,
      titleNames: fb.titleNames.includes(title) ? fb.titleNames : [...fb.titleNames, title],
    } satisfies Flipbook);
    out.push(fb.id);
  }
  return out;
}

// 상세의 「삭제된 화면」 경고에서 확인을 눌렀다: 경고와 목록의 알림 뱃지를 지운다. 바꿨으면 true
export function dismissDeletedAlert(store: Store, flipbookId: string): boolean {
  const fb = store.state.flipbooks.get(flipbookId);
  if (!fb?.deletedAlert) return false;
  store.put(keys.flipbook(fb.id), { ...fb, rev: fb.rev + 1, deletedAlert: false } satisfies Flipbook);
  return true;
}

function kindOf(fb: Flipbook, count: number): FlipbookKind {
  return count > 1 ? 'multi' : count === 1 ? 'single' : fb.kind;
}

// GUI 붙이기 탭의 화면별 개수: 추적 GUI와 그 화면 썸네일이 든 플로우를 합친다(2026-10-29 사용자 결정). 교체로 이어진 옛 화면의 것은 이어받은 화면에 센다.
export function trackCounts(state: State): Map<string, number> {
  const live = successorOf(state);
  const counts = new Map<string, number>();
  const add = (uid: string) => { const id = live(uid); counts.set(id, (counts.get(id) ?? 0) + 1); };
  for (const track of state.tracks.values()) add(track.uid);
  for (const flow of state.flows.values()) for (const uid of new Set(flow.uids.map(live))) add(uid);
  return counts;
}

// 새 템플릿 플립북의 화면 목록을 그 안에서 찾은 복사본으로 맞춘다(only가 있으면 그 화면들만). 읽은 페이지(pages)의 플립북만 맞춘다.
// 새로 들어온 화면의 버전은 들어 있는 복사본의 버전(여럿이면 가장 낮은 버전)이고, addedAt 뒤의 배포만 확인할 것으로 본다.
// 빠진 화면은 목록에서 빼고 쌓인 이력은 남긴다. 이미 있던 화면의 반영 버전은 그대로 둔다(배포 이력은 importGuiUpdates가 쌓는다).
// 순서는 Screen ID 이름순이고(2026-10-29 사용자 결정), 자동 제목이면 그 첫 화면 이름을 따른다. 바뀐 플립북 ID를 돌려준다.
export function followMembers(store: Store, found: FoundCopy[], screens: Map<string, GuiScreenInfo>, addedAt: (copy: FoundCopy) => number, only: Set<string> | null, pages: Set<string>): string[] {
  const changed: string[] = [];
  for (const fb of [...store.state.flipbooks.values()]) {
    if (fb.status !== 'active' || !fb.tracked || !pages.has(fb.pageId ?? '')) continue;
    const inside = new Map<string, FoundCopy>();
    for (const copy of found) {
      if (copy.flipbookId !== fb.id || (only && !only.has(copy.uid))) continue;
      const held = inside.get(copy.uid);
      if (!held || copy.version < held.version) inside.set(copy.uid, copy);
    }
    const next: FlipbookScreen[] = fb.screens.filter(s => (only && !only.has(s.uid)) || inside.has(s.uid));
    for (const [uid, copy] of inside) {
      if (next.some(s => s.uid === uid)) continue;
      const info = screens.get(uid);
      if (!info || info.status !== 'active') continue;
      next.push({ uid, code: info.code, name: info.name, version: copy.version, addedAt: addedAt(copy) });
    }
    next.sort((a, b) => a.code.localeCompare(b.code));
    if (next.length === fb.screens.length && next.every((s, i) => s.uid === fb.screens[i].uid)) continue;
    const kind = kindOf(fb, next.length);
    const title = fb.autoTitle ? defaultTitle(kind, next) : fb.title;
    store.put(keys.flipbook(fb.id), {
      ...fb, rev: fb.rev + 1, kind, screens: next, title,
      titleNames: fb.titleNames.includes(title) ? fb.titleNames : [...fb.titleNames, title],
    } satisfies Flipbook);
    changed.push(fb.id);
  }
  return changed;
}
