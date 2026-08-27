import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { dedupeResponse } from "../utils/response-cache.js";
import {
  resolvePlatform,
  PLATFORM_DESCRIPTION,
} from "../utils/resolve-platform.js";
import { getDriver } from "../platforms/driver.js";
import { uiTreeSafe } from "../utils/ui-tree-fallback.js";
import { compressScreenshot } from "../utils/image.js";
import { filterUiElements } from "../utils/ui-filter.js";
import { formatUiTree } from "../utils/format-ui.js";
import { READ_ONLY } from "../utils/annotations.js";

export function registerGetScreenStateTool(server: McpServer) {
  server.tool(
    "get_screen_state",
    "Get the current screen state: UI tree and/or screenshot in a single call. UI tree is filtered to relevant elements by default.",
    {
      platform: z.enum(["android", "ios"]).optional().describe(PLATFORM_DESCRIPTION),
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
      force_full: z
        .boolean()
        .optional()
        .describe("Return the tree even when it is identical to the last read. Default: false"),
      max_elements: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe("Maximum elements to return; the rest is summarized. Default: 120"),
    },
    READ_ONLY,
    uiTreeSafe("read the screen state", async ({ platform: platformArg, device_id, include, filter_ui, max_elements, force_full }) => {
      const platform = await resolvePlatform(platformArg);
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
        const { text } = dedupeResponse(
          `screen_state:${platform}:${device_id ?? "default"}:${max_elements ?? "all"}`,
          formatUiTree(filtered, "UI tree", max_elements),
          {
            force: force_full,
            summary: `The UI tree (${filtered.length} elements)`,
          },
        );
        content.push({ type: "text" as const, text });
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
    }),
  );
}
