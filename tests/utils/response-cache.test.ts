import {
  dedupeResponse,
  resetResponseCache,
} from "../../src/utils/response-cache.js";

beforeEach(() => resetResponseCache());

describe("dedupeResponse", () => {
  it("returns the payload the first time", () => {
    const result = dedupeResponse("tree:dev1", "a\nb\nc");
    expect(result.unchanged).toBe(false);
    expect(result.text).toBe("a\nb\nc");
  });

  it("suppresses an identical repeat and says why", () => {
    dedupeResponse("tree:dev1", "a\nb\nc");
    const result = dedupeResponse("tree:dev1", "a\nb\nc", {
      summary: "The UI tree (3 elements)",
    });
    expect(result.unchanged).toBe(true);
    expect(result.text).toContain("The UI tree (3 elements) is unchanged");
    expect(result.text).toContain("force_full");
  });

  it("emits again as soon as the payload differs", () => {
    dedupeResponse("tree:dev1", "a\nb\nc");
    const result = dedupeResponse("tree:dev1", "a\nb\nd");
    expect(result.unchanged).toBe(false);
    expect(result.text).toBe("a\nb\nd");
  });

  it("keeps separate keys independent", () => {
    dedupeResponse("tree:dev1", "same");
    const result = dedupeResponse("tree:dev2", "same");
    expect(result.unchanged).toBe(false);
  });

  it("honours force", () => {
    dedupeResponse("tree:dev1", "same");
    const result = dedupeResponse("tree:dev1", "same", { force: true });
    expect(result.unchanged).toBe(false);
    expect(result.text).toBe("same");
  });

  it("re-emits after the payload changed and came back", () => {
    dedupeResponse("tree:dev1", "first");
    dedupeResponse("tree:dev1", "second");
    const result = dedupeResponse("tree:dev1", "first");
    expect(result.unchanged).toBe(false);
  });

  it("stays bounded across many keys", () => {
    for (let i = 0; i < 100; i++) dedupeResponse(`tree:dev${i}`, "payload");
    // The oldest keys were evicted, so they emit in full again.
    expect(dedupeResponse("tree:dev0", "payload").unchanged).toBe(false);
  });
});

describe("pickAnchors", () => {
  it("prefers actionable labels", async () => {
    const { pickAnchors } = await import("../../src/utils/response-cache.js");
    const elements = [
      { text: "Cant.", clickable: false },
      { text: "Confirmar", clickable: true },
      { text: "Confirmar Y Controlar Nuevo", clickable: true },
    ] as never;
    expect(pickAnchors(elements)).toEqual([
      "Confirmar",
      "Confirmar Y Controlar Nuevo",
      "Cant.",
    ]);
  });

  it("falls back to plain labels when nothing is actionable", async () => {
    const { pickAnchors } = await import("../../src/utils/response-cache.js");
    const elements = [{ text: "Ingresar cantidad", clickable: false }] as never;
    expect(pickAnchors(elements)).toEqual(["Ingresar cantidad"]);
  });

  it("skips empty labels and duplicates", async () => {
    const { pickAnchors } = await import("../../src/utils/response-cache.js");
    const elements = [
      { text: "  ", clickable: true },
      { text: "Confirmar", clickable: true },
      { text: "Confirmar", clickable: false },
    ] as never;
    expect(pickAnchors(elements)).toEqual(["Confirmar"]);
  });
});

describe("unchanged notice with anchors", () => {
  it("names what is still on screen", async () => {
    const { dedupeResponse, resetResponseCache } = await import(
      "../../src/utils/response-cache.js"
    );
    resetResponseCache();
    dedupeResponse("k", "tree", { anchors: ["Confirmar"] });
    const again = dedupeResponse("k", "tree", { anchors: ["Confirmar", "Go back"] });
    expect(again.text).toContain('Still showing: "Confirmar", "Go back"');
  });

  it("stays terse when there are no anchors", async () => {
    const { dedupeResponse, resetResponseCache } = await import(
      "../../src/utils/response-cache.js"
    );
    resetResponseCache();
    dedupeResponse("k2", "tree");
    expect(dedupeResponse("k2", "tree").text).not.toContain("Still showing");
  });
});
