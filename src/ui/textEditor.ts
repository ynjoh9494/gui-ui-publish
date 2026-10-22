import { COPY } from '../core/copy.ts';
import type { SelectionTarget } from '../core/description.ts';
import {
  backspaceAtStart, deleteRange, insertParagraphs, orderPos, outdentDepth, parseRichText, serializeRichText, setDepth, sliceParagraph,
  splitParagraph, toggleBold, toggleList, type RichParagraph, type RichPos,
} from '../core/richText.ts';

// 텍스트 편집 탭(2026-10-22 사용자 요청: STB Description Formatter를 UI Flipbook의 탭으로 옮기고 서식을 중첩 목록·굵게로 줄인다).
// 글머리표와 굵은 글씨가 그대로 보이는 편집기다(같은 날 요청: 일반 텍스트 입력창 대신). Tab·Shift+Tab으로 목록 단계, Ctrl+B로 굵게,
// 줄 처음에 `- `를 치면 목록이 된다. 붙여 넣은 글은 core/richText.ts의 텍스트 형식(`- `·탭·`**`)으로 읽는다.
// 글자 입력(한글 조합 포함)은 브라우저에 맡기고, 문단 구조를 바꾸는 동작(줄 나누기·합치기·붙여 넣기·굵게·목록 단계·되돌리기)은
// 문서 모델로 계산해 다시 그린다. 불러오기·적용은 버튼으로만 하며 입력 내용은 탭을 오가도 남는다.

export interface TextEditor {
  render(open: boolean): void;
  paragraphs(): RichParagraph[];
  setParagraphs(paragraphs: RichParagraph[]): void;
  // 지금 선택의 불러오기·적용 대상
  setTarget(target: SelectionTarget): void;
}

type Selection2 = { anchor: RichPos; focus: RichPos };
type Snapshot = { doc: RichParagraph[]; sel: Selection2 | null };

const EMPTY = (): RichParagraph[] => [{ text: '', depth: null, bold: [] }];
const BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE']);
// 글자를 이어 치는 동안은 되돌리기 단계를 하나로 묶는다.
const TYPING_GROUP_MS = 800;
const HISTORY_LIMIT = 200;

// 「• 목록」 버튼 아이콘
const LIST_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/></svg>';

function esc(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function paragraphHtml(p: RichParagraph): string {
  let html = '', cursor = 0;
  for (const r of [...p.bold].sort((a, b) => a.start - b.start)) {
    html += `${esc(p.text.slice(cursor, r.start))}<b>${esc(p.text.slice(r.start, r.end))}</b>`;
    cursor = r.end;
  }
  html += esc(p.text.slice(cursor));
  const depth = p.depth === null ? '' : ` data-depth="${p.depth}" style="--depth:${p.depth}"`;
  return `<div class="rt-p"${depth}>${html || '<br>'}</div>`;
}

const clone = (doc: RichParagraph[]) => doc.map(p => ({ ...p, bold: p.bold.map(r => ({ ...r })) }));
const hasText = (doc: RichParagraph[]) => doc.some(p => p.text.trim());

export function textEditor(root: HTMLElement): TextEditor {
  let doc = EMPTY();
  let history: Snapshot[] = [];
  let future: Snapshot[] = [];
  let lastTyping = 0;
  let composing = false;

  const editorEl = () => root.querySelector<HTMLElement>('.text-view .rich-editor');

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
          const weight = Number(getComputedStyle(child.parentElement!).fontWeight) || 400;
          if (text && weight >= 600) current.bold.push({ start, end: current.text.length });
        } else if (child instanceof HTMLElement) {
          if (BLOCK_TAGS.has(child.tagName)) {
            if (!top || child.tagName !== 'DIV' || !child.classList.contains('rt-p')) canonical = false;
            const own = child.dataset.depth !== undefined ? Number(child.dataset.depth) : depth;
            current = { text: '', depth: Number.isFinite(own) ? own : null, bold: [] };
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
    el.innerHTML = doc.map(paragraphHtml).join('');
    syncButtons();
  }

  // ── 문서 바꾸기 ────────────────────────────────────────

  function snapshot(sel: Selection2 | null) {
    history.push({ doc: clone(doc), sel });
    if (history.length > HISTORY_LIMIT) history.shift();
    future = [];
  }

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

  // 「굵게」·「목록」 버튼 눌림 표시: 커서 자리의 굵기, 고른 문단이 모두 목록인가
  function syncButtons() {
    const el = editorEl();
    if (!el) return;
    const sel = document.activeElement === el ? selection(el) : null;
    const boldOn = !!sel && document.queryCommandState('bold');
    const listOn = !!sel && (() => { const [from, to] = blocksOf(sel); return doc.slice(from, to + 1).every(p => p.depth !== null); })();
    root.querySelector('[data-rt="bold"]')?.setAttribute('aria-pressed', String(boldOn));
    root.querySelector('[data-rt="list"]')?.setAttribute('aria-pressed', String(listOn));
    root.querySelector('[data-action="text-apply"]')?.toggleAttribute('disabled', !hasText(doc));
  }

  // 대상: 플립북 「제목」 / 텍스트 레이어 「이름」. 대상이 없으면 무엇을 골라야 하는지, 오류면 그 이유를 보여 준다.
  let target: SelectionTarget = { kind: 'none' };
  function paintTarget() {
    const note = root.querySelector<HTMLElement>('.text-view .text-target');
    if (!note) return;
    note.classList.toggle('bad', target.kind === 'error');
    note.textContent = target.kind === 'description' ? `${COPY.uiApp327} ${COPY.uiApp328} 「${target.name}」`
      : target.kind === 'text' ? `${COPY.uiApp327} ${COPY.uiApp329} 「${target.name}」`
      : target.kind === 'error' ? target.message : COPY.uiApp307;
  }

  function build(view: HTMLElement) {
    view.innerHTML = `<div class="text-tools">
        <button class="text-tool" data-rt="bold" aria-pressed="false" title="${COPY.uiApp309} (Ctrl+B)" aria-label="${COPY.uiApp309}"><b>B</b></button>
        <button class="text-tool" data-rt="list" aria-pressed="false" title="${COPY.uiApp310}" aria-label="${COPY.uiApp310}">${LIST_ICON}</button>
        <span class="note">${COPY.uiApp304}</span></div>
      <div class="rich-editor" contenteditable="true" role="textbox" aria-multiline="true" spellcheck="false" aria-label="${COPY.uiApp308}"></div>
      <div class="text-actions"><span class="note text-target" aria-live="polite"></span>
        <button data-action="text-import">${COPY.uiApp305}</button>
        <button class="primary" data-action="text-apply">${COPY.uiApp306}</button></div>`;
    const el = view.querySelector<HTMLElement>('.rich-editor')!;
    paint(el);
    paintTarget();
    // 버튼을 눌러도 편집기의 선택을 잃지 않게 한다.
    for (const button of view.querySelectorAll<HTMLElement>('[data-rt]')) {
      button.addEventListener('mousedown', ev => ev.preventDefault());
      button.addEventListener('click', () => { el.focus(); if (button.dataset.rt === 'bold') bold(el); else list(el); });
    }
    el.addEventListener('beforeinput', ev => onBeforeInput(el, ev as InputEvent));
    el.addEventListener('input', () => onInput(el));
    el.addEventListener('compositionstart', () => { composing = true; });
    el.addEventListener('compositionend', () => { composing = false; onInput(el); });
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

  return {
    render(open) {
      root.classList.toggle('texting-mode', open);
      let view = root.querySelector<HTMLElement>('.text-view');
      if (!open) { view?.remove(); return; }
      // 이미 열려 있으면 다시 그리지 않는다(입력 중인 커서·스크롤 유지).
      if (view) return;
      view = document.createElement('div');
      view.className = 'text-view';
      root.appendChild(view);
      build(view);
    },
    paragraphs() {
      const el = editorEl();
      if (el) sync(el);
      return clone(doc);
    },
    setTarget(next) { target = next; paintTarget(); },
    // 불러오기: 지금 내용은 되돌리기 단계로 남긴다.
    setParagraphs(paragraphs) {
      const el = editorEl();
      if (el) sync(el);
      snapshot(null);
      doc = paragraphs.length ? clone(paragraphs) : EMPTY();
      if (el) { paint(el); el.scrollTop = 0; }
    },
  };
}
