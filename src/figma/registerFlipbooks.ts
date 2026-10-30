import { COPY } from '../core/copy.ts';
import { EXISTING_KEY, type ExistingFlipbook } from '../core/registerFlipbooks.ts';
import { FLIPBOOK_KEY, NODE_KEY } from './flipbook.ts';
import { NS } from './template.ts';

export async function selectedFlipbooks(): Promise<ExistingFlipbook[]> {
  const selected = [...figma.currentPage.selection];
  if (!selected.length || selected.some(n => n.type !== 'FRAME')) throw new Error(COPY.registerExistingSelect);
  const ids = new Set(selected.map(n => n.id));
  return selected.filter(node => {
    for (let n = node.parent; n && n.type !== 'PAGE'; n = n.parent) if (ids.has(n.id)) return false;
    return true;
  }).map(node => ({ nodeId: node.id, pageId: figma.currentPage.id, title: node.name,
    flipbookId: node.getSharedPluginData(NS, NODE_KEY) === node.id ? node.getSharedPluginData(NS, FLIPBOOK_KEY) || null : null,
  }));
}

export async function markExistingFlipbooks(items: { nodeId: string; id: string; pageId: string }[]): Promise<void> {
  const nodes = await Promise.all(items.map(item => figma.getNodeByIdAsync(item.nodeId)));
  // Validate the full selection before writing any marks. Visible layers are never changed here.
  nodes.forEach((node, i) => {
    if (!node || node.type !== 'FRAME') throw new Error(COPY.registerExistingChanged);
    let page: BaseNode | null = node.parent;
    while (page && page.type !== 'PAGE') page = page.parent;
    if (page?.id !== items[i].pageId) throw new Error(COPY.registerExistingChanged);
    const own = node.getSharedPluginData(NS, NODE_KEY) === node.id && node.getSharedPluginData(NS, FLIPBOOK_KEY);
    if (own && own !== items[i].id) throw new Error(COPY.registerExistingChanged);
  });
  nodes.forEach((node, i) => {
    node!.setSharedPluginData(NS, FLIPBOOK_KEY, items[i].id);
    node!.setSharedPluginData(NS, NODE_KEY, node!.id);
    node!.setSharedPluginData(NS, EXISTING_KEY, 'true');
  });
}
