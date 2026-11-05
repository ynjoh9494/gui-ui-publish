import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Entry } from '../src/core/compare.ts';
import type { Draft } from '../src/core/drafts.ts';
import { pickerFrameEntries, pickerRegisteredScreens } from '../src/core/guiPicker.ts';
import { buildList } from '../src/core/list.ts';
import { Store, memoryKV } from '../src/core/store.ts';

function fixture() {
  const { state } = new Store(memoryKV());
  state.categories.set('first', { id: 'first', name: 'First', order: 0, active: true });
  state.categories.set('second', { id: 'second', name: 'Second', order: 1, active: true });
  for (const [id, categoryId, baseScreenId] of [['a', 'first', null], ['b', 'second', null], ['c', 'first', 'a']] as const) {
    state.screens.set(id, { id, rev: 1, code: id, name: id, categoryId, baseScreenId, status: 'active', source: { nodeId: id, pageId: 'p' }, guiVersion: 1, guiTag: null, createdAt: 1 });
  }
  const entries: Entry[] = ['a', 'b', 'c', 'new'].map(id => ({
    key: id, screenId: id === 'new' ? null : id,
    frame: { nodeId: id, pageId: 'p', name: id, width: 1, height: 1, screenTag: null, fingerprint: id, error: null },
    estimate: id === 'new' ? 'new' : 'unchanged', categoryMissing: false, notes: [], suggestedScreenId: null, pairKey: null,
  }));
  return { state, entries };
}

test('GUI 선택 후보는 구버전 대신 신버전 프레임을 이어받는 화면 ID로 한 번만 제공한다', () => {
  const { state, entries } = fixture();
  const drafts: Record<string, Draft> = {
    a: { included: true, replacedBy: 'new', retire: 'replace' },
    new: { included: true, link: 'replace', replaceScreenId: 'a', code: 'edited' },
  };
  const choices = pickerRegisteredScreens(state, entries, drafts);
  assert.deepEqual(choices.map(({ screen, entry }) => [screen.id, entry?.key]), [['a', 'new'], ['b', 'b'], ['c', 'c']]);
  assert.deepEqual(pickerFrameEntries(entries, drafts).map(entry => entry.key), ['b', 'c', 'new']);
  drafts.new.included = false;
  drafts.a.included = false;
  assert.equal(pickerRegisteredScreens(state, entries, drafts)[0].entry?.key, 'a', 'turning off the pair restores the original source');
});

test('GUI 선택 후보에서 병합 뒤 없어지는 화면·배포 취소·화면이 아님을 제외한다', () => {
  const { state, entries } = fixture();
  const drafts: Record<string, Draft> = {
    a: { included: true, replacedBy: 'b', retire: 'replace' },
    b: { included: true, link: 'replace', replaceScreenId: 'a' },
    c: { included: true, unpublish: true },
    new: { included: true, notScreen: true },
  };
  assert.deepEqual(pickerRegisteredScreens(state, entries, drafts).map(({ screen, entry }) => [screen.id, entry?.key]), [['a', 'b']]);
  assert.deepEqual(pickerFrameEntries(entries, drafts).map(entry => entry.key), ['b']);
});

test('GUI 목록은 교체 구버전을 신버전 아래에 두고 나머지 제외 항목만 기존 순서대로 맨 아래에 모은다', () => {
  const { state, entries } = fixture();
  const bottom = new Set(['b', 'c']);
  const view = { collapsed: new Set<string>(), query: '', changedOnly: false,
    follows: (entry: Entry) => entry.key === 'a' ? 'new' : null,
    // The previous-version placement takes precedence even if a caller marks it.
    bottom: (entry: Entry) => bottom.has(entry.key) || entry.key === 'a' };
  const model = buildList('GUI', state, entries, () => 'ready', view);
  assert.deepEqual(model.groups.flatMap(group => group.rows.map(row => row.entry.key)), ['new', 'a', 'c', 'b']);
  assert.equal(model.groups[0].rows[1].previous, true);
  const tail = model.groups[model.groups.length - 1];
  assert.equal(tail.trailing, true);
  assert.deepEqual(tail.rows.map(row => [row.entry.key, row.depth]), [['c', 0], ['b', 0]], 'category and case ordering is retained; moving actions do not determine order');
  assert.equal(model.included, 4);
  assert.equal(model.invalid, 0);
  const filtered = buildList('GUI', state, entries, () => 'ready', { ...view, query: 'b', collapsed: new Set(['second']) });
  assert.deepEqual(filtered.groups.flatMap(group => group.rows.map(row => row.entry.key)), ['b']);
  bottom.clear();
  assert.equal(buildList('GUI', state, entries, () => 'ready', view).groups.some(group => group.trailing), false, 'undoing excluded states restores normal groups');
});
