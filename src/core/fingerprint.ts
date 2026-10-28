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
// 결과는 저장된 지문과 비교되므로 한 글자도 바뀌면 안 된다(test/fingerprint.test.ts가 JSON.stringify로 만들던 이전 구현과 비교한다).
// 지문과 변경 근거가 레이어·속성마다 부르므로 중간 배열과 콜백을 만들지 않는다.
export function canonical(value: unknown, geometry = false, key = ''): string {
  if (value === null || value === undefined) return 'null';
  switch (typeof value) {
    case 'number': {
      // JSON.stringify와 같다: 유한하지 않은 수는 null
      const n = normalizeNumber(value, geometry && GEOMETRY.has(key) ? 100 : 10000);
      return Number.isFinite(n) ? String(n) : 'null';
    }
    case 'string': return JSON.stringify(value);
    case 'boolean': return value ? 'true' : 'false';
    case 'object': {
      // 배열 원소에는 키를 넘기지 않는다(0.01 단위로 맞추지 않는다). 빈 칸은 빈 문자열이다.
      if (Array.isArray(value)) {
        let out = '[';
        for (let i = 0; i < value.length; i++) {
          if (i) out += ',';
          const v: unknown = value[i];
          if (v !== undefined || i in value) out += canonical(v, geometry);
        }
        return `${out}]`;
      }
      const record = value as Record<string, unknown>;
      let out = '{';
      let first = true;
      for (const k of Object.keys(record).sort()) {
        const v = record[k];
        if (v === undefined) continue;
        out += `${first ? '' : ','}${JSON.stringify(k)}:${canonical(v, geometry, k)}`;
        first = false;
      }
      return `${out}}`;
    }
    default: return JSON.stringify(String(value));
  }
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
