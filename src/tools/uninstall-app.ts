import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDriver } from "../platforms/driver.js";
import { DESTRUCTIVE } from "../utils/annotations.js";

export function registerUninstallAppTool(server: McpServer) {
  server.tool(
    "uninstall_app",
    "Uninstall an app from the device by package name (Android) or bundle ID (iOS). Removes all app data.",
    {
      platform: z.enum(["android", "ios"]).describe("Target platform"),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit to use the first connected device."),
      package: z
        .string()
        .describe("App package name (Android) or bundle ID (iOS)"),
    },
    DESTRUCTIVE,
    async ({ platform, device_id, package: packageName }) => {
      const driver = getDriver(platform);
      const deviceId = device_id ?? (await driver.getFirstDeviceId());

      await driver.uninstallApp(deviceId, packageName);

      return {
        content: [{
          type: "text" as const,
          text: `Uninstalled "${packageName}" from ${platform} device ${deviceId}.`,
        }],
      };
    },
  );
}
