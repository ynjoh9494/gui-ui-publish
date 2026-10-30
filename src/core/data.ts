import { COPY } from './copy.ts';
import { flipbookHistoryRows, formatTime, guiHistoryRows, type HistoryRow } from './history.ts';
import { formatFrameName } from './screenName.ts';
import type { State } from './store.ts';
import type { Actor, DeliveryState, TagSnapshot } from './types.ts';

// 공유 DATA 페이지에 그리는 읽기용 표시. 매번 파일 원기록(sharedPluginData)에서 다시 만들며,
// 페이지를 수동으로 고쳐도 원기록에 역반영하지 않는다.
// GUI 화면과 플립북을 각각 한 행으로 보여 준다.

export interface DataScreenRow {
  id: string;
  name: string;
  category: string;
  // 화면: 기본 화면, 플립북: 종류와 불러온 화면
  base: string;
  status: string;
  sourceNodeId: string | null;
  gui: string;
  guiTag: TagSnapshot | null;
  ui: string;
  uiTag: TagSnapshot | null;
  delivery: string;
}

export interface DataHistoryRow extends HistoryRow { key: string; screenId: string; screenName: string }

export interface DataModel {
  generatedAt: string;
  actor: Actor;
  screens: DataScreenRow[];
  history: DataHistoryRow[];
}

const DELIVERY_LABEL: Record<DeliveryState, string> = { pending: COPY.coreData001, applying: COPY.coreData002, done: COPY.coreData003, failed: COPY.coreData004 };
const KIND_LABEL = { single: COPY.coreData009, multi: COPY.coreData010, policy: COPY.coreData011 };

function deliverySummary(counts = new Map<DeliveryState, number>()): string {
  const parts = (['failed', 'applying', 'pending'] as DeliveryState[]).filter(s => counts.get(s)).map(s => `${DELIVERY_LABEL[s]} ${counts.get(s)}`);
  return parts.length ? parts.join(' · ') : counts.get('done') ? DELIVERY_LABEL.done : '-';
}

export function dataModel(state: State, actor: Actor, now: number): DataModel {
  const deliveries = new Map<string, Map<DeliveryState, number>>();
  for (const d of state.deliveries.values()) {
    // GUI outbox completion includes this DATA render itself. It is reported
    // by the plugin's recovery status, not by the existing flipbook projection.
    if (d.kind !== 'flipbook') continue;
    const counts = deliveries.get(d.targetId) ?? new Map<DeliveryState, number>();
    counts.set(d.state, (counts.get(d.state) ?? 0) + 1);
    deliveries.set(d.targetId, counts);
  }
  const categories = state.categories;
  const order = (categoryId: string | null) => (categoryId ? categories.get(categoryId)?.order ?? Infinity : Infinity);
  const screens = [...state.screens.values()].sort((a, b) =>
    order(a.categoryId) - order(b.categoryId) || (a.code ?? '').localeCompare(b.code ?? '', 'ko') || (a.name ?? '').localeCompare(b.name ?? '', 'ko'));
  const flipbooks = [...state.flipbooks.values()].sort((a, b) => a.category.order - b.category.order || a.title.localeCompare(b.title, 'ko'));

  const rows: DataScreenRow[] = [
    ...screens.map(s => ({
      id: s.id,
      name: formatFrameName(s.code, s.name),
      category: s.categoryId ? categories.get(s.categoryId)?.name ?? '-' : COPY.coreData005,
      base: s.baseScreenId ? state.screens.get(s.baseScreenId)?.name ?? '-' : '',
      status: s.status === 'deleted' ? COPY.coreData006 : COPY.coreData007,
      sourceNodeId: s.source?.nodeId ?? null,
      gui: s.guiVersion ? `GUI v${s.guiVersion}` : '-',
      guiTag: s.guiTag,
      ui: '-',
      uiTag: null,
      delivery: deliverySummary(deliveries.get(s.id)),
    })),
    ...flipbooks.map(fb => {
      const ui = state.uiStates.get(fb.id);
      const imported = state.imported.get(fb.id) ?? [];
      const lastGui = imported.reduce<typeof imported[number] | null>((a, r) => (!a || r.committedAt > a.committedAt ? r : a), null);
      return {
        id: fb.id,
        name: fb.title,
        category: fb.category.name,
        base: [KIND_LABEL[fb.kind], ...fb.screens.map(s => s.code)].join(' · '),
        status: fb.status === 'deleted' ? COPY.coreData006 : COPY.coreData007,
        sourceNodeId: null,
        gui: fb.screens.map(s => `${s.code} v${s.version}`).join(', ') || '-',
        guiTag: lastGui?.tag ?? null,
        ui: ui ? `UI v${ui.version}` : COPY.coreData008,
        uiTag: ui?.tag ?? null,
        delivery: deliverySummary(deliveries.get(fb.id)),
      };
    }),
  ];

  const history: DataHistoryRow[] = [];
  for (const s of screens) for (const row of guiHistoryRows(state, s.id))
    history.push({ ...row, key: `${s.id}:${row.team}:${row.version}`, screenId: s.id, screenName: formatFrameName(s.code, s.name) });
  for (const fb of flipbooks) for (const row of flipbookHistoryRows(state, fb.id))
    history.push({ ...row, key: `${fb.id}:${row.team}:${row.batchId}`, screenId: fb.id, screenName: row.code && fb.kind !== 'single' ? `${fb.title} · ${row.code}` : fb.title });
  // 화면별 정렬과 같은 규칙으로 전체를 최신순 정렬한다. 순서는 GUI·UI 반영 관계를 뜻하지 않는다.
  history.sort((a, b) => b.committedAt - a.committedAt || a.screenName.localeCompare(b.screenName, 'ko') || (a.team < b.team ? -1 : a.team > b.team ? 1 : 0));

  return { generatedAt: formatTime(now, state.project.utcOffsetMinutes), actor, screens: rows, history };
}
