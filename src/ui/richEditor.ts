import { COPY } from '../core/copy.ts';
import { cloneLayout, DEFAULT_TEXT_LAYOUT, type TextLayout } from '../core/description.ts';
import { esc } from './html.ts';
import {
  backspaceAtStart, deleteRange, insertParagraphs, insertSpacer, orderPos, outdentDepth, parseRichText, serializeRichText, setDepth, sliceParagraph,
  splitParagraph, toggleBold, toggleRed, isRed, toggleList, type RichParagraph, type RichPos,
} from '../core/richText.ts';

// 서식 편집기(2026-10-22 사용자 요청으로 텍스트 편집 탭에 만들고, 2026-11-04 플립북 상세의 Description 영역에서도 쓰도록 분리했다.
// 텍스트 편집 탭은 나중에 없앤다(같은 날 사용자 결정). 탭과 Description 영역이 이 편집기를 각자 하나씩 붙인다).
// 목록 종류와 굵은 글씨가 그대로 보이는 편집기다. Tab·Shift+Tab으로 목록 단계, Ctrl+B로 굵게,
// 줄 처음에 `- `를 치면 목록이 된다. 붙여 넣은 글은 core/richText.ts의 텍스트 형식(`- `·탭·`**`)으로 읽는다.
// 글자 입력(한글 조합 포함)은 브라우저에 맡기고, 문단 구조를 바꾸는 동작(줄 나누기·합치기·붙여 넣기·굵게·목록 단계·되돌리기)은
// 문서 모델로 계산해 다시 그린다. 「---」만 있는 줄은 여백(빈 프레임)으로 넣으며 편집기에서는 일반 글자 「---」 그대로 보인다.
// 위 줄의 기본 버튼(굵게·빨간 글씨·목록·여백) 오른쪽에 서식 도구를 접어 두고, 펼치면 아래에 속성 패널이 나온다.

export interface RichEditor {
  // 서식 줄과 편집기를 담은 요소. 다시 그리는 화면은 이 요소를 떼었다 붙인다(입력 중인 내용·되돌리기 유지).
  el: HTMLElement;
  paragraphs(): RichParagraph[];
  // reset: 되돌리기 단계를 비운다(다른 플립북의 내용으로 바꿀 때). 아니면 지금 내용을 되돌리기 단계로 남긴다.
  setParagraphs(paragraphs: RichParagraph[], reset?: boolean): void;
  layout(): TextLayout;
  setLayout(layout: TextLayout): void;
}

type Selection2 = { anchor: RichPos; focus: RichPos };
type Snapshot = { doc: RichParagraph[]; sel: Selection2 | null };

const EMPTY = (): RichParagraph[] => [{ text: '', depth: null, bold: [] }];
const BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE']);
// 글자를 이어 치는 동안은 되돌리기 단계를 하나로 묶는다.
const TYPING_GROUP_MS = 800;
const HISTORY_LIMIT = 200;

// 「• 목록」 버튼 아이콘
// 「여백」 버튼 아이콘: 가운데 가로선 하나, 위에 위쪽 chevron, 아래에 아래쪽 chevron(2026-11-04 사용자 요청)
const SPACER_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h16"/><path d="m8 7 4-4 4 4"/><path d="m8 17 4 4 4-4"/></svg>';
// 서식 도구 펼치기 아이콘(슬라이더)
const LAYOUT_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>';
const LIST_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/></svg>';
const LETTER_SPACING_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 10 3-8 3 8M6 7h4M2 13h12m-2-2 2 2-2 2M4 11l-2 2 2 2"/></svg>';
const LINE_HEIGHT_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 2v12m-2-2 2 2 2-2M1 4l2-2 2 2m3 7 3-8 3 8M9 8h4M7 14h8"/></svg>';
const FIELD_ICONS: Record<string, string> = {
  fontSize: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" aria-hidden="true"><path d="M3 4V2h10v2M8 2v12M5 14h6"/></svg>',
  letterSpacing: LETTER_SPACING_ICON,
  lineHeight: LINE_HEIGHT_ICON,
  listSpacing: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h8M6 8h8M6 13h8M2 4v8m-1-1 1 1 1-1M1 5l1-1 1 1"/></svg>',
};


function paragraphHtml(p: RichParagraph, marker: string): string {
  const cuts = [...new Set([0, p.text.length, ...p.bold.flatMap(r => [r.start, r.end]), ...(p.red ?? []).flatMap(r => [r.start, r.end])])].sort((a, b) => a - b);
  let html = '';
  for (let i = 0; i < cuts.length - 1; i++) {
    const start = cuts[i], end = cuts[i + 1];
    let part = esc(p.text.slice(start, end));
    if (p.bold.some(r => r.start <= start && r.end >= end)) part = `<b>${part}</b>`;
    if ((p.red ?? []).some(r => r.start <= start && r.end >= end)) part = `<span style="color:#D63434">${part}</span>`;
    html += part;
  }
  const depth = p.depth === null ? '' : ` data-depth="${p.depth}" data-marker="${esc(marker)}"${p.list === 'ORDERED' ? ' data-list="ORDERED"' : ''}${p.number !== undefined ? ` data-number="${p.number}"` : ''} style="--depth:${p.depth}"`;
  return `<div class="rt-p"${depth}>${html || '<br>'}</div>`;
}

const clone = (doc: RichParagraph[]) => doc.map(p => ({ ...p, bold: p.bold.map(r => ({ ...r })), ...(p.red ? { red: p.red.map(r => ({ ...r })) } : {}) }));
const hasText = (doc: RichParagraph[]) => doc.some(p => p.text.trim());

// 서식 도구 칸: [키, 이름]. Padding은 시계 방향(위·오른쪽·아래·왼쪽) 네 칸이다.
type LayoutKey = 'fontSize' | 'letterSpacing' | 'lineHeight' | 'listSpacing' | 'spacer';
const LAYOUT_FIELDS: [LayoutKey, string, string][] = [
  ['fontSize', COPY.textFontSize, ''], ['letterSpacing', COPY.textLetterSpacing, '%'], ['lineHeight', COPY.textLineHeight, '%'],
  ['listSpacing', COPY.textListSpacing, ''], ['spacer', COPY.textSpacerHeight, ''],
];
const PADDING_SIDES = [COPY.textPaddingTop, COPY.textPaddingRight, COPY.textPaddingBottom, COPY.textPaddingLeft];

// onChange: 내용이나 서식 값이 바뀔 때마다(글자 입력 포함) 부른다.
export function richEditor(options: { label: string; onChange?: () => void }): RichEditor {
  const view = document.createElement('div');
  view.className = 'rich-block';
  let layout = cloneLayout(DEFAULT_TEXT_LAYOUT);
  let layoutOpen = false;
  const editorEl = () => view.querySelector<HTMLElement>('.rich-editor');
  const changed = () => options.onChange?.();

  let doc = EMPTY();
  let history: Snapshot[] = [];
  let future: Snapshot[] = [];
  let lastTyping = 0;
  let composing = false;
  let compositionBefore: Snapshot | null = null;


  // ── 화면 ↔ 문서 ───────────────────────────────────────

  // 편집기 DOM을 문서로 읽는다. 바깥 블록 요소마다 한 문단이고, 굵기는 화면에 보이는 글자 굵기로 판단한다.
  // probes: 함께 문서 위치로 바꿀 DOM 위치(선택 영역의 양 끝)
  function read(el: HTMLElement, probes: { node: Node; offset: number }[] = []): { doc: RichParagraph[]; positions: (RichPos | null)[]; canonical: boolean } {
    const out: RichParagraph[] = [];
    const positions: (RichPos | null)[] = probes.map(() => null);
    let current: RichParagraph | null = null;
    let canonical = true;
    const here = (): RichPos => current ? { block: out.length - 1, offset: current.text.length } : { block: out.length, offset: 0 };
    const mark = (node: Node, offset: number) => probes.forEach((p, i) => { if (p.node === node && p.offset === offset) positions[i] = here(); });
    const walk = (node: Node, depth: number | null, top: boolean) => {
      node.childNodes.forEach((child, i) => {
        mark(node, i);
        if (child.nodeType === Node.TEXT_NODE) {
          const text = (child as Text).data.replace(/ /g, ' ').replace(/[\r\n]/g, ' ');
          if (top) canonical = false;
          if (!current) { current = { text: '', depth, bold: [] }; out.push(current); }
          const start: number = current.text.length;
          probes.forEach((p, k) => { if (p.node === child) positions[k] = { block: out.length - 1, offset: start + Math.min(p.offset, text.length) }; });
          current.text += text;
          const rgb = getComputedStyle(child.parentElement!).color.match(/[\d.]+/g)?.map(Number);
          if (text && rgb && isRed({ r: rgb[0] / 255, g: rgb[1] / 255, b: rgb[2] / 255 })) (current.red ??= []).push({ start, end: current.text.length });
          const weight = getComputedStyle(child.parentElement!).fontWeight;
          const markedBold = !!child.parentElement?.closest('b, strong');
          if (text && (markedBold || weight === 'bold' || Number(weight) >= 600)) current.bold.push({ start, end: current.text.length });
        } else if (child instanceof HTMLElement) {
          if (BLOCK_TAGS.has(child.tagName)) {
            if (!top || child.tagName !== 'DIV' || !child.classList.contains('rt-p')) canonical = false;
            const own = child.dataset.depth !== undefined ? Number(child.dataset.depth) : depth;
            current = { text: '', depth: Number.isFinite(own) ? own : null, ...(child.dataset.list === 'ORDERED' ? { list: 'ORDERED' as const } : {}), ...(child.dataset.number !== undefined ? { number: Number(child.dataset.number) } : {}), bold: [] };
            out.push(current);
            walk(child, current.depth, false);
            current = null;
          } else {
            if (top) canonical = false;
            if (child.tagName !== 'BR') walk(child, depth, false);
          }
        }
      });
      mark(node, node.childNodes.length);
    };
    walk(el, null, true);
    if (!out.length) out.push(...EMPTY());
    const last = out.length - 1;
    const clamp = (p: RichPos | null) => p && (p.block > last ? { block: last, offset: out[last].text.length } : { block: p.block, offset: Math.min(p.offset, out[p.block].text.length) });
    // 굵은 범위가 이어지면 합친다(글자 노드가 나뉘어 있어도 같은 범위).
    for (const p of out) p.bold = p.bold.reduce<{ start: number; end: number }[]>((acc, r) => {
      const prev = acc[acc.length - 1];
      if (prev && prev.end >= r.start) prev.end = Math.max(prev.end, r.end); else acc.push({ ...r });
      return acc;
    }, []);
    return { doc: out, positions: positions.map(clamp), canonical };
  }

  function selection(el: HTMLElement): Selection2 | null {
    const sel = document.getSelection();
    if (!sel || !sel.anchorNode || !sel.focusNode || !el.contains(sel.anchorNode) || !el.contains(sel.focusNode)) return null;
    const { positions } = read(el, [{ node: sel.anchorNode, offset: sel.anchorOffset }, { node: sel.focusNode, offset: sel.focusOffset }]);
    return positions[0] && positions[1] ? { anchor: positions[0], focus: positions[1] } : null;
  }

  // 그린 편집기(문단마다 div 하나)에서 문서 위치를 DOM 위치로 바꾼다.
  function domPoint(el: HTMLElement, pos: RichPos): { node: Node; offset: number } {
    const block = el.children[Math.min(pos.block, el.children.length - 1)];
    if (!block) return { node: el, offset: 0 };
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let left = pos.offset;
    let last: Text | null = null;
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      if (left <= node.data.length) return { node, offset: left };
      left -= node.data.length;
      last = node;
    }
    return last ? { node: last, offset: last.data.length } : { node: block, offset: 0 };
  }

  function select(el: HTMLElement, sel: Selection2 | null) {
    if (!sel) return;
    const a = domPoint(el, sel.anchor), f = domPoint(el, sel.focus);
    document.getSelection()?.setBaseAndExtent(a.node, a.offset, f.node, f.offset);
  }

  function paint(el: HTMLElement) {
    const numbers: number[] = [];
    el.innerHTML = doc.map(p => {
      if (p.depth === null || !p.text.trim()) { numbers.length = 0; return paragraphHtml(p, ''); }
      numbers.length = p.depth + 1;
      numbers[p.depth] = p.list === 'ORDERED' ? p.number ?? (numbers[p.depth] ?? 0) + 1 : 0;
      return paragraphHtml(p, p.list === 'ORDERED' ? `${numbers[p.depth]}.` : '•');
    }).join('');
    syncButtons();
    changed();
  }

  // ── 문서 바꾸기 ────────────────────────────────────────

  function remember(snap: Snapshot) {
    history.push(snap);
    if (history.length > HISTORY_LIMIT) history.shift();
    future = [];
  }
  function snapshot(sel: Selection2 | null) { remember({ doc: clone(doc), sel }); }

  // 구조를 바꾸는 동작: 되돌리기 단계를 남기고 새 문서를 그린 뒤 선택을 놓는다.
  function apply(el: HTMLElement, before: Selection2 | null, next: RichParagraph[], sel: Selection2 | null) {
    snapshot(before);
    lastTyping = 0;
    doc = next;
    paint(el);
    select(el, sel);
  }

  function sync(el: HTMLElement) {
    if (!composing) doc = read(el).doc;
  }

  function restore(el: HTMLElement, from: Snapshot[], to: Snapshot[]) {
    const snap = from.pop();
    if (!snap) return;
    to.push({ doc: clone(doc), sel: selection(el) });
    doc = clone(snap.doc);
    lastTyping = 0;
    paint(el);
    select(el, snap.sel);
  }

  const caret = (at: RichPos): Selection2 => ({ anchor: at, focus: at });
  const blocksOf = (sel: Selection2) => { const [from, to] = orderPos(sel.anchor, sel.focus); return [from.block, to.block] as const; };
  const collapsed = (sel: Selection2) => sel.anchor.block === sel.focus.block && sel.anchor.offset === sel.focus.offset;

  function bold(el: HTMLElement) {
    sync(el);
    const sel = selection(el);
    if (!sel) return;
    // 커서만 있으면 다음에 칠 글자의 굵기를 바꾼다(브라우저 입력 상태).
    if (collapsed(sel)) { document.execCommand('bold'); syncButtons(); return; }
    apply(el, sel, toggleBold(doc, sel.anchor, sel.focus), sel);
  }

  function red(el: HTMLElement) {
    sync(el);
    const sel = selection(el);
    if (!sel) return;
    if (collapsed(sel)) {
      const rgb = String(document.queryCommandValue('foreColor')).match(/[\d.]+/g)?.map(Number);
      const on = rgb && isRed({ r: rgb[0] / 255, g: rgb[1] / 255, b: rgb[2] / 255 });
      document.execCommand('foreColor', false, on ? '#333333' : '#D63434');
      syncButtons();
      return;
    }
    apply(el, sel, toggleRed(doc, sel.anchor, sel.focus), sel);
  }

  function list(el: HTMLElement) {
    sync(el);
    const sel = selection(el);
    if (!sel) return;
    const [from, to] = blocksOf(sel);
    apply(el, sel, toggleList(doc, from, to), sel);
  }

  // Tab: 일반 문단은 최상위 목록이 되고 목록은 한 단계 깊어진다. Shift+Tab: 한 단계 얕아지고 최상위면 글머리표를 뗀다.
  function indent(el: HTMLElement, out: boolean) {
    sync(el);
    const sel = selection(el);
    if (!sel) return;
    const [from, to] = blocksOf(sel);
    apply(el, sel, setDepth(doc, from, to, out ? outdentDepth : depth => depth === null ? 0 : depth + 1), sel);
  }

  function selectedText(sel: Selection2): string {
    const [from, to] = orderPos(sel.anchor, sel.focus);
    const parts = doc.slice(from.block, to.block + 1).map((p, i) =>
      sliceParagraph(p, i === 0 ? from.offset : 0, from.block + i === to.block ? to.offset : p.text.length));
    return serializeRichText(parts);
  }

  // ── 이벤트 ───────────────────────────────────────────

  function onBeforeInput(el: HTMLElement, ev: InputEvent) {
    if (ev.isComposing || composing) return;
    const sel = selection(el);
    if (!sel) return;
    const type = ev.inputType;
    const multi = sel.anchor.block !== sel.focus.block;
    const [from] = orderPos(sel.anchor, sel.focus);
    const model = (result: { doc: RichParagraph[]; at: RichPos }) => { ev.preventDefault(); sync(el); apply(el, sel, result.doc, caret(result.at)); };
    if (type === 'insertParagraph' || type === 'insertLineBreak') { sync(el); model(splitParagraph(doc, sel.anchor, sel.focus)); return; }
    if (type === 'historyUndo' || type === 'historyRedo') { ev.preventDefault(); sync(el); restore(el, type === 'historyUndo' ? history : future, type === 'historyUndo' ? future : history); return; }
    if (type === 'formatBold') { ev.preventDefault(); bold(el); return; }
    // 그 밖의 서식(기울임·밑줄 등)과 드래그 앤 드롭은 받지 않는다. 붙여 넣기는 paste 이벤트에서 처리한다.
    if (type.startsWith('format') || type === 'insertFromDrop' || type === 'insertFromPaste' || type === 'insertFromYank') { ev.preventDefault(); return; }
    sync(el);
    if (type.startsWith('delete')) {
      if (multi) { model(deleteRange(doc, sel.anchor, sel.focus)); return; }
      if (collapsed(sel) && type.endsWith('Backward') && from.offset === 0) { model(backspaceAtStart(doc, from.block)); return; }
      if (collapsed(sel) && type.endsWith('Forward') && from.offset === doc[from.block].text.length) {
        if (from.block < doc.length - 1) model(deleteRange(doc, from, { block: from.block + 1, offset: 0 }));
        else ev.preventDefault();
        return;
      }
    } else if (multi && ev.data) {
      model(insertParagraphs(doc, sel.anchor, sel.focus, [{ text: ev.data, depth: null, bold: [] }]));
      return;
    }
    // 브라우저가 처리하는 글자 입력·지우기: 이어 치는 동안은 되돌리기 단계를 하나로 묶는다.
    const now = Date.now();
    if (now - lastTyping > TYPING_GROUP_MS) snapshot(sel);
    lastTyping = now;
  }

  // 글자 입력 뒤: 문서를 다시 읽고, 구조가 흐트러졌으면(브라우저가 블록을 겹친 경우 등) 다시 그린다.
  // 일반 문단 처음에 `- `·`* `를 치면 목록으로 바꾼다.
  function onInput(el: HTMLElement) {
    if (composing) return;
    const sel = selection(el);
    const result = read(el);
    doc = result.doc;
    const at = sel && collapsed(sel) ? sel.focus : null;
    const p = at ? doc[at.block] : null;
    if (at && p && p.depth === null && at.offset === 2 && /^[-*] /.test(p.text)) {
      apply(el, sel, setDepth(doc.map((x, i) => i === at.block ? sliceParagraph(x, 2) : x), at.block, at.block, () => 0), caret({ block: at.block, offset: 0 }));
    } else if (!result.canonical || !el.children.length) {
      paint(el);
      select(el, sel);
    }
    syncButtons();
  }

  function onKeyDown(el: HTMLElement, ev: KeyboardEvent) {
    if (ev.isComposing || ev.keyCode === 229) return;
    const mod = ev.ctrlKey || ev.metaKey;
    const key = ev.key.toLowerCase();
    if (ev.key === 'Tab' && !mod && !ev.altKey) { ev.preventDefault(); indent(el, ev.shiftKey); return; }
    if (!mod || ev.altKey) return;
    if (key === 'b') { ev.preventDefault(); bold(el); }
    else if (key === 'z' || key === 'y') {
      ev.preventDefault();
      sync(el);
      const redo = key === 'y' || ev.shiftKey;
      restore(el, redo ? future : history, redo ? history : future);
    } else if (key === 'i' || key === 'u') ev.preventDefault();
  }

  function onPaste(el: HTMLElement, ev: ClipboardEvent) {
    ev.preventDefault();
    sync(el);
    const sel = selection(el);
    const pasted = parseRichText(ev.clipboardData?.getData('text/plain') ?? '');
    if (!sel || !pasted.length) return;
    const result = insertParagraphs(doc, sel.anchor, sel.focus, pasted);
    apply(el, sel, result.doc, caret(result.at));
  }

  // 복사·잘라내기는 같은 텍스트 형식으로 클립보드에 넣어 편집기 안에서 붙여 넣어도 목록·굵기가 남는다.
  function onCopy(el: HTMLElement, ev: ClipboardEvent, cut: boolean) {
    sync(el);
    const sel = selection(el);
    if (!sel || collapsed(sel) || !ev.clipboardData) return;
    ev.preventDefault();
    ev.clipboardData.setData('text/plain', selectedText(sel));
    if (cut) { const result = deleteRange(doc, sel.anchor, sel.focus); apply(el, sel, result.doc, caret(result.at)); }
  }

  function spacer(el: HTMLElement) {
    sync(el);
    const sel = selection(el) ?? caret({ block: doc.length - 1, offset: doc[doc.length - 1].text.length });
    const [, to] = blocksOf(sel);
    const result = insertSpacer(doc, to);
    apply(el, sel, result.doc, caret(result.at));
  }

  // 「굵게」·「목록」 버튼 눌림 표시: 커서 자리의 굵기, 고른 문단이 모두 목록인가
  function syncButtons() {
    const el = editorEl();
    if (!el) return;
    const sel = document.activeElement === el ? selection(el) : null;
    const boldOn = !!sel && document.queryCommandState('bold');
    const listOn = !!sel && (() => { const [from, to] = blocksOf(sel); return doc.slice(from, to + 1).every(p => p.depth !== null); })();
    const rgb = sel && String(document.queryCommandValue('foreColor')).match(/[\d.]+/g)?.map(Number);
    view.querySelector('[data-rt="red"]')?.setAttribute('aria-pressed', String(!!rgb && isRed({ r: rgb[0] / 255, g: rgb[1] / 255, b: rgb[2] / 255 })));
    view.querySelector('[data-rt="bold"]')?.setAttribute('aria-pressed', String(boldOn));
    view.querySelector('[data-rt="list"]')?.setAttribute('aria-pressed', String(listOn));
  }

  const numberField = (key: string, label: string, value: number, unit = 'px', side?: number) =>
    `<label class="layout-field"><span class="layout-label" title="${esc(label)}">${esc(label)}</span><span class="layout-control">${FIELD_ICONS[key] ?? ''}<input type="number" step="any" data-layout="${key}"${side === undefined ? '' : ` data-side="${side}"`} value="${value}" aria-label="${esc(side === undefined ? label : `${COPY.textPadding} ${label}`)}"><span class="unit">${unit}</span></span></label>`;
  function layoutHtml(): string {
    return `<section class="layout-section"><h3>${COPY.textPadding}</h3><div class="layout-grid">${layout.padding.map((value, side) => numberField('padding', PADDING_SIDES[side], value, 'px', side)).join('')}</div></section>
      <section class="layout-section"><h3>${COPY.textLayout}</h3><div class="layout-grid">${LAYOUT_FIELDS.filter(([key]) => key !== 'spacer').map(([key, label, unit]) => numberField(key, label, layout[key], unit || 'px')).join('')}</div></section>
      <section class="layout-section"><h3>${COPY.textSpacing}</h3><div class="layout-grid">${numberField('gap', COPY.textGap, layout.gap)}${numberField('spacer', COPY.textSpacerHeight, layout.spacer)}</div></section>`;
  }
  function paintLayout() {
    const box = view.querySelector<HTMLElement>('.text-layout');
    const toggle = view.querySelector<HTMLElement>('[data-rt="layout"]');
    if (!box || !toggle) return;
    box.hidden = !layoutOpen;
    toggle.setAttribute('aria-expanded', String(layoutOpen));
    toggle.setAttribute('aria-pressed', String(layoutOpen));
    if (layoutOpen) box.innerHTML = layoutHtml();
  }

  function build() {
    view.innerHTML = `<div class="text-tools">
        <button class="text-tool" data-rt="bold" aria-pressed="false" title="${COPY.uiApp309} (Ctrl+B)" aria-label="${COPY.uiApp309}"><b>B</b></button>
        <button class="text-tool" data-rt="red" aria-pressed="false" title="${COPY.uiTextRed}" aria-label="${COPY.uiTextRed}"><span style="color:#D63434">A</span></button>
        <button class="text-tool" data-rt="list" aria-pressed="false" title="${COPY.uiApp310}" aria-label="${COPY.uiApp310}">${LIST_ICON}</button>
        <button class="text-tool" data-rt="spacer" title="${COPY.textSpacerHint}" aria-label="${COPY.textSpacer}">${SPACER_ICON}</button>
        <span class="text-tools-divider" aria-hidden="true"></span>
        <button class="text-tool" data-rt="layout" aria-expanded="false" aria-pressed="false" title="${COPY.textLayout}" aria-label="${COPY.textLayout}">${LAYOUT_ICON}</button>
        </div><div class="text-layout" hidden></div>
      <div class="rich-editor" contenteditable="true" role="textbox" aria-multiline="true" spellcheck="false" aria-label="${esc(options.label)}"></div>`;
    const el = view.querySelector<HTMLElement>('.rich-editor')!;
    paint(el);
    // 버튼을 눌러도 편집기의 선택을 잃지 않게 한다.
    for (const button of view.querySelectorAll<HTMLElement>('[data-rt]')) {
      const kind = button.dataset.rt;
      if (kind === 'layout') {
        button.addEventListener('click', () => { layoutOpen = !layoutOpen; paintLayout(); });
        continue;
      }
      button.addEventListener('mousedown', ev => ev.preventDefault());
      button.addEventListener('click', () => {
        el.focus();
        if (kind === 'bold') bold(el); else if (kind === 'red') red(el); else if (kind === 'spacer') spacer(el); else list(el);
      });
    }
    // 서식 칸: 숫자로 읽히는 값만 받는다. 비우거나 숫자가 아니면 이전 값을 둔다.
    view.querySelector<HTMLElement>('.text-layout')!.addEventListener('input', ev => {
      const input = ev.target as HTMLInputElement;
      const value = Number(input.value);
      if (input.value.trim() === '' || !Number.isFinite(value)) return;
      const key = input.dataset.layout;
      if (key === 'padding') layout.padding[Number(input.dataset.side)] = value;
      else if (key) (layout as unknown as Record<string, number>)[key] = value;
      changed();
    });
    el.addEventListener('beforeinput', ev => onBeforeInput(el, ev as InputEvent));
    el.addEventListener('input', () => { onInput(el); changed(); });
    el.addEventListener('compositionstart', () => {
      sync(el);
      compositionBefore = { doc: clone(doc), sel: selection(el) };
      lastTyping = 0;
      composing = true;
    });
    el.addEventListener('compositionend', () => {
      composing = false;
      // A cancelled composition must preserve redo and must not add an empty
      // undo step. Commit one snapshot only when the document actually changes.
      if (compositionBefore && JSON.stringify(read(el).doc) !== JSON.stringify(compositionBefore.doc)) remember(compositionBefore);
      compositionBefore = null;
      onInput(el);
      changed();
    });
    el.addEventListener('keydown', ev => onKeyDown(el, ev));
    el.addEventListener('paste', ev => onPaste(el, ev));
    el.addEventListener('copy', ev => onCopy(el, ev, false));
    el.addEventListener('cut', ev => onCopy(el, ev, true));
    el.addEventListener('dragover', ev => ev.preventDefault());
    el.addEventListener('drop', ev => ev.preventDefault());
    el.addEventListener('keyup', syncButtons);
    el.addEventListener('mouseup', syncButtons);
    el.addEventListener('focus', syncButtons);
    el.addEventListener('blur', syncButtons);
  }
  build();

  return {
    el: view,
    paragraphs() {
      const el = editorEl();
      if (el) sync(el);
      return clone(doc);
    },
    setParagraphs(paragraphs, reset = false) {
      const el = editorEl();
      if (el) sync(el);
      if (reset) { history = []; future = []; } else snapshot(null);
      lastTyping = 0;
      doc = paragraphs.length ? clone(paragraphs) : EMPTY();
      if (el) { paint(el); el.scrollTop = 0; }
    },
    layout: () => cloneLayout(layout),
    setLayout(next) { layout = cloneLayout(next); paintLayout(); },
  };
}
