import { COPY } from '../core/copy.ts';
import { isRed } from '../core/richText.ts';
import type { RichParagraph } from '../core/richText.ts';
import type { TextLayout } from '../core/description.ts';
import { readingText, textCharacters } from './textReadError.ts';

// 텍스트 편집 탭: 캔버스에서 고른 텍스트 레이어 하나를 읽고 쓴다. 글꼴·크기는 레이어 것을 그대로 두고
// 내용, 목록 종류·들여쓰기, 굵기와 색을 적용한다. 빨간 범위 외에는 #333333으로 쓴다. 목록 기호는 글자로 쓰지 않고 Figma 목록 서식을 쓴다.

export const BOLD_STYLE = /bold|black|heavy/i;
// 굵은 글씨로 쓸 같은 글꼴 계열의 스타일. 앞에서부터 불러올 수 있는 것을 쓴다.
const BOLD_STYLES = ['Bold', 'SemiBold', 'Semi Bold', 'ExtraBold', 'Extra Bold', 'Black'];
const joinRanges = (ranges: { start: number; end: number }[]) => ranges.reduce<{ start: number; end: number }[]>((out, range) => {
  const last = out[out.length - 1];
  if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
  else out.push({ ...range });
  return out;
}, []);

export function selectedTextNode(): TextNode {
  const selection = figma.currentPage.selection;
  if (selection.length !== 1 || selection[0].type !== 'TEXT') throw new Error(COPY.figmaText001);
  return selection[0];
}

export function readRichText(node: TextNode): RichParagraph[] {
  const chars = textCharacters(node);
  const segments = chars.length ? readingText(node, COPY.textReadStyles, () => node.getStyledTextSegments(['fontName', 'fontWeight', 'fills'])) : [];
  let offset = 0;
  return chars.split('\n').map(line => {
    const start = offset, end = offset + line.length;
    offset = end + 1;
    const bold = joinRanges(segments
      .filter(s => (s.fontWeight >= 600 || BOLD_STYLE.test(s.fontName.style)) && s.end > start && s.start < end)
      .map(s => ({ start: Math.max(start, s.start) - start, end: Math.min(end, s.end) - start })));
    let depth: number | null = null;
    let listType: 'ORDERED' | 'UNORDERED' | undefined;
    if (line.length) {
      const list = readingText(node, COPY.textReadLists, () => node.getRangeListOptions(start, end));
      if (list !== figma.mixed && list.type !== 'NONE') {
        listType = list.type;
        // Figma 목록의 최상위 들여쓰기는 1이다.
        const indentation = readingText(node, COPY.textReadLists, () => node.getRangeIndentation(start, end));
        depth = typeof indentation === 'number' ? Math.max(0, indentation - 1) : 0;
      }
    }
    const red = segments.filter(s => s.fills?.some(p => p.type === 'SOLID' && p.visible !== false && (p.opacity ?? 1) > 0 && isRed(p.color)) && s.end > start && s.start < end)
      .map(s => ({ start: Math.max(start, s.start) - start, end: Math.min(end, s.end) - start }));
    return { text: line, depth, ...(listType ? { list: listType } : {}), bold, ...(red.length ? { red } : {}) };
  });
}

async function loadable(font: FontName): Promise<boolean> {
  try { await figma.loadFontAsync(font); return true; } catch { return false; }
}

export interface TextFonts { regular: FontName; bold: FontName }

// 내용을 바꾸려면 지금 쓰인 글꼴을 모두 불러와야 한다. 불러온 글꼴 목록을 돌려준다.
export async function loadUsedFonts(node: TextNode): Promise<FontName[]> {
  if (node.hasMissingFont) throw new Error(COPY.figmaText002);
  const used = node.characters.length
    ? node.getStyledTextSegments(['fontName']).map(s => s.fontName)
    : node.fontName === figma.mixed ? [] : [node.fontName];
  for (const font of used) if (!await loadable(font)) throw new Error(`${COPY.figmaText003} ${font.family} ${font.style}`);
  return used;
}

// 본문은 레이어에 쓰인 굵지 않은 글꼴(없으면 같은 계열의 Regular), 굵은 글씨는 같은 계열의 Bold 계열 스타일을 쓴다.
export async function textFonts(node: TextNode): Promise<TextFonts> {
  const used = await loadUsedFonts(node);
  const family = used[0]?.family ?? 'Inter';
  const regular = used.find(f => !BOLD_STYLE.test(f.style)) ?? { family, style: 'Regular' };
  if (!used.some(f => f.family === regular.family && f.style === regular.style) && !await loadable(regular)) throw new Error(`${COPY.figmaText003} ${regular.family} ${regular.style}`);
  const usedBold = used.find(f => f.family === regular.family && BOLD_STYLE.test(f.style));
  if (usedBold) return { regular, bold: usedBold };
  for (const style of BOLD_STYLES) {
    const bold = { family: regular.family, style };
    if (await loadable(bold)) return { regular, bold };
  }
  throw new Error(`${COPY.figmaText004} ${regular.family}`);
}

// 글꼴을 모두 불러온 뒤에 내용을 바꾸므로 글꼴 문제로 실패하면 레이어는 그대로다.
export async function writeRichText(node: TextNode, paragraphs: RichParagraph[], layout?: TextLayout): Promise<void> {
  applyRichText(node, paragraphs, await textFonts(node), layout);
}

// 텍스트 레이어의 글자 서식을 편집기 서식 도구 값으로 읽는다. 행간·자간은 %로 바꾸고, 행간이 자동이면 null이다.
export function readTextLayout(node: TextNode): Partial<TextLayout> {
  return readingText(node, COPY.textReadStyles, () => readLayout(node));
}

function readLayout(node: TextNode): Partial<TextLayout> {
  const out: Partial<TextLayout> = {};
  const has = textCharacters(node).length > 0;
  const size = has ? node.getRangeFontSize(0, 1) : node.fontSize;
  if (typeof size === 'number') out.fontSize = Math.round(size * 100) / 100;
  const line = has ? node.getRangeLineHeight(0, 1) : node.lineHeight;
  if (line !== figma.mixed && line.unit === 'PERCENT') out.lineHeight = Math.round(line.value * 100) / 100;
  else if (line !== figma.mixed && line.unit === 'PIXELS' && out.fontSize) out.lineHeight = Math.round(line.value / out.fontSize * 10000) / 100;
  const spacing = has ? node.getRangeLetterSpacing(0, 1) : node.letterSpacing;
  if (spacing !== figma.mixed && spacing.unit === 'PERCENT') out.letterSpacing = Math.round(spacing.value * 100) / 100;
  else if (spacing !== figma.mixed && spacing.unit === 'PIXELS' && out.fontSize) out.letterSpacing = Math.round(spacing.value / out.fontSize * 10000) / 100;
  if (typeof node.listSpacing === 'number') out.listSpacing = node.listSpacing;
  return out;
}

// textFonts로 글꼴을 불러온 레이어에 쓴다. 여러 레이어를 바꿀 때 모든 글꼴을 먼저 불러온 뒤 차례로 쓴다.
// layout: 편집기 서식 도구의 글자 크기·자간·행간·List Spacing. 없으면 글자 크기·자간은 레이어 것을 두고 행간 140%·List Spacing 2를 쓴다.
export function applyRichText(node: TextNode, paragraphs: RichParagraph[], { regular, bold }: TextFonts, layout?: TextLayout): void {
  const text = paragraphs.map(p => p.text).join('\n');
  node.characters = text;
  node.lineHeight = { unit: 'PERCENT', value: layout?.lineHeight ?? 140 };
  node.listSpacing = layout?.listSpacing ?? 2;
  if (layout) {
    node.fontSize = layout.fontSize;
    node.letterSpacing = { unit: 'PERCENT', value: layout.letterSpacing };
  }
  if (!text.length) return;
  node.setRangeFills(0, text.length, [{ type: 'SOLID', color: { r: 0.2, g: 0.2, b: 0.2 } }]);
  node.setRangeFontName(0, text.length, regular);
  node.setRangeListOptions(0, text.length, { type: 'NONE' });
  node.setRangeIndentation(0, text.length, 0);
  let offset = 0;
  for (const p of paragraphs) {
    const end = offset + p.text.length;
    if (end > offset) {
      if (p.depth !== null) {
        node.setRangeListOptions(offset, end, { type: p.list ?? 'UNORDERED' });
        node.setRangeIndentation(offset, end, p.depth + 1);
      }
      for (const range of p.red ?? []) if (range.end > range.start) node.setRangeFills(offset + range.start, offset + range.end, [{ type: 'SOLID', color: { r: 214 / 255, g: 52 / 255, b: 52 / 255 } }]);
      for (const range of p.bold) if (range.end > range.start) node.setRangeFontName(offset + range.start, offset + range.end, bold);
    }
    offset = end + 1;
  }
}
