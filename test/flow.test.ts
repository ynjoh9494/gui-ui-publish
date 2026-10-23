import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flowRecord, flowUpdates, labelSpot, layoutFlow, planFlow, routeLink, trimEnd, FLOW_LAYOUT, type FlowGrid } from '../src/core/flow.ts';
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
  // 줄 끝에서 다음 줄 맨 앞으로: 두 칸 사이 가로 통로 가운데(y 60)로 건넌다.
  assert.deepEqual(routeLink(G, { r: 0, c: 1 }, 'right', { r: 1, c: 0 }, 'left'), [[240, 25], [260, 25], [260, 60], [-20, 60], [-20, 95], [0, 95]]);
  // 오른쪽으로 나가 아래 칸 위로 들어가면 한 번 꺾인다. 세로 통로(x 120)와 가로 통로(y 60)만 지난다.
  assert.deepEqual(routeLink(G, { r: 0, c: 0 }, 'right', { r: 1, c: 1 }, 'top'), [[100, 25], [120, 25], [120, 60], [190, 60], [190, 70]]);
  assert.deepEqual(routeLink(G, { r: 0, c: 0 }, 'bottom', { r: 1, c: 1 }, 'left'), [[50, 50], [50, 60], [120, 60], [120, 95], [140, 95]]);
  // 화살촉 길이만큼 끝을 줄이고 방향을 돌려준다.
  const end = trimEnd([[50, 50], [50, 60], [120, 60], [120, 95], [140, 95]], 14);
  assert.deepEqual([end.dir, end.tip, end.points[end.points.length - 1]], ['right', [140, 95], [126, 95]]);
});

test('조건 칸은 출발 화면 가까이: 좌우로 나가면 화살표 위, 위아래로 나가면 화살표 오른쪽', () => {
  const m = FLOW_LAYOUT.labelMargin;
  assert.deepEqual(labelSpot(G, [100, 25], 'right'), { x: 100 + m, y: 25 - FLOW_LAYOUT.labelGap, width: 40 - 2 * m, align: 'left', anchor: 'bottom' });
  assert.deepEqual(labelSpot(G, [0, 25], 'left'), { x: -40 + m, y: 25 - FLOW_LAYOUT.labelGap, width: 40 - 2 * m, align: 'right', anchor: 'bottom' });
  assert.deepEqual(labelSpot(G, [50, 50], 'bottom'), { x: 50 + m, y: 50 + m, width: 50 - m, align: 'left', anchor: 'top' });
  assert.deepEqual(labelSpot(G, [50, 0], 'top'), { x: 50 + m, y: -m, width: 50 - m, align: 'left', anchor: 'bottom' });
});

test('캔버스 배치는 격자 그대로: 칸 크기는 모두 같고 바깥에도 통로 절반을 둔다', () => {
  const L = FLOW_LAYOUT;
  const layout = layoutFlow([{ key: 'a', r: 0, c: 0 }, { key: 'b', r: 1, c: 2 }], [{ from: 'a', fromSide: 'right', to: 'b', toSide: 'top' }], { w: 480, h: 360 });
  assert.equal(layout.width, 2 * (L.pad + L.gapX / 2) + 3 * 480 + 2 * L.gapX);
  assert.equal(layout.grid.y0, L.pad + L.titleGap + L.gapY / 2);
  assert.equal(layout.height, layout.grid.y0 + 2 * 360 + L.gapY + L.gapY / 2 + L.pad);
  assert.equal(layout.arrows.length, 1);
  assert.deepEqual(layout.arrows[0].points[0], [layout.grid.x0 + 480, layout.grid.y0 + 180]);
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
