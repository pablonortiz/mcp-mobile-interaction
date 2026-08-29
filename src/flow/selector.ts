import type { MatchCriteria } from "../utils/element-matcher.js";
import type { FlowSelector } from "./types.js";

/**
 * Normalizes a Maestro-style selector (shorthand string, or map with
 * text/id/index) into the MatchCriteria the rest of the MCP uses.
 *
 * Divergence from Maestro (by design): text/id match as case-insensitive
 * substrings instead of exact regex — consistent with tap_element and more
 * tolerant to remote i18n copies.
 */
export function parseSelector(raw: unknown, where: string): FlowSelector {
  if (typeof raw === "string") {
    return { criteria: { text_contains: raw }, index: 0 };
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${where}: selector must be a string or a map with text/id`);
  }

  const sel = raw as Record<string, unknown>;
  const criteria: MatchCriteria = {};
  if (sel.text !== undefined) criteria.text_contains = String(sel.text);
  if (sel.id !== undefined) criteria.resource_id = String(sel.id);
  if (sel.type !== undefined) criteria.type_contains = String(sel.type);
  if (sel.clickable !== undefined) criteria.clickable = Boolean(sel.clickable);

  if (Object.keys(criteria).length === 0) {
    throw new Error(`${where}: selector needs at least one of text, id, type, clickable`);
  }

  const index = sel.index !== undefined ? Number(sel.index) : 0;
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`${where}: index must be a non-negative integer`);
  }

  return { criteria, index };
}

export function describeSelector(selector: FlowSelector): string {
  const parts: string[] = [];
  const c = selector.criteria;
  if (c.text_contains !== undefined) parts.push(`"${c.text_contains}"`);
  if (c.resource_id !== undefined) parts.push(`id:${c.resource_id}`);
  if (c.type_contains !== undefined) parts.push(`type:${c.type_contains}`);
  if (c.clickable !== undefined) parts.push(`clickable:${c.clickable}`);
  if (selector.index > 0) parts.push(`index:${selector.index}`);
  return parts.join(" ");
}
