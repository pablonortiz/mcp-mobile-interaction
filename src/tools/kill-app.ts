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
import { performObservation } from "../utils/observe.js";
import { buildResponseContent } from "../utils/format-response.js";
import { DESTRUCTIVE } from "../utils/annotations.js";

export function registerKillAppTool(server: McpServer) {
  server.tool(
    "kill_app",
    "Force-stop an application by package name (Android) or bundle ID (iOS)",
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
    async ({ platform: platformArg, device_id, package: packageArg, observe, observe_delay_ms }) => {
      const platform = await resolvePlatform(platformArg);
      const packageName = await resolvePackage(
        packageArg,
        platform,
        device_id,
      );
      const driver = getDriver(platform);
      const deviceId = await resolveDeviceId(platform, device_id);

      await driver.killApp(deviceId, packageName);

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
