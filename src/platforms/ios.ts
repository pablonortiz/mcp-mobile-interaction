import { tmpdir } from "os";
import { join } from "path";
import { readFile, readdir, rm, unlink } from "fs/promises";
import type { ChildProcess } from "child_process";
import { run, spawnProc } from "../utils/exec.js";
import type {
  AppInfo,
  Device,
  ForegroundApp,
  LogOptions,
  ScreenInfo,
  TypeTextMethod,
  UiElement,
} from "../types.js";
import { annotateOverlays } from "../utils/overlay-detect.js";

const DEVICE_CACHE_TTL_MS = 10_000;
let cachedFirstDevice: { id: string; timestamp: number } | undefined;
let idbAvailable: boolean | undefined;
const simulatorCache = new Map<string, boolean>();

export function resetCaches(): void {
  cachedFirstDevice = undefined;
  idbAvailable = undefined;
  simulatorCache.clear();
}

async function hasIdb(): Promise<boolean> {
  if (idbAvailable !== undefined) return idbAvailable;
  try {
    await run("which", ["idb"]);
    idbAvailable = true;
  } catch {
    idbAvailable = false;
  }
  return idbAvailable;
}

async function requireIdb(operation: string): Promise<void> {
  if (!(await hasIdb())) {
    throw new Error(
      `idb is required for ${operation} on iOS (xcrun simctl has no UI interaction commands). Install it: brew install idb-companion && pip install fb-idb`,
    );
  }
}

export async function listDevices(): Promise<Device[]> {
  const devices: Device[] = [];

  // Simulators via xcrun simctl
  try {
    const output = await run("xcrun", [
      "simctl",
      "list",
      "devices",
      "available",
      "--json",
    ]);
    const data = JSON.parse(output);
    const runtimes = data.devices ?? {};

    for (const [runtime, devs] of Object.entries(runtimes)) {
      for (const dev of devs as Array<{
        udid: string;
        name: string;
        state: string;
      }>) {
        devices.push({
          id: dev.udid,
          name: `${dev.name} (${runtime.split(".").pop()})`,
          platform: "ios",
          status: dev.state.toLowerCase(),
        });
      }
    }
  } catch {
    // xcrun simctl not available
  }

  // Physical devices via idb
  if (await hasIdb()) {
    try {
      const output = await run("idb", ["list-targets", "--json"]);
      const lines = output.trim().split("\n");
      for (const line of lines) {
        try {
          const target = JSON.parse(line);
          if (target.type === "device") {
            if (!devices.find((d) => d.id === target.udid)) {
              devices.push({
                id: target.udid,
                name: target.name,
                platform: "ios",
                status: "connected",
              });
            }
          }
        } catch {
          // Skip malformed lines
        }
      }
    } catch {
      // idb list-targets failed
    }
  }

  return devices;
}

export async function getFirstDeviceId(): Promise<string> {
  if (
    cachedFirstDevice &&
    Date.now() - cachedFirstDevice.timestamp < DEVICE_CACHE_TTL_MS
  ) {
    return cachedFirstDevice.id;
  }

  const devices = await listDevices();
  // Prefer booted simulators first
  const booted = devices.filter((d) => d.status === "booted");
  const connected = booted.length > 0
    ? booted
    : devices.filter((d) => d.status === "connected");

  if (connected.length === 0) {
    throw new Error(
      "No connected iOS devices or booted simulators found. Boot a simulator with `xcrun simctl boot <device>` or connect a device with idb.",
    );
  }

  cachedFirstDevice = { id: connected[0].id, timestamp: Date.now() };
  return connected[0].id;
}

async function resolveDevice(deviceId?: string): Promise<string> {
  return deviceId ?? (await getFirstDeviceId());
}

async function isSimulator(deviceId: string): Promise<boolean> {
  const cached = simulatorCache.get(deviceId);
  if (cached !== undefined) return cached;

  let result = false;
  try {
    const output = await run("xcrun", ["simctl", "list", "devices", "--json"]);
    const data = JSON.parse(output);
    for (const devs of Object.values(data.devices ?? {})) {
      for (const dev of devs as Array<{ udid: string }>) {
        if (dev.udid === deviceId) {
          result = true;
          break;
        }
      }
    }
  } catch {
    // Assume physical device if simctl fails
  }

  simulatorCache.set(deviceId, result);
  return result;
}

export async function screenshot(deviceId?: string): Promise<Buffer> {
  const id = await resolveDevice(deviceId);
  const tmpFile = join(tmpdir(), `mcp-screenshot-${id}.png`);

  if (await isSimulator(id)) {
    await run("xcrun", ["simctl", "io", id, "screenshot", "--type", "png", tmpFile], {
      timeout: 30_000,
    });
  } else {
    await requireIdb("screenshots on physical devices");
    await run("idb", ["screenshot", "--udid", id, tmpFile], { timeout: 30_000 });
  }

  const buffer = await readFile(tmpFile);
  await unlink(tmpFile).catch(() => {});
  return buffer;
}

export async function tap(
  x: number,
  y: number,
  deviceId?: string,
): Promise<void> {
  const id = await resolveDevice(deviceId);
  await requireIdb("tap");
  await run("idb", ["ui", "tap", "--udid", id, String(x), String(y)]);
}

export async function doubleTap(
  x: number,
  y: number,
  deviceId?: string,
): Promise<void> {
  const id = await resolveDevice(deviceId);
  await requireIdb("double tap");
  await run("idb", ["ui", "tap", "--udid", id, String(x), String(y)]);
  await delay(50);
  await run("idb", ["ui", "tap", "--udid", id, String(x), String(y)]);
}

export async function longPress(
  x: number,
  y: number,
  durationMs: number = 1000,
  deviceId?: string,
): Promise<void> {
  const id = await resolveDevice(deviceId);
  await requireIdb("long press");
  await run("idb", [
    "ui",
    "tap",
    "--udid",
    id,
    "--duration",
    String(durationMs / 1000),
    String(x),
    String(y),
  ]);
}

export async function swipe(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  durationMs: number = 300,
  deviceId?: string,
): Promise<void> {
  const id = await resolveDevice(deviceId);
  await requireIdb("swipe");
  await run("idb", [
    "ui",
    "swipe",
    "--udid",
    id,
    "--duration",
    String(durationMs / 1000),
    String(startX),
    String(startY),
    String(endX),
    String(endY),
  ]);
}

export async function typeText(
  text: string,
  deviceId?: string,
): Promise<TypeTextMethod> {
  const id = await resolveDevice(deviceId);
  await requireIdb("typing text");
  await run("idb", ["ui", "text", "--udid", id, text]);
  return "keyboard";
}

export async function setClipboard(
  deviceId: string,
  text: string,
): Promise<void> {
  if (!(await isSimulator(deviceId))) {
    throw new Error(
      "Setting the clipboard on physical iOS devices is not supported via CLI.",
    );
  }
  await run("xcrun", ["simctl", "pbcopy", deviceId], { stdin: text });
}

export async function getClipboard(deviceId: string): Promise<string> {
  if (!(await isSimulator(deviceId))) {
    throw new Error(
      "Reading the clipboard on physical iOS devices is not supported via CLI.",
    );
  }
  return run("xcrun", ["simctl", "pbpaste", deviceId]);
}

export async function getLogs(
  deviceId: string,
  options: LogOptions,
): Promise<string> {
  if (!(await isSimulator(deviceId))) {
    throw new Error(
      "Reading logs on physical iOS devices is not supported. Use Console.app or `idb log` interactively.",
    );
  }

  const IOS_LOG_LEVEL_MAP: Record<string, string> = {
    verbose: "debug",
    debug: "debug",
    info: "info",
    warn: "default",
    error: "error",
  };

  const predicates: string[] = [];
  if (options.tag) predicates.push(`subsystem == "${options.tag}"`);
  if (options.level) {
    const logType = IOS_LOG_LEVEL_MAP[options.level] ?? "info";
    predicates.push(`messageType >= ${logType}`);
  }

  const args = [
    "simctl",
    "spawn",
    deviceId,
    "log",
    "show",
    "--last",
    "1m",
    "--style",
    "compact",
  ];
  if (predicates.length > 0) {
    args.push("--predicate", predicates.join(" AND "));
  }

  const output = await run("xcrun", args, { timeout: 30_000 });
  const lines = options.lines ?? 50;
  return output.split("\n").slice(-lines).join("\n");
}

export async function clearAppData(
  deviceId: string,
  bundleId: string,
): Promise<void> {
  if (!(await isSimulator(deviceId))) {
    throw new Error(
      "Clearing app data on physical iOS devices is not possible via CLI. Use the device's Settings app instead.",
    );
  }
  await run("xcrun", ["simctl", "uninstall", deviceId, bundleId]);
}

export async function clearAppCache(
  deviceId: string,
  bundleId: string,
): Promise<void> {
  if (!(await isSimulator(deviceId))) {
    throw new Error(
      "Clearing app cache on physical iOS devices is not possible via CLI. Use the device's Settings app instead.",
    );
  }

  const containerPath = (
    await run("xcrun", ["simctl", "get_app_container", deviceId, bundleId, "data"])
  ).trim();

  await emptyDir(join(containerPath, "Library", "Caches"));
  await emptyDir(join(containerPath, "tmp"));
}

async function emptyDir(dir: string): Promise<void> {
  const entries = await readdir(dir).catch(() => [] as string[]);
  await Promise.all(
    entries.map((entry) =>
      rm(join(dir, entry), { recursive: true, force: true }),
    ),
  );
}

export async function killApp(
  deviceId: string,
  bundleId: string,
): Promise<void> {
  if (await isSimulator(deviceId)) {
    await run("xcrun", ["simctl", "terminate", deviceId, bundleId]);
  } else {
    await requireIdb("killing apps on physical devices");
    await run("idb", ["terminate", "--udid", deviceId, bundleId]);
  }
}

export async function installApp(
  deviceId: string,
  appPath: string,
): Promise<string> {
  if (await isSimulator(deviceId)) {
    await run("xcrun", ["simctl", "install", deviceId, appPath], {
      timeout: 120_000,
    });
  } else {
    await requireIdb("installing apps on physical devices");
    await run("idb", ["install", "--udid", deviceId, appPath], {
      timeout: 120_000,
    });
  }
  return `Installed ${appPath}`;
}

export async function uninstallApp(
  deviceId: string,
  bundleId: string,
): Promise<void> {
  if (await isSimulator(deviceId)) {
    await run("xcrun", ["simctl", "uninstall", deviceId, bundleId], {
      timeout: 60_000,
    });
  } else {
    await requireIdb("uninstalling apps on physical devices");
    await run("idb", ["uninstall", "--udid", deviceId, bundleId], {
      timeout: 60_000,
    });
  }
}

export async function getAppInfo(
  deviceId: string,
  bundleId: string,
): Promise<AppInfo> {
  if (await isSimulator(deviceId)) {
    const output = await run("xcrun", ["simctl", "listapps", deviceId], {
      timeout: 30_000,
    });
    const idx = output.indexOf(`"${bundleId}"`);
    if (idx === -1) return { installed: false };

    const section = output.slice(idx, idx + 2000);
    return {
      installed: true,
      version_name: section.match(
        /CFBundleShortVersionString\s*=\s*"?([^";\n]+)"?/,
      )?.[1],
      version_code: section.match(/CFBundleVersion\s*=\s*"?([^";\n]+)"?/)?.[1],
    };
  }

  await requireIdb("querying apps on physical devices");
  const output = await run("idb", ["list-apps", "--udid", deviceId], {
    timeout: 30_000,
  });
  return { installed: output.includes(bundleId) };
}

export async function setLocation(
  deviceId: string,
  latitude: number,
  longitude: number,
): Promise<void> {
  if (await isSimulator(deviceId)) {
    await run("xcrun", [
      "simctl",
      "location",
      deviceId,
      "set",
      `${latitude},${longitude}`,
    ]);
    return;
  }

  await requireIdb("mock location on physical devices");
  await run("idb", [
    "set-location",
    "--udid",
    deviceId,
    String(latitude),
    String(longitude),
  ]);
}

export async function setAppearance(
  deviceId: string,
  mode: "dark" | "light",
): Promise<void> {
  if (!(await isSimulator(deviceId))) {
    throw new Error(
      "Changing appearance on physical iOS devices is not supported via CLI.",
    );
  }
  await run("xcrun", ["simctl", "ui", deviceId, "appearance", mode]);
}

export async function getForegroundApp(
  _deviceId: string,
): Promise<ForegroundApp> {
  throw new Error(
    "Getting the foreground app is not supported on iOS via CLI. Use get_ui_tree to infer the current screen instead.",
  );
}

const IOS_KEY_MAP: Record<string, string> = {
  home: "HOME",
  enter: "13",
  delete: "42",
  volume_up: "volume_up",
  volume_down: "volume_down",
  power: "power",
  tab: "43",
  escape: "53",
};

export async function pressKey(
  key?: string,
  deviceId?: string,
  keycode?: number,
  repeat: number = 1,
): Promise<void> {
  const id = await resolveDevice(deviceId);

  if (keycode !== undefined && !key) {
    throw new Error(
      "Numeric keycode is not supported on iOS. Use a named key instead.",
    );
  }

  const mapping = key ? IOS_KEY_MAP[key] : undefined;
  if (!mapping) {
    throw new Error(
      `Unknown key: ${key}. Supported keys on iOS: ${Object.keys(IOS_KEY_MAP).join(", ")}`,
    );
  }

  await requireIdb("pressing keys");

  for (let i = 0; i < Math.max(1, repeat); i++) {
    if (key === "home") {
      await run("idb", ["ui", "button", "--udid", id, "HOME"]);
    } else {
      await run("idb", ["ui", "key", "--udid", id, mapping]);
    }
  }
}

export async function getUiTree(deviceId?: string): Promise<UiElement[]> {
  const id = await resolveDevice(deviceId);
  await requireIdb("UI tree inspection");

  const output = await run("idb", ["ui", "describe-all", "--udid", id], {
    timeout: 30_000,
  });
  return annotateOverlays(parseIdbDescribeAll(output));
}

function parseIdbDescribeAll(output: string): UiElement[] {
  const elements: UiElement[] = [];
  const lines = output.trim().split("\n");
  let index = 0;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      const frame = entry.frame ?? {};
      const x = frame.x ?? 0;
      const y = frame.y ?? 0;
      const width = frame.width ?? 0;
      const height = frame.height ?? 0;

      const resourceId =
        entry.AXIdentifier ??
        entry.accessibilityIdentifier ??
        entry.identifier ??
        undefined;

      elements.push({
        index,
        type: entry.type ?? entry.AXType ?? "Unknown",
        text: entry.title ?? entry.AXLabel ?? entry.label ?? "",
        bounds: { x, y, width, height },
        center_x: Math.round(x + width / 2),
        center_y: Math.round(y + height / 2),
        clickable: entry.enabled ?? true,
        resource_id: resourceId,
        enabled: entry.enabled ?? true,
      });
      index++;
    } catch {
      // Skip non-JSON lines
    }
  }

  return elements;
}

export async function getScreenInfo(deviceId?: string): Promise<ScreenInfo> {
  const id = await resolveDevice(deviceId);

  if (await isSimulator(id)) {
    // A screenshot is the most reliable way to get the effective resolution
    const buffer = await screenshot(id);
    const sharp = (await import("sharp")).default;
    const metadata = await sharp(buffer).metadata();

    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;

    return {
      width,
      height,
      density: 2, // Default retina for simulators
      orientation: width > height ? "landscape" : "portrait",
    };
  }

  await requireIdb("screen info on physical devices");
  const output = await run("idb", ["describe", "--udid", id, "--json"]);
  const info = JSON.parse(output);
  const screenSize = info.screen_dimensions ?? {};

  return {
    width: screenSize.width ?? 0,
    height: screenSize.height ?? 0,
    density: screenSize.density ?? 2,
    orientation:
      (screenSize.width ?? 0) > (screenSize.height ?? 0)
        ? "landscape"
        : "portrait",
  };
}

export async function launchApp(
  bundleId: string,
  deviceId?: string,
): Promise<void> {
  const id = await resolveDevice(deviceId);

  if (await isSimulator(id)) {
    await run("xcrun", ["simctl", "launch", id, bundleId]);
  } else {
    await requireIdb("launching apps on physical devices");
    await run("idb", ["launch", "--udid", id, bundleId]);
  }
}

export async function openUrl(url: string, deviceId?: string): Promise<void> {
  const id = await resolveDevice(deviceId);

  if (await isSimulator(id)) {
    await run("xcrun", ["simctl", "openurl", id, url]);
  } else {
    await requireIdb("opening URLs on physical devices");
    await run("idb", ["open", "--udid", id, url]);
  }
}

const activeRecordings = new Map<string, { child: ChildProcess; path: string }>();

export async function startRecording(deviceId?: string): Promise<string> {
  const id = await resolveDevice(deviceId);
  if (activeRecordings.has(id)) {
    throw new Error(
      `A recording is already in progress on ${id}. Stop it first with action: "stop".`,
    );
  }

  const localPath = join(tmpdir(), `mcp-recording-${id}-${Date.now()}.mp4`);

  let child: ChildProcess;
  if (await isSimulator(id)) {
    child = spawnProc("xcrun", [
      "simctl",
      "io",
      id,
      "recordVideo",
      "--force",
      localPath,
    ]);
  } else {
    await requireIdb("screen recording on physical devices");
    child = spawnProc("idb", ["record-video", "--udid", id, localPath]);
  }

  activeRecordings.set(id, { child, path: localPath });

  await delay(500);
  if (child.exitCode !== null && child.exitCode !== 0) {
    activeRecordings.delete(id);
    throw new Error("Screen recording failed to start.");
  }

  return id;
}

export async function stopRecording(deviceId?: string): Promise<string> {
  const id = await resolveDevice(deviceId);
  const recording = activeRecordings.get(id);
  if (!recording) {
    throw new Error(
      `No active recording on ${id}. Start one with action: "start".`,
    );
  }
  activeRecordings.delete(id);

  // SIGINT lets recordVideo finalize the movie file
  recording.child.kill("SIGINT");
  await waitForExit(recording.child, 5000);
  await delay(300);

  return recording.path;
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    const timer = setTimeout(() => {
      child.kill();
      resolve();
    }, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export async function clearTextField(
  deviceId?: string,
  maxChars: number = 50,
): Promise<number> {
  const id = await resolveDevice(deviceId);
  await requireIdb("clearing text fields");

  for (let i = 0; i < maxChars; i++) {
    await run("idb", ["ui", "key", "--udid", id, IOS_KEY_MAP.delete]);
  }
  return maxChars;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
