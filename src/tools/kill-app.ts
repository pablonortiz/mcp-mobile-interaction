import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as android from "../platforms/android.js";
import * as ios from "../platforms/ios.js";
import { performObservation } from "../utils/observe.js";
import { buildResponseContent } from "../utils/format-response.js";

export function registerKillAppTool(server: McpServer) {
  server.tool(
    "kill_app",
    "Force-stop an application by package name (Android) or bundle ID (iOS)",
    {
      platform: z.enum(["android", "ios"]).describe("Target platform"),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit to use the first connected device."),
      package: z
        .string()
        .describe("App package name (Android, e.g. com.example.app) or bundle ID (iOS, e.g. com.apple.mobilesafari)"),
      observe: z
        .enum(["none", "screenshot"])
        .optional()
        .describe("Capture screenshot after action. Default: none"),
      observe_delay_ms: z
        .number()
        .int()
        .optional()
        .describe("Ms to wait before observing. Default: 500"),
    },
    async ({ platform, device_id, package: packageName, observe, observe_delay_ms }) => {
      const deviceId = device_id ??
        (platform === "android"
          ? await android.getFirstDeviceId()
          : await ios.getFirstDeviceId());

      if (platform === "android") {
        await android.killApp(deviceId, packageName);
      } else {
        await ios.killApp(deviceId, packageName);
      }

      const observation = observe === "screenshot"
        ? await performObservation({
            mode: "screenshot",
            platform,
            deviceId,
            delayMs: observe_delay_ms ?? 500,
          })
        : undefined;

      return {
        content: buildResponseContent(
          `App "${packageName}" killed on ${platform} device ${deviceId}`,
          observation,
        ),
      };
    },
  );
}
