import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { dedupeResponse, pickAnchors } from "../utils/response-cache.js";
import {
  resolvePlatform,
  PLATFORM_DESCRIPTION,
} from "../utils/resolve-platform.js";
import { getDriver } from "../platforms/driver.js";
import { uiTreeSafe } from "../utils/ui-tree-fallback.js";
import { formatUiTree } from "../utils/format-ui.js";
import { READ_ONLY } from "../utils/annotations.js";

export function registerGetUiTreeTool(server: McpServer) {
  server.tool(
    "get_ui_tree",
    "Get a simplified flat list of UI elements on the current screen. Each element includes type, text, center coordinates (for tapping), size and state flags. Supports optional filters to reduce noise.",
    {
      platform: z.enum(["android", "ios"]).optional().describe(PLATFORM_DESCRIPTION),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit to use the first connected device."),
      only_clickable: z
        .boolean()
        .optional()
        .describe("If true, only return clickable elements. Default: false"),
      only_with_text: z
        .boolean()
        .optional()
        .describe("If true, only return elements with non-empty text. Default: false"),
      type_filter: z
        .array(z.string())
        .optional()
        .describe('Only return elements whose type contains one of these strings (case-insensitive). E.g. ["Button", "EditText", "TextView"]'),
      resource_id_contains: z
        .string()
        .optional()
        .describe("Only return elements whose resource_id contains this substring (case-insensitive)"),
      force_full: z
        .boolean()
        .optional()
        .describe("Return the tree even when it is identical to the last read. Default: false"),
      dump_timeout_ms: z
        .number()
        .int()
        .min(1000)
        .max(60000)
        .optional()
        .describe("How long to keep retrying the UI dump on an animating screen. Default: ~5s of progressive backoff"),
      max_elements: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe("Maximum elements to return; the rest is summarized. Default: 120"),
    },
    READ_ONLY,
    uiTreeSafe("read the UI tree", async ({ platform: platformArg, device_id, only_clickable, only_with_text, type_filter, resource_id_contains, max_elements, dump_timeout_ms, force_full }) => {
      const platform = await resolvePlatform(platformArg);
      let elements = await getDriver(platform).getUiTree(device_id, {
        timeoutMs: dump_timeout_ms,
      });

      const totalCount = elements.length;

      if (only_clickable) {
        elements = elements.filter((el) => el.clickable);
      }
      if (only_with_text) {
        elements = elements.filter((el) => el.text.trim() !== "");
      }
      if (type_filter && type_filter.length > 0) {
        const lowerFilters = type_filter.map((t) => t.toLowerCase());
        elements = elements.filter((el) =>
          lowerFilters.some((f) => el.type.toLowerCase().includes(f)),
        );
      }
      if (resource_id_contains) {
        const lower = resource_id_contains.toLowerCase();
        elements = elements.filter((el) =>
          (el.resource_id ?? "").toLowerCase().includes(lower),
        );
      }

      const hasFilters = only_clickable || only_with_text || type_filter || resource_id_contains;
      const label = hasFilters
        ? `UI elements (filtered from ${totalCount} total)`
        : "UI elements";

      const { text } = dedupeResponse(
        `ui_tree:${platform}:${device_id ?? "default"}:${label}:${max_elements ?? "all"}`,
        formatUiTree(elements, label, max_elements),
        {
          force: force_full,
          summary: `The UI tree (${elements.length} elements)`,
          anchors: pickAnchors(elements),
        },
      );

      return { content: [{ type: "text" as const, text }] };
    }),
  );
}
