// 이전 확정 이미지와 현재 출력의 RGBA 픽셀 비교. 임계값으로 작은 차이를 숨기지 않는다.

export interface PixelDiff {
  sameSize: boolean;
  changedPixels: number;
  // 변경 픽셀이 있는 격자 칸. 차이 강조 표시에 쓴다.
  cells: { x: number; y: number; width: number; height: number }[];
}

export function diffPixels(a: Uint8ClampedArray | Uint8Array, b: Uint8ClampedArray | Uint8Array, width: number, height: number, cell = 32): PixelDiff {
  if (a.length !== width * height * 4 || b.length !== a.length) return { sameSize: false, changedPixels: -1, cells: [] };
  const cols = Math.ceil(width / cell);
  const hit = new Uint8Array(cols * Math.ceil(height / cell));
  let changed = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) {
        changed++;
        hit[Math.floor(y / cell) * cols + Math.floor(x / cell)] = 1;
      }
    }
  }
  const cells: PixelDiff['cells'] = [];
  hit.forEach((v, idx) => {
    if (!v) return;
    const x = (idx % cols) * cell, y = Math.floor(idx / cols) * cell;
    cells.push({ x, y, width: Math.min(cell, width - x), height: Math.min(cell, height - y) });
  });
  return { sameSize: true, changedPixels: changed, cells };
}
