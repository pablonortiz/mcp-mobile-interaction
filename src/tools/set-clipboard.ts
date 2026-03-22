import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as android from "../platforms/android.js";
import * as ios from "../platforms/ios.js";

export function registerSetClipboardTool(server: McpServer) {
  server.tool(
    "set_clipboard",
    "Set the device clipboard content. Useful for testing paste of URLs, tokens, OTP codes, etc.",
    {
      platform: z.enum(["android", "ios"]).describe("Target platform"),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit to use the first connected device."),
      text: z
        .string()
        .max(10000)
        .describe("Text to set in the clipboard (max 10,000 characters)"),
    },
    async ({ platform, device_id, text }) => {
      const deviceId = device_id ??
        (platform === "android"
          ? await android.getFirstDeviceId()
          : await ios.getFirstDeviceId());

      if (platform === "android") {
        await android.setClipboard(deviceId, text);
      } else {
        await ios.setClipboard(text);
      }

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
