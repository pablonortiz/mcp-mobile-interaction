import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as android from "../platforms/android.js";
import * as ios from "../platforms/ios.js";
import { performObservation } from "../utils/observe.js";
import { buildResponseContent } from "../utils/format-response.js";

export function registerClearAppDataTool(server: McpServer) {
  server.tool(
    "clear_app_data",
    'Clear app data. Mode "cache" clears only temporary files (preserves storage, databases, login). Mode "all" returns app to fresh install state.',
    {
      platform: z.enum(["android", "ios"]).describe("Target platform"),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit to use the first connected device."),
      package: z
        .string()
        .describe("App package name (Android) or bundle ID (iOS)"),
      mode: z
        .enum(["cache", "all"])
        .default("cache")
        .describe('What to clear. "cache": only temporary files and cache (preserves storage, databases, login). "all": everything — app returns to fresh install state. Default: cache'),
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
    async ({ platform, device_id, package: packageName, mode, observe, observe_delay_ms }) => {
      const deviceId = device_id ??
        (platform === "android"
          ? await android.getFirstDeviceId()
          : await ios.getFirstDeviceId());

      let responseText: string;

      if (platform === "android") {
        if (mode === "all") {
          await android.clearAppData(deviceId, packageName);
          responseText = `All app data cleared for "${packageName}" on Android device ${deviceId}\nThe app is now in fresh install state.`;
        } else {
          try {
            await android.clearAppCache(deviceId, packageName);
            responseText = `App cache cleared for "${packageName}" on Android device ${deviceId}\nCleared: cache/, code_cache/\nStorage, databases and login preserved.`;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              content: [{
                type: "text" as const,
                text: `Failed to clear cache for "${packageName}": ${msg}\nThe app may not be debuggable. Try mode: "all" as an alternative (this will clear all data).`,
              }],
              isError: true,
            };
          }
        }
      } else {
        // iOS
        if (mode === "all") {
          await ios.clearAppData(deviceId, packageName);
          responseText = `App "${packageName}" uninstalled from iOS device ${deviceId}.\nReinstall the app to use it again.`;
        } else {
          try {
            await ios.clearAppCache(deviceId, packageName);
            responseText = `App cache cleared for "${packageName}" on iOS device ${deviceId}\nCleared: Library/Caches/, tmp/`;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              content: [{
                type: "text" as const,
                text: `Failed to clear cache for "${packageName}": ${msg}`,
              }],
              isError: true,
            };
          }
        }
      }

      const observation = observe === "screenshot"
        ? await performObservation({
            mode: "screenshot",
            platform,
            deviceId,
            delayMs: observe_delay_ms ?? 500,
          })
        : undefined;

      return { content: buildResponseContent(responseText, observation) };
    },
  );
}
