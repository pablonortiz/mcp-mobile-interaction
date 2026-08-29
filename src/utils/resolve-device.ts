import type { Platform } from "../types.js";
import { getDriver } from "../platforms/driver.js";

/**
 * Resolves the device a tool should act on. Thin, but it is the single place
 * where "no device_id given" turns into a concrete device — the rule that
 * refuses to guess between several lives one level down, in the platform.
 */
export async function resolveDeviceId(
  platform: Platform,
  deviceId?: string,
): Promise<string> {
  return deviceId ?? (await getDriver(platform).getFirstDeviceId());
}

export const DEVICE_ID_DESCRIPTION = "Device ID. Omit for the connected device.";
