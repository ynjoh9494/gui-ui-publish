import { canvasOrder, type CanvasPosition } from './screenCode.ts';

// PDF 저장 탭(2026-10-26 사용자 요청): 보고 있는 페이지에서 고른 프레임을 한 PDF로 저장한다.
// 플립북의 시스템 영역 중 제목과 이력은 저장하는 동안만 숨긴다. 프레임에 없으면 숨길 것도 없다.
export const PDF_HIDDEN_PARTS = ['UI Title', 'Update History List'] as const;

// 한 쪽은 프레임을 2배 JPG로 내보낸 이미지다(2026-10-26 사용자 결정). Figma의 PDF 내보내기는 그림자·블러를
// 고해상도 그림으로 구워 효과가 많은 플립북 한 장에 6~7초·10MB가 걸렸다. 2배 JPG는 약 2초·1.6MB다.
export const PDF_IMAGE_SCALE = 2;

// 지금 캔버스 선택에서 저장할 프레임 수와 프레임이 아니라 뺄 노드 수
export interface PdfSelection { frames: number; others: number }

// 한 쪽: 프레임의 JPG와 쪽 크기(내보낼 때의 프레임 크기, px = pt). 한 PDF로 묶기는 UI가 한다.
export interface PdfPage { name: string; bytes: Uint8Array; width: number; height: number }

// 왼쪽 위에서 오른쪽 아래로: 위 줄부터, 줄 안에서는 왼쪽부터(번호 다시 매기기와 같은 줄 판정).
export function pdfOrder<T>(frames: T[], at: (frame: T) => Omit<CanvasPosition, 'page'>): T[] {
  return canvasOrder(frames, frame => ({ page: 0, ...at(frame) }));
}

// 파일 이름에 쓸 수 없는 글자는 바꾼다. 구현 기본값(확인 필요): 보고 있는 페이지 이름.
export function pdfFileName(pageName: string): string {
  const base = pageName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').trim();
  return `${base || 'flipbook'}.pdf`;
}
