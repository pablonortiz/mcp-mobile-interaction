import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as android from "../platforms/android.js";
import * as ios from "../platforms/ios.js";

export function registerGetDeviceLogsTool(server: McpServer) {
  server.tool(
    "get_device_logs",
    "Get OS-level device logs. Android: logcat. iOS: log show. Captures native logs (crashes, ANRs, system events, SDK logs) — different from JavaScript console logs.",
    {
      platform: z.enum(["android", "ios"]).describe("Target platform"),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit to use the first connected device."),
      tag: z
        .string()
        .optional()
        .describe('Filter by log tag (Android: -s tag, iOS: subsystem). Example: "ReactNativeJS", "ActivityManager"'),
      search: z
        .string()
        .optional()
        .describe("Filter log lines containing this string (case-insensitive)"),
      level: z
        .enum(["verbose", "debug", "info", "warn", "error"])
        .optional()
        .describe("Minimum log level. Default: info"),
      lines: z
        .number()
        .int()
        .min(1)
        .max(500)
        .default(50)
        .describe("Number of log lines to return. Default: 50"),
      clear: z
        .boolean()
        .optional()
        .describe("Clear the log buffer before reading. Useful to capture only new logs from this point forward. Default: false"),
    },
    async ({ platform, device_id, tag, search, level, lines, clear }) => {
      const deviceId = device_id ??
        (platform === "android"
          ? await android.getFirstDeviceId()
          : await ios.getFirstDeviceId());

      let clearWarning: string | undefined;

      if (clear) {
        if (platform === "android") {
          try {
            await android.clearLogs(deviceId);
          } catch {
            clearWarning = "Warning: Failed to clear log buffer (this can happen on some emulators due to permission restrictions). Continuing with log read.";
          }
        } else {
          // iOS doesn't support clearing logs programmatically
        }

        if (!tag && !search && !clearWarning) {
          return {
            content: [{
              type: "text" as const,
              text: `Log buffer cleared on ${platform} device ${deviceId}. Future get_device_logs calls will show only new logs.`,
            }],
          };
        }
      }

      let logOutput: string;

      if (platform === "android") {
        logOutput = await android.getLogs(deviceId, { tag, level, lines });
      } else {
        logOutput = await ios.getLogs(deviceId, { tag, level, lines });
      }

      // Apply search filter
      if (search) {
        const searchLower = search.toLowerCase();
        const filtered = logOutput
          .split("\n")
          .filter((line) => line.toLowerCase().includes(searchLower));
        logOutput = filtered.slice(-lines).join("\n");
      }

      if (!logOutput.trim()) {
        return {
          content: [{
            type: "text" as const,
            text: `No log lines found matching the given filters on ${platform} device ${deviceId}.`,
          }],
        };
      }

      const tagInfo = tag ? `, tag: ${tag}` : "";
      const levelInfo = level ? `, level: ${level}+` : "";
      const warningLine = clearWarning ? `\n${clearWarning}\n` : "";

      return {
        content: [{
          type: "text" as const,
          text: `${warningLine}Device logs (${platform}, last ${lines} lines${tagInfo}${levelInfo}):\n\n${logOutput}`,
        }],
      };
    },
  );
}
