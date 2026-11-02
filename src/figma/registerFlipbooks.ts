import { COPY } from '../core/copy.ts';
import { EXISTING_KEY, type ExistingFlipbook } from '../core/registerFlipbooks.ts';
import { FLIPBOOK_KEY, NODE_KEY } from './flipbook.ts';
import { NS, importNamedFrame, linksOf } from './template.ts';

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
  for (const [i, node] of nodes.entries()) {
    const frame = node as FrameNode;
    frame.setSharedPluginData(NS, FLIPBOOK_KEY, items[i].id);
    frame.setSharedPluginData(NS, NODE_KEY, frame.id);
    frame.setSharedPluginData(NS, EXISTING_KEY, 'true');
    // 반영은 표식으로만 칸을 찾는다(2026-11-02 사용자 결정). 연결 기록이 없는 프레임은 이전 형식 이름으로 찾은 칸에 표식을 단다.
    // 찾은 칸이 없어도 연결 기록을 남기고, 없는 칸은 반영할 때 건너뛴다.
    if (!linksOf(frame, NS)) await importNamedFrame(frame, null, NS);
  }
}
