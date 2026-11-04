import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Controller, type Host } from '../src/controller.ts';
import { planFlipbooks, customSection } from '../src/core/flipbooks.ts';
import { ensureSystemTags, systemTagId } from '../src/core/registry.ts';
import { Store, memoryKV, keys } from '../src/core/store.ts';
import type { ToUi } from '../src/core/wire.ts';
import { cloneLayout, DEFAULT_TEXT_LAYOUT } from '../src/core/description.ts';
import { parseRichText } from '../src/core/richText.ts';
import { COPY } from '../src/core/copy.ts';

function setup() {
  const actor = { id: 'u', name: 'Audit' };
  const store = new Store(memoryKV());
  store.saveProject({ ...store.state.project, templateNodeId: 'tpl', flipbookPageId: 'ui', flipbookPageIds: ['ui'] });
  let sequence = 0;
  for (const fb of planFlipbooks({ pageId: 'ui', rows: [
    { uids: [], multi: false, scale: 1, title: 'A' },
    { uids: [], multi: false, scale: 1, title: 'B' },
  ] }, new Map(), actor, 100, () => `fb${++sequence}`)) store.put(keys.flipbook(fb.id), fb);
  ensureSystemTags(store, actor);
  const calls: string[] = [], posted: ToUi[] = [];
  const host = {
    kv: store.kv, actor, mode: 'UI', post: (m: ToUi) => posted.push(m), pages: () => [{ id: 'ui', name: 'UI' }],
    inspectFlipbooks: async () => ({ found: new Map([['fb1', 'n1'], ['fb2', 'n2']]), spots: {} }),
    templateIssues: async () => [],
    syncFlipbook: async (_s: unknown, view: { flipbookId: string }) => { calls.push(`full:${view.flipbookId}`); return { nodeId: `n:${view.flipbookId}`, notes: [] }; },
    syncChapters: async () => { calls.push('chapters'); },
    ensureDataPage: async () => 'data', renderData: async () => { calls.push('data'); },
    moveFlipbook: async () => true,
    prepareFlipbookTitle: async () => { throw new Error('font unavailable'); },
  } as unknown as Host;
  return { controller: new Controller(host), calls, posted, store, host };
}

test('reviewing A never delivers unrelated moved or failed B', async () => {
  const { controller, calls, store, host } = setup();
  host.inspectFlipbooks = async () => ({ found: new Map([['fb1', 'n1'], ['fb2', 'n2']]), spots: {
    n2: { pageId: 'ui', section: 'section:moved', sectionName: 'Moved', sectionIndex: 0, index: 0 },
  } });
  store.put(keys.delivery('old', 'fb2'), { batchId: 'old', kind: 'flipbook', team: 'UI', targetId: 'fb2', version: 0, state: 'failed', error: 'old failure', updatedAt: 0 });
  await controller.handle({ type: 'markReviewed', requests: [{ flipbookId: 'fb1', tagId: systemTagId(store.state, 'latest')!, comment: '' }] });
  assert.ok(calls.includes('full:fb1'), JSON.stringify(calls));
  assert.ok(!calls.includes('full:fb2'), JSON.stringify(calls));
  assert.equal(controller.store.state.flipbooks.get('fb2')?.category.key, store.state.flipbooks.get('fb2')?.category.key);
});

test('moving between Sections neither delivers nor rewrites chapters', async () => {
  const { controller, calls } = setup();
  await controller.handle({ type: 'createFlipbooks', request: { pageId: 'ui', rows: [], moves: [{ flipbookId: 'fb1', pageId: 'ui', section: customSection('New', 'section:new'), after: null }] } });
  assert.ok(!calls.includes('full:fb1'), JSON.stringify(calls));
  assert.ok(!calls.includes('chapters'), JSON.stringify(calls));

});

test('failed title preparation preserves the record for retry', async () => {
  const { controller, posted, host } = setup();
  await controller.handle({ type: 'renameFlipbook', id: 'fb1', title: 'New title' });
  assert.ok(posted.some(m => m.type === 'error' && m.message === 'font unavailable'));
  assert.equal(controller.store.state.flipbooks.get('fb1')?.title, 'A');
  assert.equal(controller.store.state.deliveries.size, 0);
  let applied = false;
  host.prepareFlipbookTitle = async () => ({ apply() { applied = true; }, rollback() {} });
  await controller.handle({ type: 'renameFlipbook', id: 'fb1', title: 'New title' });
  assert.equal(applied, true);
  assert.equal(controller.store.state.flipbooks.get('fb1')?.title, 'New title');
});

test('title preparation never overwrites another user change', async () => {
  const { controller, host, store, posted } = setup();
  let applied = false;
  host.prepareFlipbookTitle = async () => {
    const current = store.state.flipbooks.get('fb1')!;
    store.put(keys.flipbook('fb1'), { ...current, rev: current.rev + 1, title: 'Other user' });
    return { apply() { applied = true; }, rollback() {} };
  };
  await controller.handle({ type: 'renameFlipbook', id: 'fb1', title: 'New title' });
  assert.equal(applied, false);
  controller.store.reload();
  assert.equal(controller.store.state.flipbooks.get('fb1')?.title, 'Other user');
  assert.ok(posted.some(m => m.type === 'error'));
});

test('explicit delivery targets exclude pending books; explicit retry still processes them', async () => {
  const { controller, calls, store } = setup();
  const key = keys.delivery('old', 'fb2');
  store.put(key, { batchId: 'old', kind: 'flipbook', team: 'UI', targetId: 'fb2', version: 0, state: 'failed', error: 'old failure', updatedAt: 0 });
  await controller.deliverFlipbooks({}, { targets: ['fb1'] });
  assert.deepEqual(calls, ['full:fb1']);
  assert.equal(controller.store.state.deliveries.get(key)?.state, 'failed');
  calls.length = 0;
  await controller.deliverFlipbooks();
  assert.deepEqual(calls, ['full:fb2']);
  assert.equal(controller.store.state.deliveries.get(key)?.state, 'done');
});


test('identity saves header fields without delivering GUI, Description, history or DATA', async () => {
  const { controller, host, store, calls } = setup();
  store.put(keys.category('live'), { id: 'live', name: 'Live', code: 'LI', order: 0, active: true });
  let item: Parameters<Host['prepareFlipbookTitle']>[0] | undefined;
  host.prepareFlipbookTitle = async request => {
    item = request;
    return { apply() { calls.push('metadata'); }, rollback() { calls.push('rollback'); } };
  };
  const before = store.state.flipbooks.get('fb1')!;
  await controller.handle({ type: 'updateFlipbookIdentity', id: 'fb1', rev: before.rev, title: 'No dash required', screenId: 'ST_LI_POLICY' });
  assert.deepEqual(calls, ['metadata']);
  assert.equal(item?.title, 'No dash required');
  assert.equal(item?.screenId, 'ST_LI_POLICY');
  assert.equal(item?.chapter, 'Live');
  assert.equal(item?.frameName, 'ST_LI_POLICY · No dash required');
  assert.equal(controller.store.state.flipbooks.get('fb1')?.screenId, 'ST_LI_POLICY');
  assert.deepEqual(controller.store.state.flipbooks.get('fb1')?.screens, before.screens);
  await controller.handle({ type: 'renameFlipbook', id: 'fb1', title: 'Only title' });
  assert.equal(item?.screenId, undefined, 'list rename does not write the ID field');
  assert.equal(controller.store.state.flipbooks.get('fb1')?.screenId, 'ST_LI_POLICY');
});

test('stale identity drafts and font failures preserve saved identity', async () => {
  const { controller, host, store, posted } = setup();
  const before = store.state.flipbooks.get('fb1')!;
  let prepared = false;
  host.prepareFlipbookTitle = async () => { prepared = true; throw new Error('font unavailable'); };
  await controller.handle({ type: 'updateFlipbookIdentity', id: 'fb1', rev: before.rev - 1, title: 'Changed', screenId: 'ST_LI_POLICY' });
  assert.equal(prepared, false);
  await controller.handle({ type: 'updateFlipbookIdentity', id: 'fb1', rev: before.rev, title: 'Changed', screenId: 'ST_LI_POLICY' });
  assert.equal(prepared, true);
  assert.deepEqual(controller.store.state.flipbooks.get('fb1'), before);
  assert.equal(posted.filter(m => m.type === 'error').length, 2);
});

test('Description apply rejects a stale canvas value without overwriting it', async () => {
  const { controller, host, store, posted } = setup();
  const before = parseRichText('Old'), next = parseRichText('Mine'), changed = parseRichText('Other user');
  const layout = cloneLayout(DEFAULT_TEXT_LAYOUT);
  const writes: string[] = [];
  host.readFlipbookDescription = async () => ({ paragraphs: changed, layout });
  host.writeFlipbookDescription = async (_item, paragraphs) => { writes.push(paragraphs[0].text); };
  await controller.handle({ type: 'applyFlipbookEdits', edits: [{ id: 'fb1', rev: store.state.flipbooks.get('fb1')!.rev,
    description: { paragraphs: next, layout, before: { paragraphs: before, layout } } }] });
  assert.deepEqual(writes, []);
  assert.ok(posted.some(m => m.type === 'flipbookEditsApplied' && m.failed.some(f => f.message === COPY.flipbookDescriptionConflict)));
});


test('category names update matching Chapters without a full flipbook delivery', async () => {
  const { controller, host, store, calls } = setup();
  store.put(keys.category('live'), { id: 'live', name: 'Live', code: 'LI', order: 0, active: true });
  store.put(keys.flipbook('fb1'), { ...store.state.flipbooks.get('fb1')!, screenId: 'ST_LI_POLICY' });
  const chapters: { flipbookId: string; name: string }[] = [];
  host.syncChapters = async items => { chapters.push(...items); };
  await controller.handle({ type: 'admin', action: { op: 'updateCategory', id: 'live', name: 'Live English', code: 'LI' } });
  assert.deepEqual(chapters.map(c => [c.flipbookId, c.name]), [['fb1', 'Live English']]);
  assert.deepEqual(calls, []);
  assert.equal(controller.store.state.categories.get('live')?.name, 'Live English');
});
