import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as android from "../platforms/android.js";
import { getDriver } from "../platforms/driver.js";
import { performObservation } from "../utils/observe.js";
import { buildResponseContent } from "../utils/format-response.js";
import { ACTION } from "../utils/annotations.js";

export function registerSetNetworkStateTool(server: McpServer) {
  server.tool(
    "set_network_state",
    "Control device network connectivity: Wi-Fi, mobile data, airplane mode, and emulator network throttling (latency/speed). Android only.",
    {
      platform: z.enum(["android", "ios"]).describe("Target platform"),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit to use the first connected device."),
      wifi: z
        .boolean()
        .optional()
        .describe("Enable or disable Wi-Fi"),
      mobile_data: z
        .boolean()
        .optional()
        .describe("Enable or disable mobile data (Android only)"),
      airplane_mode: z
        .boolean()
        .optional()
        .describe("Enable or disable airplane mode"),
      delay: z
        .enum(["none", "gprs", "edge", "umts"])
        .optional()
        .describe("Simulate network latency (Android emulator only). 'none' removes the delay."),
      speed: z
        .enum(["full", "gsm", "gprs", "edge", "umts", "hsdpa", "lte", "evdo"])
        .optional()
        .describe("Throttle network speed (Android emulator only). 'full' removes the throttle."),
      observe: z
        .enum(["none", "screenshot"])
        .optional()
        .describe("Capture screenshot after action. Default: none"),
    },
    ACTION,
    async ({ platform, device_id, wifi, mobile_data, airplane_mode, delay, speed, observe }) => {
      if (
        wifi === undefined &&
        mobile_data === undefined &&
        airplane_mode === undefined &&
        delay === undefined &&
        speed === undefined
      ) {
        return {
          content: [{ type: "text" as const, text: "Error: Provide at least one of wifi, mobile_data, airplane_mode, delay, or speed." }],
          isError: true,
        };
      }

      if (platform === "ios") {
        return {
          content: [{
            type: "text" as const,
            text: "Network state control is not supported on iOS simulators. xcrun simctl does not expose Wi-Fi or airplane mode toggles. This feature is only available on Android.",
          }],
          isError: true,
        };
      }

      const deviceId = device_id ?? (await getDriver(platform).getFirstDeviceId());

      const warnings: string[] = [];
      const changes: string[] = [];

      // If airplane_mode is enabled, apply it first and ignore wifi/mobile_data
      if (airplane_mode !== undefined) {
        await android.setAirplaneMode(deviceId, airplane_mode);
        changes.push(`Airplane mode: ${airplane_mode ? "enabled" : "disabled"}`);

        if (airplane_mode && (wifi !== undefined || mobile_data !== undefined)) {
          warnings.push("Airplane mode enabled — wifi and mobile_data settings ignored");
        }
      }

      if (!airplane_mode) {
        if (wifi !== undefined) {
          await android.setWifi(deviceId, wifi);
          changes.push(`Wi-Fi: ${wifi ? "enabled" : "disabled"}`);
        }

        if (mobile_data !== undefined) {
          await android.setMobileData(deviceId, mobile_data);
          changes.push(`Mobile data: ${mobile_data ? "enabled" : "disabled"}`);
        }
      }

      if (delay !== undefined || speed !== undefined) {
        await android.setNetworkThrottle(deviceId, { delay, speed });
        if (delay !== undefined) changes.push(`Network delay: ${delay}`);
        if (speed !== undefined) changes.push(`Network speed: ${speed}`);
      }

      const observation = observe === "screenshot"
        ? await performObservation({
            mode: "screenshot",
            platform,
            deviceId,
            delayMs: 500,
          })
        : undefined;

      let responseText = `Network state updated on Android:\n  - ${changes.join("\n  - ")}`;
      if (warnings.length > 0) {
        responseText += `\n\nWarnings:\n  - ${warnings.join("\n  - ")}`;
      }

      return { content: buildResponseContent(responseText, observation) };
    },
  );
}
