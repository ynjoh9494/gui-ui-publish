import { COPY } from './copy.ts';

// 템플릿 연결(2026-10-28 사용자 결정): 플러그인이 정보를 넣는 칸을 레이어 이름 대신 역할 표식으로 연결한다.
// 템플릿 레이어에 표식을 달면 플립북은 템플릿 복제(프레임 안 레이어)와 인스턴스(컴포넌트 안 레이어)로 그 표식을 그대로 이어받는다.
// 표식 템플릿은 템플릿 프레임에 연결 기록(LINKS_KEY)이 있고, 복제한 플립북 프레임도 같은 기록을 가진다.
// 기록이 없는 템플릿·플립북(이전에 만든 것)은 지금까지의 레이어 이름 규칙으로 찾는다.

// 레이어의 역할 표식(sharedPluginData). 값은 TemplateItem 하나다.
export const PART_KEY = 'templatePart';
// 템플릿(과 복제한 플립북) 프레임의 연결 기록. 있으면 표식 템플릿이다.
export const LINKS_KEY = 'templateLinks';

export type FlipbookPart = 'title' | 'chapter' | 'status' | 'ids' | 'gui' | 'descriptionArea' | 'description' | 'history' | 'previous' | 'pdfHidden';
export type RowPart = 'rowStatus' | 'rowComment' | 'rowWorker' | 'rowDate' | 'rowTeam';
// 컴포넌트는 표식 대신 연결 기록에 노드 ID로 둔다. 이력 행 컴포넌트에는 'row' 표식도 달아 인스턴스(이력 행)를 알아본다.
export type ComponentPart = 'idTag' | 'row' | 'statusTag' | 'rowStatusTag' | 'marker';
export type TemplateItem = FlipbookPart | RowPart | ComponentPart;

// text: 텍스트 레이어, tag: 태그 인스턴스나 텍스트, area: 레이어를 넣을 칸(슬롯이나 인스턴스 밖 프레임), frame: 인스턴스 밖 프레임,
// layers: 아무 레이어, component: 컴포넌트, team: 텍스트나 인스턴스(값이 GUI·UI인 변형 속성)
export type ItemKind = 'text' | 'tag' | 'area' | 'frame' | 'layers' | 'component' | 'team';
// group: 레이어가 놓인 곳(연결·검사가 쓴다). flipbook: 템플릿 프레임 안, component: 컴포넌트, row: 히스토리 행 컴포넌트 안
export type ItemGroup = 'flipbook' | 'component' | 'row';
// section: 관리 화면에서 묶어 보여 주는 의미 단위(2026-11-05 사용자 결정: 위치 대신 의미로 묶는다)
export type ItemSection = 'info' | 'gui' | 'description' | 'history' | 'pdf';

export interface TemplateItemDef {
  key: TemplateItem; group: ItemGroup; section: ItemSection; kind: ItemKind;
  // 부모 칸 안에 들어가거나 부모가 있어야 쓰이는 항목. 관리 화면에서 부모 아래에 들여쓴다. 배열에서 부모 뒤에 둔다.
  parent?: TemplateItem;
  // 레이어 여러 개를 연결할 수 있다.
  multi?: boolean;
  // 연결하지 않으면 플립북을 만들 수 없다.
  required?: boolean;
  label: string; hint: string;
}

// 관리 화면에 보이는 순서다. 자식은 부모 바로 뒤에 둔다.
export const TEMPLATE_ITEMS: readonly TemplateItemDef[] = [
  { key: 'title', group: 'flipbook', section: 'info', kind: 'text', multi: true, label: COPY.coreTemplate001, hint: COPY.coreTemplate002 },
  { key: 'chapter', group: 'flipbook', section: 'info', kind: 'text', label: COPY.coreTemplate003, hint: COPY.coreTemplate004 },
  { key: 'status', group: 'flipbook', section: 'info', kind: 'tag', label: COPY.coreTemplate005, hint: COPY.coreTemplate006 },
  { key: 'statusTag', group: 'component', section: 'info', parent: 'status', kind: 'component', label: COPY.coreTemplate023, hint: COPY.coreTemplate024 },
  { key: 'ids', group: 'flipbook', section: 'info', kind: 'area', label: COPY.coreTemplate007, hint: COPY.coreTemplate008 },
  { key: 'idTag', group: 'component', section: 'info', parent: 'ids', kind: 'component', label: COPY.coreTemplate019, hint: COPY.coreTemplate020 },
  { key: 'gui', group: 'flipbook', section: 'gui', kind: 'frame', required: true, label: COPY.coreTemplate009, hint: COPY.coreTemplate010 },
  { key: 'marker', group: 'component', section: 'gui', kind: 'component', label: COPY.coreTemplate040, hint: COPY.coreTemplate041 },
  { key: 'descriptionArea', group: 'flipbook', section: 'description', kind: 'layers', label: COPY.coreTemplate044, hint: COPY.coreTemplate045 },
  { key: 'description', group: 'flipbook', section: 'description', parent: 'descriptionArea', kind: 'area', label: COPY.coreTemplate011, hint: COPY.coreTemplate012 },
  { key: 'history', group: 'flipbook', section: 'history', kind: 'area', label: COPY.coreTemplate013, hint: COPY.coreTemplate014 },
  { key: 'row', group: 'component', section: 'history', parent: 'history', kind: 'component', label: COPY.coreTemplate021, hint: COPY.coreTemplate022 },
  { key: 'rowStatus', group: 'row', section: 'history', parent: 'row', kind: 'tag', label: COPY.coreTemplate027, hint: COPY.coreTemplate028 },
  { key: 'rowStatusTag', group: 'component', section: 'history', parent: 'rowStatus', kind: 'component', label: COPY.coreTemplate025, hint: COPY.coreTemplate026 },
  { key: 'rowComment', group: 'row', section: 'history', parent: 'row', kind: 'text', label: COPY.coreTemplate029, hint: COPY.coreTemplate030 },
  { key: 'rowWorker', group: 'row', section: 'history', parent: 'row', kind: 'text', label: COPY.coreTemplate031, hint: COPY.coreTemplate032 },
  { key: 'rowDate', group: 'row', section: 'history', parent: 'row', kind: 'text', label: COPY.coreTemplate033, hint: COPY.coreTemplate034 },
  { key: 'rowTeam', group: 'row', section: 'history', parent: 'row', kind: 'team', label: COPY.coreTemplate035, hint: COPY.coreTemplate036 },
  { key: 'pdfHidden', group: 'flipbook', section: 'pdf', kind: 'layers', multi: true, label: COPY.coreTemplate017, hint: COPY.coreTemplate018 },
];

export const TEMPLATE_SECTIONS: readonly { section: ItemSection; label: string }[] = [
  { section: 'info', label: COPY.coreTemplate037 },
  { section: 'gui', label: COPY.coreTemplate038 },
  { section: 'description', label: COPY.coreTemplate039 },
  { section: 'history', label: COPY.coreTemplate042 },
  { section: 'pdf', label: COPY.coreTemplate043 },
];

// 대표가 아닌 템플릿(2026-11-02 사용자 결정)은 새 플립북을 만들지 않고 이미 있는 플립북을 반영할 때만 쓴다.
// 그때 템플릿에서 읽는 것은 화면 이름·Chapter의 기본 글자, 컴포넌트, 이력 행 안의 칸(컴포넌트 안 표식이라 기존 이력 행이 이어받는다)이다.
// 나머지 칸은 플립북이 만들 때 이어받은 표식을 쓰므로 대표가 아닌 템플릿에서 바꿔도 기존 플립북에 반영되지 않는다.
const FALLBACK_ITEMS: ReadonlySet<TemplateItem> = new Set<TemplateItem>([
  'title', 'chapter', 'idTag', 'row', 'statusTag', 'rowStatusTag', 'marker', 'rowStatus', 'rowComment', 'rowWorker', 'rowDate', 'rowTeam',
]);
export const isFallbackItem = (key: TemplateItem) => FALLBACK_ITEMS.has(key);

const DEFS = new Map(TEMPLATE_ITEMS.map(d => [d.key, d]));
export function itemDef(key: string): TemplateItemDef | null { return DEFS.get(key as TemplateItem) ?? null; }
export const isTemplateItem = (key: string): key is TemplateItem => DEFS.has(key as TemplateItem);
export const isFlipbookPart = (key: string): key is FlipbookPart => DEFS.get(key as TemplateItem)?.group === 'flipbook';
export const isRowPart = (key: string): key is RowPart => DEFS.get(key as TemplateItem)?.group === 'row';
export const isComponentPart = (key: string): key is ComponentPart => DEFS.get(key as TemplateItem)?.group === 'component';

// 템플릿 프레임의 연결 기록. 컴포넌트 연결(노드 ID)만 둔다. 레이어 연결은 레이어 표식이 원본이다.
export interface TemplateLinks { components: Partial<Record<ComponentPart, string>> }

// 기록이 없으면 null(이름 규칙 템플릿). 읽지 못하는 값은 연결 없는 표식 템플릿으로 본다.
export function parseLinks(raw: string): TemplateLinks | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { components?: Record<string, unknown> };
    const components: TemplateLinks['components'] = {};
    for (const [key, id] of Object.entries(value?.components ?? {})) if (isComponentPart(key) && typeof id === 'string' && id) components[key] = id;
    return { components };
  } catch {
    return { components: {} };
  }
}

export function linksValue(links: TemplateLinks): string {
  return JSON.stringify({ v: 1, components: links.components });
}

// UI에 보내는 템플릿 연결 상태. layers: 연결한(이름 규칙이면 이름으로 찾은) 레이어, problem: 이 항목 때문에 만들 수 없는 이유
export interface TemplateLayer { id: string; name: string }
export interface TemplateItemState { key: TemplateItem; layers: TemplateLayer[]; problem: string | null }
export interface TemplateInfo {
  id: string; name: string; pageName: string;
  items: TemplateItemState[];
  // 지정한 템플릿 프레임을 찾지 못했을 때의 이유
  error: string | null;
}
