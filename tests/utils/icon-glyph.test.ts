import { isIconGlyph } from "../../src/utils/xml.js";

describe("isIconGlyph", () => {
  it("recognizes the Private Use Area glyphs icon fonts use", () => {
    // Both observed live in the WMS app, printing as empty strings.
    expect(isIconGlyph("")).toBe(true);
    expect(isIconGlyph("")).toBe(true);
  });

  it("recognizes a run of glyphs", () => {
    expect(isIconGlyph("")).toBe(true);
  });

  it("leaves real text alone", () => {
    expect(isIconGlyph("Control de inventario")).toBe(false);
    expect(isIconGlyph("7")).toBe(false);
  });

  it("leaves emoji alone — those carry meaning", () => {
    expect(isIconGlyph("📦")).toBe(false);
  });

  it("treats mixed content as text", () => {
    expect(isIconGlyph(" Posición")).toBe(false);
  });

  it("says nothing about empty strings", () => {
    expect(isIconGlyph("")).toBe(false);
    expect(isIconGlyph("   ")).toBe(false);
  });
});
