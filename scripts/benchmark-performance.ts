// 순수 Node 계산만 측정한다. Figma API·브라우저 DOM·레이어 복사 비용은 포함하지 않는다.
import { performance } from 'node:perf_hooks';
import { Store, memoryKV } from '../src/core/store.ts';
import { classify, type ScannedFrame } from '../src/core/compare.ts';
import { buildList } from '../src/core/list.ts';
import { draftIndex, validateDraft, type Draft } from '../src/core/drafts.ts';

function median(run: () => void): number {
  const samples: number[] = [];
  for (let i = 0; i < 7; i++) {
    const start = performance.now();
    run();
    samples.push(performance.now() - start);
  }
  return +samples.sort((a, b) => a - b)[3].toFixed(2);
}

for (const n of [100, 500, 1000, 2000]) {
  const state = new Store(memoryKV()).state;
  state.categories.set('c', { id: 'c', name: 'Category', active: true, order: 0 });
  state.workers.set('w', { id: 'w', name: 'Worker', alias: '', active: true });
  state.tags.set('t', { id: 't', team: 'GUI', name: 'Changed', colorKey: 'Green', color: '#00ff00', active: true });
  const frames: ScannedFrame[] = Array.from({ length: n }, (_, i) => ({ nodeId: `n${i}`, pageId: 'p', name: `Screen ${i}`,
    width: 1920, height: 1080, screenTag: `s${i}`, fingerprint: 'f', error: null }));
  for (let i = 0; i < n; i++) state.screens.set(`s${i}`, { id: `s${i}`, code: `STB_${String(i).padStart(5, '0')}`, name: `Screen ${i}`,
    status: 'active', categoryId: 'c', baseScreenId: null, source: { nodeId: `n${i}`, pageId: 'p' },
    guiVersion: 0, guiTag: null, rev: 0, createdAt: 0 });
  const entries = classify(state, frames);
  const drafts: Record<string, Draft> = Object.fromEntries(entries.map(e => [e.key, { included: true, workerId: 'w', tagId: 't', extra: {} }]));
  const model = (indexed: boolean) => {
    const index = indexed ? draftIndex(state, entries) : undefined;
    buildList('GUI', state, entries, e => validateDraft('GUI', state, e, drafts[e.key], drafts, entries, index).status,
      { collapsed: new Set(['c']), query: '', changedOnly: false });
  };
  model(false); model(true);
  console.log(JSON.stringify({ screens: n,
    listBeforeIndexMs: median(() => model(false)), listIndexedMs: median(() => model(true)),
    classifyMs: median(() => classify(state, frames)),
  }));
}

// 기록이 바뀌지 않았을 때의 reload 경로와 최초 생성 비용을 구분해 본다.
for (const n of [1000, 10000, 30000]) {
  const kv = memoryKV(Object.fromEntries(Array.from({ length: n }, (_, i) => [`cat:${i}`, JSON.stringify({ id: String(i), name: `Category ${i}`, active: true, order: i })])));
  const coldMs = median(() => { new Store(kv); });
  const store = new Store(kv);
  const unchangedMs = median(() => store.reload());
  console.log(JSON.stringify({ records: n, storeColdMs: coldMs, storeUnchangedMs: unchangedMs }));
}
