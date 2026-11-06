import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findTemplateMigrations, migrateFlipbookTemplate } from '../src/figma/templateMigration.ts';
import { NS } from '../src/figma/template.ts';
import { TemplateMigrationController } from '../src/templateMigrationController.ts';
import { COPY } from '../src/core/copy.ts';
import { memoryKV, Store } from '../src/core/store.ts';
import type { Host } from '../src/host.ts';

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

test('suspended migration rejects before looking up or modifying any canvas node', async () => {
  const w = world();
  let reads = 0;
  Object.assign(globalThis, { figma: { getNodeByIdAsync: () => { reads++; throw new Error('Canvas must not be touched'); } } });
  await assert.rejects(migrateFlipbookTemplate(w.item, w.template.root.id), error => error instanceof Error && error.message === COPY.templateMigrationPaused);
  assert.equal(reads, 0);
  assert.equal(w.source.root.removed, false);
});

test('controller rejects stale conversion requests before calling Host or changing records', async () => {
  const store = new Store(memoryKV());
  let called = false;
  const controller = new TemplateMigrationController({ migrateFlipbookTemplate: async () => { called = true; throw new Error('must not call'); } } as unknown as Host, store);
  await assert.rejects(controller.convert(['any'], 'template'), error => error instanceof Error && error.message === COPY.templateMigrationPaused);
  assert.equal(called, false);
  assert.equal(store.state.audit.length, 0);
});
