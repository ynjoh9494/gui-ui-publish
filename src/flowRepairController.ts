import { FLOW_REPAIR_COPY as COPY } from './core/flowRepairCopy.ts';
import { flowPages, flowUpdates, reconcileFlows } from './core/flow.ts';
import { successorOf } from './core/tracks.ts';
import type { FlowRepairCandidate, FlowRepairResult } from './core/flowRepair.ts';
import type { Store } from './core/store.ts';
import type { Host } from './host.ts';

export class FlowRepairController {
  private candidates = new Map<string, FlowRepairCandidate>();
  private token = '';
  private unmarkedId = '';
  private host: Host;
  private store: Store;
  constructor(host: Host, store: Store) { this.host = host; this.store = store; }
  async find(): Promise<void> {
    this.candidates.clear(); this.token = '';
    const images = await this.host.selectedFlowRepairImages?.() ?? [];
    this.store.reload();
    const live = successorOf(this.store.state);
    const candidates = images.map(image => {
      const uid = live(image.uid);
      return { ...image, assignedUid: this.store.state.screens.get(uid)?.status === 'active' ? uid : null };
    });
    this.candidates = new Map(candidates.map(c => [c.nodeId, c]));
    this.token = this.store.newId();
    this.unmarkedId = this.store.newId();
    this.host.post({ type: 'flowRepairCandidates', token: this.token, candidates });
  }
  async restore(token: string, assignments: { nodeId: string; uid: string }[]): Promise<FlowRepairResult> {
    if (!token || token !== this.token) throw new Error(COPY.changed);
    const result: FlowRepairResult = { restored: [], failed: [] };
    const touched = new Set<string>(), pages = new Set<string>();
    for (const [nodeId, uid] of new Map(assignments.map(a => [a.nodeId, a.uid]))) {
      try {
        const item = this.candidates.get(nodeId);
        if (!item || !this.host.restoreFlowImage || !this.host.flowRepairCells) throw new Error(COPY.changed);
        this.store.reload();
        const screen = this.store.state.screens.get(uid);
        const thumb = flowUpdates(this.store.state, new Set([uid])).thumbs[0];
        if (!screen || !thumb) throw new Error(COPY.unavailable);
        const flowId = item.flowId || this.unmarkedId;
        await this.host.restoreFlowImage(item, uid, flowId, thumb, () => {
          this.store.reload();
          const latest = this.store.state.screens.get(uid);
          return latest?.status === 'active' && latest.rev === screen.rev && latest.guiVersion === screen.guiVersion;
        });
        touched.add(flowId); pages.add(item.pageId);
        result.restored.push(nodeId); this.candidates.delete(nodeId);
      } catch (error) { result.failed.push({ nodeId, message: error instanceof Error ? error.message : String(error) }); }
    }
    if (touched.size) {
      this.store.reload();
      const checked = [...this.store.state.flows.values()].filter(f => touched.has(f.id));
      checked.flatMap(flowPages).forEach(p => pages.add(p));
      const cells = await this.host.flowRepairCells!([...pages]);
      this.store.reload();
      reconcileFlows(this.store, cells.filter(c => touched.has(c.flowId)), checked, this.host.actor);
      this.store.audit(this.host.actor, 'flow.repair', '', null, { nodeIds: result.restored });
    }
    return result;
  }
}
