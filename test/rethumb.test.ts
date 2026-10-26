import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COPY } from '../src/core/copy.ts';
import { keys, memoryKV } from '../src/core/store.ts';
import type { AuditEntry, GuiRecord, Screen } from '../src/core/types.ts';
import type { Host } from '../src/host.ts';
import { rethumbAll } from '../src/rethumb.ts';

// 썸네일 다시 만들기(임시 명령): 비교 기준과 같은 화면만 만들고, 마지막 GUI 기록의 해시와 플로우 이미지를 바꾼다.

const actor = { id: 'u', name: 'Designer' };
const old = (id: string) => ({ hash: `old-${id}`, width: 480, height: 270 });

function screen(id: string, extra: Partial<Screen> = {}): Screen {
  return {
    id, rev: 1, code: `STB_HO_${id}`, name: `화면 ${id}`, categoryId: null, baseScreenId: null, status: 'active',
    source: { nodeId: `n-${id}`, pageId: 'p' }, guiVersion: 1, guiTag: null, createdAt: 0, ...extra,
  };
}

function record(id: string, extra: Partial<GuiRecord> = {}): GuiRecord {
  return { screenId: id, version: 1, fingerprint: `fp-${id}`, fpVersion: 2, thumb: old(id), corrections: [], ...extra } as GuiRecord;
}

function setup(options: { current?: Record<string, string>; legacy?: Record<string, string>; placeFails?: boolean; onThumb?: (nodeId: string, kv: ReturnType<typeof memoryKV>) => void } = {}) {
  const screens = [
    screen('001'),
    screen('002'),
    screen('003'),
    screen('004', { ack: { version: 1, fingerprint: 'fp-ack', fpVersion: 2, actor, at: 0 } }),
    screen('005', { status: 'deleted' }),
    screen('006', { source: null }),
  ];
  const records = [
    record('001'), record('002'), record('003', { fpVersion: undefined, fingerprint: 'legacy-003' }), record('004'), record('005'), record('006'),
  ];
  const kv = memoryKV(Object.fromEntries([
    ...screens.map(s => [keys.screen(s.id), JSON.stringify(s)]),
    ...records.map(r => [keys.gui(r.screenId, r.version), JSON.stringify(r)]),
    [keys.flow('f1'), JSON.stringify({ id: 'f1', nodeId: 'g', pageId: 'p', title: '홈 진입', uids: ['001', '002'], createdAt: 0, actor })],
  ]));
  const current: Record<string, string> = { 'n-001': 'fp-001', 'n-002': 'fp-002-edited', 'n-004': 'fp-ack', ...options.current };
  const legacy: Record<string, string> = { 'n-003': 'legacy-003', ...options.legacy };
  const placed: string[] = [];
  const flowCalls: { id: string; hashes: string[]; sameVersion?: boolean }[] = [];
  const host = {
    kv, actor,
    async fingerprint(nodeId: string, includeLegacy?: boolean) {
      return { fingerprint: current[nodeId] ?? null, legacyFingerprint: includeLegacy ? legacy[nodeId] ?? null : undefined, error: null };
    },
    async makeThumbnail(nodeId: string) {
      options.onThumb?.(nodeId, kv);
      return { hash: `new-${nodeId}`, width: 480, height: 270 };
    },
    async placeThumbnails(updates: { screenId: string }[]) {
      if (options.placeFails) throw new Error('place failed');
      placed.push(...updates.map(u => u.screenId));
    },
    async updateFlow(flow: { id: string }, thumbs: { thumb: { hash: string } }[], sameVersion?: boolean) {
      flowCalls.push({ id: flow.id, hashes: thumbs.map(t => t.thumb.hash), sameVersion });
      return 1;
    },
  } as unknown as Host;
  const gui = (id: string) => JSON.parse(kv.get(keys.gui(id, 1))) as GuiRecord;
  const audits = () => [...kv.data.entries()].filter(([k]) => k.startsWith('aud:')).map(([, v]) => JSON.parse(v) as AuditEntry);
  return { host, kv, placed, flowCalls, gui, audits };
}

const noProgress = async () => {};

test('원본이 비교 기준과 같은 화면만 다시 만들고 마지막 기록의 해시와 플로우 이미지를 바꾼다', async () => {
  const m = setup();
  const r = await rethumbAll(m.host, noProgress);
  assert.deepEqual(r.done, ['[STB_HO_001] 화면 001', '[STB_HO_003] 화면 003', '[STB_HO_004] 화면 004']);
  assert.deepEqual(r.skipped, [`[STB_HO_002] 화면 002: ${COPY.rethumb009}`, `[STB_HO_006] 화면 006: ${COPY.rethumb010}`]);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(m.placed, ['001', '003', '004']);
  // 해시만 바뀌고 버전·지문·크기는 그대로다.
  assert.deepEqual(m.gui('001'), { ...record('001'), thumb: { hash: 'new-n-001', width: 480, height: 270 } });
  assert.equal(m.gui('002').thumb?.hash, 'old-002', 'a screen edited after publish keeps its thumbnail');
  assert.equal(m.gui('005').thumb?.hash, 'old-005', 'deleted screens are left alone');
  const audits = m.audits();
  assert.deepEqual(audits.map(a => [a.action, a.target, a.before, a.after]).sort(), [
    ['gui.thumb', 'gv:001:1', 'old-001', 'new-n-001'], ['gui.thumb', 'gv:003:1', 'old-003', 'new-n-003'], ['gui.thumb', 'gv:004:1', 'old-004', 'new-n-004'],
  ]);
  // 다시 만든 화면이 든 플로우를 같은 버전으로 다시 채운다(플로우 안에서는 그 플로우의 화면 칸만 바뀐다).
  assert.deepEqual(m.flowCalls, [{ id: 'f1', hashes: ['new-n-001', 'new-n-003', 'new-n-004'], sameVersion: true }]);
  assert.equal(r.flows, 1);
});

test('썸네일 페이지에 넣지 못하면 기록을 바꾸지 않는다', async () => {
  const m = setup({ placeFails: true });
  const r = await rethumbAll(m.host, noProgress);
  assert.deepEqual(r.done, []);
  assert.deepEqual(r.errors, [`${COPY.rethumb015} place failed`]);
  assert.equal(m.gui('001').thumb?.hash, 'old-001');
  assert.deepEqual(m.audits(), []);
  assert.deepEqual(m.flowCalls, []);
});

test('실행 중에 새 버전이 배포된 화면은 덮지 않는다', async () => {
  const m = setup({
    onThumb: (nodeId, kv) => {
      if (nodeId !== 'n-001') return;
      kv.set(keys.screen('001'), JSON.stringify(screen('001', { guiVersion: 2 })));
      kv.set(keys.gui('001', 2), JSON.stringify(record('001', { version: 2, thumb: { hash: 'v2', width: 480, height: 270 } })));
    },
  });
  const r = await rethumbAll(m.host, noProgress);
  assert.ok(r.skipped.includes(`[STB_HO_001] 화면 001: ${COPY.rethumb013}`));
  assert.deepEqual(m.placed, ['003', '004']);
  assert.equal(m.gui('001').thumb?.hash, 'old-001');
});
