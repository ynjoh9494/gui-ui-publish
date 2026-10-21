// 태그 색은 이 팔레트에서만 고른다. Gray는 SYSTEM 전용이라 선택지에 넣지 않는다(2026-10-16 사용자 결정).
// 플립북 태그에도 이 hex를 직접 칠한다. Figma 파일의 색 변수는 쓰지 않는다(2026-10-21 사용자 결정).
export const TAG_PALETTE = [
  { key: 'Pink', hex: '#FF4BAE' },
  { key: 'Red', hex: '#FF384C' },
  { key: 'Orange', hex: '#FF8D28' },
  { key: 'Yellow', hex: '#D9AE00' },
  { key: 'Olive', hex: '#63A612' },
  { key: 'Green', hex: '#18B567' },
  { key: 'Teal', hex: '#19A8B8' },
  { key: 'Blue', hex: '#0088FF' },
  { key: 'Indigo', hex: '#6155F5' },
  { key: 'Violet', hex: '#8731FF' },
  { key: 'Purple', hex: '#BE38F3' },
  { key: 'Brown', hex: '#AC7F5E' },
  { key: 'Black', hex: '#333333' },
] as const;

export type ColorKey = (typeof TAG_PALETTE)[number]['key'];

export function isColorKey(value: string): value is ColorKey {
  return TAG_PALETTE.some(c => c.key === value);
}

export function paletteHex(key: ColorKey): string {
  return TAG_PALETTE.find(c => c.key === key)!.hex;
}
