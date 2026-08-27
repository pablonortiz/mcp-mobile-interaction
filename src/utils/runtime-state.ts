import type { UiElement } from "../types.js";

interface StateMarker {
  matches: (text: string) => boolean;
  explanation: string;
}

const MARKERS: StateMarker[] = [
  {
    matches: (text) => text.includes("runtime not ready"),
    explanation:
      "The JS runtime is not ready yet — the app is still loading its bundle. The element will likely appear; retry with a longer timeout_ms.",
  },
  {
    matches: (text) =>
      text.includes("user not logged in") || text.includes("sesión expirada"),
    explanation:
      "The app reports no logged-in user, so this screen may never render. Log in first.",
  },
  {
    matches: (text) =>
      text.includes("no internet") || text.includes("sin conexión"),
    explanation:
      "The app is showing a connectivity error — the screen is waiting on the network, not on the UI.",
  },
];

const LOADING_TYPES = ["progressbar", "swiperefresh", "shimmer"];

/**
 * Names the app-level state behind a wait that timed out. Without it, "app is
 * still booting" and "wrong screen" both surface as "element not found".
 */
export function describeRuntimeState(elements: UiElement[]): string {
  const haystack = elements
    .map((element) => element.text)
    .join(" ")
    .toLowerCase();

  const marker = MARKERS.find((candidate) => candidate.matches(haystack));
  if (marker) return ` ${marker.explanation}`;

  if (hasLoadingIndicator(elements)) {
    return " A loading indicator is on screen — the app is still fetching. Retry with a longer timeout_ms.";
  }
  if (elements.length <= 2) {
    return " The screen is almost empty, which usually means it has not rendered yet.";
  }
  return "";
}

function hasLoadingIndicator(elements: UiElement[]): boolean {
  return elements.some((element) => {
    const type = element.type.toLowerCase();
    return LOADING_TYPES.some((loading) => type.includes(loading));
  });
}
