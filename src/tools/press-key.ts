import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as android from "../platforms/android.js";
import * as ios from "../platforms/ios.js";
import { performObservation } from "../utils/observe.js";
import { buildResponseContent } from "../utils/format-response.js";

export function registerPressKeyTool(server: McpServer) {
  server.tool(
    "press_key",
    "Press a hardware or navigation key on the device (home, back, enter, delete, volume_up, volume_down, power, tab, recent_apps)",
    {
      platform: z.enum(["android", "ios"]).describe("Target platform"),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit to use the first connected device."),
      key: z
        .enum([
          "home",
          "back",
          "enter",
          "delete",
          "volume_up",
          "volume_down",
          "power",
          "tab",
          "recent_apps",
        ])
        .describe("Key to press"),
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
    async ({ platform, device_id, key, observe, observe_delay_ms, observe_stabilize }) => {
      if (platform === "android") {
        await android.pressKey(key, device_id);
      } else {
        await ios.pressKey(key, device_id);
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
          `Pressed "${key}" on ${platform} device`,
          observation,
        ),
      };
    },
  );
}
