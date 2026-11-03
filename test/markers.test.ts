import assert from 'node:assert/strict';
import { test } from 'node:test';
import { liftMarkers, markerLookup } from '../src/figma/markers.ts';

test('최신 템플릿 연결로 중첩 마커와 다른 변형을 꺼내고 인스턴스·변환·레이어 순서를 보존한다', async () => {
  const nodes = new Map<string, any>();
  function node(id: string, type = 'FRAME', parent: any = null) {
    const n: any = {
      id, type, parent: null, children: [], data: {}, layoutMode: 'NONE',
      absoluteTransform: [[1, 0, 0], [0, 1, 0]],
      getSharedPluginData(_ns: string, key: string) { return this.data[key] ?? ''; },
      appendChild(child: any) {
        if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
        child.parent = this; this.children.push(child);
      },
    };
    nodes.set(id, n); parent?.appendChild(n); return n;
  }
  const set = node('set', 'COMPONENT_SET');
  const component = node('component', 'COMPONENT', set);
  const variant = node('variant', 'COMPONENT', set);
  const unrelated = node('button', 'COMPONENT');
  const template = node('template');
  template.data.templateLinks = JSON.stringify({ components: { marker: component.id } });
  const frame = node('flipbook'); frame.data.flipbookTemplate = template.id;
  // The flipbook was created before marker was connected.
  frame.data.templateLinks = '{"components":{}}';
  frame.absoluteTransform = [[2, 0, 100], [0, 2, 50]]; frame.layoutMode = 'VERTICAL';
  const old = node('old', 'FRAME', frame);
  const nested = node('nested', 'FRAME', old);
  const marker = node('marker', 'INSTANCE', nested);
  marker.getMainComponentAsync = async () => variant;
  marker.absoluteTransform = [[0, -1, 160], [1, 0, 90]];
  marker.number = '7'; marker.locked = true;
  const button = node('buttonInstance', 'INSTANCE', nested);
  button.getMainComponentAsync = async () => unrelated;
  Object.assign(globalThis, { figma: { getNodeByIdAsync: async (id: string) => nodes.get(id) } });
  await liftMarkers('ns', old, frame);
  assert.equal(marker.parent, frame);
  assert.equal(frame.children.at(-1), marker);
  assert.deepEqual(marker.relativeTransform, [[0, -0.5, 30], [0.5, 0, 20]]);
  assert.equal(marker.layoutPositioning, 'ABSOLUTE');
  assert.equal(marker.type, 'INSTANCE'); assert.equal(marker.number, '7'); assert.equal(marker.locked, true);
  assert.equal(button.parent, nested);
  await liftMarkers('ns', old, frame);
  assert.equal(frame.children.filter((n: any) => n === marker).length, 1);
  // Disconnecting the live template leaves ordinary content untouched.
  template.data.templateLinks = '{"components":{}}';
  nested.appendChild(marker);
  await liftMarkers('ns', old, frame);
  assert.equal(marker.parent, nested);
});

test('인스턴스 안으로는 들어가지 않고, 한 작업의 여러 복사본은 템플릿·컴포넌트를 한 번만 읽는다', async () => {
  const nodes = new Map<string, any>();
  function node(id: string, type = 'FRAME', parent: any = null) {
    const n: any = {
      id, type, parent: null, children: [], data: {}, layoutMode: 'NONE',
      absoluteTransform: [[1, 0, 0], [0, 1, 0]],
      getSharedPluginData(_ns: string, key: string) { return this.data[key] ?? ''; },
      appendChild(child: any) {
        if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
        child.parent = this; this.children.push(child);
      },
    };
    nodes.set(id, n); parent?.appendChild(n); return n;
  }
  const component = node('component', 'COMPONENT');
  const card = node('card', 'COMPONENT');
  const template = node('template');
  template.data.templateLinks = JSON.stringify({ components: { marker: component.id } });
  const frame = node('flipbook'); frame.data.flipbookTemplate = template.id;
  const copies = [node('a', 'FRAME', frame), node('b', 'FRAME', frame)];
  const inner: any[] = [];
  const markers = copies.map((copy, i) => {
    const instance = node(`card${i}`, 'INSTANCE', copy);
    instance.getMainComponentAsync = async () => card;
    // A marker-like layer that belongs to the card component must stay inside the instance.
    const nested = node(`inner${i}`, 'INSTANCE', instance);
    nested.getMainComponentAsync = async () => { inner.push(nested.id); return component; };
    const marker = node(`marker${i}`, 'INSTANCE', copy);
    marker.getMainComponentAsync = async () => component;
    return { marker, nested, instance };
  });
  const reads: string[] = [];
  Object.assign(globalThis, { figma: { getNodeByIdAsync: async (id: string) => { reads.push(id); return nodes.get(id); } } });
  const lookup = markerLookup();
  for (const copy of copies) await liftMarkers('ns', copy, frame, lookup);
  for (const { marker, nested, instance } of markers) {
    assert.equal(marker.parent, frame);
    assert.equal(nested.parent, instance);
  }
  assert.deepEqual(inner, []);
  assert.deepEqual(reads.sort(), ['component', 'template']);
});
