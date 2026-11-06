import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findTemplateMigrations, migrateFlipbookTemplate } from '../src/figma/templateMigration.ts';
import { flipbookParts, NS } from '../src/figma/template.ts';
import { TemplateMigrationController } from '../src/templateMigrationController.ts';
import { COPY } from '../src/core/copy.ts';
import { keys, memoryKV, Store } from '../src/core/store.ts';
import { planFlipbooks } from '../src/core/flipbooks.ts';
import type { Host } from '../src/host.ts';
import type { ToUi } from '../src/core/wire.ts';
import type { TemplateMigrationItem } from '../src/core/templateMigration.ts';

// Figma node boundary: model reparenting and ID preservation, and inject a
// failure after earlier moves to exercise rollback rather than just preparation.
function world() {
  let seq = 0;
  const nodes = new Map<string, any>();
  const make = (type: string, role = '', children: any[] = []): any => {
    const n: any = { id: `n${++seq}`, type, name: role, children: [], parent: null, removed: false,
      data: new Map(), characters: 'Text', fontName: { family: 'Inter', style: 'Regular' },
      layoutMode: 'NONE', layoutPositioning: 'AUTO', layoutSizingHorizontal: 'FIXED', layoutSizingVertical: 'FIXED',
      visible: true, locked: false, relativeTransform: [[1, 0, 0], [0, 1, 0]],
      get absoluteTransform() { return this.relativeTransform; },
      getSharedPluginData(ns: string, key: string) { return this.data.get(`${ns}:${key}`) ?? ''; },
      getSharedPluginDataKeys(ns: string) { return [...this.data.keys()].filter((k: string) => k.startsWith(`${ns}:`)).map((k: string) => k.slice(ns.length + 1)); },
      setSharedPluginData(ns: string, key: string, value: string) { this.data.set(`${ns}:${key}`, value); },
      getRangeAllFontNames() { return [this.fontName]; },
      insertChild(index: number, child: any) {
        if (this.failName === child.name) throw new Error('injected move failure');
        if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
        this.children.splice(index, 0, child); child.parent = this;
      },
      appendChild(child: any) { this.insertChild(this.children.length, child); },
      remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; this.removed = true; },
      clone() {
        const copy = make(this.type, this.name);
        copy.data = new Map(this.data); copy.characters = this.characters;
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
  Object.assign(globalThis, { figma: { getNodeByIdAsync: async (id: string) => nodes.get(id) ?? null, loadFontAsync: async () => {}, currentPage: page } });
  const template = skeleton();
  const source = skeleton(); source.root.name = 'Existing'; source.area.visible = false;
  source.root.setSharedPluginData(NS, 'flipbookOf', 'fb');
  source.root.setSharedPluginData(NS, 'flipbookNode', source.root.id);
  source.root.setSharedPluginData(NS, 'flipbookTemplate', 'old');
  const item = { id: 'fb', rev: 1, nodeId: source.root.id, pageId: page.id, title: 'Existing' };
  return { make, nodes, page, template, source, item };
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

test('migration preserves original user nodes, GUI tracking, history keys, hidden Description and root order; rerunning creates no copy', async () => {
  const w = world();
  const gui = w.make('FRAME', 'User GUI'), marker = w.make('INSTANCE', 'Marker'), desc = w.make('TEXT', 'Body'), row = w.make('INSTANCE', 'History');
  gui.setSharedPluginData(NS, 'trackOf', 'track'); gui.appendChild(marker); row.setSharedPluginData(NS, 'historyKey', 'batch');
  w.source.gui.appendChild(gui); w.source.description.appendChild(desc); w.source.list.appendChild(row);
  const overlay = w.make('TEXT', 'Callout'); w.source.root.appendChild(overlay);
  const index = w.page.children.indexOf(w.source.root);
  const result = await migrateFlipbookTemplate(w.item, w.template.root.id);
  const root = w.nodes.get(result.nodeId); const p = flipbookParts(root);
  assert.equal(w.page.children.indexOf(root), index);
  assert.equal(w.source.root.removed, true);
  assert.equal(p.gui?.children[0], gui);
  assert.equal(p.gui?.children[1], overlay);
  assert.equal(gui.children[0], marker);
  assert.equal(gui.getSharedPluginData(NS, 'trackOf'), 'track');
  assert.equal((p.description as any).children[0], desc);
  assert.equal(p.descriptionArea?.visible, false);
  assert.equal((p.list as any).children[0], row);
  assert.equal(row.getSharedPluginData(NS, 'historyKey'), 'batch');
  assert.equal(root.getSharedPluginData(NS, 'flipbookTemplate'), w.template.root.id);
  const count = w.page.children.length;
  assert.deepEqual(await migrateFlipbookTemplate({ ...w.item, nodeId: root.id }, w.template.root.id), result);
  assert.equal(w.page.children.length, count);
});

test('failure after GUI nodes moved restores original hierarchy, transforms and ordering and removes staging frame', async () => {
  const w = world();
  const a = w.make('FRAME', 'A'), b = w.make('FRAME', 'B'), desc = w.make('TEXT', 'User Body');
  a.relativeTransform = [[1, 0, 42], [0, 1, 56]];
  w.source.gui.appendChild(a); w.source.gui.appendChild(b); w.source.description.appendChild(desc);
  w.template.description.failName = 'User Body';
  const roots = [...w.page.children];
  await assert.rejects(migrateFlipbookTemplate(w.item, w.template.root.id), /injected/);
  assert.deepEqual(w.source.gui.children, [a, b]);
  assert.deepEqual(w.source.description.children, [desc]);
  assert.deepEqual(a.relativeTransform, [[1, 0, 42], [0, 1, 56]]);
  assert.deepEqual(w.page.children, roots);
  assert.equal(w.source.root.removed, false);
});

test('missing destination Description leaves source intact instead of discarding content', async () => {
  const w = world();
  w.source.description.appendChild(w.make('TEXT', 'Body'));
  w.template.description.remove();
  await assert.rejects(migrateFlipbookTemplate(w.item, w.template.root.id));
  assert.equal(w.source.root.removed, false);
  assert.equal(w.source.description.children.length, 1);
  assert.equal(w.page.children.length, 2);
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

test('concurrent edit before the commit boundary keeps all original nodes untouched', async () => {
  const w = world(); const child = w.make('FRAME', 'Original'); w.source.gui.appendChild(child);
  await assert.rejects(migrateFlipbookTemplate(w.item, w.template.root.id, () => false));
  assert.equal(w.source.gui.children[0], child);
  assert.equal(w.source.root.removed, false);
  assert.equal(w.page.children.length, 2);
});

test('empty source areas clear template samples and keep destination layout settings', async () => {
  const w = world();
  for (const area of [w.template.gui, w.template.description, w.template.list]) area.appendChild(w.make('TEXT', 'Sample'));
  const result = await migrateFlipbookTemplate(w.item, w.template.root.id);
  const p = flipbookParts(w.nodes.get(result.nodeId));
  assert.equal(p.gui?.children.length, 0);
  assert.equal((p.description as any).children.length, 0);
  assert.equal((p.list as any).children.length, 0);
  assert.equal(p.gui?.layoutMode, w.template.gui.layoutMode);
});

test('History containing Previous moves once and retains the wrapper, rows, background and node IDs', async () => {
  const w = world();
  const first = w.make('INSTANCE', 'First row'), second = w.make('INSTANCE', 'Second row'), bg = w.make('RECTANGLE', 'Background');
  const previous = w.make('FRAME', 'previous', [first, second, bg]);
  w.source.list.appendChild(previous);
  const result = await migrateFlipbookTemplate(w.item, w.template.root.id);
  const p = flipbookParts(w.nodes.get(result.nodeId));
  assert.deepEqual((p.list as any).children, [previous]);
  assert.equal(p.previous, previous);
  assert.deepEqual(previous.children, [first, second, bg]);
  assert.equal(w.source.root.removed, true);
});

test('fixed instance labels in Header, Description and History are not moved into GUI', async () => {
  const w = world();
  const p = flipbookParts(w.source.root);
  const headerLabel = w.make('FRAME', 'Fixed Header Label');
  const header = w.make('INSTANCE', 'Header', [headerLabel, ...p.titles, p.chapter, p.status, p.ids]);
  w.source.root.appendChild(header);
  w.source.area.setSharedPluginData(NS, 'templatePart', '');
  const descLabel = w.make('FRAME', 'Fixed Description Label');
  const descHead = w.make('INSTANCE', 'Description Head', [descLabel, w.source.description]);
  w.source.area.appendChild(descHead);
  const historyLabel = w.make('FRAME', 'Fixed History Label');
  const history = w.make('INSTANCE', 'History Head', [historyLabel, w.source.list]);
  w.source.root.appendChild(history);
  const body = w.make('TEXT', 'User body'); w.source.description.appendChild(body);
  const row = w.make('INSTANCE', 'User history'); w.source.list.appendChild(row);
  const result = await migrateFlipbookTemplate(w.item, w.template.root.id);
  const after = flipbookParts(w.nodes.get(result.nodeId));
  assert.deepEqual(after.gui?.children, []);
  assert.equal(headerLabel.parent, header);
  assert.equal(descLabel.parent, descHead);
  assert.equal(historyLabel.parent, history);
  assert.equal((after.description as any).children[0], body);
  assert.equal((after.list as any).children[0], row);
});

test('a separate Previous targets History when the template Previous sample is inside History', async () => {
  const w = world();
  const current = w.make('INSTANCE', 'Current row'); w.source.list.appendChild(current);
  const archived = w.make('INSTANCE', 'Archived row');
  w.source.root.appendChild(w.make('FRAME', 'previous', [archived]));
  const sample = w.make('FRAME', 'previous', [w.make('INSTANCE', 'Sample')]); w.template.list.appendChild(sample);
  const result = await migrateFlipbookTemplate(w.item, w.template.root.id);
  const p = flipbookParts(w.nodes.get(result.nodeId));
  assert.deepEqual((p.list as any).children, [current, archived]);
});

test('missing destination reports the affected area and preserves the original', async () => {
  const w = world(); w.source.description.appendChild(w.make('TEXT', 'Body')); w.template.description.remove();
  await assert.rejects(migrateFlipbookTemplate(w.item, w.template.root.id), error =>
    error instanceof Error && error.message.includes(COPY.templateMigrationTargetAreaMissing) && error.message.includes(COPY.coreTemplate011));
  assert.equal(w.source.root.removed, false);
});
