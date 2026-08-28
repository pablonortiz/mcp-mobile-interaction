import type { UiElement } from "../types.js";

export interface Point {
  x: number;
  y: number;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Android's minimum touch target is 48dp — roughly 144px at 3x density. A
 * narrower strip technically sits inside the element but is not reliably
 * tappable: aiming at a 16px sliver above a banner produced a tap that landed
 * but did nothing. Below this, dismissing the cover is the only real fix.
 */
const MIN_USABLE_SIDE = 48;

/**
 * A point inside `target` that `cover` does not overlap, so a tap can still
 * reach the intended element. Returns undefined when the cover leaves no
 * usable area — then the cover has to be dismissed first.
 */
export function findFreePoint(
  target: UiElement,
  cover: UiElement,
): Point | undefined {
  const strips = uncoveredStrips(target.bounds, cover.bounds);
  const best = strips
    .filter((strip) => strip.width >= MIN_USABLE_SIDE && strip.height >= MIN_USABLE_SIDE)
    .sort((first, second) => area(second) - area(first))[0];

  if (!best) return undefined;
  return {
    x: Math.round(best.x + best.width / 2),
    y: Math.round(best.y + best.height / 2),
  };
}

/** The four rectangles of `target` left free above/below/left/right of `cover`. */
function uncoveredStrips(target: Rect, cover: Rect): Rect[] {
  const targetRight = target.x + target.width;
  const targetBottom = target.y + target.height;
  const coverRight = cover.x + cover.width;
  const coverBottom = cover.y + cover.height;

  return [
    { x: target.x, y: target.y, width: target.width, height: cover.y - target.y },
    { x: target.x, y: coverBottom, width: target.width, height: targetBottom - coverBottom },
    { x: target.x, y: target.y, width: cover.x - target.x, height: target.height },
    { x: coverRight, y: target.y, width: targetRight - coverRight, height: target.height },
  ];
}

function area(rect: Rect): number {
  return rect.width * rect.height;
}
