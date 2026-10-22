// 텍스트 편집 탭(2026-10-22 사용자 요청: STB Description Formatter를 대체하고 서식을 중첩 목록·굵게로 줄인다)의 문서 모델.
// 편집기는 문단 배열(RichParagraph[])을 직접 다루고 화면에는 글머리표·굵은 글씨로 보여 준다(WYSIWYG).
// 아래 텍스트 형식은 붙여 넣은 글과 미리보기 표시에만 쓴다:
// `- `(또는 `* `·`+ `) 목록, 탭 문자 하나마다 한 단계 들여쓴 중첩 목록(공백보다 탭), `**굵게**`. 그 밖의 줄은 그대로 일반 문단이다.

export interface BoldRange { start: number; end: number }
// depth: 목록 단계(0이 최상위), 목록이 아니면 null. bold: text 안의 굵은 글씨 범위
export interface RichParagraph { text: string; depth: number | null; bold: BoldRange[] }

// 다른 곳에서 붙여 넣은 Markdown도 읽도록 공백 2칸도 한 단계로 본다.
const BULLET = /^( *)[-*+][ \t]+(.*\S.*)$/;

function inlineBold(source: string): { text: string; bold: BoldRange[] } {
  const bold: BoldRange[] = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let text = '', cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    text += source.slice(cursor, match.index);
    const start = text.length;
    text += match[1];
    bold.push({ start, end: text.length });
    cursor = pattern.lastIndex;
  }
  return { text: text + source.slice(cursor), bold };
}

export function parseRichText(source: string): RichParagraph[] {
  const unmarked = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const lines = unmarked.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const out: RichParagraph[] = [];
  // 단계를 건너뛰어 들여쓰면 바로 윗 단계의 하위로 본다(Figma 목록도 한 단계씩만 들어간다).
  let previous: number | null = null;
  for (const line of lines) {
    const bullet = BULLET.exec(line.replace(/\t/g, '  '));
    if (!bullet) {
      out.push({ ...inlineBold(line), depth: null });
      if (line.trim()) previous = null;
      continue;
    }
    const depth = Math.min(Math.floor(bullet[1].length / 2), previous === null ? 0 : previous + 1);
    out.push({ ...inlineBold(bullet[2]), depth });
    previous = depth;
  }
  return out;
}

// 앞뒤 공백을 뺀 굵은 범위만 `**`로 감싼다. 붙어 있거나 겹치는 범위는 하나로 합친다.
function markBold(text: string, bold: BoldRange[]): string {
  const ranges: BoldRange[] = [];
  for (const range of [...bold].sort((a, b) => a.start - b.start)) {
    let start = Math.max(0, range.start), end = Math.min(text.length, range.end);
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    if (end <= start) continue;
    const last = ranges[ranges.length - 1];
    if (last && start <= last.end) last.end = Math.max(last.end, end);
    else ranges.push({ start, end });
  }
  let out = '', cursor = 0;
  for (const range of ranges) {
    out += `${text.slice(cursor, range.start)}**${text.slice(range.start, range.end)}**`;
    cursor = range.end;
  }
  return out + text.slice(cursor);
}

export function serializeRichText(paragraphs: RichParagraph[]): string {
  return paragraphs.map(p => {
    const body = markBold(p.text, p.bold);
    return p.depth === null || !p.text.trim() ? body : `${'\t'.repeat(p.depth)}- ${body}`;
  }).join('\n');
}

// ── 편집 동작 ────────────────────────────────────────────
// 편집기의 줄 나누기·합치기·붙여 넣기·굵게·목록 단계는 이 함수들로 문서를 새로 만든다(입력 문서는 바꾸지 않는다).

// 문단 번호와 그 문단 안의 글자 위치
export interface RichPos { block: number; offset: number }
export const MAX_DEPTH = 8;

const comparePos = (a: RichPos, b: RichPos) => a.block - b.block || a.offset - b.offset;
export function orderPos(a: RichPos, b: RichPos): [RichPos, RichPos] { return comparePos(a, b) <= 0 ? [a, b] : [b, a]; }

function clipBold(bold: BoldRange[], start: number, end: number): BoldRange[] {
  return bold.map(r => ({ start: Math.max(r.start, start) - start, end: Math.min(r.end, end) - start })).filter(r => r.end > r.start);
}

// 붙어 있거나 겹치는 굵은 범위를 하나로 합친다.
function mergeBold(bold: BoldRange[]): BoldRange[] {
  const out: BoldRange[] = [];
  for (const r of [...bold].sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else if (r.end > r.start) out.push({ ...r });
  }
  return out;
}

export function sliceParagraph(p: RichParagraph, start: number, end = p.text.length): RichParagraph {
  return { text: p.text.slice(start, end), depth: p.depth, bold: clipBold(p.bold, start, end) };
}

// 앞 문단의 목록 단계를 따른다.
function joinParagraphs(a: RichParagraph, b: RichParagraph): RichParagraph {
  const shift = a.text.length;
  return { text: a.text + b.text, depth: a.depth, bold: mergeBold([...a.bold, ...b.bold.map(r => ({ start: r.start + shift, end: r.end + shift }))]) };
}

// 고른 범위를 지운다. 여러 문단에 걸치면 첫 문단에 마지막 문단의 나머지를 붙인다.
export function deleteRange(doc: RichParagraph[], a: RichPos, b: RichPos): { doc: RichParagraph[]; at: RichPos } {
  const [from, to] = orderPos(a, b);
  const joined = joinParagraphs(sliceParagraph(doc[from.block], 0, from.offset), sliceParagraph(doc[to.block], to.offset));
  return { doc: [...doc.slice(0, from.block), joined, ...doc.slice(to.block + 1)], at: from };
}

// 붙여 넣기: 고른 범위를 지우고 문단들을 넣는다. 첫 문단은 커서 앞 글에, 마지막 문단은 커서 뒤 글에 이어진다.
// 커서 앞이 비어 있으면 붙여 넣은 첫 문단의 목록 단계를 쓴다.
export function insertParagraphs(doc: RichParagraph[], a: RichPos, b: RichPos, paragraphs: RichParagraph[]): { doc: RichParagraph[]; at: RichPos } {
  const removed = deleteRange(doc, a, b);
  const at = removed.at;
  if (!paragraphs.length) return removed;
  const current = removed.doc[at.block];
  const before = sliceParagraph(current, 0, at.offset), after = sliceParagraph(current, at.offset);
  const first = joinParagraphs(before.text ? before : { ...before, depth: paragraphs[0].depth }, paragraphs[0]);
  const inserted = paragraphs.length === 1 ? [first] : [first, ...paragraphs.slice(1)];
  const last = inserted.length - 1;
  const caret = { block: at.block + last, offset: inserted[last].text.length };
  inserted[last] = joinParagraphs(inserted[last], after);
  return { doc: [...removed.doc.slice(0, at.block), ...inserted, ...removed.doc.slice(at.block + 1)], at: caret };
}

// Enter: 커서 자리에서 문단을 나눈다. 새 문단은 같은 목록 단계다. 빈 목록 항목에서 누르면 글머리표를 뗀다.
export function splitParagraph(doc: RichParagraph[], a: RichPos, b: RichPos): { doc: RichParagraph[]; at: RichPos } {
  const removed = deleteRange(doc, a, b);
  const { at } = removed;
  const current = removed.doc[at.block];
  if (current.depth !== null && !current.text) return { doc: setDepth(removed.doc, at.block, at.block, () => null), at };
  const parts = [sliceParagraph(current, 0, at.offset), sliceParagraph(current, at.offset)];
  return { doc: [...removed.doc.slice(0, at.block), ...parts, ...removed.doc.slice(at.block + 1)], at: { block: at.block + 1, offset: 0 } };
}

// 문단 처음에서 Backspace: 목록 항목이면 글머리표를 떼고, 일반 문단이면 앞 문단에 붙인다.
export function backspaceAtStart(doc: RichParagraph[], block: number): { doc: RichParagraph[]; at: RichPos } {
  if (doc[block].depth !== null) return { doc: setDepth(doc, block, block, () => null), at: { block, offset: 0 } };
  if (block === 0) return { doc, at: { block, offset: 0 } };
  return deleteRange(doc, { block: block - 1, offset: doc[block - 1].text.length }, { block, offset: 0 });
}

// 고른 문단들의 목록 단계를 바꾼다. 한 단계씩만 들어가도록 바로 앞 문단보다 한 단계 넘게 깊어지지 않게 한다.
export function setDepth(doc: RichParagraph[], from: number, to: number, next: (depth: number | null) => number | null): RichParagraph[] {
  const out = doc.map(p => ({ ...p, bold: p.bold.map(r => ({ ...r })) }));
  const limit = (i: number) => i > 0 && out[i - 1].depth !== null ? out[i - 1].depth! + 1 : 0;
  const hi = Math.max(from, to);
  for (let i = Math.min(from, to); i <= hi; i++) {
    const wanted = next(out[i].depth);
    out[i].depth = wanted === null ? null : Math.max(0, Math.min(wanted, limit(i), MAX_DEPTH));
  }
  // 앞 항목을 얕게 하거나 글머리표를 떼면 바로 뒤의 하위 항목이 단계를 건너뛰게 되므로, 이어지는 목록 항목도 같은 규칙으로 맞춘다.
  for (let i = hi + 1; i < out.length && out[i].depth !== null; i++) out[i].depth = Math.min(out[i].depth!, limit(i));
  return out;
}

export const indentDepth = (depth: number | null) => depth === null ? null : depth + 1;
export const outdentDepth = (depth: number | null) => depth === null || depth === 0 ? null : depth - 1;

// 고른 문단이 모두 목록이면 글머리표를 떼고, 아니면 모두 목록(일반 문단은 최상위)으로 만든다.
export function toggleList(doc: RichParagraph[], from: number, to: number): RichParagraph[] {
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  const allList = doc.slice(lo, hi + 1).every(p => p.depth !== null);
  return setDepth(doc, lo, hi, depth => allList ? null : depth ?? 0);
}

// 고른 범위가 모두 굵으면 굵기를 풀고, 아니면 모두 굵게 한다.
export function toggleBold(doc: RichParagraph[], a: RichPos, b: RichPos): RichParagraph[] {
  const [from, to] = orderPos(a, b);
  const span = (i: number) => ({ start: i === from.block ? from.offset : 0, end: i === to.block ? to.offset : doc[i].text.length });
  const blocks = doc.map((_, i) => i).filter(i => i >= from.block && i <= to.block && span(i).end > span(i).start);
  const covered = (p: RichParagraph, s: { start: number; end: number }) => {
    let at = s.start;
    for (const r of [...p.bold].sort((x, y) => x.start - y.start)) if (r.start <= at && r.end > at) at = r.end;
    return at >= s.end;
  };
  const allBold = blocks.length > 0 && blocks.every(i => covered(doc[i], span(i)));
  return doc.map((p, i) => {
    if (!blocks.includes(i)) return p;
    const s = span(i);
    const kept = p.bold.flatMap(r => [{ start: r.start, end: Math.min(r.end, s.start) }, { start: Math.max(r.start, s.end), end: r.end }]);
    return { ...p, bold: mergeBold(allBold ? kept : [...kept, s]) };
  });
}
