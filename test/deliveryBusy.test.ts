import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Controller } from '../src/controller.ts';
import { Store, keys, memoryKV } from '../src/core/store.ts';
import type { Host } from '../src/host.ts';
import type { ToUi } from '../src/core/wire.ts';
import type { Flipbook, Screen } from '../src/core/types.ts';

const actor = { id: 'u', name: 'Designer' };
for (const type of ['followFlipbook', 'refreshList', 'scanUi'] as const) {
  for (const fail of [false, true]) test(`${type}: 자동 반영 ${fail ? '실패' : '성공'} 뒤 진행 표시와 조작 잠금을 해제한다`, async () => {
    const store = new Store(memoryKV());
    store.saveProject({ ...store.state.project, templateNodeId: 'tpl', flipbookPageIds: ['p1'], flipbookPageId: 'p1' });
    store.put(keys.screen('s1'), { id: 's1', rev: 1, code: 'S1', name: 'Screen', categoryId: null, baseScreenId: null, status: 'active', source: { nodeId: 'src', pageId: 'gui' }, guiVersion: 1, guiTag: null, createdAt: 1 } as Screen);
    store.put(keys.flipbook('fb'), { id: 'fb', rev: 1, kind: 'single', title: 'Book', autoTitle: true, titleNames: ['Book'], scale: 1, category: { key: 'c', name: 'C', order: 0 }, screens: type === 'scanUi' ? [{ uid: 's1', code: 'S1', name: 'Screen', version: 0 }] : [], pageId: 'p1', status: 'active', createdAt: 500, actor, tracked: true } satisfies Flipbook);
    if (type === 'scanUi') store.put(keys.gui('s1', 1), {
      screenId: 's1', version: 1, batchId: 'b1', workType: 'changed', fingerprint: 'fp', thumb: null, width: 100, height: 100, code: 'S1', name: 'Screen', category: null, base: null,
      tag: { id: 't', name: 'Changed', colorKey: 'Green', color: '#00ff00' }, description: 'New', worker: actor, actor, committedAt: 1000, extra: {}, corrections: [],
    });
    const messages: ToUi[] = [];
    let syncs = 0;
    let known: Map<string, string> | undefined;
    const host = {
      kv: store.kv, mode: 'UI', actor, post: (m: ToUi) => messages.push(m), pages: () => [{ id: 'p1', name: 'UI' }], templateIssues: async () => [],
      inspectFlipbooks: async () => ({ found: new Map([['fb', 'frame']]), spots: {} }),
      scanCopies: async () => [{ nodeId: 'copy', pageId: 'p1', uid: 's1', version: 1, trackId: '', flipbookId: 'fb' }], markTracked: async () => {},
      uiFingerprint: async () => ({ fingerprint: 'fp', error: null }), ensureDataPage: async () => 'data', renderData: async () => {},
      beginDelivery: (frames: Map<string, string>) => { known = frames; },
      syncFlipbook: async () => { syncs++; if (fail) throw new Error('font unavailable'); return { nodeId: 'frame', notes: [], tracked: true }; },
    } as unknown as Host;
    const controller = new Controller(host);
    await controller.handle(type === 'followFlipbook' ? { type, id: 'fb' } : { type });
    assert.equal(syncs, 1);
    if (type === 'refreshList') assert.equal(known?.get('fb'), 'frame', 'reuse frames from the preceding list read');
    const busy = messages.filter(m => m.type === 'busy');
    assert.ok(busy.some(m => m.label?.startsWith('UI 반영 중')));
    assert.equal(busy[busy.length - 1]?.label, null);
    if (!fail) assert.deepEqual(messages.filter(m => m.type === 'error'), []);
  });
}
