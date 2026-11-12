// GUI 프레임 이름 `[STB_HO_001] 홈 화면 -1`에서 Screen ID와 화면 이름을 읽는다.
// 대괄호 안은 형식을 따지지 않고 그대로 Screen ID로 본다(2026-10-19 사용자 결정).

const BRACKETED = /^\s*\[([^\]]*)\]\s*([\s\S]*)$/;

export interface ParsedName { code: string | null; name: string }

export function parseFrameName(frameName: string): ParsedName {
  const match = BRACKETED.exec(frameName);
  if (!match) return { code: null, name: frameName.trim() };
  const code = match[1].trim();
  return { code: code || null, name: match[2].trim() };
}

// 플립북 이름은 `ID · 제목`, 이전 대괄호 형식, ID만 있는 형식을 읽는다.
// 구분자가 없는 이름에서는 번호·정책 ID 형식만 인정해 일반 제목을 보존한다.
export function parseFlipbookName(frameName: string): ParsedName {
  const bracketed = parseFrameName(frameName);
  if (bracketed.code && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(bracketed.code)) return bracketed;
  const separated = /^\s*([A-Za-z0-9-]+(?:_[A-Za-z0-9-]+)+)\s*·\s*([\s\S]*)$/.exec(frameName);
  const numbered = /^\s*((?:[A-Za-z0-9-]+_)+(?:\d+(?:-\d+)?|POLICY(?:_\d+)?))(?:\s+([\s\S]*))?\s*$/i.exec(frameName);
  const match = separated ?? numbered;
  return match ? { code: match[1], name: (match[2] ?? '').trim() } : { code: null, name: frameName.trim() };
}

// 배포한 화면의 프레임 이름. 대괄호가 없던 프레임은 이 이름으로 바꾼다.
export function formatFrameName(code: string | undefined, name: string | undefined): string {
  // 이전 버전 저장 데이터에는 Screen ID가 없다. 실행 화면에서는 그 이름을 그대로 보여 준다.
  const label = (name ?? '').trim();
  const id = (code ?? '').trim();
  return id ? `[${id}] ${label}`.trim() : label;
}
