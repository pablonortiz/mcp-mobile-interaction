import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  resolvePlatform,
  PLATFORM_DESCRIPTION,
} from "../utils/resolve-platform.js";
import { tmpdir } from "os";
import { join } from "path";
import * as android from "../platforms/android.js";
import { getDriver } from "../platforms/driver.js";

export function registerGetDeviceLogsTool(server: McpServer) {
  server.tool(
    "get_device_logs",
    "Get OS-level device logs. Android: logcat. iOS: log show (simulators only). Captures native logs (crashes, ANRs, system events, SDK logs) — different from JavaScript console logs.",
    {
      platform: z.enum(["android", "ios"]).optional().describe(PLATFORM_DESCRIPTION),
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
        .describe("Clear the log buffer before reading (Android only). Useful to capture only new logs from this point forward. Default: false"),
      dump_to_file: z
        .boolean()
        .optional()
        .describe("Android only. Write the entire log buffer to a local file and return its path plus a summary, instead of returning log lines. Use when the windowed read is not enough. Default: false"),
    },
    async ({ platform: platformArg, device_id, tag, search, level, lines, clear, dump_to_file }) => {
      const platform = await resolvePlatform(platformArg);
      const driver = getDriver(platform);
      const deviceId = device_id ?? (await driver.getFirstDeviceId());

      let clearWarning: string | undefined;

      if (clear) {
        if (platform === "android") {
          try {
            await android.clearLogs(deviceId);
          } catch {
            clearWarning = "Warning: Failed to clear log buffer (this can happen on some emulators due to permission restrictions). Continuing with log read.";
          }
        }

        if (!tag && !search && !clearWarning && platform === "android") {
          return {
            content: [{
              type: "text" as const,
              text: `Log buffer cleared on ${platform} device ${deviceId}. Future get_device_logs calls will show only new logs.`,
            }],
          };
        }
      }

      if (dump_to_file && platform === "android") {
        const filePath = join(tmpdir(), `logcat-${deviceId.replace(/[^\w.-]/g, "_")}-${process.pid}.log`);
        const bytes = await android.dumpLogsToFile(deviceId, filePath);
        return {
          content: [{
            type: "text" as const,
            text: `Full log buffer written to ${filePath} (${(bytes / 1024 / 1024).toFixed(1)} MB). Read or grep that file directly.`,
          }],
        };
      }

      // Android filters device-side; iOS has no equivalent, so it filters here.
      let logOutput = await driver.getLogs(deviceId, {
        tag,
        level,
        lines,
        search: platform === "android" ? search : undefined,
      });

      if (search && platform !== "android") {
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
