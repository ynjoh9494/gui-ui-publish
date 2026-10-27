// The editor applies its document to one selected text layer, to the body area of the selected
// flipbook's Description, or as a new wrapped group set inside one selected frame outside flipbooks.
// 적용 결과에 레이어 이름을 싣지 않는다. 이름이 자동인 텍스트 레이어는 적용하면 이름이 새 본문 전체가 된다.
export type SelectionWrite =
  | { kind: 'text' }
  | { kind: 'description' }
  | { kind: 'frame' };

// 지금 캔버스 선택에서 불러오기·적용할 대상. 텍스트 편집 탭에 보여 준다(2026-10-22 사용자 요청).
// description: 플립북 안의 요소를 골랐다(flipbookId는 플립북 표식이 있을 때, name은 플립북 프레임 이름).
// frame: 플립북 밖에서 텍스트가 아닌 프레임 하나를 골랐다.
export type SelectionTarget =
  | { kind: 'description'; flipbookId: string | null; name: string }
  | { kind: 'text'; name: string }
  | { kind: 'frame'; name: string }
  | { kind: 'none' }
  | { kind: 'error'; message: string };
