import { describeNearMisses, similarity } from "../../src/utils/similar-elements.js";
import type { UiElement } from "../../src/types.js";

function makeElement(
  text: string,
  overrides: Partial<UiElement> = {},
): UiElement {
  return {
    text,
    type: "android.widget.TextView",
    clickable: true,
    enabled: true,
    bounds: { x: 0, y: 0, width: 100, height: 40 },
    center_x: 50,
    center_y: 20,
    ...overrides,
  } as UiElement;
}

describe("similarity", () => {
  it("scores an exact match highest", () => {
    expect(similarity("Ingreso manual", "Ingreso manual")).toBe(1);
  });

  it("scores a substring near the top", () => {
    expect(similarity("Ingreso", "Ingreso manual")).toBeGreaterThan(0.8);
  });

  it("scores a reworded label as similar but not equal", () => {
    const score = similarity("Ingreso manual", "Ingresar manual");
    expect(score).toBeGreaterThan(0.6);
    expect(score).toBeLessThan(1);
  });

  it("scores unrelated text low", () => {
    expect(similarity("Ingreso manual", "Cerrar sesión")).toBeLessThan(0.4);
  });
});

describe("describeNearMisses", () => {
  it("names the closest labels on screen", () => {
    const tree = [
      makeElement("Ingresar manual"),
      makeElement("Cerrar sesión"),
      makeElement("Ingreso rápido"),
    ];
    const hint = describeNearMisses(tree, { text_contains: "Ingreso manual" });
    expect(hint).toContain("Ingresar manual");
    expect(hint).not.toContain("Cerrar sesión");
  });

  it("flags a match that would not have been tappable anyway", () => {
    const tree = [makeElement("Ingresar manual", { clickable: false })];
    expect(describeNearMisses(tree, { text_contains: "Ingreso manual" })).toContain(
      "[not clickable]",
    );
  });

  it("flags a disabled near-miss", () => {
    const tree = [makeElement("Ingresar manual", { enabled: false })];
    expect(describeNearMisses(tree, { text_contains: "Ingreso manual" })).toContain(
      "[disabled]",
    );
  });

  it("compares against resource ids when that is the criterion", () => {
    const tree = [
      makeElement("", { resource_id: "submit-keyboard-picker" }),
      makeElement("", { resource_id: "cancel-button" }),
    ];
    const hint = describeNearMisses(tree, { resource_id: "submit-keyboard" });
    expect(hint).toContain("submit-keyboard-picker");
    expect(hint).not.toContain("cancel-button");
  });

  it("says nothing when nothing is close", () => {
    const tree = [makeElement("Cerrar sesión"), makeElement("Configuración")];
    expect(describeNearMisses(tree, { text_contains: "Ingreso manual" })).toBe("");
  });

  it("says nothing when the criterion is not text-based", () => {
    expect(describeNearMisses([makeElement("x")], { clickable: true })).toBe("");
  });

  it("caps the list at three candidates", () => {
    const tree = Array.from({ length: 8 }, (_, index) =>
      makeElement(`Ingreso manual ${index}`),
    );
    const hint = describeNearMisses(tree, { text_contains: "Ingreso manual" });
    expect(hint.match(/%\)/g)).toHaveLength(3);
  });
});
