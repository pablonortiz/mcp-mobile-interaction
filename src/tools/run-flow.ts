import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  resolvePlatform,
  PLATFORM_DESCRIPTION,
} from "../utils/resolve-platform.js";
import { getDriver } from "../platforms/driver.js";
import { performObservation } from "../utils/observe.js";
import { buildResponseContent } from "../utils/format-response.js";
import { filterUiElements } from "../utils/ui-filter.js";
import { formatUiTree } from "../utils/format-ui.js";
import { loadFlow } from "../flow/load.js";
import { executeFlow } from "../flow/runner.js";
import { formatFlowReport, formatFlowPlan } from "../flow/report.js";
import { stepsMissingAppId } from "../flow/parse.js";
import { ACTION } from "../utils/annotations.js";
import type { FlowContext, ParsedFlow } from "../flow/types.js";

export function registerRunFlowTool(server: McpServer) {
  server.tool(
    "run_flow",
    "Run a declarative flow of UI steps server-side in a single call, using a subset of Maestro's YAML syntax. " +
      "Steps auto-wait for their elements (no manual sleeps); execution stops at the first failure and returns the failing step plus the current UI tree so the caller can take over from there. " +
      "Commands: launchApp, tapOn, doubleTapOn, longPressOn, inputText, eraseText, assertVisible, assertNotVisible, extendedWaitUntil, scrollUntilVisible, swipe, back, pressKey, hideKeyboard, waitForAnimationToEnd, stopApp, clearState, openLink, runFlow (inline commands or file: for composing flow files, with when: visible/notVisible/platform — use it to handle known popups), repeat (times and/or while: visible/notVisible). " +
      "Selectors: text/id/type match as case-insensitive substrings, index picks the Nth match (0-based), optional: true skips instead of failing. " +
      "Flows support ${VAR} placeholders resolved from the env parameter (or header env defaults). " +
      "A Maestro-style header (appId: ... env: ... --- ...) is supported in YAML flows; runFlow file: paths resolve relative to the referencing flow file.",
    {
      platform: z.enum(["android", "ios"]).optional().describe(PLATFORM_DESCRIPTION),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit to use the first connected device."),
      flow_yaml: z
        .string()
        .optional()
        .describe("Flow in Maestro-subset YAML (steps list, optional appId header)"),
      flow_file: z
        .string()
        .optional()
        .describe("Absolute path to a .yaml flow file (same syntax as flow_yaml)"),
      steps: z
        .array(z.unknown())
        .optional()
        .describe('Flow as a JSON array of step objects, e.g. [{"tapOn": {"id": "fab"}}, {"assertVisible": "Done"}]'),
      app_id: z
        .string()
        .optional()
        .describe("Default appId for launchApp/stopApp/clearState steps (overrides the YAML header)"),
      env: z
        .record(z.string())
        .optional()
        .describe('Variables for ${VAR} placeholders in the flow, e.g. {"ROUTE_ID": "123"}. Overrides header env defaults.'),
      default_timeout_ms: z
        .number()
        .int()
        .optional()
        .describe("Auto-wait budget per element lookup. Default: 10000"),
      dry_run: z
        .boolean()
        .optional()
        .describe("If true, only parse and list the steps — no device needed"),
      observe: z
        .enum(["none", "ui_tree", "screenshot", "both"])
        .optional()
        .describe("Capture screen state after a successful run. Default: none"),
    },
    ACTION,
    async ({
      platform: platformArg,
      device_id,
      flow_yaml,
      flow_file,
      steps,
      app_id,
      env,
      default_timeout_ms,
      dry_run,
      observe,
    }) => {
      const platform = await resolvePlatform(platformArg);
      const sources = [flow_yaml, flow_file, steps].filter((s) => s !== undefined);
      if (sources.length !== 1) {
        return errorResult("Provide exactly one of flow_yaml, flow_file, or steps.");
      }

      let parsed: ParsedFlow;
      try {
        parsed = await loadFlow({ yamlText: flow_yaml, filePath: flow_file, steps, env });
      } catch (error) {
        return errorResult(`Flow parse error: ${error instanceof Error ? error.message : String(error)}`);
      }

      if (parsed.steps.length === 0) return errorResult("Flow has no steps.");

      // Fail before touching the device: an unresolvable appId used to surface
      // mid-run, after earlier steps had already changed the app state.
      const effectiveAppId = app_id ?? parsed.appId;
      if (!effectiveAppId) {
        const missing = stepsMissingAppId(parsed.steps);
        if (missing.length > 0) {
          return errorResult(
            `Flow needs an appId for ${missing.length} step(s) (${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ", …" : ""}) and none was given. Set it in the flow header (\`appId: com.example\`), on the step, or via the app_id parameter.`,
          );
        }
      }

      if (dry_run) {
        const plan = formatFlowPlan(parsed.steps).join("\n");
        return {
          content: [
            {
              type: "text" as const,
              text: `Flow is valid (${parsed.steps.length} top-level step(s)${parsed.appId ? `, appId: ${parsed.appId}` : ""}):\n${plan}`,
            },
          ],
        };
      }

      const driver = getDriver(platform);
      const ctx: FlowContext = {
        driver,
        platform,
        deviceId: device_id ?? (await driver.getFirstDeviceId()),
        defaultTimeoutMs: default_timeout_ms ?? 10_000,
        appId: effectiveAppId,
      };

      const started = Date.now();
      const run = await executeFlow(parsed.steps, ctx);
      const report = formatFlowReport(run, Date.now() - started);

      if (run.failed) {
        const context = await captureFailureContext(ctx);
        return {
          content: [{ type: "text" as const, text: `${report}\n\n${context}` }],
          isError: true,
        };
      }

      const observation = await performObservation({
        mode: observe ?? "none",
        platform,
        deviceId: ctx.deviceId,
        delayMs: 0,
        stabilize: false,
      });
      return { content: buildResponseContent(report, observation) };
    },
  );
}

/** On failure, capture where the device actually is so the caller can recover. */
async function captureFailureContext(ctx: FlowContext): Promise<string> {
  try {
    const [foreground, tree] = await Promise.all([
      ctx.driver.getForegroundApp(ctx.deviceId).catch(() => undefined),
      ctx.driver.getUiTree(ctx.deviceId),
    ]);
    const app = foreground ? `Foreground app: ${foreground.package}\n` : "";
    return `${app}${formatUiTree(filterUiElements(tree), "Current UI tree")}`;
  } catch (error) {
    return `Could not capture failure context: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true as const };
}
