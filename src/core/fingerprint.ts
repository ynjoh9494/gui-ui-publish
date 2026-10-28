import { sha256 } from './hash.ts';

// Figma 노드에서 결과 화면에 영향을 주는 속성만 옮긴 직렬화 가능한 트리. 수집은 figma/snapshot.ts가 맡는다.
// name·id·autoName은 변경 근거(core/changeDigest.ts)를 만들 때만 붙인다. props 밖이라 지문에 들어가지 않는다.
export interface NodeSnapshot {
  type: string;
  props: Record<string, unknown>;
  children?: NodeSnapshot[];
  name?: string;
  id?: string;
  // 이름이 글자를 따라 바뀌는 텍스트 레이어(Figma autoRename)
  autoName?: boolean;
}

// 정규화 규칙(무시 속성·숫자 처리, figma/snapshot.ts의 수집 속성)을 바꾸면 올린다. 다른 버전의 지문끼리는 비교하지 않는다.
// 2: 위치·크기·회전을 0.01 단위로 맞춘다. 프레임을 복사·붙여 넣으면 x 130.0004 → 130.0011처럼 바뀌어(2026-10-21 확인)
// 같은 화면도 변경 감지로 나왔다. 1 규칙의 기준은 legacyFingerprint로 비교하고, 같으면 2 규칙으로 옮긴다.
export const FINGERPRINT_VERSION = 2;
export const LEGACY_FINGERPRINT_VERSION = 1;

// 화면 결과에 영향이 없는 속성. 루트의 캔버스 위치는 위치 이동을 GUI 변경으로 보지 않기 위해 뺀다.
const IGNORED_EVERYWHERE = new Set(['name', 'locked', 'id']);
const IGNORED_AT_ROOT = new Set(['x', 'y']);
// 복사할 때 소수점 아래가 흔들리는 배치 속성. 색·불투명도 등은 0~1 범위라 더 세밀하게 둔다.
const GEOMETRY = new Set(['x', 'y', 'width', 'height', 'rotation']);

// 부동소수점 연산 잡음만 흡수한다. 0.0001px 미만의 차이는 렌더 결과에 나타나지 않는다.
function normalizeNumber(n: number, scale = 10000): number {
  if (!Number.isFinite(n)) return n;
  const rounded = Math.round(n * scale) / scale;
  return Object.is(rounded, -0) ? 0 : rounded;
}

// geometry: 배치 속성을 0.01 단위로 맞춘다(2 규칙).
export function canonical(value: unknown, geometry = false, key = ''): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return JSON.stringify(normalizeNumber(value, geometry && GEOMETRY.has(key) ? 100 : 10000));
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(v => canonical(v, geometry)).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.keys(value as object).sort()
      .filter(k => (value as Record<string, unknown>)[k] !== undefined)
      .map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k], geometry, k)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(String(value));
}

// 지문에 넣는 속성. 변경 근거도 같은 속성을 나눠 쓰므로 지문이 다르면 근거의 어느 묶음도 다르다.
export function comparedProps(node: NodeSnapshot, root: boolean): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node.props)) {
    if (IGNORED_EVERYWHERE.has(k) || (root && IGNORED_AT_ROOT.has(k))) continue;
    props[k] = v;
  }
  return props;
}

function strip(node: NodeSnapshot, root: boolean): unknown {
  return { t: node.type, p: comparedProps(node, root), c: (node.children ?? []).map(child => strip(child, false)) };
}

export function fingerprint(root: NodeSnapshot): string {
  return sha256(canonical(strip(root, true), true));
}

// 1 규칙 지문. 1 규칙으로 저장한 비교 기준과 플립북 UI 작성 영역 지문에 쓴다.
export function legacyFingerprint(root: NodeSnapshot): string {
  return sha256(canonical(strip(root, true)));
}
