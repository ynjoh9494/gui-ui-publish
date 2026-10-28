import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Entry } from '../src/core/compare.ts';
import { buildList } from '../src/core/list.ts';
import { reorderCategories } from '../src/core/registry.ts';
import { keys, memoryKV, Store } from '../src/core/store.ts';
import type { Category, Screen } from '../src/core/types.ts';
import { Controller, type Host } from '../src/controller.ts';
import type { ToUi } from '../src/core/wire.ts';

const actor = { id: 'u', name: 'Designer' };

function category(store: Store, id: string, name: string, order: number, active = true): Category {
  const value: Category = { id, name, order, active };
  store.put(keys.category(id), value);
  return value;
}

function screen(store: Store, id: string, categoryId: string): Screen {
  const value: Screen = {
    id, rev: 1, code: `STB_${id}`, name: `화면 ${id}`, categoryId, baseScreenId: null, status: 'active', source: { nodeId: `node-${id}`, pageId: 'page' },
    guiVersion: 1, guiTag: null, createdAt: 1,
  };
  store.put(keys.screen(id), value);
  return value;
}

const entry = (screenId: string): Entry => ({ key: screenId, screenId, frame: null, estimate: 'unchanged', categoryMissing: false, notes: [], suggestedScreenId: null, pairKey: null });
const ordered = (store: Store) => [...store.state.categories.values()].sort((a, b) => a.order - b.order).map(c => c.id);

test('카테고리 순서를 바꾸면 사용 안 함 카테고리는 자리를 지키고 order를 0부터 다시 매긴다', () => {
  const store = new Store(memoryKV());
  category(store, 'home', '홈', 1);
  category(store, 'old', '이전', 3, false);
  category(store, 'search', '검색', 5);
  category(store, 'vod', 'VOD', 9);
  reorderCategories(store, ['vod', 'home', 'search'], actor);
  assert.deepEqual(ordered(store), ['vod', 'old', 'home', 'search']);
  assert.deepEqual([...store.state.categories.values()].map(c => [c.id, c.order]).sort(), [['home', 2], ['old', 1], ['search', 3], ['vod', 0]]);
  const audit = store.state.audit.filter(a => a.action === 'category.order');
  assert.equal(audit.length, 1);
  assert.deepEqual([audit[0].before, audit[0].after], [['home', 'search', 'vod'], ['vod', 'home', 'search']]);
  // 순서가 같으면 기록을 남기지 않는다.
  reorderCategories(store, ['vod', 'home', 'search'], actor);
  assert.equal(store.state.audit.filter(a => a.action === 'category.order').length, 1);
});

test('카테고리가 추가되거나 삭제되어 목록이 다르면 순서를 저장하지 않는다', () => {
  const store = new Store(memoryKV());
  category(store, 'home', '홈', 0);
  category(store, 'search', '검색', 1);
  category(store, 'old', '이전', 2, false);
  for (const ids of [['search'], ['search', 'home', 'old'], ['search', 'search'], ['search', 'home', 'new']])
    assert.throws(() => reorderCategories(store, ids, actor), /순서를 저장하지 않았습니다/);
  assert.deepEqual(ordered(store), ['home', 'search', 'old']);
});

test('GUI 화면 목록의 카테고리 묶음은 바꾼 순서를 따른다', () => {
  const store = new Store(memoryKV());
  category(store, 'home', '홈', 0);
  category(store, 'search', '검색', 1);
  screen(store, 'a', 'home');
  screen(store, 'b', 'search');
  const groups = () => buildList('GUI', store.state, [entry('a'), entry('b')], () => 'excluded', { collapsed: new Set(), query: '', changedOnly: false }).groups.map(g => g.name);
  assert.deepEqual(groups(), ['홈', '검색']);
  reorderCategories(store, ['search', 'home'], actor);
  assert.deepEqual(groups(), ['검색', '홈']);
});

test('순서를 바꾸면 저장하고 바뀐 상태를 보낸다', async () => {
  const kv = memoryKV({ project: JSON.stringify({ scopePageIds: ['page'], screenIdPrefix: 'STB' }) });
  const seed = new Store(kv);
  category(seed, 'home', '홈', 0);
  category(seed, 'search', '검색', 1);
  const posted: ToUi[] = [];
  const host = { kv, mode: 'GUI', actor, post: (message: ToUi) => posted.push(message), pages: () => [{ id: 'page', name: '원본' }] } as unknown as Host;
  const controller = new Controller(host);
  await controller.handle({ type: 'ready' });
  posted.length = 0;
  await controller.handle({ type: 'admin', action: { op: 'reorderCategories', ids: ['search', 'home'] } });
  assert.deepEqual(ordered(new Store(kv)), ['search', 'home']);
  assert.ok(posted.some(m => m.type === 'state'));
  assert.ok(!posted.some(m => m.type === 'error'));
});
