import type { ToMain } from '../core/wire.ts';

export const NODE_PREVIEW = 'node:';

// Blob URLs and in-flight requests belong to one app. Dropped requests must not
// repopulate the cache when a late response arrives after reset or disposal.
export class PreviewCache {
  readonly urls = new Map<string, string>();
  readonly failed = new Set<string>();
  private pending = new Set<string>();
  private frame = 0;

  private readonly send: (message: ToMain) => void;
  constructor(send: (message: ToMain) => void) { this.send = send; }

  request(hashes: (string | null)[]): void {
    for (const hash of hashes) if (hash && !this.urls.has(hash)) {
      this.urls.set(hash, '');
      this.pending.add(hash);
    }
    if (!this.pending.size || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const hashes = [...this.pending];
      this.pending.clear();
      const images = hashes.filter(h => !h.startsWith(NODE_PREVIEW));
      const nodeIds = hashes.filter(h => h.startsWith(NODE_PREVIEW)).map(h => h.slice(NODE_PREVIEW.length));
      if (images.length) this.send({ type: 'thumbnails', hashes: images });
      if (nodeIds.length) this.send({ type: 'framePreviews', nodeIds });
    });
  }

  receive(key: string, bytes: Uint8Array | null, type: string): void {
    if (!this.urls.has(key)) return;
    this.revoke(key);
    if (bytes) {
      this.urls.set(key, URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type })));
      this.failed.delete(key);
    } else { this.urls.set(key, ''); this.failed.add(key); }
  }

  private revoke(key: string): void {
    const url = this.urls.get(key);
    if (url) URL.revokeObjectURL(url);
  }

  private remove(key: string): void {
    this.revoke(key);
    this.urls.delete(key);
    this.failed.delete(key);
    this.pending.delete(key);
  }

  clearNodes(): void {
    for (const key of this.urls.keys()) if (key.startsWith(NODE_PREVIEW)) this.remove(key);
  }

  retain(hashes: ReadonlySet<string>): void {
    for (const key of this.urls.keys()) if (!key.startsWith(NODE_PREVIEW) && !hashes.has(key)) this.remove(key);
  }

  clear(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    for (const key of this.urls.keys()) this.remove(key);
  }
}
