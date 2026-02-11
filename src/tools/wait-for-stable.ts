import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { waitForStableUiTree } from "../utils/observe.js";
import { filterUiElements } from "../utils/ui-filter.js";
import * as android from "../platforms/android.js";
import * as ios from "../platforms/ios.js";
import { compressScreenshot } from "../utils/image.js";

export function registerWaitForStableTool(server: McpServer) {
  server.tool(
    "wait_for_stable",
    "Wait until the screen stops changing (two consecutive UI tree snapshots are identical). Returns the stable UI tree and optionally a screenshot.",
    {
      platform: z.enum(["android", "ios"]).describe("Target platform"),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit to use the first connected device."),
      timeout_ms: z
        .number()
        .int()
        .optional()
        .describe("Maximum time to wait in ms. Default: 10000"),
      poll_interval_ms: z
        .number()
        .int()
        .optional()
        .describe("Polling interval in ms. Default: 500"),
      include_screenshot: z
        .boolean()
        .optional()
        .describe("Also capture a screenshot after stabilization. Default: false"),
      filter_ui: z
        .boolean()
        .optional()
        .describe("Filter UI tree to relevant elements only. Default: true"),
    },
    async ({
      platform,
      device_id,
      timeout_ms,
      poll_interval_ms,
      include_screenshot,
      filter_ui,
    }) => {
      const tree = await waitForStableUiTree(
        platform,
        device_id,
        poll_interval_ms ?? 500,
        timeout_ms ?? 10_000,
      );

      const filtered = filterUiElements(tree, !(filter_ui ?? true));

      const content: Array<
        | { type: "text"; text: string }
        | { type: "image"; data: string; mimeType: "image/jpeg" }
      > = [
        {
          type: "text" as const,
          text: `Screen stabilized (${filtered.length} elements):\n${JSON.stringify(filtered, null, 2)}`,
        },
      ];

      if (include_screenshot) {
        const buffer =
          platform === "android"
            ? await android.screenshot(device_id)
            : await ios.screenshot(device_id);
        const { base64, width, height } = await compressScreenshot(buffer);
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
