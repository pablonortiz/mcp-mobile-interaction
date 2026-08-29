import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  resolvePlatform,
  PLATFORM_DESCRIPTION,
} from "../utils/resolve-platform.js";
import { getDriver } from "../platforms/driver.js";
import { resolveDeviceId } from "../utils/resolve-device.js";
import { ACTION } from "../utils/annotations.js";

export function registerSetClipboardTool(server: McpServer) {
  server.tool(
    "set_clipboard",
    "Set the device clipboard content. Useful for testing paste of URLs, tokens, OTP codes, etc. On iOS this targets the simulator's own pasteboard (not the host Mac's).",
    {
      platform: z.enum(["android", "ios"]).optional().describe(PLATFORM_DESCRIPTION),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit for the connected device."),
      text: z
        .string()
        .max(10000)
        .describe("Text to set in the clipboard (max 10,000 characters)"),
    },
    ACTION,
    async ({ platform: platformArg, device_id, text }) => {
      const platform = await resolvePlatform(platformArg);
      const driver = getDriver(platform);
      const deviceId = await resolveDeviceId(platform, device_id);

      await driver.setClipboard(deviceId, text);

      const preview = text.length > 80 ? text.slice(0, 80) + "..." : text;

      return {
        content: [{
          type: "text" as const,
          text: `Clipboard set on ${platform} device ${deviceId}: "${preview}"`,
        }],
      };
    },
  );
}
