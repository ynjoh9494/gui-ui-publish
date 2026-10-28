import type { NodeSnapshot } from '../core/fingerprint.ts';

// 결과 화면에 영향을 주는 속성. 노드 유형에 없는 속성은 undefined로 건너뛴다.
// 오토 레이아웃 설정은 하위 노드의 x·y·크기에 결과가 반영되므로 따로 넣지 않는다.
// 속성을 더하면 core/changeDigest.ts의 묶음 표에도 넣는다.
export const VISUAL = [
  'visible', 'opacity', 'blendMode', 'isMask', 'maskType', 'x', 'y', 'width', 'height', 'rotation',
  'fills', 'strokes', 'strokeWeight', 'strokeTopWeight', 'strokeBottomWeight', 'strokeLeftWeight', 'strokeRightWeight',
  'strokeAlign', 'strokeCap', 'strokeJoin', 'strokeMiterLimit', 'dashPattern', 'effects',
  'cornerRadius', 'topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius', 'cornerSmoothing',
  'clipsContent', 'arcData', 'pointCount', 'innerRadius', 'booleanOperation', 'vectorPaths', 'handleMirroring',
] as const;

export const TEXT = [
  'characters', 'textAlignHorizontal', 'textAlignVertical', 'textAutoResize', 'textTruncation', 'maxLines',
  'paragraphSpacing', 'paragraphIndent', 'listSpacing', 'leadingTrim', 'hangingPunctuation', 'hangingList',
] as const;

export const TEXT_SEGMENT = [
  'fontName', 'fontSize', 'fontWeight', 'fills', 'letterSpacing', 'lineHeight', 'textDecoration', 'textCase',
  'listOptions', 'indentation', 'openTypeFeatures',
] as const;

function plain(value: unknown): unknown {
  if (value === figma.mixed) return 'mixed';
  if (value === undefined || typeof value === 'function') return undefined;
  // Paint·Effect 등은 순수 객체라 JSON 왕복으로 복사할 수 있다.
  return JSON.parse(JSON.stringify(value));
}

function read(node: SceneNode, key: string): unknown {
  try { return plain((node as unknown as Record<string, unknown>)[key]); } catch { return undefined; }
}

export class Snapshotter {
  private variables = new Map<string, Promise<Variable | null>>();

  private async variable(id: string): Promise<Variable | null> {
    if (!this.variables.has(id)) {
      const pending = figma.variables.getVariableByIdAsync(id);
      this.variables.set(id, pending);
      void pending.catch(() => { if (this.variables.get(id) === pending) this.variables.delete(id); });
    }
    return this.variables.get(id)!;
  }

  // 변수 값이 바뀌어도 노드 속성의 별칭은 그대로이므로 해석한 값을 지문에 넣는다.
  private async resolvedVariables(node: SceneNode): Promise<Record<string, unknown> | undefined> {
    const bound = (node as SceneNode & { boundVariables?: Record<string, unknown> }).boundVariables;
    if (!bound) return undefined;
    const ids = new Set<string>();
    const collect = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(collect);
      else if (v && typeof v === 'object') {
        const alias = v as { type?: string; id?: string };
        if (alias.type === 'VARIABLE_ALIAS' && alias.id) ids.add(alias.id);
        else Object.values(v).forEach(collect);
      }
    };
    collect(bound);
    // 채우기 안의 변수도 함께 찾는다.
    collect(read(node, 'fills'));
    collect(read(node, 'strokes'));
    if (!ids.size) return undefined;
    const out: Record<string, unknown> = {};
    for (const id of [...ids].sort()) {
      const variable = await this.variable(id);
      try { out[id] = variable ? plain(variable.resolveForConsumer(node).value) : 'missing'; } catch { out[id] = 'unresolved'; }
    }
    return out;
  }

  async snapshot(node: SceneNode): Promise<NodeSnapshot> {
    // 보이지 않는 노드는 시각 속성과 하위 내용을 읽지 않는다.
    if (!node.visible) return { type: node.type, props: { visible: false } };
    const props: Record<string, unknown> = {};
    for (const key of VISUAL) props[key] = read(node, key);
    if (node.type === 'TEXT') {
      for (const key of TEXT) props[key] = read(node, key);
      try { props.segments = plain(node.getStyledTextSegments([...TEXT_SEGMENT])); } catch { props.segments = 'unreadable'; }
    }
    props.variables = await this.resolvedVariables(node);
    const children = 'children' in node ? await Promise.all(node.children.map(child => this.snapshot(child))) : undefined;
    return { type: node.type, props, children };
  }
}

// 변경 근거를 만들 때만 레이어 이름·ID를 붙인다. 지문 계산 경로에서는 읽지 않아 평소 비교 비용이 늘지 않는다.
// 스냅샷의 하위 목록은 노드의 하위 목록과 같은 순서다(숨긴 노드는 하위를 읽지 않았다).
export function attachNames(node: SceneNode, snapshot: NodeSnapshot): NodeSnapshot {
  snapshot.name = node.name;
  snapshot.id = node.id;
  if (snapshot.children && 'children' in node) snapshot.children.forEach((child, i) => { if (node.children[i]) attachNames(node.children[i], child); });
  return snapshot;
}
