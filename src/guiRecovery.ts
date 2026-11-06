import { COPY } from './core/copy.ts';
import { queueGuiDelivery, RECONCILE_PREFIX, restoreGuiWrite, retryableDeliveries, setGuiDeliveryState } from './core/guiDelivery.ts';
import { keys, lastGui, type Store } from './core/store.ts';
import type { Delivery, Batch } from './core/types.ts';
import type { Host } from './host.ts';
import type { TrackController } from './trackController.ts';
import type { FlowController } from './flowController.ts';

interface RecoveryActions {
  pull(batchId: string, targets: string[], uids: Set<string>, history: { uid: string; version: number }[]): Promise<{ message: string; failed: boolean; failedTargets?: string[] } | null>;
  progress?(label: string): Promise<void>;
}

// verify: 저장된 작업을 반영하기 전에 GUI 원본이 배포 때 그대로인지 확인한다(미반영 재시도).
// reconcile: 남은 GUI 작업이 없을 때 쓰이는 화면 전체를 다시 맞춘다(관리의 재시도에서 대기 0건일 때만).
export interface RecoveryOptions { verify?: boolean; reconcile?: boolean }
// blocked: 이번에 반영하지 못한 화면. 이 화면이 든 플립북은 미반영 재시도의 플립북 단계에서도 반영하지 않는다.
export interface RecoveryResult { message: string; failed: boolean; blocked: Set<string> }

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

  async run(batchId?: string, options: RecoveryOptions = {}): Promise<RecoveryResult> {
    const s = this.store;
    s.reload();
    const reader = this.host.createFingerprintReader?.() ?? this.host;
    const step = (label: string) => this.actions.progress?.(label) ?? Promise.resolve();
    // 원본이 배포 때와 같은지 읽는다. 읽지 못하면 오류를 던진다.
    const sourceMatches = async (uid: string): Promise<boolean> => {
      const screen = s.state.screens.get(uid), source = screen?.source, record = lastGui(s.state, uid);
      if (!source || !record?.fingerprint) return false;
      const legacy = (record.fpVersion ?? 1) === 1;
      const fresh = await reader.fingerprint(source.nodeId, legacy);
      return (legacy ? fresh.legacyFingerprint : fresh.fingerprint) === record.fingerprint;
    };
    let jobs = retryableDeliveries(s.state).filter(d => d.kind === 'gui' && (!batchId || d.batchId === batchId));
    // 전체 점검에서 원본을 이미 확인한 화면. 아래 확인에서 다시 읽지 않는다.
    const verified = new Set<string>();
    if (!jobs.length && options.reconcile) {
      const id = `${RECONCILE_PREFIX}${s.newId()}`;
      const referenced = [...new Set([
        ...[...s.state.tracks.values()].map(t => t.uid),
        ...[...s.state.flipbooks.values()].filter(f => f.status === 'active').flatMap(f => f.screens.map(screen => screen.uid)),
        ...[...s.state.flows.values()].flatMap(f => f.uids),
      ])];
      for (const [i, uid] of referenced.entries()) {
        const screen = s.state.screens.get(uid), record = lastGui(s.state, uid);
        if (!screen || !record) continue;
        if (screen.status === 'active') {
          // 배포 뒤 원본을 고친 화면은 다음 배포를 기다리는 정상 상태다. 맞출 대상에 넣지 않고 미완료로도 남기지 않는다.
          await step(`${COPY.recoveryChecking} ${i + 1}/${referenced.length}`);
          if (!await sourceMatches(uid).catch(() => false)) continue;
          verified.add(uid);
        }
        queueGuiDelivery(s, id, screen, screen, record);
      }
      jobs = retryableDeliveries(s.state).filter(d => d.kind === 'gui');
    }
    if (!jobs.length) return { message: '', failed: false, blocked: new Set() };
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
    if (options.verify) {
      const unchecked = [...ids].filter(uid => !blocked.has(uid) && !verified.has(uid) && s.state.screens.get(uid)?.status === 'active');
      for (const [i, uid] of unchecked.entries()) {
        await step(`${COPY.recoveryChecking} ${i + 1}/${unchecked.length}`);
        try { if (!await sourceMatches(uid)) reject(uid, COPY.recoverySourceChanged, true); }
        catch (error) { reject(uid, error instanceof Error ? error.message : String(error)); }
      }
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
    // 화면 반영 건너뛰기로 확정한 화면은 붙인 화면의 레이어를 다시 복사하지 않는다. 재시도·전체 점검도 기록의 선택을 따른다.
    const recordOf = (job: Delivery) => job.intent?.record ?? s.state.gui.get(job.targetId)?.find(r => r.version === job.version) ?? null;
    const keepLayers = new Set([...uids].filter(uid => (byUid.get(uid) ?? []).every(job => recordOf(job)?.skipLayers)));
    if (uids.size) await step(COPY.recoveryCopies);
    await apply(uids, targets => this.tracks.publish(targets, keepLayers));
    uids = new Set([...uids].filter(uid => !blocked.has(uid)));
    if (uids.size && s.state.flows.size) await step(COPY.recoveryFlows);
    await apply(uids, targets => this.flows.update(targets, true));
    uids = new Set([...uids].filter(uid => !blocked.has(uid)));
    const safe = eligible();
    const targets = [...s.state.flipbooks.values()].filter(f => f.status === 'active' &&
      (alerted.includes(f.id) || f.screens.some(screen => safe.has(screen.uid)))).map(f => f.id);
    try {
      const history = jobs.flatMap(job => {
        const record = recordOf(job);
        return safe.has(job.targetId) && !job.batchId.startsWith(RECONCILE_PREFIX) && record && !record.quiet
          ? [{ uid: job.targetId, version: record.version }] : [];
      });
      const deliveryBatch = batchId ?? [...new Set(jobs.map(job => job.batchId))].sort().join(',');
      const pulled = safe.size ? await this.actions.pull(`resume:${deliveryBatch}`, targets, uids, history) : null;
      if (pulled?.message) notes.push(pulled.message);
      if (pulled?.failed) {
        const failedTargets = new Set(pulled.failedTargets ?? targets);
        for (const uid of safe) if (targets.some(id => failedTargets.has(id) &&
          (alerted.includes(id) || s.state.flipbooks.get(id)?.screens.some(screen => screen.uid === uid)))) reject(uid, pulled.message);
      }
      for (const job of jobs) if (!blocked.has(job.targetId)) setGuiDeliveryState(s, job, 'done');
    } catch (error) {
      for (const uid of eligible()) reject(uid, error instanceof Error ? error.message : String(error));
    }
    const reasons = [...(changed.size ? [`${COPY.recoverySourceChanged} (${[...changed].join(', ')})`] : []), ...failures];
    const pending = reasons.length ? `${COPY.recoveryPending} ${reasons.join(' ')}` : '';
    return { message: [pending, ...new Set(notes)].filter(Boolean).join(' '), failed, blocked };
  }
}
