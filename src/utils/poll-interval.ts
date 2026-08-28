import { isDaemonEnabled } from "../platforms/ui-daemon.js";

const SLOW_POLL_MS = 500;
const FAST_POLL_MS = 100;

/**
 * How long to wait between screen checks.
 *
 * With `uiautomator dump` each check costs ~2s, so the interval barely matters
 * and a short one only burns dumps. With the daemon a check costs ~4ms, and the
 * interval becomes the entire delay: measured on a screen transition, 500ms
 * detects the change at 4787ms while 100ms detects it at 3109ms.
 */
export function pollIntervalMs(): number {
  return isDaemonEnabled() ? FAST_POLL_MS : SLOW_POLL_MS;
}

/**
 * How far to scroll looking for an element. Each attempt costs a screen read,
 * which is why the ceiling was low; when reads are nearly free it can look
 * much further before giving up.
 */
export function defaultScrollLimit(): number {
  return isDaemonEnabled() ? 15 : 5;
}
