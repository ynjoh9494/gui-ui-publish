import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changeDigest, digestFingerprint, type ChangeReason } from '../src/core/changeDigest.ts';
import { classify, type Entry } from '../src/core/compare.ts';
import { COPY } from '../src/core/copy.ts';
import { defaultDraft } from '../src/core/drafts.ts';
import { FINGERPRINT_VERSION, LEGACY_FINGERPRINT_VERSION, fingerprint, type NodeSnapshot } from '../src/core/fingerprint.ts';
import { keys, memoryKV, Store } from '../src/core/store.ts';
import type { GuiRecord, Screen } from '../src/core/types.ts';
import type { ToUi } from '../src/core/wire.ts';
import { Controller, type Host } from '../src/controller.ts';
import { changeReasonSection } from '../src/ui/changeReason.ts';

const actor = { id: 'u', name: 'Designer' };
const PAGE = '0:1';

function snapshot(titleX = 100, title = '홈'): NodeSnapshot {
  return {
    type: 'FRAME', name: 'Frame 1', id: '1:1', props: { x: 0, y: 0, width: 1920, height: 1080, fills: [] }, children: [
      { type: 'TEXT', name: 'Title', id: '1:2', props: { visible: true, x: titleX, y: 40, width: 200, height: 40, characters: title } },
      { type: 'RECTANGLE', name: 'Background', id: '1:3', props: { visible: true, x: 0, y: 0, width: 1920, height: 1080, fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }] } },
    ],
  };
}

function seeded(baseline: string, fpVersion = FINGERPRINT_VERSION) {
  const store = new Store(memoryKV(), () => 2000, (() => { let n = 0; return () => `id${++n}`; })());
  store.saveProject({ ...store.state.project, scopePageIds: [PAGE] });
  store.put(keys.category('home'), { id: 'home', name: '홈', order: 1, active: true });
  store.put(keys.tag('t'), { id: 't', team: 'GUI', name: '변경', colorKey: 'Green', color: '#00ff00', active: true });
  store.put(keys.worker('w'), { id: 'w', name: 'Designer', alias: '', active: true });
  store.put(keys.screen('a'), {
    id: 'a', rev: 1, code: 'STB_HO_001', name: '홈', categoryId: 'home', baseScreenId: null, status: 'active',
    source: { nodeId: '1:1', pageId: PAGE }, guiVersion: 1, guiTag: null, createdAt: 1000,
  } satisfies Screen);
  store.put(keys.gui('a', 1), {
    screenId: 'a', version: 1, batchId: 'b1', workType: 'new', fingerprint: baseline, fpVersion, thumb: null, width: 1920, height: 1080,
    code: 'STB_HO_001', name: '홈', category: null, base: null, tag: { id: 't', name: '추가', color: '#000', colorKey: 'Gray' },
    description: '', worker: { id: 'w', name: 'Designer' }, actor, committedAt: 1000, extra: {}, corrections: [],
  } satisfies GuiRecord);
  store.reload();
  return store;
}

// 실제 근거 계산(changeDigest)을 쓰는 가짜 원본 하나. legacyBase를 주면 비교 기준이 그 1 규칙 지문이다.
function setup(initial = snapshot(), legacyBase?: string) {
  const store = legacyBase ? seeded(legacyBase, LEGACY_FINGERPRINT_VERSION) : seeded(fingerprint(initial));
  // gate: 확인 뒤 근거 계산(미루지 않는 근거 요청)을 이 약속이 풀릴 때까지 붙잡는다.
  const canvas: { snap: NodeSnapshot; gate: Promise<void> | null } = { snap: initial, gate: null };
  const posted: ToUi[] = [];
  const selected: string[][] = [];
  const revealed: string[] = [];
  const host = {
    kv: store.kv, mode: 'GUI', actor, post: (m: ToUi) => posted.push(m), pages: () => [{ id: PAGE, name: '원본' }],
    listFrames: async () => [{ nodeId: '1:1', pageId: PAGE, name: 'Frame 1', width: 1920, height: 1080, screenTag: 'a', fingerprint: null, error: null }],
    fingerprint: async (_id: string, legacy?: boolean, digest?: Parameters<typeof changeDigest>[1]) => {
      if (digest && !digest.defer && canvas.gate) await canvas.gate;
      const fp = fingerprint(canvas.snap);
      return { fingerprint: fp, ...(legacy ? { legacyFingerprint: `legacy:${fp}` } : {}), ...changeDigest(fp, digest, () => canvas.snap), error: null };
    },
    selectNodes: async (ids: string[]) => { selected.push(ids); },
    reveal: async (nodeId: string) => { revealed.push(nodeId); return nodeId !== 'gone'; },
    makeThumbnail: async () => ({ hash: 'h', width: 480, height: 270 }),
    placeThumbnails: async () => {},
    tagSource: async () => {},
    listFlipbooks: async () => new Map(),
    inspectFlipbooks: async () => ({ found: new Map(), spots: {} }),
  } as unknown as Host;
  const controller = new Controller(host);
  // UI처럼 마지막 목록에 그 뒤에 온 변경 근거를 붙인다.
  const entry = (): Entry => {
    const at = posted.map(m => m.type).lastIndexOf('entries');
    const listed = (posted[at] as Extract<ToUi, { type: 'entries' }>).entries.find(e => e.screenId === 'a')!;
    let frame = listed.frame;
    for (const m of posted.slice(at + 1)) {
      if (m.type === 'changeReason' && frame && m.nodeId === frame.nodeId && m.fingerprint === frame.fingerprint) frame = { ...frame, reason: m.reason, reasonPending: undefined };
    }
    return { ...listed, frame };
  };
  // 변경사항 확인과 그 뒤의 근거 계산까지
  const scan = async () => { await controller.handle({ type: 'scan' }); await controller.reasonsSettled(); };
  return { store, canvas, posted, selected, revealed, controller, entry, scan };
}

test('변경 근거: 변경사항 없는 화면은 첫 확인 때 근거를 채우고, 기록 로드에서는 읽지 않는다', async () => {
  const { store, controller, scan, entry } = setup();
  assert.equal(store.kv.get(keys.digest('a')), '');
  await scan();
  assert.equal(entry().estimate, 'unchanged');
  assert.equal(digestFingerprint(store.kv.get(keys.digest('a'))), store.state.gui.get('a')![0].fingerprint);
  // 근거 키는 State에 넣지 않고, 읽기 실패로도 보지 않는다.
  store.kv.set(keys.digest('a'), 'not json');
  store.reload();
  assert.deepEqual(store.issues, []);
});

test('변경 근거: 변경 감지된 화면에 근거를 보여 주고, 변경 무시하면 그 상태가 새 근거가 된다', async () => {
  const { store, canvas, controller, scan, entry } = setup();
  await scan();
  canvas.snap = snapshot(100.3);
  await scan();
  const changed = entry();
  assert.equal(changed.estimate, 'changed');
  const reason = changed.frame!.reason!;
  assert.equal(reason.status, 'complete');
  assert.equal(reason.visible, false);
  assert.deepEqual(reason.groups.map(g => [g.group, g.sameOnScreen, g.layers.map(l => [l.layer.path.join('/'), l.layer.nodeId])]), [['geometry', true, [['Title', '1:2']]]]);
  // 보이는 값이 같은 변경은 「전체 보기」를 눌러야 보인다.
  const closed = changeReasonSection(reason);
  assert.ok(closed.includes(COPY.uiApp362) && closed.includes(COPY.uiApp388));
  assert.doesNotMatch(closed, /data-node="1:2"/);
  assert.ok(changeReasonSection(reason, 10).includes(`data-node="1:2" title="Title"><span>${COPY.uiApp365}</span><span class="reason-path">Title</span><span class="reason-why">(${COPY.uiApp374})</span>`));

  await controller.handle({ type: 'ignoreChanges', entryKeys: [changed.key] });
  assert.equal(entry().estimate, 'unchanged');
  assert.equal(entry().frame!.reason, undefined);
  assert.equal(digestFingerprint(store.kv.get(keys.digest('a'))), fingerprint(snapshot(100.3)));

  // 다음 변경은 변경 무시한 상태와 비교한다.
  canvas.snap = snapshot(100.3, '홈 화면');
  await scan();
  assert.deepEqual(entry().frame!.reason!.groups.map(g => g.group), ['text']);
  assert.equal(entry().frame!.reason!.visible, true);
});

test('변경 근거: 근거가 없는 비교 기준은 「근거 기록 없음」이고, 사용 안 함이 된 화면의 근거만 지운다', async () => {
  const { store, canvas, controller, scan, entry } = setup();
  store.put(keys.screen('old'), { ...store.state.screens.get('a')!, id: 'old', code: 'STB_HO_002', status: 'deleted', source: null });
  store.reload();
  store.kv.set(keys.digest('old'), '{}');
  // 기록에 아직 없는 화면(확인하는 동안 다른 작업자가 배포한 화면)의 근거는 그대로 둔다.
  store.kv.set(keys.digest('new'), '{}');
  canvas.snap = snapshot(300);
  await scan();
  assert.equal(entry().frame!.reason!.status, 'no-record');
  assert.match(changeReasonSection(entry().frame!.reason), new RegExp(COPY.uiApp386.slice(0, 10)));
  assert.equal(store.kv.get(keys.digest('old')), '');
  assert.equal(store.kv.get(keys.digest('new')), '{}');
});

test('변경 근거: 1 규칙 비교 기준과 다른 화면도 「근거 기록 없음」이다', async () => {
  const { controller, scan, entry } = setup(snapshot(), 'legacy-base');
  await scan();
  assert.equal(entry().estimate, 'changed');
  assert.equal(entry().frame!.reason!.status, 'no-record');
});

test('변경 근거: 같은 상태를 다시 확인하면 지난 근거를 다시 쓰고, 레이어 이름이 바뀌면 다시 계산한다', async () => {
  const { canvas, controller, scan, entry } = setup();
  await scan();
  canvas.snap = snapshot(100.3);
  await scan();
  const first = entry().frame!.reason!;
  await scan();
  assert.equal(entry().frame!.reason, first, '지문과 레이어 이름·ID가 같으면 계산하지 않는다');
  const renamed = snapshot(100.3);
  renamed.children![1].name = 'Backdrop';
  canvas.snap = renamed;
  await scan();
  const again = entry().frame!.reason!;
  assert.notEqual(again, first);
  assert.deepEqual(again.renamed.map(l => l.path.join('/')), ['Backdrop']);
  assert.deepEqual(again.groups.find(g => g.group === 'geometry')?.layers.map(l => l.layer.path.join('/')), ['Title']);
});

function held(canvas: { gate: Promise<void> | null }): () => void {
  let release!: () => void;
  canvas.gate = new Promise<void>(resolve => { release = resolve; });
  return () => { canvas.gate = null; release(); };
}

test('변경 근거: 확인은 지문 비교로 끝내고, 근거는 목록을 보낸 뒤 계산한다', async () => {
  const { store, canvas, posted, controller, scan, entry } = setup();
  await scan();
  canvas.snap = snapshot(100.3);
  const release = held(canvas);
  await controller.handle({ type: 'scan' });
  const done = posted.map(m => m.type === 'scanStatus' && m.status === 'done').lastIndexOf(true);
  assert.ok(done >= 0);
  assert.equal(entry().estimate, 'changed');
  assert.equal(entry().frame!.reasonPending, true);
  assert.equal(entry().frame!.reason, undefined);
  // 상세에서 고른 화면을 먼저 계산하라는 요청은 받기만 한다.
  await controller.handle({ type: 'needReason', nodeId: '1:1' });
  release();
  await controller.reasonsSettled();
  assert.ok(posted.slice(done).some(m => m.type === 'changeReason'));
  assert.equal(entry().frame!.reason!.status, 'complete');
  assert.deepEqual(entry().frame!.reason!.groups.map(g => g.group), ['geometry']);
  // 변경 감지된 화면의 근거는 기록하지 않는다(변경 무시·배포 때 기록한다).
  assert.equal(digestFingerprint(store.kv.get(keys.digest('a'))), fingerprint(snapshot()));
});

test('변경 근거: 근거 채우기도 확인 뒤에 한다', async () => {
  const { store, canvas, controller, entry } = setup();
  const release = held(canvas);
  await controller.handle({ type: 'scan' });
  assert.equal(entry().estimate, 'unchanged');
  assert.equal(entry().frame!.reasonPending, undefined);
  assert.equal(store.kv.get(keys.digest('a')), '');
  release();
  await controller.reasonsSettled();
  assert.equal(digestFingerprint(store.kv.get(keys.digest('a'))), fingerprint(snapshot()));
});

test('변경 근거: 확인 뒤 화면이 바뀌면 바뀐 레이어를 찾지 못한 것으로 보여 준다', async () => {
  const { store, canvas, controller, scan, entry } = setup();
  await scan();
  canvas.snap = snapshot(300);
  const release = held(canvas);
  await controller.handle({ type: 'scan' });
  canvas.snap = snapshot(500);
  release();
  await controller.reasonsSettled();
  assert.equal(entry().frame!.reason!.status, 'unknown');
  assert.equal(digestFingerprint(store.kv.get(keys.digest('a'))), fingerprint(snapshot()));
});

test('변경 근거: 근거를 계산하기 전에 변경 무시하면 그때 계산해 기록한다', async () => {
  const { store, canvas, controller, scan, entry } = setup();
  await scan();
  canvas.snap = snapshot(100.3);
  const release = held(canvas);
  await controller.handle({ type: 'scan' });
  const key = entry().key;
  const ignoring = controller.handle({ type: 'ignoreChanges', entryKeys: [key] });
  release();
  await ignoring;
  await controller.reasonsSettled();
  assert.equal(entry().estimate, 'unchanged');
  assert.equal(entry().frame!.reasonPending, undefined);
  assert.equal(digestFingerprint(store.kv.get(keys.digest('a'))), fingerprint(snapshot(100.3)));
});

test('변경 근거: 배포 확정은 확정한 지문과 같은 상태의 근거를 기록한다', async () => {
  const { store, canvas, posted, controller, scan, entry } = setup();
  canvas.snap = snapshot(400);
  await scan();
  const changed = entry();
  const [classified] = classify(controller.store.state, [changed.frame!]);
  await controller.handle({ type: 'prepare', team: 'GUI', drafts: { [changed.key]: { ...defaultDraft('GUI', controller.store.state, classified), included: true, tagId: 't' } } });
  const plan = posted.find((m): m is Extract<ToUi, { type: 'plan' }> => m.type === 'plan')?.plan;
  assert.ok(plan && !plan.blockers.length, JSON.stringify(plan?.blockers));
  await controller.handle({ type: 'commit', batchId: plan.batchId });
  assert.deepEqual(posted.filter(m => m.type === 'error'), []);
  store.reload();
  assert.equal(store.state.screens.get('a')!.guiVersion, 2);
  assert.equal(digestFingerprint(store.kv.get(keys.digest('a'))), fingerprint(snapshot(400)));
});

test('화면 반영 건너뛰기: 지난 썸네일을 그대로 쓰고 썸네일 이름만 맞추며, 지난 썸네일이 없거나 끄면 썸네일을 만든다', async () => {
  const old = { hash: 'old', width: 480, height: 270 };
  for (const [skip, previousThumb, expectMade] of [[true, old, false], [true, null, true], [false, old, true]] as const) {
    const { store, posted, controller, scan, entry } = setup();
    store.put(keys.gui('a', 1), { ...store.state.gui.get('a')![0], thumb: previousThumb });
    store.reload();
    const made: string[] = [];
    const placed: string[] = [];
    const renamed: [string, string][] = [];
    const host = (controller as unknown as { host: Host }).host as unknown as Record<string, unknown>;
    host.makeThumbnail = async (nodeId: string) => { made.push(nodeId); return { hash: 'new', width: 480, height: 270 }; };
    host.placeThumbnails = async (updates: { screenId: string }[]) => { placed.push(...updates.map(u => u.screenId)); };
    host.renameThumbnails = async (labels: Map<string, string>) => { renamed.push(...labels); };
    await scan();
    const listed = entry();
    assert.equal(listed.estimate, 'unchanged');
    const [classified] = classify(controller.store.state, [listed.frame!]);
    await controller.handle({ type: 'prepare', team: 'GUI', drafts: { [listed.key]: { ...defaultDraft('GUI', controller.store.state, classified), included: true, tagId: 't', name: '홈 2' } } });
    const plan = posted.find((m): m is Extract<ToUi, { type: 'plan' }> => m.type === 'plan')?.plan;
    assert.ok(plan && !plan.blockers.length && plan.layersUnchanged, JSON.stringify(plan?.blockers));
    await controller.handle({ type: 'commit', batchId: plan.batchId, skipLayers: skip });
    assert.deepEqual(posted.filter(m => m.type === 'error'), []);
    store.reload();
    const record = store.state.gui.get('a')!.find(r => r.version === 2)!;
    assert.equal(made.length, expectMade ? 1 : 0);
    assert.deepEqual(placed, expectMade ? ['a'] : []);
    assert.deepEqual(renamed, expectMade ? [] : [['a', '[STB_HO_001] 홈 2']]);
    assert.equal(record.thumb?.hash, expectMade ? 'new' : 'old');
  }
});

test('변경 근거: 레이어를 누르면 캔버스에서 선택하고 화면을 맞추며, 없으면 알린다', async () => {
  const { posted, selected, revealed, controller } = setup();
  await controller.handle({ type: 'revealNode', nav: 1, nodeId: '1:2', select: true });
  await controller.handle({ type: 'revealNode', nav: 2, nodeId: 'gone', select: true });
  assert.deepEqual(selected, [['1:2'], ['gone']]);
  assert.deepEqual(revealed, ['1:2', 'gone']);
  const navs = posted.filter((m): m is Extract<ToUi, { type: 'nav' }> => m.type === 'nav');
  assert.deepEqual(navs.map(m => [m.ok, m.message]), [[true, ''], [false, COPY.controller141]]);
});

test('변경 사항: 보이는 차이는 바로, 보이는 값이 같은 변경은 전체 보기 뒤에 10개씩 보여 주고 다 펼치면 숨기기', () => {
  const layer = (name: string) => ({ layer: { path: ['Menu', name], nodeId: `n:${name}` } });
  const reason: ChangeReason = {
    status: 'complete', visible: true, added: [], renamed: [], removed: 1,
    groups: [
      { group: 'text', sameOnScreen: null, layers: [layer('Title')] },
      { group: 'geometry', sameOnScreen: false, layers: [{ ...layer('Logo'), sameOnScreen: false }, ...Array.from({ length: 23 }, (_, i) => ({ ...layer(`Row ${i + 1}`), sameOnScreen: true }))] },
    ],
  };
  const rows = (html: string) => [...html.matchAll(/class="reason-lines( quiet)?">(.*?)<\/ul>/g)].map(m => [m[1] ? 'quiet' : 'main', (m[2].match(/<li>/g) ?? []).length]);
  const more = (html: string) => html.match(/data-action="reason-(?:more|less)">([^<]*)</)?.[1] ?? null;
  const first = changeReasonSection(reason);
  assert.deepEqual(rows(first), [['main', 3]], '텍스트 내용·보이는 위치 변경·삭제된 레이어');
  assert.equal(more(first), COPY.uiApp388);
  assert.ok(!first.includes(COPY.uiApp362), '보이는 차이가 있으면 「화면에 보이는 모습은 같습니다」를 보여 주지 않는다');
  assert.deepEqual(rows(changeReasonSection(reason, 10)), [['main', 3], ['quiet', 10]]);
  assert.equal(more(changeReasonSection(reason, 10)), `10${COPY.uiApp389}`);
  assert.equal(more(changeReasonSection(reason, 20)), `3${COPY.uiApp389}`);
  // 다 펼치면 「숨기기」로 다시 접는다.
  assert.deepEqual([rows(changeReasonSection(reason, 30)), more(changeReasonSection(reason, 30))], [[['main', 3], ['quiet', 23]], COPY.uiApp390]);
  assert.match(changeReasonSection(reason, 30), /data-action="reason-less"/);
  assert.ok(changeReasonSection(reason, 10).includes(`(${COPY.uiApp374})`));
});
