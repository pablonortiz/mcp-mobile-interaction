import type { UiElement } from "../types.js";
import type { MatchCriteria } from "./element-matcher.js";

const MAX_SUGGESTIONS = 3;
const MIN_SIMILARITY = 0.4;

interface Candidate {
  label: string;
  similarity: number;
  element: UiElement;
}

/**
 * Turns "element not found" into something actionable by naming what was on
 * screen and looked close. Reporting only the element count left the agent one
 * extra round-trip away from understanding the failure — or tapping a
 * coordinate it read off a screenshot instead.
 */
export function describeNearMisses(
  elements: UiElement[],
  criteria: MatchCriteria,
): string {
  const wanted = wantedText(criteria);
  if (!wanted) return "";

  const candidates = rankCandidates(elements, wanted, criteria);
  if (candidates.length === 0) return "";

  const listed = candidates
    .map(
      (candidate) =>
        `"${candidate.label}"${describeObstacle(candidate.element)} (${Math.round(candidate.similarity * 100)}%)`,
    )
    .join(", ");

  return ` Closest on screen: ${listed}.`;
}

/** The criterion the near-miss search runs against — id first, it is stricter. */
function wantedText(criteria: MatchCriteria): string | undefined {
  return (
    criteria.resource_id ?? criteria.text_exact ?? criteria.text_contains
  );
}

function rankCandidates(
  elements: UiElement[],
  wanted: string,
  criteria: MatchCriteria,
): Candidate[] {
  const useResourceId = criteria.resource_id !== undefined;

  return elements
    .map((element) => {
      const label = useResourceId
        ? (element.resource_id ?? "")
        : element.text || element.resource_id || "";
      return { label, similarity: similarity(wanted, label), element };
    })
    .filter((candidate) => candidate.label && candidate.similarity >= MIN_SIMILARITY)
    .sort((first, second) => second.similarity - first.similarity)
    .slice(0, MAX_SUGGESTIONS);
}

/** Why a near-miss would not have worked even if the selector had matched. */
function describeObstacle(element: UiElement): string {
  if (element.enabled === false) return " [disabled]";
  if (!element.clickable) return " [not clickable]";
  if (element.is_overlay) return " [under an overlay]";
  return "";
}

/**
 * Dice coefficient over character bigrams: cheap, order-tolerant, and good at
 * the failure this targets — a label that changed slightly ("Ingreso manual"
 * vs "Ingresar manual").
 */
export function similarity(left: string, right: string): number {
  const first = left.toLowerCase().trim();
  const second = right.toLowerCase().trim();
  if (!first || !second) return 0;
  if (first === second) return 1;
  if (second.includes(first) || first.includes(second)) return 0.9;

  const firstPairs = bigrams(first);
  const secondPairs = bigrams(second);
  if (firstPairs.size === 0 || secondPairs.size === 0) return 0;

  let shared = 0;
  for (const pair of firstPairs) {
    if (secondPairs.has(pair)) shared++;
  }
  return (2 * shared) / (firstPairs.size + secondPairs.size);
}

function bigrams(value: string): Set<string> {
  const pairs = new Set<string>();
  for (let i = 0; i < value.length - 1; i++) {
    pairs.add(value.slice(i, i + 2));
  }
  return pairs;
}
