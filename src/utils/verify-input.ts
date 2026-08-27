import type { Platform, UiElement } from "../types.js";
import { getDriver } from "../platforms/driver.js";

const SETTLE_MS = 300;

export interface InputVerification {
  ok: boolean;
  note?: string;
}

/**
 * Confirms the text actually landed in the focused field. uiautomator reports
 * a field's hint in the same `text` attribute it uses for real content, so an
 * unchanged tree cannot tell "typed nothing" from "typed the placeholder" —
 * the caller would otherwise have no way to know the input was dropped.
 */
export async function verifyTypedText(
  platform: Platform,
  deviceId: string | undefined,
  expected: string,
): Promise<InputVerification> {
  await delay(SETTLE_MS);

  let tree: UiElement[];
  try {
    tree = await getDriver(platform).getUiTree(deviceId);
  } catch {
    return { ok: true, note: "could not verify — the UI tree was unavailable" };
  }

  const field = tree.find((element) => element.focused && isEditable(element));
  if (!field) {
    return { ok: true, note: "could not verify — no focused input field found" };
  }

  if (field.text.includes(expected)) return { ok: true };

  return {
    ok: false,
    note: `the focused field reads "${field.text}" instead. The keystrokes may have been dropped, or the field may reject this input`,
  };
}

function isEditable(element: UiElement): boolean {
  const type = element.type.toLowerCase();
  return type.includes("edittext") || type.includes("textfield");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
