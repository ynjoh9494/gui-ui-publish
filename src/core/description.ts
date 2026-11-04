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

// 텍스트 편집기의 서식 도구(2026-11-04 사용자 요청). 접힌 도구를 펼쳐 고친다.
// gap: 항목 사이 간격, padding: 바깥 영역의 Top·Right·Bottom·Left.
// spacer: 「---」 다음 항목에 직접 넣는 Top Padding. 「---(16)」은 해당 항목만 16으로 쓴다.
export interface TextLayout {
  gap: number;
  padding: [number, number, number, number];
  fontSize: number;
  letterSpacing: number;
  lineHeight: number;
  listSpacing: number;
  spacer: number;
}
export const DEFAULT_TEXT_LAYOUT: TextLayout = { gap: 12, padding: [8, 12, 16, 12], fontSize: 16, letterSpacing: 0, lineHeight: 140, listSpacing: 2, spacer: 15 };
export const cloneLayout = (layout: TextLayout): TextLayout => ({ ...layout, padding: [...layout.padding] as TextLayout['padding'] });
export const sameLayout = (a: TextLayout, b: TextLayout): boolean => JSON.stringify(a) === JSON.stringify(b);

// 디바이더는 다음 항목의 Top Padding을 지정한다.
export const SPACER_TEXT = '---';
export const isSpacer = (p: { text: string; depth: number | null }): boolean => p.depth === null && /^---(?:\(\d+(?:\.\d+)?\))?$/.test(p.text.trim());
export const spacerHeight = (text: string): number | undefined => {
  const value = /^---\((\d+(?:\.\d+)?)\)$/.exec(text.trim());
  return value ? Number(value[1]) : undefined;
};
