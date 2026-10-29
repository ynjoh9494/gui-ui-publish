import { COPY } from '../core/copy.ts';
import type { ManagedPageInfo } from '../core/wire.ts';

export function managedPages(ns: string): ManagedPageInfo[] {
  return figma.root.children.flatMap(page => {
    const kind = page.getSharedPluginData(ns, 'role');
    return kind === 'data' || kind === 'thumbs' ? [{ id: page.id, name: page.name, kind }] : [];
  });
}
export function normalizeManagedPageNames(ns: string): void {
  for (const page of figma.root.children) {
    const role = page.getSharedPluginData(ns, 'role');
    const name = role === 'data' ? COPY.figmaData001 : role === 'thumbs' ? COPY.figmaLayers001 : null;
    if (name && page.name !== name) page.name = name;
  }
}
