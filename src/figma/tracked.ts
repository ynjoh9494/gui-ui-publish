import { EXISTING_KEY } from '../core/registerFlipbooks.ts';
import { COPY } from '../core/copy.ts';
import { displayScale, freeGuiWidth } from '../core/flipbook.ts';
import type { FoundCopy, NodePlace } from '../core/tracks.ts';
import type { CopyUpdate, PasteItem, PasteSpot } from '../host.ts';
import { COPY_SCALE_KEY, FLIPBOOK_KEY, loadPages, NODE_KEY } from './flipbook.ts';
import { COPY_KEY, copyLayers, rescaleExact, SCREEN_KEY } from './layers.ts';
import { linksOf } from './template.ts';

// 추적 GUI(core/tracks.ts)의 캔버스 쪽: 페이지에서 GUI 복사본을 찾고, 새 버전으로 바꾸고, 추적 기록 ID를 적는다.

// 복사본 노드에 적는 추적 기록 ID. 캔버스에서 복제한 복사본도 같은 값을 가진다.
export const TRACK_KEY = 'trackOf';
const PASTE_LAYOUT_KEY = 'pasteLayout';
const PASTE_SCREEN_KEY = 'pasteScreen';
const PASTE_GUI_KEY = 'pasteGui';
const LABELED_LAYOUT = 'labeled-v2';
const PREVIOUS_LAYOUT = 'mobile-v1';
const TRACKED_PREFIX = '🔗 ';

function trackedName(name: string): string {
  return name.startsWith(TRACKED_PREFIX) ? name : `${TRACKED_PREFIX}${name}`;
}

// GUI 자체는 다시 배포할 수 있게 두고, 붙인 화면의 제목과 숨긴 Screen ID는 별도 레이어로 둔다.
async function labeledCopy(ns: string, gui: FrameNode, holder: FrameNode, code: string, name: string, key: string): Promise<FrameNode> {
  await Promise.all([
    figma.loadFontAsync({ family: 'Inter', style: 'Bold' }),
    figma.loadFontAsync({ family: 'Inter', style: 'Medium' }),
  ]);
  const root = figma.createFrame();
  holder.appendChild(root);
  root.name = trackedName('GUI · 자동 업데이트');
  root.fills = [];
  root.clipsContent = false;
  root.resize(gui.width, gui.height + 41);
  root.layoutMode = 'VERTICAL';
  root.itemSpacing = 16;
  root.primaryAxisAlignItems = 'MAX';
  root.counterAxisAlignItems = 'MIN';

  const label = figma.createFrame();
  root.appendChild(label);
  label.name = 'Label';
  label.fills = [];
  label.clipsContent = false;
  label.resize(gui.width, 25);
  label.layoutMode = 'VERTICAL';
  label.itemSpacing = 4;
  label.primaryAxisAlignItems = 'CENTER';
  label.counterAxisAlignItems = 'MIN';
  label.primaryAxisSizingMode = 'AUTO';
  label.counterAxisSizingMode = 'FIXED';
  label.layoutSizingHorizontal = 'FILL';
  label.layoutSizingVertical = 'HUG';

  const id = figma.createFrame();
  label.appendChild(id);
  id.name = 'Screen ID';
  id.fills = [];
  id.clipsContent = false;
  id.resize(Math.max(81, code.length * 8 + 10), 22);
  id.layoutMode = 'HORIZONTAL';
  id.paddingLeft = 5;
  id.paddingRight = 5;
  id.primaryAxisAlignItems = 'CENTER';
  id.counterAxisAlignItems = 'CENTER';
  id.primaryAxisSizingMode = 'AUTO';
  id.counterAxisSizingMode = 'AUTO';
  id.layoutSizingHorizontal = 'HUG';
  id.layoutSizingVertical = 'HUG';
  const bg = figma.createRectangle();
  id.appendChild(bg);
  bg.name = 'bg';
  bg.resize(id.width, 22);
  bg.layoutPositioning = 'ABSOLUTE';
  bg.cornerRadius = 6;
  bg.fills = [{ type: 'SOLID', color: { r: 242 / 255, g: 242 / 255, b: 245 / 255 } }];
  const idText = figma.createText();
  id.appendChild(idText);
  idText.name = 'text';
  idText.fontName = { family: 'Inter', style: 'Medium' };
  idText.fontSize = 14;
  idText.lineHeight = { unit: 'PERCENT', value: 160 };
  idText.fills = [{ type: 'SOLID', color: { r: 115 / 255, g: 115 / 255, b: 122 / 255 } }];
  idText.characters = code;
  idText.textAutoResize = 'WIDTH_AND_HEIGHT';
  idText.layoutSizingHorizontal = 'HUG';
  idText.layoutSizingVertical = 'HUG';
  bg.resize(id.width, id.height);
  id.visible = false;

  const title = figma.createText();
  label.appendChild(title);
  title.name = 'Screen Title';
  title.fontName = { family: 'Inter', style: 'Bold' };
  title.fontSize = 18;
  title.lineHeight = { unit: 'PERCENT', value: 140 };
  title.fills = [{ type: 'SOLID', color: { r: 51 / 255, g: 51 / 255, b: 51 / 255 } }];
  title.characters = name;
  title.resize(gui.width, 25);
  title.textAutoResize = 'HEIGHT';
  title.layoutSizingHorizontal = 'FILL';
  title.layoutSizingVertical = 'HUG';

  const screen = figma.createFrame();
  root.appendChild(screen);
  screen.name = 'Screen';
  screen.setSharedPluginData(ns, PASTE_SCREEN_KEY, 'true');
  screen.fills = [];
  screen.clipsContent = true;
  screen.resize(gui.width, gui.height);
  screen.layoutMode = 'VERTICAL';
  screen.primaryAxisAlignItems = 'MIN';
  screen.counterAxisAlignItems = 'MIN';
  screen.appendChild(gui);
  gui.name = 'GUI';
  gui.setSharedPluginData(ns, PASTE_GUI_KEY, 'true');
  gui.layoutSizingHorizontal = 'FIXED';
  gui.layoutSizingVertical = 'FIXED';
  gui.setSharedPluginData(ns, COPY_KEY, '');
  screen.primaryAxisSizingMode = 'AUTO';
  screen.counterAxisSizingMode = 'AUTO';
  screen.layoutSizingHorizontal = 'HUG';
  screen.layoutSizingVertical = 'HUG';
  root.primaryAxisSizingMode = 'AUTO';
  root.counterAxisSizingMode = 'AUTO';
  root.layoutSizingHorizontal = 'HUG';
  root.layoutSizingVertical = 'HUG';
  root.setSharedPluginData(ns, COPY_KEY, key);
  root.setSharedPluginData(ns, PASTE_LAYOUT_KEY, LABELED_LAYOUT);
  return root;
}

// 복사본을 품은 플립북: 새 템플릿 플립북(원본 프레임)이면 그 ID, 이전 템플릿 플립북이 넣은 복사본이면 'legacy'(그 플립북이 GUI를 맞춘다),
// 밖이거나 캔버스에서 복제한 플립북 프레임 안이면 null. 이전 템플릿 플립북에 GUI 붙이기로 붙인 복사본(추적 기록 ID가 있음)은 밖으로 본다.
function owner(ns: string, node: BaseNode): string | null | 'legacy' {
  for (let n = node.parent; n && n.type !== 'PAGE'; n = n.parent) {
    const id = n.getSharedPluginData(ns, FLIPBOOK_KEY);
    if (!id) continue;
    if (!linksOf(n, ns) && n.getSharedPluginData(ns, EXISTING_KEY) !== 'true') return node.getSharedPluginData(ns, TRACK_KEY) ? null : 'legacy';
    return n.getSharedPluginData(ns, NODE_KEY) === n.id ? id : null;
  }
  return null;
}

// 점 아래에서 가장 위에 보이는(가장 안쪽) 프레임·Section. 그룹은 안만 살펴보고, 숨겼거나 잠근 노드와 인스턴스·컴포넌트는 고르지 않는다.
function frameAt(parent: ChildrenMixin, p: Vector): FrameNode | SectionNode | null {
  for (let i = parent.children.length - 1; i >= 0; i--) {
    const n = parent.children[i];
    if (!n.visible || n.locked || (n.type !== 'FRAME' && n.type !== 'SECTION' && n.type !== 'GROUP')) continue;
    const b = n.absoluteBoundingBox;
    if (!b || p.x < b.x || p.y < b.y || p.x > b.x + b.width || p.y > b.y + b.height) continue;
    const inner = frameAt(n, p);
    if (inner) return inner;
    if (n.type !== 'GROUP') return n;
  }
  return null;
}

// 붙일 부모(2026-10-29 사용자 결정): 플립북 프레임 안이면 그 플립북 프레임 바로 아래(플립북과 함께 움직인다), 아니면 놓인 프레임·Section, 없으면 페이지.
// GUI 원본·GUI 복사본·인스턴스·컴포넌트 안에는 넣지 않고 그 바깥의 프레임·Section에 넣는다.
function pasteParent(ns: string, hit: BaseNode | null, page: PageNode): FrameNode | SectionNode | PageNode {
  let blocked: BaseNode | null = null;
  for (let n = hit; n && n.type !== 'PAGE' && n.type !== 'DOCUMENT'; n = n.parent) {
    if (n.type === 'FRAME' && n.getSharedPluginData(ns, FLIPBOOK_KEY)) return n;
    if (n.type === 'INSTANCE' || n.type === 'COMPONENT' || n.type === 'COMPONENT_SET' || n.getSharedPluginData(ns, COPY_KEY) || n.getSharedPluginData(ns, SCREEN_KEY)) blocked = n;
  }
  for (let n = blocked ? blocked.parent : hit; n && n.type !== 'PAGE' && n.type !== 'DOCUMENT'; n = n.parent) if ((n.type === 'FRAME' || n.type === 'SECTION') && !n.locked) return n;
  return page;
}

// GUI 붙이기(2026-10-29 사용자 결정): 고른 크기(기본·작게)로 GUI 복사본을 만들어 놓인 자리(at, 없으면 보고 있는 화면 가운데)에 가운데를 맞춰 놓고 고른다.
// 오토 레이아웃 부모에는 놓은 자리를 지키도록 절대 위치로 놓는다. 크기는 붙일 때만 정하고, 그 뒤에는 사용자가 캔버스에서 바꾼다.
export async function pasteCopy(ns: string, item: PasteItem, at: PasteSpot | null): Promise<{ nodeId: string; pageId: string; flipbookId: string | null; notes: string[] }> {
  const source = await figma.getNodeByIdAsync(item.sourceNodeId);
  if (!source || !('visible' in source)) throw new Error(`${COPY.figmaFlipbook023} ${item.code}`);
  const page = figma.currentPage;
  const point = at ? { x: at.x, y: at.y } : figma.viewport.center;
  const parent = pasteParent(ns, at ? await figma.getNodeByIdAsync(at.nodeId) : frameAt(page, point), page);
  const notes = new Set<string>();
  const staging = figma.createFrame();
  try {
    const gui = await copyLayers(ns, source as SceneNode, staging, item.key, `${item.code} GUI`);
    const factor = freeGuiWidth(item.maxWidth, item.scale, gui.width) / gui.width;
    if (Math.abs(factor - 1) > 1e-6) for (const font of await rescaleExact(gui, factor)) notes.add(`${COPY.figmaFlipbook026} ${font}`);
    const copy = await labeledCopy(ns, gui, staging, item.code, item.name, item.key);
    copy.setSharedPluginData(ns, COPY_SCALE_KEY, String(displayScale(item.scale)));
    copy.setSharedPluginData(ns, TRACK_KEY, item.trackId);
    parent.appendChild(copy);
    if (parent.type === 'FRAME' && parent.layoutMode !== 'NONE') copy.layoutPositioning = 'ABSOLUTE';
    const origin = parent.type === 'PAGE' ? { x: 0, y: 0 } : { x: parent.absoluteTransform[0][2], y: parent.absoluteTransform[1][2] };
    copy.x = Math.round(point.x - origin.x - copy.width / 2);
    copy.y = Math.round(point.y - origin.y - (copy.height - gui.height / 2));
    page.selection = [copy];
    const flipbook = owner(ns, copy);
    return { nodeId: copy.id, pageId: page.id, flipbookId: flipbook === 'legacy' ? null : flipbook, notes: [...notes] };
  } finally {
    staging.remove();
  }
}

// 페이지들에서 GUI 복사본(복사본 표식이 있는 노드)을 찾는다. uids가 있으면 그 화면의 복사본만. 이전 템플릿 플립북 안의 복사본은 뺀다.
export async function scanCopies(ns: string, pageIds: string[], uids?: string[]): Promise<FoundCopy[]> {
  const wanted = uids ? new Set(uids) : null;
  const out: FoundCopy[] = [];
  for (const page of await loadPages(pageIds)) {
    for (const node of page.findAllWithCriteria({ sharedPluginData: { namespace: ns, keys: [COPY_KEY] } })) {
      const key = node.getSharedPluginData(ns, COPY_KEY);
      const at = key.lastIndexOf('@');
      const uid = key.slice(0, at), version = Number(key.slice(at + 1));
      if (at <= 0 || !Number.isFinite(version) || (wanted && !wanted.has(uid))) continue;
      const flipbook = owner(ns, node);
      if (flipbook === 'legacy') continue;
      out.push({ nodeId: node.id, pageId: page.id, uid, version, trackId: node.getSharedPluginData(ns, TRACK_KEY), flipbookId: flipbook });
    }
  }
  return out;
}

// 추적 목록: 노드가 놓인 자리(페이지, Section, 품은 플립북 프레임). 찾지 못했거나 copy인데 GUI 복사본 표식이 없어진 노드는 null.
// 캔버스에서 복제한 플립북 프레임 안이면 플립북 ID 없이 프레임 이름만 둔다(원본 플립북의 제목으로 보이지 않게).
export async function nodePlaces(ns: string, items: { nodeId: string; copy: boolean }[]): Promise<(NodePlace | null)[]> {
  return Promise.all(items.map(async ({ nodeId, copy }) => {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node || node.removed || node.type === 'PAGE' || node.type === 'DOCUMENT') return null;
    if (copy && !node.getSharedPluginData(ns, COPY_KEY)) return null;
    const sections: string[] = [];
    let flipbook: NodePlace['flipbook'] = null;
    for (let n = node.parent; n; n = n.parent) {
      if (n.type === 'PAGE') return { pageId: n.id, pageName: n.name, sections, flipbook };
      if (n.type === 'SECTION') sections.unshift(n.name);
      else if (!flipbook && n.type === 'FRAME' && n.getSharedPluginData(ns, FLIPBOOK_KEY))
        flipbook = { id: n.getSharedPluginData(ns, NODE_KEY) === n.id ? n.getSharedPluginData(ns, FLIPBOOK_KEY) : '', name: n.name };
    }
    return null;
  }));
}

// 캔버스에서 새로 생긴 노드(복제·붙여 넣기) 안의 추적 GUI(복사본 표식과 추적 기록 ID가 있는 노드). 플립북 프레임처럼 여러 복사본을 품은 노드를
// 복제해도 Figma는 가장 바깥 노드 하나만 알리므로 그 안도 찾는다. 이전 템플릿 플립북이 넣은 복사본은 뺀다.
export async function createdCopies(ns: string, nodeIds: string[]): Promise<FoundCopy[]> {
  const out: FoundCopy[] = [];
  const seen = new Set<string>();
  for (const id of nodeIds) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node || node.removed || node.type === 'PAGE' || node.type === 'DOCUMENT') continue;
    const inside = 'findAllWithCriteria' in node ? node.findAllWithCriteria({ sharedPluginData: { namespace: ns, keys: [TRACK_KEY] } }) : [];
    for (const copy of [node as SceneNode, ...inside]) {
      if (seen.has(copy.id)) continue;
      seen.add(copy.id);
      const key = copy.getSharedPluginData(ns, COPY_KEY), trackId = copy.getSharedPluginData(ns, TRACK_KEY);
      const at = key.lastIndexOf('@');
      const uid = key.slice(0, at), version = Number(key.slice(at + 1));
      if (!trackId || at <= 0 || !Number.isFinite(version)) continue;
      const flipbook = owner(ns, copy);
      let page: BaseNode | null = copy;
      while (page && page.type !== 'PAGE') page = page.parent;
      if (flipbook !== 'legacy' && page) out.push({ nodeId: copy.id, pageId: page.id, uid, version, trackId, flipbookId: flipbook });
    }
  }
  return out;
}

export async function markTracked(ns: string, items: { nodeId: string; trackId: string }[]): Promise<void> {
  for (const { nodeId, trackId } of items) {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (node && !node.removed && 'setSharedPluginData' in node) {
      const alreadyTracked = !!node.getSharedPluginData(ns, TRACK_KEY);
      node.setSharedPluginData(ns, TRACK_KEY, trackId);
      if ('name' in node && !alreadyTracked) node.name = trackedName(node.name);
    }
  }
}


// 추적 GUI를 새 버전으로 바꾼다(2026-10-29 사용자 결정). 자리·레이어 순서·이름·잠금과 지금 폭(사용자가 K로 바꾼 크기)을 지킨다.
// 원본은 화면마다 한 번만 복사하고, 폭이 같은 자리는 한 번 맞춘 복사본을 복제해 쓴다. 원본을 찾지 못한 화면은 이전 복사본을 둔다.
export async function updateCopies(ns: string, items: CopyUpdate[]): Promise<{ updated: { trackId: string; nodeId: string }[]; notes: string[] }> {
  const updated: { trackId: string; nodeId: string }[] = [];
  const notes = new Set<string>();
  for (const item of items) {
    const source = item.sourceNodeId ? await figma.getNodeByIdAsync(item.sourceNodeId) : null;
    if (!source || !('visible' in source)) { notes.add(`${COPY.figmaFlipbook023} ${item.code}`); continue; }
    const staging = figma.createFrame();
    try {
      const base = await copyLayers(ns, source as SceneNode, staging, item.key, `${item.code} GUI`);
      const byWidth = new Map<number, FrameNode>();
      for (const target of item.copies) {
        const old = await figma.getNodeByIdAsync(target.nodeId) as SceneNode | null;
        if (!old || old.removed || !old.parent) continue;
        const layout = old.getSharedPluginData(ns, PASTE_LAYOUT_KEY);
        const wrapped = layout === LABELED_LAYOUT || layout === PREVIOUS_LAYOUT;
        const screen = wrapped && old.type === 'FRAME' ? old.children.find(n => n.getSharedPluginData(ns, PASTE_SCREEN_KEY) === 'true') as FrameNode | undefined : undefined;
        const oldGui = screen?.children.find(n => n.getSharedPluginData(ns, PASTE_GUI_KEY) === 'true') as FrameNode | undefined;
        if (wrapped && (!screen || !oldGui)) continue;
        const width = Math.round((oldGui ?? old).width * 100) / 100;
        let prepared = byWidth.get(width);
        if (!prepared) {
          prepared = base.clone();
          // clone()은 보고 있는 페이지 바로 아래에 놓이므로 임시 프레임에 넣어 끝날 때 함께 지운다(넣지 않으면 페이지에 남아 다음 찾기에 복사본으로 잡힌다).
          staging.appendChild(prepared);
          const factor = (oldGui ?? old).width / prepared.width;
          if (Math.abs(factor - 1) > 1e-6) for (const font of await rescaleExact(prepared, factor)) notes.add(`${COPY.figmaFlipbook026} ${font}`);
          byWidth.set(width, prepared);
        }
        const copy = prepared.clone();
        if (wrapped && screen && oldGui) {
          screen.insertChild(screen.children.indexOf(oldGui), copy);
          copy.x = oldGui.x;
          copy.y = oldGui.y;
          copy.name = oldGui.name;
          copy.visible = oldGui.visible;
          copy.locked = oldGui.locked;
          copy.setSharedPluginData(ns, COPY_KEY, '');
          copy.setSharedPluginData(ns, PASTE_GUI_KEY, 'true');
          oldGui.remove();
          old.setSharedPluginData(ns, COPY_KEY, item.key);
          old.setSharedPluginData(ns, TRACK_KEY, target.trackId);
          updated.push({ trackId: target.trackId, nodeId: old.id });
          continue;
        }
        const parent = old.parent as BaseNode & ChildrenMixin;
        parent.insertChild(parent.children.indexOf(old), copy);
        // 오토 레이아웃 부모에서 떼어 낸 복제본은 부모가 바뀌어도 ABSOLUTE로 남아 있어, 지금 부모가 오토 레이아웃일 때만 옮긴다.
        if ('layoutPositioning' in old && old.layoutPositioning === 'ABSOLUTE' && 'layoutMode' in parent && parent.layoutMode !== 'NONE') (copy as FrameNode).layoutPositioning = 'ABSOLUTE';
        copy.x = old.x;
        copy.y = old.y;
        copy.name = old.name;
        copy.visible = old.visible;
        copy.locked = old.locked;
        copy.setSharedPluginData(ns, TRACK_KEY, target.trackId);
        const scale = old.getSharedPluginData(ns, COPY_SCALE_KEY);
        if (scale) copy.setSharedPluginData(ns, COPY_SCALE_KEY, scale);
        old.remove();
        updated.push({ trackId: target.trackId, nodeId: copy.id });
      }
    } finally {
      staging.remove();
    }
  }
  return { updated, notes: [...notes] };
}
