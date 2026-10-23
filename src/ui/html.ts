// UI의 HTML 문자열에 넣는 값. 기록·캔버스에서 온 이름에 태그 문자가 있어도 글자로 보인다.
export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
