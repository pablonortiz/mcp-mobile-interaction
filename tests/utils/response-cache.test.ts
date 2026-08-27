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
