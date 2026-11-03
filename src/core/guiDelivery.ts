import { COPY } from './copy.ts';
import { keys, type State, type Store } from './store.ts';
import type { Delivery, GuiRecord, Screen } from './types.ts';

// 관리 화면의 전체 점검이 만드는 묶음. 중단된 배포가 아니라 이미 배포한 화면을 다시 맞춰 보는 작업이다.
export const RECONCILE_PREFIX = 'reconcile:';

// 이전 버전의 전체 점검은 배포 뒤 원본을 고친 화면(다음 버전 작업 중)까지 실패로 남겼다. 끝내지 못한 작업이 아니므로
// 건수·재시도에서 뺀다. 원기록은 보존한다.
const staleReconcile = (d: Delivery) =>
  d.kind === 'gui' && d.state === 'failed' && d.batchId.startsWith(RECONCILE_PREFIX) && d.error === COPY.recoverySourceChanged;

// Management and retry share this rule: historical deliveries to retired
// flipbooks are not actionable work, but their original records remain intact.
export function retryableDeliveries(state: State): Delivery[] {
  return [...state.deliveries.values()].filter(d => d.state !== 'done' && !staleReconcile(d) &&
    (d.kind === 'gui' || state.flipbooks.get(d.targetId)?.status === 'active'));
}

export interface PendingRow { key: string; kind: Delivery['kind']; name: string; reason: string; count: number }

// 미완료 목록(상단 배너·관리). 같은 대상의 여러 기록은 한 줄로 묶고 가장 최근 기록의 상태를 이유로 쓴다.
// 플립북을 먼저, 그다음 GUI 화면을 이름순으로 둔다.
export function pendingRows(state: State): PendingRow[] {
  const rows = new Map<string, PendingRow & { at: number }>();
  for (const d of retryableDeliveries(state)) {
    const key = `${d.kind}:${d.targetId}`;
    const reason = d.state === 'failed' ? d.error || COPY.recoveryFailed
      : d.state === 'applying' ? COPY.recoveryStoppedDuring : COPY.recoveryStoppedBefore;
    const held = rows.get(key);
    if (held) {
      held.count++;
      if (d.updatedAt >= held.at) { held.reason = reason; held.at = d.updatedAt; }
      continue;
    }
    const screen = d.kind === 'gui' ? state.screens.get(d.targetId) : undefined;
    const name = d.kind === 'flipbook' ? state.flipbooks.get(d.targetId)?.title || d.targetId
      : [screen?.code, screen?.name].filter(Boolean).join(' ') || d.targetId;
    rows.set(key, { key, kind: d.kind, name, reason, count: 1, at: d.updatedAt });
  }
  return [...rows.values()]
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'flipbook' ? -1 : 1) || a.name.localeCompare(b.name, 'ko', { numeric: true }))
    .map(({ at: _, ...row }) => row);
}

export function queueGuiDelivery(store: Store, batchId: string, before: Screen | null, after: Screen, record: GuiRecord | null): void {
  const key = keys.guiDelivery(batchId, after.id);
  if (store.state.deliveries.has(key)) return;
  store.put(key, {
    batchId, kind: 'gui', targetId: after.id, team: 'GUI', version: record?.version ?? after.guiVersion,
    state: 'pending', error: null, updatedAt: store.now(), intent: { before, after, record },
  } satisfies Delivery);
}

export function setGuiDeliveryState(store: Store, job: Delivery, state: Delivery['state'], error: string | null = null): void {
  const current = store.readFresh<Delivery>(keys.guiDelivery(job.batchId, job.targetId));
  if (!current) return;
  if (current.state === 'done' && state !== 'done') return;
  const { intent, ...summary } = current;
  store.put(keys.guiDelivery(job.batchId, job.targetId), { ...summary, ...(state !== 'done' && intent ? { intent } : {}), state, error, updatedAt: store.now() });
}

// Complete only a persisted, validated commit intent. Never replace a later
// user's screen edit just because an older process stopped halfway through.
export function restoreGuiWrite(store: Store, job: Delivery): void {
  const intent = job.intent;
  if (!intent) return;
  const current = store.readFresh<Screen>(keys.screen(job.targetId));
  const record = intent.record;
  const held = record ? store.readFresh<GuiRecord>(keys.gui(job.targetId, record.version)) : null;
  if (held && (held.batchId !== record?.batchId || held.fingerprint !== record.fingerprint)) throw new Error(COPY.recoveryConflict);
  const already = current && (record ? current.guiVersion >= record.version && !!held : current.status === 'deleted');
  if (!already && JSON.stringify(current) !== JSON.stringify(intent.before) && JSON.stringify(current) !== JSON.stringify(intent.after)) throw new Error(COPY.recoveryConflict);
  if (record && !held) store.put(keys.gui(job.targetId, record.version), record);
  if (!already) store.put(keys.screen(job.targetId), intent.after);
}
