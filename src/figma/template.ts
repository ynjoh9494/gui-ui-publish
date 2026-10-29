import { COPY } from '../core/copy.ts';
import { PDF_HIDDEN_PARTS } from '../core/pdf.ts';
import {
  LINKS_KEY, PART_KEY, TEMPLATE_ITEMS, itemDef, linksValue, parseLinks,
  type ComponentPart, type ItemKind, type RowPart, type TemplateInfo, type TemplateItem, type TemplateItemState, type TemplateLinks,
} from '../core/templateParts.ts';

// 플립북 템플릿의 구조: 플러그인이 정보를 넣는 칸을 찾고, 템플릿 관리 화면의 연결 항목을 읽고 바꾼다.
// 표식 템플릿(연결 기록이 있는 템플릿)은 역할 표식으로, 이전 템플릿은 레이어 이름으로 찾는다(core/templateParts.ts).

// 플러그인 ID가 바뀌어도 데이터가 남도록 pluginData 대신 네임스페이스가 있는 sharedPluginData를 쓴다.
export const NS = 'guiuipublish';

// ── 이름 규칙 ─────────────────────────────────────────
// 템플릿(2026-10-20 사용자 결정)은 일반 프레임이다. 그 안의 UI Title·Flipbook-Title·Update History List는 컴포넌트이고,
// GUI Image Slot은 컴포넌트가 아닌 프레임이다.

const TITLE = 'UI Title';
const HEADER = 'Flipbook-Title';
export const GUI_AREA = 'GUI Image Slot';
export const DESCRIPTION_AREA = 'description area';
const HISTORY = 'Update History List';
const ID_CELL = 'input-cell-id';

// 이름으로 찾되 GUI 영역 안으로는 내려가지 않는다. GUI 영역에는 화면 레이어 복사본이 통째로 들어 있어
// 화면마다 전체를 훑으면 반영이 크게 느려진다.
export function findPart(root: ChildrenMixin, match: (n: SceneNode) => boolean): SceneNode | null {
  for (const child of root.children) {
    if (match(child)) return child;
    if ('children' in child && child.name !== GUI_AREA) {
      const found = findPart(child, match);
      if (found) return found;
    }
  }
  return null;
}

const named = (name: string, types?: string[]) => (n: SceneNode) => n.name === name && (!types || types.includes(n.type));
const COMPONENTISH = ['COMPONENT', 'INSTANCE'];

export interface NamedParts {
  title: ComponentNode | InstanceNode | null;
  titleText: TextNode | null;
  status: InstanceNode | null;
  header: ComponentNode | InstanceNode | null;
  chapter: TextNode | null;
  page: TextNode | null;
  ids: SceneNode | null;
  gui: FrameNode | null;
  description: SceneNode | null;
  history: ComponentNode | InstanceNode | null;
  list: SceneNode | null;
}

export const cellText = (header: ChildrenMixin | null, cell: string) =>
  (header ? findPart(header, n => n.type === 'TEXT' && n.parent?.name === cell) : null) as TextNode | null;

export function namedParts(root: ChildrenMixin): NamedParts {
  const title = findPart(root, named(TITLE, COMPONENTISH)) as ComponentNode | InstanceNode | null;
  const header = findPart(root, named(HEADER, COMPONENTISH)) as ComponentNode | InstanceNode | null;
  const history = findPart(root, named(HISTORY, COMPONENTISH)) as ComponentNode | InstanceNode | null;
  return {
    title,
    titleText: (title?.findChild(n => n.type === 'TEXT') ?? null) as TextNode | null,
    status: (title?.findOne(n => n.type === 'INSTANCE' && n.name === 'Status') ?? null) as InstanceNode | null,
    header,
    chapter: cellText(header, 'input-cell-chapter'),
    page: cellText(header, 'input-cell-page'),
    ids: header ? findPart(header, named(ID_CELL)) : null,
    gui: findPart(root, named(GUI_AREA, ['FRAME'])) as FrameNode | null,
    description: findPart(root, named(DESCRIPTION_AREA, ['SLOT'])),
    history,
    list: history ? findPart(history, named('List')) : null,
  };
}

// 반영에 필요한 시스템 영역이 있는지 확인한다. 인스턴스 안에 행·태그를 넣으려면 List·input-cell-id가 슬롯이어야 한다.
export function templateProblems(root: FrameNode): string[] {
  const p = namedParts(root);
  const out: string[] = [];
  if (!p.titleText) out.push(COPY.figmaFlipbook003);
  if (!p.status) out.push(COPY.figmaFlipbook004);
  if (!p.chapter || !p.page) out.push(COPY.figmaFlipbook024);
  if (!p.ids) out.push(ID_CELL);
  else if (p.ids.type !== 'SLOT') out.push(`${ID_CELL} ${COPY.figmaFlipbook025}`);
  if (!p.gui) out.push(COPY.figmaFlipbook005);
  if (!p.list) out.push(COPY.figmaFlipbook006);
  else if (p.list.type !== 'SLOT') out.push(`List ${COPY.figmaFlipbook025}`);
  return out;
}

// 이력 행: 이름이 Update History인 인스턴스. 템플릿의 시스템 행(isSystem 변형)은 그대로 둔다.
export const isNamedRow = (n: SceneNode): n is InstanceNode => n.type === 'INSTANCE' && n.name === 'Update History';
export const isSystemRow = (n: InstanceNode) => n.componentProperties.isSystem?.value === 'true';

// 이력 영역(없으면 템플릿)에 있는 첫 일반 이력 행의 컴포넌트
export async function namedRowComponent(history: ChildrenMixin | null, template: ChildrenMixin): Promise<ComponentNode | null> {
  const fromNode = async (root: ChildrenMixin) => {
    const row = findPart(root, n => isNamedRow(n) && !isSystemRow(n)) as InstanceNode | null;
    return row ? row.getMainComponentAsync() : null;
  };
  return (history ? await fromNode(history) : null) ?? await fromNode(template);
}

// 이력 행 안의 칸. 상태·팀은 태그 인스턴스(표식 템플릿은 텍스트도 된다)다.
export interface RowParts {
  status: InstanceNode | TextNode | null;
  comment: TextNode | null;
  worker: TextNode | null;
  date: TextNode | null;
  team: InstanceNode | TextNode | null;
}

export function namedRowParts(row: ChildrenMixin): RowParts {
  const textIn = (frameName: string) => row.findOne(n => n.type === 'TEXT' && n.parent?.name === frameName) as TextNode | null;
  return {
    status: row.findOne(n => n.type === 'INSTANCE' && n.name === 'Status') as InstanceNode | null,
    comment: textIn('Comment'),
    worker: textIn('Name'),
    date: textIn('Date'),
    team: row.findOne(n => n.type === 'INSTANCE' && n.name === 'Team') as InstanceNode | null,
  };
}

// 태그 표시 컴포넌트: 상단 Status는 TagBig, 이력 행은 TagSmall, Screen ID는 Team(Tag=System).
// 템플릿과 같은 페이지에서 이름으로 찾는다. 없는 컴포넌트가 있으면 그 이름을 넣은 안내를 함께 돌려준다.
function tagComponents(template: FrameNode) {
  const page = pageOf(template)!;
  const components = page.findAllWithCriteria({ types: ['COMPONENT'] });
  const big = components.find(c => c.name === 'TagBig');
  const small = components.find(c => c.name === 'TagSmall');
  const idTag = components.find(c => c.name === 'Tag=System' && c.parent?.type === 'COMPONENT_SET' && c.parent.name === 'Team');
  const missing = [!big && 'TagBig', !small && 'TagSmall', !idTag && 'Team / Tag=System'].filter(Boolean);
  return { big, small, idTag, problem: missing.length ? `${COPY.figmaFlipbook010}${missing.join('·')}${COPY.figmaFlipbook011}${page.name}${COPY.figmaFlipbook012}` : null };
}

// ── 표식 ─────────────────────────────────────────────

export function pageOf(node: BaseNode): PageNode | null {
  let current: BaseNode | null = node;
  while (current && current.type !== 'PAGE') current = current.parent;
  return current as PageNode | null;
}

// 표식 템플릿(과 그 템플릿에서 만든 플립북)의 연결 기록. 이름 규칙이면 null이다.
export function linksOf(node: BaseNode, ns = NS): TemplateLinks | null {
  return 'getSharedPluginData' in node ? parseLinks(node.getSharedPluginData(ns, LINKS_KEY)) : null;
}

const roleOf = (node: BaseNode, ns: string) => 'getSharedPluginData' in node ? node.getSharedPluginData(ns, PART_KEY) : '';
const isText = (n: SceneNode | null | undefined): n is TextNode => n?.type === 'TEXT';
const asText = (n: SceneNode | null | undefined) => (isText(n) ? n : null);
const asTag = (n: SceneNode | null | undefined) => (n && (n.type === 'INSTANCE' || n.type === 'TEXT') ? n : null);
const asFrame = (n: SceneNode | null | undefined) => (n?.type === 'FRAME' ? n : null);

// 안으로 내려가지 않는 칸: GUI 영역(화면 복사본), Description 본문(사용자 작성), Screen ID 칸(태그), 이력 행
const OPAQUE = new Set(['gui', 'description', 'ids', 'row']);

// 역할 → 표식이 붙은 레이어(놓인 순서). 템플릿과 플립북은 레이어가 적지만 GUI 영역·Description·이력 행은 크므로 건너뛴다.
// 새 템플릿 플립북의 GUI 복사본은 플립북 프레임 바로 아래에 있다(figma/layers.ts COPY_KEY 표식). 그 안으로는 내려가지 않는다.
const GUI_COPY_KEY = 'guiCopy';
export function markedParts(root: ChildrenMixin, ns = NS): Map<string, SceneNode[]> {
  const out = new Map<string, SceneNode[]>();
  const walk = (node: ChildrenMixin, top: boolean) => {
    for (const child of node.children) {
      if (top && child.getSharedPluginData(ns, GUI_COPY_KEY)) continue;
      const role = child.getSharedPluginData(ns, PART_KEY);
      if (role) {
        const list = out.get(role);
        if (list) list.push(child); else out.set(role, [child]);
      }
      if (OPAQUE.has(role) || child.name === GUI_AREA || !('children' in child)) continue;
      walk(child, false);
    }
  };
  walk(root, true);
  return out;
}

// 이력 행(컴포넌트나 인스턴스) 안의 칸 표식. 행은 작아서 끝까지 훑는다.
function markedRowNodes(row: ChildrenMixin, ns: string): Map<string, SceneNode[]> {
  const out = new Map<string, SceneNode[]>();
  const walk = (node: ChildrenMixin) => {
    for (const child of node.children) {
      const role = child.getSharedPluginData(ns, PART_KEY);
      if (role && itemDef(role)?.group === 'row') {
        const list = out.get(role);
        if (list) list.push(child); else out.set(role, [child]);
      }
      if ('children' in child) walk(child);
    }
  };
  walk(row);
  return out;
}

export function markedRowParts(row: ChildrenMixin, ns = NS): RowParts {
  const found = markedRowNodes(row, ns);
  const first = (key: RowPart) => found.get(key)?.[0] ?? null;
  return { status: asTag(first('rowStatus')), comment: asText(first('rowComment')), worker: asText(first('rowWorker')), date: asText(first('rowDate')), team: asTag(first('rowTeam')) };
}

// 플러그인이 관리하는 이력 행: 이력 행 컴포넌트의 인스턴스(컴포넌트의 'row' 표식을 이어받는다)
export const isMarkedRow = (n: SceneNode, ns = NS): n is InstanceNode => n.type === 'INSTANCE' && n.getSharedPluginData(ns, PART_KEY) === 'row';

// ── 플립북의 칸 ───────────────────────────────────────

export interface Parts {
  // 표식 템플릿에서 만든 플립북(또는 그 템플릿)이면 연결 기록, 이름 규칙이면 null
  links: TemplateLinks | null;
  titles: TextNode[];
  chapter: TextNode | null;
  status: InstanceNode | TextNode | null;
  ids: SceneNode | null;
  gui: FrameNode | null;
  description: SceneNode | null;
  list: SceneNode | null;
  previous: SceneNode | null;
  // 이름 규칙일 때만: 템플릿 기본 글자를 찾을 컴포넌트와 이력 행 컴포넌트를 찾을 이력 영역
  named: NamedParts | null;
}

export function flipbookParts(root: FrameNode, ns = NS): Parts {
  const links = linksOf(root, ns);
  if (!links) {
    const p = namedParts(root);
    const previous = p.list && 'findChild' in p.list ? (p.list as ChildrenMixin).findChild(n => n.type === 'FRAME' && n.name === 'Previous') : null;
    return { links, titles: [p.titleText, p.page].filter(isText), chapter: p.chapter, status: p.status, ids: p.ids, gui: p.gui, description: p.description, list: p.list, previous, named: p };
  }
  const marked = markedParts(root, ns);
  const first = (role: string) => marked.get(role)?.[0] ?? null;
  return {
    links,
    titles: (marked.get('title') ?? []).filter(isText),
    chapter: asText(first('chapter')),
    status: asTag(first('status')),
    ids: first('ids'),
    gui: asFrame(first('gui')),
    description: first('description'),
    list: first('history'),
    previous: first('previous'),
    named: null,
  };
}

// PDF로 저장하는 동안 숨길 레이어. 이름 규칙은 UI Title·Update History List다(core/pdf.ts).
export function pdfHiddenParts(frame: SceneNode & ChildrenMixin, ns = NS): SceneNode[] {
  if (linksOf(frame, ns)) return markedParts(frame, ns).get('pdfHidden') ?? [];
  return PDF_HIDDEN_PARTS.map(name => findPart(frame, node => node.name === name)).filter((node): node is SceneNode => !!node);
}

// ── 템플릿 ─────────────────────────────────────────────

export async function templateFrame(id: string): Promise<FrameNode> {
  const node = await figma.getNodeByIdAsync(id);
  if (!node || node.type !== 'FRAME') throw new Error(COPY.figmaFlipbook002);
  await pageOf(node)?.loadAsync();
  return node;
}

// 캔버스에서 고른 레이어를 품은 템플릿 프레임. 표식 템플릿이나 이름 규칙에 맞는 가장 가까운 프레임을 고르고,
// 없으면 가장 바깥 프레임을 템플릿으로 본다. 빠진 칸은 템플릿 관리 화면에서 연결한다(2026-10-28 사용자 결정).
export async function templateFromSelection(ns = NS): Promise<{ id: string; name: string }> {
  const node = figma.currentPage.selection[0];
  if (!node) throw new Error(COPY.figmaFlipbook007);
  let outer: FrameNode | null = null;
  for (let n: BaseNode | null = node; n && n.type !== 'PAGE'; n = n.parent) {
    if (n.type !== 'FRAME') continue;
    if (linksOf(n, ns) || (namedParts(n).history && !templateProblems(n).length)) return { id: n.id, name: n.name };
    outer = n;
  }
  if (!outer) throw new Error(COPY.figmaFlipbook008);
  return { id: outer.id, name: outer.name };
}

// 태그 표시 컴포넌트와 표식 템플릿의 이력 행·기본 글자. 반영 한 번에 한 번 읽는다.
export interface TagKit {
  template: FrameNode;
  links: TemplateLinks | null;
  // 상단 상태(big)·이력 상태(small)를 바꿀 태그 컴포넌트. 표식 템플릿은 연결했을 때만 있다.
  big: ComponentNode | null;
  small: ComponentNode | null;
  idTag: ComponentNode | null;
  // 표식 템플릿의 이력 행 컴포넌트. 이름 규칙은 반영할 때 이력 영역의 행에서 찾는다.
  row: ComponentNode | null;
  // 표식 템플릿의 제목·Chapter 칸에 적힌 글자. 플립북 글자가 이 글자이면 플러그인이 바꾼다.
  defaults: { title: string[]; chapter: string[] };
  fonts: Map<string, Promise<void>>;
}

async function linkedComponents(links: TemplateLinks): Promise<Record<ComponentPart, ComponentNode | null>> {
  const out: Record<ComponentPart, ComponentNode | null> = { idTag: null, row: null, statusTag: null, rowStatusTag: null };
  await Promise.all(Object.entries(links.components).map(async ([key, id]) => {
    const node = await figma.getNodeByIdAsync(id);
    out[key as ComponentPart] = node?.type === 'COMPONENT' && !node.removed ? node : null;
  }));
  return out;
}

export async function tagKit(templateId: string, ns = NS): Promise<TagKit> {
  const template = await templateFrame(templateId);
  const links = linksOf(template, ns);
  if (!links) {
    const { big, small, idTag, problem } = tagComponents(template);
    if (problem) throw new Error(problem);
    return { template, links, big: big!, small: small!, idTag: idTag!, row: null, defaults: { title: [], chapter: [] }, fonts: new Map() };
  }
  const c = await linkedComponents(links);
  const marked = markedParts(template, ns);
  const texts = (role: string) => (marked.get(role) ?? []).filter(isText).map(n => n.characters);
  return { template, links, big: c.statusTag, small: c.rowStatusTag, idTag: c.idTag, row: c.row, defaults: { title: texts('title'), chapter: texts('chapter') }, fonts: new Map() };
}

// ── 연결 항목 상태 ─────────────────────────────────────

function insideInstance(node: BaseNode): boolean {
  for (let n = node.parent; n && n.type !== 'PAGE'; n = n.parent) if (n.type === 'INSTANCE') return true;
  return false;
}

// 레이어를 넣을 수 있는 칸: 슬롯, 인스턴스 밖 프레임(인스턴스 안 프레임에는 레이어를 더할 수 없다)
const acceptsChildren = (n: SceneNode) => n.type === 'SLOT' || (n.type === 'FRAME' && !insideInstance(n));

function kindProblem(kind: ItemKind, node: SceneNode): string | null {
  switch (kind) {
    case 'text': return node.type === 'TEXT' ? null : COPY.figmaTemplate002;
    case 'tag': return node.type === 'INSTANCE' || node.type === 'TEXT' ? null : COPY.figmaTemplate003;
    case 'team': return node.type === 'INSTANCE' || node.type === 'TEXT' ? null : COPY.figmaTemplate006;
    case 'area': return acceptsChildren(node) ? null : COPY.figmaTemplate004;
    case 'frame': return node.type === 'FRAME' && !insideInstance(node) ? null : COPY.figmaTemplate005;
    case 'layers': case 'component': return null;
  }
}

// 목록에 보일 레이어 이름: 바로 위 레이어 › 레이어(템플릿 프레임 바로 아래면 이름만)
function layerName(node: BaseNode, root: BaseNode | null): string {
  const parent = node.parent;
  if (node.type === 'COMPONENT' && parent?.type === 'COMPONENT_SET') return `${parent.name} › ${node.name}`;
  return parent && parent !== root && parent.type !== 'PAGE' && parent.type !== 'SECTION' ? `${parent.name} › ${node.name}` : node.name;
}
const layers = (nodes: readonly (BaseNode | null | undefined)[], root: BaseNode | null) =>
  nodes.filter((n): n is BaseNode => !!n).map(n => ({ id: n.id, name: layerName(n, root) }));

const hasText = (component: ComponentNode) => !!component.findOne(n => n.type === 'TEXT');

async function linkedItems(template: FrameNode, links: TemplateLinks, ns: string): Promise<TemplateItemState[]> {
  const marked = markedParts(template, ns);
  const components = await linkedComponents(links);
  const rowMarked = components.row ? markedRowNodes(components.row, ns) : new Map<string, SceneNode[]>();
  const connected = (key: string) => !!marked.get(key)?.length;
  return TEMPLATE_ITEMS.map(def => {
    if (def.group === 'component') {
      const key = def.key as ComponentPart;
      const node = components[key];
      let problem: string | null = links.components[key] && !node ? COPY.figmaTemplate001 : null;
      if (!problem && node && key !== 'row' && !hasText(node)) problem = COPY.figmaTemplate011;
      if (!problem && !node && key === 'idTag' && connected('ids')) problem = COPY.figmaTemplate008;
      if (!problem && !node && key === 'row' && connected('history')) problem = COPY.figmaTemplate009;
      return { key: def.key, layers: layers([node], null), problem };
    }
    const nodes = (def.group === 'row' ? rowMarked : marked).get(def.key) ?? [];
    let problem = nodes.map(n => kindProblem(def.kind, n)).find(Boolean) ?? null;
    if (!problem && !nodes.length && def.required) problem = COPY.figmaTemplate007;
    if (!problem && def.key === 'previous' && nodes.length && !connected('history')) problem = COPY.figmaTemplate010;
    return { key: def.key, layers: layers(nodes, def.group === 'row' ? components.row : template), problem };
  });
}

async function namedItems(template: FrameNode): Promise<TemplateItemState[]> {
  const p = namedParts(template);
  const tags = tagComponents(template);
  const row = await namedRowComponent(p.history, template);
  const r = row ? namedRowParts(row) : null;
  const previous = p.list && 'findChild' in p.list ? (p.list as ChildrenMixin).findChild(n => n.type === 'FRAME' && n.name === 'Previous') : null;
  const found: Record<TemplateItem, (BaseNode | null | undefined)[]> = {
    title: [p.titleText, p.page], chapter: [p.chapter], status: [p.status], ids: [p.ids], gui: [p.gui], description: [p.description],
    history: [p.list], previous: [previous], pdfHidden: [p.title, p.history],
    idTag: [tags.idTag], row: [row], statusTag: [tags.big], rowStatusTag: [tags.small],
    rowStatus: [r?.status], rowComment: [r?.comment], rowWorker: [r?.worker], rowDate: [r?.date], rowTeam: [r?.team],
  };
  // 이름 규칙에서 반드시 있어야 하는 칸(templateProblems·tagComponents와 같다)
  const required = new Set<TemplateItem>(['title', 'chapter', 'status', 'ids', 'gui', 'history', 'idTag', 'statusTag', 'rowStatusTag']);
  return TEMPLATE_ITEMS.map(def => {
    const nodes = found[def.key];
    const missing = def.key === 'title' ? !p.titleText || !p.page : !nodes.some(Boolean);
    let problem: string | null = missing && required.has(def.key) ? COPY.figmaTemplate012 : null;
    if (!problem && (def.key === 'ids' || def.key === 'history') && nodes[0] && nodes[0].type !== 'SLOT') problem = COPY.figmaTemplate004;
    return { key: def.key, layers: layers(nodes, def.group === 'row' ? row : def.group === 'component' ? null : template), problem };
  });
}

// 템플릿 관리 화면에 보여 줄 연결 상태. 템플릿을 찾지 못하면 error만 채운다.
export async function describeTemplate(templateId: string, ns = NS): Promise<TemplateInfo> {
  let template: FrameNode;
  try { template = await templateFrame(templateId); }
  catch (e) { return { id: templateId, name: '', pageName: '', linked: false, items: [], error: e instanceof Error ? e.message : String(e) }; }
  const links = linksOf(template, ns);
  const items = links ? await linkedItems(template, links, ns) : await namedItems(template);
  return { id: template.id, name: template.name, pageName: pageOf(template)?.name ?? '', linked: !!links, items, error: null };
}

// 지정한 템플릿으로 플립북을 만들거나 반영할 수 있는지 확인한다. 템플릿 컴포넌트를 고쳐 칸이 없어지거나 바뀌면
// 반영이 중간에 멈추므로, 관리 화면이 아니어도 미리 알린다. 템플릿을 지정하지 않았으면 확인하지 않는다.
export async function templateIssues(templateId: string | null, ns = NS): Promise<string[]> {
  if (!templateId) return [];
  let template: FrameNode;
  try { template = await templateFrame(templateId); }
  catch (e) { return [e instanceof Error ? e.message : String(e)]; }
  const links = linksOf(template, ns);
  if (links) return (await linkedItems(template, links, ns)).filter(i => i.problem).map(i => `${itemDef(i.key)!.label}: ${i.problem}`);
  const problems = templateProblems(template);
  const tags = tagComponents(template).problem;
  return [...(problems.length ? [`${COPY.figmaFlipbook009} ${problems.join(', ')}`] : []), ...(tags ? [tags] : [])];
}

// 항목에 연결된(이름 규칙이면 이름으로 찾은) 레이어의 노드 ID. 캔버스에서 보여 줄 때 쓴다.
export async function templateItemNodes(templateId: string, key: TemplateItem, ns = NS): Promise<string[]> {
  const info = await describeTemplate(templateId, ns);
  if (info.error) throw new Error(info.error);
  return info.items.find(i => i.key === key)?.layers.map(l => l.id) ?? [];
}

// ── 연결 바꾸기 ────────────────────────────────────────

function setRole(node: BaseNode, role: string, ns: string): void {
  if ('setSharedPluginData' in node && node.getSharedPluginData(ns, PART_KEY) !== role) node.setSharedPluginData(ns, PART_KEY, role);
}

// 이름 규칙 템플릿을 표식 템플릿으로 바꾼다. 이름으로 찾은 칸에 같은 역할 표식을 달고, 태그·이력 행 컴포넌트를 연결 기록에 둔다.
// 이미 만든 플립북은 연결 기록이 없으므로 계속 이름으로 찾고, 이후 만드는 플립북부터 표식으로 찾는다.
async function convertToLinked(template: FrameNode, ns: string): Promise<TemplateLinks> {
  const p = namedParts(template);
  const previous = p.list && 'findChild' in p.list ? (p.list as ChildrenMixin).findChild(n => n.type === 'FRAME' && n.name === 'Previous') : null;
  const marks: [BaseNode | null, string][] = [
    [p.titleText, 'title'], [p.page, 'title'], [p.chapter, 'chapter'], [p.status, 'status'], [p.ids, 'ids'], [p.gui, 'gui'],
    [p.description, 'description'], [p.list, 'history'], [previous, 'previous'], [p.title, 'pdfHidden'], [p.history, 'pdfHidden'],
  ];
  for (const [node, role] of marks) if (node) setRole(node, role, ns);
  const tags = tagComponents(template);
  const row = await namedRowComponent(p.history, template);
  const links: TemplateLinks = { components: {} };
  if (tags.big) links.components.statusTag = tags.big.id;
  if (tags.small) links.components.rowStatusTag = tags.small.id;
  if (tags.idTag) links.components.idTag = tags.idTag.id;
  if (row && !row.remote) {
    links.components.row = row.id;
    setRole(row, 'row', ns);
    const r = namedRowParts(row);
    const rowMarks: [BaseNode | null, RowPart][] = [[r.status, 'rowStatus'], [r.comment, 'rowComment'], [r.worker, 'rowWorker'], [r.date, 'rowDate'], [r.team, 'rowTeam']];
    for (const [node, role] of rowMarks) if (node) setRole(node, role, ns);
  }
  template.setSharedPluginData(ns, LINKS_KEY, linksValue(links));
  return links;
}

async function linkedTemplate(templateId: string, ns: string): Promise<{ template: FrameNode; links: TemplateLinks }> {
  const template = await templateFrame(templateId);
  const links = linksOf(template, ns) ?? await convertToLinked(template, ns);
  return { template, links };
}

const contains = (root: BaseNode, node: BaseNode) => {
  for (let n: BaseNode | null = node; n; n = n.parent) if (n.id === root.id) return true;
  return false;
};

// 이력 행 컴포넌트 안에서 고른 레이어. 템플릿의 이력 행 인스턴스 안에서 골랐으면 컴포넌트의 같은 자리 레이어다(인스턴스는
// 컴포넌트와 자식 구성이 같다). 행 자체나 행 밖이면 null.
async function rowTarget(node: SceneNode, row: ComponentNode): Promise<SceneNode | null> {
  if (contains(row, node)) return node.id === row.id ? null : node;
  // path: 고른 레이어부터 위로 올라가며 적은 자식 순번. 행 인스턴스에 닿으면 컴포넌트에서 거꾸로 따라 내려간다.
  const path: number[] = [];
  let n: BaseNode = node;
  while (n.parent && n.parent.type !== 'PAGE') {
    if (n.type === 'INSTANCE' && (await n.getMainComponentAsync())?.id === row.id) {
      if (!path.length) return null;
      let target: SceneNode = row;
      for (const index of path.reverse()) {
        const child: SceneNode | undefined = 'children' in target ? target.children[index] : undefined;
        if (!child) return null;
        target = child;
      }
      return target;
    }
    const parent: BaseNode & ChildrenMixin = n.parent;
    path.push(parent.children.indexOf(n as SceneNode));
    n = parent;
  }
  return null;
}

// 캔버스에서 고른 레이어(컴포넌트 항목은 컴포넌트나 그 인스턴스)를 항목에 연결한다. 그 항목에 연결돼 있던 레이어는 연결을 푼다.
// 이름 규칙 템플릿이면 먼저 표식 템플릿으로 바꾼다.
export async function connectTemplateItem(templateId: string, key: TemplateItem, ns = NS): Promise<void> {
  const def = itemDef(key);
  if (!def) throw new Error(COPY.figmaTemplate013);
  const selection = figma.currentPage.selection;
  if (!selection.length) throw new Error(COPY.figmaTemplate013);
  if (!def.multi && selection.length > 1) throw new Error(COPY.figmaTemplate014);
  const { template, links } = await linkedTemplate(templateId, ns);

  if (def.group === 'component') {
    const node = selection[0];
    const component = node.type === 'COMPONENT' ? node : node.type === 'INSTANCE' ? await node.getMainComponentAsync() : null;
    if (!component) throw new Error(COPY.figmaTemplate020);
    if (key === 'row') {
      if (component.remote) throw new Error(COPY.figmaTemplate019);
      const before = (await linkedComponents(links)).row;
      if (before && before.id !== component.id && !before.remote) before.setSharedPluginData(ns, PART_KEY, '');
      setRole(component, 'row', ns);
    } else if (!hasText(component)) throw new Error(COPY.figmaTemplate011);
    links.components[key as ComponentPart] = component.id;
    template.setSharedPluginData(ns, LINKS_KEY, linksValue(links));
    return;
  }

  if (def.group === 'row') {
    const row = (await linkedComponents(links)).row;
    if (!row) throw new Error(COPY.figmaTemplate017);
    const target = await rowTarget(selection[0], row);
    if (!target) throw new Error(COPY.figmaTemplate018);
    const problem = kindProblem(def.kind, target);
    if (problem) throw new Error(problem);
    for (const old of markedRowNodes(row, ns).get(key) ?? []) if (old.id !== target.id) old.setSharedPluginData(ns, PART_KEY, '');
    setRole(target, key, ns);
    return;
  }

  for (const node of selection) {
    if (node.id === template.id || !contains(template, node)) throw new Error(COPY.figmaTemplate015);
    // 찾을 때 내려가지 않는 칸(GUI 영역·Description 본문·Screen ID 칸·이력 행) 안의 레이어는 연결해도 찾지 못한다.
    for (let n = node.parent; n && n.id !== template.id; n = n.parent) {
      const role = roleOf(n, ns);
      if (role === 'row') throw new Error(COPY.figmaTemplate022);
      // 이력 목록·이전 이력칸만 Figma 슬롯 안의 레이어 연결을 허용한다. 그 밖의 불투명 영역은 계속 막는다.
      const slotArea = key === 'history' || key === 'previous';
      if ((OPAQUE.has(role) || (n.type === 'SLOT' && !slotArea)) || n.name === GUI_AREA) throw new Error(COPY.figmaTemplate016);
    }
    const problem = kindProblem(def.kind, node);
    if (problem) throw new Error(problem);
  }
  const chosen = new Set(selection.map(n => n.id));
  for (const old of markedParts(template, ns).get(key) ?? []) if (!chosen.has(old.id)) old.setSharedPluginData(ns, PART_KEY, '');
  for (const node of selection) setRole(node, key, ns);
}

// 항목의 연결을 푼다. GUI 영역은 필수라 풀 수 없다. 이름 규칙 템플릿이면 먼저 표식 템플릿으로 바꾼다.
export async function disconnectTemplateItem(templateId: string, key: TemplateItem, ns = NS): Promise<void> {
  const def = itemDef(key);
  if (!def) return;
  if (def.required) throw new Error(COPY.figmaTemplate021);
  const { template, links } = await linkedTemplate(templateId, ns);
  if (def.group === 'component') {
    if (key === 'row') {
      const row = (await linkedComponents(links)).row;
      if (row && !row.remote) row.setSharedPluginData(ns, PART_KEY, '');
    }
    delete links.components[key as ComponentPart];
    template.setSharedPluginData(ns, LINKS_KEY, linksValue(links));
    return;
  }
  if (def.group === 'row') {
    const row = (await linkedComponents(links)).row;
    if (row) for (const node of markedRowNodes(row, ns).get(key) ?? []) node.setSharedPluginData(ns, PART_KEY, '');
    return;
  }
  for (const node of markedParts(template, ns).get(key) ?? []) node.setSharedPluginData(ns, PART_KEY, '');
}
