import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Entry } from '../src/core/compare.ts';
import { defaultDraft, pendingScreens, renumberAutoCodes, validateDraft, type Draft } from '../src/core/drafts.ts';
import { buildPlan, commitPlan } from '../src/core/publish.ts';
import { ensureSystemTags } from '../src/core/registry.ts';
import { keys, memoryKV, Store } from '../src/core/store.ts';
import { COPY } from '../src/core/copy.ts';

const actor = { id: 'u', name: 'Designer' };
function setup() {
  let n = 0;
  const store = new Store(memoryKV(), () => 1000, () => `id${++n}`);
  store.saveProject({ ...store.state.project, scopePageIds: ['p'], screenIdPrefix: 'STB' });
  store.put(keys.category('home'), { id: 'home', name: 'Home', code: 'HO', order: 0, active: true });
  store.put(keys.worker('w'), { id: 'w', name: 'Designer', alias: '', active: true });
  ensureSystemTags(store, actor);
  const entries = ['case', 'base', 'other'].map(id => ({
    key: `new:${id}`, screenId: null, estimate: 'new',
    frame: { nodeId: id, pageId: 'p', name: id, width: 1920, height: 1080, screenTag: null, fingerprint: id, error: null },
  } as unknown as Entry));
  const drafts: Record<string, Draft> = Object.fromEntries(entries.map(entry => [entry.key, {
    ...defaultDraft('GUI', store.state, entry), included: true, relation: 'standalone', categoryId: 'home', workerId: 'w',
  }]));
  Object.assign(drafts['new:case'], { relation: 'case', baseScreenId: 'new:base' });
  renumberAutoCodes(store.state, entries.map(entry => ({ entry, draft: drafts[entry.key] })));
  const fingerprints = Object.fromEntries(entries.map(e => [e.key, e.frame!.fingerprint]));
  return { store, entries, drafts, input: { fingerprints, thumbs: {} } };
}

test('미배포 기본 화면과 케이스를 함께 확정하고 실제 ID·기준 화면 기록을 남긴다', () => {
  const { store, entries, drafts, input } = setup();
  assert.equal(drafts['new:base'].code, 'STB_HO_001');
  assert.equal(drafts['new:case'].code, 'STB_HO_001-01');
  for (let i = 0; i < 3; i++) renumberAutoCodes(store.state, entries.map(entry => ({ entry, draft: drafts[entry.key] })));
  assert.equal(drafts['new:case'].code, 'STB_HO_001-01', '자동 번호를 반복 계산해도 바뀌지 않는다');
  const plan = buildPlan('GUI', store.state, entries, drafts, actor, 'same-batch');
  assert.deepEqual(plan.blockers, []);
  const base = plan.items.find(i => i.entryKey === 'new:base')!;
  const caseItem = plan.items.find(i => i.entryKey === 'new:case')!;
  assert.equal(caseItem.baseScreenId, base.screenId);
  assert.notEqual(base.screenId, 'new:base');
  const result = commitPlan(store, plan, input);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.committed.length, 3);
  assert.equal(store.state.screens.get(caseItem.screenId)?.baseScreenId, base.screenId);
  assert.deepEqual(store.state.gui.get(caseItem.screenId)?.[0].base, { id: base.screenId, name: 'base' });
  assert.equal(commitPlan(store, plan, input).replay, true);
  assert.equal(store.state.gui.get(caseItem.screenId)?.length, 1);
});

test('배포 선택을 해제하거나 교체·제외로 바꾼 미배포 화면은 기본 화면으로 쓸 수 없다', () => {
  for (const change of [{ included: false }, { link: 'replace' }, { notScreen: true }, { unpublish: true }] as Partial<Draft>[]) {
    const { store, entries, drafts } = setup();
    Object.assign(drafts['new:base'], change);
    assert.ok(!pendingScreens(store.state, entries, drafts).some(s => s.id === 'new:base'));
    const validation = validateDraft('GUI', store.state, entries[0], drafts['new:case'], drafts, entries);
    assert.ok(validation.errors.includes(COPY.coreRegistry016));
  }
});

test('미배포 화면도 자기 자신 또는 케이스를 기본 화면으로 지정할 수 없다', () => {
  const { store, entries, drafts } = setup();
  drafts['new:case'].baseScreenId = 'new:case';
  assert.ok(validateDraft('GUI', store.state, entries[0], drafts['new:case'], drafts, entries).errors.includes(COPY.coreRegistry015));
  drafts['new:case'].baseScreenId = 'new:base';
  Object.assign(drafts['new:base'], { relation: 'case', baseScreenId: 'new:other' });
  assert.ok(validateDraft('GUI', store.state, entries[0], drafts['new:case'], drafts, entries).errors.includes(COPY.coreRegistry018));
});

test('기본 화면이 확정 직전 충돌하면 케이스도 보류하고 무관한 화면만 확정한다', () => {
  const { store, entries, drafts, input } = setup();
  const plan = buildPlan('GUI', store.state, entries, drafts, actor, 'conflict');
  const base = plan.items.find(i => i.entryKey === 'new:base')!;
  const caseItem = plan.items.find(i => i.entryKey === 'new:case')!;
  input.fingerprints['new:base'] = 'changed-after-confirm';
  const result = commitPlan(store, plan, input);
  assert.deepEqual(result.committed, ['new:other']);
  assert.deepEqual(new Set(result.conflicts.map(c => c.entryKey)), new Set(['new:base', 'new:case']));
  assert.equal(store.state.screens.has(base.screenId), false);
  assert.equal(store.state.screens.has(caseItem.screenId), false);
});

// 기본 화면 X와 그 케이스 B, 독립 화면 Y를 배포해 두고 등록 화면 항목을 만든다.
function registered() {
  const { store, entries, drafts, input } = setup();
  Object.assign(drafts['new:case'], { relation: 'case', baseScreenId: 'new:base' });
  const first = buildPlan('GUI', store.state, entries, drafts, actor, 'first');
  assert.equal(commitPlan(store, first, input).conflicts.length, 0);
  const id = (key: string) => first.items.find(i => i.entryKey === key)!.screenId;
  const ids = { x: id('new:base'), b: id('new:case'), y: id('new:other') };
  const rows = Object.entries(ids).map(([name, screenId]) => ({
    key: screenId, screenId, estimate: 'unchanged', categoryMissing: false, notes: [], suggestedScreenId: null, pairKey: null,
    frame: { nodeId: name === 'x' ? 'base' : name === 'b' ? 'case' : 'other', pageId: 'p', name, width: 1920, height: 1080, screenTag: null, fingerprint: name === 'x' ? 'base' : name === 'b' ? 'case' : 'other', error: null },
  } as unknown as Entry));
  const next: Record<string, Draft> = Object.fromEntries(rows.map(entry => [entry.key, { ...defaultDraft('GUI', store.state, entry), included: true, workerId: 'w', tagId: drafts['new:base'].tagId }]));
  return { store, ids, rows, next, input: { fingerprints: { [ids.x]: 'base', [ids.b]: 'case', [ids.y]: 'other' }, thumbs: {} } };
}

test('케이스였던 화면을 같은 배포에서 독립으로 바꾸면 다른 화면의 기본 화면으로 고를 수 있다', () => {
  const { store, ids, rows, next, input } = registered();
  Object.assign(next[ids.b], { relation: 'standalone', baseScreenId: undefined });
  Object.assign(next[ids.y], { relation: 'case', baseScreenId: ids.b });
  assert.deepEqual(validateDraft('GUI', store.state, rows[2], next[ids.y], next, rows).errors, []);
  next[ids.b].included = false;
  assert.ok(validateDraft('GUI', store.state, rows[2], next[ids.y], next, rows).errors.includes(COPY.coreRegistry018), '독립으로 바꾼 화면을 배포에서 빼면 여전히 케이스다');
  next[ids.b].included = true;
  const plan = buildPlan('GUI', store.state, rows, next, actor, 'second');
  assert.deepEqual(plan.blockers, []);
  assert.deepEqual(commitPlan(store, plan, input).conflicts, []);
  assert.equal(store.state.screens.get(ids.b)?.baseScreenId, null);
  assert.equal(store.state.screens.get(ids.y)?.baseScreenId, ids.b);
});

test('같은 배포에서 케이스를 모두 다른 관계로 바꾼 기본 화면은 케이스가 될 수 있다', () => {
  const { store, ids, rows, next, input } = registered();
  Object.assign(next[ids.x], { relation: 'case', baseScreenId: ids.y });
  assert.ok(validateDraft('GUI', store.state, rows[0], next[ids.x], next, rows).errors.includes(COPY.coreRegistry019));
  Object.assign(next[ids.b], { relation: 'standalone', baseScreenId: undefined });
  assert.deepEqual(validateDraft('GUI', store.state, rows[0], next[ids.x], next, rows).errors, []);
  const plan = buildPlan('GUI', store.state, rows, next, actor, 'third');
  assert.deepEqual(plan.blockers, []);
  assert.deepEqual(commitPlan(store, plan, input).conflicts, []);
  assert.equal(store.state.screens.get(ids.x)?.baseScreenId, ids.y);
  assert.equal(store.state.screens.get(ids.b)?.baseScreenId, null);
});

test('독립으로 바꾼 기본 화면이 확정 직전 충돌하면 그 화면을 기본 화면으로 고른 케이스도 보류한다', () => {
  const { store, ids, rows, next, input } = registered();
  Object.assign(next[ids.b], { relation: 'standalone', baseScreenId: undefined });
  Object.assign(next[ids.y], { relation: 'case', baseScreenId: ids.b });
  const plan = buildPlan('GUI', store.state, rows, next, actor, 'fourth');
  const b = store.state.screens.get(ids.b)!;
  store.put(keys.screen(ids.b), { ...b, rev: b.rev + 1 });
  const result = commitPlan(store, plan, input);
  assert.deepEqual(new Set(result.conflicts.map(c => c.entryKey)), new Set([ids.b, ids.y]));
  assert.equal(store.state.screens.get(ids.y)?.baseScreenId, null);
});
