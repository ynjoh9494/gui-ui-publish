import { TEMPLATE_MIGRATION_COPY } from '../src/core/templateMigrationCopy.ts';
import { sortTemplateMigrations } from '../src/core/templateMigration.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findTemplateMigrations, migrateFlipbookTemplate } from '../src/figma/templateMigration.ts';
import { NS } from '../src/figma/template.ts';
import { TemplateMigrationController } from '../src/templateMigrationController.ts';
import { COPY } from '../src/core/copy.ts';
import { keys, memoryKV, Store } from '../src/core/store.ts';
import { planFlipbooks } from '../src/core/flipbooks.ts';
import { reconcileTracks } from '../src/core/tracks.ts';
import type { ToUi } from '../src/core/wire.ts';
import type { TemplateMigrationItem } from '../src/core/templateMigration.ts';
import type { Host } from '../src/host.ts';

// Figma node boundary: model reparenting and ID preservation, and inject a
// failure after earlier moves to exercise rollback rather than just preparation.
function world() {
  let seq = 0;
  let corrupt = false;
  const sourceNodes = new Set<string>();
  let sourceRemovals = 0;
  const nodes = new Map<string, any>();
  const make = (type: string, role = '', children: any[] = []): any => {
    const n: any = { id: `n${++seq}`, type, name: role, children: [], parent: null, removed: false,
      width: 480, height: 150, resolvedVariableModes: {}, explicitVariableModes: {},
      data: new Map(), characters: 'Text', fontName: { family: 'Inter', style: 'Regular' },
      layoutMode: 'NONE', layoutPositioning: 'AUTO', layoutSizingHorizontal: 'FIXED', layoutSizingVertical: 'FIXED',
      visible: true, locked: false, relativeTransform: [[1, 0, 0], [0, 1, 0]],
      get absoluteTransform() { return this.relativeTransform; },
      getSharedPluginData(ns: string, key: string) { return this.data.get(`${ns}:${key}`) ?? ''; },
      getSharedPluginDataKeys(ns: string) { return [...this.data.keys()].filter((k: string) => k.startsWith(`${ns}:`)).map((k: string) => k.slice(ns.length + 1)); },
      setSharedPluginData(ns: string, key: string, value: string) { this.data.set(`${ns}:${key}`, value); },
      getStyledTextSegments() { return [{ characters: this.characters, fontName: this.fontName }]; },
      getRangeAllFontNames() { return [this.fontName]; },
      insertChild(index: number, child: any) {
        if (sourceNodes.has(child.id) && child.parent !== this) throw new Error('original node reparented');
        if (this.failName === child.name) throw new Error('injected move failure');
        if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
        this.children.splice(index, 0, child); child.parent = this;
      },
      appendChild(child: any) { this.insertChild(this.children.length, child); },
      remove() { if (sourceNodes.has(this.id)) { sourceRemovals++; if (this.getSharedPluginData(NS, 'flipbookOf') !== 'fb') throw new Error('source sublayer removed'); } if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; this.removed = true; },
      clone() {
        const copy = make(this.type === 'SLOT' ? 'FRAME' : this.type, this.name);
        copy.data = new Map(this.data); copy.characters = corrupt && this.characters === 'Authored text' ? 'Corrupted' : this.characters;
        copy.visible = this.visible; copy.fontName = this.fontName; copy.width = this.width; copy.height = this.height;
        copy.failName = this.failName; copy.relativeTransform = structuredClone(this.relativeTransform);
        for (const child of this.children) copy.appendChild(child.clone());
        return copy;
      },
    };
    nodes.set(n.id, n);
    if (role) n.setSharedPluginData(NS, 'templatePart', role);
    for (const child of children) n.appendChild(child);
    return n;
  };
  const page = make('PAGE'); page.selection = []; page.loadAsync = async () => {};
  const skeleton = () => {
    const gui = make('FRAME', 'gui'), description = make('FRAME', 'description'), list = make('FRAME', 'history');
    const area = make('FRAME', 'descriptionArea', [description]);
    const root = make('FRAME', '', [make('TEXT', 'title'), make('TEXT', 'chapter'), make('TEXT', 'status'), make('FRAME', 'ids'), gui, area, list]);
    root.setSharedPluginData(NS, 'templateLinks', '{"components":{}}'); page.appendChild(root);
    return { root, gui, description, list, area };
  };
  Object.assign(globalThis, { figma: { getNodeByIdAsync: async (id: string) => nodes.get(id) ?? null, loadFontAsync: async () => {}, createFrame: () => { const n = make('FRAME'); page.appendChild(n); return n; }, skipInvisibleInstanceChildren: false, currentPage: page } });
  const template = skeleton();
  const source = skeleton(); source.root.name = 'Existing'; source.area.visible = false;
  source.root.setSharedPluginData(NS, 'flipbookOf', 'fb');
  source.root.setSharedPluginData(NS, 'flipbookNode', source.root.id);
  source.root.setSharedPluginData(NS, 'flipbookTemplate', 'old');
  const item = { id: 'fb', rev: 1, nodeId: source.root.id, pageId: page.id, title: 'Existing' };
  return { make, nodes, page, template, source, item, protect: () => { const visit = (n: any) => { sourceNodes.add(n.id); n.children.forEach(visit); }; visit(source.root); }, corrupt: () => { corrupt = true; }, removals: () => sourceRemovals };
}

test('find includes different and unknown templates, excludes current, disconnected and duplicate frames without writes', async () => {
  const w = world();
  const unknown = w.source.root.clone(); w.page.appendChild(unknown);
  unknown.setSharedPluginData(NS, 'flipbookOf', 'unknown'); unknown.setSharedPluginData(NS, 'flipbookNode', unknown.id); unknown.setSharedPluginData(NS, 'flipbookTemplate', '');
  const duplicate = w.source.root.clone(); w.page.appendChild(duplicate);
  const current = w.source.root.clone(); w.page.appendChild(current);
  current.setSharedPluginData(NS, 'flipbookOf', 'current'); current.setSharedPluginData(NS, 'flipbookNode', current.id); current.setSharedPluginData(NS, 'flipbookTemplate', w.template.root.id);
  const items = [w.item, { ...w.item, id: 'unknown', nodeId: unknown.id }, { ...w.item, nodeId: duplicate.id }, { ...w.item, id: 'current', nodeId: current.id }, { ...w.item, nodeId: 'missing' }];
  assert.deepEqual((await findTemplateMigrations(items, w.template.root.id)).map(c => [c.id, c.templateId]), [['fb', 'old'], ['unknown', null]]);
  assert.equal(duplicate.getSharedPluginData(NS, 'flipbookNode'), w.source.root.id);
});

test('copies content before replacing the root; no original sublayer is moved or removed', async () => {
  const w = world();
  const body = w.make('TEXT', 'Body'); body.characters = 'Authored text';
  w.source.description.type = 'SLOT'; w.source.description.appendChild(body);
  const previous = w.make('FRAME', 'previous', [w.make('INSTANCE', 'Row')]); w.source.list.appendChild(previous);
  const gui = w.make('FRAME', 'Tracked GUI'); gui.setSharedPluginData(NS, 'trackOf', 'track'); w.source.gui.appendChild(gui);
  w.protect();
  const result = await migrateFlipbookTemplate(w.item, w.template.root.id);
  const root = w.nodes.get(result.nodeId);
  assert.equal(w.source.root.removed, true);
  assert.equal(w.removals(), 1, 'only the old root is removed at commit');
  const all = (n: any): any[] => [n, ...n.children.flatMap(all)];
  const out = all(root);
  assert.ok(out.some(n => n.characters === 'Authored text' && n !== body));
  assert.ok(out.some(n => n.getSharedPluginData(NS, 'trackOf') === 'track' && n !== gui));
  assert.equal(w.page.children.some((n: any) => n.name === 'Template migration staging'), false);
});

test('failure after some areas have been copied leaves source hierarchy and IDs intact', async () => {
  const w = world();
  const body = w.make('TEXT', 'Body'); body.characters = 'Authored text'; w.source.description.appendChild(body);
  w.source.gui.appendChild(w.make('FRAME', 'GUI'));
  w.protect(); let calls = 0;
  await assert.rejects(migrateFlipbookTemplate(w.item, w.template.root.id, () => ++calls < 2));
  assert.equal(w.source.root.removed, false);
  assert.equal(w.source.description.children[0], body);
  assert.equal(w.removals(), 0);
  assert.equal(w.page.children.length, 2);
});

test('copy validation mismatch preserves the original and removes incomplete results', async () => {
  const w = world(); const body = w.make('TEXT', 'Body'); body.characters = 'Authored text'; w.source.description.appendChild(body);
  w.protect(); w.corrupt();
  await assert.rejects(migrateFlipbookTemplate(w.item, w.template.root.id), error => error instanceof Error && error.message === TEMPLATE_MIGRATION_COPY.templateMigrationCopyMismatch);
  assert.equal(w.source.root.removed, false);
  assert.equal(body.characters, 'Authored text');
  assert.equal(w.removals(), 0);
  assert.equal(w.page.children.length, 2);
});

test('track record follows the replacement node while retaining its identity and creation time', () => {
  const store = new Store(memoryKV());
  store.put(keys.track('track'), { id: 'track', uid: 'screen', nodeId: 'old', pageId: 'p', createdAt: 42, actor: { id: 'u', name: 'User' } });
  reconcileTracks(store, [{ nodeId: 'new', pageId: 'p', uid: 'screen', version: 1, trackId: 'track', flipbookId: 'fb' }], new Set(['p']), null, { id: 'u', name: 'User' }, () => 'unwanted');
  assert.equal(store.state.tracks.get('track')?.nodeId, 'new');
  assert.equal(store.state.tracks.get('track')?.createdAt, 42);
  assert.equal(store.state.tracks.size, 1);
});
test('controller requires a fresh scan and checks template and revision, converts selected candidates only and continues after failure', async () => {
  const store = new Store(memoryKV()); const actor = { id: 'u', name: 'User' }; const posted: ToUi[] = [];
  store.saveProject({ ...store.state.project, templateNodeId: 'new', flipbookPageIds: ['p'], flipbookPageId: 'p' });
  for (const id of ['a', 'b', 'c']) {
    const [fb] = planFlipbooks({ pageId: 'p', rows: [{ uids: [], multi: false, scale: 1, title: id }] }, new Map(), actor, 1, () => id);
    store.put(keys.flipbook(id), fb);
  }
  const called: string[] = [];
  const host = { actor, post: (m: ToUi) => posted.push(m),
    findTemplateMigrations: async (items: TemplateMigrationItem[]) => items.map(i => ({ ...i, templateId: 'old' })),
    migrateFlipbookTemplate: async (item: TemplateMigrationItem) => { called.push(item.id); if (item.id === 'a') throw new Error('failure'); return { nodeId: `new-${item.id}`, pageId: 'p' }; },
  } as unknown as Host;
  const controller = new TemplateMigrationController(host, store);
  await assert.rejects(controller.convert(['b'], 'new'));
  await controller.find(new Map(['a', 'b', 'c'].map(id => [id, `node-${id}`])));
  const c = store.state.flipbooks.get('c')!; store.put(keys.flipbook('c'), { ...c, rev: c.rev + 1 });
  const result = await controller.convert(['a', 'b', 'b', 'c', 'not-listed'], 'new');
  assert.deepEqual(called, ['a', 'b']);
  assert.deepEqual(result.converted.map(c => c.id), ['b']);
  assert.deepEqual(result.failed.map(c => c.id), ['a', 'c']);
  assert.equal(store.state.flipbooks.get('b')?.tracked, true);
  assert.equal(store.state.flipbooks.get('a')?.tracked, undefined);
  store.saveProject({ ...store.state.project, templateNodeId: 'other' });
  await assert.rejects(controller.convert(['a'], 'new'));
});

test('migration candidates sort by Screen ID with numeric order and unidentified items last', () => {
  const item = (id: string, screenId?: string) => ({ id, screenId, nodeId: id, pageId: 'p', title: id, rev: 1, templateId: 'old' });
  const input = [item('missing'), item('ten', 'ST_SE_010'), item('other', 'ST_VD_001'), item('two', 'ST_SE_002'), item('lower', 'st_se_003')];
  assert.deepEqual(sortTemplateMigrations(input).map(i => i.id), ['two', 'lower', 'ten', 'other', 'missing']);
  assert.equal(input[0].id, 'missing');
});
