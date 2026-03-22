import { matchElement, hasCriteria, describeCriteria, type MatchCriteria } from "../../src/utils/element-matcher.js";
import type { UiElement } from "../../src/types.js";

function makeElement(overrides: Partial<UiElement> = {}): UiElement {
  return {
    index: 0,
    type: "TextView",
    text: "Hello World",
    bounds: { x: 0, y: 100, width: 200, height: 50 },
    center_x: 100,
    center_y: 125,
    clickable: false,
    resource_id: "greeting_text",
    enabled: true,
    focused: false,
    ...overrides,
  };
}

describe("matchElement", () => {
  it("matches when no criteria are provided (all undefined)", () => {
    expect(matchElement(makeElement(), {})).toBe(true);
  });

  it("matches text_exact", () => {
    expect(matchElement(makeElement(), { text_exact: "Hello World" })).toBe(true);
    expect(matchElement(makeElement(), { text_exact: "hello world" })).toBe(false);
  });

  it("matches text_contains case-insensitively", () => {
    expect(matchElement(makeElement(), { text_contains: "hello" })).toBe(true);
    expect(matchElement(makeElement(), { text_contains: "WORLD" })).toBe(true);
    expect(matchElement(makeElement(), { text_contains: "missing" })).toBe(false);
  });

  it("matches resource_id case-insensitively", () => {
    expect(matchElement(makeElement(), { resource_id: "greeting" })).toBe(true);
    expect(matchElement(makeElement(), { resource_id: "GREETING" })).toBe(true);
    expect(matchElement(makeElement(), { resource_id: "missing" })).toBe(false);
  });

  it("matches type_contains case-insensitively", () => {
    expect(matchElement(makeElement(), { type_contains: "text" })).toBe(true);
    expect(matchElement(makeElement(), { type_contains: "Button" })).toBe(false);
  });

  it("matches clickable", () => {
    expect(matchElement(makeElement({ clickable: true }), { clickable: true })).toBe(true);
    expect(matchElement(makeElement({ clickable: false }), { clickable: true })).toBe(false);
  });

  it("requires all criteria to match (AND logic)", () => {
    expect(matchElement(makeElement(), { text_contains: "Hello", resource_id: "greeting" })).toBe(true);
    expect(matchElement(makeElement(), { text_contains: "Hello", resource_id: "missing" })).toBe(false);
  });

  it("handles undefined resource_id in element", () => {
    const el = makeElement({ resource_id: undefined });
    expect(matchElement(el, { resource_id: "any" })).toBe(false);
  });
});

describe("hasCriteria", () => {
  it("returns false for empty criteria", () => {
    expect(hasCriteria({})).toBe(false);
  });

  it("returns true when any criterion is defined", () => {
    expect(hasCriteria({ text_contains: "hello" })).toBe(true);
    expect(hasCriteria({ resource_id: "id" })).toBe(true);
    expect(hasCriteria({ type_contains: "Button" })).toBe(true);
  });
});

describe("describeCriteria", () => {
  it("describes single criterion", () => {
    expect(describeCriteria({ text_contains: "hello" })).toBe('text_contains: "hello"');
  });

  it("describes multiple criteria", () => {
    const desc = describeCriteria({ text_contains: "hello", resource_id: "btn" });
    expect(desc).toContain('text_contains: "hello"');
    expect(desc).toContain('resource_id: "btn"');
  });
});
