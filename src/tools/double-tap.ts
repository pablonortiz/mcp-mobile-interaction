import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as android from "../platforms/android.js";
import * as ios from "../platforms/ios.js";
import { performObservation } from "../utils/observe.js";
import { buildResponseContent } from "../utils/format-response.js";

export function registerDoubleTapTool(server: McpServer) {
  server.tool(
    "double_tap",
    "Double-tap at a specific coordinate on the device screen",
    {
      platform: z.enum(["android", "ios"]).describe("Target platform"),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit to use the first connected device."),
      x: z.number().int().describe("X coordinate to double-tap"),
      y: z.number().int().describe("Y coordinate to double-tap"),
      observe: z
        .enum(["none", "ui_tree", "screenshot", "both"])
        .optional()
        .describe(
          "Capture screen state after action. Default: none",
        ),
      observe_delay_ms: z
        .number()
        .int()
        .optional()
        .describe("Ms to wait before observing. Default: 500"),
      observe_stabilize: z
        .boolean()
        .optional()
        .describe(
          "If true, wait for UI to stabilize instead of fixed delay. Default: false",
        ),
    },
    async ({ platform, device_id, x, y, observe, observe_delay_ms, observe_stabilize }) => {
      if (platform === "android") {
        await android.doubleTap(x, y, device_id);
      } else {
        await ios.doubleTap(x, y, device_id);
      }

      const observation = await performObservation({
        mode: observe ?? "none",
        platform,
        deviceId: device_id,
        delayMs: observe_delay_ms ?? 500,
        stabilize: observe_stabilize,
      });

      return {
        content: buildResponseContent(
          `Double-tapped at (${x}, ${y}) on ${platform} device`,
          observation,
        ),
      };
    },
  );
}
