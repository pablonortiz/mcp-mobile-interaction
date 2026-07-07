import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDriver } from "../platforms/driver.js";
import { READ_ONLY } from "../utils/annotations.js";

export function registerGetClipboardTool(server: McpServer) {
  server.tool(
    "get_clipboard",
    "Read the device clipboard content. Useful for verifying copy-to-clipboard features (tracking codes, share links). Works best on emulators/simulators; Android 10+ physical devices restrict clipboard access.",
    {
      platform: z.enum(["android", "ios"]).describe("Target platform"),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit to use the first connected device."),
    },
    READ_ONLY,
    async ({ platform, device_id }) => {
      const driver = getDriver(platform);
      const deviceId = device_id ?? (await driver.getFirstDeviceId());

      const text = await driver.getClipboard(deviceId);

      return {
        content: [{
          type: "text" as const,
          text: `Clipboard content on ${platform} device ${deviceId}:\n${text}`,
        }],
      };
    },
  );
}
