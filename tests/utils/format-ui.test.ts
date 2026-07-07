import { formatUiElement, formatUiElements, formatUiTree } from "../../src/utils/format-ui.js";
import type { UiElement } from "../../src/types.js";

function makeElement(overrides: Partial<UiElement> = {}): UiElement {
  return {
    index: 0,
    type: "Button",
    text: "OK",
    bounds: { x: 10, y: 20, width: 100, height: 50 },
    center_x: 60,
    center_y: 45,
    clickable: true,
    ...overrides,
  };
}

describe("formatUiElement", () => {
  it("renders index, type, text, center and size", () => {
    const line = formatUiElement(makeElement());
    expect(line).toBe('[0] Button "OK" @(60,45) 100x50 clickable');
  });

  it("includes resource_id with # prefix when present", () => {
    const line = formatUiElement(makeElement({ resource_id: "submit_btn" }));
    expect(line).toContain("#submit_btn");
  });

  it("renders disabled, focused and overlay flags", () => {
    const line = formatUiElement(
      makeElement({ enabled: false, focused: true, is_overlay: true }),
    );
    expect(line).toContain("disabled");
    expect(line).toContain("focused");
    expect(line).toContain("overlay");
  });

  it("omits the flags segment for inert elements", () => {
    const line = formatUiElement(makeElement({ clickable: false }));
    expect(line).toBe('[0] Button "OK" @(60,45) 100x50');
  });
});

describe("formatUiElements", () => {
  it("renders one line per element", () => {
    const output = formatUiElements([
      makeElement(),
      makeElement({ index: 1, text: "Cancel" }),
    ]);
    expect(output.split("\n")).toHaveLength(2);
  });

  it("caps output and summarizes the rest", () => {
    const elements = Array.from({ length: 130 }, (_, i) =>
      makeElement({ index: i }),
    );
    const output = formatUiElements(elements);
    const lines = output.split("\n");
    expect(lines).toHaveLength(121); // 120 shown + summary line
    expect(lines[120]).toContain("+10 more elements");
  });

  it("respects a custom maxElements", () => {
    const elements = Array.from({ length: 5 }, (_, i) =>
      makeElement({ index: i }),
    );
    const output = formatUiElements(elements, 2);
    expect(output.split("\n")).toHaveLength(3);
    expect(output).toContain("+3 more elements");
  });
});

describe("formatUiTree", () => {
  it("includes count, format legend and elements", () => {
    const output = formatUiTree([makeElement()], "UI tree");
    expect(output).toContain("UI tree (1;");
    expect(output).toContain("format:");
    expect(output).toContain('"OK"');
  });
});
