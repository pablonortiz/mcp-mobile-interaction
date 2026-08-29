import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  resolvePlatform,
  PLATFORM_DESCRIPTION,
} from "../utils/resolve-platform.js";
import { getDriver } from "../platforms/driver.js";
import { performObservation } from "../utils/observe.js";
import { buildResponseContent } from "../utils/format-response.js";
import { ACTION } from "../utils/annotations.js";

export function registerLaunchAppTool(server: McpServer) {
  server.tool(
    "launch_app",
    "Launch an app on the device by package name (Android) or bundle ID (iOS)",
    {
      platform: z.enum(["android", "ios"]).optional().describe(PLATFORM_DESCRIPTION),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit for the connected device."),
      package: z
        .string()
        .describe(
          "App package name (Android, e.g. com.example.app) or bundle ID (iOS, e.g. com.apple.mobilesafari)",
        ),
      observe: z
        .enum(["none", "ui_tree", "screenshot", "both", "on_change"])
        .optional()
        .describe('Capture screen state after the action. "on_change" returns the first tree that differs — catches a toast a fixed delay would miss. Default: none'),
      observe_delay_ms: z
        .number()
        .int()
        .optional()
        .describe("Ms to wait before observing. Default: 500"),
      observe_stabilize: z
        .boolean()
        .optional()
        .describe("Wait for the UI to settle instead of a fixed delay. Default: false"),
    },
    ACTION,
    async ({ platform: platformArg, device_id, package: pkg, observe, observe_delay_ms, observe_stabilize }) => {
      const platform = await resolvePlatform(platformArg);
      await getDriver(platform).launchApp(pkg, device_id);

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
