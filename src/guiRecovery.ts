import { COPY } from './core/copy.ts';
import { queueGuiDelivery, restoreGuiWrite, retryableDeliveries, setGuiDeliveryState } from './core/guiDelivery.ts';
import { keys, lastGui, type Store } from './core/store.ts';
import type { Delivery, Batch } from './core/types.ts';
import type { Host } from './host.ts';
import type { TrackController } from './trackController.ts';
import type { FlowController } from './flowController.ts';

// 배포 뒤 원본이 바뀐 화면이 있어 그 묶음을 반영하지 않았다. labels: 그 화면들의 Screen ID(없으면 이름)
class SourceChanged extends Error {
  readonly labels: string[];
  constructor(labels: string[]) { super(COPY.recoverySourceChanged); this.labels = labels; }
}

interface RecoveryActions {
  pull(batchId: string, targets: string[]): Promise<{ message: string; failed: boolean } | null>;
  data(): Promise<boolean>;
}

// GUI commit and canvas delivery are separate durable steps. Only this final
// step acknowledges GUI work; reopening the plugin never runs it implicitly.
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
    const groups = new Map<string, Delivery[]>();
    for (const job of jobs) groups.set(job.batchId, [...groups.get(job.batchId) ?? [], job]);
    // Older files may have GUI history without an outbox. An explicit retry
    // also reconciles those files; it never creates another GUI version.
    const notes: string[] = [];
    // 실패한 이유. 묶음이 여럿이어도 앞머리(recoveryPending)는 한 번만 쓰고 같은 이유도 한 번만 쓴다(2026-11-02 사용자 요청).
    const failures = new Set<string>();
    // 배포 뒤 원본이 바뀌어 덮어쓰지 않은 화면(Screen ID, 없으면 이름)
    const changed = new Set<string>();
    const reader = this.host.createFingerprintReader?.() ?? this.host;
    const verified = new Set<string>();
    let failed = false;
    for (const [id, group] of groups) {
      try {
        for (const job of group) { restoreGuiWrite(s, job); setGuiDeliveryState(s, job, 'applying'); }
        s.reload();
        const records = [...s.state.gui.values()].flatMap(rows => rows.filter(r => r.batchId === id));
        if (records.length && !s.state.batches.has(id)) s.put(keys.batch(id), {
          id, team: 'GUI', actor: records[0].actor, committedAt: records[0].committedAt,
          items: records.map(r => ({ screenId: r.screenId, version: r.version })),
        } satisfies Batch);
        const ids = new Set(group.length ? group.map(j => j.targetId) : [...s.state.screens.keys()]);
        const uids = new Set([...ids].filter(uid => s.state.screens.get(uid)?.status === 'active'));
        const retired = new Set([...ids].filter(uid => s.state.screens.get(uid)?.status === 'deleted'));
        if (discover) {
          // 원본이 바뀐 화면을 모두 모아 Screen ID로 알린다. 그 화면을 다시 배포하면 마지막 기록이 원본과 같아져 풀린다.
          const changedHere: string[] = [];
          for (const uid of uids) {
            const screen = s.state.screens.get(uid), source = screen?.source, record = lastGui(s.state, uid);
            const label = screen?.code || screen?.name || uid;
            if (!source || !record?.fingerprint) { changedHere.push(label); continue; }
            const key = `${uid}|${source.nodeId}|${record.fingerprint}`;
            if (verified.has(key)) continue;
            const legacy = (record.fpVersion ?? 1) === 1;
            const fresh = await reader.fingerprint(source.nodeId, legacy);
            if ((legacy ? fresh.legacyFingerprint : fresh.fingerprint) !== record.fingerprint) { changedHere.push(label); continue; }
            verified.add(key);
          }
          if (changedHere.length) throw new SourceChanged(changedHere);
        }
        for (const uid of uids) {
          const source = s.state.screens.get(uid)?.source;
          if (source) await this.host.tagSource?.(source.nodeId, uid);
        }
        for (const job of group) if (retired.has(job.targetId) && job.intent?.before?.source && !job.intent.after.source)
          await this.host.tagSource?.(job.intent.before.source.nodeId, '', job.targetId);
        const alerted = await this.tracks.retire(retired);
        const copies = await this.tracks.publish(uids);
        if (copies) notes.push(copies);
        // Mark targets before importing GUI history. If the process stops after
        // import, the already-imported version still has a retry destination.
        const targets = [...s.state.flipbooks.values()].filter(f => f.status === 'active' && (alerted.includes(f.id) || f.screens.some(screen => ids.has(screen.uid)))).map(f => f.id);
        const pulled = await this.actions.pull(`resume:${id}`, targets);
        if (pulled?.failed) throw new Error(pulled.message);
        if (pulled?.message) notes.push(pulled.message);
        const flow = await this.flows.update(uids, true);
        if (flow) notes.push(flow);
        if (!await this.actions.data()) throw new Error(s.state.dataStatus?.error ?? COPY.controller022);
        for (const job of group) setGuiDeliveryState(s, job, 'done');
      } catch (error) {
        failed = true;
        const message = error instanceof Error ? error.message : String(error);
        for (const job of group) setGuiDeliveryState(s, job, 'failed', message);
        if (error instanceof SourceChanged) for (const label of error.labels) changed.add(label);
        else failures.add(message);
      }
    }
    // 원본이 바뀐 화면은 묶음이 여럿이어도 한 문장 뒤에 Screen ID를 모은다: 「…다시 배포하세요. (A, B)」
    const reasons = [...(changed.size ? [`${COPY.recoverySourceChanged} (${[...changed].join(', ')})`] : []), ...failures];
    const pending = reasons.length ? `${COPY.recoveryPending} ${reasons.join(' ')}` : '';
    return { message: [pending, ...notes].filter(Boolean).join(' '), failed };
  }
}
