import { findFreePoint } from "../../src/utils/free-point.js";
import type { UiElement } from "../../src/types.js";

function makeElement(bounds: { x: number; y: number; width: number; height: number }): UiElement {
  return {
    text: "",
    type: "ViewGroup",
    clickable: true,
    enabled: true,
    bounds,
    center_x: bounds.x + bounds.width / 2,
    center_y: bounds.y + bounds.height / 2,
  } as UiElement;
}

// Real geometry from a production app's home: a card under React Native's LogBox banner.
const CARD = makeElement({ x: 581, y: 1861, width: 436, height: 319 });
const BANNER = makeElement({ x: 26, y: 2006, width: 1028, height: 125 });

describe("findFreePoint", () => {
  it("picks the largest strip the cover leaves inside the target", () => {
    // Free above: y 1861..2006 (145 tall). Free below: y 2131..2180 (49 tall).
    expect(findFreePoint(CARD, BANNER)).toEqual({ x: 799, y: 1934 });
  });

  it("uses the strip below when the cover sits at the top", () => {
    const topCover = makeElement({ x: 0, y: 1800, width: 1080, height: 250 });
    const point = findFreePoint(CARD, topCover)!;
    expect(point.y).toBeGreaterThan(2050);
    expect(point.y).toBeLessThan(2180);
  });

  it("uses a side strip when the cover splits the target vertically", () => {
    const sideCover = makeElement({ x: 581, y: 1800, width: 200, height: 500 });
    const point = findFreePoint(CARD, sideCover)!;
    expect(point.x).toBeGreaterThan(781);
  });

  it("returns nothing when the cover leaves no usable area", () => {
    const fullCover = makeElement({ x: 0, y: 0, width: 1080, height: 2400 });
    expect(findFreePoint(CARD, fullCover)).toBeUndefined();
  });

  it("rejects a sliver too small to tap reliably", () => {
    const almostFull = makeElement({ x: 0, y: 1870, width: 1080, height: 2000 });
    expect(findFreePoint(CARD, almostFull)).toBeUndefined();
  });

  it("rejects a strip narrower than a touch target", () => {
    // Observed live: the LogBox banner left 16px of the button uncovered.
    // The tap landed inside the element and still did nothing.
    const button = makeElement({ x: 53, y: 2130, width: 975, height: 157 });
    const banner = makeElement({ x: 26, y: 2146, width: 1028, height: 125 });
    expect(findFreePoint(button, banner)).toBeUndefined();
  });

  it("keeps the point inside the target", () => {
    const point = findFreePoint(CARD, BANNER)!;
    expect(point.x).toBeGreaterThanOrEqual(CARD.bounds.x);
    expect(point.x).toBeLessThanOrEqual(CARD.bounds.x + CARD.bounds.width);
    expect(point.y).toBeGreaterThanOrEqual(CARD.bounds.y);
    expect(point.y).toBeLessThanOrEqual(CARD.bounds.y + CARD.bounds.height);
  });
});
