import { describeForegroundContext } from "../../src/utils/foreground-context.js";
import type { UiElement } from "../../src/types.js";

function makeTree(...labels: string[]): UiElement[] {
  return labels.map((text) => ({ text }) as UiElement);
}

describe("describeForegroundContext", () => {
  it("stays quiet when the app under test is on screen", () => {
    const result = describeForegroundContext(
      "in.janis.wms.beta",
      "in.janis.wms.beta",
      [],
    );
    expect(result.offApp).toBe(false);
    expect(result.note).toBe("");
  });

  it("names the app that took over", () => {
    const result = describeForegroundContext(
      "com.other.app",
      "in.janis.wms.beta",
      [],
    );
    expect(result.offApp).toBe(true);
    expect(result.note).toContain("com.other.app, not in.janis.wms.beta");
  });

  it("recognizes the launcher by package", () => {
    const result = describeForegroundContext(
      "com.google.android.apps.nexuslauncher",
      undefined,
      [],
    );
    expect(result.offApp).toBe(true);
    expect(result.note).toContain("device home screen");
  });

  it("recognizes a system permission dialog", () => {
    const result = describeForegroundContext(
      "com.google.android.permissioncontroller",
      undefined,
      [],
    );
    expect(result.note).toContain("permission dialog");
  });

  it("falls back to home-screen shortcuts when no package is known", () => {
    // The exact tree that made a missing element look like a selector bug.
    const tree = makeTree("Play Store", "Phone", "Messages", "Chrome");
    expect(describeForegroundContext(undefined, undefined, tree).offApp).toBe(true);
  });

  it("does not call an app screen the launcher on one coincidence", () => {
    const tree = makeTree("Phone", "Confirmar", "Ingresar cantidad");
    expect(describeForegroundContext(undefined, undefined, tree).offApp).toBe(false);
  });

  it("says nothing about an unknown third-party package", () => {
    expect(describeForegroundContext("com.example.other", undefined, []).offApp).toBe(
      false,
    );
  });
});
