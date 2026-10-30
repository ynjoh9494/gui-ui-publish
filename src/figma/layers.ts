import { COPY } from '../core/copy.ts';

// GUI 원본의 레이어 복사본. 원본을 복제하고 컴포넌트 연결을 모두 끊는다. 스타일·변수 연결은 유지한다(2026-10-19 사용자 결정).
// 복사본은 따로 보관하지 않고 플립북을 만들거나 GUI를 반영할 때 원본에서 바로 플립북 GUI 영역에 넣는다(2026-10-20 사용자 결정).

// 복사본 표식. 값은 `${screenId}@${version}`
export const COPY_KEY = 'guiCopy';
// GUI 원본 표식(GUI Publish가 원본 프레임에 적는 화면 ID)
export const SCREEN_KEY = 'screenId';

// 컴포넌트 연결을 끊는 반복 횟수 한도. 한 번에 가장 바깥 인스턴스만 끊으므로 중첩 깊이만큼 돈다.
const MAX_DEPTH = 100;

function insideInstance(node: BaseNode, root: BaseNode): boolean {
  for (let p = node.parent; p && p !== root; p = p.parent) if (p.type === 'INSTANCE') return true;
  return false;
}

// 바깥 인스턴스부터 끊는다. 끊으면 안쪽 노드 ID가 바뀌므로 매번 다시 찾는다.
function detachAll(root: FrameNode): void {
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const outer = root.findAllWithCriteria({ types: ['INSTANCE'] }).filter(n => !insideInstance(n, root));
    if (!outer.length) return;
    for (const instance of outer) instance.detachInstance();
  }
  throw new Error(COPY.figmaLayers002);
}

// 원본에서 복사된 이 플러그인의 표식(화면 ID 등)을 지운다. 복사본이 원본이나 플립북으로 오인되지 않게 한다.
function clearMarkers(ns: string, root: FrameNode): void {
  for (const node of [root, ...root.findAllWithCriteria({ sharedPluginData: { namespace: ns } })])
    for (const key of node.getSharedPluginDataKeys(ns)) node.setSharedPluginData(ns, key, '');
}

// 원본이 페이지·Section에서 물려받던 변수 모드를 복사본에 직접 지정한다. 플립북으로 옮겨도 같은 모드로 보인다.
export async function keepModes(source: SceneNode, copy: FrameNode | InstanceNode): Promise<void> {
  for (const [collectionId, modeId] of Object.entries(source.resolvedVariableModes ?? {})) {
    if (copy.explicitVariableModes[collectionId] === modeId) continue;
    const collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
    if (collection) copy.setExplicitVariableModeForCollection(collection, modeId);
  }
}

// 글꼴을 불러오지 않으면 rescale해도 글자가 줄지 않는다. 불러오지 못한 글꼴 이름을 돌려준다.
async function loadFonts(root: FrameNode): Promise<string[]> {
  const fonts = new Map<string, FontName>();
  for (const text of root.findAllWithCriteria({ types: ['TEXT'] })) {
    const names = text.characters.length ? text.getRangeAllFontNames(0, text.characters.length) : [text.fontName as FontName];
    for (const f of names) fonts.set(`${f.family} ${f.style}`, f);
  }
  const missing: string[] = [];
  await Promise.all([...fonts].map(([label, f]) => figma.loadFontAsync(f).catch(() => { missing.push(label); })));
  return missing.sort();
}

const fixedSize = (n: SceneNode) => n.type !== 'TEXT' && n.type !== 'GROUP' && n.type !== 'BOOLEAN_OPERATION' && 'resizeWithoutConstraints' in n;

// rescale은 고정 크기 오토레이아웃 프레임(안쪽 여백과 내용이 프레임보다 큰 경우 등)의 크기를 원본 비율과 다르게 다시 계산한다.
// 줄이기 전 크기를 기록해 두고, 줄인 뒤 고정 크기 노드만 기록×배율로 되돌린다. 바깥이 안쪽 크기를 따라가므로 안쪽부터 맞춘다.
export async function rescaleExact(root: FrameNode, scale: number): Promise<string[]> {
  const missing = await loadFonts(root);
  const nodes = [root, ...root.findAll(fixedSize)] as (SceneNode & LayoutMixin)[];
  const before = nodes.map(n => ({
    width: n.width * scale, height: n.height * scale,
    fixedWidth: n.layoutSizingHorizontal === 'FIXED', fixedHeight: n.layoutSizingVertical === 'FIXED',
  }));
  // STRETCH 제약이 있는 절대 위치 레이어는 부모 크기 보정 때 다시 늘거나 반올림될 수 있다.
  // 부모·고정 크기 보정이 모두 끝난 뒤 원래 배율의 크기와 위치를 복원한다.
  const absolute = root.findAll(n => 'layoutPositioning' in n && n.layoutPositioning === 'ABSOLUTE').map(n => ({
    node: n, x: n.x * scale, y: n.y * scale, width: n.width * scale, height: n.height * scale,
  }));
  root.rescale(scale);
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i], original = before[i];
    const width = original.fixedWidth && Math.abs(n.width - original.width) > 0.01 ? original.width : n.width;
    const height = original.fixedHeight && Math.abs(n.height - original.height) > 0.01 ? original.height : n.height;
    if ((width !== n.width || height !== n.height) && width >= 0.01 && height >= 0.01) n.resizeWithoutConstraints(width, height);
  }
  for (const { node, x, y, width, height } of absolute) {
    if ('layoutPositioning' in node) node.layoutPositioning = 'ABSOLUTE';
    if (width >= 0.01 && height >= 0.01 && 'resizeWithoutConstraints' in node &&
        (Math.abs(node.width - width) > 0.01 || Math.abs(node.height - height) > 0.01)) node.resizeWithoutConstraints(width, height);
    node.x = x;
    node.y = y;
  }
  return missing;
}

// 원본을 복제해 holder에 넣고 컴포넌트 연결을 끊는다. 실패하면 만든 노드를 지운다.
export async function copyLayers(ns: string, source: SceneNode, holder: FrameNode, key: string, name: string): Promise<FrameNode> {
  let current: SceneNode;
  if (source.type === 'COMPONENT') current = source.createInstance();
  else if (source.type === 'FRAME' || source.type === 'INSTANCE') current = source.clone();
  else throw new Error(COPY.figmaLayers003);
  try {
    holder.appendChild(current);
    // 복사본을 다른 페이지에 옮기면 상속 모드가 바뀐다. 인스턴스를 분리하기 전에 원본의 모드를 고정한다.
    if (current.type === 'FRAME' || current.type === 'INSTANCE') await keepModes(source, current);
    if (current.type === 'INSTANCE') current = current.detachInstance();
    const copy = current as FrameNode;
    detachAll(copy);
    clearMarkers(ns, copy);
    await keepModes(source, copy);
    copy.name = name;
    copy.x = 0;
    copy.y = 0;
    copy.setSharedPluginData(ns, COPY_KEY, key);
    return copy;
  } catch (error) {
    if (!current.removed) current.remove();
    throw error;
  }
}
