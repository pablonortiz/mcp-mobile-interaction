import type { UiElement } from "../types.js";

export interface MatchCriteria {
  text_exact?: string;
  text_contains?: string;
  resource_id?: string;
  type_contains?: string;
  clickable?: boolean;
}

/**
 * Returns true if the element matches all provided criteria.
 * Undefined criteria are ignored (match all).
 */
export function matchElement(el: UiElement, criteria: MatchCriteria): boolean {
  if (criteria.text_exact !== undefined && el.text !== criteria.text_exact)
    return false;
  if (
    criteria.text_contains !== undefined &&
    !el.text.toLowerCase().includes(criteria.text_contains.toLowerCase())
  )
    return false;
  if (
    criteria.resource_id !== undefined &&
    !(el.resource_id ?? "")
      .toLowerCase()
      .includes(criteria.resource_id.toLowerCase())
  )
    return false;
  if (
    criteria.type_contains !== undefined &&
    !el.type.toLowerCase().includes(criteria.type_contains.toLowerCase())
  )
    return false;
  if (criteria.clickable !== undefined && el.clickable !== criteria.clickable)
    return false;
  return true;
}

/**
 * Returns true if at least one criterion was provided.
 */
export function hasCriteria(criteria: MatchCriteria): boolean {
  return (
    criteria.text_exact !== undefined ||
    criteria.text_contains !== undefined ||
    criteria.resource_id !== undefined ||
    criteria.type_contains !== undefined ||
    criteria.clickable !== undefined
  );
}

export function describeCriteria(criteria: MatchCriteria): string {
  const parts: string[] = [];
  if (criteria.text_exact !== undefined)
    parts.push(`text_exact: "${criteria.text_exact}"`);
  if (criteria.text_contains !== undefined)
    parts.push(`text_contains: "${criteria.text_contains}"`);
  if (criteria.resource_id !== undefined)
    parts.push(`resource_id: "${criteria.resource_id}"`);
  if (criteria.type_contains !== undefined)
    parts.push(`type_contains: "${criteria.type_contains}"`);
  if (criteria.clickable !== undefined)
    parts.push(`clickable: ${criteria.clickable}`);
  return parts.join(", ");
}
