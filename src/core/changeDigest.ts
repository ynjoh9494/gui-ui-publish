import { canonical, comparedProps, type NodeSnapshot } from './fingerprint.ts';

// 변경 근거: 지문은 같다·다르다만 알려 주므로, 비교 기준(배포·변경 무시) 시점의 화면을 (레이어 × 속성 묶음 → 값 해시)
// 원소의 집합으로 보고 고정 크기 IBLT(Invertible Bloom Lookup Table, Eppstein 외 「What's the Difference?」)로 요약해 둔다.
// 현재 화면의 표에서 기준 표를 빼면 서로 다른 원소만 남아 풀려 나오므로, 저장량은 레이어 수가 아니라 찾을 차이 수로 정해진다.
// 묶음 나누기·짝 규칙·표 크기·해시를 바꾸면 올린다. 다른 버전의 기록은 「근거 기록 없음」으로 본다.
export const DIGEST_VERSION = 1;

export const DIGEST_GROUPS = ['structure', 'display', 'geometry', 'paint', 'effects', 'shape', 'text', 'textStyle', 'variables', 'other'] as const;
export type DigestGroup = typeof DIGEST_GROUPS[number];

// figma/snapshot.ts가 수집하는 속성의 묶음. 수집 속성을 추가하면 여기에도 넣는다(빠지면 테스트가 실패한다).
const PROP_GROUP: Record<string, DigestGroup> = {
  visible: 'display', opacity: 'display', blendMode: 'display', isMask: 'display', maskType: 'display', clipsContent: 'display',
  x: 'geometry', y: 'geometry', width: 'geometry', height: 'geometry', rotation: 'geometry',
  fills: 'paint', strokes: 'paint', strokeWeight: 'paint', strokeTopWeight: 'paint', strokeBottomWeight: 'paint', strokeLeftWeight: 'paint',
  strokeRightWeight: 'paint', strokeAlign: 'paint', strokeCap: 'paint', strokeJoin: 'paint', strokeMiterLimit: 'paint', dashPattern: 'paint',
  effects: 'effects',
  cornerRadius: 'shape', topLeftRadius: 'shape', topRightRadius: 'shape', bottomLeftRadius: 'shape', bottomRightRadius: 'shape', cornerSmoothing: 'shape',
  arcData: 'shape', pointCount: 'shape', innerRadius: 'shape', booleanOperation: 'shape', vectorPaths: 'shape', handleMirroring: 'shape',
  characters: 'text',
  textAlignHorizontal: 'textStyle', textAlignVertical: 'textStyle', textAutoResize: 'textStyle', textTruncation: 'textStyle', maxLines: 'textStyle',
  paragraphSpacing: 'textStyle', paragraphIndent: 'textStyle', listSpacing: 'textStyle', leadingTrim: 'textStyle', hangingPunctuation: 'textStyle',
  hangingList: 'textStyle', segments: 'textStyle',
  variables: 'variables',
};

// 표에 없는 속성은 「기타」에 넣어 지문 차이가 근거에서 빠지지 않게 한다.
export function propGroup(key: string): DigestGroup {
  return PROP_GROUP[key] ?? 'other';
}

type Value = Record<string, unknown>;

// 변수 연결(별칭 ID)을 지운다. 칠·효과에는 해석된 색·수치가 함께 들어 있다.
function withoutAliases(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutAliases);
  if (value && typeof value === 'object') {
    const out: Value = {};
    for (const [k, v] of Object.entries(value)) if (k !== 'boundVariables') out[k] = withoutAliases(v);
    return out;
  }
  return value;
}

// 보이는 칠·선·효과만 남긴다. 숨기거나 불투명도가 0인 항목은 화면에 나타나지 않는다.
function shown(list: unknown): unknown {
  if (!Array.isArray(list)) return withoutAliases(list);
  return list.filter(item => {
    const p = item as { visible?: boolean; opacity?: number } | null;
    return !(p && typeof p === 'object' && (p.visible === false || p.opacity === 0));
  }).map(withoutAliases);
}

const FRAME_LIKE = new Set(['FRAME', 'COMPONENT', 'INSTANCE']);

// 화면 기준 짝: 원래 값이 달라도 이 값이 같으면 「보이는 값은 같음」이다. 판정은 보수적인 쪽으로만 틀린다
// (예: 10.49 → 10.51은 1px 반올림 값도 달라 「다름」으로 나온다).
const COMPANION: Partial<Record<DigestGroup, (value: Value) => unknown>> = {
  // 인스턴스 분리·컴포넌트 만들기는 노드 종류만 바꾼다.
  structure: v => ({ ...v, t: FRAME_LIKE.has(v.t as string) ? 'FRAME' : v.t }),
  // 위치·크기는 1px, 회전은 0.1° 단위
  geometry: v => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === 'number' ? (k === 'rotation' ? Math.round(x * 10) / 10 : Math.round(x)) : x])),
  paint: v => {
    const strokes = shown(v.strokes);
    // 보이는 선이 없으면 선 두께·정렬 등은 화면에 나타나지 않는다.
    if (Array.isArray(strokes) && !strokes.length) return { fills: shown(v.fills) };
    return { ...v, fills: shown(v.fills), strokes };
  },
  effects: v => ({ effects: shown(v.effects) }),
  textStyle: v => ({
    ...v,
    segments: Array.isArray(v.segments) ? v.segments.map(s => ({ ...(withoutAliases(s) as Value), fills: shown((s as Value).fills) })) : v.segments,
  }),
  // 값이 같은 다른 변수로 다시 연결한 경우
  variables: v => (v.variables && typeof v.variables === 'object' ? Object.values(v.variables).map(x => canonical(x)).sort() : v.variables),
};
const COMPANION_GROUPS = DIGEST_GROUPS.filter(g => COMPANION[g]);

export function hasCompanion(group: DigestGroup): boolean {
  return !!COMPANION[group];
}

// 원소의 종류: 묶음 0~9, 짝 10~15. 키의 아래 4비트에 넣는다.
const KINDS = DIGEST_GROUPS.length + COMPANION_GROUPS.length;
const kindOf = (group: DigestGroup) => DIGEST_GROUPS.indexOf(group);
const companionKind = (group: DigestGroup) => DIGEST_GROUPS.length + COMPANION_GROUPS.indexOf(group);

// ── 해시 ─────────────────────────────────────────────
// 원소마다 부르므로 SHA-256 대신 32비트 해시를 쓰고 UTF-8로 바꾸지 않는다. 위조 방지가 아니라 우연한 충돌만 피하면 된다.

function fmix(h: number): number {
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function hashText(text: string, seed: number): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return fmix(h ^ text.length);
}

function mix(a: number, b: number, seed: number): number {
  return fmix(Math.imul(a ^ seed, 0x9e3779b1) ^ fmix((b + seed) | 0));
}

const SEED_PATH = 0x2f1d;
const SEED_VALUE = 0x51a7;
const SEED_CHECK = 0x6c8e;
const SEED_SUM = [0x13b5, 0x7f4a];
const SEED_CELL = [0x0a31, 0x3d77, 0x5e09];

// ── IBLT ─────────────────────────────────────────────
// 해시 함수마다 칸을 나눠 한 원소가 서로 다른 세 칸에 들어간다. 132칸이면 서로 다른 원소 약 90개까지 거의 항상 풀린다
// (보이지 않는 변경은 레이어·묶음 하나에 원소 2개, 보이는 변경은 짝까지 4개).
const PART = 44;
const CELLS = PART * 3;

interface Table { count: Uint16Array; key: Uint32Array; val: Uint32Array; check: Uint32Array }

function emptyTable(): Table {
  return { count: new Uint16Array(CELLS), key: new Uint32Array(CELLS), val: new Uint32Array(CELLS), check: new Uint32Array(CELLS) };
}

function cellsOf(key: number, val: number): number[] {
  return SEED_CELL.map((seed, j) => j * PART + (mix(key, val, seed) % PART));
}

// count는 2¹⁶으로 돌아가며 더한다. 뺀 표의 칸은 작은 값만 남으므로 부호를 그대로 읽을 수 있다.
function toggle(t: Table, cell: number, key: number, val: number, check: number, sign: number): void {
  t.count[cell] += sign;
  t.key[cell] ^= key;
  t.val[cell] ^= val;
  t.check[cell] ^= check;
}

function subtract(a: Table, b: Table): Table {
  const out = emptyTable();
  for (let i = 0; i < CELLS; i++) {
    out.count[i] = a.count[i] - b.count[i];
    out.key[i] = a.key[i] ^ b.key[i];
    out.val[i] = a.val[i] ^ b.val[i];
    out.check[i] = a.check[i] ^ b.check[i];
  }
  return out;
}

interface Item { key: number; val: number; side: 1 | -1 }

// side 1: 현재에만 있음, -1: 기준에만 있음. 다 풀지 못하면 complete가 false이고 풀린 원소만 돌려준다.
function peel(t: Table): { items: Item[]; complete: boolean } {
  const items: Item[] = [];
  const pure = (i: number) => (t.count[i] === 1 || t.count[i] === 0xffff) && t.check[i] === mix(t.key[i], t.val[i], SEED_CHECK);
  const queue: number[] = [];
  for (let i = 0; i < CELLS; i++) if (pure(i)) queue.push(i);
  while (queue.length && items.length <= CELLS * 4) {
    const i = queue.pop()!;
    if (!pure(i)) continue;
    const key = t.key[i], val = t.val[i], side: 1 | -1 = t.count[i] === 1 ? 1 : -1;
    items.push({ key, val, side });
    const check = mix(key, val, SEED_CHECK);
    for (const cell of cellsOf(key, val)) {
      toggle(t, cell, key, val, check, -side);
      if (pure(cell)) queue.push(cell);
    }
  }
  let complete = true;
  for (let i = 0; i < CELLS && complete; i++) complete = !t.count[i] && !t.key[i] && !t.val[i] && !t.check[i];
  return { items, complete };
}

// ── 화면 → 원소 ──────────────────────────────────────

export interface DigestLayer {
  // 루트 아래 레이어 이름. 같은 이름의 형제가 앞에 있으면 「이름 (2)」처럼 순서를 붙인다. 루트는 빈 배열
  path: string[];
  nodeId: string | null;
  parent: number;
  // 경로 해시(원소 키의 위 28비트)
  hash: number;
}

export interface ScreenDigest {
  fingerprint: string;
  // 종류마다 순서 무관 합 2개(묶음별 요약값). 표가 다 풀리지 않아도 어느 묶음이 다른지 알 수 있다.
  summary: Uint32Array;
  table: Table;
}

export interface CurrentDigest extends ScreenDigest {
  layers: DigestLayer[];
  // 경로 해시 → layers 위치
  layerOf: Map<number, number>;
}

// 노드 하나의 묶음별 값. 글자 서식 구간은 내용과 함께 바뀌므로 구간 위치는 텍스트 내용에, 서식만 텍스트 스타일에 둔다.
function groupValues(node: NodeSnapshot, root: boolean, children: string[] | undefined): Map<DigestGroup, Value> {
  const out = new Map<DigestGroup, Value>([['structure', { t: node.type, c: children }]]);
  const put = (group: DigestGroup, key: string, value: unknown) => {
    let bucket = out.get(group);
    if (!bucket) out.set(group, bucket = {});
    bucket[key] = value;
  };
  for (const [key, value] of Object.entries(comparedProps(node, root))) {
    if (value === undefined) continue;
    if (key === 'segments' && Array.isArray(value)) {
      const segments = value as Value[];
      put('text', 'bounds', segments.map(s => [s.start, s.end]));
      put('textStyle', 'segments', segments.map(({ characters: _c, start: _s, end: _e, ...style }) => style));
      continue;
    }
    put(propGroup(key), key, value);
  }
  return out;
}

export function digestOf(root: NodeSnapshot, fingerprint: string): CurrentDigest {
  const summary = new Uint32Array(KINDS * 2);
  const table = emptyTable();
  const layers: DigestLayer[] = [];
  const layerOf = new Map<number, number>();
  const add = (key: number, kind: number, text: string) => {
    const val = hashText(text, SEED_VALUE);
    for (let s = 0; s < 2; s++) summary[kind * 2 + s] += mix(key, val, SEED_SUM[s]);
    const check = mix(key, val, SEED_CHECK);
    for (const cell of cellsOf(key, val)) toggle(table, cell, key, val, check, 1);
  };
  const walk = (node: NodeSnapshot, path: string, labels: string[], parent: number) => {
    const index = layers.length;
    const pathHash = hashText(path, SEED_PATH) & ~0xf;
    layers.push({ path: labels, nodeId: node.id ?? null, parent, hash: pathHash });
    layerOf.set(pathHash, index);
    // 레이어는 이름 경로로 잇는다. 노드 ID는 페이지를 다른 파일에서 복사해 오면 바뀐다. 같은 이름의 형제는 순서로 나눈다.
    const seen = new Map<string, number>();
    const kids = node.children?.map(child => {
      const name = child.name ?? '';
      const n = seen.get(name) ?? 0;
      seen.set(name, n + 1);
      return { child, id: `${name}\u0002${n}`, label: n ? `${name} (${n + 1})` : name };
    });
    for (const [group, value] of groupValues(node, parent < 0, kids?.map(k => k.id))) {
      const key = (pathHash | kindOf(group)) >>> 0;
      add(key, kindOf(group), canonical(value, true));
      const companion = COMPANION[group];
      if (companion) add((pathHash | companionKind(group)) >>> 0, companionKind(group), canonical(companion(value)));
    }
    for (const k of kids ?? []) walk(k.child, `${path}\u0001${k.id}`, [...labels, k.label], index);
  };
  walk(root, '', [], -1);
  return { fingerprint, summary, table, layers, layerOf };
}

// ── 저장 형식 ─────────────────────────────────────────
// { v, fp, t }: t는 요약값과 표를 이어 붙인 바이트의 base64(약 2.6KB). 플러그인 샌드박스에는 btoa가 없어 직접 바꾼다.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return out;
}

function fromBase64(text: string): Uint8Array | null {
  const clean = text.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor(clean.length * 3 / 4));
  let bits = 0, acc = 0, o = 0;
  for (const ch of clean) {
    const v = B64.indexOf(ch);
    if (v < 0) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 255; }
  }
  return out;
}

const BYTES = KINDS * 2 * 4 + CELLS * (2 + 4 + 4 + 4);

export function encodeDigest(digest: ScreenDigest): string {
  const bytes = new Uint8Array(BYTES);
  const view = new DataView(bytes.buffer);
  let o = 0;
  for (const n of digest.summary) { view.setUint32(o, n, true); o += 4; }
  for (const n of digest.table.count) { view.setUint16(o, n, true); o += 2; }
  for (const list of [digest.table.key, digest.table.val, digest.table.check]) for (const n of list) { view.setUint32(o, n, true); o += 4; }
  return JSON.stringify({ v: DIGEST_VERSION, fp: digest.fingerprint, t: toBase64(bytes) });
}

function parse(text: string | null | undefined): { v?: unknown; fp?: unknown; t?: unknown } | null {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

// 저장된 근거가 어떤 지문의 것인지. 형식·버전이 다르면 null
export function digestFingerprint(text: string | null | undefined): string | null {
  const raw = parse(text);
  return raw && raw.v === DIGEST_VERSION && typeof raw.fp === 'string' ? raw.fp : null;
}

export function decodeDigest(text: string | null | undefined): ScreenDigest | null {
  const raw = parse(text);
  if (!raw || raw.v !== DIGEST_VERSION || typeof raw.fp !== 'string' || typeof raw.t !== 'string') return null;
  const bytes = fromBase64(raw.t);
  if (!bytes || bytes.length !== BYTES) return null;
  const view = new DataView(bytes.buffer);
  let o = 0;
  const summary = new Uint32Array(KINDS * 2);
  for (let i = 0; i < summary.length; i++) { summary[i] = view.getUint32(o, true); o += 4; }
  const table = emptyTable();
  for (let i = 0; i < CELLS; i++) { table.count[i] = view.getUint16(o, true); o += 2; }
  for (const list of [table.key, table.val, table.check]) for (let i = 0; i < CELLS; i++) { list[i] = view.getUint32(o, true); o += 4; }
  return { fingerprint: raw.fp, summary, table };
}

// ── 풀이 ─────────────────────────────────────────────

export interface LayerRef { path: string[]; nodeId: string | null }

export interface GroupChange {
  group: DigestGroup;
  // 짝이 있는 묶음에서 보이는 값이 같으면 true, 다르면 false. 짝이 없는 묶음은 null
  sameOnScreen: boolean | null;
  // 표가 다 풀렸을 때만 레이어마다 sameOnScreen이 있다.
  layers: { layer: LayerRef; sameOnScreen?: boolean }[];
}

export interface ChangeReason {
  // complete: 차이를 모두 풀었다. partial: 차이가 많아 일부 레이어만 풀었다(묶음 판정은 정확하다).
  // no-record: 비교 기준의 근거가 없다(이 기능 전의 배포, 다른 버전의 플러그인, 기록 실패).
  // unknown: 지문은 다른데 근거에서 차이를 찾지 못했다. 묶음 표가 수집 속성을 모두 덮으면 생기지 않는다.
  status: 'complete' | 'partial' | 'no-record' | 'unknown';
  // 보이는 값이 바뀌었을 수 있다. false면 다른 속성이 모두 짝 기준으로 같다.
  visible: boolean;
  groups: GroupChange[];
  added: LayerRef[];
  // 이름이나 상위 레이어만 바뀐 레이어(속성 값은 모두 같다)
  renamed: LayerRef[];
  removed: number;
}

// baseline: 지금 비교 기준의 지문(정규화 버전이 현재와 같을 때만). stored: 저장된 근거. always: 배포 확정처럼 늘 기록할 근거를 만든다.
export interface DigestRequest { baseline?: string | null; stored?: string | null; always?: boolean }

// 지문을 계산한 뒤 근거가 필요한지 정하고 만든다. 기준과 같고 근거가 맞으면 아무것도 하지 않는다(대부분의 화면).
// 기준과 다르면 reason과 「변경 무시」 때 기록할 digest를, 기준과 같은데 근거가 없거나 맞지 않으면 채울 digest를 돌려준다.
// named는 레이어 이름·ID를 붙인 스냅샷으로, 근거를 만들 때만 부른다.
export function changeDigest(fingerprint: string, request: DigestRequest | undefined, named: () => NodeSnapshot): { reason?: ChangeReason; digest?: string } {
  if (!request) return {};
  const changed = !!request.baseline && fingerprint !== request.baseline;
  const missing = request.baseline === fingerprint && digestFingerprint(request.stored) !== fingerprint;
  if (!request.always && !changed && !missing) return {};
  const current = digestOf(named(), fingerprint);
  return { digest: encodeDigest(current), ...(changed ? { reason: explainChange(request.stored, request.baseline!, current) } : {}) };
}

const NO_RECORD: ChangeReason = { status: 'no-record', visible: true, groups: [], added: [], renamed: [], removed: 0 };

export function explainChange(stored: string | null | undefined, baseline: string, current: CurrentDigest): ChangeReason {
  const base = decodeDigest(stored);
  if (!base || base.fingerprint !== baseline) return NO_RECORD;
  const differs = (kind: number) => base.summary[kind * 2] !== current.summary[kind * 2] || base.summary[kind * 2 + 1] !== current.summary[kind * 2 + 1];
  const { items, complete } = peel(subtract(current.table, base.table));

  // 경로 해시별로 풀린 원소를 모은다.
  const byPath = new Map<number, { cur: Map<number, number>; base: Map<number, number> }>();
  for (const item of items) {
    const path = item.key & ~0xf;
    let entry = byPath.get(path);
    if (!entry) byPath.set(path, entry = { cur: new Map(), base: new Map() });
    (item.side === 1 ? entry.cur : entry.base).set(item.key & 0xf, item.val);
  }
  const layerRef = (index: number): LayerRef => ({ path: current.layers[index].path, nodeId: current.layers[index].nodeId });
  const STRUCTURE = kindOf('structure');
  const signature = (values: Map<number, number>) => [...values].filter(([k]) => k < DIGEST_GROUPS.length).map(([k, v]) => `${k}:${v}`).sort().join(',');

  // 추가·삭제된 레이어. 속성 값이 모두 같은 추가·삭제 짝은 이름이나 상위 레이어만 바뀐 것으로 본다.
  const added: number[] = [];
  const removed: Map<number, number>[] = [];
  for (const [path, entry] of byPath) {
    const index = current.layerOf.get(path);
    if (index !== undefined && entry.cur.has(STRUCTURE) && !entry.base.has(STRUCTURE)) added.push(index);
    else if (index === undefined && entry.base.has(STRUCTURE)) removed.push(entry.base);
  }
  const unmatched = new Map<string, number>();
  for (const values of removed) { const s = signature(values); unmatched.set(s, (unmatched.get(s) ?? 0) + 1); }
  const renamed = new Set<number>();
  for (const index of added.sort((a, b) => a - b)) {
    const s = signature(byPath.get(current.layers[index].hash)!.cur);
    const left = unmatched.get(s) ?? 0;
    if (left) { unmatched.set(s, left - 1); renamed.add(index); }
  }
  const addedOnly = added.filter(i => !renamed.has(i));
  // 상위 레이어도 함께 추가·이동된 레이어는 상위만 보여 준다.
  const topOnly = (list: Iterable<number>) => {
    const set = new Set(list);
    return [...set].filter(i => !set.has(current.layers[i].parent)).sort((a, b) => a - b).map(layerRef);
  };

  const groups: GroupChange[] = [];
  for (const group of DIGEST_GROUPS) {
    const kind = kindOf(group);
    const ck = hasCompanion(group) ? companionKind(group) : -1;
    const found: { index: number; sameOnScreen?: boolean }[] = [];
    for (const [path, entry] of byPath) {
      const index = current.layerOf.get(path);
      if (index === undefined || added.includes(index) || !(entry.cur.has(kind) || entry.base.has(kind))) continue;
      const changedOnScreen = ck >= 0 && (entry.cur.has(ck) || entry.base.has(ck));
      found.push({ index, ...(complete && ck >= 0 ? { sameOnScreen: !changedOnScreen } : {}) });
    }
    // 추가·삭제·이름 변경만으로 생긴 묶음 차이는 그 목록에서 보여 준다. 다 풀지 못했으면 요약값으로 판정한다.
    if (complete ? !found.length : !differs(kind)) continue;
    found.sort((a, b) => a.index - b.index);
    const sameOnScreen = ck < 0 ? null : complete ? found.every(l => l.sameOnScreen) : !differs(ck);
    groups.push({ group, sameOnScreen, layers: found.map(({ index, ...rest }) => ({ layer: layerRef(index), ...rest })) });
  }

  const removedCount = removed.length - renamed.size;
  if (complete && !groups.length && !added.length && !removed.length) return { ...NO_RECORD, status: 'unknown' };
  const visible = complete
    ? addedOnly.length > 0 || removedCount > 0 || groups.some(g => g.sameOnScreen !== true)
    : DIGEST_GROUPS.some(g => differs(kindOf(g)) && (!hasCompanion(g) || differs(companionKind(g))));
  return { status: complete ? 'complete' : 'partial', visible, groups, added: topOnly(addedOnly), renamed: topOnly(renamed), removed: removedCount };
}
