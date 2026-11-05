// 관리의 업데이트 안내 말풍선을 창 안에 놓는다.
export interface BubbleRect { left: number; top: number; right: number; bottom: number }

export function placeBubble(anchor: BubbleRect, w: number, h: number, W: number, H: number): { left: number; top: number; tail: string; tailX: number } {
  const edge = 8, gap = 4, tail = { width: 14, height: 7, inset: 14 };
  const reach = Math.min((anchor.right - anchor.left) / 2, 24);
  const tipLeft = anchor.left + reach, tipRight = anchor.right - reach;
  const fromTip = tail.inset + tail.width / 2;
  const leftX = tipLeft - fromTip, rightX = tipRight + fromTip - w;
  const below = anchor.bottom + gap + tail.height, above = anchor.top - gap - tail.height - h;
  const fitsBelow = below + h <= H - edge, fitsAbove = above >= edge;
  const fitsLeft = leftX + w <= W - edge, fitsRight = rightX >= edge;
  const vertical = fitsBelow ? 'top' : fitsAbove ? 'bottom' : H - anchor.bottom >= anchor.top ? 'top' : 'bottom';
  const side = fitsLeft || !fitsRight ? 'left' : 'right';
  const left = Math.max(edge, Math.min(side === 'left' ? leftX : rightX, W - edge - w));
  const top = Math.max(edge, Math.min(vertical === 'top' ? below : above, H - edge - h));
  const tip = side === 'left' ? tipLeft : tipRight;
  const tailX = Math.max(10, Math.min(tip - left - tail.width / 2, w - 10 - tail.width));
  return { left, top, tail: `${vertical}-${side}`, tailX };
}
