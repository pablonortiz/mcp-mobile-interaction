import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDriver } from "../platforms/driver.js";
import { compressScreenshot } from "../utils/image.js";
import { filterUiElements } from "../utils/ui-filter.js";
import { formatUiTree } from "../utils/format-ui.js";
import { READ_ONLY } from "../utils/annotations.js";

export function registerGetScreenStateTool(server: McpServer) {
  server.tool(
    "get_screen_state",
    "Get the current screen state: UI tree and/or screenshot in a single call. UI tree is filtered to relevant elements by default.",
    {
      platform: z.enum(["android", "ios"]).describe("Target platform"),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit to use the first connected device."),
      include: z
        .enum(["ui_tree", "screenshot", "both"])
        .optional()
        .describe("What to capture. Default: both"),
      filter_ui: z
        .boolean()
        .optional()
        .describe("Filter UI tree to relevant elements only (with text or clickable). Default: true"),
      max_elements: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe("Maximum elements to return; the rest is summarized. Default: 120"),
    },
    READ_ONLY,
    async ({ platform, device_id, include, filter_ui, max_elements }) => {
      const driver = getDriver(platform);
      const mode = include ?? "both";
      const wantTree = mode === "ui_tree" || mode === "both";
      const wantScreenshot = mode === "screenshot" || mode === "both";

      // Capture in parallel
      const [tree, screenshotBuffer] = await Promise.all([
        wantTree ? driver.getUiTree(device_id) : undefined,
        wantScreenshot ? driver.screenshot(device_id) : undefined,
      ]);

      const content: Array<
        | { type: "text"; text: string }
        | { type: "image"; data: string; mimeType: "image/jpeg" }
      > = [];

      if (tree) {
        const filtered = filterUiElements(tree, !(filter_ui ?? true));
        content.push({
          type: "text" as const,
          text: formatUiTree(filtered, "UI tree", max_elements),
        });
      }

      if (screenshotBuffer) {
        const { base64, width, height, nativeWidth, nativeHeight, scale } = await compressScreenshot(
          screenshotBuffer,
        );
        content.push({
          type: "image" as const,
          data: base64,
          mimeType: "image/jpeg" as const,
        });
        content.push({
          type: "text" as const,
          text: `Screenshot captured (${width}x${height}, scale=${scale} of native ${nativeWidth}x${nativeHeight}). Coordinate tools expect native resolution — multiply screenshot pixel positions by ${Math.round(1 / scale)} to convert, or pass screenshot_scale=${scale}.`,
        });
      }

      return { content };
    },
  );
}
