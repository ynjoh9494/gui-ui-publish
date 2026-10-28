import { COPY } from '../core/copy.ts';
import { PDF_IMAGE_SCALE, pdfOrder, type PdfPage, type PdfSelection } from '../core/pdf.ts';
import { pdfHiddenParts } from './template.ts';

// PDF 저장 탭: 보고 있는 페이지에서 고른 프레임을 한 쪽씩 JPG로 내보낸다.
type PdfFrame = FrameNode | ComponentNode | InstanceNode;
const FRAME_TYPES = new Set<SceneNode['type']>(['FRAME', 'COMPONENT', 'INSTANCE']);
const isFrame = (node: SceneNode): node is PdfFrame => FRAME_TYPES.has(node.type);

export function pdfSelection(): PdfSelection {
  const selection = figma.currentPage.selection;
  const frames = selection.filter(isFrame).length;
  return { frames, others: selection.length - frames };
}

// progress가 false를 돌려주면(취소) 다음 프레임으로 가지 않고 null을 돌려준다. 내보내는 중인 한 장은 끝까지 기다린다.
export async function exportPdfPages(progress: (done: number, total: number) => Promise<boolean>): Promise<PdfPage[] | null> {
  const frames = pdfOrder(figma.currentPage.selection.filter(isFrame), frame => {
    const box = frame.absoluteBoundingBox ?? { x: frame.absoluteTransform[0][2], y: frame.absoluteTransform[1][2], height: frame.height };
    return { x: box.x, y: box.y, height: box.height };
  });
  if (!frames.length) throw new Error(COPY.pdf004);
  const pages: PdfPage[] = [];
  for (const [index, frame] of frames.entries()) {
    if (!await progress(index, frames.length)) return null;
    // 보이는 요소만 숨겼다가 내보낸 직후 되돌린다. 원래 숨겨 둔 요소는 그대로 둔다. GUI 영역 안의 복사본은 찾지 않는다.
    // 표식 템플릿에서 만든 플립북은 「PDF에서 숨김」에 연결한 레이어를, 이전 플립북은 이름(UI Title·Update History List)으로 찾는다.
    const hidden = pdfHiddenParts(frame).filter(node => node.visible);
    for (const node of hidden) node.visible = false;
    try {
      // 쪽 크기는 숨긴 뒤의 크기다(오토 레이아웃 플립북은 숨긴 만큼 줄어든다).
      const { width, height } = frame;
      const bytes = await frame.exportAsync({ format: 'JPG', constraint: { type: 'SCALE', value: PDF_IMAGE_SCALE } });
      pages.push({ name: frame.name, bytes, width, height });
    } finally {
      for (const node of hidden) node.visible = true;
    }
  }
  return pages;
}
