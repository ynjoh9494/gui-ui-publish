// 순수 Node 계산만 측정한다. Figma API·브라우저 DOM·레이어 복사 비용은 포함하지 않는다.
import { performance } from 'node:perf_hooks';
import { Store, memoryKV } from '../src/core/store.ts';
import { classify, type ScannedFrame } from '../src/core/compare.ts';
import { buildList } from '../src/core/list.ts';
import { defaultDraft, draftIndex, renumberAutoCodes, validateDraft, type Draft } from '../src/core/drafts.ts';
import { buildPlan } from '../src/core/publish.ts';
import { keys } from '../src/core/store.ts';

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

// 입력을 바꿀 때마다 도는 GUI 목록 계산: 자동 Screen ID 다시 매기기, 행 검증, 최종 확인의 배포 계획(2026-11-03 측정).
// 화면 2,000개(카테고리 10개, 10개마다 케이스) + 새 프레임 300개(그중 100개는 케이스). 같은 입력만 쓰면 V8이 실제보다 빠르게 보이므로 시드를 바꾼다.
function guiFixture(seed: number) {
  const store = new Store(memoryKV());
  store.saveProject({ ...store.state.project, screenIdPrefix: 'STB', scopePageIds: ['gui'] });
  const cats = Array.from({ length: 10 }, (_, i) => `c${i}`);
  cats.forEach((id, i) => store.put(keys.category(id), { id, name: `Cat${i}`, code: `C${i}`, order: i, active: true }));
  store.put(keys.worker('w'), { id: 'w', name: 'W', alias: '', active: true });
  store.put(keys.tag('t'), { id: 't', team: 'GUI', name: 'T', color: '#000000', colorKey: 'Black', active: true });
  const frames: ScannedFrame[] = [];
  let n = 0;
  for (const cat of cats) for (let i = 1; i <= 200; i++) {
    const id = `s${seed}_${n++}`, isCase = i % 10 === 0;
    const code = isCase ? `STB_${cat.toUpperCase()}_${String(i - 1).padStart(3, '0')}-01` : `STB_${cat.toUpperCase()}_${String(i).padStart(3, '0')}`;
    store.put(keys.screen(id), { id, rev: 1, code, name: `Screen ${id}`, categoryId: cat, baseScreenId: isCase ? `s${seed}_${n - 2}` : null, status: 'active',
      source: { nodeId: `n${id}`, pageId: 'gui' }, guiVersion: 0, guiTag: null, createdAt: 1 });
    frames.push({ nodeId: `n${id}`, pageId: 'gui', name: `Screen ${id}`, width: 1, height: 1, screenTag: id, fingerprint: null, error: null });
  }
  for (let i = 0; i < 300; i++) frames.push({ nodeId: `new${seed}_${i}`, pageId: 'gui', name: `New ${i}`, width: 1, height: 1, screenTag: null, fingerprint: `nf${i}`, error: null });
  const entries = classify(store.state, frames);
  const drafts: Record<string, Draft> = Object.fromEntries(entries.map(e => [e.key, defaultDraft('GUI', store.state, e)]));
  const bases = [...store.state.screens.values()].filter(s => !s.baseScreenId);
  entries.filter(e => !e.screenId).forEach((e, i) => {
    Object.assign(drafts[e.key], { included: true, categoryId: cats[i % cats.length], tagId: 't', workerId: 'w', name: `New ${i}` },
      i < 100 ? { relation: 'case', baseScreenId: bases[(i * 7 + seed) % bases.length].id } : { relation: 'standalone' });
  });
  return { state: store.state, entries, drafts };
}
const fixtures = Array.from({ length: 7 }, (_, i) => guiFixture(i + 1));
const across = (run: (f: ReturnType<typeof guiFixture>) => void) => {
  const samples = fixtures.map(f => { const start = performance.now(); run(f); return performance.now() - start; });
  return +samples.sort((a, b) => a - b)[3].toFixed(2);
};
console.log(JSON.stringify({ screens: 2000, newFrames: 300, cases: 100,
  renumberMs: across(f => renumberAutoCodes(f.state, f.entries.filter(e => f.drafts[e.key]).map(entry => ({ entry, draft: f.drafts[entry.key] })))),
  validateRowsMs: across(f => { const index = draftIndex(f.state, f.entries); for (const e of f.entries) validateDraft('GUI', f.state, e, f.drafts[e.key], f.drafts, f.entries, index); }),
  buildPlanMs: across(f => { buildPlan('GUI', f.state, f.entries, f.drafts, { id: 'u', name: 'U' }, 'b', { description: '', extra: {}, worker: 'W' }); }),
}));
