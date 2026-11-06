import { migrateFlipbookTemplate } from '../src/figma/templateMigration.ts';
import { flipbookParts, NS } from '../src/figma/template.ts';
import { linksValue, LINKS_KEY, PART_KEY } from '../src/core/templateParts.ts';

const check = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const font = { family: 'Inter', style: 'Regular' };
const bold = { family: 'Inter', style: 'Bold' };
const role = <T extends SceneNode>(node: T, part: string): T => { node.setSharedPluginData(NS, PART_KEY, part); return node; };
function text(value: string): TextNode {
  const node = figma.createText(); node.fontName = font; node.fontSize = 14; node.characters = value;
  node.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }];
  return node;
}
function frame(name: string, width = 480, height = 180): FrameNode {
  const node = figma.createFrame(); node.name = name; node.resize(width, height); node.clipsContent = false;
  return node;
}
function slot(component: ComponentNode, part: string): SlotNode {
  const area = role(component.createSlot(), part); area.name = part; area.resize(440, 150);
  area.layoutMode = 'VERTICAL'; area.primaryAxisSizingMode = 'AUTO'; area.counterAxisSizingMode = 'FIXED';
  area.itemSpacing = 8;
  return area;
}
function words(root: SceneNode): string[] { return root.type === 'TEXT' ? [root.characters] : 'children' in root ? root.children.flatMap(words) : []; }
function stamp(root: SceneNode): string {
  return JSON.stringify({ id: root.id, name: root.name, type: root.type, visible: root.visible,
    text: root.type === 'TEXT' ? root.characters : undefined,
    spans: root.type === 'TEXT' ? root.getStyledTextSegments(['fontName', 'fontSize', 'fills']) : undefined,
    children: 'children' in root ? root.children.map(stamp) : undefined });
}

export async function setup() {
  figma.skipInvisibleInstanceChildren = false;
  await Promise.all([figma.loadFontAsync(font), figma.loadFontAsync(bold)]);
  const page = figma.currentPage;
  const starting = new Set(page.findAll().map(n => n.id));
  const section = figma.createSection(); section.name = 'Native slot copy and failure tests'; section.x = 300; section.y = 500; section.resizeWithoutConstraints(2600, 2400);
  const header = figma.createComponent(); header.name = 'Fixture Header'; header.resize(480, 120); header.x = 300; header.y = 3000;
  const chapter = role(text('Chapter value'), 'chapter'); header.appendChild(chapter);
  const title = role(text('Page title value'), 'title'); header.appendChild(title); title.y = 24;
  const ids = slot(header, 'ids'); ids.y = 48;
  const desc = figma.createComponent(); desc.name = 'Fixture Description'; desc.resize(480, 240); desc.x = 850; desc.y = 3000;
  const heading = text('Description heading'); desc.appendChild(heading);
  const description = slot(desc, 'description'); description.y = 28;
  const history = figma.createComponent(); history.name = 'Fixture History'; history.resize(480, 240); history.x = 1400; history.y = 3000;
  history.appendChild(text('History heading')); const list = slot(history, 'history'); list.y = 28;
  const row = figma.createComponent(); row.name = 'Fixture row'; row.resize(400, 40); row.x = 1950; row.y = 3000;
  role(row, 'row'); row.appendChild(text('Existing history row'));
  const marker = figma.createComponent(); marker.name = 'Fixture marker'; marker.resize(30, 30); marker.x = 2400; marker.y = 3000; marker.appendChild(text('1'));
  const book = (name: string) => {
    const root = frame(name, 1500, 800); section.appendChild(root);
    root.setSharedPluginData(NS, LINKS_KEY, linksValue({ components: { row: row.id, marker: marker.id } }));
    const h = header.createInstance(); root.appendChild(h);
    const gui = role(frame('GUI Image Slot', 900, 600), 'gui'); root.appendChild(gui); gui.y = 140;
    const panel = role(frame('Description Panel', 480, 240), 'descriptionArea'); root.appendChild(panel); panel.x = 1000;
    panel.appendChild(desc.createInstance());
    const hist = history.createInstance(); root.appendChild(hist); hist.x = 1000; hist.y = 300;
    return root;
  };
  const template = book('New representative template'); template.x = 1600; template.y = 100;
  const makeSource = (id: string, x: number, y: number): FrameNode => {
    const root = book(`Source ${id}`); root.x = x; root.y = y;
    root.setSharedPluginData(NS, 'flipbookOf', id); root.setSharedPluginData(NS, 'flipbookNode', root.id); root.setSharedPluginData(NS, 'flipbookTemplate', 'old-template');
    let p = flipbookParts(root);
    p.chapter!.characters = 'Source chapter'; p.titles[0].characters = `Source title ${id}`;
    const code = text('SCREEN_001'); (p.ids as SlotNode).appendChild(code);
    const body = frame('Authored body', 420, 150); body.layoutMode = 'VERTICAL'; body.primaryAxisSizingMode = 'AUTO';
    const rich = text('Bold red and styled text'); rich.setRangeFontName(0, 4, bold); body.appendChild(rich);
    body.appendChild(text('Second paragraph'));
    (p.description as SlotNode).appendChild(body);
    // Re-resolve after every mutation of an instance slot.
    p = flipbookParts(root); (p.description as SlotNode).appendChild(text('Third independent item'));
    const previous = role(frame('Previous', 420, 100), 'previous');
    const first = row.createInstance(); first.setSharedPluginData(NS, 'historyKey', 'history-1'); previous.appendChild(first);
    const second = row.createInstance(); second.setSharedPluginData(NS, 'historyKey', 'history-2'); previous.appendChild(second); second.y = 45;
    const bg = figma.createRectangle(); bg.name = 'Previous background'; previous.appendChild(bg);
    p = flipbookParts(root); (p.list as SlotNode).appendChild(previous);
    const gui = frame('Tracked GUI', 600, 350); gui.setSharedPluginData(NS, 'guiCopy', 'screen@1'); gui.setSharedPluginData(NS, 'trackOf', `track-${id}`);
    gui.appendChild(text('GUI content')); const m = marker.createInstance(); gui.appendChild(m); m.x = 70; m.y = 80;
    p.gui!.appendChild(gui); gui.x = 25; gui.y = 30;
    const callout = text('Authored callout'); root.appendChild(callout); callout.x = 180; callout.y = 220;
    p.descriptionArea!.visible = false;
    return root;
  };
  const makeItem = (root: FrameNode, id: string) => ({ id, nodeId: root.id, pageId: page.id, title: root.name, rev: 1 });
  const source = makeSource('success', 50, 100);
  const failed = makeSource('failed', 50, 1000);
  const late = makeSource('late-failure', 50, 1900);
  return { sourceId: source.id, failedId: failed.id, lateId: late.id, templateId: template.id, markerId: marker.id, sectionId: section.id,
    createdNodeIds: page.findAll().filter(n => !starting.has(n.id)).map(n => n.id) };
}
export async function run(ids: { sourceId: string; failedId: string; lateId: string; templateId: string; markerId: string; sectionId: string }) {
  figma.skipInvisibleInstanceChildren = false;
  await Promise.all([figma.loadFontAsync(font), figma.loadFontAsync(bold)]);
  const page = figma.currentPage;
  const starting = new Set(page.findAll().map(n => n.id));
  const section = await figma.getNodeByIdAsync(ids.sectionId) as SectionNode;
  const template = await figma.getNodeByIdAsync(ids.templateId) as FrameNode;
  const marker = await figma.getNodeByIdAsync(ids.markerId) as ComponentNode;
  const makeItem = (root: FrameNode, id: string) => ({ id, nodeId: root.id, pageId: page.id, title: root.name, rev: 1 });
  const source = await figma.getNodeByIdAsync(ids.sourceId) as FrameNode; const originalId = source.id;
  const originalWords = words(source);
  const result = await migrateFlipbookTemplate(makeItem(source, 'success'), template.id);
  const converted = await figma.getNodeByIdAsync(result.nodeId) as FrameNode;
  check(source.removed, 'old frame should be removed only on success');
  const after = flipbookParts(converted);
  check(JSON.stringify(words(after.description!)) === JSON.stringify(['Bold red and styled text', 'Second paragraph', 'Third independent item']), 'Description text/hierarchy lost');
  check(after.descriptionArea!.visible === false, 'hidden Description must stay hidden');
  check(after.previous?.name === 'Previous', 'nested Previous wrapper lost');
  check(after.previous && 'children' in after.previous && after.previous.children.length === 3, 'history rows/background lost');
  const richAfter = (after.description as SlotNode).children[0] as FrameNode;
  check((richAfter.children[0] as TextNode).getRangeFontName(0, 4) !== figma.mixed && ((richAfter.children[0] as TextNode).getRangeFontName(0, 4) as FontName).style === 'Bold', 'bold formatting lost');
  const tracked = after.gui!.children.find(n => n.getSharedPluginData(NS, 'trackOf') === 'track-success');
  check(tracked?.getSharedPluginData(NS, 'guiCopy') === 'screen@1', 'GUI tracking metadata lost');
  const markerAfter = (tracked as FrameNode).findOne(n => n.type === 'INSTANCE') as InstanceNode;
  check((await markerAfter.getMainComponentAsync())?.id === marker.id, 'marker component link lost');
  check(words(converted).includes('Authored callout'), 'external callout lost');
  const countBeforeRetry = section.children.length;
  const repeated = await migrateFlipbookTemplate({ ...makeItem(converted, 'success') }, template.id);
  check(repeated.nodeId === converted.id && section.children.length === countBeforeRetry, 're-run duplicated output');
  const failed = await figma.getNodeByIdAsync(ids.failedId) as FrameNode; const failedBefore = stamp(failed);
  const parentCount = section.children.length;
  let calls = 0, rejected = false;
  try { await migrateFlipbookTemplate(makeItem(failed, 'failed'), template.id, () => ++calls < 3); } catch { rejected = true; }
  check(rejected && !failed.removed && stamp(failed) === failedBefore, 'mid-copy failure changed the original');
  check(section.children.length === parentCount, 'partial result not cleaned up');
  const late = await figma.getNodeByIdAsync(ids.lateId) as FrameNode; const lateBefore = stamp(late);
  rejected = false;
  try { await migrateFlipbookTemplate(makeItem(late, 'late-failure'), template.id, () => section.children.filter(n => n.getSharedPluginData(NS, 'flipbookOf') === 'late-failure').length < 2); } catch { rejected = true; }
  check(rejected && !late.removed && stamp(late) === lateBefore, 'pre-commit failure changed the original');
  const newNodes = page.findAll().filter(n => !starting.has(n.id));
  check(!page.findAll(n => n.name === 'Template migration staging').length, 'staging nodes leaked');
  return { createdNodeIds: newNodes.map(n => n.id), mutatedNodeIds: [originalId], sectionId: section.id,
    result: { convertedId: converted.id, templateId: template.id, preservedText: originalWords.length, nativeDescriptionSlot: after.description!.type,
      preservedTrack: tracked?.getSharedPluginData(NS, 'trackOf'), historyLayers: 'children' in after.previous! ? after.previous!.children.length : 0,
      midCopyFailurePreserved: !failed.removed, preCommitFailurePreserved: !late.removed, stagingCount: 0, rerunSameNode: repeated.nodeId === converted.id } };
}
