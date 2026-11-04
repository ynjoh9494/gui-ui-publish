import { COPY } from '../core/copy.ts';
import type { SelectionTarget, TextLayout } from '../core/description.ts';
import type { RichParagraph } from '../core/richText.ts';
import { richEditor } from './richEditor.ts';

// 텍스트 편집 탭(2026-10-22 사용자 요청: STB Description Formatter를 UI Flipbook의 탭으로 옮겼다). 나중에 없앤다(2026-11-04 사용자 결정).
// 편집기는 richEditor.ts이고, 이 탭은 머리 줄의 대상 표시와 불러오기·적용만 더한다. 불러오기·적용은 버튼으로만 하며 입력 내용은 탭을 오가도 남는다.

export interface TextEditor {
  render(open: boolean): void;
  paragraphs(): RichParagraph[];
  layout(): TextLayout;
  // 불러오기: 지금 내용은 되돌리기 단계로 남긴다. 서식 값이 있으면 서식 도구에도 넣는다.
  setParagraphs(paragraphs: RichParagraph[], layout?: TextLayout): void;
  // 지금 선택의 불러오기·적용 대상
  setTarget(target: SelectionTarget): void;
}

const hasText = (doc: RichParagraph[]) => doc.some(p => p.text.trim());

export function textEditor(root: HTMLElement): TextEditor {
  const editor = richEditor({ label: COPY.uiApp308, onChange: syncApply });

  function syncApply() {
    root.querySelector('.text-view [data-action="text-apply"]')?.toggleAttribute('disabled', !hasText(editor.paragraphs()));
  }

  // 대상: 플립북 「제목」 / 텍스트 레이어 「이름」 / 프레임 「이름」. 대상이 없으면 무엇을 골라야 하는지, 오류면 그 이유를 보여 준다.
  let target: SelectionTarget = { kind: 'none' };
  function paintTarget() {
    const note = root.querySelector<HTMLElement>('.text-view .text-target');
    if (!note) return;
    note.classList.toggle('bad', target.kind === 'error');
    note.textContent = target.kind === 'description' ? `${COPY.uiApp327} ${COPY.uiApp328} 「${target.name}」`
      : target.kind === 'text' ? `${COPY.uiApp327} ${COPY.uiApp329} 「${target.name}」`
      : target.kind === 'frame' ? `${COPY.uiApp327} ${COPY.uiApp360} 「${target.name}」`
      : target.kind === 'error' ? target.message : COPY.uiApp307;
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
      // 머리 줄: 왼쪽에 대상, 오른쪽에 불러오기·적용(2026-10-23 사용자 요청: 하단 오른쪽 버튼을 위 오른쪽으로)
      view.innerHTML = `<div class="text-actions"><span class="note text-target" aria-live="polite"></span>
        <button data-action="text-import">${COPY.uiApp305}</button>
        <button class="primary" data-action="text-apply">${COPY.uiApp306}</button></div>
        <p class="note text-hint">${COPY.uiApp304}</p>`;
      view.appendChild(editor.el);
      root.appendChild(view);
      paintTarget();
      syncApply();
    },
    paragraphs: () => editor.paragraphs(),
    layout: () => editor.layout(),
    setTarget(next) { target = next; paintTarget(); },
    setParagraphs(paragraphs, layout) {
      editor.setParagraphs(paragraphs);
      if (layout) editor.setLayout(layout);
    },
  };
}
