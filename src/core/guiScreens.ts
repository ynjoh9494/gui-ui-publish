// 플립북이 쓰는 GUI 화면 정보와 기록. 같은 파일의 GUI 원기록(scr·gv)에서 만든다.
import type { State } from './store.ts';
import type { GuiRecord, GuiThumb, ImportedGuiRecord, Screen, TagSnapshot, WorkType } from './types.ts';

export interface GuiScreenInfo {
  uid: string;
  code: string;
  name: string;
  category: { id: string; name: string; order: number } | null;
  status: 'active' | 'deleted';
  // 케이스 화면(기본 화면이 있는 화면)인가. 일괄 만들기의 화면 유형 필터에 쓴다.
  isCase: boolean;
  // 마지막 GUI 배포 버전과 그때 만든 썸네일. 플립북에는 원본(sourceNodeId)을 바로 복사한다.
  version: number;
  thumb: GuiThumb | null;
  sourceNodeId: string | null;
}

export interface GuiRecordInfo {
  batchId: string;
  quiet?: boolean;
  uid: string;
  version: number;
  code: string;
  name: string;
  workType: WorkType;
  tag: TagSnapshot;
  description: string;
  original: string;
  corrected: boolean;
  worker: string;
  committedAt: number;
}

export function guiScreenInfo(state: State, screen: Screen): GuiScreenInfo {
  const category = screen.categoryId ? state.categories.get(screen.categoryId) ?? null : null;
  const history = state.gui.get(screen.id) ?? [];
  const last = history[history.length - 1];
  return {
    uid: screen.id, code: screen.code, name: screen.name,
    category: category && category.active ? { id: category.id, name: category.name, order: category.order } : null,
    status: screen.status, isCase: !!screen.baseScreenId, version: screen.guiVersion, thumb: last?.thumb ?? null, sourceNodeId: screen.source?.nodeId ?? null,
  };
}

// 다른 화면을 교체해 사용 안 함이 된 화면(mergedInto)의 ID를 지금 그 자리를 이어받은 화면별로 모은다.
// 교체가 이어졌으면 마지막 화면까지 따라간다. 캔버스에 남은 옛 화면 표식(GUI 복사본·플로우 칸)을 그 화면으로 읽을 때 쓴다.
export function formerUids(state: State): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const screen of state.screens.values()) {
    if (!screen.mergedInto) continue;
    let current = screen;
    const seen = new Set([screen.id]);
    while (current.mergedInto && !seen.has(current.mergedInto)) {
      const next = state.screens.get(current.mergedInto);
      if (!next) break;
      seen.add(next.id);
      current = next;
    }
    if (current.id === screen.id) continue;
    out.set(current.id, [...out.get(current.id) ?? [], screen.id]);
  }
  return out;
}

export function guiScreens(state: State): Map<string, GuiScreenInfo> {
  return new Map([...state.screens.values()].map(s => [s.id, guiScreenInfo(state, s)]));
}

export function guiRecordInfo(r: GuiRecord): GuiRecordInfo {
  const last = r.corrections[r.corrections.length - 1];
  return {
    batchId: r.batchId, quiet: r.quiet, uid: r.screenId, version: r.version, code: r.code, name: r.name, workType: r.workType, tag: r.tag,
    description: last ? last.description : r.description, original: r.description, corrected: !!last,
    worker: r.worker.name, committedAt: r.committedAt,
  };
}

export function guiRecordInfos(state: State, uids: Set<string>): GuiRecordInfo[] {
  return [...uids].flatMap(uid => (state.gui.get(uid) ?? []).map(guiRecordInfo));
}

export function importedRecord(flipbookId: string, r: GuiRecordInfo): ImportedGuiRecord {
  return {
    flipbookId, batchId: r.batchId, uid: r.uid, version: r.version, code: r.code, name: r.name, workType: r.workType, tag: r.tag,
    description: r.description, original: r.original, corrected: r.corrected, worker: r.worker, committedAt: r.committedAt,
  };
}

export function recordsToImport(held: Map<number, ImportedGuiRecord>, heldVersion: number, records: GuiRecordInfo[]): { add: GuiRecordInfo[]; update: GuiRecordInfo[] } {
  const add: GuiRecordInfo[] = [], update: GuiRecordInfo[] = [];
  for (const r of records) {
    const mine = held.get(r.version);
    if (mine) {
      if (mine.description !== r.description || mine.corrected !== r.corrected) update.push(r);
    } else if (r.version > heldVersion) add.push(r);
  }
  return { add: add.sort((a, b) => a.version - b.version), update };
}
