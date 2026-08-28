import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  resolvePlatform,
  PLATFORM_DESCRIPTION,
} from "../utils/resolve-platform.js";
import {
  resolvePackage,
  PACKAGE_DESCRIPTION,
} from "../utils/resolve-package.js";
import { getDriver } from "../platforms/driver.js";
import { resolveDeviceId } from "../utils/resolve-device.js";
import { READ_ONLY } from "../utils/annotations.js";

export function registerGetAppInfoTool(server: McpServer) {
  server.tool(
    "get_app_info",
    "Check whether an app is installed and get its version (Android: versionName/versionCode from dumpsys; iOS simulator: CFBundle versions).",
    {
      platform: z.enum(["android", "ios"]).optional().describe(PLATFORM_DESCRIPTION),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit for the connected device."),
      package: z
        .string()
        .optional()
        .describe(PACKAGE_DESCRIPTION),
    },
    READ_ONLY,
    async ({ platform: platformArg, device_id, package: packageArg }) => {
      const platform = await resolvePlatform(platformArg);
      const packageName = await resolvePackage(
        packageArg,
        platform,
        device_id,
      );
      const driver = getDriver(platform);
      const deviceId = await resolveDeviceId(platform, device_id);

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
