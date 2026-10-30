import { esc } from './html.ts';

export function thumbnailImage(hash: string | undefined, url: string | null, empty: string, className: string): string {
  const key = hash ? ` data-image-hash="${esc(hash)}"` : '';
  return url ? `<img${key} src="${esc(url)}" alt="" draggable="false">` : `<span${key} class="${className}">${empty}</span>`;
}

// Image arrival never changes card order, selection, drag targets or arrows.
export function updateThumbnailImages(root: HTMLElement | null, hashes: string[], thumb: (hash: string) => string | null): void {
  if (!root) return;
  const loaded = new Set(hashes);
  for (const node of root.querySelectorAll<HTMLElement>('[data-image-hash]')) {
    const hash = node.dataset.imageHash!;
    if (!loaded.has(hash)) continue;
    const url = thumb(hash);
    if (!url || node instanceof HTMLImageElement && node.src === url) continue;
    const image = document.createElement('img');
    image.dataset.imageHash = hash;
    image.src = url;
    image.alt = '';
    image.draggable = false;
    node.replaceWith(image);
  }
}
