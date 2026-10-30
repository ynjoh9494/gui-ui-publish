import { COPY } from './core/copy.ts';
import { flowRecord, flowUpdates, planFlow, type FlowRequest } from './core/flow.ts';
import { keys, type Store } from './core/store.ts';
import { placePath, successorOf, type TrackListItem } from './core/tracks.ts';
import type { FlowRecord } from './core/types.ts';
import type { Host } from './host.ts';

// 플로우(UI Flipbook의 부가 기능) 작업 조정. 규칙은 core/flow.ts, 캔버스는 Host가 맡는다.
// 플로우는 위치만 기록하고 이력 행은 남기지 않는다. 캔버스에서 그룹을 지운 플로우는 묻지 않고 기록에서 뺀다(2026-10-23 사용자 결정).
export class FlowController {
  private readonly store: Store;
  private readonly host: Host;

  constructor(store: Store, host: Host) {
    this.store = store;
    this.host = host;
  }

  // 배포된 화면만 넣는다. 위치를 기록하고(플로우 목록) 감사 기록은 다른 기록과 같이 남긴다.
  async create(request: FlowRequest): Promise<void> {
    if (!this.host.createFlow) return;
    const s = this.store;
    s.reload();
    const plan = planFlow(s.state, request, s.newId);
    const placed = await this.host.createFlow(plan);
    const record = flowRecord(plan, placed, this.host.actor, s.now());
    s.put(keys.flow(plan.id), record);
    s.audit(this.host.actor, 'flow.create', plan.id, null, { title: record.title, pageId: record.pageId, screens: record.uids });
    this.host.post({ type: 'notice', message: [`${COPY.flow007} ${plan.title}`, ...placed.notes].join(' ') });
  }

  // 추적 목록 팝업(PRD §4.5, 「만든 플로우」 목록을 대신한다): 이 화면(교체로 이어진 옛 화면 포함)의 썸네일이 든 플로우와 놓인 자리.
  // 경로 끝은 플로우 제목이다. 캔버스에서 그룹을 지운 플로우는 묻지 않고 기록에서 뺀다.
  async places(uid: string): Promise<{ items: TrackListItem[]; removed: number }> {
    const { flowNode, nodePlaces } = this.host;
    const s = this.store;
    s.reload();
    if (!flowNode || !nodePlaces) return { items: [], removed: 0 };
    const live = successorOf(s.state);
    const flows = [...s.state.flows.values()].filter(f => f.uids.some(u => live(u) === uid)).sort((a, b) => a.createdAt - b.createdAt);
    // 그룹은 서로 기다리지 않고 함께 찾는다(플로우가 있는 페이지를 처음 불러올 때 오래 걸린다).
    const nodes = await Promise.all(flows.map(flow => flowNode(flow)));
    const found = flows.flatMap((flow, i) => nodes[i] ? [{ flow, nodeId: nodes[i]! }] : []);
    const places = await nodePlaces(found.map(f => ({ nodeId: f.nodeId, copy: false })));
    const gone = flows.filter((_, i) => !nodes[i]);
    this.forget(gone);
    return { items: found.flatMap(({ flow }, i) => places[i] ? [{ kind: 'flow' as const, id: flow.id, path: [...placePath(s.state, places[i]!), flow.title] }] : []), removed: gone.length };
  }

  // 플로우(uid가 있으면 그 화면 칸)의 노드 ID. 그룹이 지워졌으면 기록에서 빼고 null
  async find(flowId: string, uid?: string): Promise<string | null> {
    this.store.reload();
    const flow = this.store.state.flows.get(flowId);
    const nodeId = flow && this.host.flowNode ? await this.host.flowNode(flow, uid) : null;
    if (!nodeId && flow) this.forget([flow]);
    return nodeId;
  }

  // GUI를 다시 배포하면 그 화면이 든 플로우의 썸네일만 바꾼다(2026-10-23 사용자 결정). 그룹이 지워진 플로우는 위치 기록도 지운다.
  // 플로우 실패는 배포 결과와 따로 알린다. 캔버스를 바꾸므로 플로우마다 차례로 한다.
  async update(uids: Set<string>, requireSuccess = false): Promise<string | null> {
    if (!this.host.updateFlow || !uids.size) return null;
    const s = this.store;
    s.reload();
    const { flows, thumbs } = flowUpdates(s.state, uids);
    let updated = 0;
    const failed: string[] = [];
    const gone: FlowRecord[] = [];
    for (const flow of flows) {
      try {
        const changed = await this.host.updateFlow(flow, thumbs);
        if (changed === null) gone.push(flow);
        else if (changed) updated++;
      } catch (e) {
        failed.push(`${flow.title}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    this.forget(gone);
    if (requireSuccess && failed.length) throw new Error(`${COPY.flow010} ${failed.join('; ')}`);
    return [updated ? `${COPY.flow008} ${updated}${COPY.flow009}` : '', failed.length ? `${COPY.flow010} ${failed.join('; ')}` : ''].filter(Boolean).join(' ') || null;
  }

  // 캔버스에서 그룹을 지운 플로우의 기록을 뺀다.
  private forget(flows: FlowRecord[]): void {
    if (!flows.length) return;
    this.store.remove(...flows.map(flow => keys.flow(flow.id)));
    for (const flow of flows) this.store.audit(this.host.actor, 'flow.remove', flow.id, { title: flow.title, pageId: flow.pageId }, null);
  }
}
