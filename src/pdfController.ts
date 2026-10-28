import { COPY } from './core/copy.ts';
import { pdfFileName, type PdfSelection } from './core/pdf.ts';
import type { Host } from './host.ts';

// PDF 저장 탭(UI Flipbook) 작업 조정. 쪽 순서·숨길 요소·배율은 core/pdf.ts, 내보내기는 Host가 맡고 PDF로 묶기는 UI가 한다.
export class PdfController {
  // 탭이 보이는 동안 선택한 프레임 수가 달라질 때만 보낸다.
  private tabOpen = false;
  private lastSelection: PdfSelection | null = null;
  // 저장 중 취소를 눌렀다. 다음 프레임을 내보내기 전에 멈춘다.
  private cancelled = false;
  private exporting = false;

  private readonly host: Host;
  private readonly progress: (label: string) => Promise<void>;
  private readonly busy: (label: string | null) => void;

  constructor(host: Host, progress: (label: string) => Promise<void>, busy: (label: string | null) => void) {
    this.host = host;
    this.progress = progress;
    this.busy = busy;
  }

  setTab(open: boolean): void {
    this.tabOpen = open;
    this.lastSelection = null;
    if (open) this.postSelection();
  }

  // 캔버스 선택이 바뀌었거나 플러그인을 다시 열었다.
  selectionChanged(): void {
    if (this.tabOpen) this.postSelection();
  }

  async export(): Promise<void> {
    if (!this.host.exportPdf) return;
    this.cancelled = false;
    this.exporting = true;
    try {
      const { pageName, pages } = await this.host.exportPdf(async (done, total) => {
        if (this.cancelled) return false;
        await this.progress(`${COPY.pdf005} (${done + 1}/${total})`);
        return true;
      });
      if (!pages || this.cancelled) this.host.post({ type: 'pdfCancelled' });
      else this.host.post({ type: 'pdfPages', fileName: pdfFileName(pageName), pages });
    } finally {
      this.exporting = false;
    }
  }

  // 쓰기 순서를 기다리지 않고 바로 처리한다. 쪽을 다 보낸 뒤(UI가 PDF로 묶는 중)의 취소는 UI가 처리한다.
  cancel(): void {
    if (!this.exporting) return;
    this.cancelled = true;
    this.busy(COPY.pdf014);
  }

  private postSelection(): void {
    const selection = this.host.pdfSelection?.();
    if (!selection || this.lastSelection?.frames === selection.frames && this.lastSelection.others === selection.others) return;
    this.lastSelection = selection;
    this.host.post({ type: 'pdfSelection', selection });
  }
}
