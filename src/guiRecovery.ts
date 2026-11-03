import { COPY } from './core/copy.ts';
import { queueGuiDelivery, restoreGuiWrite, retryableDeliveries, setGuiDeliveryState } from './core/guiDelivery.ts';
import { keys, lastGui, type Store } from './core/store.ts';
import type { Delivery, Batch } from './core/types.ts';
import type { Host } from './host.ts';
import type { TrackController } from './trackController.ts';
import type { FlowController } from './flowController.ts';

interface RecoveryActions {
  pull(batchId: string, targets: string[], uids: Set<string>): Promise<{ message: string; failed: boolean; failedTargets?: string[] } | null>;
  data(): Promise<boolean>;
}

// 저장된 작업은 화면별로 검증하고, 검증된 화면만 한 번에 반영한다.
// 하나의 원본이나 플립북이 막혀도 무관한 화면의 완료 상태는 보존한다.
export class GuiRecovery {
  private readonly store: Store;
  private readonly host: Host;
  private readonly tracks: TrackController;
  private readonly flows: FlowController;
  private readonly actions: RecoveryActions;
  constructor(store: Store, host: Host, tracks: TrackController, flows: FlowController, actions: RecoveryActions) {
    this.store = store; this.host = host; this.tracks = tracks; this.flows = flows; this.actions = actions;
  }

  async run(batchId?: string, discover = false): Promise<{ message: string; failed: boolean }> {
    const s = this.store;
    s.reload();
    let jobs = retryableDeliveries(s.state).filter(d => d.kind === 'gui' && (!batchId || d.batchId === batchId));
    if (!jobs.length && discover) {
      const id = `reconcile:${s.newId()}`;
      const referenced = new Set([
        ...[...s.state.tracks.values()].map(t => t.uid),
        ...[...s.state.flipbooks.values()].filter(f => f.status === 'active').flatMap(f => f.screens.map(screen => screen.uid)),
        ...[...s.state.flows.values()].flatMap(f => f.uids),
      ]);
      for (const uid of referenced) {
        const screen = s.state.screens.get(uid), record = lastGui(s.state, uid);
        if (screen && record) queueGuiDelivery(s, id, screen, screen, record);
      }
      jobs = retryableDeliveries(s.state).filter(d => d.kind === 'gui');
    }
    if (!jobs.length) return { message: '', failed: false };
    const byUid = new Map<string, Delivery[]>();
    for (const job of jobs) byUid.set(job.targetId, [...byUid.get(job.targetId) ?? [], job]);
    const notes: string[] = [], failures = new Set<string>(), changed = new Set<string>();
    const blocked = new Set<string>();
    let failed = false;
    const reject = (uid: string, message: string, sourceChanged = false) => {
      failed = true;
      blocked.add(uid);
      for (const job of byUid.get(uid) ?? []) setGuiDeliveryState(s, job, 'failed', message);
      if (sourceChanged) {
        const screen = s.state.screens.get(uid);
        changed.add(screen?.code || screen?.name || uid);
      } else failures.add(message);
    };
    // 다른 화면의 충돌로 정상 화면의 저장 복구까지 멈추지 않는다.
    for (const job of jobs) {
      if (blocked.has(job.targetId)) continue;
      try { restoreGuiWrite(s, job); setGuiDeliveryState(s, job, 'applying'); }
      catch (error) { reject(job.targetId, error instanceof Error ? error.message : String(error)); }
    }
    s.reload();
    const batchIds = new Set(jobs.map(j => j.batchId));
    const recordsByBatch = new Map<string, Batch['items']>();
    for (const rows of s.state.gui.values()) for (const r of rows) if (batchIds.has(r.batchId) && !s.state.batches.has(r.batchId)) {
      const items = recordsByBatch.get(r.batchId) ?? [];
      items.push({ screenId: r.screenId, version: r.version });
      recordsByBatch.set(r.batchId, items);
    }
    for (const [id, items] of recordsByBatch) {
      const record = s.state.gui.get(items[0].screenId)!.find(r => r.batchId === id)!;
      s.put(keys.batch(id), { id, team: 'GUI', actor: record.actor, committedAt: record.committedAt, items } satisfies Batch);
    }
    const ids = new Set(byUid.keys());
    const reader = this.host.createFingerprintReader?.() ?? this.host;
    if (discover) for (const uid of ids) {
      if (blocked.has(uid) || s.state.screens.get(uid)?.status !== 'active') continue;
      try {
        const screen = s.state.screens.get(uid)!, source = screen.source, record = lastGui(s.state, uid);
        if (!source || !record?.fingerprint) { reject(uid, COPY.recoverySourceChanged, true); continue; }
        const legacy = (record.fpVersion ?? 1) === 1;
        const fresh = await reader.fingerprint(source.nodeId, legacy);
        if ((legacy ? fresh.legacyFingerprint : fresh.fingerprint) !== record.fingerprint)
          reject(uid, COPY.recoverySourceChanged, true);
      } catch (error) { reject(uid, error instanceof Error ? error.message : String(error)); }
    }
    const eligible = () => new Set([...ids].filter(uid => !blocked.has(uid)));
    let uids = new Set([...eligible()].filter(uid => s.state.screens.get(uid)?.status === 'active'));
    const retired = new Set([...eligible()].filter(uid => s.state.screens.get(uid)?.status === 'deleted'));
    const alerted: string[] = [];
    for (const uid of uids) {
      try {
        const source = s.state.screens.get(uid)?.source;
        if (source) await this.host.tagSource?.(source.nodeId, uid);
      } catch (error) { reject(uid, error instanceof Error ? error.message : String(error)); }
    }
    for (const job of jobs) if (!blocked.has(job.targetId) && retired.has(job.targetId) && job.intent?.before?.source && !job.intent.after.source) {
      try { await this.host.tagSource?.(job.intent.before.source.nodeId, '', job.targetId); }
      catch (error) { reject(job.targetId, error instanceof Error ? error.message : String(error)); }
    }
    // 정상일 때는 묶어서 읽고, 부분 실패 때만 화면별로 재시도해 실패 대상을 분리한다.
    const apply = async (targets: Set<string>, run: (uids: Set<string>) => Promise<string | null>) => {
      if (!targets.size) return;
      try { const message = await run(targets); if (message) notes.push(message); }
      catch (error) {
        if (targets.size === 1) { reject([...targets][0], error instanceof Error ? error.message : String(error)); return; }
        for (const uid of targets) {
          try { const message = await run(new Set([uid])); if (message) notes.push(message); }
          catch (failure) { reject(uid, failure instanceof Error ? failure.message : String(failure)); }
        }
      }
    };
    await apply(new Set([...retired].filter(uid => !blocked.has(uid))), async targets => {
      alerted.push(...await this.tracks.retire(targets));
      return null;
    });
    uids = new Set([...uids].filter(uid => !blocked.has(uid)));
    await apply(uids, targets => this.tracks.publish(targets));
    uids = new Set([...uids].filter(uid => !blocked.has(uid)));
    await apply(uids, targets => this.flows.update(targets, true));
    uids = new Set([...uids].filter(uid => !blocked.has(uid)));
    const safe = eligible();
    const targets = [...s.state.flipbooks.values()].filter(f => f.status === 'active' &&
      (alerted.includes(f.id) || f.screens.some(screen => safe.has(screen.uid)))).map(f => f.id);
    try {
      const pulled = safe.size ? await this.actions.pull(`resume:${batchId ?? 'pending'}`, targets, uids) : null;
      if (pulled?.message) notes.push(pulled.message);
      if (pulled?.failed) {
        const failedTargets = new Set(pulled.failedTargets ?? targets);
        for (const uid of safe) if (targets.some(id => failedTargets.has(id) &&
          (alerted.includes(id) || s.state.flipbooks.get(id)?.screens.some(screen => screen.uid === uid)))) reject(uid, pulled.message);
      }
      if (eligible().size && !await this.actions.data()) throw new Error(s.state.dataStatus?.error ?? COPY.controller022);
      for (const job of jobs) if (!blocked.has(job.targetId)) setGuiDeliveryState(s, job, 'done');
    } catch (error) {
      for (const uid of eligible()) reject(uid, error instanceof Error ? error.message : String(error));
    }
    const reasons = [...(changed.size ? [`${COPY.recoverySourceChanged} (${[...changed].join(', ')})`] : []), ...failures];
    const pending = reasons.length ? `${COPY.recoveryPending} ${reasons.join(' ')}` : '';
    return { message: [pending, ...new Set(notes)].filter(Boolean).join(' '), failed };
  }
}
