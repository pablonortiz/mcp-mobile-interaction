import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDriver } from "../platforms/driver.js";
import { ACTION } from "../utils/annotations.js";

export function registerSetLocationTool(server: McpServer) {
  server.tool(
    "set_location",
    "Set the device's mock GPS location. Essential for testing delivery/route flows. Android: emulator only (adb emu geo fix). iOS: simulators (simctl location) and physical devices via idb.",
    {
      platform: z.enum(["android", "ios"]).describe("Target platform"),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit to use the first connected device."),
      latitude: z
        .number()
        .min(-90)
        .max(90)
        .describe("Latitude in decimal degrees (e.g. -34.6037 for Buenos Aires)"),
      longitude: z
        .number()
        .min(-180)
        .max(180)
        .describe("Longitude in decimal degrees (e.g. -58.3816 for Buenos Aires)"),
    },
    ACTION,
    async ({ platform, device_id, latitude, longitude }) => {
      const driver = getDriver(platform);
      const deviceId = device_id ?? (await driver.getFirstDeviceId());

      await driver.setLocation(deviceId, latitude, longitude);

      return {
        content: [{
          type: "text" as const,
          text: `Mock location set to (${latitude}, ${longitude}) on ${platform} device ${deviceId}. Apps may need location permission granted and a moment to pick up the new fix.`,
        }],
      };
    },
  );
}
