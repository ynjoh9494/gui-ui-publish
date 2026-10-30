import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PreviewCache } from '../src/ui/previewCache.ts';
import type { ToMain } from '../src/core/wire.ts';

test('미리보기 요청은 한 프레임으로 합치고 교체·삭제·종료 때 URL을 해제하며 늦은 응답을 버린다', t => {
  const frames = new Map<number, FrameRequestCallback>();
  let seq = 0;
  const before = { request: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame };
  globalThis.requestAnimationFrame = callback => { frames.set(++seq, callback); return seq; };
  globalThis.cancelAnimationFrame = id => { frames.delete(id); };
  t.after(() => { globalThis.requestAnimationFrame = before.request; globalThis.cancelAnimationFrame = before.cancel; });
  const revoked: string[] = [];
  let urls = 0;
  t.mock.method(URL, 'createObjectURL', () => `blob:${++urls}`);
  t.mock.method(URL, 'revokeObjectURL', (url: string) => revoked.push(url));
  const sent: ToMain[] = [];
  const cache = new PreviewCache(message => sent.push(message));
  for (let i = 0; i < 100; i++) cache.request([`h${i}`, `h${i}`]);
  cache.request(['node:n1']);
  assert.equal(frames.size, 1);
  for (const [id, callback] of frames) { frames.delete(id); callback(0); }
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0], { type: 'thumbnails', hashes: Array.from({ length: 100 }, (_, i) => `h${i}`) });
  assert.deepEqual(sent[1], { type: 'framePreviews', nodeIds: ['n1'] });

  cache.receive('h0', new Uint8Array([1]), 'image/jpeg');
  cache.receive('h0', new Uint8Array([2]), 'image/jpeg');
  assert.deepEqual(revoked, ['blob:1']);
  cache.receive('node:n1', new Uint8Array([1]), 'image/png');
  cache.clearNodes();
  assert.equal(cache.urls.has('node:n1'), false);
  assert.ok(revoked.includes('blob:3'));
  cache.retain(new Set());
  assert.equal(cache.urls.size, 0);
  assert.ok(revoked.includes('blob:2'));
  cache.receive('h0', new Uint8Array([1]), 'image/jpeg');
  assert.equal(urls, 3, 'discard late replies for removed requests');
  cache.request(['later']);
  cache.clear();
  assert.equal(frames.size, 0);
  assert.equal(cache.urls.size, 0);
  cache.receive('later', new Uint8Array([1]), 'image/jpeg');
  assert.equal(urls, 3);
});
