import { parseSelector, describeSelector } from "../../src/flow/selector.js";

describe("parseSelector", () => {
  it("treats a string shorthand as text_contains", () => {
    expect(parseSelector("Login", "step")).toEqual({
      criteria: { text_contains: "Login" },
      index: 0,
    });
  });

  it("maps Maestro keys to MatchCriteria", () => {
    expect(parseSelector({ text: "Ok", id: "confirm_btn", index: 2 }, "step")).toEqual({
      criteria: { text_contains: "Ok", resource_id: "confirm_btn" },
      index: 2,
    });
  });

  it("supports the type and clickable extensions", () => {
    expect(parseSelector({ type: "Button", clickable: true }, "step").criteria).toEqual({
      type_contains: "Button",
      clickable: true,
    });
  });

  it("rejects empty selectors", () => {
    expect(() => parseSelector({}, "step")).toThrow(/at least one of/);
  });

  it("rejects negative index", () => {
    expect(() => parseSelector({ text: "x", index: -1 }, "step")).toThrow(/index/);
  });

  it("rejects non-string, non-map selectors", () => {
    expect(() => parseSelector(42, "step")).toThrow(/string or a map/);
  });
});

describe("describeSelector", () => {
  it("summarizes criteria compactly", () => {
    const selector = parseSelector({ text: "Ok", id: "btn", index: 1 }, "step");
    expect(describeSelector(selector)).toBe('"Ok" id:btn index:1');
  });
});
