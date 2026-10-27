import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flowList, flowRecord, flowUpdates, labelSpot, layoutFlow, planFlow, routeLink, FLOW_LAYOUT, FLOW_SNAP, type FlowBox } from '../src/core/flow.ts';
import { keys, memoryKV, Store } from '../src/core/store.ts';
import type { FlowRecord, GuiRecord, Screen } from '../src/core/types.ts';
import type { ToUi } from '../src/core/wire.ts';
import { COPY } from '../src/core/copy.ts';
import { Controller } from '../src/controller.ts';
import { FlowController } from '../src/flowController.ts';
import type { Host } from '../src/host.ts';

// 플로우(2026-10-23): 배포된 화면을 놓고 썸네일 변에서 변으로 꺾인 화살표로 잇는다. 2026-10-26부터 썸네일은 격자에 맞춘 자유 위치에 제 크기로 놓인다.

const actor = { id: 'u', name: 'Designer' };

function seed(screens: { id: string; version: number; status?: 'active' | 'deleted'; thumb?: boolean }[]): Store {
  const kv = memoryKV();
  for (const s of screens) {
    const screen: Screen = {
      id: s.id, rev: 1, code: `STB_HO_${s.id}`, name: `화면 ${s.id}`, categoryId: null, baseScreenId: null, status: s.status ?? 'active',
      source: { nodeId: `n-${s.id}`, pageId: 'p' }, guiVersion: s.version, guiTag: null, createdAt: 1,
    };
    kv.set(keys.screen(s.id), JSON.stringify(screen));
    for (let v = 1; v <= s.version; v++) {
      const record = {
        screenId: s.id, version: v, batchId: `b${v}`, workType: v === 1 ? 'new' : 'changed', fingerprint: null,
        thumb: s.thumb === false ? null : { hash: `${s.id}-${v}`, width: 480, height: 270 }, width: 1920, height: 1080,
        code: screen.code, name: screen.name, category: null, base: null, tag: { id: 't', name: '추가', color: '#000', colorKey: 'k' },
        description: '', worker: { id: 'w', name: 'W' }, actor, committedAt: v, extra: {}, corrections: [],
      } satisfies GuiRecord;
      kv.set(keys.gui(s.id, v), JSON.stringify(record));
    }
  }
  return new Store(kv);
}

const B = (x: number, y: number, w = 100, h = 50): FlowBox => ({ x, y, w, h });
const card = (key: string, uid: string, x: number, y: number) => ({ key, uid, x, y });

test('마주 보는 변이 한 줄이면 곧은 화살표, 어긋나면 출발점과 화살촉 끝의 가운데에서 꺾는다', () => {
  assert.deepEqual(routeLink(B(0, 0), 'right', B(140, 0), 'left'), [[100, 25], [140, 25]]);
  assert.deepEqual(routeLink(B(0, 0), 'bottom', B(0, 130), 'top'), [[50, 50], [50, 130]]);
  assert.deepEqual(routeLink(B(0, 0), 'right', B(140, 20), 'left'), [[100, 25], [120, 25], [120, 45], [140, 45]], '높이가 다른 썸네일');
  assert.deepEqual(routeLink(B(0, 0), 'right', B(140, 0), 'left', [], 8), [[100, 25], [132, 25]], '도착점은 endGap 앞에서 멈춘다');
  assert.deepEqual(routeLink(B(0, 0), 'right', B(280, 0), 'left', [B(600, 0)]), [[100, 25], [280, 25]], '사이가 비었으면 멀어도 직선');
});

test('위아래 변과 좌우 변은 지나는 길이 비었으면 한 번만 꺾는다', () => {
  assert.deepEqual(routeLink(B(0, 0), 'right', B(200, 150), 'top'), [[100, 25], [250, 25], [250, 150]]);
  assert.deepEqual(routeLink(B(0, 0), 'bottom', B(200, 150), 'left'), [[50, 50], [50, 175], [200, 175]]);
});

test('막힌 길은 다른 화면의 제목·이미지·설명 자리를 피해 통로 가운데로 돌아간다', () => {
  // 사이에 화면이 있으면 바깥 통로로 돌아간다.
  assert.deepEqual(routeLink(B(0, 0), 'right', B(280, 0), 'left', [B(140, 0)]), [[100, 25], [120, 25], [120, -65], [260, -65], [260, 25], [280, 25]]);
  // 꺾이는 자리에 화면이 있으면 두 화면 사이 통로(x 150) 가운데로 내려간다.
  assert.deepEqual(routeLink(B(0, 0), 'right', B(200, 150), 'top', [B(200, 0)]), [[100, 25], [150, 25], [150, 102], [250, 102], [250, 150]]);
  // 도착 화면 위 제목 칸(25)을 가로지르지 않고 그 위 통로로 들어간다.
  assert.deepEqual(routeLink(B(0, 0), 'right', B(200, 40), 'top'), [[100, 25], [150, 25], [150, -5], [250, -5], [250, 40]]);
  // 같은 변끼리는 모든 화면 바깥 통로를 쓴다.
  assert.deepEqual(routeLink(B(0, 0), 'top', B(200, 0), 'top'), [[50, 0], [50, -65], [250, -65], [250, 0]]);
  // 겹쳐 놓아 길이 없어도 경로는 만든다.
  assert.ok(routeLink(B(0, 0), 'right', B(50, 0), 'left').length >= 2);
});

test('조건 칸은 출발 화면 가까이: 좌우로 나가면 화살표 위, 위아래로 나가면 화살표 오른쪽', () => {
  const m = FLOW_LAYOUT.labelMargin, gap = FLOW_LAYOUT.gapX;
  const from = B(0, 0);
  assert.deepEqual(labelSpot(from, [100, 25], 'right'), { x: 100 + m, y: 25 - FLOW_LAYOUT.labelGap, width: gap - 2 * m, align: 'left', anchor: 'bottom' });
  assert.deepEqual(labelSpot(from, [0, 25], 'left'), { x: -gap + m, y: 25 - FLOW_LAYOUT.labelGap, width: gap - 2 * m, align: 'right', anchor: 'bottom' });
  assert.deepEqual(labelSpot(from, [50, 50], 'bottom'), { x: 50 + m, y: 50 + m, width: 50 - m, align: 'left', anchor: 'top' });
  assert.deepEqual(labelSpot(from, [50, 0], 'top'), { x: 50 + m, y: -m, width: 50 - m, align: 'left', anchor: 'bottom' });
});

test('캔버스 배치는 판의 자리를 그대로 옮기고, 참고 프레임의 화살표·조건 규칙을 따른다(화살촉은 8px 앞)', () => {
  const L = FLOW_LAYOUT;
  assert.deepEqual([L.gapX, L.gapY, L.cellTitle, L.captionGap, L.arrowGap, FLOW_SNAP], [80, 80, 25, 8, 8, 40]);
  // 참고 프레임(TIM_UI Scenario_STB 3178:215687)의 배치: 위·가운데·아래 화면과 아래 오른쪽 화면. 이미지 사이는 가로·세로 80이다.
  const cells = [
    { key: 'top', x: 0, y: 0, w: 480, h: 270 }, { key: 'mid', x: 0, y: 350, w: 480, h: 270 },
    { key: 'bottom', x: 0, y: 700, w: 480, h: 270 }, { key: 'right', x: 560, y: 700, w: 480, h: 270 },
  ];
  const links = [
    { from: 'mid', fromSide: 'top' as const, to: 'top', toSide: 'bottom' as const },
    { from: 'mid', fromSide: 'bottom' as const, to: 'bottom', toSide: 'top' as const },
    { from: 'mid', fromSide: 'right' as const, to: 'right', toSide: 'left' as const },
  ];
  const layout = layoutFlow(cells, links);
  assert.deepEqual(layout.images.get('top'), { x: 0, y: 81, w: 480, h: 270 }, '플로우 제목 아래 56 + 제목 칸 25 뒤에 첫 이미지');
  assert.deepEqual([layout.width, layout.height], [1040, 1080]);
  const [up, down, right] = layout.arrows;
  assert.deepEqual(up.points, [[240, 431], [240, 359]], 'Up: 이미지 위 끝에서 위 이미지 아래 끝 8px 앞까지');
  assert.deepEqual(down.points, [[240, 701], [240, 773]]);
  assert.deepEqual(right.points, [[480, 566], [516, 566], [516, 916], [552, 916]], 'Right: 출발점과 화살촉 끝 가운데(x 516)에서 꺾인다');
  assert.deepEqual([up.label.x, up.label.y, up.label.anchor], [248, 423, 'bottom']);
  assert.deepEqual([down.label.x, down.label.y, down.label.anchor], [248, 709, 'top']);
  assert.deepEqual([right.label.x, right.label.y, right.label.anchor], [488, 558, 'bottom']);
  // 화면마다 제 썸네일 크기를 쓴다.
  const mixed = layoutFlow([{ key: 'a', x: 0, y: 0, w: 480, h: 270 }, { key: 'b', x: 560, y: 0, w: 120, h: 400 }], []);
  assert.deepEqual(mixed.images.get('b'), { x: 560, y: 81, w: 120, h: 400 });
  assert.deepEqual([mixed.width, mixed.height], [680, 510]);
});

test('플로우 계획: 배포된 화면만, 가장 왼쪽·위 썸네일을 (0, 0)으로 옮기고 잘못된 화살표는 뺀다', () => {
  const s = seed([{ id: '1', version: 2 }, { id: '2', version: 1, thumb: false }, { id: '3', version: 1, status: 'deleted' }, { id: '4', version: 0 }]);
  let n = 0;
  const id = () => `f${++n}`;
  const plan = planFlow(s.state, {
    title: ' ', cards: [card('a', '1', 80, 40), card('b', '2', 680, 120), card('c', '1', 80, 400)],
    links: [
      { from: 'a', fromSide: 'right', to: 'b', toSide: 'left' }, { from: 'a', fromSide: 'right', to: 'b', toSide: 'left' },
      { from: 'a', fromSide: 'bottom', to: 'a', toSide: 'top' }, { from: 'a', fromSide: 'bottom', to: 'x', toSide: 'top' },
      { from: 'a', fromSide: 'bottom', to: 'c', toSide: 'top' },
    ],
  }, id);
  assert.equal(plan.title, '플로우');
  assert.deepEqual(plan.cells.map(c => [c.key, c.uid, c.x, c.y, c.w, c.h, c.version, c.thumb?.hash]),
    [['a', '1', 0, 0, 480, 270, 2, '1-2'], ['b', '2', 600, 80, 480, 270, 1, undefined], ['c', '1', 0, 360, 480, 270, 2, '1-2']], '썸네일이 없는 화면은 1920×1080의 1/4 자리');
  assert.deepEqual(plan.links.map(l => `${l.from}>${l.to}`), ['a>b', 'a>c'], '겹친 화살표, 자기 자신, 없는 썸네일로 가는 화살표는 뺀다');
  assert.deepEqual(flowRecord(plan, { nodeId: 'n', pageId: 'p' }, actor, 5).uids, ['1', '2']);
  assert.equal(planFlow(s.state, { title: '', cards: [card('a', '1', 0, 0), card('b', '1', 0, 0)], links: [] }, id).cells.length, 2, '겹쳐 놓아도 만든다');
  assert.throws(() => planFlow(s.state, { title: '', cards: [card('a', '1', 0, 0)], links: [] }, id), /2개 이상/);
  assert.throws(() => planFlow(s.state, { title: '', cards: [card('a', '1', 0, 0), card('b', '3', 560, 0)], links: [] }, id), /배포된 화면이 아닙니다/);
  assert.throws(() => planFlow(s.state, { title: '', cards: [card('a', '1', 0, 0), card('b', '4', 560, 0)], links: [] }, id), /배포된 화면이 아닙니다/);
  assert.throws(() => planFlow(s.state, { title: '', cards: [card('a', '1', 0, 0), card('b', '1', Number.NaN, 0)], links: [] }, id), /위치가 올바르지/);
});

test('다시 배포된 화면이 든 플로우만 고르고, 썸네일이 없거나 사용 안 함인 화면은 바꾸지 않는다', () => {
  const s = seed([{ id: '1', version: 2 }, { id: '2', version: 1, thumb: false }, { id: '3', version: 1, status: 'deleted' }, { id: '5', version: 1 }]);
  const plan = planFlow(s.state, { title: 'A', cards: [card('a', '1', 0, 0), card('b', '2', 560, 0)], links: [] }, () => 'fa');
  s.put(keys.flow('fa'), flowRecord(plan, { nodeId: 'na', pageId: 'p' }, actor, 1));
  s.put(keys.flow('fb'), { id: 'fb', nodeId: 'nb', pageId: 'p', title: 'B', uids: ['5'], createdAt: 1, actor });
  const result = flowUpdates(s.state, new Set(['1', '2', '3']));
  assert.deepEqual(result.flows.map(f => f.id), ['fa']);
  assert.deepEqual(result.thumbs.map(t => [t.uid, t.version, t.thumb.hash]), [['1', 2, '1-2']]);
  s.remove(keys.flow('fa'));
  assert.equal(s.state.flows.has('fa'), false);
  assert.equal(s.state.flows.has('fb'), true);
});

test('플로우 목록은 최근에 만든 것부터, 페이지 이름과 화면(Screen ID·이름)을 함께 보여 준다', () => {
  const s = seed([{ id: '1', version: 1 }, { id: '2', version: 1 }]);
  s.put(keys.flow('old'), { id: 'old', nodeId: 'n1', pageId: 'p', title: '처음', uids: ['1'], createdAt: 1, actor });
  s.put(keys.flow('new'), { id: 'new', nodeId: 'n2', pageId: 'q', title: '나중', uids: ['2', 'gone'], createdAt: 2, actor });
  const list = flowList(s.state, new Map([['p', 'Live']]));
  assert.deepEqual(list.map(f => [f.id, f.pageName]), [['new', ''], ['old', 'Live']]);
  assert.deepEqual(list[0].screens, [{ uid: '2', code: 'STB_HO_2', name: '화면 2' }, { uid: 'gone', code: '', name: 'gone' }], 'a screen missing from the records shows its id');
});

const last = <T>(items: T[]): T => items[items.length - 1];
const flowsPosted = (posted: ToUi[]) => last(posted.filter((m): m is Extract<ToUi, { type: 'flows' }> => m.type === 'flows'));

function flowHost(store: Store, live: Set<string>) {
  const posted: ToUi[] = [];
  const revealed: string[] = [];
  const host = {
    kv: store.kv, mode: 'UI', actor,
    post: (message: ToUi) => posted.push(message),
    pages: () => [{ id: 'p', name: 'Live' }],
    flowNode: async (flow: FlowRecord, uid?: string) => (live.has(flow.nodeId) ? (uid ? `${flow.nodeId}/${uid}` : flow.nodeId) : null),
    reveal: async (nodeId: string) => { revealed.push(nodeId); return true; },
    createFlow: async () => ({ nodeId: 'n3', pageId: 'p', notes: [] }),
    updateFlow: async (flow: FlowRecord) => (live.has(flow.nodeId) ? 1 : null),
  } as unknown as Host;
  return { host, posted, revealed };
}

test('플로우 목록을 열거나 지워진 플로우로 가려 하면 묻지 않고 기록에서 빼고, 남은 플로우는 그 그룹·화면 칸으로 간다', async () => {
  const s = seed([{ id: '1', version: 1 }, { id: '2', version: 1 }]);
  s.put(keys.flow('a'), { id: 'a', nodeId: 'n1', pageId: 'p', title: 'A', uids: ['1'], createdAt: 1, actor });
  s.put(keys.flow('b'), { id: 'b', nodeId: 'n2', pageId: 'p', title: 'B', uids: ['2'], createdAt: 2, actor });
  const live = new Set(['n1', 'n2']);
  const { host, posted, revealed } = flowHost(s, live);
  const controller = new Controller(host);

  await controller.handle({ type: 'revealFlow', nav: 1, flowId: 'a', uid: '1' });
  assert.deepEqual(revealed, ['n1/1']);
  live.delete('n2');
  await controller.handle({ type: 'flows' });
  const listed = flowsPosted(posted);
  assert.deepEqual(listed.flows.map(f => f.id), ['a']);
  assert.equal(controller.store.state.flows.has('b'), false);
  assert.ok(controller.store.state.audit.some(e => e.action === 'flow.remove' && e.target === 'b'));

  live.delete('n1');
  await controller.handle({ type: 'revealFlow', nav: 2, flowId: 'a' });
  assert.equal(controller.store.state.flows.size, 0);
  assert.deepEqual(revealed, ['n1/1'], 'a deleted flow is not revealed');
  assert.deepEqual(last(posted.filter(m => m.type === 'nav')), { type: 'nav', nav: 2, ok: false, message: COPY.flow048 });
  assert.deepEqual(flowsPosted(posted).flows, []);
});

test('플로우를 만들면 위치와 감사 기록을 남기고, 다시 배포한 뒤 그룹이 지워진 플로우는 기록에서 뺀다', async () => {
  const s = seed([{ id: '1', version: 2 }, { id: '2', version: 1 }]);
  const live = new Set(['n3']);
  const { host } = flowHost(s, live);
  const controller = new Controller(host);
  await controller.handle({ type: 'createFlow', request: { title: 'C', cards: [card('a', '1', 0, 0), card('b', '2', 560, 0)], links: [] } });
  const [flow] = [...controller.store.state.flows.values()];
  assert.equal(flow.nodeId, 'n3');
  assert.ok(controller.store.state.audit.some(e => e.action === 'flow.create' && e.target === flow.id));
  live.delete('n3');
  await new FlowController(controller.store, host).update(new Set(['1']));
  assert.equal(controller.store.state.flows.size, 0);
});
