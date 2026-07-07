import { unescapeXml } from "../../src/utils/xml.js";

describe("unescapeXml", () => {
  it("decodes the five named XML entities", () => {
    expect(unescapeXml("Ropa &amp; Accesorios")).toBe("Ropa & Accesorios");
    expect(unescapeXml("&lt;tag&gt;")).toBe("<tag>");
    expect(unescapeXml("&quot;quoted&quot;")).toBe('"quoted"');
    expect(unescapeXml("it&apos;s")).toBe("it's");
  });

  it("decodes decimal numeric entities", () => {
    expect(unescapeXml("a&#10;b")).toBe("a\nb");
  });

  it("decodes hexadecimal numeric entities", () => {
    expect(unescapeXml("&#x41;")).toBe("A");
  });

  it("leaves text without entities untouched", () => {
    expect(unescapeXml("plain text 100%")).toBe("plain text 100%");
  });

  it("handles double-escaped content one level at a time", () => {
    expect(unescapeXml("&amp;amp;")).toBe("&amp;");
  });
});
