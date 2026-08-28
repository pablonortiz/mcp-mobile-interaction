import type { Platform } from "../types.js";
import * as android from "../platforms/android.js";
import * as ios from "../platforms/ios.js";

const CACHE_TTL_MS = 10_000;
let cached: { platform: Platform; timestamp: number } | undefined;

export function resetPlatformCache(): void {
  cached = undefined;
}

/**
 * Infers the platform from what is actually connected, so it stops being a
 * parameter every call has to carry. Android is probed first: `adb devices`
 * costs ~11 ms against ~960 ms for `simctl list`, and it is the common case.
 */
export async function resolvePlatform(
  explicit?: Platform,
): Promise<Platform> {
  if (explicit) return explicit;
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.platform;
  }

  const androidDevices = await connectedAndroid();
  const iosDevices = await bootedIos();

  if (androidDevices.length > 0 && iosDevices.length > 0) {
    throw new Error(
      `Both platforms have devices available (Android: ${androidDevices.join(", ")}; iOS: ${iosDevices.join(", ")}). Pass platform explicitly.`,
    );
  }
  if (androidDevices.length === 0 && iosDevices.length === 0) {
    throw new Error(
      "No devices found on either platform. Start an emulator or connect a device, then retry.",
    );
  }

  const platform: Platform = androidDevices.length > 0 ? "android" : "ios";
  cached = { platform, timestamp: Date.now() };
  return platform;
}

async function connectedAndroid(): Promise<string[]> {
  try {
    const devices = await android.listDevices();
    return devices
      .filter((device) => device.status === "device")
      .map((device) => device.id);
  } catch {
    return [];
  }
}

/** Only booted simulators count: a Mac always has dozens merely available. */
async function bootedIos(): Promise<string[]> {
  try {
    const devices = await ios.listDevices();
    return devices
      .filter((device) => device.status === "booted")
      .map((device) => device.id);
  } catch {
    return [];
  }
}

/**
 * Kept terse on purpose: this string is repeated in every tool's schema, so
 * each word costs tokens 36 times over in the listing every session. The full
 * explanation lives in the error raised when the platform is ambiguous, which
 * is the only moment it matters.
 */
export const PLATFORM_DESCRIPTION = "Target platform. Inferred if omitted.";
