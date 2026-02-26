import { filterUiElements } from "../../src/utils/ui-filter.js";
import type { UiElement } from "../../src/types.js";

function makeElement(overrides: Partial<UiElement> = {}): UiElement {
  return {
    index: 0,
    type: "View",
    text: "",
    bounds: { x: 0, y: 0, width: 100, height: 50 },
    center_x: 50,
    center_y: 25,
    clickable: false,
    ...overrides,
  };
}

describe("filterUiElements", () => {
  it("returns all elements when includeAll is true", () => {
    const elements: UiElement[] = [
      makeElement({ text: "" }),
      makeElement({ text: "Visible", clickable: false }),
      makeElement({ text: "", clickable: false }),
    ];
    const result = filterUiElements(elements, true);
    expect(result).toHaveLength(3);
  });

  it("filters out elements with empty text and not clickable by default", () => {
    const elements: UiElement[] = [
      makeElement({ text: "", clickable: false }),
      makeElement({ text: "Hello", clickable: false }),
      makeElement({ text: "", clickable: true }),
    ];
    const result = filterUiElements(elements);
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe("Hello");
    expect(result[1].clickable).toBe(true);
  });

  it("keeps elements with only whitespace text if clickable", () => {
    const elements: UiElement[] = [
      makeElement({ text: "   ", clickable: false }),
      makeElement({ text: "   ", clickable: true }),
    ];
    const result = filterUiElements(elements);
    // "   ".trim() === "" so the first one is excluded unless clickable
    expect(result).toHaveLength(1);
    expect(result[0].clickable).toBe(true);
  });

  it("returns empty array when no elements match the filter", () => {
    const elements: UiElement[] = [
      makeElement({ text: "", clickable: false }),
      makeElement({ text: "  ", clickable: false }),
    ];
    const result = filterUiElements(elements);
    expect(result).toHaveLength(0);
  });

  it("returns empty array when input is empty", () => {
    const result = filterUiElements([]);
    expect(result).toHaveLength(0);
  });

  it("keeps all elements with non-empty text regardless of clickable state", () => {
    const elements: UiElement[] = [
      makeElement({ text: "Button", clickable: true }),
      makeElement({ text: "Label", clickable: false }),
    ];
    const result = filterUiElements(elements);
    expect(result).toHaveLength(2);
  });
});
