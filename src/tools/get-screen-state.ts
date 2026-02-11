import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as android from "../platforms/android.js";
import * as ios from "../platforms/ios.js";
import { compressScreenshot } from "../utils/image.js";
import { filterUiElements } from "../utils/ui-filter.js";

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
    },
    async ({ platform, device_id, include, filter_ui }) => {
      const mode = include ?? "both";
      const wantTree = mode === "ui_tree" || mode === "both";
      const wantScreenshot = mode === "screenshot" || mode === "both";

      // Capture in parallel
      const [tree, screenshotBuffer] = await Promise.all([
        wantTree
          ? platform === "android"
            ? android.getUiTree(device_id)
            : ios.getUiTree(device_id)
          : undefined,
        wantScreenshot
          ? platform === "android"
            ? android.screenshot(device_id)
            : ios.screenshot(device_id)
          : undefined,
      ]);

      const content: Array<
        | { type: "text"; text: string }
        | { type: "image"; data: string; mimeType: "image/jpeg" }
      > = [];

      if (tree) {
        const filtered = filterUiElements(tree, !(filter_ui ?? true));
        content.push({
          type: "text" as const,
          text: `UI Tree (${filtered.length} elements):\n${JSON.stringify(filtered, null, 2)}`,
        });
      }

      if (screenshotBuffer) {
        const { base64, width, height } = await compressScreenshot(
          screenshotBuffer,
        );
        content.push({
          type: "image" as const,
          data: base64,
          mimeType: "image/jpeg" as const,
        });
        content.push({
          type: "text" as const,
          text: `Screenshot captured (${width}x${height})`,
        });
      }

      return { content };
    },
  );
}
