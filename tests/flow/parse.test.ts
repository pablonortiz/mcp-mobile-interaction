import { parseFlowYaml, normalizeSteps } from "../../src/flow/parse.js";

describe("parseFlowYaml", () => {
  it("parses a flow with the Maestro appId header", () => {
    const flow = parseFlowYaml(`
appId: in.janis.delivery.beta
---
- launchApp
- tapOn: "Delivery"
`);
    expect(flow.appId).toBe("in.janis.delivery.beta");
    expect(flow.steps).toHaveLength(2);
    expect(flow.steps[0]).toMatchObject({ kind: "launchApp", stopApp: true, clearState: false });
    expect(flow.steps[1]).toMatchObject({
      kind: "tap",
      mode: "single",
      selector: { criteria: { text_contains: "Delivery" }, index: 0 },
    });
  });

  it("parses a headerless flow", () => {
    const flow = parseFlowYaml(`- back\n- eraseText`);
    expect(flow.appId).toBeUndefined();
    expect(flow.steps.map((s) => s.kind)).toEqual(["pressKey", "eraseText"]);
  });

  it("rejects empty YAML", () => {
    expect(() => parseFlowYaml("")).toThrow(/empty/);
  });

  it("substitutes ${VAR} from invocation env over header defaults", () => {
    const flow = parseFlowYaml(
      `appId: com.app\nenv:\n  NAME: "default"\n---\n- inputText: "\${NAME}"\n`,
      { NAME: "override" },
    );
    expect(flow.steps[0]).toMatchObject({ kind: "inputText", text: "override" });
  });

  it("uses header env defaults when no invocation env", () => {
    const flow = parseFlowYaml(`appId: com.app\nenv:\n  NAME: "default"\n---\n- inputText: "\${NAME}"\n`);
    expect(flow.steps[0]).toMatchObject({ kind: "inputText", text: "default" });
  });

  it("fails listing available vars on unknown ${VAR}", () => {
    expect(() => parseFlowYaml(`- inputText: "\${MISSING}"\n`, { A: "1" })).toThrow(/MISSING.*available: A/);
  });
});

describe("normalizeSteps", () => {
  it("normalizes the full command subset", () => {
    const steps = normalizeSteps(
      [
        { launchApp: { appId: "com.app", clearState: true } },
        { tapOn: { id: "fab", optional: true } },
        { doubleTapOn: "Zoom" },
        { longPressOn: { text: "Item" } },
        { inputText: "hello" },
        "eraseText",
        { assertVisible: { text: "Done", timeout: 5000 } },
        { assertNotVisible: "Spinner" },
        { extendedWaitUntil: { visible: "Ready", timeout: 3000 } },
        { scrollUntilVisible: { element: { id: "row_9" }, direction: "DOWN" } },
        { swipe: { direction: "LEFT" } },
        "back",
        { pressKey: "Volume up" },
        "waitForAnimationToEnd",
        { stopApp: "com.app" },
        { clearState: { appId: "com.app" } },
        { openLink: "https://example.com" },
        { runFlow: { when: { visible: "Popup" }, commands: [{ tapOn: "OK" }] } },
        { repeat: { times: 3, commands: [{ tapOn: { id: "plus" } }] } },
      ],
      "steps",
    );

    expect(steps).toHaveLength(19);
    expect(steps[0]).toMatchObject({ kind: "launchApp", appId: "com.app", clearState: true });
    expect(steps[1]).toMatchObject({ kind: "tap", optional: true });
    expect(steps[2]).toMatchObject({ kind: "tap", mode: "double" });
    expect(steps[3]).toMatchObject({ kind: "tap", mode: "long" });
    expect(steps[6]).toMatchObject({ kind: "assertVisible", timeoutMs: 5000 });
    expect(steps[9]).toMatchObject({ kind: "scrollUntilVisible", direction: "down" });
    expect(steps[12]).toMatchObject({ kind: "pressKey", key: "volume_up" });
    expect(steps[17]).toMatchObject({
      kind: "group",
      when: { visible: { criteria: { text_contains: "Popup" }, index: 0 } },
    });
    expect(steps[18]).toMatchObject({ kind: "repeat", times: 3 });
  });

  it("rejects unknown commands with the step path", () => {
    expect(() => normalizeSteps([{ tapOnPoint: {} }], "steps")).toThrow(/steps\[0\].*unknown command "tapOnPoint"/);
  });

  it("rejects steps with multiple command keys", () => {
    expect(() => normalizeSteps([{ tapOn: "a", back: null }], "steps")).toThrow(/exactly one command/);
  });

  it("normalizes runFlow file: into a flowRef", () => {
    const [step] = normalizeSteps([{ runFlow: { file: "other.yaml", env: { X: "1" } } }], "steps");
    expect(step).toMatchObject({ kind: "flowRef", path: "other.yaml", env: { X: "1" } });
  });

  it("normalizes runFlow string shorthand into a flowRef", () => {
    const [step] = normalizeSteps([{ runFlow: "segments/_home.yaml" }], "steps");
    expect(step).toMatchObject({ kind: "flowRef", path: "segments/_home.yaml" });
  });

  it("rejects env on inline runFlow commands", () => {
    expect(() => normalizeSteps([{ runFlow: { env: { X: "1" }, commands: [] } }], "steps")).toThrow(
      /env is only supported with file:/,
    );
  });

  it("normalizes repeat while and hideKeyboard", () => {
    const steps = normalizeSteps(
      ["hideKeyboard", { repeat: { while: { notVisible: { id: "home" } }, times: 3, commands: ["back"] } }],
      "steps",
    );
    expect(steps[0]).toMatchObject({ kind: "hideKeyboard" });
    expect(steps[1]).toMatchObject({
      kind: "repeat",
      times: 3,
      while: { notVisible: { criteria: { resource_id: "home" }, index: 0 } },
    });
  });

  it("rejects repeat without times or while", () => {
    expect(() => normalizeSteps([{ repeat: { commands: ["back"] } }], "steps")).toThrow(/times or while/);
  });

  it("normalizes launchApp ifNotRunning", () => {
    const [step] = normalizeSteps([{ launchApp: { ifNotRunning: true } }], "steps");
    expect(step).toMatchObject({ kind: "launchApp", ifNotRunning: true, stopApp: true });
  });

  it("rejects launchApp combining ifNotRunning and clearState", () => {
    expect(() => normalizeSteps([{ launchApp: { ifNotRunning: true, clearState: true } }], "steps")).toThrow(
      /contradictory/,
    );
  });

  it("rejects JavaScript when conditions", () => {
    expect(() =>
      normalizeSteps([{ runFlow: { when: { true: "${X}" }, commands: [] } }], "steps"),
    ).toThrow(/not supported/);
  });

  it("rejects tapOn combining point and selector", () => {
    expect(() => normalizeSteps([{ tapOn: { text: "x", point: "50%,50%" } }], "steps")).toThrow(
      /cannot be combined/,
    );
  });

  it("accepts tapOn by point only", () => {
    const [step] = normalizeSteps([{ tapOn: { point: "50%,50%" } }], "steps");
    expect(step).toMatchObject({ kind: "tap", point: "50%,50%" });
  });

  it("rejects malformed points", () => {
    expect(() => normalizeSteps([{ tapOn: { point: "middle" } }], "steps")).toThrow(/expected "x,y"/);
  });

  it("rejects swipe without a valid direction", () => {
    expect(() => normalizeSteps([{ swipe: { direction: "DIAGONAL" } }], "steps")).toThrow(/UP, DOWN, LEFT or RIGHT/);
  });
});
