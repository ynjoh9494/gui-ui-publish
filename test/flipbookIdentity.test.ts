import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Store, memoryKV } from '../src/core/store.ts';
import { flipbookIdentity, withFlipbookId } from '../src/core/flipbookIdentity.ts';
import { flipbookView } from '../src/core/flipbook.ts';
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
