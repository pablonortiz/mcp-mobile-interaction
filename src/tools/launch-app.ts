import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as android from "../platforms/android.js";
import * as ios from "../platforms/ios.js";
import { performObservation } from "../utils/observe.js";
import { buildResponseContent } from "../utils/format-response.js";

export function registerLaunchAppTool(server: McpServer) {
  server.tool(
    "launch_app",
    "Launch an app on the device by package name (Android) or bundle ID (iOS)",
    {
      platform: z.enum(["android", "ios"]).describe("Target platform"),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit to use the first connected device."),
      package: z
        .string()
        .describe(
          "App package name (Android, e.g. com.example.app) or bundle ID (iOS, e.g. com.apple.mobilesafari)",
        ),
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
    async ({ platform, device_id, package: pkg, observe, observe_delay_ms, observe_stabilize }) => {
      if (platform === "android") {
        await android.launchApp(pkg, device_id);
      } else {
        await ios.launchApp(pkg, device_id);
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
          `Launched ${pkg} on ${platform} device`,
          observation,
        ),
      };
    },
  );
}
