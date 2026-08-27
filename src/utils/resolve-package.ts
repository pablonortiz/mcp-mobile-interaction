import type { Platform } from "../types.js";
import { getDriver } from "../platforms/driver.js";

/**
 * Falls back to the foreground app for tools that act on "the app at hand".
 * The package name was a required parameter the server can read off the device.
 */
export async function resolvePackage(
  explicit: string | undefined,
  platform: Platform,
  deviceId: string | undefined,
): Promise<string> {
  if (explicit) return explicit;

  const driver = getDriver(platform);
  const id = deviceId ?? (await driver.getFirstDeviceId());
  const foreground = await driver.getForegroundApp(id).catch(() => undefined);

  if (!foreground?.package) {
    throw new Error(
      "No package given and no app in the foreground to fall back to. Pass package explicitly.",
    );
  }
  return foreground.package;
}

export const PACKAGE_DESCRIPTION =
  "App package name (Android, e.g. com.example.app) or bundle ID (iOS). Optional — defaults to the app currently in the foreground.";
