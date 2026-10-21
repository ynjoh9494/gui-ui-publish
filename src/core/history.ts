import type { State } from './store.ts';
import type { Correction, TagSnapshot, Team } from './types.ts';

export interface HistoryRow {
  team: Team;
  at: string;
  committedAt: number;
  // 버전. DATA 페이지에만 표시하고 플립북·플러그인 이력에는 표시하지 않는다(2026-10-20 사용자 결정).
  version: string;
  // 바뀐 화면의 Screen ID. 여러 화면·정책 플립북의 UI 기록처럼 특정 화면이 없으면 null
  code: string | null;
  tag: TagSnapshot;
  description: string;
  worker: string;
  // 정정된 기록이면 원래 설명을 함께 보존한다.
  corrected: boolean;
  original: string;
  batchId: string;
}

function pad(n: number, width = 2): string { return String(n).padStart(width, '0'); }

// 플러그인 샌드박스의 Intl 지원에 기대지 않고 프로젝트 오프셋으로 표시한다.
export function formatTime(ms: number, utcOffsetMinutes: number): string {
  const d = new Date(ms + utcOffsetMinutes * 60000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function current(description: string, corrections: Correction[]): string {
  return corrections.length ? corrections[corrections.length - 1].description : description;
}

type Sortable = HistoryRow & { order: number };

// 같은 시각이면 팀별 버전 순으로 정렬한다. 정렬 순서는 GUI·UI 반영 관계를 뜻하지 않는다.
function sorted(rows: Sortable[]): HistoryRow[] {
  rows.sort((a, b) => b.committedAt - a.committedAt || (a.team === b.team ? b.order - a.order : a.team < b.team ? -1 : 1));
  return rows.map(({ order: _order, ...row }) => row);
}

// 화면의 GUI 배포 기록
export function guiHistoryRows(state: State, screenId: string): HistoryRow[] {
  const offset = state.project.utcOffsetMinutes;
  return sorted((state.gui.get(screenId) ?? []).map(r => ({
    team: 'GUI', at: formatTime(r.committedAt, offset), committedAt: r.committedAt, version: `GUI v${r.version}`, code: r.code, tag: r.tag,
    description: current(r.description, r.corrections), worker: r.worker.name, corrected: r.corrections.length > 0,
    original: r.description, batchId: r.batchId, order: r.version,
  })));
}

// 플립북 하단 이력. 쌓은 GUI 기록과 UI 기록을 대응시키지 않고 각각 별도 행으로 최신순 정렬한다.
// 같은 배포에서 바뀐 여러 화면은 한 줄로 합치고, Screen ID·버전은 표시하지 않는다(2026-10-20 사용자 결정).
export function flipbookHistoryRows(state: State, flipbookId: string): HistoryRow[] {
  const offset = state.project.utcOffsetMinutes;
  const rows: Sortable[] = [];
  const batches = new Map<string, NonNullable<ReturnType<typeof state.imported.get>>>();
  for (const r of state.imported.get(flipbookId) ?? []) {
    const key = r.batchId ?? `${r.uid}@${r.version}`;
    const bucket = batches.get(key) ?? [];
    bucket.push(r);
    batches.set(key, bucket);
  }
  for (const [batchId, group] of batches) {
    const first = group[0];
    const version = group.map(r => `${r.code} v${r.version}`).join(', ');
    rows.push({
      team: 'GUI', at: formatTime(first.committedAt, offset), committedAt: first.committedAt, version, code: null, tag: first.tag,
      description: first.description, worker: first.worker, corrected: group.some(r => r.corrected), original: first.original,
      batchId, order: Math.max(...group.map(r => r.version)),
    });
  }
  for (const r of state.ui.get(flipbookId) ?? [])
    rows.push({
      team: 'UI', at: formatTime(r.committedAt, offset), committedAt: r.committedAt, version: `UI v${r.version}`, code: null, tag: r.tag,
      description: current(r.description, r.corrections), worker: r.worker.name, corrected: r.corrections.length > 0,
      original: r.description, batchId: r.batchId, order: r.version,
    });
  return sorted(rows);
}
