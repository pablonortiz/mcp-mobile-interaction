import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDriver } from "../platforms/driver.js";
import { ACTION } from "../utils/annotations.js";

export function registerInstallAppTool(server: McpServer) {
  server.tool(
    "install_app",
    "Install an app on the device. Android: local .apk path (installed with -r, replacing an existing install). iOS: .app bundle (simulator) or .ipa (physical device via idb).",
    {
      platform: z.enum(["android", "ios"]).describe("Target platform"),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit to use the first connected device."),
      path: z
        .string()
        .describe("Local path to the .apk (Android), .app bundle or .ipa (iOS)"),
    },
    ACTION,
    async ({ platform, device_id, path }) => {
      const driver = getDriver(platform);
      const deviceId = device_id ?? (await driver.getFirstDeviceId());

      const output = await driver.installApp(deviceId, path);

      return {
        content: [{
          type: "text" as const,
          text: `Installed on ${platform} device ${deviceId}: ${path}\n${output}`,
        }],
      };
    },
  );
}
