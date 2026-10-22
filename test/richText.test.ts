import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COPY } from '../src/core/copy.ts';
import { backspaceAtStart, deleteRange, insertParagraphs, parseRichText, serializeRichText, setDepth, splitParagraph, toggleBold, toggleList, type RichParagraph } from '../src/core/richText.ts';
import { readRichText, selectedTextNode, writeRichText } from '../src/figma/richText.ts';

test('목록·중첩·굵게를 읽고, 그 밖의 줄은 그대로 일반 문단으로 둔다', () => {
  const parsed = parseRichText('﻿**Policy**\r\n- 첫 항목\n  - 하위 **강조** 항목\n\t- 탭 들여쓰기\n일반 줄 - 그대로\n\n# 제목 아님\n\n');
  assert.deepEqual(parsed, [
    { text: 'Policy', depth: null, bold: [{ start: 0, end: 6 }] },
    { text: '첫 항목', depth: 0, bold: [] },
    { text: '하위 강조 항목', depth: 1, bold: [{ start: 3, end: 5 }] },
    { text: '탭 들여쓰기', depth: 1, bold: [] },
    { text: '일반 줄 - 그대로', depth: null, bold: [] },
    { text: '', depth: null, bold: [] },
    { text: '# 제목 아님', depth: null, bold: [] },
  ]);
});

test('단계를 건너뛴 들여쓰기는 바로 윗 단계의 하위로 보고, 일반 문단 뒤의 목록은 최상위부터 시작한다', () => {
  const depths = parseRichText('    - 처음부터 깊게\n- 하나\n      - 셋을 건너뜀\n문단\n  - 문단 뒤').map(p => p.depth);
  assert.deepEqual(depths, [0, 0, 1, null, 0]);
});

test('짝이 없는 **와 내용 없는 글머리표는 글자 그대로 둔다', () => {
  assert.deepEqual(parseRichText('a ** b\n-\n- '), [
    { text: 'a ** b', depth: null, bold: [] },
    { text: '-', depth: null, bold: [] },
    { text: '- ', depth: null, bold: [] },
  ]);
});

test('직렬화는 굵은 범위의 앞뒤 공백을 빼고 붙은 범위를 합치며, 다시 읽으면 같은 구조가 된다', () => {
  const text = serializeRichText([
    { text: '제목 줄', depth: null, bold: [{ start: 0, end: 2 }, { start: 2, end: 3 }] },
    { text: '항목 하나', depth: 0, bold: [{ start: 2, end: 5 }] },
    { text: '하위', depth: 2, bold: [] },
    { text: '', depth: 0, bold: [] },
  ]);
  assert.equal(text, '**제목** 줄\n- 항목 **하나**\n\t\t- 하위\n');
  assert.equal(serializeRichText(parseRichText('**제목** 줄\n- 항목 **하나**\n\t- 하위\n  - 공백 들여쓰기')), '**제목** 줄\n- 항목 **하나**\n\t- 하위\n\t- 공백 들여쓰기');
});

// ── 편집 동작 ─────────────────────────────────────────

const md = (doc: RichParagraph[]) => serializeRichText(doc);
const pos = (block: number, offset: number) => ({ block, offset });

test('Enter는 같은 목록 단계로 문단을 나누고 굵기를 나눠 가지며, 빈 목록 항목에서는 글머리표를 뗀다', () => {
  const doc = parseRichText('- 앞**굵은**뒤');
  const split = splitParagraph(doc, pos(0, 2), pos(0, 2));
  assert.equal(md(split.doc), '- 앞**굵**\n- **은**뒤');
  assert.deepEqual(split.at, pos(1, 0));
  const exit = splitParagraph([{ text: '', depth: 1, bold: [] }], pos(0, 0), pos(0, 0));
  assert.deepEqual(exit.doc.map(p => p.depth), [null]);
});

test('여러 문단에 걸친 선택을 지우면 첫 문단에 마지막 문단의 나머지를 붙이고 첫 문단의 단계를 따른다', () => {
  const result = deleteRange(parseRichText('- 하나\n둘\n\t\t- 셋**넷**'), pos(0, 1), pos(2, 1));
  assert.equal(md(result.doc), '- 하**넷**');
  assert.deepEqual(result.at, pos(0, 1));
});

test('문단 처음의 Backspace는 목록이면 글머리표를 떼고, 일반 문단이면 앞 문단에 붙인다', () => {
  const doc = parseRichText('첫 줄\n- 항목\n일반');
  assert.equal(md(backspaceAtStart(doc, 1).doc), '첫 줄\n항목\n일반');
  const merged = backspaceAtStart(doc, 2);
  assert.equal(md(merged.doc), '첫 줄\n- 항목일반');
  assert.deepEqual(merged.at, pos(1, 2));
  assert.equal(md(backspaceAtStart(parseRichText('맨 앞'), 0).doc), '맨 앞');
});

test('붙여 넣은 여러 문단은 커서 앞뒤 글에 이어지고, 커서 앞이 비었으면 붙여 넣은 첫 문단의 단계를 쓴다', () => {
  const doc = parseRichText('앞뒤');
  const pasted = parseRichText('**가**\n- 나\n\t- 다');
  const result = insertParagraphs(doc, pos(0, 1), pos(0, 1), pasted);
  assert.equal(md(result.doc), '앞**가**\n- 나\n\t- 다뒤');
  assert.deepEqual(result.at, pos(2, 1));
  assert.equal(md(insertParagraphs(parseRichText('끝'), pos(0, 0), pos(0, 0), parseRichText('- 목록\n둘')).doc), '- 목록\n둘끝');
});

test('Tab은 바로 앞 문단보다 한 단계까지만 들어가고, Shift+Tab은 최상위에서 글머리표를 뗀다', () => {
  const doc = parseRichText('- 하나\n- 둘\n- 셋');
  const deeper = setDepth(doc, 1, 2, d => d === null ? 0 : d + 1);
  assert.deepEqual(deeper.map(p => p.depth), [0, 1, 1]);
  assert.deepEqual(setDepth(deeper, 2, 2, d => d === null ? 0 : d + 1).map(p => p.depth), [0, 1, 2]);
  assert.deepEqual(setDepth(doc, 0, 0, d => d === null ? 0 : d + 1).map(p => p.depth), [0, 0, 0], '첫 문단은 최상위');
  assert.deepEqual(setDepth(parseRichText('일반'), 0, 0, d => d === null ? 0 : d + 1).map(p => p.depth), [0], '일반 문단은 목록이 된다');
  assert.equal(doc[1].depth, 0, '입력 문서는 바꾸지 않는다');
});

test('앞 항목을 얕게 하거나 글머리표를 떼면 바로 뒤 하위 항목도 한 단계까지만 깊게 맞춘다', () => {
  const doc = parseRichText('- A\n\t- B\n\t\t- C\n\t\t\t- D\n\n\t- E');
  assert.deepEqual(setDepth(doc, 1, 1, d => d === null || d === 0 ? null : d - 1).map(p => p.depth), [0, 0, 1, 2, null, 1], 'stops at the blank line');
  assert.deepEqual(backspaceAtStart(doc, 0).doc.map(p => p.depth), [null, 0, 1, 2, null, 1]);
  assert.deepEqual(toggleList(doc, 0, 0).map(p => p.depth), [null, 0, 1, 2, null, 1]);
});

test('목록 버튼은 고른 문단이 모두 목록이면 글머리표를 떼고, 아니면 모두 목록으로 만든다', () => {
  const doc = parseRichText('- 하나\n둘');
  assert.deepEqual(toggleList(doc, 0, 1).map(p => p.depth), [0, 0]);
  assert.deepEqual(toggleList(toggleList(doc, 0, 1), 1, 0).map(p => p.depth), [null, null]);
});

test('굵게는 고른 범위가 모두 굵으면 풀고, 아니면 모두 굵게 하며 여러 문단에 걸쳐도 된다', () => {
  const doc = parseRichText('가**나다**\n라마');
  const on = toggleBold(doc, pos(0, 0), pos(1, 1));
  assert.equal(md(on), '**가나다**\n**라**마');
  assert.equal(md(toggleBold(on, pos(0, 1), pos(0, 2))), '**가**나**다**\n**라**마');
  assert.equal(md(toggleBold(on, pos(1, 1), pos(0, 0))), '가나다\n라마', '거꾸로 고른 선택도 같다');
});

// ── Figma 텍스트 레이어 ──────────────────────────────────

type Font = { family: string; style: string };
type Char = { font: Font; list: 'NONE' | 'UNORDERED' | 'ORDERED'; indent: number };
const MIXED = Symbol('mixed');

// 글자별 서식을 가진 텍스트 레이어. characters를 바꾸면 Figma처럼 첫 글자의 서식으로 채운다.
class FakeText {
  type = 'TEXT';
  name = 'Body';
  hasMissingFont = false;
  chars: Char[] = [];
  text = '';
  loaded: Set<string>;
  constructor(loaded: Set<string>, text: string, font: Font) {
    this.loaded = loaded;
    this.text = text;
    this.chars = [...text].map(() => ({ font, list: 'NONE', indent: 0 }));
    this.base = font;
  }
  base: Font;
  get fontName() { return this.chars[0]?.font ?? this.base; }
  get characters() { return this.text; }
  set characters(value: string) {
    for (const c of this.chars) assert.ok(this.loaded.has(key(c.font)), `불러오지 않은 글꼴: ${key(c.font)}`);
    const first = this.chars[0] ?? { font: this.base, list: 'NONE', indent: 0 };
    this.text = value;
    this.chars = [...value].map(() => ({ ...first }));
  }
  private range(start: number, end: number) { assert.ok(start < end && end <= this.text.length, `범위 ${start}-${end}`); return this.chars.slice(start, end); }
  setRangeFontName(start: number, end: number, font: Font) { assert.ok(this.loaded.has(key(font))); this.range(start, end).forEach(c => (c.font = font)); }
  setRangeListOptions(start: number, end: number, options: { type: Char['list'] }) { this.range(start, end).forEach(c => (c.list = options.type)); }
  setRangeIndentation(start: number, end: number, indent: number) { this.range(start, end).forEach(c => (c.indent = indent)); }
  getRangeListOptions(start: number, end: number) { const v = new Set(this.range(start, end).map(c => c.list)); return v.size > 1 ? MIXED : { type: [...v][0] }; }
  getRangeIndentation(start: number, end: number) { const v = new Set(this.range(start, end).map(c => c.indent)); return v.size > 1 ? MIXED : [...v][0]; }
  getStyledTextSegments() {
    const out: { start: number; end: number; fontName: Font }[] = [];
    this.chars.forEach((c, i) => {
      const last = out[out.length - 1];
      if (last && key(last.fontName) === key(c.font)) last.end = i + 1;
      else out.push({ start: i, end: i + 1, fontName: c.font });
    });
    return out;
  }
}
const key = (f: Font) => `${f.family}/${f.style}`;

function setup(available: string[], selection: unknown[] = []) {
  const loaded = new Set<string>();
  (globalThis as any).figma = {
    mixed: MIXED,
    currentPage: { selection },
    async loadFontAsync(font: Font) {
      if (!available.includes(key(font))) throw new Error('missing');
      loaded.add(key(font));
    },
  };
  return loaded;
}

test('선택이 텍스트 레이어 하나가 아니면 오류를 낸다', () => {
  setup([], []);
  assert.throws(() => selectedTextNode(), { message: COPY.figmaText001 });
  setup([], [{ type: 'FRAME' }]);
  assert.throws(() => selectedTextNode(), { message: COPY.figmaText001 });
});

test('레이어 글꼴은 그대로 두고 목록·들여쓰기·굵기만 적용하며, 다시 읽으면 입력과 같다', async () => {
  const loaded = setup(['Pretendard/Medium', 'Pretendard/Bold']);
  const node = new FakeText(loaded, '이전 내용', { family: 'Pretendard', style: 'Medium' });
  const source = '**정책**\n- 항목\n\t- 하위 **굵게**\n\n끝';
  await writeRichText(node as unknown as TextNode, parseRichText(source));
  assert.equal(node.characters, '정책\n항목\n하위 굵게\n\n끝');
  assert.deepEqual(node.chars.map(c => c.indent), [0, 0, 0, 1, 1, 0, 2, 2, 2, 2, 2, 0, 0, 0]);
  assert.equal(node.chars[3].list, 'UNORDERED');
  assert.equal(node.chars[12].list, 'NONE');
  assert.deepEqual(node.getStyledTextSegments().map(s => [s.start, s.end, s.fontName.style]),
    [[0, 2, 'Bold'], [2, 9, 'Medium'], [9, 11, 'Bold'], [11, 14, 'Medium']]);
  assert.equal(serializeRichText(readRichText(node as unknown as TextNode)), source);
});

test('Bold가 없으면 SemiBold를 쓰고, 굵은 스타일이 없거나 글꼴을 못 불러오면 레이어를 바꾸지 않는다', async () => {
  let loaded = setup(['Noto Sans KR/Regular', 'Noto Sans KR/SemiBold']);
  let node = new FakeText(loaded, '본문', { family: 'Noto Sans KR', style: 'Regular' });
  await writeRichText(node as unknown as TextNode, parseRichText('**굵게**'));
  assert.equal(node.chars[0].font.style, 'SemiBold');

  loaded = setup(['Plain/Regular']);
  node = new FakeText(loaded, '본문', { family: 'Plain', style: 'Regular' });
  await assert.rejects(writeRichText(node as unknown as TextNode, parseRichText('- 새 내용')), { message: `${COPY.figmaText004} Plain` });
  assert.equal(node.characters, '본문');

  loaded = setup([]);
  node = new FakeText(loaded, '본문', { family: 'Gone', style: 'Regular' });
  await assert.rejects(writeRichText(node as unknown as TextNode, parseRichText('새 내용')), { message: `${COPY.figmaText003} Gone Regular` });
  assert.equal(node.characters, '본문');
  node.hasMissingFont = true;
  await assert.rejects(writeRichText(node as unknown as TextNode, parseRichText('새 내용')), { message: COPY.figmaText002 });
});

test('전체가 굵은 레이어는 같은 계열의 Regular를 본문으로 쓴다', async () => {
  const loaded = setup(['Inter/Bold', 'Inter/Regular']);
  const node = new FakeText(loaded, '제목', { family: 'Inter', style: 'Bold' });
  await writeRichText(node as unknown as TextNode, parseRichText('본문 **굵게**'));
  assert.deepEqual(node.getStyledTextSegments().map(s => s.fontName.style), ['Regular', 'Bold']);
});
