import { COPY } from '../core/copy.ts';
import { HISTORY_LATEST_AT } from '../core/historyNotices.ts';
import type { TemplateMigrationCandidate, TemplateMigrationItem } from '../core/templateMigration.ts';
import { FLIPBOOK_KEY, NODE_KEY, TEMPLATE_KEY, instantiate } from './flipbook.ts';
import { flipbookParts, linksOf, namedParts, NS, pageOf, tagKit, type Parts } from './template.ts';

type Box = SceneNode & ChildrenMixin;
const box = (node: SceneNode | null): Box | null => node && 'children' in node && 'appendChild' in node ? node as Box : null;
const inside = (node: BaseNode, root: BaseNode): boolean => {
  for (let n: BaseNode | null = node; n; n = n.parent) if (n === root) return true;
  return false;
};
async function original(item: TemplateMigrationItem): Promise<FrameNode> {
  const node = await figma.getNodeByIdAsync(item.nodeId);
  if (node?.type !== 'FRAME' || node.removed || node.getSharedPluginData(NS, FLIPBOOK_KEY) !== item.id ||
      node.getSharedPluginData(NS, NODE_KEY) !== node.id || pageOf(node)?.id !== item.pageId) throw new Error(COPY.templateMigrationMissing);
  return node;
}
export async function findTemplateMigrations(items: TemplateMigrationItem[], templateId: string): Promise<TemplateMigrationCandidate[]> {
  const out: TemplateMigrationCandidate[] = [];
  for (const item of items) {
    try {
      const frame = await original(item);
      const from = frame.getSharedPluginData(NS, TEMPLATE_KEY) || null;
      if (from !== templateId) out.push({ ...item, templateId: from });
    } catch { /* Disconnected frames and canvas duplicates are not conversion candidates. */ }
  }
  return out;
}
function sourceParts(frame: FrameNode): Parts {
  if (linksOf(frame)) return flipbookParts(frame);
  const p = namedParts(frame);
  return { links: null, titles: [p.titleText, p.page].filter((n): n is TextNode => !!n), chapter: p.chapter,
    status: p.status, ids: p.ids, gui: p.gui, descriptionArea: null, description: p.description, list: p.list, previous: null };
}
interface Move { node: SceneNode; parent: BaseNode & ChildrenMixin; index: number; transform: Transform; positioning?: 'AUTO' | 'ABSOLUTE'; horizontal?: 'FIXED' | 'HUG' | 'FILL'; vertical?: 'FIXED' | 'HUG' | 'FILL'; width: number; height: number }

// Prepare the new skeleton before touching originals. Move user nodes rather than cloning them,
// so GUI tracking, marker instances, history keys and links to Description nodes survive.
export async function migrateFlipbookTemplate(item: TemplateMigrationItem, templateId: string, isCurrent: () => boolean = () => true): Promise<{ nodeId: string; pageId: string }> {
  const old = await original(item);
  if (old.getSharedPluginData(NS, TEMPLATE_KEY) === templateId) return { nodeId: old.id, pageId: item.pageId };
  const source = sourceParts(old);
  if (!source.gui) throw new Error(COPY.templateMigrationUnsupported);
  const kit = await tagKit(templateId);
  if (inside(kit.template, old) || inside(old, kit.template)) throw new Error(COPY.templateMigrationUnsupported);
  let next: FrameNode | null = null;
  const moves: Move[] = [];
  try {
    next = kit.template.clone();
    instantiate(kit.template, next);
    next.visible = false;
    // A staging clone must never be discovered as a second live flipbook.
    next.setSharedPluginData(NS, FLIPBOOK_KEY, '');
    const target = flipbookParts(next);
    if (!target.gui) throw new Error(COPY.templateMigrationUnsupported);
    target.gui.visible = source.gui.visible;
    if (source.description && target.description) target.description.visible = source.description.visible;
    if (source.list && target.list) target.list.visible = source.list.visible;
    const plans: { from: Box; to: Box; absolute: boolean }[] = [];
    for (const [from, to, absolute] of [
      [source.gui, target.gui, true], [source.description, target.description, false],
      [source.ids, target.ids, false], [source.list, target.list, false],
      [source.previous, target.previous ?? target.list, false],
    ] as const) {
      const a = box(from);
      if (!a?.children.length) continue;
      const b = box(to);
      if (!b) throw new Error(COPY.templateMigrationUnsupported);
      plans.push({ from: a, to: b, absolute });
    }
    for (const a of plans) for (const b of plans) if (a !== b && (inside(a.from, b.from) || (a.to !== b.to && inside(a.to, b.to))))
      throw new Error(COPY.templateMigrationUnsupported);
    const fonts = new Map<string, Promise<void>>();
    const write = async (to: TextNode | null, from: TextNode | null, key: string) => {
      if (!from) return;
      if (!to) throw new Error(COPY.templateMigrationUnsupported);
      for (const font of (to.characters.length ? to.getRangeAllFontNames(0, to.characters.length) : [to.fontName as FontName])) {
        const id = JSON.stringify(font);
        if (!fonts.has(id)) fonts.set(id, figma.loadFontAsync(font));
        await fonts.get(id);
      }
      to.characters = from.characters;
      if (key) to.setSharedPluginData(NS, key, from.getSharedPluginData(NS, key));
    };
    for (let i = 0; i < Math.max(source.titles.length, target.titles.length); i++)
      await write(target.titles[i] ?? target.titles[0] ?? null, source.titles[i] ?? source.titles[0] ?? null, 'flipbookTitle');
    await write(target.chapter, source.chapter, 'flipbookChapter');
    // Instance children cannot be replaced freely. Keep the destination node
    // and transfer its source component, properties and text overrides instead.
    if (source.status) {
      if (!target.status) throw new Error(COPY.templateMigrationUnsupported);
      const from = source.status, to = target.status;
      if (from.type === 'INSTANCE' && to.type === 'INSTANCE') {
        const main = await from.getMainComponentAsync();
        if (main) to.swapComponent(main);
        const properties: Record<string, string | boolean> = {};
        for (const [key, prop] of Object.entries(from.componentProperties))
          if (key in to.componentProperties) properties[key] = prop.value;
        to.setProperties(properties);
      }
      const texts = (n: SceneNode): TextNode[] => n.type === 'TEXT' ? [n] : 'children' in n ? n.children.flatMap(texts) : [];
      const fromTexts = texts(from), toTexts = texts(to);
      for (let i = 0; i < fromTexts.length; i++) await write(toTexts[i] ?? null, fromTexts[i], '');
      if ('fills' in from && 'fills' in to && Array.isArray(from.fills)) to.fills = from.fills;
    }
    if (target.descriptionArea) target.descriptionArea.visible = source.descriptionArea?.visible ?? !!box(source.description)?.children.length;
    // Retain unassigned layers (callouts, notes and overlays) instead of discarding
    // anything merely because it does not carry a system role.
    const terminals = [source.gui, source.description, source.descriptionArea, source.list, source.previous, source.ids,
      source.chapter, source.status, ...source.titles].filter((n): n is SceneNode => !!n);
    if (!source.links) {
      const named = namedParts(old);
      terminals.push(...[named.header, named.title, named.history].filter((n): n is ComponentNode | InstanceNode => !!n));
    }
    const extras: SceneNode[] = [];
    const collect = (root: ChildrenMixin) => {
      for (const child of root.children) {
        if (terminals.includes(child)) continue;
        if (terminals.some(n => inside(n, child))) { if ('children' in child) collect(child); }
        else extras.push(child);
      }
    };
    collect(old);
    const extraTransforms = new Map(extras.map(n => [n, n.absoluteTransform]));
    const guiTransform = source.gui.absoluteTransform;
    await original(item);
    if (!isCurrent()) throw new Error(COPY.templateMigrationChanged);
    const parent = old.parent;
    if (!parent || !('insertChild' in parent)) throw new Error(COPY.templateMigrationUnsupported);
    const index = parent.children.indexOf(old);
    parent.insertChild(index, next);
    next.name = old.name;
    next.relativeTransform = old.relativeTransform;
    if ('layoutPositioning' in old) next.layoutPositioning = old.layoutPositioning;
    const move = (node: SceneNode, to: Box, absolute: boolean, transform = node.relativeTransform) => {
      const parent = node.parent;
      if (!parent || !('insertChild' in parent)) throw new Error(COPY.templateMigrationUnsupported);
      const size = { width: node.width, height: node.height };
      moves.push({ node, parent, ...size, index: parent.children.indexOf(node), transform: node.relativeTransform,
        positioning: 'layoutPositioning' in node ? node.layoutPositioning : undefined,
        horizontal: 'layoutSizingHorizontal' in node ? node.layoutSizingHorizontal : undefined,
        vertical: 'layoutSizingVertical' in node ? node.layoutSizingVertical : undefined });
      to.appendChild(node);
      if (absolute && 'layoutMode' in to && to.layoutMode !== 'NONE' && 'layoutPositioning' in node) node.layoutPositioning = 'ABSOLUTE';
      if (absolute && 'resizeWithoutConstraints' in node) node.resizeWithoutConstraints(size.width, size.height);
      node.relativeTransform = transform;
    };
    // Clear only samples in the new clone, never nodes belonging to the source.
    const cleared = new Set<Box>();
    for (const { from, to, absolute } of plans) {
      if (!cleared.has(to)) { for (const child of [...to.children]) child.remove(); cleared.add(to); }
      for (const child of [...from.children]) move(child, to, absolute);
      for (const key of ['flipbookIds', HISTORY_LATEST_AT]) {
        const value = from.getSharedPluginData(NS, key);
        if (value) to.setSharedPluginData(NS, key, value);
      }
    }
    // Empty source regions must not retain template sample content.
    for (const area of [target.description, target.list, target.previous, target.ids, target.gui]) {
      const b = box(area);
      if (b && !cleared.has(b)) for (const child of [...b.children]) child.remove();
    }
    for (const node of extras) {
      const a = extraTransforms.get(node)!, g = guiTransform;
      const det = g[0][0] * g[1][1] - g[0][1] * g[1][0];
      if (Math.abs(det) < 1e-8) throw new Error(COPY.templateMigrationUnsupported);
      const x = a[0][2] - g[0][2], y = a[1][2] - g[1][2];
      move(node, target.gui, true, [
        [(g[1][1]*a[0][0]-g[0][1]*a[1][0])/det, (g[1][1]*a[0][1]-g[0][1]*a[1][1])/det, (g[1][1]*x-g[0][1]*y)/det],
        [(-g[1][0]*a[0][0]+g[0][0]*a[1][0])/det, (-g[1][0]*a[0][1]+g[0][0]*a[1][1])/det, (-g[1][0]*x+g[0][0]*y)/det],
      ]);
    }
    next.setSharedPluginData(NS, TEMPLATE_KEY, templateId);
    next.setSharedPluginData(NS, NODE_KEY, next.id);
    next.setSharedPluginData(NS, FLIPBOOK_KEY, item.id);
    next.visible = old.visible;
    next.locked = old.locked;
    if (pageOf(old) === figma.currentPage && figma.currentPage.selection.some(n => n === old))
      figma.currentPage.selection = [next];
    const result = { nodeId: next.id, pageId: item.pageId };
    old.remove();
    return result;
  } catch (error) {
    for (const m of moves.reverse()) {
      m.parent.insertChild(m.index, m.node);
      if (m.positioning !== undefined && 'layoutPositioning' in m.node) m.node.layoutPositioning = m.positioning;
      if (m.horizontal !== undefined && 'layoutSizingHorizontal' in m.node) m.node.layoutSizingHorizontal = m.horizontal;
      if (m.vertical !== undefined && 'layoutSizingVertical' in m.node) m.node.layoutSizingVertical = m.vertical;
      if ('resizeWithoutConstraints' in m.node) m.node.resizeWithoutConstraints(m.width, m.height);
      m.node.relativeTransform = m.transform;
    }
    next?.remove();
    throw error;
  }
}
