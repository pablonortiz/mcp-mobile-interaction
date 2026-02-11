import { exec, execBuffer } from "../utils/exec.js";
import type { Device, UiElement, ScreenInfo } from "../types.js";

function adb(deviceId: string, cmd: string): string {
  return `adb -s ${deviceId} ${cmd}`;
}

export async function listDevices(): Promise<Device[]> {
  const output = await exec("adb devices -l");
  const lines = output.trim().split("\n").slice(1); // skip header

  const devices: Device[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("*")) continue;

    const parts = trimmed.split(/\s+/);
    const id = parts[0];
    const status = parts[1];

    // Extract model name from "model:XXX" token
    const modelToken = parts.find((p) => p.startsWith("model:"));
    const name = modelToken ? modelToken.split(":")[1] : id;

    devices.push({ id, name, platform: "android", status });
  }

  return devices;
}

export async function getFirstDeviceId(): Promise<string> {
  const devices = await listDevices();
  const connected = devices.filter((d) => d.status === "device");
  if (connected.length === 0) {
    throw new Error(
      "No connected Android devices found. Make sure an emulator is running or a device is connected via USB with ADB debugging enabled.",
    );
  }
  return connected[0].id;
}

async function resolveDevice(deviceId?: string): Promise<string> {
  return deviceId ?? (await getFirstDeviceId());
}

export async function screenshot(deviceId?: string): Promise<Buffer> {
  const id = await resolveDevice(deviceId);
  return execBuffer(adb(id, "exec-out screencap -p"), { timeout: 30_000 });
}

export async function tap(
  x: number,
  y: number,
  deviceId?: string,
): Promise<void> {
  const id = await resolveDevice(deviceId);
  await exec(adb(id, `shell input tap ${x} ${y}`));
}

export async function doubleTap(
  x: number,
  y: number,
  deviceId?: string,
): Promise<void> {
  const id = await resolveDevice(deviceId);
  // Two rapid taps with minimal delay
  await exec(
    adb(id, `shell "input tap ${x} ${y} && sleep 0.05 && input tap ${x} ${y}"`),
  );
}

export async function longPress(
  x: number,
  y: number,
  durationMs: number = 1000,
  deviceId?: string,
): Promise<void> {
  const id = await resolveDevice(deviceId);
  // Swipe from point to same point = long press
  await exec(adb(id, `shell input swipe ${x} ${y} ${x} ${y} ${durationMs}`));
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
  await exec(
    adb(id, `shell input swipe ${startX} ${startY} ${endX} ${endY} ${durationMs}`),
  );
}

export async function typeText(
  text: string,
  deviceId?: string,
): Promise<void> {
  const id = await resolveDevice(deviceId);
  // Escape special characters for ADB shell
  const escaped = text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/ /g, "%s")
    .replace(/&/g, "\\&")
    .replace(/</g, "\\<")
    .replace(/>/g, "\\>")
    .replace(/\|/g, "\\|")
    .replace(/;/g, "\\;")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`");
  await exec(adb(id, `shell input text "${escaped}"`));
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
};

export async function pressKey(
  key: string,
  deviceId?: string,
): Promise<void> {
  const id = await resolveDevice(deviceId);
  const keycode = KEYCODE_MAP[key];
  if (keycode === undefined) {
    throw new Error(
      `Unknown key: ${key}. Supported keys: ${Object.keys(KEYCODE_MAP).join(", ")}`,
    );
  }
  await exec(adb(id, `shell input keyevent ${keycode}`));
}

export async function getUiTree(deviceId?: string): Promise<UiElement[]> {
  const id = await resolveDevice(deviceId);

  // Strategy: tty → file → wait+tty → wait+file
  const strategies: Array<() => Promise<string | null>> = [
    () => dumpUiViaTty(id),
    () => dumpUiViaFile(id),
    async () => { await delay(800); return dumpUiViaTty(id); },
    async () => { await delay(800); return dumpUiViaFile(id); },
  ];

  for (const strategy of strategies) {
    try {
      const xml = await strategy();
      if (xml) {
        const elements = parseUiXml(xml);
        if (elements.length > 0) return elements;
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
  const output = await exec(adb(deviceId, "exec-out uiautomator dump /dev/tty"), {
    timeout: 30_000,
  });

  // Strip null bytes and other binary artifacts
  const cleaned = output.replace(/\0/g, "").trim();
  return extractXml(cleaned);
}

async function dumpUiViaFile(deviceId: string): Promise<string | null> {
  const remotePath = "/sdcard/window_dump.xml";
  await exec(adb(deviceId, `shell uiautomator dump ${remotePath}`), {
    timeout: 30_000,
  });
  const output = await exec(adb(deviceId, `shell cat ${remotePath}`), {
    timeout: 10_000,
  });
  // Clean up remote file
  exec(adb(deviceId, `shell rm -f ${remotePath}`)).catch(() => {});

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
      text: displayText,
      bounds: {
        x: x1,
        y: y1,
        width: x2 - x1,
        height: y2 - y1,
      },
      center_x: Math.round((x1 + x2) / 2),
      center_y: Math.round((y1 + y2) / 2),
      clickable,
      resource_id: resourceId,
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

export async function getScreenInfo(
  deviceId?: string,
): Promise<ScreenInfo> {
  const id = await resolveDevice(deviceId);

  const [sizeOutput, densityOutput] = await Promise.all([
    exec(adb(id, "shell wm size")),
    exec(adb(id, "shell wm density")),
  ]);

  // Parse "Physical size: 1080x1920"
  const sizeMatch = sizeOutput.match(/(\d+)x(\d+)/);
  const width = sizeMatch ? parseInt(sizeMatch[1], 10) : 0;
  const height = sizeMatch ? parseInt(sizeMatch[2], 10) : 0;

  // Parse "Physical density: 420"
  const densityMatch = densityOutput.match(/(\d+)/);
  const density = densityMatch ? parseInt(densityMatch[1], 10) : 0;

  const orientation = width > height ? "landscape" : "portrait";

  return { width, height, density, orientation };
}

export async function launchApp(
  packageName: string,
  deviceId?: string,
): Promise<void> {
  const id = await resolveDevice(deviceId);
  await exec(
    adb(id, `shell monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`),
  );
}

export async function openUrl(
  url: string,
  deviceId?: string,
): Promise<void> {
  const id = await resolveDevice(deviceId);
  await exec(
    adb(id, `shell am start -a android.intent.action.VIEW -d "${url}"`),
  );
}
