import { z } from "zod";

export interface CapturedTool {
  name: string;
  description: string;
  schema: Record<string, z.ZodTypeAny>;
  handler: (args: unknown, extra: unknown) => Promise<ToolResponse>;
}

export interface ToolResponse {
  content: Array<{ type: string; text?: string; data?: string }>;
  isError?: boolean;
}

/**
 * Captures what a `register*Tool(server)` function registers, so tool handlers
 * — otherwise anonymous closures inside `server.tool(...)` — become testable.
 */
export function captureTool(
  register: (server: never) => void,
): CapturedTool {
  const captured: CapturedTool[] = [];
  const fakeServer = {
    tool(...args: unknown[]) {
      const [name, description, schema] = args as [
        string,
        string,
        Record<string, z.ZodTypeAny>,
      ];
      // Tools may pass annotations between the schema and the handler.
      const handler = args
        .slice(3)
        .find((arg) => typeof arg === "function") as CapturedTool["handler"];
      captured.push({ name, description, schema, handler });
    },
  };

  register(fakeServer as never);
  if (captured.length !== 1) {
    throw new Error(`Expected exactly one tool, got ${captured.length}`);
  }
  return captured[0];
}

/** Runs a tool the way the MCP server would: Zod-parsed args, then the handler. */
export async function callTool(
  tool: CapturedTool,
  args: Record<string, unknown> = {},
): Promise<ToolResponse> {
  const parsed = z.object(tool.schema).parse(args);
  return tool.handler(parsed, {});
}

/** Zod rejection message for args the schema refuses, or null when it accepts them. */
export function schemaError(
  tool: CapturedTool,
  args: Record<string, unknown>,
): string | null {
  const result = z.object(tool.schema).safeParse(args);
  return result.success ? null : result.error.issues[0].message;
}

/** Concatenated text of a tool response — what the agent actually reads. */
export function textOf(response: ToolResponse): string {
  return response.content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");
}
