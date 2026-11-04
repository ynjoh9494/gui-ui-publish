import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Controller, deliveryMessage } from '../src/controller.ts';
import { COPY } from '../src/core/copy.ts';
import { Store, keys, memoryKV } from '../src/core/store.ts';
import type { Host } from '../src/host.ts';
import type { ToUi } from '../src/core/wire.ts';
import type { Flipbook } from '../src/core/types.ts';

const actor = { id: 'u', name: 'Designer' };
const book = (id: string, title: string): Flipbook => ({
  id, rev: 1, kind: 'single', title, autoTitle: true, titleNames: [title], scale: 1, category: { key: 'c', name: 'C', order: 0 },
  screens: [], pageId: 'p1', status: 'active', createdAt: 500, actor, tracked: true,
});

// 2026-11-04 사용자 요청: 연결 끊긴(프레임이 지워진) 플립북은 반영할 때 건너뛰고 실패로 세거나 알리지 않는다.
test('반영할 때 프레임이 없는 플립북은 실패로 세지 않고 알림에서도 빼며, 다른 실패는 그대로 알린다', async () => {
  const store = new Store(memoryKV());
  store.saveProject({ ...store.state.project, templateNodeId: 'tpl', flipbookPageIds: ['p1'], flipbookPageId: 'p1' });
  for (const [id, title] of [['gone', '끊긴 책'], ['ok', '정상 책'], ['bad', '폰트 책']]) store.put(keys.flipbook(id), book(id, title));
  const messages: ToUi[] = [];
  const host = {
    kv: store.kv, mode: 'UI', actor, post: (m: ToUi) => messages.push(m), pages: () => [{ id: 'p1', name: 'UI' }], templateIssues: async () => [],
    inspectFlipbooks: async () => ({ found: new Map([['ok', '1:1'], ['bad', '1:2']]), spots: {} }),
    syncFlipbook: async (_: unknown, view: { flipbookId: string }) => {
      if (view.flipbookId === 'gone') throw new Error(COPY.figmaFlipbook027);
      if (view.flipbookId === 'bad') throw new Error('font unavailable');
      return { nodeId: '1:1', notes: [], tracked: true };
    },
  } as unknown as Host;
  const controller = new Controller(host);
  const report = await controller.deliverFlipbooks({}, { targets: ['gone', 'ok', 'bad'], onlyTargets: true });
  assert.deepEqual([report.screens, report.done], [2, 1], 'the unlinked flipbook is not counted');
  assert.deepEqual(report.failed.map(f => f.name), ['폰트 책']);
  const message = deliveryMessage(report);
  assert.doesNotMatch(message, /끊긴 책|프레임이 없어/);
  assert.match(message, /폰트 책/);

  const only = await controller.deliverFlipbooks({}, { targets: ['gone'], onlyTargets: true });
  assert.deepEqual([only.screens, only.failed.length, deliveryMessage(only)], [0, 0, ''], 'nothing to report when only unlinked flipbooks were skipped');
});
