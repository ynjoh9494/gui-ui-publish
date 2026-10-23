import { COPY } from '../core/copy.ts';
import type { DataModel } from '../core/data.ts';
import type { TagSnapshot } from '../core/types.ts';
import { sha256 } from '../core/hash.ts';

// 공유 DATA 페이지. 표시 프레임(화면 현황·Publish 이력)은 원기록의 바뀐 행만 갱신한다.
// 확정 화면은 보존하지 않는다. 화면별 최신 GUI 복사본은 플립북 페이지의 보관 프레임에 둔다.

const ROLE_KEY = 'role';
const PAGE_ROLE = 'data';
const PAGE_NAME = COPY.figmaData001;
type FrameRole = 'data-summary' | 'data-history';

const GAP = 120;
const INK = { r: 0.13, g: 0.15, b: 0.17 };
const MUTED = { r: 0.45, g: 0.48, b: 0.52 };
const LINE = { r: 0.87, g: 0.89, b: 0.9 };
const HEAD_BG = { r: 0.95, g: 0.96, b: 0.97 };
const WHITE = { r: 1, g: 1, b: 1 };

export interface Fonts { regular: FontName; bold: FontName }

// 한글을 표시할 수 있는 글꼴을 우선 시도한다. 모두 실패하면 Figma 기본 글꼴을 쓴다.
const FONT_CANDIDATES = ['Pretendard', 'Noto Sans KR', 'Inter'];
let fontCache: Promise<Fonts> | null = null;

export function loadFonts(): Promise<Fonts> {
  fontCache ??= (async () => {
    for (const family of FONT_CANDIDATES) {
      const regular = { family, style: 'Regular' };
      const bold = { family, style: 'Bold' };
      try {
        await Promise.all([figma.loadFontAsync(regular), figma.loadFontAsync(bold)]);
        return { regular, bold };
      } catch { /* 다음 후보 */ }
    }
    throw new Error(COPY.figmaData002);
  })();
  // 실패한 결과는 다음 실행에서 다시 시도한다.
  fontCache.catch(() => { fontCache = null; });
  return fontCache;
}

function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0x868e96;
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

function solid(color: RGB): SolidPaint[] { return [{ type: 'SOLID', color }]; }

function autoFrame(name: string, direction: 'HORIZONTAL' | 'VERTICAL', spacing = 0): FrameNode {
  const f = figma.createFrame();
  f.name = name;
  f.layoutMode = direction;
  f.primaryAxisSizingMode = 'AUTO';
  f.counterAxisSizingMode = 'AUTO';
  f.itemSpacing = spacing;
  f.fills = [];
  f.clipsContent = false;
  return f;
}

function text(fonts: Fonts, value: string, opts: { width?: number; size?: number; bold?: boolean; color?: RGB } = {}): TextNode {
  const t = figma.createText();
  t.fontName = opts.bold ? fonts.bold : fonts.regular;
  t.fontSize = opts.size ?? 14;
  t.characters = value || ' ';
  t.fills = solid(opts.color ?? INK);
  if (opts.width) {
    // 폭을 정한 뒤 높이만 자동으로 맞춘다.
    t.resize(opts.width, t.height);
    t.textAutoResize = 'HEIGHT';
  } else {
    t.textAutoResize = 'WIDTH_AND_HEIGHT';
  }
  return t;
}

// 색상만으로 구분하지 않도록 이름을 함께 표시한다.
function chip(fonts: Fonts, label: string, color: RGB): FrameNode {
  const f = autoFrame(`tag ${label}`, 'HORIZONTAL');
  f.paddingLeft = f.paddingRight = 8;
  f.paddingTop = f.paddingBottom = 3;
  f.cornerRadius = 4;
  f.fills = solid(color);
  f.appendChild(text(fonts, label, { size: 12, bold: true, color: WHITE }));
  return f;
}

function tagChip(fonts: Fonts, tag: TagSnapshot | null): SceneNode {
  return tag ? chip(fonts, tag.name, hexToRgb(tag.color)) : text(fonts, '-', { color: MUTED });
}

interface Column { title: string; width: number }

function cellBox(content: SceneNode, width: number): FrameNode {
  const box = autoFrame('cell', 'HORIZONTAL');
  box.resize(width, box.height);
  box.primaryAxisSizingMode = 'FIXED';
  box.counterAxisSizingMode = 'AUTO';
  box.paddingLeft = box.paddingRight = 8;
  box.paddingTop = box.paddingBottom = 8;
  box.appendChild(content);
  return box;
}

function tableRow(cells: SceneNode[], columns: Column[], head = false): FrameNode {
  const row = autoFrame(head ? 'head' : 'row', 'HORIZONTAL');
  row.fills = solid(head ? HEAD_BG : WHITE);
  row.strokes = solid(LINE);
  row.strokeBottomWeight = 1;
  row.strokeTopWeight = row.strokeLeftWeight = row.strokeRightWeight = 0;
  cells.forEach((c, i) => row.appendChild(cellBox(c, columns[i].width)));
  return row;
}

function table(fonts: Fonts, title: string, note: string, columns: Column[], rows: SceneNode[][]): FrameNode {
  const frame = autoFrame(title, 'VERTICAL', 0);
  frame.fills = solid(WHITE);
  frame.paddingLeft = frame.paddingRight = frame.paddingTop = frame.paddingBottom = 32;
  const head = autoFrame('title', 'VERTICAL', 6);
  head.paddingBottom = 16;
  head.appendChild(text(fonts, title, { size: 28, bold: true }));
  head.appendChild(text(fonts, note, { size: 13, color: MUTED }));
  frame.appendChild(head);
  frame.appendChild(tableRow(columns.map(c => text(fonts, c.title, { width: c.width - 16, size: 13, bold: true })), columns, true));
  if (!rows.length) frame.appendChild(text(fonts, COPY.figmaData003, { size: 13, color: MUTED }));
  for (const cells of rows) frame.appendChild(tableRow(cells, columns));
  return frame;
}

function linked(fonts: Fonts, value: string, width: number, nodeId: string | null): TextNode {
  const t = text(fonts, value, { width, bold: true });
  // 원본 프레임으로 이동하는 링크. 원본이 지워졌으면(삭제로 배포한 화면 등) Figma가 예외를 던지므로 링크 없이 이름만 표시한다.
  // 원본이 있는지 미리 찾으면 dynamic-page에서 원본 페이지를 모두 불러오게 되므로 걸다 실패한 링크만 비운다.
  if (nodeId) {
    try { t.setRangeHyperlink(0, t.characters.length, { type: 'NODE', value: nodeId }); }
    catch { /* 원본 없음 */ }
  }
  return t;
}

const SUMMARY_COLUMNS: Column[] = [
  { title: COPY.figmaData004, width: 280 }, { title: COPY.figmaData005, width: 160 }, { title: COPY.figmaData006, width: 200 }, { title: COPY.figmaData007, width: 90 },
  { title: COPY.figmaData008, width: 110 }, { title: COPY.figmaData009, width: 130 }, { title: COPY.figmaData010, width: 110 }, { title: COPY.figmaData011, width: 130 },
  { title: COPY.figmaData012, width: 160 }, { title: COPY.figmaData013, width: 190 },
];

const HISTORY_COLUMNS: Column[] = [
  { title: COPY.figmaData014, width: 80 }, { title: COPY.figmaData015, width: 190 }, { title: COPY.figmaData004, width: 260 }, { title: COPY.figmaData016, width: 110 },
  { title: COPY.figmaData017, width: 140 }, { title: COPY.figmaData018, width: 560 }, { title: COPY.figmaData019, width: 150 },
];

interface DataRowSpec { key: string; value: unknown; cells: () => SceneNode[] }

// 같은 플러그인 실행 중의 DATA 재도색에서는 행 값만 직렬화해 비교한다.
// 일치하는 이력 행마다 SHA-256을 다시 계산하지 않으며, 프레임이 교체되면 캐시는 함께 버려진다.
const rowSignatures = new WeakMap<FrameNode, Map<string, { raw: string; signature: string }>>();

// 원기록이 같은 행은 그대로 둔다. 수동 복구와 구형 표는 전체 재생성한다.
function syncTable(ns: string, page: PageNode, role: FrameRole, fonts: Fonts, title: string, note: string,
  columns: Column[], specs: DataRowSpec[], rebuild: boolean): FrameNode {
  const old = roleFrames(ns, page, role);
  const existing = !rebuild && old.find(f => f.getSharedPluginData(ns, 'tableVersion') === '1');
  const frame = existing || table(fonts, title, note, columns, []);
  const rows = new Map<string, SceneNode>();
  if (existing) for (const child of frame.children) {
    const key = child.getSharedPluginData(ns, 'rowKey');
    if (key) rows.set(key, child);
  }
  const created: SceneNode[] = [];
  const desired: SceneNode[] = [];
  const previousSignatures = rowSignatures.get(frame);
  const nextSignatures = new Map<string, { raw: string; signature: string }>();
  try {
    for (const spec of specs) {
      const raw = JSON.stringify(spec.value);
      const cached = previousSignatures?.get(spec.key);
      const signature = cached?.raw === raw ? cached.signature : sha256(raw);
      nextSignatures.set(spec.key, { raw, signature });
      const prior = rows.get(spec.key);
      if (prior?.type === 'FRAME' && prior.children.length === columns.length && prior.getSharedPluginData(ns, 'rowValue') === signature) {
        desired.push(prior);
      } else {
        const row = tableRow(spec.cells(), columns);
        created.push(row);
        row.setSharedPluginData(ns, 'rowKey', spec.key);
        row.setSharedPluginData(ns, 'rowValue', signature);
        desired.push(row);
      }
    }
    if (!specs.length) {
      const empty = frame.children.find(n => n.type === 'TEXT' && n.name === 'empty');
      if (empty) desired.push(empty);
      else {
        const node = text(fonts, COPY.figmaData003, { size: 13, color: MUTED });
        node.name = 'empty'; created.push(node); desired.push(node);
      }
    }
  } catch (error) {
    for (const node of created) node.remove();
    if (!existing) frame.remove();
    throw error;
  }
  const keep = new Set(desired);
  for (const child of [...frame.children].slice(2)) if (!keep.has(child)) child.remove();
  desired.forEach((row, i) => { if (frame.children[i + 2] !== row) frame.insertChild(i + 2, row); });
  const heading = frame.children[0];
  const noteNode = heading && 'children' in heading ? heading.children[1] : null;
  if (noteNode?.type === 'TEXT' && noteNode.characters !== note) noteNode.characters = note;
  frame.setSharedPluginData(ns, ROLE_KEY, role);
  frame.setSharedPluginData(ns, 'tableVersion', '1');
  rowSignatures.set(frame, nextSignatures);
  if (frame.parent !== page) page.appendChild(frame);
  for (const node of old) if (node !== frame) node.remove();
  return frame;
}

function summaryTable(ns: string, page: PageNode, fonts: Fonts, model: DataModel, rebuild: boolean): FrameNode {
  const c = SUMMARY_COLUMNS;
  const w = (i: number) => c[i].width - 16;
  return syncTable(ns, page, 'data-summary', fonts, COPY.figmaData020, `${COPY.figmaData021} ${model.generatedAt} · ${model.actor.name}${COPY.figmaData022}`, c,
    model.screens.map(s => ({ key: s.id, value: s, cells: () => [
      linked(fonts, s.name, w(0), s.sourceNodeId), text(fonts, s.category, { width: w(1) }), text(fonts, s.base || '-', { width: w(2) }),
      text(fonts, s.status, { width: w(3) }), text(fonts, s.gui, { width: w(4) }), tagChip(fonts, s.guiTag), text(fonts, s.ui, { width: w(6) }),
      tagChip(fonts, s.uiTag), text(fonts, s.delivery, { width: w(8) }), text(fonts, s.id, { width: w(9), size: 12, color: MUTED }),
    ] })), rebuild);
}

function historyTable(ns: string, page: PageNode, fonts: Fonts, model: DataModel, rebuild: boolean): FrameNode {
  const c = HISTORY_COLUMNS;
  const w = (i: number) => c[i].width - 16;
  return syncTable(ns, page, 'data-history', fonts, COPY.figmaData023, COPY.figmaData024, c,
    model.history.map(h => ({ key: h.key, value: h, cells: () => [
      chip(fonts, h.team, h.team === 'GUI' ? hexToRgb('#1C7ED6') : hexToRgb('#7048E8')), text(fonts, h.at, { width: w(1) }),
      text(fonts, h.screenName, { width: w(2) }), text(fonts, h.version, { width: w(3) }), tagChip(fonts, h.tag),
      text(fonts, h.corrected ? `${h.description} ${COPY.figmaData025} ${h.original})` : h.description, { width: w(5) }), text(fonts, h.worker, { width: w(6) }),
    ] })), rebuild);
}

// ── 페이지와 보존 노드 ─────────────────────────────────

async function loadedPage(pageId: string): Promise<PageNode> {
  const page = await figma.getNodeByIdAsync(pageId);
  if (!page || page.type !== 'PAGE') throw new Error(COPY.figmaData026);
  await page.loadAsync();
  return page;
}

// 저장된 ID의 페이지, 표식이 남은 페이지 순으로 다시 연결하고 둘 다 없을 때만 새로 만든다.
export async function ensureDataPage(ns: string, pageId: string | null): Promise<string> {
  let page: PageNode | null = null;
  if (pageId) {
    const found = await figma.getNodeByIdAsync(pageId);
    if (found && found.type === 'PAGE') page = found;
  }
  page ??= figma.root.children.find(p => p.getSharedPluginData(ns, ROLE_KEY) === PAGE_ROLE) ?? null;
  if (!page) {
    page = figma.createPage();
    page.name = PAGE_NAME;
  }
  page.setSharedPluginData(ns, ROLE_KEY, PAGE_ROLE);
  return page.id;
}

function roleFrames(ns: string, page: PageNode, role: FrameRole): FrameNode[] {
  return page.children.filter((n): n is FrameNode => n.type === 'FRAME' && n.getSharedPluginData(ns, ROLE_KEY) === role);
}

export async function renderDataPage(ns: string, pageId: string, model: DataModel, rebuild = false): Promise<void> {
  const page = await loadedPage(pageId);
  const fonts = await loadFonts();
  const summary = summaryTable(ns, page, fonts, model, rebuild);
  const history = historyTable(ns, page, fonts, model, rebuild);

  // 두 표 모두 행이 많아 길어지므로 위아래가 아니라 옆으로 놓는다.
  summary.x = 0; summary.y = 0;
  history.x = summary.width + GAP; history.y = 0;
}
