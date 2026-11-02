import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Controller, type Host } from '../src/controller.ts';
import { COPY } from '../src/core/copy.ts';
import { planFlipbooks } from '../src/core/flipbooks.ts';
import { keys, memoryKV, Store } from '../src/core/store.ts';
import type { LegacyConvertInput } from '../src/figma/legacyConvert.ts';
import type { ToUi } from '../src/core/wire.ts';

// 이전 형식 플립북 변환(2026-11-02 사용자 결정): 한 번에 바꾸지 않고 플립북 상세에서 고른 플립북만 바꾼다.
// 바꾼 플립북은 화면 목록을 추적 GUI로 읽고(tracked), 그 페이지를 다시 읽어 GUI Image Slot의 화면을 추적 GUI로 기록한 뒤 바로 반영한다.
const actor = { id: 'u', name: 'Designer' };

test('고른 이전 형식 플립북만 변환해 추적 GUI 플립북으로 바꾸고 바로 반영하며, 프레임을 찾지 못한 플립북은 알린다', async () => {
  const store = new Store(memoryKV());
  store.saveProject({ ...store.state.project, templateNodeId: 'tpl', templateName: 'T', previousTemplates: [{ nodeId: 'old', name: 'O' }], flipbookPageIds: ['ui'], flipbookPageId: 'ui' });
  let seq = 0;
  for (const title of ['A', 'B', 'C']) {
    for (const fb of planFlipbooks({ pageId: 'ui', rows: [{ uids: [], multi: false, scale: 1, title }] }, new Map(), actor, 1000, () => `fb-${title}`)) {
      store.put(keys.flipbook(fb.id), { ...fb, pageId: 'ui', category: { key: 'home', name: '홈', order: ++seq } });
    }
  }
  // 변환하지 않은 fb-B에 미반영 기록이 남아 있다. 변환은 이 기록까지 이어서 반영하지 않는다.
  store.put(keys.delivery('old', 'fb-B'), { batchId: 'old', kind: 'flipbook', targetId: 'fb-B', team: 'GUI', version: 1, state: 'applying', error: null, updatedAt: 0 });
  const converts: LegacyConvertInput[] = [];
  const synced: string[] = [];
  const posted: ToUi[] = [];
  const host = {
    kv: store.kv, mode: 'UI', actor, post: (m: ToUi) => posted.push(m), pages: () => [{ id: 'ui', name: 'UI' }], selectionNodeIds: () => [],
    templateIssues: async () => [],
    // fb-C는 캔버스에서 프레임을 찾지 못했다.
    convertLegacyFlipbooks: async (input: LegacyConvertInput) => { converts.push(input); return { flipbooks: input.flipbookIds.filter(id => id !== 'fb-C') }; },
    inspectFlipbooks: async () => ({ found: new Map([['fb-A', '1:1'], ['fb-B', '1:2']]), spots: {} }),
    listFlipbooks: async () => new Map(),
    syncFlipbook: async (_s: unknown, view: { flipbookId: string }) => { synced.push(view.flipbookId); return { nodeId: '1:1', notes: [], tracked: true }; },
    ensureDataPage: async () => 'data', renderData: async () => {},
  } as unknown as Host;
  const controller = new Controller(host);
  const refreshed: string[] = [];
  (controller as unknown as { tracks: { refreshPage(pageId: string): Promise<string[]> } }).tracks.refreshPage = async pageId => { refreshed.push(pageId); return []; };
  await controller.handle({ type: 'convertLegacyFlipbooks', ids: ['fb-A', 'fb-C', 'fb-A', 'unknown'] });
  assert.deepEqual(converts, [{ pageIds: ['ui'], flipbookIds: ['fb-A', 'fb-C'], templateIds: ['tpl', 'old'] }], '목록에 있는 플립북만, 템플릿 목록과 함께 넘긴다');
  const state = controller.store.state;
  assert.deepEqual(['fb-A', 'fb-B', 'fb-C'].map(id => !!state.flipbooks.get(id)?.tracked), [true, false, false], '고르지 않은 플립북은 그대로 둔다');
  assert.deepEqual(refreshed, ['ui'], '바꾼 플립북 페이지를 다시 읽어 GUI Image Slot의 화면을 추적 GUI로 기록한다');
  assert.deepEqual(synced, ['fb-A'], '바꾼 플립북만 바로 반영하고, 다른 플립북의 미반영 기록은 이어서 반영하지 않는다');
  const messages = posted.filter(m => m.type === 'error' || m.type === 'notice').map(m => (m as { message: string }).message);
  assert.deepEqual(messages, [`${COPY.legacyConvertMissing} C`, `${COPY.legacyConverted} A`]);
  assert.ok(state.audit.some(a => a.action === 'flipbook.convertLegacy'));
});
