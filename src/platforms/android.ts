import { tmpdir } from "os";
import { join } from "path";
import type { ChildProcess } from "child_process";
import { run, runBuffer, spawnProc, shellQuote } from "../utils/exec.js";
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
import { writeFile, stat } from "fs/promises";
import { resolve as resolvePath } from "path";
import { unescapeXml, isIconGlyph } from "../utils/xml.js";
import {
  ensureDaemon,
  request,
  stopDaemon,
  isDaemonEnabled,
  markUnavailable,
  unavailableReason,
} from "./ui-daemon.js";
import { parseDaemonTree } from "./daemon-tree.js";

const DEVICE_CACHE_TTL_MS = 10_000;
let cachedFirstDevice: { id: string; timestamp: number } | undefined;

export function resetCaches(): void {
  cachedFirstDevice = undefined;
}

/** Names what is actually attached, so a wrong device_id is obvious. */
async function describeAvailableDevices(wanted: string): Promise<string> {
  try {
    const devices = await listDevices();
    const connected = devices.filter((device) => device.status === "device");
    if (connected.length === 0) {
      return "No Android devices are connected. Boot an emulator or plug in a device.";
    }
    return `${wanted} is not attached. Connected: ${connected
      .map((device) => `${device.id} (${classifyDevice(device.id)})`)
      .join(", ")}.`;
  } catch {
    return "";
  }
}

/**
 * Only adb's own "the device is gone" messages. A bare "not found" also comes
 * from a missing shell command on the device, which must not be mistaken for
 * a disconnect.
 */
const DEVICE_GONE_PATTERNS = [
  /device '[^']*' not found/,
  /device offline/,
  /no devices\/emulators found/,
  /device unauthorized/,
  /device still connecting/,
];

function isDeviceGoneError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return DEVICE_GONE_PATTERNS.some((pattern) => pattern.test(message));
}

function adb(
  deviceId: string,
  args: string[],
  options?: { timeout?: number; maxBuffer?: number },
) {
  return Promise.resolve(run("adb", ["-s", deviceId, ...args], options)).catch(
    async (error: unknown) => {
      if (!isDeviceGoneError(error)) throw error;
      // The cached id outlived the device: drop it so the next call re-resolves
      // instead of failing for another TTL.
      if (cachedFirstDevice?.id === deviceId) resetCaches();
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n${await describeAvailableDevices(deviceId)}`,
      );
    },
  );
}

export async function listDevices(): Promise<Device[]> {
  const output = await run("adb", ["devices", "-l"]);
  const lines = output.trim().split("\n").slice(1); // skip header

  const devices: Device[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("*")) continue;

    const parts = trimmed.split(/\s+/);
    const id = parts[0];
    const status = parts[1];

    const modelToken = parts.find((p) => p.startsWith("model:"));
    const name = modelToken ? modelToken.split(":")[1] : id;

    devices.push({ id, name, platform: "android", status });
  }

  return devices;
}

export type DeviceKind = "emulator" | "usb" | "network";

/**
 * Network-attached targets are the dangerous ones: an Android TV on the same
 * Wi-Fi shows up in `adb devices` exactly like a phone, and picking it
 * silently means installing an APK or sending taps to the wrong device.
 */
export function classifyDevice(deviceId: string): DeviceKind {
  if (deviceId.startsWith("emulator-")) return "emulator";
  if (deviceId.includes(":")) return "network";
  return "usb";
}

export async function getFirstDeviceId(): Promise<string> {
  if (
    cachedFirstDevice &&
    Date.now() - cachedFirstDevice.timestamp < DEVICE_CACHE_TTL_MS
  ) {
    return cachedFirstDevice.id;
  }

  const devices = await listDevices();
  const connected = devices.filter((d) => d.status === "device");
  if (connected.length === 0) {
    throw new Error(
      "No connected Android devices found. Make sure an emulator is running or a device is connected via USB with ADB debugging enabled.",
    );
  }

  // Never choose on the user's behalf when the choice can be wrong.
  if (connected.length > 1) {
    const listed = connected
      .map(
        (device) =>
          `  ${device.id} (${classifyDevice(device.id)}${device.name && device.name !== device.id ? `, ${device.name}` : ""})`,
      )
      .join("\n");
    throw new Error(
      `${connected.length} Android devices are connected — pass device_id to say which one:\n${listed}\nNetwork targets are often a TV or a set-top box on the same Wi-Fi, not the device you meant.`,
    );
  }

  cachedFirstDevice = { id: connected[0].id, timestamp: Date.now() };
  return connected[0].id;
}

async function resolveDevice(deviceId?: string): Promise<string> {
  return deviceId ?? (await getFirstDeviceId());
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/**
 * Drops anything `screencap` prints before the image. Devices with more than
 * one display — foldables, and anything driving an external screen — emit a
 * warning about the missing display id straight into the stream, which leaves
 * the PNG unreadable (347 bytes of it on a Galaxy Z Flip 7).
 */
function stripLeadingNoise(buffer: Buffer): Buffer {
  if (buffer.subarray(0, 4).equals(PNG_SIGNATURE)) return buffer;
  const start = buffer.indexOf(PNG_SIGNATURE);
  return start > 0 ? buffer.subarray(start) : buffer;
}

export async function screenshot(deviceId?: string): Promise<Buffer> {
  const id = await resolveDevice(deviceId);
  return Promise.resolve(
    runBuffer("adb", ["-s", id, "exec-out", "screencap", "-p"], {
      timeout: 30_000,
    }).then(stripLeadingNoise),
  ).catch(async (error: unknown) => {
    if (!isDeviceGoneError(error)) throw error;
    if (cachedFirstDevice?.id === id) resetCaches();
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n${await describeAvailableDevices(id)}`,
    );
  });
}

export async function tap(
  x: number,
  y: number,
  deviceId?: string,
): Promise<void> {
  const id = await resolveDevice(deviceId);
  await adb(id, ["shell", "input", "tap", String(x), String(y)]);
}

export async function doubleTap(
  x: number,
  y: number,
  deviceId?: string,
): Promise<void> {
  const id = await resolveDevice(deviceId);
  // Single remote shell invocation keeps the two taps rapid enough
  await adb(id, [
    "shell",
    `input tap ${x} ${y} && sleep 0.05 && input tap ${x} ${y}`,
  ]);
}

export async function longPress(
  x: number,
  y: number,
  durationMs: number = 1000,
  deviceId?: string,
): Promise<void> {
  const id = await resolveDevice(deviceId);
  // Swipe from point to same point = long press
  await adb(id, [
    "shell",
    "input",
    "swipe",
    String(x),
    String(y),
    String(x),
    String(y),
    String(durationMs),
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
  await adb(id, [
    "shell",
    "input",
    "swipe",
    String(startX),
    String(startY),
    String(endX),
    String(endY),
    String(durationMs),
  ]);
}

const NON_ASCII = /[^\x20-\x7E]/;
const KEYCODE_PASTE = 279;

/**
 * Press-move-release, for reordering lists and dragging items. A plain swipe
 * flicks; a drag holds long enough for the target to pick up the gesture.
 */
export async function dragAndDrop(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  durationMs = 1000,
  deviceId?: string,
): Promise<void> {
  const id = await resolveDevice(deviceId);
  await adb(
    id,
    [
      "shell",
      "input",
      "draganddrop",
      String(startX),
      String(startY),
      String(endX),
      String(endY),
      String(durationMs),
    ],
    { timeout: Math.max(30_000, durationMs + 10_000) },
  );
}

export async function typeText(
  text: string,
  deviceId?: string,
): Promise<TypeTextMethod> {
  const id = await resolveDevice(deviceId);

  // `input text` silently drops non-ASCII characters (á, ñ, emoji, …),
  // so those go through the clipboard + KEYCODE_PASTE instead.
  if (NON_ASCII.test(text)) {
    await setClipboard(id, text);
    await adb(id, ["shell", "input", "keyevent", String(KEYCODE_PASTE)]);
    return "clipboard_paste";
  }

  const escaped = text.replace(/ /g, "%s");
  await adb(id, ["shell", "input", "text", shellQuote(escaped)]);
  return "keyboard";
}

const KEYCODE_MAP: Record<string, number> = {
  home: 3,
  back: 4,
  enter: 66,
  delete: 67,
  volume_up: 24,
  volume_down: 25,
  power: 26,
  tab: 61,
  recent_apps: 187,
  menu: 82,
  escape: 111,
  search: 84,
  camera: 27,
  media_play_pause: 85,
  paste: KEYCODE_PASTE,
};

export async function pressKey(
  key?: string,
  deviceId?: string,
  keycode?: number,
  repeat: number = 1,
): Promise<void> {
  const id = await resolveDevice(deviceId);
  const code = keycode ?? (key ? KEYCODE_MAP[key] : undefined);
  if (code === undefined) {
    throw new Error(
      `Unknown key: ${key}. Supported keys: ${Object.keys(KEYCODE_MAP).join(", ")}`,
    );
  }
  const codes = Array(Math.max(1, repeat)).fill(String(code));
  await adb(id, ["shell", "input", "keyevent", ...codes], { timeout: 60_000 });
}

export async function setClipboard(
  deviceId: string,
  text: string,
): Promise<void> {
  try {
    await adb(deviceId, [
      "shell",
      "cmd",
      "clipboard",
      "set-text",
      shellQuote(text),
    ]);
  } catch {
    // Fallback for API < 29 (requires the Clipper helper app)
    await adb(deviceId, [
      "shell",
      "am",
      "broadcast",
      "-a",
      "clipper.set",
      "-e",
      "text",
      shellQuote(text),
    ]);
  }
}

export async function getClipboard(deviceId: string): Promise<string> {
  try {
    const output = await adb(deviceId, ["shell", "cmd", "clipboard", "get-text"]);
    const trimmed = output.trim();
    if (trimmed && !/^(error|exception|usage|unknown command)/i.test(trimmed)) {
      return trimmed;
    }
  } catch {
    // Fall through to dumpsys
  }

  const dump = await adb(deviceId, ["shell", "dumpsys", "clipboard"], {
    timeout: 30_000,
  });
  const match = dump.match(/\{T:([\s\S]*?)\}/);
  if (match) return match[1];

  throw new Error(
    "Could not read the clipboard. Android 10+ restricts clipboard access to the focused app; this works best on emulators. Alternatively, verify the paste result through the UI.",
  );
}

const LOG_LEVEL_MAP: Record<string, string> = {
  verbose: "V",
  debug: "D",
  info: "I",
  warn: "W",
  error: "E",
};

// A full `logcat -d` routinely exceeds exec's maxBuffer (28 MB measured on a
// normal emulator vs. a 10 MB limit), so reads are always capped at the source.
const LOGCAT_MAX_BUFFER = 64 * 1024 * 1024;
const LOGCAT_WINDOW_MULTIPLIER = 40;
const LOGCAT_MAX_WINDOW = 20_000;

/**
 * Size of the `-t` window to read. `-t` truncates the buffer *before* filters
 * apply, so a filtered read must look at more lines than it returns.
 */
function logcatWindow(lines: number, filtered: boolean): number {
  if (!filtered) return lines;
  return Math.min(lines * LOGCAT_WINDOW_MULTIPLIER, LOGCAT_MAX_WINDOW);
}

function buildLogcatArgs(options: LogOptions): string[] {
  const args = ["logcat", "-d", "-v", "time"];
  const levelLetter = options.level
    ? (LOG_LEVEL_MAP[options.level] ?? "I")
    : undefined;
  const lines = options.lines ?? 50;

  // A tag filter runs device-side and cuts the volume by orders of magnitude,
  // so it needs no window; everything else is filtered after `-t` truncates.
  if (options.tag) {
    args.push("-s", levelLetter ? `${options.tag}:${levelLetter}` : options.tag);
  } else {
    args.push("-t", String(logcatWindow(lines, Boolean(levelLetter || options.search))));
    if (levelLetter) args.push(`*:${levelLetter}`);
  }

  // Device-side regex keeps the search from being limited by the window.
  if (options.search) args.push("--regex", options.search);

  return args;
}

export interface DeviceProfile {
  apiLevel: number;
  gpuMode?: string;
  model?: string;
  isEmulator: boolean;
}

/**
 * Device traits worth knowing before a QA session: API level gates camera
 * capture (the HAL crashes on <=29) and the GPU backend gates screencap.
 */
export async function getDeviceProfile(
  deviceId: string,
): Promise<DeviceProfile> {
  const [sdk, egl, model] = await Promise.all([
    getProp(deviceId, "ro.build.version.sdk"),
    getProp(deviceId, "ro.hardware.egl"),
    getProp(deviceId, "ro.product.model"),
  ]);

  return {
    apiLevel: parseInt(sdk, 10) || 0,
    gpuMode: egl || undefined,
    model: model || undefined,
    isEmulator: deviceId.startsWith("emulator-") || model.startsWith("sdk_"),
  };
}

async function getProp(deviceId: string, prop: string): Promise<string> {
  try {
    const value = await adb(deviceId, ["shell", "getprop", prop], {
      timeout: 5_000,
    });
    return value.trim();
  } catch {
    return "";
  }
}

export async function getLogs(
  deviceId: string,
  options: LogOptions,
): Promise<string> {
  const output = await adb(deviceId, buildLogcatArgs(options), {
    timeout: 30_000,
    maxBuffer: LOGCAT_MAX_BUFFER,
  });
  const lines = options.lines ?? 50;
  return output.split("\n").slice(-lines).join("\n");
}

/**
 * Dumps the whole logcat buffer to a local file, for the cases a windowed read
 * cannot serve. Returns the path and the byte count.
 */
export async function dumpLogsToFile(
  deviceId: string,
  filePath: string,
): Promise<number> {
  const output = await adb(deviceId, ["logcat", "-d", "-v", "time"], {
    timeout: 120_000,
    maxBuffer: LOGCAT_MAX_BUFFER,
  });
  await writeFile(filePath, output, "utf8");
  return Buffer.byteLength(output, "utf8");
}

export async function clearLogs(deviceId: string): Promise<void> {
  await adb(deviceId, ["logcat", "-c"], { timeout: 10_000 });
}

export async function clearAppData(
  deviceId: string,
  packageName: string,
): Promise<void> {
  await adb(deviceId, ["shell", "pm", "clear", packageName]);
}

export async function clearAppCache(
  deviceId: string,
  packageName: string,
): Promise<void> {
  try {
    await adb(deviceId, ["shell", "run-as", packageName, "rm", "-rf", "cache/"]);
    await adb(deviceId, [
      "shell",
      "run-as",
      packageName,
      "rm",
      "-rf",
      "code_cache/",
    ]);
  } catch {
    // Fallback: pm clear --cache-only (API 30+)
    try {
      await adb(deviceId, ["shell", "pm", "clear", "--cache-only", packageName]);
    } catch {
      throw new Error(
        `Cannot clear cache for ${packageName}. The app may not be debuggable. Use mode: "all" to clear all data instead.`,
      );
    }
  }
}

export async function killApp(
  deviceId: string,
  packageName: string,
): Promise<void> {
  await adb(deviceId, ["shell", "am", "force-stop", packageName]);
}

/** Shorthand names for the runtime permissions a QA flow actually hits. */
const PERMISSION_ALIASES: Record<string, string[]> = {
  camera: ["android.permission.CAMERA"],
  location: [
    "android.permission.ACCESS_FINE_LOCATION",
    "android.permission.ACCESS_COARSE_LOCATION",
  ],
  background_location: ["android.permission.ACCESS_BACKGROUND_LOCATION"],
  storage: [
    "android.permission.READ_EXTERNAL_STORAGE",
    "android.permission.WRITE_EXTERNAL_STORAGE",
  ],
  media: [
    "android.permission.READ_MEDIA_IMAGES",
    "android.permission.READ_MEDIA_VIDEO",
  ],
  notifications: ["android.permission.POST_NOTIFICATIONS"],
  microphone: ["android.permission.RECORD_AUDIO"],
  contacts: ["android.permission.READ_CONTACTS"],
  phone: ["android.permission.READ_PHONE_STATE"],
  bluetooth: [
    "android.permission.BLUETOOTH_CONNECT",
    "android.permission.BLUETOOTH_SCAN",
  ],
};

export interface PermissionResult {
  permission: string;
  granted: boolean;
  detail?: string;
}

/** Expands an alias, or passes through a fully qualified permission name. */
export function expandPermission(name: string): string[] {
  return PERMISSION_ALIASES[name.toLowerCase()] ?? [name];
}

export function knownPermissionAliases(): string[] {
  return Object.keys(PERMISSION_ALIASES);
}

/**
 * Grants or revokes runtime permissions so a flow can start from a clean
 * install without a human tapping the system dialog. Permissions the app does
 * not declare are reported rather than silently skipped — that mismatch is
 * usually a typo or the wrong flavour.
 */
export async function setPermissions(
  deviceId: string,
  packageName: string,
  permissions: string[],
  grant: boolean,
): Promise<PermissionResult[]> {
  const declared = await declaredPermissions(deviceId, packageName);
  const action = grant ? "grant" : "revoke";
  const results: PermissionResult[] = [];

  for (const permission of permissions.flatMap(expandPermission)) {
    if (declared.size > 0 && !declared.has(permission)) {
      results.push({
        permission,
        granted: false,
        detail: "not declared by the app — nothing to change",
      });
      continue;
    }
    try {
      await adb(deviceId, ["shell", "pm", action, packageName, permission]);
      results.push({ permission, granted: grant });
    } catch (error) {
      results.push({
        permission,
        granted: false,
        detail:
          error instanceof Error ? error.message.split("\n").pop() : String(error),
      });
    }
  }

  return results;
}

async function declaredPermissions(
  deviceId: string,
  packageName: string,
): Promise<Set<string>> {
  try {
    const output = await adb(deviceId, [
      "shell",
      "dumpsys",
      "package",
      packageName,
    ]);
    const matches = output.match(/android\.permission\.[A-Z_]+/g) ?? [];
    return new Set(matches);
  } catch {
    return new Set();
  }
}

export async function installApp(
  deviceId: string,
  apkPath: string,
): Promise<string> {
  const provenance = await describeApk(apkPath);
  try {
    const output = await run(
      "adb",
      ["-s", deviceId, "install", "-r", apkPath],
      { timeout: 120_000 },
    );
    return `${output.trim()}\n${provenance}`;
  } catch (error) {
    // Which APK, and how old, is the first thing to check on a failed install
    // — a stale build or the wrong worktree is a recurring cause.
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n${provenance}`,
    );
  }
}

/** Absolute path, size and age of the APK, so a stale build is visible. */
async function describeApk(apkPath: string): Promise<string> {
  try {
    const absolute = resolvePath(apkPath);
    const info = await stat(absolute);
    const ageMinutes = Math.round((Date.now() - info.mtimeMs) / 60_000);
    const age =
      ageMinutes < 60
        ? `${ageMinutes} min old`
        : `${(ageMinutes / 60).toFixed(1)} h old`;
    return `APK: ${absolute} (${(info.size / 1024 / 1024).toFixed(1)} MB, built ${info.mtime.toISOString()}, ${age})`;
  } catch {
    return `APK: ${apkPath} (could not be read — check the path)`;
  }
}

export async function uninstallApp(
  deviceId: string,
  packageName: string,
): Promise<void> {
  await run("adb", ["-s", deviceId, "uninstall", packageName], {
    timeout: 60_000,
  });
}

export async function getAppInfo(
  deviceId: string,
  packageName: string,
): Promise<AppInfo> {
  const output = await adb(deviceId, ["shell", "dumpsys", "package", packageName], {
    timeout: 30_000,
  });

  if (!output.includes(`Package [${packageName}]`)) {
    return { installed: false };
  }

  return {
    installed: true,
    version_name: output.match(/versionName=(\S+)/)?.[1],
    version_code: output.match(/versionCode=(\d+)/)?.[1],
  };
}

export async function getForegroundApp(
  deviceId: string,
): Promise<ForegroundApp> {
  const activities = await adb(
    deviceId,
    ["shell", "dumpsys", "activity", "activities"],
    { timeout: 30_000 },
  );
  const resumed = activities.match(
    /(?:mResumedActivity|topResumedActivity)[^{]*\{[^ ]+ [^ ]+ ([^ /]+)\/([^ }]+)/,
  );
  if (resumed) return { package: resumed[1], activity: resumed[2] };

  const windows = await adb(deviceId, ["shell", "dumpsys", "window", "windows"], {
    timeout: 30_000,
  });
  const focus = windows.match(
    /mCurrentFocus=Window\{[^ ]+ [^ ]+ ([^ /]+)\/([^ }]+)/,
  );
  if (focus) return { package: focus[1], activity: focus[2] };

  throw new Error("Could not determine the foreground app from dumpsys output.");
}

export async function setWifi(
  deviceId: string,
  enabled: boolean,
): Promise<void> {
  await adb(deviceId, ["shell", "svc", "wifi", enabled ? "enable" : "disable"]);
}

export async function setMobileData(
  deviceId: string,
  enabled: boolean,
): Promise<void> {
  await adb(deviceId, ["shell", "svc", "data", enabled ? "enable" : "disable"]);
}

export async function setAirplaneMode(
  deviceId: string,
  enabled: boolean,
): Promise<void> {
  try {
    await adb(deviceId, [
      "shell",
      "cmd",
      "connectivity",
      "airplane-mode",
      enabled ? "enable" : "disable",
    ]);
  } catch {
    // Fallback for API < 29
    await adb(deviceId, [
      "shell",
      "settings",
      "put",
      "global",
      "airplane_mode_on",
      enabled ? "1" : "0",
    ]);
    await adb(deviceId, [
      "shell",
      "am",
      "broadcast",
      "-a",
      "android.intent.action.AIRPLANE_MODE",
      "--ez",
      "state",
      String(enabled),
    ]);
  }
}

export async function setNetworkThrottle(
  deviceId: string,
  options: { delay?: string; speed?: string },
): Promise<void> {
  requireEmulator(deviceId, "Network throttling uses the emulator console (adb emu network …)");
  if (options.delay) {
    await run("adb", ["-s", deviceId, "emu", "network", "delay", options.delay]);
  }
  if (options.speed) {
    await run("adb", ["-s", deviceId, "emu", "network", "speed", options.speed]);
  }
}

export async function setLocation(
  deviceId: string,
  latitude: number,
  longitude: number,
): Promise<void> {
  requireEmulator(deviceId, "Mock GPS uses the emulator console (adb emu geo fix …). For physical devices use a mock-location app");
  // geo fix takes longitude BEFORE latitude
  await run("adb", [
    "-s",
    deviceId,
    "emu",
    "geo",
    "fix",
    String(longitude),
    String(latitude),
  ]);
}

function requireEmulator(deviceId: string, why: string): void {
  if (!deviceId.startsWith("emulator-")) {
    throw new Error(`${why}. Device "${deviceId}" is not an emulator.`);
  }
}

export async function setAppearance(
  deviceId: string,
  mode: "dark" | "light",
): Promise<void> {
  await adb(deviceId, [
    "shell",
    "cmd",
    "uimode",
    "night",
    mode === "dark" ? "yes" : "no",
  ]);
}

const ROTATION_MAP: Record<string, number> = {
  portrait: 0,
  landscape: 1,
  reverse_portrait: 2,
  reverse_landscape: 3,
};

export async function rotate(
  deviceId: string,
  orientation: string,
): Promise<void> {
  const value = ROTATION_MAP[orientation];
  if (value === undefined) {
    throw new Error(
      `Unknown orientation: ${orientation}. Supported: ${Object.keys(ROTATION_MAP).join(", ")}`,
    );
  }
  await adb(deviceId, [
    "shell",
    "settings",
    "put",
    "system",
    "accelerometer_rotation",
    "0",
  ]);
  await adb(deviceId, [
    "shell",
    "settings",
    "put",
    "system",
    "user_rotation",
    String(value),
  ]);
}

/**
 * Progressive backoff. The old fixed pair of 800 ms waits totalled 1.6 s, too
 * short for a screen that animates continuously (a MapView, an endless spinner)
 * where uiautomator reports "could not get idle state".
 */
const UI_DUMP_ATTEMPTS: Array<{ waitMs: number; mode: "tty" | "file" | "compressed" }> = [
  { waitMs: 0, mode: "tty" },
  { waitMs: 0, mode: "file" },
  { waitMs: 300, mode: "compressed" },
  { waitMs: 800, mode: "tty" },
  { waitMs: 1500, mode: "file" },
  { waitMs: 2500, mode: "compressed" },
];

export async function getUiTree(
  deviceId?: string,
  options?: { timeoutMs?: number },
): Promise<UiElement[]> {
  const id = await resolveDevice(deviceId);

  // The on-device daemon answers in single-digit milliseconds; `uiautomator
  // dump` costs ~1.9s because it restarts the instrumentation runtime and
  // waits a hardcoded second for idle on every call.
  if (isDaemonEnabled() && !unavailableReason(id)) {
    try {
      return await getUiTreeViaDaemon(id);
    } catch (error) {
      if (error instanceof NoActiveWindowError) {
        throw new UiTreeUnavailableError("no-window", 1);
      }
      // The daemon holds UiAutomation exclusively, so it must be stopped before
      // the command-line path can work at all. The device is then skipped for a
      // while, so a device that cannot host it does not pay a failed startup on
      // every read.
      await stopDaemon(id).catch(() => {});
      markUnavailable(id, error instanceof Error ? error.message : String(error));
    }
  }
  const deadline = options?.timeoutMs
    ? Date.now() + options.timeoutMs
    : undefined;

  let lastError: unknown;
  let attempts = 0;

  for (const attempt of UI_DUMP_ATTEMPTS) {
    if (deadline && Date.now() + attempt.waitMs > deadline) break;
    if (attempt.waitMs > 0) await delay(attempt.waitMs);
    attempts++;

    try {
      const xml = await dumpUi(id, attempt.mode);
      if (xml) {
        const elements = parseUiXml(xml);
        if (elements.length > 0) return annotateOverlays(elements);
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw new UiTreeUnavailableError(inferDumpFailure(lastError), attempts);
}

export type UiTreeFailureReason =
  | "no-idle"
  | "device-gone"
  | "no-window"
  | "unknown";

/** Carries why the dump failed so callers can degrade instead of just failing. */
export class UiTreeUnavailableError extends Error {
  constructor(
    readonly reason: UiTreeFailureReason,
    readonly attempts: number,
  ) {
    super(UI_TREE_FAILURE_MESSAGES[reason].replace("{n}", String(attempts)));
    this.name = "UiTreeUnavailableError";
  }
}

const UI_TREE_FAILURE_MESSAGES: Record<UiTreeFailureReason, string> = {
  "no-idle":
    "The screen never went idle after {n} dump attempts — something is animating (a map, a spinner, a transition). uiautomator cannot read a moving screen.",
  "device-gone":
    "The device stopped responding to adb after {n} dump attempts. Check that the emulator is still running.",
  "no-window":
    "No window is on screen — the display may be off, or the device may be mid-transition. Wake it and retry.",
  unknown:
    "Failed to read the UI tree after {n} dump attempts. The screen may be in transition.",
};

function inferDumpFailure(error: unknown): UiTreeFailureReason {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("idle")) return "no-idle";
  if (message.includes("not found") || message.includes("no devices"))
    return "device-gone";
  return "unknown";
}

function dumpUi(
  deviceId: string,
  mode: "tty" | "file" | "compressed",
): Promise<string | null> {
  if (mode === "file") return dumpUiViaFile(deviceId);
  return dumpUiViaTty(deviceId, mode === "compressed");
}

/** Icon-font glyphs carry no readable meaning, so they are not text. */
function dropIconGlyphs(text: string): string {
  return isIconGlyph(text) ? "" : text;
}

/**
 * Raised when the daemon worked but the device has nothing to read. It is a
 * state of the screen, not a failure of the daemon, so it must not trigger the
 * fallback — retrying the same thing through `uiautomator dump` costs ~11s and
 * fails just the same.
 */
class NoActiveWindowError extends Error {}

async function getUiTreeViaDaemon(deviceId: string): Promise<UiElement[]> {
  const port = await ensureDaemon(deviceId);
  const payload = await request(port, "dump 0");

  if (payload.startsWith("ERROR no active window")) {
    throw new NoActiveWindowError(
      "No window is on screen — the display may be off, or the device may be mid-transition.",
    );
  }
  if (payload.startsWith("ERROR")) throw new Error(payload.trim());

  const elements = parseDaemonTree(payload);
  if (elements.length === 0) throw new Error("The daemon returned an empty tree.");
  return elements;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function dumpUiViaTty(
  deviceId: string,
  compressed = false,
): Promise<string | null> {
  // --compressed skips non-interactive nodes: it succeeds on some animating
  // screens where the full dump does not, and returns ~55% less XML.
  const dumpArgs = compressed
    ? ["uiautomator", "dump", "--compressed", "/dev/tty"]
    : ["uiautomator", "dump", "/dev/tty"];
  const output = await run("adb", ["-s", deviceId, "exec-out", ...dumpArgs], {
    timeout: 30_000,
  });

  const cleaned = output.replace(/\0/g, "").trim();
  return extractXml(cleaned);
}

async function dumpUiViaFile(deviceId: string): Promise<string | null> {
  const remotePath = "/sdcard/window_dump.xml";
  await adb(deviceId, ["shell", "uiautomator", "dump", remotePath], {
    timeout: 30_000,
  });
  const output = await adb(deviceId, ["shell", "cat", remotePath], {
    timeout: 10_000,
  });
  adb(deviceId, ["shell", "rm", "-f", remotePath]).catch(() => {});

  const cleaned = output.replace(/\0/g, "").trim();
  return extractXml(cleaned);
}

function extractXml(output: string): string | null {
  const xmlMatch = output.match(/<\?xml[\s\S]*<\/hierarchy>/);
  if (xmlMatch) return xmlMatch[0];

  const altMatch = output.match(/<hierarchy[\s\S]*<\/hierarchy>/);
  if (altMatch) return altMatch[0];

  return null;
}

function parseUiXml(xml: string): UiElement[] {
  const elements: UiElement[] = [];
  // Match both self-closing <node ... /> and opening <node ...> tags
  const nodeRegex = /<node\s+([^>]+?)\/?>/g;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = nodeRegex.exec(xml)) !== null) {
    const attrs = match[1];

    const type = extractAttr(attrs, "class")?.split(".").pop() ?? "Unknown";
    const text = extractAttr(attrs, "text") ?? "";
    const contentDesc = extractAttr(attrs, "content-desc") ?? "";
    const clickable = extractAttr(attrs, "clickable") === "true";
    const scrollable = extractAttr(attrs, "scrollable") === "true";
    const boundsStr = extractAttr(attrs, "bounds") ?? "";
    const rawResourceId = extractAttr(attrs, "resource-id") ?? "";
    const enabled = extractAttr(attrs, "enabled") === "true";
    const focused = extractAttr(attrs, "focused") === "true";

    // Parse bounds "[x1,y1][x2,y2]"
    const boundsMatch = boundsStr.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (!boundsMatch) continue;

    const x1 = parseInt(boundsMatch[1], 10);
    const y1 = parseInt(boundsMatch[2], 10);
    const x2 = parseInt(boundsMatch[3], 10);
    const y2 = parseInt(boundsMatch[4], 10);

    const displayText = text || contentDesc;

    // Strip package prefix from resource-id (e.g. "com.example:id/btn" → "btn")
    const resourceId = rawResourceId
      ? rawResourceId.replace(/^[^:]+:id\//, "")
      : undefined;

    elements.push({
      index,
      type,
      text: dropIconGlyphs(unescapeXml(displayText)),
      bounds: {
        x: x1,
        y: y1,
        width: x2 - x1,
        height: y2 - y1,
      },
      center_x: Math.round((x1 + x2) / 2),
      center_y: Math.round((y1 + y2) / 2),
      clickable,
      ...(scrollable ? { scrollable } : {}),
      resource_id: resourceId ? unescapeXml(resourceId) : undefined,
      enabled,
      focused,
    });
    index++;
  }

  return elements;
}

function extractAttr(attrs: string, name: string): string | undefined {
  const regex = new RegExp(`${name}="([^"]*)"`);
  const match = attrs.match(regex);
  return match ? match[1] : undefined;
}

export async function getScreenInfo(deviceId?: string): Promise<ScreenInfo> {
  const id = await resolveDevice(deviceId);

  const [sizeOutput, densityOutput, rotation] = await Promise.all([
    adb(id, ["shell", "wm", "size"]),
    adb(id, ["shell", "wm", "density"]),
    getRotation(id),
  ]);

  // Prefer "Override size" when present (wm size can report both)
  const sizeMatch =
    sizeOutput.match(/Override size:\s*(\d+)x(\d+)/) ??
    sizeOutput.match(/(\d+)x(\d+)/);
  let width = sizeMatch ? parseInt(sizeMatch[1], 10) : 0;
  let height = sizeMatch ? parseInt(sizeMatch[2], 10) : 0;

  // wm size reports the natural (portrait) size regardless of rotation
  if (rotation === 1 || rotation === 3) {
    [width, height] = [height, width];
  }

  const densityMatch = densityOutput.match(/(\d+)/);
  const density = densityMatch ? parseInt(densityMatch[1], 10) : 0;

  const orientation = width > height ? "landscape" : "portrait";

  return { width, height, density, orientation };
}

async function getRotation(deviceId: string): Promise<number> {
  try {
    const output = await adb(deviceId, ["shell", "dumpsys", "window"], {
      timeout: 15_000,
    });
    const match = output.match(
      /(?:mCurrentRotation|mRotation)=(?:ROTATION_)?(\d+)/,
    );
    if (!match) return 0;
    const value = parseInt(match[1], 10);
    return value >= 90 ? value / 90 : value;
  } catch {
    return 0;
  }
}

/**
 * Launches an app, verifying the result instead of assuming it. `monkey` alone
 * is fragile — it fails on permissions, on device state, and on apps that do
 * not declare a LAUNCHER category the way it expects — and a failed launch
 * means the whole QA session never starts.
 */
export async function launchApp(
  packageName: string,
  deviceId?: string,
): Promise<void> {
  const id = await resolveDevice(deviceId);
  const failures: string[] = [];

  for (const strategy of LAUNCH_STRATEGIES) {
    try {
      await strategy(id, packageName);
      if (await isInForeground(id, packageName)) return;
      failures.push(`${strategy.name}: ran but the app did not come to front`);
    } catch (error) {
      failures.push(
        `${strategy.name}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
      );
    }
  }

  throw new Error(
    `Could not launch ${packageName} on ${id}.\n${failures.join("\n")}\n${await suggestInstalledPackages(id, packageName)}`,
  );
}

const LAUNCH_STRATEGIES: Array<
  ((deviceId: string, packageName: string) => Promise<void>) & { name: string }
> = [
  async function monkey(deviceId, packageName) {
    await adb(deviceId, [
      "shell",
      "monkey",
      "-p",
      packageName,
      "-c",
      "android.intent.category.LAUNCHER",
      "1",
    ]);
  },
  async function resolvedActivity(deviceId, packageName) {
    const component = await resolveLaunchActivity(deviceId, packageName);
    if (!component) throw new Error("no launchable activity resolved");
    await adb(deviceId, ["shell", "am", "start", "-n", component]);
  },
  async function mainIntent(deviceId, packageName) {
    await adb(deviceId, [
      "shell",
      "am",
      "start",
      "-a",
      "android.intent.action.MAIN",
      "-c",
      "android.intent.category.LAUNCHER",
      "-p",
      packageName,
    ]);
  },
];

async function resolveLaunchActivity(
  deviceId: string,
  packageName: string,
): Promise<string | undefined> {
  const output = await adb(deviceId, [
    "shell",
    "cmd",
    "package",
    "resolve-activity",
    "--brief",
    packageName,
  ]);
  return output
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.includes("/"));
}

const FOREGROUND_POLL_MS = 400;
const FOREGROUND_ATTEMPTS = 8;

async function isInForeground(
  deviceId: string,
  packageName: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < FOREGROUND_ATTEMPTS; attempt++) {
    await delay(FOREGROUND_POLL_MS);
    try {
      const foreground = await getForegroundApp(deviceId);
      if (foreground.package === packageName) return true;
    } catch {
      // Keep polling — the window may not be up yet.
    }
  }
  return false;
}

/** Names look-alike installed packages, which catches the `.beta`/`.qa` typo. */
async function suggestInstalledPackages(
  deviceId: string,
  packageName: string,
): Promise<string> {
  try {
    const stem = packageName.split(".").slice(0, 3).join(".");
    const output = await adb(deviceId, [
      "shell",
      "pm",
      "list",
      "packages",
      stem,
    ]);
    const installed = output
      .split("\n")
      .map((line) => line.replace("package:", "").trim())
      .filter(Boolean);

    if (installed.length === 0) {
      return `No installed package matches "${stem}". Check the package name, or install the APK first.`;
    }
    if (!installed.includes(packageName)) {
      return `${packageName} is not installed. Installed and similar: ${installed.join(", ")}.`;
    }
    return `${packageName} is installed, so this is a launch failure rather than a wrong package name.`;
  } catch {
    return "";
  }
}

export async function openUrl(url: string, deviceId?: string): Promise<void> {
  const id = await resolveDevice(deviceId);
  // shellQuote protects &-separated query params from the device-side shell
  await adb(id, [
    "shell",
    "am",
    "start",
    "-a",
    "android.intent.action.VIEW",
    "-d",
    shellQuote(url),
  ]);
}

const REMOTE_RECORDING_PATH = "/sdcard/mcp-mobile-recording.mp4";
const activeRecordings = new Map<string, ChildProcess>();

/**
 * Kills `screenrecord` processes left on devices by a previous server instance.
 * The in-memory map dies with the process, so a device-side check is the only
 * way to tell a real leftover from a lost handle.
 */
export async function cleanupOrphanRecordings(): Promise<void> {
  try {
    const devices = await listDevices();
    await Promise.all(
      devices
        .filter((device) => device.status === "device")
        .filter((device) => !activeRecordings.has(device.id))
        .map((device) =>
          adb(device.id, ["shell", "pkill", "-2", "screenrecord"], {
            timeout: 5_000,
          }).catch(() => {}),
        ),
    );
  } catch {
    // No adb or no devices — nothing to clean up.
  }
}

/** True when the device itself has a `screenrecord` running. */
export async function isRecordingOnDevice(deviceId: string): Promise<boolean> {
  try {
    const output = await adb(deviceId, ["shell", "pidof", "screenrecord"], {
      timeout: 5_000,
    });
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

export async function startRecording(
  deviceId?: string,
  force = false,
): Promise<string> {
  const id = await resolveDevice(deviceId);
  if (activeRecordings.has(id) || (await isRecordingOnDevice(id))) {
    if (!force) {
      throw new Error(
        `A recording is already in progress on ${id}. Stop it first with action: "stop", or pass force: true to discard it and start over.`,
      );
    }
    await discardRecording(id);
  }

  const child = spawnProc("adb", [
    "-s",
    id,
    "shell",
    "screenrecord",
    "--time-limit",
    "180",
    REMOTE_RECORDING_PATH,
  ]);
  activeRecordings.set(id, child);

  await delay(500);
  if (child.exitCode !== null && child.exitCode !== 0) {
    activeRecordings.delete(id);
    throw new Error(
      "screenrecord failed to start. Some emulators without GPU acceleration do not support it.",
    );
  }

  return id;
}

/** Drops a recording without producing a file — used to recover a stuck device. */
async function discardRecording(deviceId: string): Promise<void> {
  const child = activeRecordings.get(deviceId);
  activeRecordings.delete(deviceId);
  await adb(deviceId, ["shell", "pkill", "-2", "screenrecord"]).catch(() => {});
  if (child && child.exitCode === null) await waitForExit(child, 3000);
  await adb(deviceId, ["shell", "rm", "-f", REMOTE_RECORDING_PATH]).catch(
    () => {},
  );
}

export async function stopRecording(deviceId?: string): Promise<string> {
  const id = await resolveDevice(deviceId);
  const child = activeRecordings.get(id);
  // The handle can be missing while the device still records — another server
  // instance started it. Finalize by device-side signal in that case.
  if (!child && !(await isRecordingOnDevice(id))) {
    throw new Error(
      `No active recording on ${id}. Start one with action: "start".`,
    );
  }
  activeRecordings.delete(id);

  if (!child) {
    await adb(id, ["shell", "kill -2 $(pidof screenrecord)"]).catch(() => {});
    await delay(1000);
  } else if (child.exitCode === null) {
    // SIGINT on the device lets screenrecord finalize the mp4
    await adb(id, ["shell", "kill -2 $(pidof screenrecord)"]).catch(() =>
      child.kill(),
    );
    await waitForExit(child, 3000);
  }
  await delay(300);

  const localPath = join(tmpdir(), `mcp-recording-${id}-${Date.now()}.mp4`);
  await run("adb", ["-s", id, "pull", REMOTE_RECORDING_PATH, localPath], {
    timeout: 60_000,
  });
  adb(id, ["shell", "rm", "-f", REMOTE_RECORDING_PATH]).catch(() => {});

  return localPath;
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

const KEYCODE_MOVE_END = 123;
const KEYCODE_DEL = 67;

export async function clearTextField(
  deviceId?: string,
  maxChars: number = 100,
): Promise<number> {
  const id = await resolveDevice(deviceId);

  let chars = maxChars;
  try {
    const tree = await getUiTree(id);
    const focused = tree.find((el) => el.focused);
    if (focused?.text) chars = Math.min(focused.text.length + 5, 250);
  } catch {
    // No tree available — fall back to maxChars deletions
  }

  await adb(id, ["shell", "input", "keyevent", String(KEYCODE_MOVE_END)]);

  const codes = Array(chars).fill(String(KEYCODE_DEL));
  for (let i = 0; i < codes.length; i += 50) {
    await adb(id, ["shell", "input", "keyevent", ...codes.slice(i, i + 50)], {
      timeout: 60_000,
    });
  }

  return chars;
}
