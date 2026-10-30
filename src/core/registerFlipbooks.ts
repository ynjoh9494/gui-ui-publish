import { COPY } from './copy.ts';
import { noSection } from './flipbooks.ts';
import type { State } from './store.ts';
import type { Actor, Flipbook } from './types.ts';

export const EXISTING_KEY = 'registeredFlipbook';

export interface ExistingFlipbook { nodeId: string; pageId: string; title: string; flipbookId: string | null }

// Node IDs are stable within a file; two registrations of the same frame must use the same record.
export function planExistingFlipbooks(state: State, selected: ExistingFlipbook[], actor: Actor, now: number): { nodeId: string; record: Flipbook }[] {
  if (!selected.length) throw new Error(COPY.registerExistingSelect);
  if (selected.some(n => n.nodeId === state.project.templateNodeId)) throw new Error(COPY.registerExistingTemplate);
  if (selected.some(n => !state.project.flipbookPageIds.includes(n.pageId))) throw new Error(COPY.registerExistingPage);
  const seen = new Set<string>();
  return selected.flatMap(node => {
    if (seen.has(node.nodeId)) return [];
    seen.add(node.nodeId);
    const id = node.flipbookId ?? `canvas:${node.nodeId}`;
    const before = state.flipbooks.get(id);
    if (before?.status === 'active') return [];
    return [{ nodeId: node.nodeId, record: {
      id, rev: (before?.rev ?? 0) + 1, kind: 'single', title: node.title, autoTitle: false, titleNames: [],
      scale: 1, category: noSection(), screens: [], pageId: node.pageId, status: 'active', createdAt: now, actor,
      tracked: true,
      ...(before ? { screens: before.screens, kind: before.kind, createdAt: before.createdAt } : {}),
    } }];
  });
}
