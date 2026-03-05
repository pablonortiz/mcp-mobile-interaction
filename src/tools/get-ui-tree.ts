import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as android from "../platforms/android.js";
import * as ios from "../platforms/ios.js";

export function registerGetUiTreeTool(server: McpServer) {
  server.tool(
    "get_ui_tree",
    "Get a simplified flat list of UI elements on the current screen. Each element includes type, text, bounds, center coordinates (for tapping), and whether it is clickable. Supports optional filters to reduce noise.",
    {
      platform: z.enum(["android", "ios"]).describe("Target platform"),
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
    },
    async ({ platform, device_id, only_clickable, only_with_text, type_filter, resource_id_contains }) => {
      let elements =
        platform === "android"
          ? await android.getUiTree(device_id)
          : await ios.getUiTree(device_id);

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
      const header = hasFilters
        ? `${elements.length} elements (filtered from ${totalCount} total):`
        : `${elements.length} elements:`;

      return {
        content: [
          {
            type: "text" as const,
            text: `${header}\n${JSON.stringify(elements, null, 2)}`,
          },
        ],
      };
    },
  );
}
