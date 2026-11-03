import { COPY } from '../core/copy.ts';
import { EXISTING_KEY, type ExistingFlipbook } from '../core/registerFlipbooks.ts';
import { FLIPBOOK_KEY, NODE_KEY } from './flipbook.ts';
import { NS, importNamedFrame, linksOf } from './template.ts';
import { keys } from '../core/store.ts';
import type { Flipbook } from '../core/types.ts';

// 페이지를 따로 읽으며 복사본에도 자기 노드 ID가 적힌 옛 파일이 있다.
// 기록된 페이지에 원본이 남아 있으면 그 원본의 ID를 복사본 등록에 쓰지 않는다.
async function registrationId(node: SceneNode): Promise<string | null> {
  const id = node.getSharedPluginData(NS, FLIPBOOK_KEY);
  if (!id || node.getSharedPluginData(NS, NODE_KEY) !== node.id) return null;
  const raw = figma.root.getSharedPluginData(NS, keys.flipbook(id));
  const record = raw ? JSON.parse(raw) as Flipbook : null;
  const page = record?.pageId ? await figma.getNodeByIdAsync(record.pageId) : null;
  if (page?.type === 'PAGE') {
    await page.loadAsync();
    const owner = page.findAllWithCriteria({ types: ['FRAME'], sharedPluginData: { namespace: NS, keys: [FLIPBOOK_KEY] } })
      .find(frame => frame.getSharedPluginData(NS, FLIPBOOK_KEY) === id && frame.getSharedPluginData(NS, NODE_KEY) === frame.id);
    if (owner && owner.id !== node.id) return null;
  }
  return id;
}

export async function selectedFlipbooks(): Promise<ExistingFlipbook[]> {
  const selected = [...figma.currentPage.selection];
  if (!selected.length || selected.some(n => n.type !== 'FRAME')) throw new Error(COPY.registerExistingSelect);
  const ids = new Set(selected.map(n => n.id));
  const frames = selected.filter(node => {
    for (let n = node.parent; n && n.type !== 'PAGE'; n = n.parent) if (ids.has(n.id)) return false;
    return true;
  });
  return Promise.all(frames.map(async node => ({ nodeId: node.id, pageId: figma.currentPage.id, title: node.name,
    flipbookId: await registrationId(node),
  })));
}

export async function markExistingFlipbooks(items: { nodeId: string; id: string; pageId: string }[]): Promise<void> {
  const nodes = await Promise.all(items.map(item => figma.getNodeByIdAsync(item.nodeId)));
  // Validate the full selection before writing any marks. Visible layers are never changed here.
  for (const [i, node] of nodes.entries()) {
    if (!node || node.type !== 'FRAME') throw new Error(COPY.registerExistingChanged);
    let page: BaseNode | null = node.parent;
    while (page && page.type !== 'PAGE') page = page.parent;
    if (page?.id !== items[i].pageId) throw new Error(COPY.registerExistingChanged);
    const own = node.getSharedPluginData(NS, NODE_KEY) === node.id && node.getSharedPluginData(NS, FLIPBOOK_KEY);
    if (own && own !== items[i].id && await registrationId(node)) throw new Error(COPY.registerExistingChanged);
  }
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
