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

// 배포한 화면의 프레임 이름. 대괄호가 없던 프레임은 이 이름으로 바꾼다.
export function formatFrameName(code: string | undefined, name: string | undefined): string {
  // 이전 버전 저장 데이터에는 Screen ID가 없다. 실행 화면에서는 그 이름을 그대로 보여 준다.
  const label = (name ?? '').trim();
  const id = (code ?? '').trim();
  return id ? `[${id}] ${label}`.trim() : label;
}
