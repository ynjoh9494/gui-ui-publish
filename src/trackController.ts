import { COPY } from './core/copy.ts';
import { guiKey } from './core/flipbook.ts';
import { guiScreens } from './core/guiScreens.ts';
import { keys, type Store } from './core/store.ts';
import { flagRetiredScreens, followMembers, forgetScreens, placePath, reconcileTracks, successorOf, trackPages, type FoundCopy, type TrackListItem } from './core/tracks.ts';
import type { FlipbookScale, TrackRecord } from './core/types.ts';
import type { CopyUpdate, Host, PasteSpot } from './host.ts';

// 추적 GUI(캔버스에 붙여 GUI 배포를 따라가는 화면 복사본, 2026-10-29 사용자 결정) 작업 조정. 규칙은 core/tracks.ts, 캔버스는 Host가 맡는다.
// 위치만 기록하고 이력 행은 남기지 않는다. 캔버스에서 지운 복사본은 묻지 않고 기록에서 뺀다.
export class TrackController {
  private readonly store: Store;
  private readonly host: Host;

  constructor(store: Store, host: Host) {
    this.store = store;
    this.host = host;
  }

  // 캔버스의 복사본을 읽어 추적 기록과 새 템플릿 플립북의 화면 목록을 맞춘다(uids가 있으면 그 화면만, only가 있으면 그 페이지만).
  // addedAt: 플립북에 새로 들어온 화면을 확인할 것으로 보기 시작하는 시각(그 복사본의 이전 기록을 받는다)
  private async read(uids: Set<string> | null, addedAt: (copy: FoundCopy, before: TrackRecord | undefined) => number, only?: string[]): Promise<{ found: FoundCopy[]; original: Map<string, string>; records: Map<string, TrackRecord>; changed: string[] } | null> {
    if (!this.host.scanCopies) return null;
    const s = this.store;
    s.reload();
    const pages = only ?? trackPages(s.state, uids);
    if (!pages.length) return { found: [], original: new Map(), records: new Map(), changed: [] };
    // 사용 안 함이 된 화면의 복사본은 추적하지 않는다(레이어는 캔버스에 남지만 표식만 남은 것). 교체로 이어진 화면은 이어받은 화면으로 본다.
    const live = successorOf(s.state);
    const scanned = (await this.host.scanCopies(pages, uids ? [...uids] : undefined)).filter(c => s.state.screens.get(live(c.uid))?.status === 'active');
    const before = new Map([...s.state.tracks.values()].map(t => [t.nodeId, t]));
    const result = reconcileTracks(s, scanned, new Set(pages), uids, this.host.actor, s.newId);
    if (result.retag.length) await this.host.markTracked?.(result.retag);
    // 교체로 사용 안 함이 된 화면의 복사본은 이어받은 화면의 것으로 본다.
    const successor = successorOf(s.state);
    const found = scanned.map(copy => ({ ...copy, uid: successor(copy.uid) }));
    const changed = followMembers(s, found, guiScreens(s.state), copy => addedAt(copy, before.get(copy.nodeId)), uids && new Set([...uids].map(successor)), new Set(pages));
    // original: 복사본 표식에 적힌 화면(이어받기 전)
    return { found, original: new Map(scanned.map(c => [c.nodeId, c.uid])), records: result.records, changed };
  }

  // GUI 배포를 확정한 뒤(플립북 반영 전): 배포한 화면의 추적 GUI를 모두 새 버전으로 바꾸고, 그때 새 템플릿 플립북 안에 있는 화면을
  // 그 플립북의 화면으로 맞춘다(2026-10-29 사용자 결정: 배포 순간의 캔버스 기준). 이어지는 플립북 반영이 그 플립북에 이력을 쌓는다.
  // 플립북에 새로 들어온 화면은 붙인 뒤의 배포를 받는다(이번 배포 포함). 이번에 처음 찾은 복제본은 이번 배포부터 받는다.
  async publish(uids: Set<string>): Promise<string | null> {
    if (!uids.size || !this.host.updateCopies) return null;
    const s = this.store;
    s.reload();
    // 교체로 이 화면들에 이어진 옛 화면의 복사본도 함께 찾는다.
    const successor = successorOf(s.state);
    const wanted = new Set([...uids, ...[...s.state.screens.keys()].filter(id => uids.has(successor(id)))]);
    const read = await this.read(wanted, (_, before) => before?.createdAt ?? 0);
    if (!read) return null;
    const items: CopyUpdate[] = [];
    for (const uid of uids) {
      const screen = s.state.screens.get(uid);
      if (!screen || screen.status !== 'active' || !screen.source) continue;
      const key = guiKey(uid, screen.guiVersion);
      // 옛 버전이거나, 교체로 이어받은 옛 화면의 복사본(표식의 화면이 다름)이면 바꾼다.
      const copies = read.found.filter(c => c.uid === uid && (c.version !== screen.guiVersion || read.original.get(c.nodeId) !== uid))
        .map(c => ({ nodeId: c.nodeId, trackId: read.records.get(c.nodeId)?.id ?? '' })).filter(c => c.trackId);
      if (copies.length) items.push({ uid, code: screen.code, key, sourceNodeId: screen.source.nodeId, copies });
    }
    if (!items.length) return null;
    const { updated, notes } = await this.host.updateCopies(items);
    s.reload();
    const uidOf = new Map(items.flatMap(item => item.copies.map(c => [c.trackId, item.uid] as const)));
    for (const { trackId, nodeId } of updated) {
      const track = s.state.tracks.get(trackId);
      if (track) s.put(keys.track(trackId), { ...track, nodeId, uid: uidOf.get(trackId) ?? track.uid });
    }
    return [updated.length ? `${COPY.track001} ${updated.length}${COPY.track002}` : '', ...notes].filter(Boolean).join(' ') || null;
  }

  // 목록 새로고침(UI Flipbook): 캔버스에서 새 템플릿 플립북의 화면 목록을 읽어 맞춘다. 화면을 넣고 빼는 것은 이력을 남기지 않으므로
  // 새로 들어온 화면은 지금 뒤의 배포부터 받는다. 화면 목록이 바뀐 플립북 ID를 돌려준다(Screen ID 칸·자동 제목을 다시 반영한다).
  async refresh(): Promise<string[]> {
    const read = await this.read(null, () => this.store.now());
    return read?.changed ?? [];
  }

  // 목록에서 새 템플릿 플립북을 골랐다(PRD 1.1): 그 페이지만 읽어 맞춘다. 화면 목록이 바뀐 플립북 ID
  async refreshPage(pageId: string): Promise<string[]> {
    const read = await this.read(null, () => this.store.now(), [pageId]);
    return read?.changed ?? [];
  }

  // GUI 붙이기(2026-10-29 사용자 결정): 배포된 화면의 GUI를 캔버스에 붙이고 추적 기록에 넣는다. at이 없으면 보고 있는 화면 가운데에 붙인다.
  // 새 템플릿 플립북 안에 붙였으면 그 페이지의 플립북 화면 목록을 다시 읽는다(넣기는 이력을 남기지 않으므로 지금 뒤의 배포부터 받는다).
  // 화면 목록이 바뀐 플립북 ID와 알릴 내용(찾지 못한 글꼴 등)을 돌려준다.
  async paste(uid: string, scale: FlipbookScale, at: PasteSpot | null): Promise<{ changed: string[]; notes: string[] }> {
    if (!this.host.pasteGui) return { changed: [], notes: [] };
    const s = this.store;
    s.reload();
    const screen = s.state.screens.get(uid);
    if (!screen || screen.status !== 'active' || !screen.guiVersion || !screen.source) throw new Error(COPY.track003);
    const trackId = s.newId();
    const placed = await this.host.pasteGui({ key: guiKey(uid, screen.guiVersion), code: screen.code, sourceNodeId: screen.source.nodeId, trackId, scale, maxWidth: s.state.project.guiWidth }, at);
    s.reload();
    s.put(keys.track(trackId), { id: trackId, uid, nodeId: placed.nodeId, pageId: placed.pageId, createdAt: s.now(), actor: this.host.actor } satisfies TrackRecord);
    const into = placed.flipbookId ? s.state.flipbooks.get(placed.flipbookId) : undefined;
    const changed = into?.tracked && into.status === 'active' ? (await this.read(null, () => s.now(), [placed.pageId]))?.changed ?? [] : [];
    return { changed, notes: placed.notes };
  }

  // 추적 목록 팝업(PRD §4.5): 이 화면(교체로 이어진 옛 화면 포함)의 추적 GUI가 놓인 자리. 캔버스에서 찾지 못한 기록은 묻지 않고 빼고,
  // 다른 페이지로 옮긴 추적 GUI는 기록의 페이지를 고친다(배포 때 그 페이지를 읽게).
  async places(uid: string): Promise<{ items: TrackListItem[]; removed: number }> {
    const s = this.store;
    s.reload();
    if (!this.host.nodePlaces) return { items: [], removed: 0 };
    const live = successorOf(s.state);
    const tracks = [...s.state.tracks.values()].filter(t => live(t.uid) === uid).sort((a, b) => a.createdAt - b.createdAt);
    const places = await this.host.nodePlaces(tracks.map(t => ({ nodeId: t.nodeId, copy: true })));
    s.reload();
    const gone = tracks.filter((_, i) => !places[i]);
    if (gone.length) s.remove(...gone.map(t => keys.track(t.id)));
    const items: TrackListItem[] = [];
    tracks.forEach((track, i) => {
      const place = places[i];
      if (!place) return;
      if (place.pageId !== track.pageId) s.put(keys.track(track.id), { ...track, pageId: place.pageId });
      items.push({ kind: 'screen', id: track.id, path: placePath(s.state, place) });
    });
    return { items, removed: gone.length };
  }

  // 추적 목록에서 누른 추적 GUI의 노드 ID. 캔버스에서 지웠으면 기록에서 빼고 null
  async find(trackId: string): Promise<string | null> {
    const s = this.store;
    s.reload();
    const track = s.state.tracks.get(trackId);
    if (!track || !this.host.nodePlaces) return null;
    const [place] = await this.host.nodePlaces([{ nodeId: track.nodeId, copy: true }]);
    if (place) return track.nodeId;
    s.remove(keys.track(trackId));
    return null;
  }

  // 플러그인이 열려 있는 동안 캔버스에서 새로 생긴(복제·붙여 넣은) 추적 GUI를 기록에 넣는다(PRD §7 B). 이미 기록된 노드는 그대로 두고,
  // 복제본에는 새 추적 기록 ID를 적는다. 플립북의 화면 목록은 플립북을 고르거나 목록을 새로 불러올 때 맞춘다(PRD 1.1). 새로 넣었으면 true
  async adopt(nodeIds: string[]): Promise<boolean> {
    if (!this.host.createdCopies || !nodeIds.length) return false;
    const s = this.store;
    s.reload();
    const live = successorOf(s.state);
    const found = (await this.host.createdCopies(nodeIds)).filter(c => s.state.screens.get(live(c.uid))?.status === 'active');
    s.reload();
    const known = new Set([...s.state.tracks.values()].map(t => t.nodeId));
    const fresh = found.filter(c => !known.has(c.nodeId));
    if (!fresh.length) return false;
    const { retag } = reconcileTracks(s, fresh, new Set(), null, this.host.actor, s.newId);
    if (retag.length) await this.host.markTracked?.(retag);
    return true;
  }

  // 새 템플릿 플립북을 만들며 놓은 GUI 복사본을 추적 기록에 넣는다.
  async register(copies: { nodeId: string; key: string }[], pageId: string): Promise<void> {
    if (!copies.length) return;
    const s = this.store;
    const retag: { nodeId: string; trackId: string }[] = [];
    for (const copy of copies) {
      const uid = copy.key.slice(0, copy.key.lastIndexOf('@'));
      if (!uid) continue;
      const track: TrackRecord = { id: s.newId(), uid, nodeId: copy.nodeId, pageId, createdAt: s.now(), actor: this.host.actor };
      s.put(keys.track(track.id), track);
      retag.push({ nodeId: copy.nodeId, trackId: track.id });
    }
    await this.host.markTracked?.(retag);
  }

  // 사용 안 함이 된 화면(삭제·화면이 아님·배포 취소)의 추적을 멈춘다. 캔버스의 레이어는 그대로 둔다.
  async retire(uids: Set<string>): Promise<string[]> {
    if (!uids.size) return [];
    const s = this.store;
    s.reload();
    const pages = trackPages(s.state, uids);
    const found = this.host.scanCopies ? await this.host.scanCopies(pages, [...uids]) : undefined;
    s.reload();
    const changed = flagRetiredScreens(s, uids, found);
    forgetScreens(s, uids);
    return changed;
  }

  forget(uids: Set<string>): TrackRecord[] {
    if (!uids.size) return [];
    this.store.reload();
    return forgetScreens(this.store, uids);
  }
}
