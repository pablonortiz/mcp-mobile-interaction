import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as android from "../platforms/android.js";
import * as ios from "../platforms/ios.js";
import { performObservation } from "../utils/observe.js";
import { buildResponseContent } from "../utils/format-response.js";

export function registerLongPressTool(server: McpServer) {
  server.tool(
    "long_press",
    "Long-press at a specific coordinate on the device screen",
    {
      platform: z.enum(["android", "ios"]).describe("Target platform"),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit to use the first connected device."),
      x: z.number().int().describe("X coordinate to long-press"),
      y: z.number().int().describe("Y coordinate to long-press"),
      duration_ms: z
        .number()
        .int()
        .optional()
        .describe("Duration of the long press in milliseconds. Default: 1000"),
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
    async ({ platform, device_id, x, y, duration_ms, observe, observe_delay_ms, observe_stabilize }) => {
      const duration = duration_ms ?? 1000;

      if (platform === "android") {
        await android.longPress(x, y, duration, device_id);
      } else {
        await ios.longPress(x, y, duration, device_id);
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
          `Long-pressed at (${x}, ${y}) for ${duration}ms on ${platform} device`,
          observation,
        ),
      };
    },
  );
}
