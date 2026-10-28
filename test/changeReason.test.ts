import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changeDigest, digestFingerprint } from '../src/core/changeDigest.ts';
import { classify, type Entry } from '../src/core/compare.ts';
import { COPY } from '../src/core/copy.ts';
import { defaultDraft } from '../src/core/drafts.ts';
import { FINGERPRINT_VERSION, fingerprint, type NodeSnapshot } from '../src/core/fingerprint.ts';
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

function seeded(baseline: string) {
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
    screenId: 'a', version: 1, batchId: 'b1', workType: 'new', fingerprint: baseline, fpVersion: FINGERPRINT_VERSION, thumb: null, width: 1920, height: 1080,
    code: 'STB_HO_001', name: '홈', category: null, base: null, tag: { id: 't', name: '추가', color: '#000', colorKey: 'Gray' },
    description: '', worker: { id: 'w', name: 'Designer' }, actor, committedAt: 1000, extra: {}, corrections: [],
  } satisfies GuiRecord);
  store.reload();
  return store;
}

// 실제 근거 계산(changeDigest)을 쓰는 가짜 원본 하나
function setup(initial = snapshot()) {
  const store = seeded(fingerprint(initial));
  const canvas = { snap: initial };
  const posted: ToUi[] = [];
  const selected: string[][] = [];
  const revealed: string[] = [];
  const host = {
    kv: store.kv, mode: 'GUI', actor, post: (m: ToUi) => posted.push(m), pages: () => [{ id: PAGE, name: '원본' }],
    listFrames: async () => [{ nodeId: '1:1', pageId: PAGE, name: 'Frame 1', width: 1920, height: 1080, screenTag: 'a', fingerprint: null, error: null }],
    fingerprint: async (_id: string, _legacy?: boolean, digest?: Parameters<typeof changeDigest>[1]) => {
      const fp = fingerprint(canvas.snap);
      return { fingerprint: fp, ...changeDigest(fp, digest, () => canvas.snap), error: null };
    },
    selectNodes: async (ids: string[]) => { selected.push(ids); },
    reveal: async (nodeId: string) => { revealed.push(nodeId); return nodeId !== 'gone'; },
    makeThumbnail: async () => ({ hash: 'h', width: 480, height: 270 }),
    placeThumbnails: async () => {},
    tagSource: async () => {},
    listFlipbooks: async () => new Map(),
    inspectFlipbooks: async () => ({ found: new Map(), spots: {} }),
    ensureDataPage: async () => 'data',
    renderData: async () => {},
  } as unknown as Host;
  const controller = new Controller(host);
  const entry = (): Entry => (posted.filter((m): m is Extract<ToUi, { type: 'entries' }> => m.type === 'entries').pop()!.entries.find(e => e.screenId === 'a')!);
  return { store, canvas, posted, selected, revealed, controller, entry };
}

test('변경 근거: 변경사항 없는 화면은 첫 확인 때 근거를 채우고, 기록 로드에서는 읽지 않는다', async () => {
  const { store, controller, entry } = setup();
  assert.equal(store.kv.get(keys.digest('a')), '');
  await controller.handle({ type: 'scan' });
  assert.equal(entry().estimate, 'unchanged');
  assert.equal(digestFingerprint(store.kv.get(keys.digest('a'))), store.state.gui.get('a')![0].fingerprint);
  // 근거 키는 State에 넣지 않고, 읽기 실패로도 보지 않는다.
  store.kv.set(keys.digest('a'), 'not json');
  store.reload();
  assert.deepEqual(store.issues, []);
});

test('변경 근거: 변경 감지된 화면에 근거를 보여 주고, 변경 무시하면 그 상태가 새 근거가 된다', async () => {
  const { store, canvas, controller, entry } = setup();
  await controller.handle({ type: 'scan' });
  canvas.snap = snapshot(100.3);
  await controller.handle({ type: 'scan' });
  const changed = entry();
  assert.equal(changed.estimate, 'changed');
  const reason = changed.frame!.reason!;
  assert.equal(reason.status, 'complete');
  assert.equal(reason.visible, false);
  assert.deepEqual(reason.groups.map(g => [g.group, g.sameOnScreen, g.layers.map(l => [l.layer.path.join('/'), l.layer.nodeId])]), [['geometry', true, [['Title', '1:2']]]]);
  const html = changeReasonSection(reason);
  assert.match(html, new RegExp(COPY.uiApp362));
  assert.match(html, /data-action="reason-layer" data-node="1:2"/);

  await controller.handle({ type: 'ignoreChanges', entryKeys: [changed.key] });
  assert.equal(entry().estimate, 'unchanged');
  assert.equal(entry().frame!.reason, undefined);
  assert.equal(digestFingerprint(store.kv.get(keys.digest('a'))), fingerprint(snapshot(100.3)));

  // 다음 변경은 변경 무시한 상태와 비교한다.
  canvas.snap = snapshot(100.3, '홈 화면');
  await controller.handle({ type: 'scan' });
  assert.deepEqual(entry().frame!.reason!.groups.map(g => g.group), ['text']);
  assert.equal(entry().frame!.reason!.visible, true);
});

test('변경 근거: 근거가 없는 비교 기준은 「근거 기록 없음」이고, 사용 안 함이 된 화면의 근거는 지운다', async () => {
  const { store, canvas, controller, entry } = setup();
  store.kv.set(keys.digest('gone'), '{}');
  canvas.snap = snapshot(300);
  await controller.handle({ type: 'scan' });
  assert.equal(entry().frame!.reason!.status, 'no-record');
  assert.match(changeReasonSection(entry().frame!.reason), new RegExp(COPY.uiApp386.slice(0, 10)));
  assert.equal(store.kv.get(keys.digest('gone')), '');
});

test('변경 근거: 배포 확정은 확정한 지문과 같은 상태의 근거를 기록한다', async () => {
  const { store, canvas, posted, controller, entry } = setup();
  canvas.snap = snapshot(400);
  await controller.handle({ type: 'scan' });
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

test('변경 근거: 레이어를 누르면 캔버스에서 선택하고 화면을 맞추며, 없으면 알린다', async () => {
  const { posted, selected, revealed, controller } = setup();
  await controller.handle({ type: 'revealNode', nav: 1, nodeId: '1:2', select: true });
  await controller.handle({ type: 'revealNode', nav: 2, nodeId: 'gone', select: true });
  assert.deepEqual(selected, [['1:2'], ['gone']]);
  assert.deepEqual(revealed, ['1:2', 'gone']);
  const navs = posted.filter((m): m is Extract<ToUi, { type: 'nav' }> => m.type === 'nav');
  assert.deepEqual(navs.map(m => [m.ok, m.message]), [[true, ''], [false, COPY.controller141]]);
});
