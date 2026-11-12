import { TEMPLATE_MIGRATION_COPY } from '../core/templateMigrationCopy.ts';
import { TEMPLATE_KEY } from './flipbook.ts';
import { flipbookParts, linksOf, namedParts, NS, templateFrame, type Parts } from './template.ts';

const singleParts = ['chapter', 'status', 'ids', 'gui', 'descriptionArea', 'description', 'list', 'previous'] as const;

function readParts(frame: FrameNode): Parts {
  if (linksOf(frame)) return flipbookParts(frame);
  const p = namedParts(frame);
  return { links: null, titles: [p.titleText, p.page].filter((n): n is TextNode => !!n), chapter: p.chapter,
    status: p.status, ids: p.ids, gui: p.gui, descriptionArea: null, description: p.description, list: p.list, previous: null };
}

const sameType = (a: SceneNode, b: SceneNode) => a.type === b.type ||
  (a.type === 'INSTANCE' && b.type === 'COMPONENT') ||
  ((a.type === 'SLOT' || a.type === 'FRAME') && (b.type === 'SLOT' || b.type === 'FRAME'));

// Follow the connected layer's hierarchy in the source. Never pick a sibling by
// index: authored layers can be inserted or reordered, including GUI copies.
function corresponding(template: FrameNode, source: FrameNode, node: SceneNode): SceneNode | null {
  const path: SceneNode[] = [];
  for (let n: BaseNode | null = node; n !== template; n = n.parent) {
    if (!n || n.type === 'PAGE' || n.type === 'DOCUMENT') return null;
    path.push(n as SceneNode);
  }
  let target: SceneNode = source;
  for (const step of path.reverse()) {
    if (!('children' in target)) return null;
    const matches: SceneNode[] = target.children.filter(child => child.name === step.name && sameType(child, step) && !child.getSharedPluginData(NS, 'guiCopy'));
    if (matches.length !== 1) return null;
    target = matches[0];
  }
  return target;
}

function mappedParts(template: FrameNode, source: FrameNode, own: Parts): Parts | null {
  const parts = readParts(template);
  if (!parts.gui && !own.gui) return null;
  const mapped = { ...parts, titles: [] as TextNode[] };
  for (const title of own.links && own.titles.length ? [] : parts.titles) {
    const found = corresponding(template, source, title);
    if (found?.type !== 'TEXT') return null;
    mapped.titles.push(found);
  }
  for (const key of singleParts) {
    if (own.links && own[key]) {
      Object.assign(mapped, { [key]: own[key] });
      continue;
    }
    const from = parts[key];
    if (!from) continue;
    const found = corresponding(template, source, from);
    // Legacy templates can retain a hidden status header that was deleted
    // from authored flipbooks. Its absence must not invalidate the GUI match.
    if (!found && key === 'status') { mapped.status = null; continue; }
    if (!found || (key === 'gui' && found.type !== 'FRAME')) return null;
    // corresponding() checks the connected layer's type before it is assigned
    // back to that same field (frame/slot compatibility is only for containers).
    Object.assign(mapped, { [key]: found });
  }
  return mapped;
}

function merge(primary: Parts, fallback: Parts): Parts {
  return { links: primary.links ?? fallback.links, titles: primary.titles.length ? primary.titles : fallback.titles,
    chapter: primary.chapter ?? fallback.chapter, status: primary.status ?? fallback.status,
    ids: primary.ids ?? fallback.ids, gui: primary.gui ?? fallback.gui,
    descriptionArea: primary.descriptionArea ?? fallback.descriptionArea, description: primary.description ?? fallback.description,
    list: primary.list ?? fallback.list, previous: primary.previous ?? fallback.previous };
}

const bindingIds = (parts: Parts) => JSON.stringify([parts.titles.map(n => n.id), ...singleParts.map(key => parts[key]?.id ?? null)]);

export async function migrationSource(frame: FrameNode, templateIds: string[]): Promise<{ parts: Parts; template: FrameNode | null }> {
  const own = readParts(frame);
  const recorded = frame.getSharedPluginData(NS, TEMPLATE_KEY);
  const candidates: { parts: Parts; template: FrameNode }[] = [];
  // An existing origin record takes precedence over structural discovery. If
  // its frame was deleted, registered templates can still identify the layout.
  let recordedFrame: FrameNode | null = null;
  if (recorded) {
    try { recordedFrame = await templateFrame(recorded); } catch { /* Deleted source template. */ }
  }
  const templates: FrameNode[] = [];
  if (recordedFrame) templates.push(recordedFrame);
  else for (const id of new Set(templateIds)) {
    try { templates.push(await templateFrame(id)); } catch { /* Deleted registered template. */ }
  }
  for (const template of templates) {
    if (template.id === frame.id) continue;
    const mapped = mappedParts(template, frame, own);
    if (!mapped) continue;
    // Existing role marks are authoritative. Legacy names only fill fields
    // absent from the explicitly connected template.
    const parts = own.links ? merge(own, mapped) : merge(mapped, own);
    candidates.push({ parts, template });
  }
  if (!candidates.length) return { parts: own, template: null };
  if (new Set(candidates.map(c => bindingIds(c.parts))).size !== 1)
    throw new Error(TEMPLATE_MIGRATION_COPY.templateMigrationSourceAmbiguous);
  return candidates[0];
}
