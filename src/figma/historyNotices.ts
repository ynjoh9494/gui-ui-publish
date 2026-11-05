import { HISTORY_ADDED_AT, HISTORY_LATEST_AT, inHistoryWindow, type HistoryNotice, type HistoryWindow } from '../core/historyNotices.ts';
import { markedPart, isMarkedRow, markedRowParts, NS } from './template.ts';

const textOf = (node: TextNode | InstanceNode | null): string => !node ? '' : node.type === 'TEXT' ? node.characters : (node.findOne(n => n.type === 'TEXT') as TextNode | null)?.characters ?? '';

// 새 행이 없는 목록은 하위 레이어를 읽지 않는다. 행을 만나면 그 안으로 재귀 탐색하지 않는다.
export function frameHistoryNotices(frame: FrameNode, window: HistoryWindow): HistoryNotice[] {
  if (window.since === null) return [];
  const list = markedPart(frame, 'history');
  if (!list || !('children' in list) || Number(list.getSharedPluginData(NS, HISTORY_LATEST_AT)) <= window.since) return [];
  const rows: HistoryNotice[] = [];
  const visit = (parent: ChildrenMixin) => {
    for (const child of parent.children) {
      if (isMarkedRow(child)) {
        if (inHistoryWindow(Number(child.getSharedPluginData(NS, HISTORY_ADDED_AT)), window)) {
          const parts = markedRowParts(child);
          rows.push({ key: child.getSharedPluginData(NS, 'historyKey'), at: textOf(parts.date), description: textOf(parts.comment), worker: textOf(parts.worker), tag: textOf(parts.status) });
        }
      } else if ('children' in child) visit(child);
    }
  };
  visit(list);
  return rows;
}

export async function readHistoryNotices(items: [string, string][], window: HistoryWindow): Promise<[string, HistoryNotice[]][]> {
  if (window.since === null) return [];
  const result: [string, HistoryNotice[]][] = [];
  for (const [id, nodeId] of items) {
    const frame = await figma.getNodeByIdAsync(nodeId).catch(() => null);
    if (frame?.type !== 'FRAME') continue;
    const rows = frameHistoryNotices(frame, window);
    if (rows.length) result.push([id, rows]);
  }
  return result;
}
