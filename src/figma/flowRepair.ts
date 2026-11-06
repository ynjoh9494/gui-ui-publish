import { FLOW_REPAIR_COPY as COPY } from '../core/flowRepairCopy.ts';
import type { FlowRepairImage } from '../core/flowRepair.ts';
import { flowImageName, type FlowThumb, type FoundFlowCell } from '../core/flow.ts';
import { loadPages } from './flipbook.ts';
import { loadThumbnailPage } from './thumbs.ts';
import { NS } from './template.ts';

function pageOf(node: BaseNode): PageNode | null {
  for (let p: BaseNode | null = node; p; p = p.parent) if (p.type === 'PAGE') return p;
  return null;
}
function cellOf(rect: RectangleNode): FoundFlowCell | null {
  const page = pageOf(rect);
  let flowId = rect.getSharedPluginData(NS, 'flowOf');
  let root: BaseNode | null = null;
  for (let p = rect.parent; p && p.type !== 'PAGE'; p = p.parent) {
    const mark = p.getSharedPluginData(NS, 'flowOf');
    if (mark && (!flowId || mark === flowId)) { flowId = mark; root = p; break; }
  }
  if (!page) return null;
  return { nodeId: rect.id, pageId: page.id, flowId, uid: rect.getSharedPluginData(NS, 'flowScreen'), rootId: root?.id ?? null, title: root?.name ?? null };
}
function imageOf(rect: RectangleNode): FlowRepairImage {
  const cell = cellOf(rect);
  if (!cell) throw new Error(COPY.missing);
  return { nodeId: rect.id, pageId: cell.pageId, name: rect.name, flowId: cell.flowId, uid: cell.uid,
    stamp: JSON.stringify([cell.pageId, rect.parent?.id, rect.name, cell.flowId, cell.uid, rect.getSharedPluginData(NS, 'flowVersion'), rect.fills]) };
}
export async function selectedFlowRepairImages(): Promise<FlowRepairImage[]> {
  return figma.currentPage.selection.filter((n): n is RectangleNode => n.type === 'RECTANGLE' && Array.isArray(n.fills) && n.fills.some(p => p.type === 'IMAGE')).map(imageOf);
}
// Unlike normal flow discovery, this read never migrates marks on unselected cells.
export async function flowRepairCells(pageIds: string[]): Promise<FoundFlowCell[]> {
  const cells: FoundFlowCell[] = [];
  for (const page of await loadPages(pageIds)) for (const rect of page.findAllWithCriteria({ types: ['RECTANGLE'], sharedPluginData: { namespace: NS, keys: ['flowScreen'] } })) {
    const cell = cellOf(rect);
    if (cell?.flowId && cell.uid) cells.push(cell);
  }
  return cells;
}
export async function restoreFlowImage(item: FlowRepairImage, uid: string, flowId: string, thumb: FlowThumb, isCurrent: () => boolean): Promise<void> {
  await loadThumbnailPage(NS);
  const node = await figma.getNodeByIdAsync(item.nodeId);
  if (!node || node.removed || node.type !== 'RECTANGLE') throw new Error(COPY.missing);
  if (imageOf(node).stamp !== item.stamp || !isCurrent()) throw new Error(COPY.changed);
  if (!figma.getImageByHash(thumb.thumb.hash)) throw new Error(COPY.unavailable);
  const oldFills = node.fills;
  const oldName = node.name;
  const keys = ['flowOf', 'flowScreen', 'flowVersion'];
  const oldMarks = keys.map(k => node.getSharedPluginData(NS, k));
  try {
    node.fills = [{ type: 'IMAGE', imageHash: thumb.thumb.hash, scaleMode: 'FIT' }];
    node.name = flowImageName(thumb.code, thumb.name);
    node.setSharedPluginData(NS, 'flowOf', flowId);
    node.setSharedPluginData(NS, 'flowScreen', uid);
    node.setSharedPluginData(NS, 'flowVersion', String(thumb.version));
  } catch (error) {
    node.fills = oldFills;
    node.name = oldName;
    keys.forEach((k, i) => node.setSharedPluginData(NS, k, oldMarks[i]));
    throw error;
  }
}
