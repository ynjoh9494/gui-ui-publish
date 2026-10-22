// The editor applies its document to one selected text layer or to one text layer
// in the body area of the selected flipbook's Description.
export type SelectionWrite =
  | { kind: 'text'; name: string }
  | { kind: 'description' };

// 지금 캔버스 선택에서 불러오기·적용할 대상. 텍스트 편집 탭에 보여 준다(2026-10-22 사용자 요청).
// description: 플립북 안의 요소를 골랐다(flipbookId는 플립북 표식이 있을 때, name은 플립북 프레임 이름).
export type SelectionTarget =
  | { kind: 'description'; flipbookId: string | null; name: string }
  | { kind: 'text'; name: string }
  | { kind: 'none' }
  | { kind: 'error'; message: string };
