/**
 * Tests for src/utils/observe.ts — performObservation and observe mode logic
 *
 * We mock the platform modules (android/ios), image utility, and ui-filter
 * so tests verify the orchestration logic without real device calls.
 */

import { jest } from "@jest/globals";
import type { UiElement } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockAndroidGetUiTree = jest.fn<(id?: string) => Promise<UiElement[]>>();
const mockAndroidScreenshot = jest.fn<(id?: string) => Promise<Buffer>>();
const mockIosGetUiTree = jest.fn<(id?: string) => Promise<UiElement[]>>();
const mockIosScreenshot = jest.fn<(id?: string) => Promise<Buffer>>();
const mockCompressScreenshot = jest.fn();
const mockFilterUiElements = jest.fn<(els: UiElement[], includeAll?: boolean) => UiElement[]>();

jest.unstable_mockModule("../../src/platforms/android.js", () => ({
  getUiTree: mockAndroidGetUiTree,
  screenshot: mockAndroidScreenshot,
}));
jest.unstable_mockModule("../../src/platforms/ios.js", () => ({
  getUiTree: mockIosGetUiTree,
  screenshot: mockIosScreenshot,
}));
jest.unstable_mockModule("../../src/utils/image.js", () => ({
  compressScreenshot: mockCompressScreenshot,
}));
jest.unstable_mockModule("../../src/utils/ui-filter.js", () => ({
  filterUiElements: mockFilterUiElements,
}));

const { performObservation } = await import("../../src/utils/observe.js");

beforeEach(() => {
  jest.clearAllMocks();
  // Default passthrough for filter
  mockFilterUiElements.mockImplementation((els) => els);
});

// ---------------------------------------------------------------------------
// performObservation
// ---------------------------------------------------------------------------
describe("performObservation", () => {
  it("returns undefined when mode is 'none'", async () => {
    const result = await performObservation({
      mode: "none",
      platform: "android",
    });
    expect(result).toBeUndefined();
    expect(mockAndroidGetUiTree).not.toHaveBeenCalled();
    expect(mockAndroidScreenshot).not.toHaveBeenCalled();
  });

  it("captures only UI tree when mode is 'ui_tree'", async () => {
    const fakeTree: UiElement[] = [
      {
        index: 0,
        type: "Button",
        text: "OK",
        bounds: { x: 0, y: 0, width: 100, height: 50 },
        center_x: 50,
        center_y: 25,
        clickable: true,
      },
    ];
    mockAndroidGetUiTree.mockResolvedValueOnce(fakeTree);

    const result = await performObservation({
      mode: "ui_tree",
      platform: "android",
      deviceId: "dev1",
      delayMs: 0,
    });

    expect(result).toBeDefined();
    expect(result!.uiTree).toEqual(fakeTree);
    expect(result!.screenshot).toBeUndefined();
    expect(mockAndroidScreenshot).not.toHaveBeenCalled();
  });

  it("captures only screenshot when mode is 'screenshot'", async () => {
    mockAndroidScreenshot.mockResolvedValueOnce(Buffer.from("png"));
    mockCompressScreenshot.mockResolvedValueOnce({
      base64: "b64data",
      width: 540,
      height: 960,
    });

    const result = await performObservation({
      mode: "screenshot",
      platform: "android",
      deviceId: "dev1",
      delayMs: 0,
    });

    expect(result).toBeDefined();
    expect(result!.screenshot).toEqual({
      base64: "b64data",
      width: 540,
      height: 960,
    });
    expect(result!.uiTree).toBeUndefined();
    expect(mockAndroidGetUiTree).not.toHaveBeenCalled();
  });

  it("captures both UI tree and screenshot when mode is 'both'", async () => {
    const fakeTree: UiElement[] = [
      {
        index: 0,
        type: "View",
        text: "Hello",
        bounds: { x: 0, y: 0, width: 100, height: 50 },
        center_x: 50,
        center_y: 25,
        clickable: false,
      },
    ];
    mockAndroidGetUiTree.mockResolvedValueOnce(fakeTree);
    mockAndroidScreenshot.mockResolvedValueOnce(Buffer.from("png"));
    mockCompressScreenshot.mockResolvedValueOnce({
      base64: "img",
      width: 540,
      height: 960,
    });

    const result = await performObservation({
      mode: "both",
      platform: "android",
      deviceId: "dev1",
      delayMs: 0,
    });

    expect(result!.uiTree).toBeDefined();
    expect(result!.screenshot).toBeDefined();
  });

  it("uses iOS platform functions when platform is 'ios'", async () => {
    mockIosGetUiTree.mockResolvedValueOnce([]);

    await performObservation({
      mode: "ui_tree",
      platform: "ios",
      deviceId: "sim-1",
      delayMs: 0,
    });

    expect(mockIosGetUiTree).toHaveBeenCalledWith("sim-1");
    expect(mockAndroidGetUiTree).not.toHaveBeenCalled();
  });

  it("calls filterUiElements on the captured tree", async () => {
    const fakeTree: UiElement[] = [
      {
        index: 0,
        type: "View",
        text: "",
        bounds: { x: 0, y: 0, width: 100, height: 50 },
        center_x: 50,
        center_y: 25,
        clickable: false,
      },
    ];
    mockAndroidGetUiTree.mockResolvedValueOnce(fakeTree);
    mockFilterUiElements.mockReturnValueOnce([]);

    const result = await performObservation({
      mode: "ui_tree",
      platform: "android",
      delayMs: 0,
      filterUi: true,
    });

    expect(mockFilterUiElements).toHaveBeenCalledWith(fakeTree, false);
    expect(result!.uiTree).toEqual([]);
  });

  it("passes includeAll=true when filterUi is false", async () => {
    mockAndroidGetUiTree.mockResolvedValueOnce([]);
    mockFilterUiElements.mockReturnValueOnce([]);

    await performObservation({
      mode: "ui_tree",
      platform: "android",
      delayMs: 0,
      filterUi: false,
    });

    // filterUi=false => !(false) => includeAll=true
    expect(mockFilterUiElements).toHaveBeenCalledWith([], true);
  });
});
