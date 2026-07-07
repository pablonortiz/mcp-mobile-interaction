import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync } from "fs";
import { join } from "path";
import { run } from "../utils/exec.js";
import * as android from "../platforms/android.js";
import * as ios from "../platforms/ios.js";
import { READ_ONLY } from "../utils/annotations.js";

interface Check {
  label: string;
  ok: boolean;
  detail: string;
}

export function registerDoctorTool(server: McpServer) {
  server.tool(
    "doctor",
    "Diagnose the local mobile tooling setup: adb, ANDROID_HOME, connected devices, emulator, Xcode simctl, and idb. Run this when device commands fail unexpectedly.",
    {},
    READ_ONLY,
    async () => {
      const checks: Check[] = [];

      // adb
      try {
        const version = await run("adb", ["version"]);
        checks.push({ label: "adb", ok: true, detail: version.split("\n")[0] });
      } catch {
        checks.push({
          label: "adb",
          ok: false,
          detail: "Not found in PATH. Install Android platform-tools and export PATH=$ANDROID_HOME/platform-tools:$PATH (a per-project .envrc works well).",
        });
      }

      // ANDROID_HOME
      const androidHome = process.env.ANDROID_HOME;
      checks.push({
        label: "ANDROID_HOME",
        ok: Boolean(androidHome),
        detail: androidHome ?? "Not set. Some Gradle/emulator tooling requires it (typically ~/Library/Android/sdk).",
      });

      // Android devices
      try {
        const devices = await android.listDevices();
        const connected = devices.filter((d) => d.status === "device");
        checks.push({
          label: "Android devices",
          ok: connected.length > 0,
          detail: connected.length > 0
            ? connected.map((d) => `${d.name} (${d.id})`).join(", ")
            : "No connected devices. Boot an emulator or plug in a device with ADB debugging.",
        });
      } catch (e: any) {
        checks.push({ label: "Android devices", ok: false, detail: e.message });
      }

      // Emulator binary
      const emulatorPath = androidHome ? join(androidHome, "emulator", "emulator") : undefined;
      if (emulatorPath && existsSync(emulatorPath)) {
        try {
          const avds = await run(emulatorPath, ["-list-avds"], { timeout: 10_000 });
          const list = avds.trim().split("\n").filter((l) => l && !l.startsWith("INFO")).join(", ");
          checks.push({ label: "Emulator AVDs", ok: true, detail: list || "none created" });
        } catch {
          checks.push({ label: "Emulator AVDs", ok: true, detail: "emulator binary present" });
        }
      } else {
        checks.push({
          label: "Emulator AVDs",
          ok: false,
          detail: "emulator binary not found under ANDROID_HOME/emulator.",
        });
      }

      // xcrun simctl
      try {
        await run("xcrun", ["simctl", "help"], { timeout: 10_000 });
        const devices = await ios.listDevices();
        const booted = devices.filter((d) => d.status === "booted");
        checks.push({
          label: "Xcode simctl",
          ok: true,
          detail: booted.length > 0
            ? `Booted simulators: ${booted.map((d) => d.name).join(", ")}`
            : "Available (no simulator booted)",
        });
      } catch {
        checks.push({
          label: "Xcode simctl",
          ok: false,
          detail: "xcrun simctl not available. Install Xcode for iOS simulator support.",
        });
      }

      // idb
      try {
        await run("which", ["idb"]);
        checks.push({
          label: "idb",
          ok: true,
          detail: "Installed (required for iOS UI interaction: tap, swipe, type, UI tree)",
        });
      } catch {
        checks.push({
          label: "idb",
          ok: false,
          detail: "Not installed. Required for ALL iOS UI interaction (simulators included): brew install idb-companion && pip install fb-idb",
        });
      }

      const report = checks
        .map((c) => `${c.ok ? "✓" : "✗"} ${c.label}: ${c.detail}`)
        .join("\n");

      return {
        content: [{ type: "text" as const, text: `Mobile tooling diagnosis:\n${report}` }],
      };
    },
  );
}
