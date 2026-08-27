import { jest } from "@jest/globals";
import { captureTool, callTool, textOf } from "../helpers/tool-harness.js";
import type { UiElement } from "../../src/types.js";

const mockGetUiTree = jest.fn<() => Promise<UiElement[]>>();
const mockTap = jest.fn<(x: number, y: number, id?: string) => Promise<void>>();

jest.unstable_mockModule("../../src/platforms/driver.js", () => ({
  getDriver: () => ({ getUiTree: mockGetUiTree, tap: mockTap }),
}));
jest.unstable_mockModule("../../src/utils/resolve-platform.js", () => ({
  resolvePlatform: async () => "android",
  PLATFORM_DESCRIPTION: "",
}));

const { registerDismissDevOverlaysTool } = await import(
  "../../src/tools/dismiss-dev-overlays.js"
);
const tool = captureTool(registerDismissDevOverlaysTool);

function makeElement(
  text: string,
  bounds: { x: number; y: number; width: number; height: number },
  clickable = true,
): UiElement {
  return {
    text,
    type: "ViewGroup",
    clickable,
    enabled: true,
    bounds,
    center_x: bounds.x + bounds.width / 2,
    center_y: bounds.y + bounds.height / 2,
  } as UiElement;
}

const APP_SCREEN = [makeElement("Iniciar Control", { x: 53, y: 2130, width: 975, height: 157 })];

// Geometry observed live: the collapsed banner and its unlabelled close button.
const BANNER = makeElement("!, Open debugger to view warnings.", { x: 26, y: 2146, width: 1028, height: 125 });
const BANNER_CLOSE = makeElement("", { x: 970, y: 2183, width: 52, height: 52 });

beforeEach(() => {
  jest.clearAllMocks();
  mockTap.mockResolvedValue(undefined);
});

describe("dismiss_dev_overlays", () => {
  it("says so when nothing is intercepting taps", async () => {
    mockGetUiTree.mockResolvedValue(APP_SCREEN);
    const result = await callTool(tool, {});
    expect(textOf(result)).toContain("No development overlays");
    expect(mockTap).not.toHaveBeenCalled();
  });

  it("closes an expanded LogBox by its Dismiss button", async () => {
    const dismiss = makeElement("Dismiss", { x: 0, y: 2211, width: 540, height: 126 });
    mockGetUiTree
      .mockResolvedValueOnce([...APP_SCREEN, dismiss])
      .mockResolvedValue(APP_SCREEN);
    const result = await callTool(tool, {});
    expect(mockTap).toHaveBeenCalledWith(270, 2274, undefined);
    expect(textOf(result)).toContain("Dismissed 1");
  });

  it("closes the collapsed banner, which has no labelled button", async () => {
    mockGetUiTree
      .mockResolvedValueOnce([...APP_SCREEN, BANNER, BANNER_CLOSE])
      .mockResolvedValue(APP_SCREEN);
    const result = await callTool(tool, {});
    expect(mockTap).toHaveBeenCalledWith(996, 2209, undefined);
    expect(textOf(result)).toContain("warning banner");
  });

  it("clears a stack of overlays in one call", async () => {
    const dismiss = makeElement("Dismiss", { x: 0, y: 2211, width: 540, height: 126 });
    mockGetUiTree
      .mockResolvedValueOnce([...APP_SCREEN, dismiss])
      .mockResolvedValueOnce([...APP_SCREEN, dismiss])
      .mockResolvedValue(APP_SCREEN);
    const result = await callTool(tool, {});
    expect(mockTap).toHaveBeenCalledTimes(2);
    expect(textOf(result)).toContain("Dismissed 2");
  });

  it("does not mistake an app control for a banner close button", async () => {
    mockGetUiTree.mockResolvedValue([...APP_SCREEN, BANNER]);
    const result = await callTool(tool, {});
    expect(mockTap).not.toHaveBeenCalled();
    expect(textOf(result)).toContain("No development overlays");
  });
});
