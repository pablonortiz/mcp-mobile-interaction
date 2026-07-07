import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDriver } from "../platforms/driver.js";
import { ACTION } from "../utils/annotations.js";

export function registerSetAppearanceTool(server: McpServer) {
  server.tool(
    "set_appearance",
    "Switch the device between dark and light mode. Android: cmd uimode night. iOS: simulators only (simctl ui appearance). Useful for verifying both themes of a screen.",
    {
      platform: z.enum(["android", "ios"]).describe("Target platform"),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit to use the first connected device."),
      mode: z
        .enum(["dark", "light"])
        .describe("Appearance mode to set"),
    },
    ACTION,
    async ({ platform, device_id, mode }) => {
      const driver = getDriver(platform);
      const deviceId = device_id ?? (await driver.getFirstDeviceId());

      await driver.setAppearance(deviceId, mode);

      return {
        content: [{
          type: "text" as const,
          text: `Appearance set to ${mode} mode on ${platform} device ${deviceId}.`,
        }],
      };
    },
  );
}
