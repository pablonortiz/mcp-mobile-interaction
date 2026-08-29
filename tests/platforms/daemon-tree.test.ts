import { parseDaemonTree } from "../../src/platforms/daemon-tree.js";

const HEADER = "MS=4 NODES=3\n";
const line = (parts: string[]) => parts.join("|");

describe("parseDaemonTree", () => {
  it("parses a node into the same shape the XML path produces", () => {
    const payload = HEADER + line([
      "0", "android.widget.TextView", "Iniciar Control", "", "", "false", "true", "false", "false", "382,2175,698,2242",
    ]) + "\n";

    const [element] = parseDaemonTree(payload);
    expect(element.type).toBe("TextView");
    expect(element.text).toBe("Iniciar Control");
    expect(element.clickable).toBe(false);
    expect(element.bounds).toEqual({ x: 382, y: 2175, width: 316, height: 67 });
    expect(element.center_x).toBe(540);
    expect(element.center_y).toBe(2209);
  });

  it("merges text and content-desc the way the XML parser does", () => {
    // Matching across the codebase depends on that single merged field.
    const payload = HEADER + line([
      "0", "android.widget.Button", "", "", "TabStack, back", "true", "true", "false", "false", "29,175,108,254",
    ]) + "\n";
    expect(parseDaemonTree(payload)[0].text).toBe("TabStack, back");
  });

  it("keeps both when the node has text and a description", () => {
    const payload = HEADER + line([
      "0", "android.view.ViewGroup", "Cant.", "", "counter", "true", "true", "false", "false", "0,0,10,10",
    ]) + "\n";
    expect(parseDaemonTree(payload)[0].text).toBe("Cant., counter");
  });

  it("drops icon-font glyphs, which carry no readable meaning", () => {
    const payload = HEADER + line([
      "0", "android.widget.TextView", "", "", "", "false", "true", "false", "false", "0,0,10,10",
    ]) + "\n";
    expect(parseDaemonTree(payload)[0].text).toBe("");
  });

  it("carries resource id and scrollable through", () => {
    const payload = HEADER + line([
      "0", "android.widget.ScrollView", "", "com.app:id/list", "", "false", "true", "false", "true", "0,606,1080,2180",
    ]) + "\n";
    const [element] = parseDaemonTree(payload);
    expect(element.resource_id).toBe("com.app:id/list");
    expect(element.scrollable).toBe(true);
  });

  it("ignores malformed lines instead of failing the whole read", () => {
    const payload = HEADER + "garbage\n" + line([
      "0", "android.widget.TextView", "ok", "", "", "false", "true", "false", "false", "0,0,10,10",
    ]) + "\n";
    expect(parseDaemonTree(payload)).toHaveLength(1);
  });

  it("returns nothing for an empty payload", () => {
    expect(parseDaemonTree("MS=1 NODES=0\n")).toEqual([]);
  });
});
