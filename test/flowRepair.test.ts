import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FlowRepairController } from '../src/flowRepairController.ts';
import { selectedFlowRepairImages, restoreFlowImage, flowRepairCells } from '../src/figma/flowRepair.ts';
import { FLOW_REPAIR_COPY as COPY } from '../src/core/flowRepairCopy.ts';
import { keys, memoryKV, Store } from '../src/core/store.ts';
import type { Host } from '../src/host.ts';
import type { ToUi } from '../src/core/wire.ts';
import type { FlowRepairImage } from '../src/core/flowRepair.ts';
import type { FlowThumb, FoundFlowCell } from '../src/core/flow.ts';
import type { Screen, GuiRecord } from '../src/core/types.ts';

const actor = { id: 'u', name: 'User' };
const image = (nodeId: string, uid = '', flowId = ''): FlowRepairImage => ({ nodeId, uid, flowId, pageId: 'p', name: nodeId, stamp: 'original' });
function fixture() {
  const store = new Store(memoryKV());
  for (const id of ['s1', 's2', 'gone']) {
    const screen: Screen = { id, rev: 1, code: id, name: id, categoryId: null, baseScreenId: null, status: id === 'gone' ? 'deleted' : 'active', source: null, guiVersion: 2, guiTag: null, createdAt: 1 };
    store.put(keys.screen(id), screen);
    const record: GuiRecord = { screenId: id, version: 2, batchId: 'b', workType: 'changed', fingerprint: null, thumb: { hash: id, width: 480, height: 270 }, width: 1920, height: 1080, code: id, name: id, category: null, base: null, tag: { id: 't', name: 'T', color: '#000', colorKey: 'k' }, description: '', worker: actor, actor, committedAt: 2, extra: {}, corrections: [] };
    store.put(keys.gui(id, 2), record);
  }
  const posted: ToUi[] = [], restored: string[] = [], cells: FoundFlowCell[] = [];
  const host = { actor, post: (m: ToUi) => posted.push(m),
    selectedFlowRepairImages: async () => [image('a', 's1', 'f'), image('b'), image('c', 'gone')],
    flowRepairCells: async () => cells,
    restoreFlowImage: async (item: FlowRepairImage, uid: string, flowId: string, _thumb: FlowThumb, current: () => boolean) => {
      assert.ok(current()); restored.push(item.nodeId);
      cells.push({ nodeId: item.nodeId, uid, flowId, pageId: 'p', rootId: null, title: null });
    },
  } as unknown as Host;
  const controller = new FlowRepairController(host, store);
  const scan = () => { const m = [...posted].reverse().find(m => m.type === 'flowRepairCandidates'); assert.ok(m?.type === 'flowRepairCandidates'); return m; };
  return { store, host, controller, restored, posted, scan, cells };
}

test('복구 확인은 유효한 표식만 자동 배정하고 파일 기록을 변경하지 않는다', async () => {
  const f = fixture();
  await f.controller.find();
  assert.deepEqual(f.scan().candidates.map(c => c.assignedUid), ['s1', null, null]);
  assert.equal(f.store.state.flows.size, 0);
  assert.deepEqual(f.restored, []);
});
test('복구는 기존 플로우를 살리고 수동 선택 이미지를 새 플로우로 기록하며 다시 실행해도 중복하지 않는다', async () => {
  const f = fixture(); await f.controller.find();
  const assignments = [{ nodeId: 'a', uid: 's1' }, { nodeId: 'b', uid: 's2' }, { nodeId: 'c', uid: 's2' }];
  const result = await f.controller.restore(f.scan().token, assignments);
  assert.deepEqual(result.restored, ['a', 'b', 'c']);
  assert.equal(f.store.state.flows.size, 2);
  assert.deepEqual(f.store.state.flows.get('f')?.uids, ['s1']);
  const before = f.store.state.flows.size;
  assert.equal((await f.controller.restore(f.scan().token, assignments)).restored.length, 0);
  assert.equal(f.store.state.flows.size, before);
});
test('오래된 확인 결과와 임의 노드는 거절하고 썸네일 없는 화면은 기존 이미지를 보존한다', async () => {
  const f = fixture(); await f.controller.find(); const token = f.scan().token;
  await f.controller.find();
  await assert.rejects(f.controller.restore(token, [{ nodeId: 'a', uid: 's1' }]), { message: COPY.changed });
  f.store.put(keys.gui('s2', 2), { ...f.store.state.gui.get('s2')![0], thumb: null });
  const result = await f.controller.restore(f.scan().token, [{ nodeId: 'not-scanned', uid: 's1' }, { nodeId: 'b', uid: 's2' }, { nodeId: 'a', uid: 'gone' }]);
  assert.equal(result.failed.length, 3); assert.deepEqual(f.restored, []);
});
test('개별 실패는 보존하고 성공한 이미지만 기록하며 선택하지 않은 칸도 플로우 화면 목록에 유지한다', async () => {
  const f = fixture(); await f.controller.find();
  f.cells.push({ nodeId: 'other', uid: 's2', flowId: 'f', pageId: 'p', rootId: null, title: null });
  const restore = f.host.restoreFlowImage!;
  f.host.restoreFlowImage = async (...args) => { if (args[0].nodeId === 'b') throw new Error('locked'); await restore(...args); };
  const result = await f.controller.restore(f.scan().token, [{ nodeId: 'a', uid: 's1' }, { nodeId: 'b', uid: 's2' }]);
  assert.deepEqual(result.restored, ['a']); assert.equal(result.failed[0].message, 'locked');
  assert.deepEqual(new Set(f.store.state.flows.get('f')?.uids), new Set(['s1', 's2']));
});
test('부분 실패한 표식 없는 이미지의 재시도는 같은 플로우에 합쳐진다', async () => {
  const f = fixture(); await f.controller.find();
  const restore = f.host.restoreFlowImage!;
  f.host.restoreFlowImage = async (...args) => { if (args[0].nodeId === 'c') throw new Error('locked'); await restore(...args); };
  await f.controller.restore(f.scan().token, [{ nodeId: 'b', uid: 's1' }, { nodeId: 'c', uid: 's2' }]);
  assert.equal(f.store.state.flows.size, 1);
  f.host.restoreFlowImage = restore;
  await f.controller.restore(f.scan().token, [{ nodeId: 'c', uid: 's2' }]);
  assert.equal(f.store.state.flows.size, 1);
  assert.deepEqual(new Set([...f.store.state.flows.values()][0].uids), new Set(['s1', 's2']));
});

class Node {
  id: string; type: string; name = 'Image'; parent: Node | null = null; removed = false;
  fills = [{ type: 'IMAGE', imageHash: 'old', scaleMode: 'FILL' }];
  data = new Map<string, string>(); children: Node[] = []; selection: Node[] = [];
  x = 10; y = 20; width = 400; height = 225;
  constructor(id: string, type: string, parent?: Node) { this.id = id; this.type = type; if (parent) { this.parent = parent; parent.children.push(this); } }
  getSharedPluginData(_ns: string, key: string) { return this.data.get(key) ?? ''; }
  setSharedPluginData(_ns: string, key: string, value: string) { this.data.set(key, value); }
  async loadAsync() {}
  findAllWithCriteria(): Node[] { return this.children.flatMap(n => n.type === 'RECTANGLE' ? [n] : n.findAllWithCriteria()); }
}
function canvas() {
  const page = new Node('p', 'PAGE'), group = new Node('g', 'GROUP', page), rect = new Node('r', 'RECTANGLE', group), other = new Node('other', 'RECTANGLE', group);
  group.data.set('flowOf', 'f'); rect.data.set('flowScreen', 's1'); rect.data.set('flowVersion', '2');
  page.selection = [rect]; const all = [page, group, rect, other]; const images = new Set(['latest']);
  Object.assign(globalThis, { figma: { currentPage: page, root: { children: [page] }, getNodeByIdAsync: async (id: string) => all.find(n => n.id === id) ?? null, getImageByHash: (hash: string) => images.has(hash) ? {} : null } });
  return { page, group, rect, other, images };
}
const thumb: FlowThumb = { uid: 's1', code: 'ST_VP_001', name: 'Player', version: 2, thumb: { hash: 'latest', width: 480, height: 270 } };
test('실제 Host 경계: 확인은 쓰지 않고 적용은 같은 버전도 동기화하며 위치·크기·주변 칸을 보존한다', async () => {
  const w = canvas(); const items = await selectedFlowRepairImages();
  assert.equal(items[0].flowId, 'f'); assert.equal(w.rect.data.has('flowOf'), false);
  await flowRepairCells(['p']); assert.equal(w.rect.data.has('flowOf'), false);
  await restoreFlowImage(items[0], 's1', 'f', thumb, () => true);
  assert.deepEqual(w.rect.fills, [{ type: 'IMAGE', imageHash: 'latest', scaleMode: 'FIT' }]);
  assert.equal(w.rect.data.get('flowOf'), 'f'); assert.equal(w.rect.data.get('flowVersion'), '2');
  assert.equal(w.rect.name, '🔗 ST_VP_001 · Player');
  assert.deepEqual([w.rect.x, w.rect.y, w.rect.width, w.rect.height], [10, 20, 400, 225]);
  assert.equal(w.other.data.size, 0); assert.equal(w.other.fills[0].imageHash, 'old');
});
test('실제 Host 경계: 이미지 변경·배포 변경·이미지 데이터 누락 때 표식과 이미지를 보존한다', async () => {
  const w = canvas(); const [item] = await selectedFlowRepairImages();
  await assert.rejects(restoreFlowImage(item, 's1', 'f', thumb, () => false), { message: COPY.changed });
  w.images.clear();
  await assert.rejects(restoreFlowImage(item, 's1', 'f', thumb, () => true), { message: COPY.unavailable });
  w.rect.fills = [{ type: 'IMAGE', imageHash: 'edited', scaleMode: 'FILL' }];
  await assert.rejects(restoreFlowImage(item, 's1', 'f', thumb, () => true), { message: COPY.changed });
  assert.equal(w.rect.data.has('flowOf'), false); assert.equal(w.rect.fills[0].imageHash, 'edited');
});
