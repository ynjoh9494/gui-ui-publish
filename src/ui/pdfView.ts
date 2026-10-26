import { PDFDocument } from 'pdf-lib';
import { COPY } from '../core/copy.ts';
import type { PdfPage, PdfSelection } from '../core/pdf.ts';

// PDF 저장 탭(2026-10-26 사용자 요청). 플러그인 본체가 프레임마다 한 쪽짜리 PDF를 캔버스 순서대로 보내면
// 여기서 한 파일로 합쳐 내려받는다. Figma API는 노드 하나씩만 PDF로 내보내므로 합치기는 UI에서 한다.

export interface PdfView {
  render(open: boolean): void;
  setSelection(selection: PdfSelection): void;
  // 내보낸 쪽을 합쳐 저장한다. 실패하면 오류를 던진다.
  save(fileName: string, pages: PdfPage[]): Promise<void>;
}

export async function mergePdfPages(pages: PdfPage[]): Promise<Uint8Array> {
  if (pages.length === 1) return pages[0].bytes;
  const out = await PDFDocument.create();
  for (const page of pages) {
    const source = await PDFDocument.load(page.bytes);
    for (const copied of await out.copyPages(source, source.getPageIndices())) out.addPage(copied);
  }
  return out.save();
}

function download(fileName: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // 내려받기가 시작되기 전에 주소를 지우지 않게 늦춘다.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function pdfView(root: HTMLElement): PdfView {
  let selection: PdfSelection = { frames: 0, others: 0 };

  function paintSelection() {
    const view = root.querySelector<HTMLElement>('.pdf-view');
    if (!view) return;
    const note = view.querySelector<HTMLElement>('.pdf-count')!;
    note.textContent = selection.frames
      ? `${COPY.pdf002} ${selection.frames}${COPY.pdf003}${selection.others ? ` · ${COPY.pdf007} ${selection.others}${COPY.pdf008}` : ''}`
      : COPY.pdf004;
    view.querySelector('[data-action="pdf-export"]')?.toggleAttribute('disabled', !selection.frames);
  }

  return {
    render(open) {
      root.classList.toggle('pdf-mode', open);
      let view = root.querySelector<HTMLElement>('.pdf-view');
      if (!open) { view?.remove(); return; }
      if (view) return;
      view = document.createElement('div');
      view.className = 'pdf-view';
      // 머리 줄: 왼쪽에 선택한 프레임 수, 오른쪽에 실행 버튼(텍스트 편집 탭과 같은 자리)
      view.innerHTML = `<div class="text-actions"><span class="note pdf-count" aria-live="polite"></span>
          <button class="primary" data-action="pdf-export">${COPY.pdf001}</button></div>
        <p class="note">${COPY.pdf009}</p>`;
      root.appendChild(view);
      paintSelection();
    },
    setSelection(next) { selection = next; paintSelection(); },
    async save(fileName, pages) { download(fileName, await mergePdfPages(pages)); },
  };
}
