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
import * as android from "../platforms/android.js";
import { ACTION } from "../utils/annotations.js";

export function registerSetPermissionsTool(server: McpServer) {
  server.tool(
    "set_permissions",
    `Grant or revoke Android runtime permissions, so a flow can start from a clean install without a human tapping the system dialog. Accepts shorthands (${android.knownPermissionAliases().join(", ")}) or full names like android.permission.CAMERA. Android only.`,
    {
      platform: z.enum(["android", "ios"]).optional().describe(PLATFORM_DESCRIPTION),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit for the connected device."),
      package: z.string().optional().describe(PACKAGE_DESCRIPTION),
      permissions: z
        .array(z.string())
        .min(1)
        .describe('Permissions to change, e.g. ["camera", "location"] or ["android.permission.CAMERA"]'),
      grant: z
        .boolean()
        .optional()
        .describe("True to grant, false to revoke. Default: true"),
    },
    ACTION,
    async ({ platform: platformArg, device_id, package: packageArg, permissions, grant }) => {
      const platform = await resolvePlatform(platformArg);
      if (platform !== "android") {
        return {
          content: [{
            type: "text" as const,
            text: "Runtime permissions can only be set on Android. On an iOS simulator, reset them with `xcrun simctl privacy`.",
          }],
          isError: true,
        };
      }

      const driver = getDriver(platform);
      const deviceId = await resolveDeviceId(platform, device_id);
      const packageName = await resolvePackage(packageArg, platform, device_id);
      const shouldGrant = grant ?? true;

      const results = await android.setPermissions(
        deviceId,
        packageName,
        permissions,
        shouldGrant,
      );

      const changed = results.filter((result) => result.granted);
      const skipped = results.filter((result) => !result.granted);

      const lines = [
        `${shouldGrant ? "Granted" : "Revoked"} ${changed.length} of ${results.length} permission(s) for ${packageName} on ${deviceId}.`,
        ...changed.map((result) => `  ✓ ${result.permission}`),
        ...skipped.map((result) => `  ✗ ${result.permission} — ${result.detail ?? "failed"}`),
      ];

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        ...(changed.length === 0 ? { isError: true } : {}),
      };
    },
  );
}
