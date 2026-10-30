import { COPY } from './copy.ts';
import { keys, type State, type Store } from './store.ts';
import type { Delivery, GuiRecord, Screen } from './types.ts';

// Management and retry share this rule: historical deliveries to retired
// flipbooks are not actionable work, but their original records remain intact.
export function retryableDeliveries(state: State): Delivery[] {
  return [...state.deliveries.values()].filter(d => d.state !== 'done' &&
    (d.kind === 'gui' || state.flipbooks.get(d.targetId)?.status === 'active'));
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
