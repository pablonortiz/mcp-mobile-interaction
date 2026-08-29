import { jest } from "@jest/globals";
import type { UiElement } from "../../src/types.js";

const mockSwipe = jest.fn<(a: number, b: number, c: number, d: number, e?: number, f?: string) => Promise<void>>();
const mockGetScreenInfo = jest.fn<() => Promise<{ width: number; height: number }>>();

jest.unstable_mockModule("../../src/platforms/driver.js", () => ({
  getDriver: () => ({ swipe: mockSwipe, getScreenInfo: mockGetScreenInfo }),
}));

const { scrollOnce } = await import("../../src/utils/scroll.js");

function makeScrollable(bounds: { x: number; y: number; width: number; height: number }): UiElement {
  return {
    text: "",
    type: "ScrollView",
    clickable: false,
    scrollable: true,
    bounds,
    center_x: bounds.x + bounds.width / 2,
    center_y: bounds.y + bounds.height / 2,
  } as UiElement;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetScreenInfo.mockResolvedValue({ width: 1080, height: 2400 });
  mockSwipe.mockResolvedValue(undefined);
});

describe("scrollOnce", () => {
  it("uses the screen centre when the tree names no scrollable", async () => {
    await scrollOnce("android", "down", "dev1", []);
    const [, startY] = mockSwipe.mock.calls[0];
    expect(startY).toBe(1200 + 720);
  });

  it("aims inside the scrollable container instead", async () => {
    // The WMS home: a ScrollView whose centre is 1393, not the screen's 1200.
    const tree = [makeScrollable({ x: 0, y: 606, width: 1080, height: 1574 })];
    await scrollOnce("android", "down", "dev1", tree);
    const [, startY] = mockSwipe.mock.calls[0];
    expect(startY).toBe(1393 + Math.round(1574 * 0.3));
  });

  it("picks the largest container when several scroll", async () => {
    const tree = [
      makeScrollable({ x: 0, y: 0, width: 200, height: 200 }),
      makeScrollable({ x: 0, y: 400, width: 1080, height: 1200 }),
    ];
    await scrollOnce("android", "down", "dev1", tree);
    const [startX] = mockSwipe.mock.calls[0];
    expect(startX).toBe(540);
  });

  it("swipes the opposite way when scrolling up", async () => {
    const tree = [makeScrollable({ x: 0, y: 606, width: 1080, height: 1574 })];
    await scrollOnce("android", "up", "dev1", tree);
    const [, startY, , endY] = mockSwipe.mock.calls[0];
    expect(startY).toBeLessThan(endY as number);
  });

  it("falls back to the screen when no tree is passed at all", async () => {
    await scrollOnce("android", "down", "dev1");
    expect(mockSwipe).toHaveBeenCalled();
  });
});
