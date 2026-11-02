// 변경사항 확인의 교체 제안(2026-11-02 사용자 요청: 기존 화면 교체를 화면마다 하나씩 고르지 않게).
// 새 버전 페이지와 같은 규칙으로 짝을 찾는다: 비교 기준 지문과 같으면 「동일」, 화면 내용이 SIMILAR_MIN 이상 비슷하면 「유사」.
// 프레임 이름은 보지 않는다(2026-10-21 사용자 결정). 찾은 짝은 항목의 pairKey로 넣어 등록 방식의 기본값이 된다.
//
// 교체하는 쪽: 짝이 없는 신규 후보(붙여 넣은 프레임), 원본이 있는 배포 화면(잘못 신규로 배포한 화면).
// 교체되는 쪽: 원본을 찾지 못한 화면, 원본이 남아 있는 화면(신규 후보만 교체할 수 있다).
// 화면 표식까지 복제된 프레임(복제 의심)도 다른 신규 후보와 같은 규칙으로 가장 비슷한 화면을 제안한다(2026-11-02 사용자 요청:
// 어차피 제안이므로 복제여도 비슷한 화면을 보여 준다). 케이스·변형을 만들려고 복제했으면 사용자가 신규 등록으로 바꾼다.
// 지운 원본의 내용은 남기지 않으므로(2026-11-02 사용자 결정), 원본을 찾지 못한 화면은 파일에 남은 옛 원본이 있을 때만 내용으로 비교하고
// 그 밖에는 지난 배포와 같은 프레임만 찾는다.
import { baseline, type Entry, type ScannedFrame } from './compare.ts';
import { COPY } from './copy.ts';
import { FINGERPRINT_VERSION, LEGACY_FINGERPRINT_VERSION } from './fingerprint.ts';
import type { State } from './store.ts';
import type { Screen } from './types.ts';
import { SIMILAR_MIN } from './versionMatch.ts';

// key: 교체하는 항목(신규 후보 node:…, 배포 화면은 화면 ID), screenId: 교체될 화면, same: 지난 배포·현재 원본과 같은 화면
export interface ReplaceSuggestion { key: string; screenId: string; same: boolean; score: number }

// 화면 내용 토큰(versionMatch.screenTokens)을 32비트 해시로 줄인다. 범위의 모든 프레임 토큰을 확인 한 번 동안 들고 있으므로
// 문자열 대신 숫자로 둔다. 해시가 겹쳐도 유사도가 조금 오를 뿐이고, 같은 화면 판정은 지문으로 한다.
export function tokenHashes(tokens: string[]): Uint32Array {
  const out = new Uint32Array(tokens.length);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    let h = 0x811c9dc5;
    for (let j = 0; j < t.length; j++) { h ^= t.charCodeAt(j); h = Math.imul(h, 0x01000193); }
    out[i] = h >>> 0;
  }
  return out;
}

interface Side { entry: Entry; screen: Screen | null; missing: boolean; order: number }
type Bag = Map<number, number>;

const fpKey = (version: number, fp: string) => `${version}:${fp}`;
function frameKeys(frame: ScannedFrame | null): string[] {
  const out: string[] = [];
  if (frame?.fingerprint) out.push(fpKey(FINGERPRINT_VERSION, frame.fingerprint));
  if (frame?.legacyFingerprint) out.push(fpKey(LEGACY_FINGERPRINT_VERSION, frame.legacyFingerprint));
  return out;
}
function baselineKey(state: State, screen: Screen | null): string | null {
  const base = screen ? baseline(state, screen) : null;
  return base?.fingerprint ? fpKey(base.fpVersion ?? LEGACY_FINGERPRINT_VERSION, base.fingerprint) : null;
}

// 대부분의 프레임에 있는 토큰(공통 배경·GNB 등)은 화면을 구분하지 못하므로 뺀다(versionMatch.commonTokens와 같은 기준).
function commonTokens(lists: Uint32Array[]): Set<number> {
  const df = new Map<number, number>();
  for (const list of lists) for (const t of new Set(list)) df.set(t, (df.get(t) ?? 0) + 1);
  const limit = Math.max(2, lists.length / 2);
  return new Set([...df].filter(([, n]) => n > limit).map(([t]) => t));
}
function bagOf(list: Uint32Array, common: Set<number>): { bag: Bag; size: number } {
  const bag: Bag = new Map();
  let size = 0;
  for (const t of list) if (!common.has(t)) { bag.set(t, (bag.get(t) ?? 0) + 1); size++; }
  return { bag, size };
}

// 중복을 세는 Jaccard 유사도(versionMatch.similarity)가 SIMILAR_MIN 이상인 짝. 토큰별로 그 토큰을 가진 쪽만 모아 세므로
// 신규 후보 × 화면 전체를 하나씩 비교하지 않는다(공통 토큰을 뺀 토큰은 가진 프레임이 적다).
function similarPairs(from: { bag: Bag; size: number }[], to: { bag: Bag; size: number }[]): { from: number; to: number; score: number }[] {
  const index = new Map<number, [number, number][]>();
  to.forEach((t, ti) => { for (const [tok, n] of t.bag) { const list = index.get(tok); if (list) list.push([ti, n]); else index.set(tok, [[ti, n]]); } });
  const out: { from: number; to: number; score: number }[] = [];
  const inter = new Float64Array(to.length);
  from.forEach((f, fi) => {
    const touched: number[] = [];
    for (const [tok, n] of f.bag) for (const [ti, m] of index.get(tok) ?? []) {
      if (!inter[ti]) touched.push(ti);
      inter[ti] += Math.min(n, m);
    }
    for (const ti of touched) {
      const score = inter[ti] / (f.size + to[ti].size - inter[ti]);
      inter[ti] = 0;
      if (score >= SIMILAR_MIN) out.push({ from: fi, to: ti, score });
    }
  });
  return out;
}

// tokens: 범위 프레임 노드 ID → 내용 토큰 해시, oldTokens: 원본을 찾지 못한 화면 ID → 파일에 남은 옛 원본의 토큰 해시
export function suggestReplacements(state: State, entries: Entry[], tokens: Map<string, Uint32Array>, oldTokens: Map<string, Uint32Array> = new Map()): ReplaceSuggestion[] {
  const active = (e: Entry) => !!e.screenId && state.screens.get(e.screenId)?.status === 'active';
  const byCode = (a: Side, b: Side) => (a.screen?.code ?? '').localeCompare(b.screen?.code ?? '', 'ko', { numeric: true }) || a.order - b.order;
  const side = (entry: Entry, order: number): Side => ({ entry, screen: entry.screenId ? state.screens.get(entry.screenId) ?? null : null, missing: entry.estimate === 'missing', order });
  const all = entries.map(side);
  // 이미 짝이 있는 항목(잘라내 붙인 프레임과 원래 화면)은 그대로 둔다.
  const fresh = all.filter(s => s.entry.frame && !s.entry.screenId && !s.entry.pairKey && !s.entry.frame.error);
  const missing = all.filter(s => s.missing && !s.entry.pairKey && active(s.entry)).sort(byCode);
  const present = all.filter(s => s.entry.frame && !s.missing && s.entry.estimate !== 'retired' && active(s.entry) && !s.entry.frame.error).sort(byCode);

  const out: ReplaceSuggestion[] = [];
  // 교체하는 항목과 교체되는 화면은 한 번씩만 쓴다. 다른 화면을 교체하는 배포 화면은 교체될 수 없다.
  const usedFrom = new Set<string>(), usedTo = new Set<string>();
  const take = (from: Side, to: Side, same: boolean, score: number) => {
    usedFrom.add(from.entry.key);
    usedTo.add(to.entry.screenId!);
    if (from.entry.screenId) usedTo.add(from.entry.screenId);
    out.push({ key: from.entry.key, screenId: to.entry.screenId!, same, score });
  };
  const freeFrom = (list: Side[]) => list.filter(s => !usedFrom.has(s.entry.key) && !usedTo.has(s.entry.screenId ?? ''));
  const freeTo = (list: Side[]) => list.filter(s => !usedTo.has(s.entry.screenId!) && !usedFrom.has(s.entry.key));

  // 1) 같은 화면: 신규 후보의 지문이 화면의 비교 기준(지난 배포)이나 남아 있는 원본과 같다. 원본을 찾지 못한 화면을 먼저 짝짓는다.
  // 정규화 규칙이 다른 지문은 같아도 같은 화면이라고 단정하지 않으므로 규칙 버전까지 맞춘다.
  const sameIndex = new Map<string, Side[]>();
  for (const to of [...missing, ...present]) {
    const keys = new Set([baselineKey(state, to.screen), ...(to.missing ? [] : frameKeys(to.entry.frame))].filter((k): k is string => !!k));
    for (const k of keys) sameIndex.set(k, [...(sameIndex.get(k) ?? []), to]);
  }
  for (const from of fresh) {
    for (const k of frameKeys(from.entry.frame)) {
      const to = sameIndex.get(k)?.find(t => !usedTo.has(t.entry.screenId!));
      if (to) { take(from, to, true, 1); break; }
    }
  }
  // 잘못 신규로 배포한 화면: 원본이 있는 배포 화면의 지금 지문이나 비교 기준이 원본을 찾지 못한 화면의 비교 기준과 같다.
  const missingIndex = new Map<string, Side[]>();
  for (const to of missing) { const k = baselineKey(state, to.screen); if (k) missingIndex.set(k, [...(missingIndex.get(k) ?? []), to]); }
  for (const from of freeFrom(present)) {
    const keys = new Set([...frameKeys(from.entry.frame), baselineKey(state, from.screen)].filter((k): k is string => !!k));
    for (const k of keys) {
      const to = missingIndex.get(k)?.find(t => !usedTo.has(t.entry.screenId!));
      if (to) { take(from, to, true, 1); break; }
    }
  }

  // 2) 비슷한 화면: 남은 신규 후보 → 남은 화면, 남은 배포 화면 → 남은 원본 없음 화면. 점수가 높은 짝부터, 같으면 원본 없는 화면을 먼저 정한다.
  const tokensOf = (s: Side) => (s.missing ? oldTokens.get(s.entry.screenId!) : s.entry.frame ? tokens.get(s.entry.frame.nodeId) : undefined);
  const withTokens = (list: Side[]) => list.filter(s => tokensOf(s)?.length);
  const fromFresh = withTokens(freeFrom(fresh));
  const fromPresent = withTokens(freeFrom(present));
  if (!fromFresh.length && !fromPresent.length) return out;
  const common = commonTokens([...tokens.values(), ...oldTokens.values()]);
  const bags = new Map<Side, { bag: Bag; size: number }>();
  const bagFor = (s: Side) => { let b = bags.get(s); if (!b) { b = bagOf(tokensOf(s)!, common); bags.set(s, b); } return b; };
  const assign = (froms: Side[], tos: Side[]) => {
    const f = froms.filter(s => !usedFrom.has(s.entry.key) && !usedTo.has(s.entry.screenId ?? ''));
    const t = withTokens(freeTo(tos));
    if (!f.length || !t.length) return;
    const pairs = similarPairs(f.map(bagFor), t.map(bagFor));
    pairs.sort((a, b) => b.score - a.score || Number(t[b.to].missing) - Number(t[a.to].missing) || byCode(t[a.to], t[b.to]) || f[a.from].order - f[b.from].order);
    for (const p of pairs) {
      const from = f[p.from], to = t[p.to];
      if (usedFrom.has(from.entry.key) || usedTo.has(to.entry.screenId!) || usedFrom.has(to.entry.key) || usedTo.has(from.entry.screenId ?? '')) continue;
      take(from, to, false, p.score);
    }
  };
  assign(fromFresh, [...missing, ...present]);
  assign(fromPresent, missing);
  return out;
}

// 찾은 짝을 목록 항목에 넣는다. 교체하는 항목의 pairKey는 교체될 화면 ID, 원본을 찾지 못한 화면의 pairKey는 교체하는 항목 키다
// (잘라내 붙인 프레임의 짝과 같은 뜻). 원본이 남아 있는 화면은 그 화면의 등록 방식을 바꾸지 않으므로 안내만 붙인다.
// 제안을 만든 뒤 배포 확정·다시 확인으로 항목이 바뀌었으면 맞지 않는 제안은 버린다.
export function applyReplaceSuggestions(state: State, entries: Entry[], suggestions: ReplaceSuggestion[]): void {
  if (!suggestions.length) return;
  const byKey = new Map(entries.map(e => [e.key, e]));
  const byScreen = new Map(entries.filter(e => e.screenId).map(e => [e.screenId!, e]));
  const active = (e: Entry) => !!e.screenId && state.screens.get(e.screenId)?.status === 'active';
  const percent = (s: ReplaceSuggestion) => (s.same ? '' : ` (${COPY.uiApp254} ${Math.round(s.score * 100)}%)`);
  for (const s of suggestions) {
    const from = byKey.get(s.key), to = byScreen.get(s.screenId);
    if (!from?.frame || !to || from === to || from.pairKey || !active(to)) continue;
    if (from.screenId && (!active(from) || from.estimate === 'missing')) continue;
    if (to.estimate === 'missing' ? to.pairKey : from.screenId) continue;
    const screen = state.screens.get(s.screenId)!;
    from.pairKey = s.screenId;
    from.notes.push(`${s.same ? COPY.coreCompare004 : COPY.coreCompare005} ${screen.code} ${screen.name}${percent(s)}`);
    if (to.estimate === 'missing') to.pairKey = from.key;
    const partner = from.screenId ? state.screens.get(from.screenId)! : null;
    to.notes.push(`${COPY.coreCompare006} ${partner ? `${partner.code} ${partner.name}` : from.frame.name}${percent(s)}`);
  }
}
