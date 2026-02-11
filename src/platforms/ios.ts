import { exec, execBuffer } from "../utils/exec.js";
import type { Device, UiElement, ScreenInfo } from "../types.js";
import { tmpdir } from "os";
import { join } from "path";

async function hasIdb(): Promise<boolean> {
  try {
    await exec("which idb");
    return true;
  } catch {
    return false;
  }
}

export async function listDevices(): Promise<Device[]> {
  const devices: Device[] = [];

  // Simulators via xcrun simctl
  try {
    const output = await exec("xcrun simctl list devices available --json");
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
      const output = await exec("idb list-targets --json");
      const lines = output.trim().split("\n");
      for (const line of lines) {
        try {
          const target = JSON.parse(line);
          if (target.type === "device") {
            // Avoid duplicates
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
  const devices = await listDevices();
  // Prefer booted simulators first
  const booted = devices.filter((d) => d.status === "booted");
  if (booted.length > 0) return booted[0].id;

  const connected = devices.filter(
    (d) => d.status === "booted" || d.status === "connected",
  );
  if (connected.length === 0) {
    throw new Error(
      "No connected iOS devices or booted simulators found. Boot a simulator with `xcrun simctl boot <device>` or connect a device with idb.",
    );
  }
  return connected[0].id;
}

async function resolveDevice(deviceId?: string): Promise<string> {
  return deviceId ?? (await getFirstDeviceId());
}

async function isSimulator(deviceId: string): Promise<boolean> {
  try {
    const output = await exec("xcrun simctl list devices --json");
    const data = JSON.parse(output);
    for (const devs of Object.values(data.devices ?? {})) {
      for (const dev of devs as Array<{ udid: string }>) {
        if (dev.udid === deviceId) return true;
      }
    }
  } catch {
    // Assume physical device if simctl fails
  }
  return false;
}

export async function screenshot(deviceId?: string): Promise<Buffer> {
  const id = await resolveDevice(deviceId);
  const isSim = await isSimulator(id);

  if (isSim) {
    const tmpFile = join(tmpdir(), `mcp-screenshot-${id}.png`);
    await exec(`xcrun simctl io ${id} screenshot --type png ${tmpFile}`, {
      timeout: 30_000,
    });
    const { readFile, unlink } = await import("fs/promises");
    const buffer = await readFile(tmpFile);
    await unlink(tmpFile).catch(() => {});
    return buffer;
  }

  // Physical device via idb
  if (!(await hasIdb())) {
    throw new Error(
      "idb is required for screenshots on physical iOS devices. Install it: brew install idb-companion && pip install fb-idb",
    );
  }
  const tmpFile = join(tmpdir(), `mcp-screenshot-${id}.png`);
  await exec(`idb screenshot --udid ${id} ${tmpFile}`, { timeout: 30_000 });
  const { readFile, unlink } = await import("fs/promises");
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
  const isSim = await isSimulator(id);

  if (isSim) {
    await exec(`xcrun simctl io ${id} tap ${x} ${y}`);
  } else {
    await requireIdb();
    await exec(`idb ui tap --udid ${id} ${x} ${y}`);
  }
}

export async function doubleTap(
  x: number,
  y: number,
  deviceId?: string,
): Promise<void> {
  const id = await resolveDevice(deviceId);

  if (await hasIdb()) {
    await exec(`idb ui tap --double --udid ${id} ${x} ${y}`);
  } else {
    // Fallback: two rapid taps via simctl
    await exec(`xcrun simctl io ${id} tap ${x} ${y}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await exec(`xcrun simctl io ${id} tap ${x} ${y}`);
  }
}

export async function longPress(
  x: number,
  y: number,
  durationMs: number = 1000,
  deviceId?: string,
): Promise<void> {
  const id = await resolveDevice(deviceId);
  const durationSec = durationMs / 1000;

  if (await hasIdb()) {
    await exec(`idb ui tap --duration ${durationSec} --udid ${id} ${x} ${y}`);
  } else {
    // simctl doesn't natively support long press; use a swipe to same point
    await exec(
      `xcrun simctl io ${id} swipe ${x} ${y} ${x} ${y} --duration ${durationSec}`,
    );
  }
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

  if (await hasIdb()) {
    await exec(
      `idb ui swipe --udid ${id} ${startX} ${startY} ${endX} ${endY} --duration ${durationMs / 1000}`,
    );
  } else {
    await exec(
      `xcrun simctl io ${id} swipe ${startX} ${startY} ${endX} ${endY}`,
    );
  }
}

export async function typeText(
  text: string,
  deviceId?: string,
): Promise<void> {
  const id = await resolveDevice(deviceId);

  if (await hasIdb()) {
    // Escape for shell
    const escaped = text.replace(/'/g, "'\\''");
    await exec(`idb ui text --udid ${id} '${escaped}'`);
  } else {
    // simctl keyboard input
    const escaped = text.replace(/'/g, "'\\''");
    await exec(`xcrun simctl io ${id} type '${escaped}'`);
  }
}

const IOS_KEY_MAP: Record<string, { idb: string; simctl?: string }> = {
  home: { idb: "1", simctl: undefined }, // Home button handled differently
  back: { idb: "back", simctl: undefined },
  enter: { idb: "13", simctl: "return" },
  delete: { idb: "42", simctl: "delete" },
  volume_up: { idb: "volume_up" },
  volume_down: { idb: "volume_down" },
  power: { idb: "power" },
  tab: { idb: "43", simctl: "tab" },
  recent_apps: { idb: "recent_apps" },
};

export async function pressKey(
  key: string,
  deviceId?: string,
): Promise<void> {
  const id = await resolveDevice(deviceId);
  const mapping = IOS_KEY_MAP[key];

  if (!mapping) {
    throw new Error(
      `Unknown key: ${key}. Supported keys: ${Object.keys(IOS_KEY_MAP).join(", ")}`,
    );
  }

  if (key === "home") {
    // Home button
    if (await hasIdb()) {
      await exec(`idb ui button --udid ${id} HOME`);
    } else {
      await exec(`xcrun simctl io ${id} keycode 0x124`);
    }
    return;
  }

  if (await hasIdb()) {
    await exec(`idb ui key --udid ${id} ${mapping.idb}`);
  } else if (mapping.simctl) {
    await exec(`xcrun simctl io ${id} keycode ${mapping.simctl}`);
  } else {
    throw new Error(
      `Key "${key}" is not supported on simulators without idb. Install idb: brew install idb-companion && pip install fb-idb`,
    );
  }
}

export async function getUiTree(deviceId?: string): Promise<UiElement[]> {
  const id = await resolveDevice(deviceId);

  if (await hasIdb()) {
    const output = await exec(`idb ui describe-all --udid ${id}`, {
      timeout: 30_000,
    });
    return parseIdbDescribeAll(output);
  }

  // Fallback: accessibility audit via simctl (limited)
  try {
    const output = await exec(
      `xcrun simctl ui ${id} describe-all`,
      { timeout: 30_000 },
    );
    return parseIdbDescribeAll(output);
  } catch {
    throw new Error(
      "UI tree inspection requires idb for iOS. Install it: brew install idb-companion && pip install fb-idb",
    );
  }
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

export async function getScreenInfo(
  deviceId?: string,
): Promise<ScreenInfo> {
  const id = await resolveDevice(deviceId);
  const isSim = await isSimulator(id);

  if (isSim) {
    // Get device info from simctl
    const output = await exec("xcrun simctl list devices --json");
    const data = JSON.parse(output);

    // Take a screenshot to determine actual size
    const tmpFile = join(tmpdir(), `mcp-screeninfo-${id}.png`);
    await exec(`xcrun simctl io ${id} screenshot --type png ${tmpFile}`);
    const sharp = (await import("sharp")).default;
    const { readFile, unlink } = await import("fs/promises");
    const buffer = await readFile(tmpFile);
    const metadata = await sharp(buffer).metadata();
    await unlink(tmpFile).catch(() => {});

    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;

    return {
      width,
      height,
      density: 2, // Default retina for simulators
      orientation: width > height ? "landscape" : "portrait",
    };
  }

  // Physical device via idb
  await requireIdb();
  const output = await exec(`idb describe --udid ${id} --json`);
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
  const isSim = await isSimulator(id);

  if (isSim) {
    await exec(`xcrun simctl launch ${id} ${bundleId}`);
  } else {
    await requireIdb();
    await exec(`idb launch --udid ${id} ${bundleId}`);
  }
}

export async function openUrl(
  url: string,
  deviceId?: string,
): Promise<void> {
  const id = await resolveDevice(deviceId);
  const isSim = await isSimulator(id);

  if (isSim) {
    await exec(`xcrun simctl openurl ${id} "${url}"`);
  } else {
    await requireIdb();
    await exec(`idb open --udid ${id} "${url}"`);
  }
}

async function requireIdb(): Promise<void> {
  if (!(await hasIdb())) {
    throw new Error(
      "idb is required for this operation on physical iOS devices. Install it: brew install idb-companion && pip install fb-idb",
    );
  }
}
