import { PDFDocument } from 'pdf-lib';
import { COPY } from '../core/copy.ts';
import type { PdfPage, PdfSelection } from '../core/pdf.ts';

// PDF 저장 탭(2026-10-26 사용자 요청). 플러그인 본체가 프레임마다 JPG 한 장을 캔버스 순서대로 보내면
// 여기서 한 쪽에 한 장씩 넣은 PDF를 만들어 내려받는다. 저장하는 동안 실행 버튼 자리는 취소 버튼이 된다.

export interface PdfView {
  render(open: boolean): void;
  setSelection(selection: PdfSelection): void;
  // 내보내는 중인가. 그동안 실행 버튼 대신 취소 버튼을 보여 준다.
  setRunning(running: boolean): void;
  // 취소를 눌렀다. PDF를 만드는 중이면 다음 쪽에서 멈춘다.
  cancel(): void;
  // 받은 쪽으로 PDF를 만들어 내려받는다. 취소했으면 false. 실패하면 오류를 던진다.
  save(fileName: string, pages: PdfPage[]): Promise<boolean>;
}

// 쪽 크기는 프레임 크기(px를 pt로)이고 2배 이미지를 그 크기에 맞춰 넣는다. stop이 true를 돌려주면 null.
export async function buildPdf(pages: PdfPage[], stop: () => boolean = () => false): Promise<Uint8Array | null> {
  const doc = await PDFDocument.create();
  for (const page of pages) {
    if (stop()) return null;
    const image = await doc.embedJpg(page.bytes);
    doc.addPage([page.width, page.height]).drawImage(image, { x: 0, y: 0, width: page.width, height: page.height });
  }
  return stop() ? null : doc.save();
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
  let running = false;
  let cancelled = false;

  function paint() {
    const view = root.querySelector<HTMLElement>('.pdf-view');
    if (!view) return;
    view.querySelector<HTMLElement>('.pdf-count')!.textContent = selection.frames
      ? `${COPY.pdf002} ${selection.frames}${COPY.pdf003}${selection.others ? ` · ${COPY.pdf007} ${selection.others}${COPY.pdf008}` : ''}`
      : COPY.pdf004;
    const action = view.querySelector<HTMLElement>('.pdf-action')!;
    action.innerHTML = running
      ? `<button data-action="pdf-cancel" ${cancelled ? 'disabled' : ''}>${cancelled ? COPY.pdf014 : COPY.pdf013}</button>`
      : `<button class="primary" data-action="pdf-export" ${selection.frames ? '' : 'disabled'}>${COPY.pdf001}</button>`;
  }

  return {
    render(open) {
      root.classList.toggle('pdf-mode', open);
      let view = root.querySelector<HTMLElement>('.pdf-view');
      if (!open) { view?.remove(); return; }
      if (view) return;
      view = document.createElement('div');
      view.className = 'pdf-view';
      // 머리 줄: 왼쪽에 선택한 프레임 수, 오른쪽에 실행(저장 중에는 취소) 버튼(텍스트 편집 탭과 같은 자리)
      view.innerHTML = `<div class="text-actions"><span class="note pdf-count" aria-live="polite"></span><span class="pdf-action"></span></div>
        <p class="note">${COPY.pdf009}</p>`;
      root.appendChild(view);
      paint();
    },
    setSelection(next) { selection = next; paint(); },
    setRunning(next) { running = next; cancelled = false; paint(); },
    cancel() { if (running) { cancelled = true; paint(); } },
    async save(fileName, pages) {
      const bytes = await buildPdf(pages, () => cancelled);
      if (!bytes) return false;
      download(fileName, bytes);
      return true;
    },
  };
}
