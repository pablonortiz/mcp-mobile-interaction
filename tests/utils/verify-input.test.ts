import { jest } from "@jest/globals";
import type { UiElement } from "../../src/types.js";

const mockGetUiTree = jest.fn<() => Promise<UiElement[]>>();

const { verifyTypedText } = await import("../../src/utils/verify-input.js");

const readTree = () => mockGetUiTree();

function makeField(text: string, overrides: Partial<UiElement> = {}): UiElement {
  return {
    text,
    type: "android.widget.EditText",
    clickable: true,
    enabled: true,
    focused: true,
    bounds: { x: 0, y: 0, width: 100, height: 40 },
    center_x: 50,
    center_y: 20,
    ...overrides,
  } as UiElement;
}

beforeEach(() => jest.clearAllMocks());

describe("verifyTypedText", () => {
  it("confirms text that landed in the field", async () => {
    mockGetUiTree.mockResolvedValue([makeField("001-D-01-1")]);
    expect(await verifyTypedText(readTree, "001-D-01-1")).toEqual({ ok: true });
  });

  it("catches a field still showing its placeholder", async () => {
    // uiautomator reports a hint in the same attribute as real content, so an
    // unchanged field is the only signal that the keystrokes were dropped.
    mockGetUiTree.mockResolvedValue([makeField("Slot 02-3-32")]);
    const result = await verifyTypedText(readTree, "001-D-01-1");
    expect(result.ok).toBe(false);
    expect(result.note).toContain("Slot 02-3-32");
  });

  it("accepts text the field reformatted around", async () => {
    mockGetUiTree.mockResolvedValue([makeField("$ 1500 ARS")]);
    expect((await verifyTypedText(readTree, "1500")).ok).toBe(true);
  });

  it("does not fail the action when no field is focused", async () => {
    mockGetUiTree.mockResolvedValue([makeField("x", { focused: false })]);
    const result = await verifyTypedText(readTree, "x");
    expect(result.ok).toBe(true);
    expect(result.note).toContain("no focused input field");
  });

  it("ignores a focused element that is not an input", async () => {
    mockGetUiTree.mockResolvedValue([
      makeField("Button label", { type: "android.widget.Button" }),
    ]);
    expect((await verifyTypedText(readTree, "x")).note).toContain(
      "no focused input field",
    );
  });

  it("does not fail the action when the tree cannot be read", async () => {
    mockGetUiTree.mockRejectedValue(new Error("no idle state"));
    const result = await verifyTypedText(readTree, "x");
    expect(result.ok).toBe(true);
    expect(result.note).toContain("UI tree was unavailable");
  });
});
