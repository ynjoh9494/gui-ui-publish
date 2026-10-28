import { COPY } from '../core/copy.ts';
import { LINKS_KEY, PART_KEY, linksValue, type TemplateItem } from '../core/templateParts.ts';
import { NS } from './template.ts';

// 기본 템플릿(2026-10-28 사용자 결정: 새로 만든 단순한 기본형을 새 페이지에 만들고 바로 템플릿으로 지정한다).
// 모든 칸에 역할 표식을 달아 표식 템플릿으로 만든다. 상태 칸에는 태그 인스턴스를 그대로 두므로 상태 태그 컴포넌트는 연결하지 않는다.
// 플러그인이 채우는 칸의 글자는 플립북에 그대로 이어지므로 예시용 붉은색으로 쓰지 않는다. Description 본문은 비워 둔다
// (텍스트 편집 탭이 칸에 있던 글자 서식을 이어받는다).

const FONT = 'Inter';
const INK = '#1F1F1F';
const SUB = '#6B6B6B';
const LINE = '#E0E0E0';
const PANEL = '#F7F7F7';
const AREA = '#F2F2F2';
const WHITE = '#FFFFFF';
// 팔레트 Black. 상태 태그는 팔레트 색 칠만 고른 색으로 바꾼다(figma/flipbook.ts recolorTagFills).
const TAG = '#333333';
// 템플릿과 컴포넌트 사이, 컴포넌트 사이 간격
const COMPONENT_GAP = 200;
const STACK_GAP = 60;

function solid(hex: string): SolidPaint {
  const n = parseInt(hex.slice(1), 16);
  return { type: 'SOLID', color: { r: (n >> 16 & 255) / 255, g: (n >> 8 & 255) / 255, b: (n & 255) / 255 } };
}

function stack(name: string, direction: 'HORIZONTAL' | 'VERTICAL', gap: number): FrameNode {
  const frame = figma.createFrame();
  frame.name = name;
  frame.layoutMode = direction;
  frame.primaryAxisSizingMode = 'AUTO';
  frame.counterAxisSizingMode = 'AUTO';
  frame.itemSpacing = gap;
  frame.fills = [];
  frame.clipsContent = false;
  return frame;
}

function text(characters: string, style: string, size: number, color: string, name: string): TextNode {
  const node = figma.createText();
  node.fontName = { family: FONT, style };
  node.fontSize = size;
  node.characters = characters;
  node.fills = [solid(color)];
  node.name = name;
  return node;
}

function pad(frame: FrameNode | ComponentNode, x: number, y: number): void {
  frame.paddingLeft = frame.paddingRight = x;
  frame.paddingTop = frame.paddingBottom = y;
}

// 만들자마자 새 페이지로 옮긴다. 중간에 실패해도 보고 있는 페이지에 남지 않고 새 페이지와 함께 지워진다.
function tagComponent(page: PageNode, name: string, label: string, fill: string, ink: string, stroke: string | null): ComponentNode {
  const tag = figma.createComponent();
  page.appendChild(tag);
  tag.name = name;
  tag.layoutMode = 'HORIZONTAL';
  tag.primaryAxisSizingMode = 'AUTO';
  tag.counterAxisSizingMode = 'AUTO';
  pad(tag, 10, 4);
  tag.cornerRadius = 4;
  tag.fills = [solid(fill)];
  if (stroke) { tag.strokes = [solid(stroke)]; tag.strokeWeight = 1; }
  tag.appendChild(text(label, 'Medium', 12, ink, 'Text'));
  return tag;
}

// 새 페이지에 기본 템플릿과 컴포넌트를 만들고 템플릿 프레임을 돌려준다. 글꼴을 불러오지 못하면 아무것도 만들지 않는다.
export async function createDefaultTemplate(ns = NS): Promise<{ id: string; name: string; pageId: string }> {
  try { await Promise.all(['Regular', 'Medium', 'Bold'].map(style => figma.loadFontAsync({ family: FONT, style }))); }
  catch { throw new Error(COPY.figmaTemplate024); }
  const mark = (node: SceneNode, role: TemplateItem | 'row') => node.setSharedPluginData(ns, PART_KEY, role);
  const page = figma.createPage();
  page.name = COPY.figmaTemplate025;
  try {
    const tag = tagComponent(page, COPY.figmaTemplate027, COPY.figmaTemplate028, TAG, WHITE, null);
    const idTag = tagComponent(page, COPY.figmaTemplate029, COPY.figmaTemplate030, WHITE, INK, LINE);

    // 이력 행: 상태 · 코멘트(남은 폭) · 팀 · 작업자 · 날짜, 아래 구분선
    const row = figma.createComponent();
    page.appendChild(row);
    row.name = COPY.figmaTemplate031;
    row.layoutMode = 'HORIZONTAL';
    row.resize(1200, 40);
    row.primaryAxisSizingMode = 'FIXED';
    row.counterAxisSizingMode = 'AUTO';
    row.counterAxisAlignItems = 'CENTER';
    row.itemSpacing = 16;
    pad(row, 12, 10);
    row.fills = [];
    row.strokes = [solid(LINE)];
    row.strokeTopWeight = row.strokeLeftWeight = row.strokeRightWeight = 0;
    row.strokeBottomWeight = 1;
    const rowStatus = tag.createInstance();
    rowStatus.name = 'Status';
    row.appendChild(rowStatus);
    const comment = text(COPY.figmaTemplate032, 'Regular', 14, INK, 'Comment');
    row.appendChild(comment);
    comment.textAutoResize = 'HEIGHT';
    comment.layoutSizingHorizontal = 'FILL';
    const team = text(COPY.figmaTemplate034, 'Regular', 14, SUB, 'Team');
    const worker = text(COPY.figmaTemplate033, 'Regular', 14, SUB, 'Worker');
    const date = text(COPY.figmaTemplate035, 'Regular', 14, SUB, 'Date');
    for (const node of [team, worker, date]) row.appendChild(node);
    mark(row, 'row');
    mark(rowStatus, 'rowStatus');
    mark(comment, 'rowComment');
    mark(team, 'rowTeam');
    mark(worker, 'rowWorker');
    mark(date, 'rowDate');

    // 템플릿: 머리(Chapter · 제목 + 상태 · Screen ID) / 본문(GUI 영역 · Description) / 이력
    const template = stack(COPY.figmaTemplate026, 'VERTICAL', 32);
    page.appendChild(template);
    template.fills = [solid(WHITE)];
    pad(template, 48, 48);

    const header = stack('Header', 'VERTICAL', 8);
    template.appendChild(header);
    const chapter = text(COPY.figmaTemplate036, 'Regular', 16, SUB, 'Chapter');
    header.appendChild(chapter);
    const titleRow = stack('Title Row', 'HORIZONTAL', 12);
    titleRow.counterAxisAlignItems = 'CENTER';
    header.appendChild(titleRow);
    const title = text(COPY.figmaTemplate037, 'Bold', 32, INK, 'Title');
    titleRow.appendChild(title);
    const status = tag.createInstance();
    status.name = 'Status';
    titleRow.appendChild(status);
    const ids = stack('Screen IDs', 'HORIZONTAL', 8);
    header.appendChild(ids);
    const sampleId = idTag.createInstance();
    sampleId.name = 'Screen ID';
    ids.appendChild(sampleId);

    const body = stack('Body', 'HORIZONTAL', 40);
    template.appendChild(body);
    const gui = figma.createFrame();
    gui.name = 'GUI Area';
    gui.resize(1920, 1080);
    gui.fills = [solid(AREA)];
    gui.clipsContent = false;
    body.appendChild(gui);
    const panel = figma.createFrame();
    panel.name = 'Description';
    panel.layoutMode = 'VERTICAL';
    panel.resize(560, 100);
    panel.primaryAxisSizingMode = 'AUTO';
    panel.counterAxisSizingMode = 'FIXED';
    panel.itemSpacing = 16;
    pad(panel, 24, 24);
    panel.cornerRadius = 8;
    panel.fills = [solid(PANEL)];
    body.appendChild(panel);
    panel.appendChild(text(COPY.figmaTemplate038, 'Bold', 18, INK, 'Heading'));
    const description = stack('Description Body', 'VERTICAL', 12);
    panel.appendChild(description);
    description.layoutSizingHorizontal = 'FILL';
    description.minHeight = 240;

    const history = stack('History', 'VERTICAL', 12);
    template.appendChild(history);
    history.layoutSizingHorizontal = 'FILL';
    history.appendChild(text(COPY.figmaTemplate039, 'Bold', 18, INK, 'Heading'));
    const list = stack('History List', 'VERTICAL', 0);
    history.appendChild(list);
    list.layoutSizingHorizontal = 'FILL';
    // 템플릿에서 이력 행이 놓일 자리를 보여 주는 예시 행. 플립북에서는 첫 반영 때 이력 행으로 바뀐다.
    const sampleRow = row.createInstance();
    list.appendChild(sampleRow);
    sampleRow.layoutSizingHorizontal = 'FILL';

    mark(chapter, 'chapter');
    mark(title, 'title');
    mark(status, 'status');
    mark(ids, 'ids');
    mark(gui, 'gui');
    mark(description, 'description');
    mark(list, 'history');
    mark(history, 'pdfHidden');
    template.setSharedPluginData(ns, LINKS_KEY, linksValue({ components: { idTag: idTag.id, row: row.id } }));

    template.x = 0;
    template.y = 0;
    let y = 0;
    for (const component of [tag, idTag, row]) {
      component.x = template.width + COMPONENT_GAP;
      component.y = y;
      y += component.height + STACK_GAP;
    }
    return { id: template.id, name: template.name, pageId: page.id };
  } catch (error) {
    page.remove();
    throw error;
  }
}
