import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FINGERPRINT_VERSION, fingerprint, legacyFingerprint, type NodeSnapshot } from '../src/core/fingerprint.ts';
import { baseline, classify } from '../src/core/compare.ts';
import { upgradeBaseline } from '../src/core/publish.ts';
import { keys, memoryKV, Store } from '../src/core/store.ts';
import type { GuiRecord, Screen } from '../src/core/types.ts';
import { explainMatch, matchVersion, screenTokens, similarity, versionLinkErrors, type VersionFrame } from '../src/core/versionMatch.ts';
import { Controller, type Host } from '../src/controller.ts';
import type { ToUi } from '../src/core/wire.ts';

const actor = { id: 'u', name: 'Designer' };
const OLD = 'old-page', NEW = 'new-page';

// 등록 화면과 마지막 GUI 기록(지문)을 직접 넣는다.
function register(store: Store, id: string, code: string, fingerprint: string, nodeId: string, fpVersion = FINGERPRINT_VERSION) {
  store.put(keys.screen(id), {
    id, rev: 1, code, name: `화면 ${code}`, categoryId: 'home', baseScreenId: null, status: 'active',
    source: { nodeId, pageId: OLD }, guiVersion: 1, guiTag: null, createdAt: 1000,
  } satisfies Screen);
  store.put(keys.gui(id, 1), {
    screenId: id, version: 1, batchId: 'b1', workType: 'new', fingerprint, fpVersion, thumb: null, width: 1920, height: 1080,
    code, name: `화면 ${code}`, category: null, base: null, tag: { id: 't', name: '추가', color: '#000', colorKey: 'Gray' },
    description: '', worker: { id: 'w', name: 'Designer' }, actor, committedAt: 1000, extra: {}, corrections: [],
  } satisfies GuiRecord);
}

// 화면마다 고유한 글자 10개 + 내용 버전 토큰. 공통 배경 토큰은 모든 프레임에 있다.
const tokens = (body: string, content = 'v1') => ['g:FRAME:1920x1080', ...Array.from({ length: 10 }, (_, i) => `t:${body}:${i}`), `t:${content}`];
const frame = (nodeId: string, name: string, fingerprint: string | null, body: string | null, content = 'v1'): VersionFrame =>
  ({ nodeId, name, fingerprint, tokens: body ? tokens(body, content) : null, error: null });

function seeded() {
  const store = new Store(memoryKV(), () => 2000, (() => { let n = 0; return () => `id${++n}`; })());
  store.saveProject({ ...store.state.project, scopePageIds: [OLD] });
  store.put(keys.category('home'), { id: 'home', name: '홈', order: 1, active: true });
  register(store, 'a', 'STB_HO_001', 'fp-a', '1:1');
  register(store, 'b', 'STB_HO_002', 'fp-b', '1:2');
  register(store, 'c', 'STB_HO_003', 'fp-c', '1:3');
  store.reload();
  return store;
}

test('화면 특징은 글자·이미지·레이어 종류와 크기·위치이며, 숨긴 레이어와 루트의 캔버스 위치는 넣지 않는다', () => {
  const snap: NodeSnapshot = {
    type: 'FRAME', props: { x: 5000, y: 300, width: 1920, height: 1080 }, children: [
      { type: 'TEXT', props: { x: 10.4, y: 20, width: 100, height: 24, characters: ' 홈 ' } },
      { type: 'RECTANGLE', props: { x: 0, y: 0, width: 50, height: 50, fills: [{ type: 'IMAGE', imageHash: 'h1' }] } },
      { type: 'TEXT', props: { visible: false } },
    ],
  };
  assert.deepEqual(screenTokens(snap), ['g:FRAME:1920x1080', 'g:TEXT:100x24@10,20', 't:홈', 'g:RECTANGLE:50x50@0,0', 'i:h1']);
  const bag = (t: string[]) => { const m = new Map<string, number>(); t.forEach(x => m.set(x, (m.get(x) ?? 0) + 1)); return m; };
  assert.equal(similarity(bag(['a', 'a', 'b']), bag(['a', 'a', 'b'])), 1);
  assert.equal(similarity(bag(['a', 'a', 'b']), bag(['a', 'c'])), 1 / 4);
});

test('프레임 이름과 관계없이 지난 배포와 같은 화면은 동일, 내용이 비슷한 화면은 유사로 연결하고, 없으면 연결하지 않는다', () => {
  const store = seeded();
  const frames = [
    // 이름이 제각각이어도 이름은 보지 않는다. 다른 화면 이름을 달고 있어도 내용으로 연결한다.
    frame('2:1', '[STB_HO_002] 화면 STB_HO_002', 'fp-a', 'A'),
    frame('2:2', 'Frame 12', 'fp-b2', 'B', 'v2'),
    frame('2:3', 'Frame 13', 'fp-new', 'NEW'),
  ];
  const sources = new Map([['a', tokens('A')], ['b', tokens('B')], ['c', tokens('C')]]);
  const links = matchVersion(store.state, frames, sources);
  assert.deepEqual(links.map(l => [l.code, l.nodeId, l.kind]), [
    ['STB_HO_001', '2:1', 'same'], ['STB_HO_002', '2:2', 'similar'], ['STB_HO_003', null, 'none'],
  ]);
  assert.ok(links[1].score >= 0.5 && links[1].score < 1);
});

test('같은 내용의 화면이 여럿이면 프레임 하나에 화면 하나만 연결하고, 원본을 읽지 못한 화면은 유사로 제안하지 않는다', () => {
  const store = seeded();
  register(store, 'd', 'STB_HO_004', 'fp-a', '1:4');
  store.reload();
  const frames = [frame('2:1', 'x', 'fp-a', 'A'), frame('2:2', 'y', 'fp-a', 'A'), frame('2:3', 'z', 'fp-c2', 'C', 'v9')];
  const links = matchVersion(store.state, frames, new Map([['b', tokens('B')]]));
  assert.deepEqual(links.map(l => [l.code, l.nodeId, l.kind]), [
    ['STB_HO_001', '2:1', 'same'], ['STB_HO_002', null, 'none'], ['STB_HO_003', null, 'none'], ['STB_HO_004', '2:2', 'same'],
  ]);
});

test('유사도 근거는 종류별 일치 수와 한쪽에만 있는 글자를 보여 주고, 공통 요소는 빼고 센다', () => {
  const source = ['g:FRAME:1920x1080', 'g:TEXT:100x24@0,0', 'g:TEXT:100x24@0,0', 't:홈', 't:추천', 'i:h1', 'i:bg'];
  const frame = ['g:FRAME:1920x1080', 'g:TEXT:100x24@0,0', 't:홈', 't:인기', 'i:h1', 'i:bg'];
  const ev = explainMatch(source, frame, new Set(['i:bg']));
  assert.deepEqual(ev.parts, { text: { matched: 1, total: 3 }, image: { matched: 1, total: 1 }, layer: { matched: 2, total: 3 } });
  assert.deepEqual([ev.matched, ev.total, ev.ignored, ev.onlySource, ev.onlyFrame], [4, 7, 1, ['추천'], ['인기']]);
  // 점수는 같은 요소를 뺀 유사도와 같다.
  const bag = (t: string[]) => { const m = new Map<string, number>(); t.filter(x => x !== 'i:bg').forEach(x => m.set(x, (m.get(x) ?? 0) + 1)); return m; };
  assert.equal(ev.score, similarity(bag(source), bag(frame)));
});

test('전환할 연결은 새 버전 페이지의 프레임만, 한 프레임에 한 화면만 허용한다', () => {
  const store = seeded();
  const ids = new Set(['2:1', '2:2']);
  assert.deepEqual(versionLinkErrors(store.state, [{ screenId: 'a', nodeId: '2:1' }, { screenId: 'b', nodeId: '2:2' }], ids), []);
  assert.match(versionLinkErrors(store.state, [{ screenId: 'a', nodeId: '2:1' }, { screenId: 'b', nodeId: '2:1' }], ids).join(), /여러 화면/);
  assert.match(versionLinkErrors(store.state, [{ screenId: 'a', nodeId: '9:9' }], ids).join(), /새 버전 페이지에 없는/);
});

test('새 버전 페이지로 전환하면 원본을 옮기고 표식을 남기며(이름은 그대로), 버전 없이 목록을 바로 분류한다', async () => {
  const store = seeded();
  const kv = store.kv;
  // 캔버스: 기존 페이지 1:1~1:3, 새 버전 페이지 2:1~2:3(2:2는 내용 수정, 2:3은 새 화면)
  const canvas = new Map<string, { pageId: string; name: string; fp: string; body: string; content: string; tag: string | null }>([
    ['1:1', { pageId: OLD, name: '[STB_HO_001] 화면 STB_HO_001', fp: 'fp-a', body: 'A', content: 'v1', tag: 'a' }],
    ['1:2', { pageId: OLD, name: '[STB_HO_002] 화면 STB_HO_002', fp: 'fp-b', body: 'B', content: 'v1', tag: 'b' }],
    ['1:3', { pageId: OLD, name: '[STB_HO_003] 화면 STB_HO_003', fp: 'fp-c', body: 'C', content: 'v1', tag: 'c' }],
    ['2:1', { pageId: NEW, name: 'Frame 1', fp: 'fp-a', body: 'A', content: 'v1', tag: null }],
    ['2:2', { pageId: NEW, name: 'Frame 2', fp: 'fp-b2', body: 'B', content: 'v2', tag: null }],
    ['2:3', { pageId: NEW, name: 'Frame 3', fp: 'fp-new', body: 'NEW', content: 'v1', tag: null }],
  ]);
  const posted: ToUi[] = [];
  const host = {
    kv, mode: 'GUI', actor, post: (m: ToUi) => posted.push(m),
    pages: () => [{ id: OLD, name: '원본' }, { id: NEW, name: '새 버전' }],
    listFrames: async (pageIds: string[]) => [...canvas].filter(([, f]) => pageIds.includes(f.pageId))
      .map(([nodeId, f]) => ({ nodeId, pageId: f.pageId, name: f.name, width: 1920, height: 1080, screenTag: f.tag, fingerprint: null, error: null })),
    screenFeatures: async (nodeId: string) => {
      const f = canvas.get(nodeId);
      return f ? { fingerprint: f.fp, tokens: tokens(f.body, f.content), error: null } : { fingerprint: null, tokens: null, error: 'missing' };
    },
    tagSource: async (nodeId: string, screenId: string) => { canvas.get(nodeId)!.tag = screenId; },
    renameSource: async (nodeId: string, name: string) => { canvas.get(nodeId)!.name = name; },
  } as unknown as Host;
  const controller = new Controller(host);
  await controller.handle({ type: 'ready' });
  const lastMessage = () => posted.filter(m => m.type !== 'busy').pop();

  // 범위에 있는 페이지는 새 버전 페이지로 고를 수 없다.
  await controller.handle({ type: 'matchVersion', pageId: OLD });
  assert.equal(lastMessage()?.type, 'error');
  // 비교하지 않고 전환할 수 없다.
  await controller.handle({ type: 'switchVersion', pageId: NEW, links: [] });
  assert.equal(lastMessage()?.type, 'error');

  await controller.handle({ type: 'matchVersion', pageId: NEW });
  const match = (posted.filter(m => m.type === 'versionMatch').pop() as Extract<ToUi, { type: 'versionMatch' }>).match!;
  assert.deepEqual(match.links.map(l => [l.screenId, l.nodeId, l.kind]), [['a', '2:1', 'same'], ['b', '2:2', 'similar'], ['c', null, 'none']]);
  assert.deepEqual(match.frames.map(f => f.nodeId), ['2:1', '2:2', '2:3']);
  // 유사도 근거는 제안 때와 같은 점수이고, 사용자가 고른 다른 프레임도 같은 규칙으로 계산한다.
  const detail = async (screenId: string, nodeId: string) => {
    await controller.handle({ type: 'versionDetail', pageId: NEW, screenId, nodeId });
    return (posted.filter(m => m.type === 'versionDetail').pop() as Extract<ToUi, { type: 'versionDetail' }>).evidence;
  };
  assert.equal((await detail('b', '2:2'))!.score, match.links[1].score);
  assert.deepEqual([(await detail('b', '2:2'))!.onlySource, (await detail('b', '2:2'))!.onlyFrame], [['v1'], ['v2']]);
  assert.ok((await detail('b', '2:3'))!.score < 0.5);
  assert.equal(await detail('b', '9:9'), null);
  // 비교만으로는 기록이 바뀌지 않는다.
  store.reload();
  assert.equal(store.state.screens.get('a')!.source!.nodeId, '1:1');

  await controller.handle({ type: 'switchVersion', pageId: NEW, links: [{ screenId: 'a', nodeId: '2:1' }, { screenId: 'b', nodeId: '2:2' }] });
  store.reload();
  assert.deepEqual(['a', 'b', 'c'].map(id => store.state.screens.get(id)!.source), [{ nodeId: '2:1', pageId: NEW }, { nodeId: '2:2', pageId: NEW }, { nodeId: '1:3', pageId: OLD }]);
  // 버전은 만들지 않는다.
  assert.deepEqual(['a', 'b'].map(id => [store.state.screens.get(id)!.guiVersion, store.state.gui.get(id)!.length]), [[1, 1], [1, 1]]);
  assert.deepEqual(store.state.project.scopePageIds, [NEW]);
  assert.ok(store.state.audit.some(e => e.action === 'screen.relink' && e.target === 'a'));
  // 연결한 프레임은 표식만 갖고 이름은 그대로다(2026-10-21 사용자 결정). 기존 페이지는 바뀌지 않는다.
  assert.deepEqual([canvas.get('2:1')!.name, canvas.get('2:1')!.tag, canvas.get('2:3')!.name, canvas.get('1:1')!.name],
    ['Frame 1', 'a', 'Frame 3', '[STB_HO_001] 화면 STB_HO_001']);
  // 다시 비교하지 않아도 목록이 분류되어 있다.
  assert.ok(controller.checkedAt);
  const byKey = new Map(controller.entries.map(e => [e.key, e.estimate]));
  assert.deepEqual([byKey.get('a'), byKey.get('b'), byKey.get('c'), byKey.get('node:2:3')], ['unchanged', 'changed', 'missing', 'new']);
  const notice = posted.filter(m => m.type === 'notice').pop() as Extract<ToUi, { type: 'notice' }>;
  assert.match(notice.message, /변경사항 없음 1 · 변경 감지 1 · 신규 1 · 삭제 후보 1/);
  assert.ok(posted.some(m => m.type === 'versionSwitched'));
  // 한 번 전환한 비교 결과로는 다시 전환할 수 없다.
  await controller.handle({ type: 'switchVersion', pageId: NEW, links: [] });
  assert.equal(lastMessage()?.type, 'error');
});

test('프레임 이름이 기존 원본과 같으면(양쪽에서 한 번만 쓰인 이름) 유사도가 낮아도 먼저 연결하고, 같은 지문이 여럿이면 이름이 같은 프레임을 고른다', () => {
  const store = seeded();
  const sources = new Map([['a', tokens('A')], ['b', tokens('B')], ['c', tokens('C')]]);
  // B는 크게 고쳐 내용이 거의 다르지만 이름이 같다. C의 이름 「Frame」은 새 페이지에 둘이라 단서로 쓰지 않는다.
  const frames = [
    frame('2:1', '홈 메인', 'fp-x', 'A'),
    frame('2:2', '앱 목록', 'fp-y', 'B-redesign'),
    frame('2:3', 'Frame', 'fp-z', 'Z'),
    frame('2:4', 'Frame', 'fp-w', 'W'),
  ];
  const names = new Map([['a', '홈 메인'], ['b', '앱 목록'], ['c', 'Frame']]);
  const links = matchVersion(store.state, frames, sources, names);
  assert.deepEqual(links.map(l => [l.code, l.nodeId, l.kind]), [
    ['STB_HO_001', '2:1', 'similar'], ['STB_HO_002', '2:2', 'similar'], ['STB_HO_003', null, 'none'],
  ]);
  assert.ok(links[1].score < 0.5);
  assert.equal(links[1].sourceName, '앱 목록');

  // 지난 배포와 지문이 같은 프레임이 둘이면 이름이 같은 쪽을 고른다.
  const twins = [frame('3:1', '다른 이름', 'fp-a', 'A'), frame('3:2', '홈 메인', 'fp-a', 'A')];
  assert.equal(matchVersion(store.state, twins, sources, names).find(l => l.screenId === 'a')!.nodeId, '3:2');
});

test('지문 2 규칙은 복사로 흔들린 소수점 위치를 흡수하고, 색 차이는 그대로 구분한다', () => {
  const snap = (x: number, r = 0.5): NodeSnapshot => ({ type: 'FRAME', props: { width: 1920, height: 1080 }, children: [
    { type: 'RECTANGLE', props: { x, y: 20, width: 100.0002, height: 50, fills: [{ type: 'SOLID', color: { r, g: 0, b: 0 } }] } },
  ] });
  assert.equal(fingerprint(snap(130.0004)), fingerprint(snap(130.0011)));
  assert.notEqual(legacyFingerprint(snap(130.0004)), legacyFingerprint(snap(130.0011)));
  assert.notEqual(fingerprint(snap(130)), fingerprint(snap(131)));
  assert.notEqual(fingerprint(snap(130, 0.5)), fingerprint(snap(130, 0.502)));
});

test('1 규칙 비교 기준은 1 규칙 지문으로 비교하고, 원본이 같으면 2 규칙 기준으로 옮긴다', () => {
  const store = seeded();
  register(store, 'd', 'STB_HO_004', 'legacy-d', '1:4', 1);
  store.reload();
  const frame = (legacy: string | null) => ({ nodeId: '1:4', pageId: OLD, name: '[STB_HO_004] 화면 STB_HO_004', width: 1920, height: 1080, screenTag: 'd', fingerprint: 'v2-d', legacyFingerprint: legacy, error: null });
  const estimate = (legacy: string | null) => classify(store.state, [frame(legacy)]).find(e => e.screenId === 'd')!.estimate;
  assert.equal(estimate('legacy-d'), 'unchanged');
  assert.equal(estimate('legacy-other'), 'changed');
  // 원본이 기준과 다르면 옮기지 않는다.
  assert.equal(upgradeBaseline(store, 'd', 'legacy-other', 'v2-d', actor), false);
  assert.equal(upgradeBaseline(store, 'd', 'legacy-d', 'v2-d', actor), true);
  store.reload();
  const base = baseline(store.state, store.state.screens.get('d')!)!;
  assert.deepEqual([base.fingerprint, base.fpVersion], ['v2-d', FINGERPRINT_VERSION]);
  // 옮긴 뒤에는 2 규칙 지문으로 비교하고 다시 옮기지 않는다.
  assert.equal(estimate(null), 'unchanged');
  assert.equal(upgradeBaseline(store, 'd', 'legacy-d', 'v2-d', actor), false);
});

test('GUI 전체 확인은 작업용 판독기를 공유하고 구형 기준 화면에만 구형 지문을 요청한다', async () => {
  const store = seeded();
  register(store, 'd', 'STB_HO_004', 'legacy-d', '1:4', 1);
  const calls: [string, boolean | undefined][] = [];
  let readers = 0;
  const host = {
    kv: store.kv, mode: 'GUI', actor, post: () => {}, pages: () => [{ id: OLD, name: '원본' }],
    listFrames: async () => [...store.state.screens.values()].map(screen => ({
      nodeId: screen.source!.nodeId, pageId: OLD, name: screen.name, width: 1920, height: 1080,
      screenTag: screen.id, fingerprint: null, error: null,
    })),
    createFingerprintReader: () => {
      readers++;
      return {
        fingerprint: async (id: string, includeLegacy?: boolean) => {
          calls.push([id, includeLegacy]);
          return { fingerprint: `fp-${id}`, ...(includeLegacy ? { legacyFingerprint: 'legacy-d' } : {}), error: null };
        },
        screenFeatures: async () => ({ fingerprint: null, tokens: null, error: null }),
      };
    },
  } as unknown as Host;
  const controller = new Controller(host);
  await controller.handle({ type: 'ready' });
  await controller.handle({ type: 'scan' });
  assert.equal(readers, 1);
  assert.deepEqual(calls, [['1:1', false], ['1:2', false], ['1:3', false], ['1:4', true]]);
});

test('새 버전 비교는 원본이 1 규칙 기준과 같으면 기준을 옮겨, 붙여 넣으며 소수점이 흔들린 프레임도 동일로 연결한다', async () => {
  const store = seeded();
  register(store, 'a', 'STB_HO_001', 'legacy-a', '1:1', 1);
  store.reload();
  // 붙여 넣은 2:1은 1 규칙 지문이 원본과 다르지만(소수점 흔들림) 2 규칙 지문은 같다.
  const features = new Map([
    ['1:1', { fingerprint: 'v2-a', legacyFingerprint: 'legacy-a' }],
    ['2:1', { fingerprint: 'v2-a', legacyFingerprint: 'legacy-a-drift' }],
  ]);
  const posted: ToUi[] = [];
  const host = {
    kv: store.kv, mode: 'GUI', actor, post: (m: ToUi) => posted.push(m),
    pages: () => [{ id: OLD, name: '원본' }, { id: NEW, name: '새 버전' }],
    listFrames: async (pageIds: string[]) => pageIds.includes(NEW)
      ? [{ nodeId: '2:1', pageId: NEW, name: 'Frame 1', width: 1920, height: 1080, screenTag: null, fingerprint: null, error: null }] : [],
    screenFeatures: async (nodeId: string) => {
      const f = features.get(nodeId);
      return f ? { ...f, tokens: tokens('A'), error: null } : { fingerprint: null, tokens: null, error: 'missing' };
    },
  } as unknown as Host;
  const controller = new Controller(host);
  await controller.handle({ type: 'ready' });
  await controller.handle({ type: 'matchVersion', pageId: NEW });
  const match = (posted.filter(m => m.type === 'versionMatch').pop() as Extract<ToUi, { type: 'versionMatch' }>).match!;
  assert.equal(match.links.find(l => l.screenId === 'a')!.kind, 'same');
  store.reload();
  assert.equal(store.state.screens.get('a')!.ack!.fpVersion, FINGERPRINT_VERSION);
});
