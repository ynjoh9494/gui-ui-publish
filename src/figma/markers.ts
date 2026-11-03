import { linksOf } from './template.ts';

// Resolve the live template first so adding a connection also protects existing flipbooks.
async function markerComponent(ns: string, node: BaseNode): Promise<ComponentNode | null> {
  for (let p: BaseNode | null = node; p; p = p.parent) {
    const templateId = p.getSharedPluginData(ns, 'flipbookTemplate');
    const template = templateId ? await figma.getNodeByIdAsync(templateId) : null;
    const id = template ? linksOf(template, ns)?.components.marker : linksOf(p, ns)?.components.marker;
    if (template && !id) return null;
    if (!id) continue;
    const component = await figma.getNodeByIdAsync(id);
    if (component?.type === 'COMPONENT') return component;
  }
  return null;
}

function relativeTo(parent: Transform, child: Transform): Transform {
  const [[a, c, x], [b, d, y]] = parent;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-10) throw new Error('Marker transform is not invertible');
  const [[e, g, u], [f, h, v]] = child;
  return [[(d * e - c * f) / det, (d * g - c * h) / det, (d * (u - x) - c * (v - y)) / det],
    [(a * f - b * e) / det, (a * h - b * g) / det, (a * (v - y) - b * (u - x)) / det]];
}

// Only connected marker instances are lifted; ordinary GUI content stays inside the copy.
// Keep the instance itself (number, overrides and size) and its canvas transform.
export async function liftMarkers(ns: string, old: SceneNode, destination: FrameNode): Promise<void> {
  if (!('children' in old)) return;
  const component = await markerComponent(ns, destination);
  if (!component) return;
  const found: { node: InstanceNode; transform: Transform }[] = [];
  async function visit(parent: SceneNode & ChildrenMixin): Promise<void> {
    for (const node of parent.children) {
      if (node.type === 'INSTANCE') {
        const main = await node.getMainComponentAsync();
        if (main && (main.id === component!.id || (component!.parent?.type === 'COMPONENT_SET' && main.parent?.id === component!.parent.id))) {
          found.push({ node, transform: relativeTo(destination.absoluteTransform, node.absoluteTransform) });
          continue;
        }
      }
      if ('children' in node) await visit(node);
    }
  }
  await visit(old);
  for (const { node, transform } of found) {
    destination.appendChild(node);
    if (destination.layoutMode !== 'NONE') node.layoutPositioning = 'ABSOLUTE';
    node.relativeTransform = transform;
  }
}
