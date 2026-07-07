import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDriver } from "../platforms/driver.js";
import { performObservation } from "../utils/observe.js";
import { buildResponseContent } from "../utils/format-response.js";
import { DESTRUCTIVE } from "../utils/annotations.js";

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
    DESTRUCTIVE,
    async ({ platform, device_id, package: packageName, mode, observe, observe_delay_ms }) => {
      const driver = getDriver(platform);
      const deviceId = device_id ?? (await driver.getFirstDeviceId());

      let responseText: string;

      if (mode === "all") {
        await driver.clearAppData(deviceId, packageName);
        responseText = platform === "android"
          ? `All app data cleared for "${packageName}" on Android device ${deviceId}\nThe app is now in fresh install state.`
          : `App "${packageName}" uninstalled from iOS device ${deviceId}.\nReinstall the app to use it again.`;
      } else {
        try {
          await driver.clearAppCache(deviceId, packageName);
          responseText = platform === "android"
            ? `App cache cleared for "${packageName}" on Android device ${deviceId}\nCleared: cache/, code_cache/\nStorage, databases and login preserved.`
            : `App cache cleared for "${packageName}" on iOS device ${deviceId}\nCleared: Library/Caches/, tmp/`;
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
