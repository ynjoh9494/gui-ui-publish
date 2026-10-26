import { COPY } from '../core/copy.ts';
import { PDF_HIDDEN_PARTS, pdfOrder, type PdfPage, type PdfSelection } from '../core/pdf.ts';
import { findPart } from './flipbook.ts';

// PDF 저장 탭: 보고 있는 페이지에서 고른 프레임을 한 쪽씩 PDF로 내보낸다.
type PdfFrame = FrameNode | ComponentNode | InstanceNode;
const FRAME_TYPES = new Set<SceneNode['type']>(['FRAME', 'COMPONENT', 'INSTANCE']);
const isFrame = (node: SceneNode): node is PdfFrame => FRAME_TYPES.has(node.type);

export function pdfSelection(): PdfSelection {
  const selection = figma.currentPage.selection;
  const frames = selection.filter(isFrame).length;
  return { frames, others: selection.length - frames };
}

export async function exportPdfPages(progress: (done: number, total: number) => Promise<void>): Promise<PdfPage[]> {
  const frames = pdfOrder(figma.currentPage.selection.filter(isFrame), frame => {
    const box = frame.absoluteBoundingBox ?? { x: frame.absoluteTransform[0][2], y: frame.absoluteTransform[1][2], height: frame.height };
    return { x: box.x, y: box.y, height: box.height };
  });
  if (!frames.length) throw new Error(COPY.pdf004);
  const pages: PdfPage[] = [];
  for (const [index, frame] of frames.entries()) {
    await progress(index, frames.length);
    // 보이는 요소만 숨겼다가 내보낸 직후 되돌린다. 원래 숨겨 둔 요소는 그대로 둔다. GUI 영역 안의 복사본은 찾지 않는다.
    const hidden = PDF_HIDDEN_PARTS.map(name => findPart(frame, node => node.name === name)).filter((node): node is SceneNode => !!node && node.visible);
    for (const node of hidden) node.visible = false;
    try {
      pages.push({ name: frame.name, bytes: await frame.exportAsync({ format: 'PDF' }) });
    } finally {
      for (const node of hidden) node.visible = true;
    }
  }
  return pages;
}
