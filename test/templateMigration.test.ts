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
      primaryAxisSizingMode: 'FIXED', counterAxisSizingMode: 'FIXED', minHeight: null, maxHeight: null,
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
      resizeWithoutConstraints(width: number, height: number) {
        this.width = width; this.height = this.rejectHeight ? this.height : Math.min(this.maxHeight ?? Infinity, Math.max(this.minHeight ?? 0, height));
        this.layoutSizingHorizontal = 'FIXED'; this.layoutSizingVertical = 'FIXED';
        this.primaryAxisSizingMode = 'FIXED'; this.counterAxisSizingMode = 'FIXED';
      },
      remove() { if (sourceNodes.has(this.id)) { sourceRemovals++; if (this.getSharedPluginData(NS, 'flipbookOf') !== 'fb') throw new Error('source sublayer removed'); } if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; this.removed = true; },
      clone() {
        const copy = make(this.type === 'SLOT' ? 'FRAME' : this.type, this.name);
        copy.data = new Map(this.data); copy.characters = corrupt && this.characters === 'Authored text' ? 'Corrupted' : this.characters;
        copy.visible = this.visible; copy.fontName = this.fontName; copy.width = this.width; copy.height = this.height;
        copy.failName = this.failName; copy.relativeTransform = structuredClone(this.relativeTransform);
        for (const key of ['layoutMode', 'layoutPositioning', 'layoutSizingHorizontal', 'layoutSizingVertical', 'primaryAxisSizingMode', 'counterAxisSizingMode', 'minHeight', 'maxHeight', 'rejectHeight']) copy[key] = this[key];
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

test('preserves each original outer-frame height while retaining the representative width and width sizing', async () => {
  for (const layoutMode of ['NONE', 'VERTICAL', 'HORIZONTAL']) for (const height of [1080, 2400]) {
    const w = world(); w.source.root.height = height;
    w.template.root.width = 2544; w.template.root.height = 1435; w.template.root.layoutMode = layoutMode;
    w.template.root.layoutSizingVertical = 'HUG'; w.template.root.layoutSizingHorizontal = 'HUG';
    w.template.root.primaryAxisSizingMode = 'AUTO'; w.template.root.counterAxisSizingMode = 'AUTO';
    w.source.gui.appendChild(w.make('FRAME', 'Authored GUI')); w.protect();
    const result = await migrateFlipbookTemplate(w.item, w.template.root.id);
    const root = w.nodes.get(result.nodeId);
    assert.equal(root.height, height, layoutMode);
    assert.equal(root.width, 2544);
    assert.equal(root.layoutSizingVertical, 'FIXED');
    assert.equal(root.layoutSizingHorizontal, 'HUG');
    if (layoutMode !== 'NONE') assert.equal(layoutMode === 'VERTICAL' ? root.counterAxisSizingMode : root.primaryAxisSizingMode, 'AUTO');
    const gui = root.children.find((n: any) => n.getSharedPluginData(NS, 'templatePart') === 'gui');
    assert.deepEqual([gui.children[0].width, gui.children[0].height], [480, 150], 'authored GUI is not scaled');
  }
});

test('sizes the template before inserting content so resize constraints cannot shift authored positions', async () => {
  for (const height of [1080, 2400]) {
    const w = world(); w.source.root.height = height; w.template.root.height = 1435;
    const authored = w.make('FRAME', 'Authored GUI');
    authored.relativeTransform = [[1, 0, 32], [0, 1, 64]];
    w.source.gui.appendChild(authored);
    const clone = w.template.root.clone;
    w.template.root.clone = function () {
      const copy = clone.call(this), resize = copy.resizeWithoutConstraints;
      copy.resizeWithoutConstraints = function (width: number, nextHeight: number) {
        const delta = nextHeight - this.height;
        resize.call(this, width, nextHeight);
        // Model a bottom-constrained authored child following a root resize.
        const shift = (node: any) => {
          if (node.name === 'Authored GUI') node.relativeTransform[1][2] += delta;
          node.children.forEach(shift);
        };
        shift(this);
      };
      return copy;
    };
    w.protect();
    const result = await migrateFlipbookTemplate(w.item, w.template.root.id);
    const root = w.nodes.get(result.nodeId);
    const gui = root.children.find((n: any) => n.getSharedPluginData(NS, 'templatePart') === 'gui');
    assert.equal(root.height, height);
    assert.deepEqual(gui.children[0].relativeTransform, authored.relativeTransform);
  }
});

test('clears only representative height limits that conflict with the original height', async () => {
  for (const [height, min, max, expectedMin, expectedMax] of [[1080, 1435, 3000, null, 3000], [2400, 600, 1435, 600, null]]) {
    const w = world(); w.source.root.height = height; w.template.root.minHeight = min; w.template.root.maxHeight = max;
    const result = await migrateFlipbookTemplate(w.item, w.template.root.id);
    const root = w.nodes.get(result.nodeId);
    assert.deepEqual([root.height, root.minHeight, root.maxHeight], [height, expectedMin, expectedMax]);
  }
});

test('height-preservation failure leaves the original frame intact and removes the incomplete replacement', async () => {
  const w = world(); w.source.root.height = 1080; w.template.root.height = 1435; w.template.root.rejectHeight = true; w.protect();
  await assert.rejects(migrateFlipbookTemplate(w.item, w.template.root.id), new Error(TEMPLATE_MIGRATION_COPY.templateMigrationHeightMismatch));
  assert.equal(w.removals(), 0);
  assert.equal(w.source.root.height, 1080);
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

test('a target without a status field preserves hidden legacy status and its hidden UI Title container', async () => {
  const w = world();
  w.template.root.children[2].remove();
  const status = w.source.root.children[2]; status.type = 'INSTANCE';
  const label = w.make('TEXT', 'Label'); label.characters = 'Original status'; status.appendChild(label);
  const oldTitle = w.make('TEXT', 'title'); oldTitle.characters = 'Legacy title';
  const hidden = w.make('INSTANCE', 'UI Title', [oldTitle, status]);
  hidden.setSharedPluginData(NS, 'templatePart', 'pdfHidden'); hidden.visible = false;
  w.source.root.insertChild(0, hidden);
  w.source.gui.appendChild(w.make('FRAME', 'GUI content'));
  w.protect();
  const result = await migrateFlipbookTemplate(w.item, w.template.root.id);
  const root = w.nodes.get(result.nodeId);
  const gui = root.children.find((n: any) => n.getSharedPluginData(NS, 'templatePart') === 'gui');
  const preserved = gui.children.find((n: any) => n.name === 'UI Title');
  assert.equal(preserved.visible, false, 'hidden status is never made visible');
  assert.equal(preserved.children[0].characters, 'Legacy title');
  assert.equal(preserved.children[1].children[0].characters, 'Original status');
  assert.equal(root.children.find((n: any) => n.getSharedPluginData(NS, 'templatePart') === 'title').characters, 'Text');
  assert.equal(gui.children.filter((n: any) => n.name === 'GUI content').length, 1);
  assert.equal(w.removals(), 1);
});

test('a directly hidden status is preserved when the target omits the optional status field', async () => {
  const w = world(); w.template.root.children[2].remove();
  const status = w.source.root.children[2]; status.visible = false; status.characters = 'Hidden status';
  w.protect();
  const result = await migrateFlipbookTemplate(w.item, w.template.root.id);
  const gui = w.nodes.get(result.nodeId).children.find((n: any) => n.getSharedPluginData(NS, 'templatePart') === 'gui');
  assert.equal(gui.children[0].characters, 'Hidden status');
  assert.equal(gui.children[0].visible, false);
  assert.equal(w.removals(), 1);
});

test('a missing target status field still protects visible source status and keeps the original', async () => {
  const w = world(); w.template.root.children[2].remove(); w.protect();
  await assert.rejects(migrateFlipbookTemplate(w.item, w.template.root.id),
    new Error(`${TEMPLATE_MIGRATION_COPY.templateMigrationTargetAreaMissing} ${COPY.coreTemplate005}`));
  assert.equal(w.removals(), 0);
  assert.equal(w.page.children.length, 2);
});

test('hidden-status copy validation failure retains the complete original and cleans up staging', async () => {
  const w = world(); w.template.root.children[2].remove();
  const status = w.source.root.children[2]; status.visible = false; status.characters = 'Authored text';
  w.protect(); w.corrupt();
  await assert.rejects(migrateFlipbookTemplate(w.item, w.template.root.id), new Error(TEMPLATE_MIGRATION_COPY.templateMigrationCopyMismatch));
  assert.equal(w.removals(), 0);
  assert.equal(status.characters, 'Authored text');
  assert.equal(w.page.children.length, 2);
});

test('a legacy template status deleted from the source does not block resolving its unmarked GUI area', async () => {
  const w = world(); w.template.root.children[2].remove();
  const origin = w.source.root.clone(); w.page.appendChild(origin);
  const oldStatus = origin.children[2];
  const hidden = w.make('INSTANCE', 'UI Title', [oldStatus]); hidden.visible = false;
  origin.insertChild(0, hidden);
  w.source.root.setSharedPluginData(NS, 'flipbookTemplate', origin.id);
  w.source.root.children[2].remove();
  w.source.gui.setSharedPluginData(NS, 'templatePart', '');
  w.source.gui.appendChild(w.make('FRAME', 'GUI content'));
  w.protect();
  const result = await migrateFlipbookTemplate(w.item, w.template.root.id);
  const gui = w.nodes.get(result.nodeId).children.find((n: any) => n.getSharedPluginData(NS, 'templatePart') === 'gui');
  assert.equal(gui.children[0].name, 'GUI content');
  assert.equal(w.removals(), 1);
});

function unmarkedSource(w: ReturnType<typeof world>, recorded = true, links = true) {
  const template = w.source.root.clone(); w.page.appendChild(template);
  template.setSharedPluginData(NS, 'flipbookOf', '');
  template.setSharedPluginData(NS, 'flipbookNode', '');
  template.setSharedPluginData(NS, 'flipbookTemplate', '');
  w.source.root.setSharedPluginData(NS, 'flipbookTemplate', recorded ? template.id : '');
  if (!links) w.source.root.setSharedPluginData(NS, 'templateLinks', '');
  const clear = (n: any) => { n.setSharedPluginData(NS, 'templatePart', ''); n.children.forEach(clear); };
  clear(w.source.root);
  return template;
}

test('uses the connected original template for an unmarked source, preserving GUI, Description, IDs, history and hidden state', async () => {
  const w = world();
  w.source.gui.name = 'Artwork'; w.source.description.name = 'Authored description'; w.source.list.name = 'Release log';
  const origin = unmarkedSource(w);
  w.source.gui.appendChild(w.make('FRAME', 'Tracked content'));
  w.source.description.type = 'SLOT';
  const body = w.make('TEXT', 'Body'); body.characters = 'Authored text'; w.source.description.appendChild(body);
  w.source.list.appendChild(w.make('INSTANCE', 'History row'));
  const ids = w.source.root.children[3]; ids.appendChild(w.make('TEXT', 'Screen ID'));
  w.source.root.children[0].characters = 'Original title';
  w.source.root.children[1].characters = 'Original chapter';
  w.source.root.children[2].characters = 'Original status';
  // Same named GUI copies are not area candidates; inserting and reordering
  // siblings must not cause index-based matching to copy the wrong content.
  const copy = w.make('FRAME', 'Artwork'); copy.setSharedPluginData(NS, 'guiCopy', 'screen');
  w.source.root.insertChild(0, copy);
  w.source.root.appendChild(w.source.gui);
  const originBefore = origin.getSharedPluginDataKeys(NS).map((k: string) => [k, origin.getSharedPluginData(NS, k)]);
  w.protect();
  const result = await migrateFlipbookTemplate(w.item, w.template.root.id);
  const root = w.nodes.get(result.nodeId);
  const all = (n: any): any[] => [n, ...n.children.flatMap(all)];
  const out = all(root);
  for (const text of ['Authored text', 'Original title', 'Original chapter', 'Original status'])
    assert.ok(out.some(n => n.type === 'TEXT' && n.characters === text), text);
  for (const name of ['Tracked content', 'History row', 'Screen ID']) assert.ok(out.some(n => n.name === name), name);
  assert.equal(out.find(n => n.getSharedPluginData(NS, 'templatePart') === 'descriptionArea').visible, false);
  assert.equal(w.source.gui.getSharedPluginData(NS, 'templatePart'), '', 'source is never repaired or marked during reading');
  assert.deepEqual(origin.getSharedPluginDataKeys(NS).map((k: string) => [k, origin.getSharedPluginData(NS, k)]), originBefore);
  assert.equal(w.removals(), 1);
});

test('discovers a unique registered template when the original template and links records are absent', async () => {
  const w = world();
  w.source.gui.name = 'Canvas area';
  const origin = unmarkedSource(w, false, false);
  w.source.gui.appendChild(w.make('FRAME', 'GUI content'));
  w.protect();
  const result = await migrateFlipbookTemplate(w.item, w.template.root.id, () => true, [w.template.root.id, 'deleted', origin.id]);
  assert.ok(w.nodes.get(result.nodeId).children.some((n: any) => n.getSharedPluginData(NS, 'templatePart') === 'gui' && n.children.some((c: any) => c.name === 'GUI content')));
  assert.equal(w.removals(), 1);
});

test('keeps surviving role marks even when those layers moved, and fills only missing areas from the template', async () => {
  const w = world();
  unmarkedSource(w);
  w.source.gui.setSharedPluginData(NS, 'templatePart', 'gui');
  w.source.root.children[0].setSharedPluginData(NS, 'templatePart', 'title');
  w.source.root.children[0].name = 'Renamed title';
  w.source.root.appendChild(w.make('FRAME', 'Authored wrapper', [w.source.gui]));
  const body = w.make('TEXT', 'Body'); body.characters = 'Authored text'; w.source.description.appendChild(body);
  w.source.gui.appendChild(w.make('FRAME', 'Correct GUI'));
  w.protect();
  const result = await migrateFlipbookTemplate(w.item, w.template.root.id);
  const all = (n: any): any[] => [n, ...n.children.flatMap(all)];
  const out = all(w.nodes.get(result.nodeId));
  const description = out.find(n => n.getSharedPluginData(NS, 'templatePart') === 'description');
  assert.equal(description.children[0].characters, 'Authored text');
  assert.ok(out.some(n => n.name === 'Correct GUI'));
  assert.equal(w.removals(), 1);
});

test('matches component ancestors instantiated in the original flipbook', async () => {
  const w = world();
  const title = w.source.root.children[0]; title.characters = 'Authored title';
  const header = w.make('COMPONENT', 'Header', [title]); w.source.root.insertChild(0, header);
  unmarkedSource(w);
  header.type = 'INSTANCE';
  w.source.gui.appendChild(w.make('FRAME', 'GUI content'));
  w.protect();
  const result = await migrateFlipbookTemplate(w.item, w.template.root.id);
  const outTitle = w.nodes.get(result.nodeId).children.find((n: any) => n.getSharedPluginData(NS, 'templatePart') === 'title');
  assert.equal(outTitle.characters, 'Authored title');
  assert.equal(w.removals(), 1);
});

test('a recorded original template wins over other compatible templates', async () => {
  const w = world();
  const origin = unmarkedSource(w);
  const other = origin.clone(); w.page.appendChild(other);
  const otherGui = other.children.find((n: any) => n.name === 'gui');
  otherGui.setSharedPluginData(NS, 'templatePart', '');
  other.children.find((n: any) => n.name === 'ids').setSharedPluginData(NS, 'templatePart', 'gui');
  w.source.gui.appendChild(w.make('FRAME', 'Correct GUI'));
  const result = await migrateFlipbookTemplate(w.item, w.template.root.id, () => true, [other.id]);
  const gui = w.nodes.get(result.nodeId).children.find((n: any) => n.getSharedPluginData(NS, 'templatePart') === 'gui');
  assert.equal(gui.children[0].name, 'Correct GUI');
});

test('ambiguous registered template bindings keep the complete unmarked source untouched', async () => {
  const w = world();
  const origin = unmarkedSource(w, false);
  const other = origin.clone(); w.page.appendChild(other);
  other.children.find((n: any) => n.name === 'gui').setSharedPluginData(NS, 'templatePart', '');
  other.children.find((n: any) => n.name === 'ids').setSharedPluginData(NS, 'templatePart', 'gui');
  const before = [...w.page.children]; w.protect();
  await assert.rejects(migrateFlipbookTemplate(w.item, w.template.root.id, () => true, [origin.id, other.id]),
    new Error(TEMPLATE_MIGRATION_COPY.templateMigrationSourceAmbiguous));
  assert.equal(w.removals(), 0);
  assert.deepEqual(w.page.children, before);
});

test('duplicate named areas or a changed hierarchy cannot be resolved by sibling index', async () => {
  for (const failure of ['duplicate', 'hierarchy', 'type']) {
    const w = world();
    unmarkedSource(w);
    if (failure === 'duplicate') {
      const duplicate = w.make('FRAME', 'gui'); duplicate.setSharedPluginData(NS, 'templatePart', '');
      w.source.root.appendChild(duplicate);
    }
    if (failure === 'hierarchy') w.source.root.appendChild(w.make('FRAME', 'new wrapper', [w.source.gui]));
    if (failure === 'type') w.source.gui.type = 'GROUP';
    const before = [...w.page.children]; w.protect();
    await assert.rejects(migrateFlipbookTemplate(w.item, w.template.root.id), new Error(TEMPLATE_MIGRATION_COPY.templateMigrationSourceGuiMissing));
    assert.equal(w.removals(), 0, failure);
    assert.deepEqual(w.page.children, before);
  }
});

test('an original template edit during preparation discards the copy and keeps all original nodes', async () => {
  const w = world();
  const origin = unmarkedSource(w);
  w.source.gui.appendChild(w.make('FRAME', 'GUI content'));
  w.protect(); let edited = false;
  await assert.rejects(migrateFlipbookTemplate(w.item, w.template.root.id, () => {
    if (!edited) { edited = true; origin.children[0].name = 'Changed title connection path'; }
    return true;
  }), new Error(TEMPLATE_MIGRATION_COPY.templateMigrationChanged));
  assert.equal(w.removals(), 0);
  assert.equal(w.source.gui.children[0].name, 'GUI content');
  assert.equal(w.page.children.length, 3);
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
  store.saveProject({ ...store.state.project, templateNodeId: 'new', previousTemplates: [{ nodeId: 'old', name: 'Original' }], flipbookPageIds: ['p'], flipbookPageId: 'p' });
  for (const id of ['a', 'b', 'c']) {
    const [fb] = planFlipbooks({ pageId: 'p', rows: [{ uids: [], multi: false, scale: 1, title: id }] }, new Map(), actor, 1, () => id);
    store.put(keys.flipbook(id), fb);
  }
  const called: string[] = [];
  const host = { actor, post: (m: ToUi) => posted.push(m),
    findTemplateMigrations: async (items: TemplateMigrationItem[]) => items.map(i => ({ ...i, templateId: 'old' })),
    migrateFlipbookTemplate: async (item: TemplateMigrationItem, templateId: string, current: () => boolean, sourceTemplateIds: string[]) => {
      assert.equal(templateId, 'new'); assert.deepEqual(sourceTemplateIds, ['old']); assert.equal(current(), true);
      called.push(item.id); if (item.id === 'a') throw new Error('failure'); return { nodeId: `new-${item.id}`, pageId: 'p' };
    },
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
