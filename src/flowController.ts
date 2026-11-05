import { COPY } from './core/copy.ts';
import { flowPages, flowRecord, flowUpdates, planFlow, reconcileFlows, type FlowRequest, type FoundFlowCell } from './core/flow.ts';
import { keys, type Store } from './core/store.ts';
import { placePath, successorOf, type TrackListItem } from './core/tracks.ts';
import type { FlowRecord } from './core/types.ts';
import type { Host } from './host.ts';

// 플로우(UI Flipbook의 부가 기능) 작업 조정. 규칙은 core/flow.ts, 캔버스는 Host가 맡는다.
// 플로우는 위치만 기록하고 이력 행은 남기지 않는다. 캔버스에서 지운 플로우는 묻지 않고 기록에서 뺀다(2026-10-23 사용자 결정).
// 플로우는 만든 뒤 얼마든지 고치므로(그룹 풀기·다시 묶기·옮기기·칸 복제) 그룹이 아니라 썸네일 칸의 표식으로 찾는다(2026-11-05 사용자 결정).
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

  // 플로우 기록(flows)을 캔버스의 칸으로 맞춘다. 기록된 페이지를 읽고, 거기서 칸을 하나도 찾지 못한 플로우가 있으면(다른 페이지로 옮겼거나 지움)
  // 모든 페이지를 한 번 더 읽는다. 그래도 없으면 지운 것으로 보고 기록에서 뺀다. 읽은 페이지에서 기록 없는 플로우의 칸을 만나면 기록을 되살린다.
  private async locate(flows: FlowRecord[]): Promise<{ byFlow: Map<string, FoundFlowCell[]>; changed: number }> {
    const { flowCells } = this.host;
    if (!flowCells || !flows.length) return { byFlow: new Map(), changed: 0 };
    let cells = await flowCells([...new Set(flows.flatMap(flowPages))]);
    const found = new Set(cells.map(c => c.flowId));
    if (flows.some(f => !found.has(f.id))) cells = await flowCells(null);
    this.store.reload();
    return reconcileFlows(this.store, cells, flows, this.host.actor);
  }

  // 추적 목록 팝업(PRD §4.5, 「만든 플로우」 목록을 대신한다): 이 화면(교체로 이어진 옛 화면 포함)의 썸네일이 든 플로우와 놓인 자리.
  // 경로 끝은 플로우 제목이다. 캔버스에서 지운 플로우는 묻지 않고 기록에서 뺀다. changed: 캔버스를 따라 바꾼 기록 수(붙은 수를 다시 보낸다)
  async places(uid: string): Promise<{ items: TrackListItem[]; changed: number }> {
    const { nodePlaces } = this.host;
    const s = this.store;
    s.reload();
    if (!nodePlaces || !this.host.flowCells) return { items: [], changed: 0 };
    const before = successorOf(s.state);
    const { byFlow, changed } = await this.locate([...s.state.flows.values()].filter(f => f.uids.some(u => before(u) === uid)));
    s.reload();
    const live = successorOf(s.state);
    const picks = [...s.state.flows.values()].sort((a, b) => a.createdAt - b.createdAt).flatMap(flow => {
      const cell = byFlow.get(flow.id)?.find(c => live(c.uid) === uid);
      return cell ? [{ flow, cell }] : [];
    });
    const places = await nodePlaces(picks.map(p => ({ nodeId: p.cell.nodeId, copy: false })));
    return { items: picks.flatMap(({ flow }, i) => places[i] ? [{ kind: 'flow' as const, id: flow.id, path: [...placePath(s.state, places[i]!), flow.title] }] : []), changed };
  }

  // 플로우(uid가 있으면 그 화면 칸)의 노드 ID. 그 화면 칸이 없으면 플로우로 간다. 칸을 하나도 찾지 못하면 기록에서 빼고 null
  async find(flowId: string, uid?: string): Promise<string | null> {
    this.store.reload();
    const flow = this.store.state.flows.get(flowId);
    if (!flow) return null;
    const cells = (await this.locate([flow])).byFlow.get(flowId) ?? [];
    const live = successorOf(this.store.state);
    const cell = uid ? cells.find(c => live(c.uid) === uid) : undefined;
    if (cell) return cell.cardId;
    return cells.length ? cells.find(c => c.rootId)?.rootId ?? cells[0].cardId : null;
  }

  // GUI를 다시 배포하면 그 화면의 칸 썸네일만 바꾼다(2026-10-23 사용자 결정). 칸은 플로우 기록이 있는 모든 페이지에서 찾으므로
  // 다른 플로우에 복사해 둔 칸도 바뀐다. 플로우 실패는 배포 결과와 따로 알린다. 캔버스를 바꾸므로 플로우마다 차례로 한다.
  async update(uids: Set<string>, requireSuccess = false): Promise<string | null> {
    if (!this.host.updateFlowCells || !uids.size) return null;
    const s = this.store;
    s.reload();
    const { flows, thumbs } = flowUpdates(s.state, uids);
    if (!flows.length) return null;
    const { byFlow } = await this.locate([...s.state.flows.values()]);
    const wanted = new Set(thumbs.flatMap(t => [t.uid, ...(t.formerUids ?? [])]));
    let updated = 0;
    const failed: string[] = [];
    for (const [flowId, cells] of byFlow) {
      const targets = cells.filter(c => wanted.has(c.uid)).map(c => c.nodeId);
      if (!targets.length) continue;
      try {
        if (await this.host.updateFlowCells(targets, thumbs)) updated++;
      } catch (e) {
        failed.push(`${s.state.flows.get(flowId)?.title ?? flowId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (requireSuccess && failed.length) throw new Error(`${COPY.flow010} ${failed.join('; ')}`);
    return [updated ? `${COPY.flow008} ${updated}${COPY.flow009}` : '', failed.length ? `${COPY.flow010} ${failed.join('; ')}` : ''].filter(Boolean).join(' ') || null;
  }

  // 플러그인이 열려 있는 동안 캔버스에 새로 생긴(붙여 넣은·복제한) 플로우 칸을 기록에 더한다. 다른 페이지에 붙인 플로우도 다음부터
  // 그 페이지를 읽는다. 기록을 바꿨으면 true
  async adopt(nodeIds: string[]): Promise<boolean> {
    if (!this.host.createdFlowCells || !nodeIds.length) return false;
    const cells = await this.host.createdFlowCells(nodeIds);
    if (!cells.length) return false;
    this.store.reload();
    return reconcileFlows(this.store, cells, [], this.host.actor, true).changed > 0;
  }
}
