// 새 버전 페이지 전환: 다른 파일에서 페이지째 붙여 넣은 프레임을 등록 화면에 연결한다.
// 붙여 넣은 프레임은 노드 ID와 화면 표식이 새로 생기고 이름도 제각각이라, 이름은 쓰지 않고 화면 내용으로만 연결한다(2026-10-21 사용자 결정).
// 1) 지난 배포의 비교 기준 지문과 같으면 「동일」, 2) 기존 원본 프레임과 내용이 비슷하면 「유사」로 제안하고, 사용자가 확인·수정한 뒤 전환한다.
import { baseline } from './compare.ts';
import { COPY } from './copy.ts';
import { FINGERPRINT_VERSION, LEGACY_FINGERPRINT_VERSION, type NodeSnapshot } from './fingerprint.ts';
import type { State } from './store.ts';

// 화면 내용 비교용 특징. 글자, 이미지, 레이어의 종류·크기·위치를 하나씩 토큰으로 만든다.
export function screenTokens(root: NodeSnapshot): string[] {
  const out: string[] = [];
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0);
  const walk = (node: NodeSnapshot, isRoot: boolean) => {
    const p = node.props;
    if (p.visible === false) return;
    // 루트의 캔버스 위치는 화면 내용이 아니다.
    out.push(isRoot ? `g:${node.type}:${num(p.width)}x${num(p.height)}` : `g:${node.type}:${num(p.width)}x${num(p.height)}@${num(p.x)},${num(p.y)}`);
    if (typeof p.characters === 'string' && p.characters.trim()) out.push(`t:${p.characters.trim()}`);
    if (Array.isArray(p.fills)) for (const fill of p.fills as { type?: string; imageHash?: string | null }[]) if (fill?.type === 'IMAGE' && fill.imageHash) out.push(`i:${fill.imageHash}`);
    for (const child of node.children ?? []) walk(child, false);
  };
  walk(root, true);
  return out;
}

type Bag = Map<string, number>;
function bag(tokens: string[]): Bag {
  const out: Bag = new Map();
  for (const t of tokens) out.set(t, (out.get(t) ?? 0) + 1);
  return out;
}

// 중복을 세는 Jaccard 유사도(0~1). 양쪽에 같은 토큰이 같은 개수만큼 있으면 1이다.
export function similarity(a: Bag, b: Bag): number {
  let inter = 0, sizeA = 0, sizeB = 0;
  for (const n of a.values()) sizeA += n;
  for (const n of b.values()) sizeB += n;
  if (!sizeA && !sizeB) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const [t, n] of small) inter += Math.min(n, large.get(t) ?? 0);
  return inter / (sizeA + sizeB - inter);
}

// 이 값보다 낮으면 같은 화면으로 제안하지 않는다.
export const SIMILAR_MIN = 0.5;

// 새 버전 페이지의 프레임. 지문과 특징은 한 번 읽은 스냅숏에서 함께 만든다.
// legacyFingerprint: 1 규칙 지문(1 규칙으로 저장한 비교 기준과 비교)
export interface VersionFrame { nodeId: string; name: string; fingerprint: string | null; legacyFingerprint?: string | null; tokens: string[] | null; error: string | null }

// 대부분의 프레임에 있는 토큰(공통 배경·GNB 등). 화면을 구분하지 못하므로 유사도 계산에서 뺀다.
export function commonTokens(frames: VersionFrame[]): Set<string> {
  const listed = frames.filter(f => f.tokens);
  const df = new Map<string, number>();
  for (const f of listed) for (const t of new Set(f.tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  const limit = Math.max(2, listed.length / 2);
  return new Set([...df].filter(([, n]) => n > limit).map(([t]) => t));
}

// 연결 제안에서 쓴 공통 토큰. 「동일」로 연결한 프레임을 뺀 나머지 프레임에서 센다.
export function versionCommon(frames: VersionFrame[], links: VersionLink[]): Set<string> {
  const same = new Set(links.filter(l => l.kind === 'same' && l.nodeId).map(l => l.nodeId));
  return commonTokens(frames.filter(f => !same.has(f.nodeId)));
}

// 유사도의 근거(2026-10-21 사용자 요청: 「유사 91%」의 근거를 보여 준다).
// 점수 = 일치한 요소 / 비교한 요소(양쪽을 합친 수). 종류별 개수를 더하면 전체가 된다.
export type EvidenceKind = 'text' | 'image' | 'layer';
export interface VersionEvidence {
  score: number; matched: number; total: number;
  parts: Record<EvidenceKind, { matched: number; total: number }>;
  // 공통 요소라 빼고 계산한 요소 수
  ignored: number;
  // 한쪽에만 있는 글자. 앞쪽 일부만 담는다.
  onlySource: string[]; onlyFrame: string[];
}
const EVIDENCE_TEXTS = 20;
const evidenceKind = (t: string): EvidenceKind => (t.startsWith('t:') ? 'text' : t.startsWith('i:') ? 'image' : 'layer');

// 연결 제안과 같은 규칙(공통 토큰 제외, 중복을 세는 Jaccard)으로 계산하므로 score는 제안 때의 유사도와 같다.
export function explainMatch(source: string[], frame: string[], common: Set<string>): VersionEvidence {
  const a = bag(source), b = bag(frame);
  const parts: VersionEvidence['parts'] = { text: { matched: 0, total: 0 }, image: { matched: 0, total: 0 }, layer: { matched: 0, total: 0 } };
  const onlySource: string[] = [], onlyFrame: string[] = [];
  let ignored = 0;
  for (const t of new Set([...a.keys(), ...b.keys()])) {
    const na = a.get(t) ?? 0, nb = b.get(t) ?? 0;
    if (common.has(t)) { ignored += Math.max(na, nb); continue; }
    const part = parts[evidenceKind(t)];
    part.matched += Math.min(na, nb);
    part.total += Math.max(na, nb);
    if (!t.startsWith('t:')) continue;
    for (let i = nb; i < na && onlySource.length < EVIDENCE_TEXTS; i++) onlySource.push(t.slice(2));
    for (let i = na; i < nb && onlyFrame.length < EVIDENCE_TEXTS; i++) onlyFrame.push(t.slice(2));
  }
  const matched = parts.text.matched + parts.image.matched + parts.layer.matched;
  const total = parts.text.total + parts.image.total + parts.layer.total;
  return { score: total ? matched / total : 0, matched, total, parts, ignored, onlySource, onlyFrame };
}

// same: 지난 배포와 같은 화면, similar: 내용이 비슷한 화면(score), manual: 사용자가 고른 연결, none: 연결 없음(전환 후 삭제 후보)
export type VersionKind = 'same' | 'similar' | 'manual' | 'none';
// hasSource: 현재 원본 프레임을 읽어 내용 비교를 할 수 있었는가, sourceName: 현재 원본 프레임 이름
export interface VersionLink { screenId: string; code: string; name: string; nodeId: string | null; kind: VersionKind; score: number; hasSource: boolean; sourceName: string | null }

// 프레임 이름 단서(2026-10-21 사용자 결정): 플러그인이 원본 프레임 이름을 바꾸지 않으므로, 같은 파일에서 다시 붙여 넣은 화면은 이름이 그대로일 가능성이 크다.
// 양쪽에서 한 번만 쓰인 이름이 같을 때만 단서로 본다(「Frame 1」처럼 겹치는 이름은 쓰지 않는다).
export function nameMatches(frames: VersionFrame[], sourceNames: Map<string, string>): Set<string> {
  const count = (names: string[]) => {
    const out = new Map<string, number>();
    for (const n of names) out.set(n, (out.get(n) ?? 0) + 1);
    return out;
  };
  const frameCount = count(frames.map(f => f.name.trim()));
  const sourceCount = count([...sourceNames.values()].map(n => n.trim()));
  const out = new Set<string>();
  for (const [screenId, name] of sourceNames) {
    const n = name.trim();
    if (!n || sourceCount.get(n) !== 1 || frameCount.get(n) !== 1) continue;
    out.add(`${screenId}|${frames.find(f => f.name.trim() === n)!.nodeId}`);
  }
  return out;
}

// 연결 제안. sources: 화면 ID → 현재 원본 프레임의 특징(원본을 찾지 못하면 없음), sourceNames: 화면 ID → 현재 원본 프레임 이름
// 화면 하나에 프레임 하나만 연결한다. 같은 내용의 화면이 여럿이면 이름이 같은 프레임, Screen ID 순서, 캔버스 순서로 짝짓는다.
export function matchVersion(state: State, frames: VersionFrame[], sources: Map<string, string[]>, sourceNames = new Map<string, string>()): VersionLink[] {
  const screens = [...state.screens.values()].filter(s => s.status === 'active')
    .sort((a, b) => a.code.localeCompare(b.code, 'ko', { numeric: true }) || a.name.localeCompare(b.name, 'ko'));
  const links = new Map(screens.map(s => [s.id, { screenId: s.id, code: s.code, name: s.name, nodeId: null, kind: 'none', score: 0, hasSource: sources.has(s.id), sourceName: sourceNames.get(s.id) ?? null } as VersionLink]));
  const used = new Set<string>();
  const named = nameMatches(frames, sourceNames);
  const sameName = (screenId: string, nodeId: string) => named.has(`${screenId}|${nodeId}`);

  // 1) 비교 기준 지문과 같은 프레임. 정규화 규칙이 다른 지문은 같아도 같은 화면이라고 단정하지 않는다.
  // 1 규칙 기준은 프레임의 1 규칙 지문과 맞춘다.
  const index = (pick: (f: VersionFrame) => string | null | undefined) => {
    const out = new Map<string, VersionFrame[]>();
    for (const f of frames) { const fp = pick(f); if (fp) out.set(fp, [...(out.get(fp) ?? []), f]); }
    return out;
  };
  const byFingerprint = { [FINGERPRINT_VERSION]: index(f => f.fingerprint), [LEGACY_FINGERPRINT_VERSION]: index(f => f.legacyFingerprint) } as Record<number, Map<string, VersionFrame[]>>;
  for (const screen of screens) {
    const base = baseline(state, screen);
    const byVersion = byFingerprint[base?.fpVersion ?? 1];
    if (!base?.fingerprint || !byVersion) continue;
    const candidates = byVersion.get(base.fingerprint)?.filter(f => !used.has(f.nodeId)) ?? [];
    const frame = candidates.find(f => sameName(screen.id, f.nodeId)) ?? candidates[0];
    if (!frame) continue;
    used.add(frame.nodeId);
    Object.assign(links.get(screen.id)!, { nodeId: frame.nodeId, kind: 'same', score: 1 });
  }

  // 2) 남은 화면과 프레임을 내용 유사도로 짝짓는다. 이름이 같은 짝을 먼저, 그다음 점수가 높은 짝부터 정한다.
  // 이름이 같으면 유사도가 기준보다 낮아도 제안한다(화면을 크게 고친 경우).
  // 대부분의 프레임에 있는 토큰(공통 배경·GNB 등)은 화면을 구분하지 못하므로 뺀다. 계산량도 줄어든다.
  const rest = frames.filter(f => !used.has(f.nodeId) && f.tokens);
  const restScreens = screens.filter(s => links.get(s.id)!.kind === 'none' && sources.get(s.id));
  if (!rest.length || !restScreens.length) return [...links.values()];
  const common = commonTokens(rest);
  const keep = (tokens: string[]) => bag(tokens.filter(t => !common.has(t)));
  const frameBags = rest.map(f => keep(f.tokens!));
  const pairs: { screenId: string; frame: number; score: number; order: number; named: boolean }[] = [];
  restScreens.forEach((screen, order) => {
    const own = keep(sources.get(screen.id)!);
    frameBags.forEach((b, i) => {
      const score = similarity(own, b);
      const isNamed = sameName(screen.id, rest[i].nodeId);
      if (score >= SIMILAR_MIN || isNamed) pairs.push({ screenId: screen.id, frame: i, score, order, named: isNamed });
    });
  });
  pairs.sort((a, b) => Number(b.named) - Number(a.named) || b.score - a.score || a.order - b.order || a.frame - b.frame);
  for (const p of pairs) {
    const link = links.get(p.screenId)!;
    const frame = rest[p.frame];
    if (link.kind !== 'none' || used.has(frame.nodeId)) continue;
    used.add(frame.nodeId);
    Object.assign(link, { nodeId: frame.nodeId, kind: 'similar', score: p.score });
  }
  return [...links.values()];
}

// 전환할 연결을 검사한다. 한 프레임을 두 화면에 연결할 수 없고, 새 버전 페이지의 프레임만 연결할 수 있다.
export function versionLinkErrors(state: State, links: { screenId: string; nodeId: string }[], frameIds: Set<string>): string[] {
  const errors: string[] = [];
  const seen = new Map<string, string>();
  for (const l of links) {
    const screen = state.screens.get(l.screenId);
    if (!screen || screen.status !== 'active') { errors.push(`${COPY.coreVersion001} ${screen?.code ?? l.screenId}`); continue; }
    if (!frameIds.has(l.nodeId)) { errors.push(`${COPY.coreVersion002} ${screen.code}`); continue; }
    const other = seen.get(l.nodeId);
    if (other) errors.push(`${COPY.coreVersion003} ${other}, ${screen.code}`);
    else seen.set(l.nodeId, screen.code);
  }
  return errors;
}
