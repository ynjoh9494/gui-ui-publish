import { COPY } from '../core/copy.ts';
import { isRed } from '../core/richText.ts';
import type { RichParagraph } from '../core/richText.ts';

// 텍스트 편집 탭: 캔버스에서 고른 텍스트 레이어 하나를 읽고 쓴다. 글꼴·크기·행간·색은 레이어 것을 그대로 두고
// 내용, 목록(글머리표)·들여쓰기, 굵기만 바꾼다. 목록 기호는 글자로 쓰지 않고 Figma 목록 서식을 쓴다.

export const BOLD_STYLE = /bold|black|heavy/i;
// 굵은 글씨로 쓸 같은 글꼴 계열의 스타일. 앞에서부터 불러올 수 있는 것을 쓴다.
const BOLD_STYLES = ['Bold', 'SemiBold', 'Semi Bold', 'ExtraBold', 'Extra Bold', 'Black'];

export function selectedTextNode(): TextNode {
  const selection = figma.currentPage.selection;
  if (selection.length !== 1 || selection[0].type !== 'TEXT') throw new Error(COPY.figmaText001);
  return selection[0];
}

export function readRichText(node: TextNode): RichParagraph[] {
  const chars = node.characters;
  const segments = chars.length ? node.getStyledTextSegments(['fontName', 'fills']) : [];
  let offset = 0;
  return chars.split('\n').map(line => {
    const start = offset, end = offset + line.length;
    offset = end + 1;
    const bold = segments
      .filter(s => BOLD_STYLE.test(s.fontName.style) && s.end > start && s.start < end)
      .map(s => ({ start: Math.max(start, s.start) - start, end: Math.min(end, s.end) - start }));
    let depth: number | null = null;
    if (line.length) {
      const list = node.getRangeListOptions(start, end);
      if (list !== figma.mixed && list.type !== 'NONE') {
        // Figma 목록의 최상위 들여쓰기는 1이다.
        const indentation = node.getRangeIndentation(start, end);
        depth = typeof indentation === 'number' ? Math.max(0, indentation - 1) : 0;
      }
    }
    const red = segments.filter(s => s.fills?.some(p => p.type === 'SOLID' && p.visible !== false && (p.opacity ?? 1) > 0 && isRed(p.color)) && s.end > start && s.start < end)
      .map(s => ({ start: Math.max(start, s.start) - start, end: Math.min(end, s.end) - start }));
    return { text: line, depth, bold, ...(red.length ? { red } : {}) };
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
export async function writeRichText(node: TextNode, paragraphs: RichParagraph[]): Promise<void> {
  applyRichText(node, paragraphs, await textFonts(node));
}

// textFonts로 글꼴을 불러온 레이어에 쓴다. 여러 레이어를 바꿀 때 모든 글꼴을 먼저 불러온 뒤 차례로 쓴다.
export function applyRichText(node: TextNode, paragraphs: RichParagraph[], { regular, bold }: TextFonts): void {
  const text = paragraphs.map(p => p.text).join('\n');
  const segments = node.characters.length ? node.getStyledTextSegments(['fills']) : [];
  const base = segments.find(s => s.fills?.length && !s.fills.some(p => p.type === 'SOLID' && isRed(p.color)))?.fills ?? (node.fills !== figma.mixed && node.fills?.length && !node.fills.some(p => p.type === 'SOLID' && isRed(p.color)) ? node.fills : undefined);
  const hadRed = segments.some(s => s.fills?.some(p => p.type === 'SOLID' && isRed(p.color)));
  node.characters = text;
  if (!text.length) return;
  if (hadRed || paragraphs.some(p => p.red?.length)) node.setRangeFills(0, text.length, base ? [...base] : [{ type: 'SOLID', color: { r: 0.2, g: 0.2, b: 0.2 } }]);
  node.setRangeFontName(0, text.length, regular);
  node.setRangeListOptions(0, text.length, { type: 'NONE' });
  node.setRangeIndentation(0, text.length, 0);
  let offset = 0;
  for (const p of paragraphs) {
    const end = offset + p.text.length;
    if (end > offset) {
      if (p.depth !== null) {
        node.setRangeListOptions(offset, end, { type: 'UNORDERED' });
        node.setRangeIndentation(offset, end, p.depth + 1);
      }
      for (const range of p.red ?? []) if (range.end > range.start) node.setRangeFills(offset + range.start, offset + range.end, [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }]);
      for (const range of p.bold) if (range.end > range.start) node.setRangeFontName(offset + range.start, offset + range.end, bold);
    }
    offset = end + 1;
  }
}
