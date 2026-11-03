import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify, type Entry, type ScannedFrame } from '../src/core/compare.ts';
import { defaultDraft, mergesInto, validateDraft, type Draft } from '../src/core/drafts.ts';
import { changeDigest, type DigestRequest } from '../src/core/changeDigest.ts';
import { FINGERPRINT_VERSION, fingerprint, type NodeSnapshot } from '../src/core/fingerprint.ts';
import { applyReplaceSuggestions, suggestReplacements, tokenHashes } from '../src/core/replaceMatch.ts';
import { keys, memoryKV, Store } from '../src/core/store.ts';
import type { GuiRecord, Screen } from '../src/core/types.ts';
import { Controller, type Host } from '../src/controller.ts';
import type { ToUi } from '../src/core/wire.ts';

const actor = { id: 'u', name: 'Designer' };
const PAGE = 'page', ARCHIVE = 'archive';

function register(store: Store, id: string, code: string, fingerprint: string, nodeId: string, extra: Partial<Screen> = {}) {
  store.put(keys.screen(id), {
    id, rev: 1, code, name: `화면 ${code}`, categoryId: 'home', baseScreenId: null, status: 'active',
    source: { nodeId, pageId: PAGE }, guiVersion: 1, guiTag: null, createdAt: 1000, ...extra,
  } satisfies Screen);
  store.put(keys.gui(id, 1), {
    screenId: id, version: 1, batchId: 'b1', workType: 'new', fingerprint, fpVersion: FINGERPRINT_VERSION, thumb: null, width: 1920, height: 1080,
    code, name: `화면 ${code}`, category: null, base: null, tag: { id: 't', name: '추가', color: '#000', colorKey: 'Gray' },
    description: '', worker: { id: 'w', name: 'Designer' }, actor, committedAt: 1000, extra: {}, corrections: [],
  } satisfies GuiRecord);
}

// 화면마다 고유한 글자 10개 + 내용 버전 토큰. 공통 배경 토큰은 모든 프레임에 있다.
const words = (body: string, content = 'v1') => ['g:FRAME:1920x1080', ...Array.from({ length: 10 }, (_, i) => `t:${body}:${i}`), `t:${content}`];
const frame = (nodeId: string, fingerprint: string, tag: string | null = null, name = `Frame ${nodeId}`): ScannedFrame =>
  ({ nodeId, pageId: PAGE, name, width: 1920, height: 1080, screenTag: tag, fingerprint, error: null });

function seeded() {
  const store = new Store(memoryKV(), () => 2000, (() => { let n = 0; return () => `id${++n}`; })());
  store.saveProject({ ...store.state.project, scopePageIds: [PAGE] });
  store.put(keys.category('home'), { id: 'home', name: '홈', order: 1, active: true });
  register(store, 'a', 'STB_HO_001', 'fp-a', '1:1');
  register(store, 'b', 'STB_HO_002', 'fp-b', '1:2');
  register(store, 'c', 'STB_HO_003', 'fp-c', '1:3');
  register(store, 'd', 'STB_HO_004', 'fp-d', '1:4');
  store.reload();
  return store;
}

function suggest(store: Store, frames: ScannedFrame[], bodies: Record<string, [string, string?]>, old: Record<string, [string, string?]> = {}): Entry[] {
  const entries = classify(store.state, frames);
  const tokens = new Map(Object.entries(bodies).map(([id, [body, content]]) => [id, tokenHashes(words(body, content))]));
  const oldTokens = new Map(Object.entries(old).map(([id, [body, content]]) => [id, tokenHashes(words(body, content))]));
  applyReplaceSuggestions(store.state, entries, suggestReplacements(store.state, entries, tokens, oldTokens));
  return entries;
}
const byKey = (entries: Entry[]) => new Map(entries.map(e => [e.key, e]));

test('붙여 넣은 프레임이 지난 배포와 같거나 남아 있는 원본과 비슷하면 그 화면의 교체를 기본값으로 고른다', () => {
  const store = seeded();
  // a: 원본을 지우고 같은 화면을 붙여 넣음(지문만으로 찾음). b: 원본 옆에 고친 화면을 붙여 넣음(내용으로 찾음).
  // c: 원본만 있음. 9:3: 어느 화면과도 다른 새 화면.
  const frames = [frame('1:2', 'fp-b', 'b'), frame('1:3', 'fp-c', 'c'), frame('1:4', 'fp-d', 'd'), frame('9:1', 'fp-a'), frame('9:2', 'fp-b2'), frame('9:3', 'fp-new')];
  const entries = byKey(suggest(store, frames, {
    '1:2': ['B'], '1:3': ['C'], '1:4': ['D'], '9:1': ['A'], '9:2': ['B', 'v2'], '9:3': ['NEW'],
  }));
  const pasted = entries.get('node:9:1')!, edited = entries.get('node:9:2')!, fresh = entries.get('node:9:3')!;
  assert.deepEqual([pasted.pairKey, edited.pairKey, fresh.pairKey], ['a', 'b', null]);
  // 원본을 찾지 못한 화면은 서로 짝을 가리키고, 원본이 남아 있는 화면은 등록 방식을 바꾸지 않는다.
  // 제안은 드롭다운의 「제안」 태그로만 알리고 안내 문구를 붙이지 않는다(2026-11-03 사용자 요청).
  assert.equal(entries.get('a')!.pairKey, 'node:9:1');
  assert.equal(entries.get('b')!.pairKey, null);
  assert.deepEqual([entries.get('b')!.notes, pasted.notes, edited.notes], [[], [], []]);

  const draft = defaultDraft('GUI', store.state, edited);
  assert.deepEqual([draft.link, draft.replaceScreenId, draft.code], ['replace', 'b', 'STB_HO_002']);
  const missing = defaultDraft('GUI', store.state, entries.get('a')!);
  assert.deepEqual([missing.retire, missing.replacedBy], ['replace', 'node:9:1']);
  const plain = defaultDraft('GUI', store.state, fresh);
  assert.equal(plain.link, 'new');
});

test('잘라내 붙인 짝은 그대로 두고, 복제 의심 프레임도 제안하며, 한 화면에는 가장 비슷한 프레임 하나만 짝짓는다', () => {
  const store = seeded();
  // 9:1: a의 표식이 있는 프레임 하나(잘라내 붙임) → 기존 짝 그대로. 9:2: b의 표식이 복제된 프레임(b 원본도 있음) → b와 같아 b를 제안한다.
  // 9:3·9:4: 둘 다 c와 비슷하지만 9:4가 더 비슷하다(글자가 모두 같고 지문만 다르다). 캔버스 순서가 앞인 9:3이 아니라 9:4가 짝이 된다.
  const frames = [frame('1:2', 'fp-b', 'b'), frame('1:3', 'fp-c', 'c'), frame('1:4', 'fp-d', 'd'), frame('9:1', 'fp-x', 'a'), frame('9:2', 'fp-b', 'b'), frame('9:3', 'fp-c3'), frame('9:4', 'fp-c4')];
  const entries = byKey(suggest(store, frames, {
    '1:2': ['B'], '1:3': ['C'], '1:4': ['D'], '9:1': ['A'], '9:2': ['B'], '9:3': ['C', 'v3'], '9:4': ['C'],
  }));
  assert.equal(entries.get('node:9:1')!.pairKey, 'a');
  // 복제 의심 안내는 그대로 두고(2026-11-02 사용자 요청: 어차피 제안이므로 복제여도 비슷한 화면을 보여 준다) 교체를 제안한다.
  assert.equal(entries.get('node:9:2')!.suggestedScreenId, 'b');
  assert.equal(entries.get('node:9:2')!.pairKey, 'b');
  assert.equal(defaultDraft('GUI', store.state, entries.get('node:9:2')!).link, 'replace');
  assert.deepEqual([entries.get('node:9:3')!.pairKey, entries.get('node:9:4')!.pairKey], [null, 'c']);
});

test('복제 의심 프레임은 표식의 화면이 아니라 내용이 가장 비슷한 화면을 제안한다', () => {
  const store = seeded();
  // 9:1은 b를 복제했지만 내용을 d처럼 고쳤다. 원본 b·d는 그대로 있다.
  const frames = [frame('1:2', 'fp-b', 'b'), frame('1:3', 'fp-c', 'c'), frame('1:4', 'fp-d', 'd'), frame('9:1', 'fp-x', 'b')];
  const entries = byKey(suggest(store, frames, { '1:2': ['B'], '1:3': ['C'], '1:4': ['D'], '9:1': ['D', 'v2'] }));
  assert.equal(entries.get('node:9:1')!.suggestedScreenId, 'b');
  assert.equal(entries.get('node:9:1')!.pairKey, 'd');
});

test('잘못 신규로 배포한 화면은 원본을 찾지 못한 화면의 지난 배포와 같으면 그 화면의 교체를 기본값으로 고른다', () => {
  const store = seeded();
  // e는 a의 원본을 지운 뒤 같은 화면을 신규로 배포한 화면이다. a는 원본 없음으로 남아 있다.
  register(store, 'e', 'STB_HO_005', 'fp-a', '1:5');
  store.reload();
  const frames = [frame('1:2', 'fp-b', 'b'), frame('1:3', 'fp-c', 'c'), frame('1:4', 'fp-d', 'd'), frame('1:5', 'fp-a', 'e')];
  const list = suggest(store, frames, { '1:2': ['B'], '1:3': ['C'], '1:4': ['D'], '1:5': ['A'] });
  const entries = byKey(list);
  assert.deepEqual([entries.get('e')!.pairKey, entries.get('a')!.pairKey], ['a', 'e']);
  const drafts: Record<string, Draft> = { e: defaultDraft('GUI', store.state, entries.get('e')!), a: defaultDraft('GUI', store.state, entries.get('a')!) };
  assert.ok(mergesInto(entries.get('e')!, drafts.e));
  assert.deepEqual([drafts.a.retire, drafts.a.replacedBy], ['replace', 'e']);
  // 배포를 켜면 짝이 맞아 입력 검사를 통과할 수 있다(작업자·태그는 따로 고른다).
  drafts.e = { ...drafts.e, included: true, workerId: undefined };
  drafts.a = { ...drafts.a, included: true };
  assert.equal(validateDraft('GUI', store.state, entries.get('a')!, drafts.a, drafts, list).status, 'ready');
});

test('원본을 찾지 못한 화면도 옛 원본이 파일에 남아 있으면 내용으로 짝짓고, 내용이 다르면 짝짓지 않는다', () => {
  const store = seeded();
  const frames = [frame('1:3', 'fp-c', 'c'), frame('1:4', 'fp-d', 'd'), frame('9:1', 'fp-a2'), frame('9:2', 'fp-zz')];
  const bodies: Record<string, [string, string?]> = { '1:3': ['C'], '1:4': ['D'], '9:1': ['A', 'v2'], '9:2': ['ZZ'] };
  // 옛 원본을 읽지 못하면(지운 원본) 지문이 다르므로 찾지 못한다.
  let entries = byKey(suggest(store, frames, bodies));
  assert.deepEqual([entries.get('node:9:1')!.pairKey, entries.get('a')!.pairKey], [null, null]);
  entries = byKey(suggest(store, frames, bodies, { a: ['A'], b: ['B'] }));
  assert.deepEqual([entries.get('node:9:1')!.pairKey, entries.get('a')!.pairKey], ['a', 'node:9:1']);
  assert.deepEqual([entries.get('node:9:2')!.pairKey, entries.get('b')!.pairKey], [null, null]);
});

test('배포 확정 뒤 맞지 않게 된 제안은 버린다', () => {
  const store = seeded();
  register(store, 'e', 'STB_HO_005', 'fp-a', '1:5');
  store.reload();
  const frames = [frame('1:2', 'fp-b', 'b'), frame('1:3', 'fp-c', 'c'), frame('1:4', 'fp-d', 'd'), frame('1:5', 'fp-a', 'e')];
  const before = classify(store.state, frames);
  const suggestions = suggestReplacements(store.state, before, new Map());
  assert.deepEqual(suggestions.map(s => [s.key, s.screenId, s.same]), [['e', 'a', true]]);
  // 확정: a가 e의 원본을 이어받고 e는 사용 안 함이 된다.
  store.put(keys.screen('a'), { ...store.state.screens.get('a')!, source: { nodeId: '1:5', pageId: PAGE } });
  store.put(keys.screen('e'), { ...store.state.screens.get('e')!, status: 'deleted', source: null });
  store.reload();
  const after = classify(store.state, frames);
  applyReplaceSuggestions(store.state, after, suggestions);
  assert.ok(after.every(e => !e.pairKey));
});

test('GUI 전체 확인은 붙여 넣은 프레임의 내용과 범위 밖에 남은 옛 원본을 읽어 교체를 제안한다', async () => {
  const store = seeded();
  // a의 옛 원본(1:1)은 보관 페이지로 옮겨져 범위 밖이다. 9:1은 a를 고친 화면이다.
  const canvas = new Map<string, { pageId: string; fp: string; body: string; content: string; tag: string | null }>([
    ['1:1', { pageId: ARCHIVE, fp: 'fp-a', body: 'A', content: 'v1', tag: 'a' }],
    ['1:2', { pageId: PAGE, fp: 'fp-b', body: 'B', content: 'v1', tag: 'b' }],
    ['1:3', { pageId: PAGE, fp: 'fp-c', body: 'C', content: 'v1', tag: 'c' }],
    ['1:4', { pageId: PAGE, fp: 'fp-d', body: 'D', content: 'v1', tag: 'd' }],
    ['9:1', { pageId: PAGE, fp: 'fp-a2', body: 'A', content: 'v2', tag: null }],
  ]);
  const features: string[] = [];
  const posted: ToUi[] = [];
  const host = {
    kv: store.kv, mode: 'GUI', actor, post: (m: ToUi) => posted.push(m), pages: () => [{ id: PAGE, name: '원본' }, { id: ARCHIVE, name: '보관' }],
    listFrames: async (pageIds: string[]) => [...canvas].filter(([, f]) => pageIds.includes(f.pageId))
      .map(([nodeId, f]) => ({ nodeId, pageId: f.pageId, name: `Frame ${nodeId}`, width: 1920, height: 1080, screenTag: f.tag, fingerprint: null, error: null })),
    createFingerprintReader: () => ({
      fingerprint: async (id: string, _legacy?: boolean, _digest?: unknown, withTokens?: boolean) => {
        const f = canvas.get(id)!;
        return { fingerprint: f.fp, ...(withTokens ? { tokens: tokenHashes(words(f.body, f.content)) } : {}), error: null };
      },
      screenFeatures: async (id: string) => {
        features.push(id);
        const f = canvas.get(id);
        return f ? { fingerprint: f.fp, tokens: words(f.body, f.content), error: null } : { fingerprint: null, tokens: null, error: 'missing' };
      },
    }),
  } as unknown as Host;
  const controller = new Controller(host);
  await controller.handle({ type: 'ready' });
  await controller.handle({ type: 'scan' });
  // 원본을 찾지 못한 화면(a)의 옛 원본만 읽는다.
  assert.deepEqual(features, ['1:1']);
  const entries = byKey(controller.entries);
  assert.deepEqual([entries.get('node:9:1')!.pairKey, entries.get('a')!.pairKey], ['a', 'node:9:1']);
  // 목록으로 보내는 프레임에는 토큰을 싣지 않는다.
  const sent = posted.filter(m => m.type === 'entries').pop() as Extract<ToUi, { type: 'entries' }>;
  assert.ok(sent.entries.every(e => !e.frame || !('tokens' in e.frame)));
  // 다시 확인해도 같은 제안이 나온다.
  await controller.handle({ type: 'scan' });
  assert.equal(byKey(controller.entries).get('node:9:1')!.pairKey, 'a');
});

test('기존 화면 교체의 변경 사항은 교체하는 프레임을 교체할 화면의 지난 배포와 비교한다', async () => {
  const store = seeded();
  // b의 지난 배포 화면과 그 변경 근거를 남긴다. 붙여 넣은 프레임은 노드 ID·프레임 이름이 달라도 레이어 이름 경로로 잇는다.
  const snap = (rootName: string, rootId: string, title: string, sub: string): NodeSnapshot => ({
    type: 'FRAME', name: rootName, id: rootId, props: { width: 1920, height: 1080 },
    children: [
      { type: 'TEXT', name: 'Title', id: `${rootId}-t`, props: { characters: title } },
      { type: 'TEXT', name: 'Sub', id: `${rootId}-s`, props: { characters: sub } },
    ],
  });
  const published = snap('[STB_HO_002] 화면', '1:2', '홈', '배너');
  const fpB = fingerprint(published);
  const storedDigest = changeDigest(fpB, { always: true }, () => published).digest!;
  store.put(keys.gui('b', 1), { ...store.state.gui.get('b')![0], fingerprint: fpB });
  store.kv.set(keys.digest('b'), storedDigest);
  store.reload();
  const canvas = new Map<string, NodeSnapshot>([
    ['1:2', published],
    ['9:1', snap('Frame 1', '9:1', '홈', '배너')],
    ['9:2', snap('Frame 2', '9:2', '홈', '새 배너')],
  ]);
  const posted: ToUi[] = [];
  const host = {
    kv: store.kv, mode: 'GUI', actor, post: (m: ToUi) => posted.push(m), pages: () => [{ id: PAGE, name: '원본' }],
    listFrames: async () => [...canvas.keys()].map(nodeId => ({ nodeId, pageId: PAGE, name: canvas.get(nodeId)!.name, width: 1920, height: 1080, screenTag: nodeId === '1:2' ? 'b' : null, fingerprint: null, error: null })),
    createFingerprintReader: () => ({
      fingerprint: async (id: string, _legacy?: boolean, digest?: DigestRequest) => {
        const s = canvas.get(id)!;
        const fp = fingerprint(s);
        return { fingerprint: fp, ...changeDigest(fp, digest, () => s), error: null };
      },
      screenFeatures: async () => ({ fingerprint: null, tokens: null, error: 'missing' }),
    }),
  } as unknown as Host;
  const controller = new Controller(host);
  await controller.handle({ type: 'ready' });
  await controller.handle({ type: 'scan' });
  const reasonOf = async (entryKey: string) => {
    await controller.handle({ type: 'replaceReason', entryKey, screenId: 'b' });
    return posted.filter(m => m.type === 'replaceReason').pop() as Extract<ToUi, { type: 'replaceReason' }>;
  };
  const same = await reasonOf('node:9:1');
  assert.deepEqual([same.same, same.reason], [true, null]);
  const changed = await reasonOf('node:9:2');
  assert.equal(changed.same, false);
  assert.equal(changed.reason!.status, 'complete');
  const text = changed.reason!.groups.find(g => g.group === 'text')!;
  assert.deepEqual(text.layers.map(l => [l.layer.path.join(' › '), l.layer.nodeId]), [['Sub', '9:2-s']]);
  // 기록은 바꾸지 않는다.
  assert.equal(store.kv.get(keys.digest('b')), storedDigest);
});
