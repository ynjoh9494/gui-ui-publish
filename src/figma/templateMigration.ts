import { COPY } from '../core/copy.ts';
import type { TemplateMigrationCandidate, TemplateMigrationItem } from '../core/templateMigration.ts';
import { FLIPBOOK_KEY, NODE_KEY, TEMPLATE_KEY } from './flipbook.ts';
import { NS, pageOf } from './template.ts';

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
// Refuse stale messages as well as clicks. Never touch a frame while the
// instance-slot move/rollback implementation is suspended.
export async function migrateFlipbookTemplate(_item: TemplateMigrationItem, _templateId: string, _isCurrent?: () => boolean): Promise<{ nodeId: string; pageId: string }> {
  throw new Error(COPY.templateMigrationPaused);
}
