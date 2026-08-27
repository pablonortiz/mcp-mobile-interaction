import type { Platform } from "../types.js";
import { getDriver } from "../platforms/driver.js";
import { UiTreeUnavailableError } from "../platforms/android.js";
import { compressScreenshot, isUniformImage } from "./image.js";

interface DegradedResponse {
  [key: string]: unknown;
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: "image/jpeg" }
  >;
  isError: true;
}

/**
 * Turns a failed UI dump into something the agent can still act on: the reason,
 * where the device actually is, and a screenshot. Without this a dump failure
 * — the single most frequent error of this server — dead-ends the session.
 */
export async function degradedUiTreeResponse(
  platform: Platform,
  deviceId: string | undefined,
  error: unknown,
  action: string,
): Promise<DegradedResponse> {
  const reason =
    error instanceof UiTreeUnavailableError
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error);

  const driver = getDriver(platform);
  const [foreground, screenshot] = await Promise.all([
    driver
      .getForegroundApp(deviceId ?? (await driver.getFirstDeviceId()))
      .catch(() => undefined),
    captureFallbackScreenshot(platform, deviceId),
  ]);

  const lines = [
    `Could not ${action}: ${reason}`,
    foreground ? `Foreground app: ${foreground.package}` : undefined,
    screenshot
      ? "A screenshot of the current screen is attached — you can act on it with coordinate tools (tap, swipe) while the tree is unavailable."
      : "No screenshot could be captured either; the device may be gone.",
    "If the screen is animating, wait and retry, or raise timeout_ms.",
  ].filter(Boolean) as string[];

  const content: DegradedResponse["content"] = [
    { type: "text", text: lines.join("\n") },
  ];
  if (screenshot) {
    content.push({ type: "image", data: screenshot, mimeType: "image/jpeg" });
  }

  return { content, isError: true };
}

async function captureFallbackScreenshot(
  platform: Platform,
  deviceId: string | undefined,
): Promise<string | undefined> {
  try {
    const raw = await getDriver(platform).screenshot(deviceId);
    if (await isUniformImage(raw)) return undefined;
    const { base64 } = await compressScreenshot(raw, {
      quality: 50,
      scale: 0.5,
    });
    return base64;
  } catch {
    return undefined;
  }
}

/** True when the failure came from the UI dump, not from the action itself. */
export function isUiTreeFailure(error: unknown): boolean {
  return (
    error instanceof UiTreeUnavailableError ||
    (error instanceof Error && error.message.includes("uiautomator"))
  );
}

/**
 * Wraps a tool handler so a failed UI dump degrades to a screenshot response
 * instead of surfacing as a hard error for an action the user asked for.
 */
export function uiTreeSafe<
  A extends { platform: Platform; device_id?: string },
  R,
>(action: string, handler: (args: A) => Promise<R>) {
  return async (args: A): Promise<R | DegradedResponse> => {
    try {
      return await handler(args);
    } catch (error) {
      if (!isUiTreeFailure(error)) throw error;
      return degradedUiTreeResponse(
        args.platform,
        args.device_id,
        error,
        action,
      );
    }
  };
}
