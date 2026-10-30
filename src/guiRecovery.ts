import { COPY } from './core/copy.ts';
import { queueGuiDelivery, restoreGuiWrite, retryableDeliveries, setGuiDeliveryState } from './core/guiDelivery.ts';
import { keys, lastGui, type Store } from './core/store.ts';
import type { Delivery, Batch } from './core/types.ts';
import type { Host } from './host.ts';
import type { TrackController } from './trackController.ts';
import type { FlowController } from './flowController.ts';

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
        if (discover) for (const uid of uids) {
          const source = s.state.screens.get(uid)?.source, record = lastGui(s.state, uid);
          if (!source || !record?.fingerprint) throw new Error(COPY.recoverySourceChanged);
          const key = `${uid}|${source.nodeId}|${record.fingerprint}`;
          if (verified.has(key)) continue;
          const legacy = (record.fpVersion ?? 1) === 1;
          const fresh = await reader.fingerprint(source.nodeId, legacy);
          if ((legacy ? fresh.legacyFingerprint : fresh.fingerprint) !== record.fingerprint) throw new Error(COPY.recoverySourceChanged);
          verified.add(key);
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
        notes.push(`${COPY.recoveryPending} ${message}`);
      }
    }
    return { message: notes.join(' '), failed };
  }
}
