import type { UiElement } from "../types.js";

/** Package prefixes that mean the app under test is no longer on screen. */
const SYSTEM_UI_PACKAGES = [
  "com.google.android.apps.nexuslauncher",
  "com.android.launcher",
  "com.android.systemui",
  "com.android.settings",
  "com.android.permissioncontroller",
  "com.google.android.permissioncontroller",
];

const LAUNCHER_MARKERS = ["Play Store", "Phone", "Messages", "Chrome"];

export interface ForegroundNote {
  offApp: boolean;
  note: string;
}

/**
 * Explains a lookup that found nothing when the reason is that the screen no
 * longer belongs to the app. "No elements found" reads as a selector problem,
 * and the wrong diagnosis costs far more than the missing element.
 */
export function describeForegroundContext(
  foregroundPackage: string | undefined,
  expectedPackage: string | undefined,
  tree: UiElement[],
): ForegroundNote {
  if (foregroundPackage && expectedPackage) {
    if (foregroundPackage === expectedPackage) return { offApp: false, note: "" };
    return {
      offApp: true,
      note: ` The screen belongs to ${foregroundPackage}, not ${expectedPackage} — the app is not in the foreground.`,
    };
  }

  if (foregroundPackage && isSystemUi(foregroundPackage)) {
    return {
      offApp: true,
      note: ` The foreground app is ${foregroundPackage} (${describeSystemUi(foregroundPackage)}), not the app under test.`,
    };
  }

  if (!foregroundPackage && looksLikeLauncher(tree)) {
    return {
      offApp: true,
      note: " This looks like the device home screen, not an app.",
    };
  }

  return { offApp: false, note: "" };
}

function isSystemUi(packageName: string): boolean {
  return SYSTEM_UI_PACKAGES.some((known) => packageName.startsWith(known));
}

function describeSystemUi(packageName: string): string {
  if (packageName.includes("launcher") || packageName.includes("nexuslauncher")) {
    return "the device home screen";
  }
  if (packageName.includes("permissioncontroller")) {
    return "a system permission dialog";
  }
  return "system UI";
}

/** Home-screen shortcuts are a reliable tell when no package name is available. */
function looksLikeLauncher(tree: UiElement[]): boolean {
  const labels = new Set(tree.map((element) => element.text));
  const hits = LAUNCHER_MARKERS.filter((marker) => labels.has(marker));
  return hits.length >= 3;
}
