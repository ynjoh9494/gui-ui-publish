import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flowRecord, flowUpdates, labelSpot, layoutFlow, planFlow, routeLink, FLOW_LAYOUT, type FlowGrid } from '../src/core/flow.ts';
import { keys, memoryKV, Store } from '../src/core/store.ts';
import type { GuiRecord, Screen } from '../src/core/types.ts';

// 플로우(2026-10-23): 배포된 화면을 격자 칸에 놓고, 카드 변에서 변으로 칸 사이 통로를 따라 꺾인 화살표로 잇는다.

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

const G: FlowGrid = { x0: 0, y0: 0, cellW: 100, cellH: 50, gapX: 40, gapY: 20 };
const card = (key: string, uid: string, r: number, c: number) => ({ key, uid, r, c });

test('마주 보는 변끼리는 곧은 화살표, 다른 줄로 넘어가면 칸 사이 통로로만 꺾인다', () => {
  assert.deepEqual(routeLink(G, { r: 0, c: 0 }, 'right', { r: 0, c: 1 }, 'left'), [[100, 25], [140, 25]]);
  assert.deepEqual(routeLink(G, { r: 0, c: 0 }, 'bottom', { r: 1, c: 0 }, 'top'), [[50, 50], [50, 70]]);
  assert.deepEqual(routeLink(G, { r: 0, c: 0 }, 'right', { r: 0, c: 2 }, 'left', [{ r: 0, c: 0 }, { r: 0, c: 2 }]), [[100, 25], [280, 25]], '빈 칸은 직선으로 통과한다');
  assert.deepEqual(routeLink(G, { r: 0, c: 0 }, 'right', { r: 0, c: 2 }, 'left', [{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 0, c: 2 }]), [[100, 25], [120, 25], [120, -10], [260, -10], [260, 25], [280, 25]], '중간 칸에 카드가 있으면 돌아간다');
  // 줄 끝에서 다음 줄 맨 앞으로: 두 칸 사이 가로 통로 가운데(y 60)로 건넌다.
  assert.deepEqual(routeLink(G, { r: 0, c: 1 }, 'right', { r: 1, c: 0 }, 'left'), [[240, 25], [260, 25], [260, 60], [-20, 60], [-20, 95], [0, 95]]);
  // 위아래 변과 좌우 변 사이에서 지나는 칸이 비었으면 피해 가지 않고 한 번만 꺾는다(2026-10-23 사용자 요청).
  assert.deepEqual(routeLink(G, { r: 0, c: 0 }, 'right', { r: 1, c: 1 }, 'top'), [[100, 25], [190, 25], [190, 70]]);
  assert.deepEqual(routeLink(G, { r: 0, c: 0 }, 'bottom', { r: 1, c: 1 }, 'left'), [[50, 50], [50, 95], [140, 95]]);
  assert.deepEqual(routeLink(G, { r: 0, c: 0 }, 'bottom', { r: 2, c: 2 }, 'left'), [[50, 50], [50, 165], [280, 165]], '여러 칸을 건너도 빈 칸이면 한 번 꺾는다');
  // 꺾이는 칸에 카드가 있으면 세로 통로(x 120)와 가로 통로(y 60)로 돌아간다.
  assert.deepEqual(routeLink(G, { r: 0, c: 0 }, 'right', { r: 1, c: 1 }, 'top', [{ r: 0, c: 1 }]), [[100, 25], [120, 25], [120, 60], [190, 60], [190, 70]]);
  assert.deepEqual(routeLink(G, { r: 0, c: 0 }, 'bottom', { r: 1, c: 1 }, 'left', [{ r: 1, c: 0 }]), [[50, 50], [50, 60], [120, 60], [120, 95], [140, 95]]);
});

test('조건 칸은 출발 화면 가까이: 좌우로 나가면 화살표 위, 위아래로 나가면 화살표 오른쪽', () => {
  const m = FLOW_LAYOUT.labelMargin;
  assert.deepEqual(labelSpot(G, [100, 25], 'right'), { x: 100 + m, y: 25 - FLOW_LAYOUT.labelGap, width: 40 - 2 * m, align: 'left', anchor: 'bottom' });
  assert.deepEqual(labelSpot(G, [0, 25], 'left'), { x: -40 + m, y: 25 - FLOW_LAYOUT.labelGap, width: 40 - 2 * m, align: 'right', anchor: 'bottom' });
  assert.deepEqual(labelSpot(G, [50, 50], 'bottom'), { x: 50 + m, y: 50 + m, width: 50 - m, align: 'left', anchor: 'top' });
  assert.deepEqual(labelSpot(G, [50, 0], 'top'), { x: 50 + m, y: -m, width: 50 - m, align: 'left', anchor: 'bottom' });
});

test('캔버스 배치는 참고 프레임의 화살표·조건 규칙을 따르고 이미지 사이를 가로·세로 80으로 둔다(화살촉은 8px 앞)', () => {
  const L = FLOW_LAYOUT;
  assert.deepEqual([L.gapX, L.gapY, L.cellTitle, L.captionGap, L.arrowGap], [80, 80, 25, 4, 8]);
  // 참고 프레임(TIM_UI Scenario_STB 3178:215687)의 배치: 위·가운데·아래 화면과 아래 오른쪽 화면. 가로는 참고와 같고 세로 간격만 80이다.
  const cells = [{ key: 'top', r: 0, c: 0 }, { key: 'mid', r: 1, c: 0 }, { key: 'bottom', r: 2, c: 0 }, { key: 'right', r: 2, c: 1 }];
  const links = [
    { from: 'mid', fromSide: 'top' as const, to: 'top', toSide: 'bottom' as const },
    { from: 'mid', fromSide: 'bottom' as const, to: 'bottom', toSide: 'top' as const },
    { from: 'mid', fromSide: 'right' as const, to: 'right', toSide: 'left' as const },
  ];
  const layout = layoutFlow(cells, links, { w: 480, h: 320, imgTop: 25, imgH: 270 });
  assert.deepEqual([layout.grid.y0, layout.grid.gapY, layout.width, layout.height], [56, 30, 1040, 1076], '카드 틀 사이 세로 30(이미지 사이 80)');
  const [up, down, right] = layout.arrows;
  assert.deepEqual(up.points, [[240, 431], [240, 359]], 'Up: 이미지 위 끝에서 위 이미지 아래 끝 8px 앞까지');
  assert.deepEqual(down.points, [[240, 701], [240, 773]]);
  assert.deepEqual(right.points, [[480, 566], [516, 566], [516, 916], [552, 916]], 'Right: 출발점과 화살촉 끝 가운데(x 516)에서 꺾인다');
  assert.deepEqual([up.label.x, up.label.y, up.label.anchor], [248, 423, 'bottom']);
  assert.deepEqual([down.label.x, down.label.y, down.label.anchor], [248, 709, 'top']);
  assert.deepEqual([right.label.x, right.label.y, right.label.anchor], [488, 558, 'bottom']);
});

test('플로우 계획: 배포된 화면만, 왼쪽 위 칸을 (0, 0)으로 옮기고 잘못된 화살표는 뺀다', () => {
  const s = seed([{ id: '1', version: 2 }, { id: '2', version: 1 }, { id: '3', version: 1, status: 'deleted' }, { id: '4', version: 0 }]);
  let n = 0;
  const id = () => `f${++n}`;
  const plan = planFlow(s.state, {
    title: ' ', cards: [card('a', '1', 2, 1), card('b', '2', 2, 3), card('c', '1', 4, 1)],
    links: [
      { from: 'a', fromSide: 'right', to: 'b', toSide: 'left' }, { from: 'a', fromSide: 'right', to: 'b', toSide: 'left' },
      { from: 'a', fromSide: 'bottom', to: 'a', toSide: 'top' }, { from: 'a', fromSide: 'bottom', to: 'x', toSide: 'top' },
      { from: 'a', fromSide: 'bottom', to: 'c', toSide: 'top' },
    ],
  }, id);
  assert.equal(plan.title, '플로우');
  assert.deepEqual(plan.cells.map(c => [c.key, c.uid, c.r, c.c, c.version, c.thumb?.hash]), [['a', '1', 0, 0, 2, '1-2'], ['b', '2', 0, 2, 1, '2-1'], ['c', '1', 2, 0, 2, '1-2']]);
  assert.deepEqual(plan.links.map(l => `${l.from}>${l.to}`),['a>b', 'a>c'], '겹친 화살표, 자기 자신, 없는 카드로 가는 화살표는 뺀다');
  assert.deepEqual(flowRecord(plan, { nodeId: 'n', pageId: 'p' }, actor, 5).uids, ['1', '2']);
  assert.throws(() => planFlow(s.state, { title: '', cards: [card('a', '1', 0, 0)], links: [] }, id), /2개 이상/);
  assert.throws(() => planFlow(s.state, { title: '', cards: [card('a', '1', 0, 0), card('b', '3', 0, 1)], links: [] }, id), /배포된 화면이 아닙니다/);
  assert.throws(() => planFlow(s.state, { title: '', cards: [card('a', '1', 0, 0), card('b', '4', 0, 1)], links: [] }, id), /배포된 화면이 아닙니다/);
  assert.throws(() => planFlow(s.state, { title: '', cards: [card('a', '1', 0, 0), card('b', '2', 0, 0)], links: [] }, id), /한 칸에/);
});

test('다시 배포된 화면이 든 플로우만 고르고, 썸네일이 없거나 사용 안 함인 화면은 바꾸지 않는다', () => {
  const s = seed([{ id: '1', version: 2 }, { id: '2', version: 1, thumb: false }, { id: '3', version: 1, status: 'deleted' }, { id: '5', version: 1 }]);
  const plan = planFlow(s.state, { title: 'A', cards: [card('a', '1', 0, 0), card('b', '2', 0, 1)], links: [] }, () => 'fa');
  s.put(keys.flow('fa'), flowRecord(plan, { nodeId: 'na', pageId: 'p' }, actor, 1));
  s.put(keys.flow('fb'), { id: 'fb', nodeId: 'nb', pageId: 'p', title: 'B', uids: ['5'], createdAt: 1, actor });
  const result = flowUpdates(s.state, new Set(['1', '2', '3']));
  assert.deepEqual(result.flows.map(f => f.id), ['fa']);
  assert.deepEqual(result.thumbs.map(t => [t.uid, t.version, t.thumb.hash]), [['1', 2, '1-2']]);
  s.remove(keys.flow('fa'));
  assert.equal(s.state.flows.has('fa'), false);
  assert.equal(s.state.flows.has('fb'), true);
});
