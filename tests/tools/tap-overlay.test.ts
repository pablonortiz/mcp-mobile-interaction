import { jest } from "@jest/globals";
import { captureTool, callTool, textOf } from "../helpers/tool-harness.js";
import type { UiElement } from "../../src/types.js";

const mockGetUiTree = jest.fn<() => Promise<UiElement[]>>();
const mockTap = jest.fn<() => Promise<void>>();

jest.unstable_mockModule("../../src/platforms/driver.js", () => ({
  getDriver: () => ({
    getUiTree: mockGetUiTree,
    tap: mockTap,
    getFirstDeviceId: async () => "emulator-5554",
  }),
}));
jest.unstable_mockModule("../../src/utils/resolve-platform.js", () => ({
  resolvePlatform: async () => "android",
  PLATFORM_DESCRIPTION: "",
}));

const { registerTapElementTool } = await import("../../src/tools/tap-element.js");
const tool = captureTool(registerTapElementTool);

function makeElement(
  text: string,
  bounds: { x: number; y: number; width: number; height: number },
  overrides: Partial<UiElement> = {},
): UiElement {
  return {
    text,
    type: "ViewGroup",
    clickable: true,
    enabled: true,
    bounds,
    center_x: bounds.x + bounds.width / 2,
    center_y: bounds.y + bounds.height / 2,
    ...overrides,
  } as UiElement;
}

// The real geometry from the WMS home screen: a menu card whose centre falls
// under React Native's LogBox banner.
const CARD = makeElement(", Control de inventario", { x: 581, y: 1861, width: 436, height: 319 });
const CARD_LABEL = makeElement("Control de inventario", { x: 625, y: 2153, width: 348, height: 27 }, { clickable: false, type: "TextView" });
const LOGBOX = makeElement("!, Open debugger to view warnings.", { x: 26, y: 2006, width: 1028, height: 125 });

beforeEach(() => {
  jest.clearAllMocks();
  mockTap.mockResolvedValue(undefined);
});

describe("tap_element overlay detection", () => {
  it("aims clear of a cover instead of tapping into it", async () => {
    mockGetUiTree.mockResolvedValue([CARD, CARD_LABEL, LOGBOX]);
    const result = await callTool(tool, { text_contains: "Control de inventario" });
    expect(textOf(result)).toContain("Open debugger to view warnings.");
    expect(textOf(result)).toContain("the tap was aimed at");
    // The free strip above the banner: y 1861..2006 inside the card.
    expect(mockTap).toHaveBeenCalledWith(799, 1934, undefined);
  });

  it("gives up and says so when the cover leaves no free area", async () => {
    const fullCover = makeElement("blocking sheet", { x: 0, y: 0, width: 1080, height: 2400 });
    mockGetUiTree.mockResolvedValue([CARD, CARD_LABEL, fullCover]);
    const result = await callTool(tool, { text_contains: "Control de inventario" });
    expect(textOf(result)).toContain("covers this element entirely");
    expect(textOf(result)).toContain("dismiss_dev_overlays");
  });

  it("names an unlabelled cover by its bounds", async () => {
    const anonymous = makeElement("", { x: 26, y: 2006, width: 1028, height: 125 });
    mockGetUiTree.mockResolvedValue([CARD, CARD_LABEL, anonymous]);
    const result = await callTool(tool, { text_contains: "Control de inventario" });
    expect(textOf(result)).toContain("[26,2006][1054,2131]");
  });

  it("does not mistake the element's own children for a cover", async () => {
    mockGetUiTree.mockResolvedValue([CARD, CARD_LABEL]);
    const result = await callTool(tool, { text_contains: "Control de inventario" });
    expect(textOf(result)).not.toContain("drawn over");
  });

  it("ignores a clickable drawn before the target", async () => {
    mockGetUiTree.mockResolvedValue([LOGBOX, CARD, CARD_LABEL]);
    const result = await callTool(tool, { text_contains: "Control de inventario" });
    expect(textOf(result)).not.toContain("drawn over");
  });

  it("ignores an element that does not reach the tap point", async () => {
    const elsewhere = makeElement("banner", { x: 0, y: 0, width: 200, height: 100 });
    mockGetUiTree.mockResolvedValue([CARD, CARD_LABEL, elsewhere]);
    const result = await callTool(tool, { text_contains: "Control de inventario" });
    expect(textOf(result)).not.toContain("drawn over");
  });

  it("taps the plain centre when nothing is in the way", async () => {
    mockGetUiTree.mockResolvedValue([CARD, CARD_LABEL]);
    await callTool(tool, { text_contains: "Control de inventario" });
    expect(mockTap).toHaveBeenCalledWith(799, 2020.5, undefined);
  });
});
