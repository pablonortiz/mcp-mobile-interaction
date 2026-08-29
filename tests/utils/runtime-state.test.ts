import { describeRuntimeState } from "../../src/utils/runtime-state.js";
import type { UiElement } from "../../src/types.js";

function makeElement(text: string, type = "android.widget.TextView"): UiElement {
  return {
    text,
    type,
    clickable: false,
    enabled: true,
    bounds: { x: 0, y: 0, width: 10, height: 10 },
    center_x: 5,
    center_y: 5,
  } as UiElement;
}

describe("describeRuntimeState", () => {
  it("reports a JS runtime that has not booted", () => {
    const tree = [makeElement("[runtime not ready]"), makeElement("a"), makeElement("b")];
    expect(describeRuntimeState(tree)).toContain("still loading its bundle");
  });

  it("reports a missing session instead of a missing element", () => {
    const tree = [makeElement("User not logged in"), makeElement("a"), makeElement("b")];
    expect(describeRuntimeState(tree)).toContain("Log in first");
  });

  it("reports a connectivity error", () => {
    const tree = [makeElement("Sin conexión"), makeElement("a"), makeElement("b")];
    expect(describeRuntimeState(tree)).toContain("waiting on the network");
  });

  it("reports a visible loading indicator", () => {
    const tree = [
      makeElement("", "android.widget.ProgressBar"),
      makeElement("Cargando"),
      makeElement("x"),
    ];
    expect(describeRuntimeState(tree)).toContain("still fetching");
  });

  it("reports an unrendered screen", () => {
    expect(describeRuntimeState([makeElement("")])).toContain("not rendered yet");
  });

  it("stays quiet on a normal populated screen", () => {
    const tree = ["Inicio", "Rutas", "Paradas", "Perfil"].map((text) => makeElement(text));
    expect(describeRuntimeState(tree)).toBe("");
  });
});
