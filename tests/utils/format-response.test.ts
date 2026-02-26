import { buildResponseContent, ObservationResult } from "../../src/utils/format-response.js";

describe("buildResponseContent", () => {
  it("returns only confirmation text when no observation provided", () => {
    const result = buildResponseContent("Action completed");
    expect(result).toEqual([{ type: "text", text: "Action completed" }]);
  });

  it("returns only confirmation text when observation is undefined", () => {
    const result = buildResponseContent("Tapped at (100, 200)", undefined);
    expect(result).toEqual([{ type: "text", text: "Tapped at (100, 200)" }]);
  });

  it("appends UI tree text when observation includes uiTree", () => {
    const observation: ObservationResult = {
      uiTree: [
        {
          index: 0,
          type: "Button",
          text: "OK",
          bounds: { x: 10, y: 20, width: 100, height: 50 },
          center_x: 60,
          center_y: 45,
          clickable: true,
        },
      ],
    };
    const result = buildResponseContent("Done", observation);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ type: "text", text: "Done" });
    expect(result[1].type).toBe("text");
    expect((result[1] as { type: "text"; text: string }).text).toContain(
      "--- UI Tree (1 elements) ---"
    );
    expect((result[1] as { type: "text"; text: string }).text).toContain('"OK"');
  });

  it("appends screenshot image and dimension text when observation includes screenshot", () => {
    const observation: ObservationResult = {
      screenshot: { base64: "abc123", width: 540, height: 960 },
    };
    const result = buildResponseContent("Captured", observation);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ type: "text", text: "Captured" });
    expect(result[1]).toEqual({
      type: "image",
      data: "abc123",
      mimeType: "image/jpeg",
    });
    expect(result[2]).toEqual({
      type: "text",
      text: "Screenshot captured (540x960)",
    });
  });

  it("appends both UI tree and screenshot when observation has both", () => {
    const observation: ObservationResult = {
      uiTree: [
        {
          index: 0,
          type: "TextView",
          text: "Hello",
          bounds: { x: 0, y: 0, width: 200, height: 40 },
          center_x: 100,
          center_y: 20,
          clickable: false,
        },
      ],
      screenshot: { base64: "imgdata", width: 1080, height: 1920 },
    };
    const result = buildResponseContent("Action done", observation);
    // confirmation + ui tree text + image + screenshot dimension text
    expect(result).toHaveLength(4);
    expect(result[0].type).toBe("text");
    expect(result[1].type).toBe("text");
    expect(result[2].type).toBe("image");
    expect(result[3].type).toBe("text");
  });

  it("handles empty uiTree array correctly", () => {
    const observation: ObservationResult = {
      uiTree: [],
    };
    const result = buildResponseContent("Done", observation);
    expect(result).toHaveLength(2);
    expect((result[1] as { type: "text"; text: string }).text).toContain(
      "--- UI Tree (0 elements) ---"
    );
  });
});
