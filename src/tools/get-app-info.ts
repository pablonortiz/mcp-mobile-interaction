import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDriver } from "../platforms/driver.js";
import { READ_ONLY } from "../utils/annotations.js";

export function registerGetAppInfoTool(server: McpServer) {
  server.tool(
    "get_app_info",
    "Check whether an app is installed and get its version (Android: versionName/versionCode from dumpsys; iOS simulator: CFBundle versions).",
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
    READ_ONLY,
    async ({ platform, device_id, package: packageName }) => {
      const driver = getDriver(platform);
      const deviceId = device_id ?? (await driver.getFirstDeviceId());

      const info = await driver.getAppInfo(deviceId, packageName);

      if (!info.installed) {
        return {
          content: [{
            type: "text" as const,
            text: `"${packageName}" is NOT installed on ${platform} device ${deviceId}.`,
          }],
        };
      }

      const version = [
        info.version_name ? `version: ${info.version_name}` : undefined,
        info.version_code ? `build: ${info.version_code}` : undefined,
      ]
        .filter(Boolean)
        .join(", ");

      return {
        content: [{
          type: "text" as const,
          text: `"${packageName}" is installed on ${platform} device ${deviceId}${version ? ` (${version})` : ""}.`,
        }],
      };
    },
  );
}
