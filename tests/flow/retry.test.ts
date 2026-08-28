import { jest } from "@jest/globals";
import { parseFlowYaml } from "../../src/flow/parse.js";
import { executeFlow } from "../../src/flow/runner.js";
import type { FlowContext } from "../../src/flow/types.js";
import type { UiElement } from "../../src/types.js";

function makeCtx(trees: UiElement[][]): FlowContext {
  let call = 0;
  return {
    driver: {
      getUiTree: async () => trees[Math.min(call++, trees.length - 1)],
      tap: jest.fn(),
      typeText: jest.fn(),
    } as unknown as FlowContext["driver"],
    platform: "android",
    deviceId: "emulator-5554",
    defaultTimeoutMs: 200,
  };
}

function makeElement(text: string): UiElement {
  return {
    text,
    type: "ViewGroup",
    clickable: true,
    enabled: true,
    bounds: { x: 0, y: 0, width: 100, height: 40 },
    center_x: 50,
    center_y: 20,
  } as UiElement;
}

const PRESENT = [makeElement("Confirmar")];
const ABSENT: UiElement[] = [];

describe("retry parsing", () => {
  it("accepts Maestro's shape", () => {
    const { steps } = parseFlowYaml(
      "- retry:\n    maxRetries: 3\n    commands:\n      - tapOn: OK",
    );
    expect(steps[0].kind).toBe("retry");
    expect(steps[0].label).toContain("up to 4 attempts");
  });

  it("defaults to one retry, like Maestro", () => {
    const { steps } = parseFlowYaml("- retry:\n    commands:\n      - tapOn: OK");
    expect(steps[0].label).toContain("up to 2 attempts");
  });

  it("rejects more retries than Maestro allows", () => {
    expect(() =>
      parseFlowYaml("- retry:\n    maxRetries: 9\n    commands:\n      - tapOn: OK"),
    ).toThrow(/between 0 and 3/);
  });

  it("requires commands", () => {
    expect(() => parseFlowYaml("- retry:\n    maxRetries: 2")).toThrow(/requires commands/);
  });

  it("sees steps nested inside it when validating appId", () => {
    const { steps } = parseFlowYaml("- retry:\n    commands:\n      - launchApp");
    // The block must not hide a step that cannot run.
    expect(steps[0].kind).toBe("retry");
  });
});

describe("retry execution", () => {
  it("passes through when the block succeeds first time", async () => {
    const { steps } = parseFlowYaml(
      "- retry:\n    maxRetries: 2\n    commands:\n      - assertVisible: Confirmar",
    );
    const run = await executeFlow(steps, makeCtx([PRESENT]));
    expect(run.failed).toBe(false);
    expect(run.results.filter((r) => r.status === "ok")).toHaveLength(1);
  });

  it("succeeds on a later attempt", async () => {
    const { steps } = parseFlowYaml(
      "- retry:\n    maxRetries: 2\n    commands:\n      - assertVisible: Confirmar",
    );
    const run = await executeFlow(steps, makeCtx([ABSENT, PRESENT]));
    expect(run.failed).toBe(false);
  });

  it("keeps failed attempts in the report", async () => {
    const { steps } = parseFlowYaml(
      "- retry:\n    maxRetries: 2\n    commands:\n      - assertVisible: Confirmar",
    );
    const run = await executeFlow(steps, makeCtx([ABSENT, PRESENT]));
    // A flow that only passed on the second try must not read as a clean run.
    expect(run.results.some((r) => r.status === "failed")).toBe(true);
    expect(run.results.some((r) => r.detail?.includes("retrying"))).toBe(true);
  });

  it("gives up after exhausting the attempts", async () => {
    const { steps } = parseFlowYaml(
      "- retry:\n    maxRetries: 1\n    commands:\n      - assertVisible: Confirmar",
    );
    const run = await executeFlow(steps, makeCtx([ABSENT]));
    expect(run.failed).toBe(true);
  });

  it("runs the block once when maxRetries is 0", async () => {
    const { steps } = parseFlowYaml(
      "- retry:\n    maxRetries: 0\n    commands:\n      - assertVisible: Confirmar",
    );
    const run = await executeFlow(steps, makeCtx([ABSENT]));
    expect(run.failed).toBe(true);
    expect(run.results.filter((r) => r.status === "failed")).toHaveLength(1);
  });
});
