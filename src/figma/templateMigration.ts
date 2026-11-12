import { TEMPLATE_MIGRATION_COPY } from '../core/templateMigrationCopy.ts';
import { COPY } from '../core/copy.ts';
import { sha256 } from '../core/hash.ts';
import { HISTORY_LATEST_AT } from '../core/historyNotices.ts';
import type { TemplateMigrationCandidate, TemplateMigrationItem } from '../core/templateMigration.ts';
import { FLIPBOOK_KEY, NODE_KEY, TEMPLATE_KEY, instantiate } from './flipbook.ts';
import { keepModes } from './layers.ts';
import { flipbookParts, namedParts, NS, pageOf, tagKit, type Parts } from './template.ts';
import { migrationSource } from './templateMigrationSource.ts';

type Box = (FrameNode | SlotNode);
type Area = 'gui' | 'description' | 'ids' | 'list' | 'previous';
interface Plan { from: Box; area: Area; label: string; absolute: boolean }
const asBox = (node: SceneNode | null): Box | null => node?.type === 'FRAME' || node?.type === 'SLOT' ? node : null;
const inside = (node: BaseNode, root: BaseNode): boolean => {
  for (let n: BaseNode | null = node; n; n = n.parent) if (n === root) return true;
  return false;
};
async function original(item: TemplateMigrationItem): Promise<FrameNode> {
  const node = await figma.getNodeByIdAsync(item.nodeId);
  if (node?.type !== 'FRAME' || node.removed || node.getSharedPluginData(NS, FLIPBOOK_KEY) !== item.id ||
      node.getSharedPluginData(NS, NODE_KEY) !== node.id || pageOf(node)?.id !== item.pageId) throw new Error(TEMPLATE_MIGRATION_COPY.templateMigrationMissing);
  return node;
}
export async function findTemplateMigrations(items: TemplateMigrationItem[], templateId: string): Promise<TemplateMigrationCandidate[]> {
  const out: TemplateMigrationCandidate[] = [];
  for (const item of items) {
    try {
      const frame = await original(item);
      const from = frame.getSharedPluginData(NS, TEMPLATE_KEY) || null;
      if (from !== templateId) out.push({ ...item, templateId: from });
    } catch { /* Disconnected frames and duplicates are not candidates. */ }
  }
  return out;
}
// A clone must retain all authored text (including rich spans), style, hierarchy,
// component/track metadata and visibility. Root placement is checked separately:
// the destination layout is allowed to resize a flow item.
function content(node: SceneNode, identity = false): unknown {
  const value: Record<string, unknown> = {
    type: node.type === 'SLOT' ? 'FRAME' : node.type, name: node.name, visible: node.visible,
    opacity: 'opacity' in node ? node.opacity : undefined, effects: 'effects' in node ? node.effects : undefined,
    fills: 'fills' in node ? node.fills : undefined, strokes: 'strokes' in node ? node.strokes : undefined,
    data: node.getSharedPluginDataKeys(NS).sort().map(key => [key, node.getSharedPluginData(NS, key)]),
  };
  if (identity) Object.assign(value, { id: node.id, transform: node.relativeTransform, width: node.width, height: node.height });
  if (node.type === 'TEXT') Object.assign(value, {
    text: node.characters, fontName: node.fontName, fontSize: node.fontSize, textAutoResize: node.textAutoResize,
    textAlignHorizontal: node.textAlignHorizontal, textAlignVertical: node.textAlignVertical,
    spans: node.getStyledTextSegments(['fontName', 'fontSize', 'fills', 'textDecoration', 'textCase', 'letterSpacing', 'lineHeight']),
  });
  if ('children' in node) value.children = node.children.map(child => content(child, identity));
  return value;
}
const signature = (node: SceneNode, identity = false) => sha256(JSON.stringify(content(node, identity)));
const texts = (node: SceneNode): TextNode[] => node.type === 'TEXT' ? [node] : 'children' in node ? node.children.flatMap(texts) : [];
async function loadFonts(nodes: TextNode[], cache: Map<string, Promise<void>>): Promise<void> {
  for (const node of nodes) {
    const fonts = node.characters.length ? node.getRangeAllFontNames(0, node.characters.length) : [node.fontName as FontName];
    for (const font of fonts) {
      const key = JSON.stringify(font);
      if (!cache.has(key)) cache.set(key, figma.loadFontAsync(font));
    }
  }
  await Promise.all(cache.values());
}
function extraLayers(root: FrameNode, source: Parts): SceneNode[] {
  const terminals = [source.gui, source.description, source.descriptionArea, source.list, source.previous, source.ids,
    source.chapter, source.status, ...source.titles].filter((n): n is SceneNode => !!n);
  const information = [source.chapter, source.status, source.ids, ...source.titles];
  if (!source.links) {
    const named = namedParts(root);
    terminals.push(...[named.header, named.title, named.history].filter((n): n is InstanceNode | ComponentNode => !!n));
  }
  const out: SceneNode[] = [];
  const walk = (parent: ChildrenMixin) => {
    for (const child of parent.children) {
      if (terminals.includes(child)) continue;
      const contained = terminals.filter(n => inside(n, child));
      if (!contained.length) out.push(child);
      else if (child.type !== 'INSTANCE' && !contained.every(n => information.includes(n)) && 'children' in child) walk(child);
    }
  };
  walk(root);
  return out;
}
function hiddenStatus(root: FrameNode, source: Parts): SceneNode | null {
  const areas = [source.gui, source.ids, source.description, source.descriptionArea, source.list, source.previous];
  for (let node: BaseNode | null = source.status; node && node !== root; node = node.parent) {
    if ('visible' in node && !node.visible) {
      // Preserve the hidden container, including its effective visibility. A
      // container holding another migrated area would duplicate authored data.
      return areas.some(area => area && inside(area, node)) ? null : node as SceneNode;
    }
  }
  return null;
}
function relativeTo(node: SceneNode, gui: FrameNode): Transform {
  const a = node.absoluteTransform, g = gui.absoluteTransform;
  const det = g[0][0] * g[1][1] - g[0][1] * g[1][0];
  if (Math.abs(det) < 1e-8) throw new Error(TEMPLATE_MIGRATION_COPY.templateMigrationInvalidTransform);
  const x = a[0][2] - g[0][2], y = a[1][2] - g[1][2];
  return [
    [(g[1][1]*a[0][0]-g[0][1]*a[1][0])/det, (g[1][1]*a[0][1]-g[0][1]*a[1][1])/det, (g[1][1]*x-g[0][1]*y)/det],
    [(-g[1][0]*a[0][0]+g[0][0]*a[1][0])/det, (-g[1][0]*a[0][1]+g[0][0]*a[1][1])/det, (-g[1][0]*x+g[0][0]*y)/det],
  ];
}
function removeTemporary(node: FrameNode | null): void {
  if (node && !node.removed) node.remove();
}

export async function migrateFlipbookTemplate(item: TemplateMigrationItem, templateId: string, isCurrent: () => boolean = () => true, sourceTemplateIds: string[] = []): Promise<{ nodeId: string; pageId: string }> {
  const skip = figma.skipInvisibleInstanceChildren;
  figma.skipInvisibleInstanceChildren = false;
  try { return await prepareMigration(item, templateId, isCurrent, sourceTemplateIds); }
  finally { figma.skipInvisibleInstanceChildren = skip; }
}
async function prepareMigration(item: TemplateMigrationItem, templateId: string, isCurrent: () => boolean, sourceTemplateIds: string[]): Promise<{ nodeId: string; pageId: string }> {
  const old = await original(item);
  if (old.getSharedPluginData(NS, TEMPLATE_KEY) === templateId) return { nodeId: old.id, pageId: item.pageId };
  const resolved = await migrationSource(old, sourceTemplateIds.filter(id => id !== templateId));
  const source = resolved.parts;
  if (!source.gui) throw new Error(TEMPLATE_MIGRATION_COPY.templateMigrationSourceGuiMissing);
  const templateBefore = resolved.template ? signature(resolved.template, true) : null;
  const before = signature(old, true);
  const kit = await tagKit(templateId);
  if (inside(kit.template, old) || inside(old, kit.template)) throw new Error(TEMPLATE_MIGRATION_COPY.templateMigrationContainsTemplate);
  const fonts = new Map<string, Promise<void>>();
  let staging: FrameNode | null = null, next: FrameNode | null = null;
  let ready: { nodeId: string; pageId: string } | null = null;
  const check = () => { if (!isCurrent()) throw new Error(TEMPLATE_MIGRATION_COPY.templateMigrationChanged); };
  try {
    staging = figma.createFrame();
    staging.name = 'Template migration staging'; staging.visible = false;
    next = kit.template.clone();
    next.setSharedPluginData(NS, FLIPBOOK_KEY, '');
    staging.appendChild(next);
    instantiate(kit.template, next);
    next.visible = false;
    const write = async (to: TextNode | null, from: TextNode | null, key: string) => {
      if (!from) return;
      if (!to) throw new Error(`${TEMPLATE_MIGRATION_COPY.templateMigrationTargetTextMissing} ${from.name}`);
      await loadFonts([to], fonts);
      to.characters = from.characters;
      if (key) to.setSharedPluginData(NS, key, from.getSharedPluginData(NS, key));
    };
    let target = flipbookParts(next);
    if (!target.gui) throw new Error(TEMPLATE_MIGRATION_COPY.templateMigrationTargetGuiMissing);
    for (let i = 0; i < Math.max(source.titles.length, target.titles.length); i++)
      await write(target.titles[i] ?? target.titles[0] ?? null, source.titles[i] ?? source.titles[0] ?? null, 'flipbookTitle');
    await write(target.chapter, source.chapter, 'flipbookChapter');
    let preservedStatus: SceneNode | null = null;
    if (source.status) {
      const to = target.status, from = source.status;
      if (!to) {
        preservedStatus = hiddenStatus(old, source);
        if (!preservedStatus) throw new Error(`${TEMPLATE_MIGRATION_COPY.templateMigrationTargetAreaMissing} ${COPY.coreTemplate005}`);
      } else {
        if (from.type === 'INSTANCE' && to.type === 'INSTANCE') {
          const main = await from.getMainComponentAsync();
          if (main) to.swapComponent(main);
          const properties: Record<string, string | boolean> = {};
          for (const [key, prop] of Object.entries(from.componentProperties)) if (key in to.componentProperties) properties[key] = prop.value;
          to.setProperties(properties);
        }
        const a = texts(from), b = texts(to);
        for (let i = 0; i < a.length; i++) await write(b[i] ?? null, a[i], '');
        if ('fills' in from && 'fills' in to && Array.isArray(from.fills)) to.fills = from.fills;
      }
    }
    // Swapping an instance can invalidate its sublayer objects; resolve again.
    target = flipbookParts(next);
    const previousInList = source.previous && source.list && inside(source.previous, source.list);
    const previousArea: Area = target.previous && (!target.list || !inside(target.previous, target.list)) ? 'previous' : 'list';
    const plans: Plan[] = [];
    for (const [from, area, absolute, label] of [
      [source.gui, 'gui', true, COPY.coreTemplate009], [source.description, 'description', false, COPY.coreTemplate011],
      [source.ids, 'ids', false, COPY.coreTemplate007], [source.list, 'list', false, COPY.coreTemplate013],
      [previousInList ? null : source.previous, previousArea, false, source.previous?.name ?? COPY.coreTemplate013],
    ] as const) {
      if (!from || !('children' in from) || !from.children.length) continue;
      const a = asBox(from), b = asBox(target[area]);
      if (!a || !b) throw new Error(`${TEMPLATE_MIGRATION_COPY.templateMigrationTargetAreaMissing} ${label} (${from.name})`);
      plans.push({ from: a, area, absolute, label });
    }
    for (const a of plans) for (const b of plans) if (a !== b &&
      (inside(a.from, b.from) || (a.area !== b.area && inside(target[a.area]!, target[b.area]!))))
      throw new Error(`${TEMPLATE_MIGRATION_COPY.templateMigrationOverlappingAreas} ${a.label} ? ${b.label}`);
    const extras = extraLayers(old, source);
    if (preservedStatus && !extras.some(node => inside(preservedStatus!, node))) {
      for (let i = extras.length - 1; i >= 0; i--) if (inside(extras[i], preservedStatus)) extras.splice(i, 1);
      extras.push(preservedStatus);
    }
    // Clear samples only inside the new template clone. Never remove or reparent
    // a source node: Figma invalidates instance-slot child IDs during reparenting.
    const areas: Area[] = ['gui', 'description', 'ids', 'list', ...(previousArea === 'previous' ? ['previous' as const] : [])];
    for (const area of areas) {
      const dest = asBox(flipbookParts(next)[area]);
      if (dest) while (dest.children.length) dest.children[0].remove();
    }
    const refresh = async () => { next = await figma.getNodeByIdAsync(next!.id) as FrameNode; };
    const expected = new Map<Area, string[]>();
    const put = async (node: SceneNode, area: Area, absolute: boolean, hash: string, transform = node.relativeTransform) => {
      const dest = asBox(flipbookParts(next!)[area]);
      if (!dest) throw new Error(TEMPLATE_MIGRATION_COPY.templateMigrationTargetAreaMissing);
      const size = { width: node.width, height: node.height };
      const position = 'layoutPositioning' in node ? node.layoutPositioning : 'AUTO';
      const index = dest.children.length;
      dest.appendChild(node);
      // The pre-insertion object is unusable for slot children. Only the freshly
      // resolved destination child is used from this point onward.
      await refresh();
      const freshDest = asBox(flipbookParts(next!)[area])!;
      let placed = await figma.getNodeByIdAsync(freshDest.children[index].id) as SceneNode;
      const auto = 'layoutMode' in dest && dest.layoutMode !== 'NONE';
      if (absolute || (position === 'ABSOLUTE' && auto)) {
        if (auto && 'layoutPositioning' in placed) placed.layoutPositioning = 'ABSOLUTE';
        if ('resizeWithoutConstraints' in placed) placed.resizeWithoutConstraints(size.width, size.height);
        placed.relativeTransform = transform;
      } else if (!auto) placed.relativeTransform = transform;
      const hashes = expected.get(area) ?? []; hashes.push(hash); expected.set(area, hashes);
    };
    for (const plan of plans) {
      check();
      // SlotNode.clone() produces an ordinary FrameNode on the current page.
      // It snapshots all custom content without modifying the source slot.
      await loadFonts(texts(plan.from), fonts);
      const wanted = plan.from.children.map(n => signature(n));
      let snapshot = plan.from.clone();
      staging.appendChild(snapshot);
      await keepModes(plan.from, snapshot);
      if (snapshot.children.length !== wanted.length) throw new Error(TEMPLATE_MIGRATION_COPY.templateMigrationCopyMismatch);
      let copied = 0;
      while (snapshot.children.length) {
        await put(snapshot.children[0], plan.area, plan.absolute, wanted[copied++]);
        snapshot = await figma.getNodeByIdAsync(snapshot.id) as FrameNode;
      }
      const dest = asBox(flipbookParts(next)[plan.area])!;
      for (const key of ['flipbookIds', HISTORY_LATEST_AT]) {
        const value = plan.from.getSharedPluginData(NS, key);
        if (value) dest.setSharedPluginData(NS, key, value);
      }
    }
    for (const extra of extras) {
      check();
      const transform = relativeTo(extra, source.gui);
      const hash = signature(extra);
      await loadFonts(texts(extra), fonts);
      const copy = extra.clone(); staging.appendChild(copy);
      await put(copy, 'gui', true, hash, transform);
    }
    target = flipbookParts(next);
    for (const [area, hashes] of expected) {
      const dest = asBox(target[area]);
      if (!dest || JSON.stringify(dest.children.map(n => signature(n))) !== JSON.stringify(hashes)) throw new Error(TEMPLATE_MIGRATION_COPY.templateMigrationCopyMismatch);
    }
    if (target.gui) target.gui.visible = source.gui.visible;
    if (target.description) target.description.visible = source.description?.visible ?? true;
    if (target.descriptionArea) target.descriptionArea.visible = source.descriptionArea?.visible ?? (!!source.description && source.description.visible);
    if (target.list) target.list.visible = source.list?.visible ?? true;
    await original(item); check();
    if (signature(old, true) !== before) throw new Error(TEMPLATE_MIGRATION_COPY.templateMigrationChanged);
    if (resolved.template && (resolved.template.removed || signature(resolved.template, true) !== templateBefore))
      throw new Error(TEMPLATE_MIGRATION_COPY.templateMigrationChanged);
    const parent = old.parent;
    if (!parent || !('insertChild' in parent)) throw new Error(TEMPLATE_MIGRATION_COPY.templateMigrationParentMissing);
    const transform = old.relativeTransform, position = old.layoutPositioning;
    next.name = old.name;
    next.setSharedPluginData(NS, TEMPLATE_KEY, templateId);
    next.setSharedPluginData(NS, NODE_KEY, next.id);
    next.setSharedPluginData(NS, FLIPBOOK_KEY, item.id);
    parent.insertChild(parent.children.indexOf(old), next);
    if ('layoutMode' in parent && parent.layoutMode !== 'NONE') next.layoutPositioning = position;
    next.relativeTransform = transform;
    next.visible = old.visible; next.locked = old.locked;
    ready = { nodeId: next.id, pageId: item.pageId };
    staging.remove(); staging = null;
    check();
    // This is the only destructive operation on the original, and the final
    // operation after all content validation. No rollback needs source sublayers.
    old.remove();
    return ready;
  } catch (error) {
    // Never delete the surviving complete replacement if an API failure reports
    // after the original frame has already been removed.
    if (old.removed && ready) return ready;
    removeTemporary(next);
    removeTemporary(staging);
    throw error;
  }
}
