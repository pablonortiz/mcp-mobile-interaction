import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

/** Hosts can auto-approve read-only tools — fewer permission prompts. */
export const READ_ONLY: ToolAnnotations = { readOnlyHint: true };

export const ACTION: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
};

export const DESTRUCTIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
};
