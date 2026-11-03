import { COPY } from '../core/copy.ts';
import { linksOf } from './template.ts';

// One lookup per canvas operation: template and component nodes are awaited once by ID,
// however many copies the operation replaces.
export interface MarkerLookup { nodes: Map<string, Promise<BaseNode | null>> }
export const markerLookup = (): MarkerLookup => ({ nodes: new Map() });

function nodeById(lookup: MarkerLookup, id: string): Promise<BaseNode | null> {
  let node = lookup.nodes.get(id);
  if (!node) { node = figma.getNodeByIdAsync(id); lookup.nodes.set(id, node); }
  return node;
}

// Resolve the live template first so adding a connection also protects existing flipbooks.
async function markerComponent(ns: string, node: BaseNode, lookup: MarkerLookup): Promise<ComponentNode | null> {
  for (let p: BaseNode | null = node; p; p = p.parent) {
    const templateId = p.getSharedPluginData(ns, 'flipbookTemplate');
    const template = templateId ? await nodeById(lookup, templateId) : null;
    const id = template ? linksOf(template, ns)?.components.marker : linksOf(p, ns)?.components.marker;
    if (template && !id) return null;
    if (!id) continue;
    const component = await nodeById(lookup, id);
    if (component?.type === 'COMPONENT') return component;
  }
  return null;
}

function relativeTo(parent: Transform, child: Transform): Transform {
  const [[a, c, x], [b, d, y]] = parent;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-10) throw new Error(COPY.markerTransformFailed);
  const [[e, g, u], [f, h, v]] = child;
  return [[(d * e - c * f) / det, (d * g - c * h) / det, (d * (u - x) - c * (v - y)) / det],
    [(a * f - b * e) / det, (a * h - b * g) / det, (a * (v - y) - b * (u - x)) / det]];
}

// Instances that are not markers are not entered: their layers belong to the component,
// a user cannot place a marker there, and Figma cannot move a layer out of an instance.
function instancesIn(parent: ChildrenMixin, out: InstanceNode[] = []): InstanceNode[] {
  for (const node of parent.children) {
    if (node.type === 'INSTANCE') out.push(node);
    else if ('children' in node) instancesIn(node, out);
  }
  return out;
}

// Only connected marker instances are lifted; ordinary GUI content stays inside the copy.
// Keep the instance itself (number, overrides and size) and its canvas transform.
export async function liftMarkers(ns: string, old: SceneNode, destination: FrameNode, lookup = markerLookup()): Promise<void> {
  if (!('children' in old)) return;
  const component = await markerComponent(ns, destination, lookup);
  if (!component) return;
  const candidates = instancesIn(old);
  if (!candidates.length) return;
  const set = component.parent?.type === 'COMPONENT_SET' ? component.parent.id : null;
  const mains = await Promise.all(candidates.map(node => node.getMainComponentAsync()));
  const found = candidates.filter((_, i) => { const main = mains[i]; return !!main && (main.id === component.id || (!!set && main.parent?.id === set)); })
    .map(node => ({ node, transform: relativeTo(destination.absoluteTransform, node.absoluteTransform) }));
  for (const { node, transform } of found) {
    destination.appendChild(node);
    if (destination.layoutMode !== 'NONE') node.layoutPositioning = 'ABSOLUTE';
    node.relativeTransform = transform;
  }
}
