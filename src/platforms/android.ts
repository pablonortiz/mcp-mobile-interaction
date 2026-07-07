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
import { unescapeXml } from "../utils/xml.js";

const DEVICE_CACHE_TTL_MS = 10_000;
let cachedFirstDevice: { id: string; timestamp: number } | undefined;

export function resetCaches(): void {
  cachedFirstDevice = undefined;
}

function adb(deviceId: string, args: string[], options?: { timeout?: number }) {
  return run("adb", ["-s", deviceId, ...args], options);
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

  cachedFirstDevice = { id: connected[0].id, timestamp: Date.now() };
  return connected[0].id;
}

async function resolveDevice(deviceId?: string): Promise<string> {
  return deviceId ?? (await getFirstDeviceId());
}

export async function screenshot(deviceId?: string): Promise<Buffer> {
  const id = await resolveDevice(deviceId);
  return runBuffer("adb", ["-s", id, "exec-out", "screencap", "-p"], {
    timeout: 30_000,
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

export async function getLogs(
  deviceId: string,
  options: LogOptions,
): Promise<string> {
  const args = ["logcat", "-d", "-v", "time"];
  const levelLetter = options.level
    ? (LOG_LEVEL_MAP[options.level] ?? "I")
    : undefined;

  if (options.tag) {
    args.push("-s", levelLetter ? `${options.tag}:${levelLetter}` : options.tag);
  } else if (levelLetter) {
    args.push(`*:${levelLetter}`);
  }

  const output = await adb(deviceId, args, { timeout: 30_000 });
  const lines = options.lines ?? 50;
  return output.split("\n").slice(-lines).join("\n");
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

export async function installApp(
  deviceId: string,
  apkPath: string,
): Promise<string> {
  const output = await run("adb", ["-s", deviceId, "install", "-r", apkPath], {
    timeout: 120_000,
  });
  return output.trim();
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

export async function getUiTree(deviceId?: string): Promise<UiElement[]> {
  const id = await resolveDevice(deviceId);

  // Strategy: tty → file → wait+tty → wait+file
  const strategies: Array<() => Promise<string | null>> = [
    () => dumpUiViaTty(id),
    () => dumpUiViaFile(id),
    async () => {
      await delay(800);
      return dumpUiViaTty(id);
    },
    async () => {
      await delay(800);
      return dumpUiViaFile(id);
    },
  ];

  for (const strategy of strategies) {
    try {
      const xml = await strategy();
      if (xml) {
        const elements = parseUiXml(xml);
        if (elements.length > 0) return annotateOverlays(elements);
      }
    } catch {
      // Try next strategy
    }
  }

  throw new Error(
    "Failed to parse UI tree XML from uiautomator dump after 4 attempts. The screen may be in transition — try again after a short delay.",
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function dumpUiViaTty(deviceId: string): Promise<string | null> {
  const output = await run(
    "adb",
    ["-s", deviceId, "exec-out", "uiautomator", "dump", "/dev/tty"],
    { timeout: 30_000 },
  );

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
      text: unescapeXml(displayText),
      bounds: {
        x: x1,
        y: y1,
        width: x2 - x1,
        height: y2 - y1,
      },
      center_x: Math.round((x1 + x2) / 2),
      center_y: Math.round((y1 + y2) / 2),
      clickable,
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

export async function launchApp(
  packageName: string,
  deviceId?: string,
): Promise<void> {
  const id = await resolveDevice(deviceId);
  await adb(id, [
    "shell",
    "monkey",
    "-p",
    packageName,
    "-c",
    "android.intent.category.LAUNCHER",
    "1",
  ]);
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

export async function startRecording(deviceId?: string): Promise<string> {
  const id = await resolveDevice(deviceId);
  if (activeRecordings.has(id)) {
    throw new Error(
      `A recording is already in progress on ${id}. Stop it first with action: "stop".`,
    );
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

export async function stopRecording(deviceId?: string): Promise<string> {
  const id = await resolveDevice(deviceId);
  const child = activeRecordings.get(id);
  if (!child) {
    throw new Error(
      `No active recording on ${id}. Start one with action: "start".`,
    );
  }
  activeRecordings.delete(id);

  if (child.exitCode === null) {
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
