import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Store, memoryKV } from '../src/core/store.ts';
import { flipbookIdentity, policyScreenId, unsavedPolicyIds, withFlipbookId } from '../src/core/flipbookIdentity.ts';
import { flipbookView } from '../src/core/flipbook.ts';
import { followCanvasSections, moveFlipbooks, pinPolicyIds, removeFlipbooks } from '../src/core/flipbooks.ts';
import { keys } from '../src/core/store.ts';
import type { Flipbook } from '../src/core/types.ts';

function fixture() {
  const store = new Store(memoryKV());
  store.state.project.screenIdPrefix = 'ST';
  store.state.categories.set('live', { id: 'live', name: 'Live', code: 'LI', order: 0, active: true });
  const fb: Flipbook = { id: 'fb', rev: 1, kind: 'policy', title: 'Any title', autoTitle: false, titleNames: [], scale: 1,
    category: { key: 'live', name: 'Unrelated Section', order: 0 }, screens: [], pageId: 'p', status: 'active', createdAt: 0, actor: { id: 'u', name: 'User' } };
  return { state: store.state, fb };
}

test('first GUI ID, GUI chapter and Page title stay independent of Section names', () => {
  const { state, fb } = fixture();
  fb.screens = [{ uid: 's', code: 'ST_LI_MV_002', name: 'GUI title', version: 1 }, { uid: 's2', code: 'ST_HO_003', name: 'Other', version: 1 }];
  fb.kind = 'multi';
  state.flipbooks.set(fb.id, fb);
  assert.deepEqual(flipbookIdentity(state, fb), { screenId: 'ST_LI_MV_002', chapter: 'Live', frameName: 'ST_LI_MV_002 \u00b7 Any title' });
  const view = flipbookView(state, fb.id);
  assert.equal(view.name, 'Any title');
  assert.equal(view.screenId, 'ST_LI_MV_002');
  assert.equal(view.chapter, 'Live');
  assert.equal(view.gui.length, 2, 'all GUI copies remain despite one header ID');
});

test('policies reserve the base then NN suffix across the chapter, including a creation batch', () => {
  const { state, fb } = fixture();
  for (let i = 1; i <= 3; i++) {
    const next = withFlipbookId(state, { ...fb, id: `p${i}`, pageId: `page${i}` });
    assert.equal(next.screenId, i === 1 ? 'ST_LI_POLICY' : `ST_LI_POLICY_0${i}`);
    state.flipbooks.set(next.id, next);
  }
  assert.equal(flipbookIdentity(state, state.flipbooks.get('p1')!).screenId, 'ST_LI_POLICY');
  const old = { ...fb, id: 'old', screenId: undefined };
  state.flipbooks.set(old.id, old);
  assert.equal(flipbookIdentity(state, old).screenId, 'ST_LI_POLICY_04');
  assert.equal(flipbookIdentity(state, old).screenId, 'ST_LI_POLICY_04');
});

test('automatic IDs follow GUI changes; local overrides do not change GUI records', () => {
  const { state, fb } = fixture();
  fb.screens = [{ uid: 's', code: 'ST_LI_001', name: 'Screen', version: 1 }];
  const automatic = withFlipbookId(state, fb, 'ST_LI_001');
  assert.equal(automatic.screenId, undefined);
  automatic.screens = [{ ...fb.screens[0], code: 'ST_LI_002' }];
  assert.equal(flipbookIdentity(state, automatic).screenId, 'ST_LI_002');
  state.categories.set('home', { id: 'home', name: 'Home', code: 'HO', active: true, order: 1 });
  const edited = withFlipbookId(state, automatic, 'st_ho_007');
  assert.equal(flipbookIdentity(state, edited).chapter, 'Home');
  assert.equal(edited.screens[0].code, 'ST_LI_002');
  assert.equal(withFlipbookId(state, edited, '').screenId, undefined);
});

test('unknown policy context stays empty until the author supplies an ID', () => {
  const { state, fb } = fixture();
  fb.category = { key: 'custom', name: 'Unmapped', order: 0 };
  assert.equal(flipbookIdentity(state, fb).screenId, '');
  assert.equal(flipbookIdentity(state, withFlipbookId(state, fb, 'ST_LI_POLICY')).chapter, 'Live');
});

test('ID를 저장하지 않은 정책 플립북의 ID를 한 번에 정해도 하나씩 정한 값과 같다', () => {
  const { state, fb } = fixture();
  state.categories.set('home', { id: 'home', name: 'Home', code: 'HO', active: true, order: 1 });
  const home = { key: 'home', name: 'Home', order: 1 };
  const books: Flipbook[] = [
    { ...fb, id: 'a' }, { ...fb, id: 'saved', screenId: 'ST_LI_POLICY_03' }, { ...fb, id: 'b', category: home }, { ...fb, id: 'c' },
    { ...fb, id: 'gone', status: 'deleted' }, { ...fb, id: 'd', category: home }, { ...fb, id: 'e', category: { key: 'x', name: 'Unmapped', order: 2 } },
  ];
  for (const book of books) state.flipbooks.set(book.id, book);
  state.screens.set('s', { id: 's', rev: 1, code: 'ST_HO_POLICY', name: 'S', categoryId: 'home', baseScreenId: null, status: 'active', source: null, guiVersion: 1, guiTag: null, createdAt: 0 });
  const all = unsavedPolicyIds(state);
  assert.deepEqual(Object.fromEntries(all), { a: 'ST_LI_POLICY_04', b: 'ST_HO_POLICY_02', c: 'ST_LI_POLICY_05', d: 'ST_HO_POLICY_03' });
  for (const book of books.filter(b => all.has(b.id))) {
    assert.equal(policyScreenId(state, book), all.get(book.id));
    assert.equal(flipbookIdentity(state, book, all).screenId, flipbookIdentity(state, book).screenId);
  }
});

test('ID를 저장하지 않은 정책 플립북은 Section을 옮겨도 ID·Chapter가 그대로다', () => {
  const store = new Store(memoryKV());
  const actor = { id: 'u', name: 'User' };
  store.saveProject({ ...store.state.project, screenIdPrefix: 'ST', flipbookPageIds: ['p', 'q'] });
  store.put(keys.category('live'), { id: 'live', name: 'Live', code: 'LI', order: 0, active: true });
  store.put(keys.category('home'), { id: 'home', name: 'Home', code: 'HO', order: 1, active: true });
  const base: Flipbook = { id: 'a', rev: 1, kind: 'policy', title: 'A', autoTitle: false, titleNames: [], scale: 1,
    category: { key: 'live', name: 'Live', order: 0 }, screens: [], pageId: 'p', status: 'active', createdAt: 0, actor };
  store.put(keys.flipbook('a'), base);
  store.put(keys.flipbook('b'), { ...base, id: 'b', title: 'B' });
  const before = (id: string) => flipbookIdentity(store.state, store.state.flipbooks.get(id)!);
  assert.deepEqual([before('a').screenId, before('b').screenId], ['ST_LI_POLICY', 'ST_LI_POLICY_02']);
  followCanvasSections(store, [{ flipbookId: 'b', pageId: 'q', section: { key: 'home', name: 'Home', order: 1 } }], actor);
  assert.equal(store.state.flipbooks.get('b')!.screenId, 'ST_LI_POLICY_02');
  assert.equal(before('b').chapter, 'Live');
  moveFlipbooks(store, [{ flipbookId: 'a', pageId: 'q', section: { key: 'home', name: 'Home', order: 1 }, after: null }], ['p', 'q'], actor);
  assert.equal(store.state.flipbooks.get('a')!.screenId, 'ST_LI_POLICY');
  // 옮기지 않은 정책 플립북과 저장한 ID가 있는 플립북은 그대로 둔다.
  store.put(keys.flipbook('c'), { ...base, id: 'c', screenId: 'ST_LI_POLICY_09' });
  followCanvasSections(store, [{ flipbookId: 'c', pageId: 'q', section: { key: 'home', name: 'Home', order: 1 } }], actor);
  assert.equal(store.state.flipbooks.get('c')!.screenId, 'ST_LI_POLICY_09');
});

test('앞선 정책 플립북을 지우거나 새 ID를 저장해도 저장하지 않았던 정책 플립북의 ID가 밀리지 않는다', () => {
  const store = new Store(memoryKV());
  const actor = { id: 'u', name: 'User' };
  store.saveProject({ ...store.state.project, screenIdPrefix: 'ST' });
  store.put(keys.category('live'), { id: 'live', name: 'Live', code: 'LI', order: 0, active: true });
  const base: Flipbook = { id: 'a', rev: 1, kind: 'policy', title: 'A', autoTitle: false, titleNames: [], scale: 1,
    category: { key: 'live', name: 'Live', order: 0 }, screens: [], pageId: 'p', status: 'active', createdAt: 0, actor };
  for (const id of ['a', 'b', 'c']) store.put(keys.flipbook(id), { ...base, id });
  const id = (fb: string) => flipbookIdentity(store.state, store.state.flipbooks.get(fb)!).screenId;
  assert.deepEqual(['a', 'b', 'c'].map(id), ['ST_LI_POLICY', 'ST_LI_POLICY_02', 'ST_LI_POLICY_03']);
  removeFlipbooks(store, ['a'], new Set(), actor);
  assert.deepEqual(['b', 'c'].map(id), ['ST_LI_POLICY_02', 'ST_LI_POLICY_03']);
  assert.equal(store.state.flipbooks.get('b')!.screenId, 'ST_LI_POLICY_02');
  // 저장할 것이 없으면 아무것도 쓰지 않는다.
  const audits = store.state.audit.length;
  assert.deepEqual(pinPolicyIds(store, actor), []);
  assert.equal(store.state.audit.length, audits);
});
