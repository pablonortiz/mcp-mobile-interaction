import { jest } from "@jest/globals";
import { executeFlow } from "../../src/flow/runner.js";
import { normalizeSteps } from "../../src/flow/parse.js";
import { formatFlowReport } from "../../src/flow/report.js";
import type { FlowContext } from "../../src/flow/types.js";
import type { PlatformDriver } from "../../src/platforms/driver.js";
import type { UiElement } from "../../src/types.js";

function makeElement(overrides: Partial<UiElement> = {}): UiElement {
  return {
    index: 0,
    type: "Button",
    text: "Login",
    bounds: { x: 0, y: 100, width: 200, height: 50 },
    center_x: 100,
    center_y: 125,
    clickable: true,
    resource_id: "login_btn",
    enabled: true,
    ...overrides,
  };
}

/**
 * Driver fake: getUiTree consumes a queue of screens (last one repeats),
 * everything else records calls.
 */
function makeFakeDriver(screens: UiElement[][]) {
  const queue = [...screens];
  const driver = {
    getUiTree: jest.fn(async () => (queue.length > 1 ? queue.shift()! : queue[0] ?? [])),
    tap: jest.fn(async () => {}),
    doubleTap: jest.fn(async () => {}),
    longPress: jest.fn(async () => {}),
    swipe: jest.fn(async () => {}),
    typeText: jest.fn(async () => "keyboard" as const),
    clearTextField: jest.fn(async () => 0),
    pressKey: jest.fn(async () => {}),
    launchApp: jest.fn(async () => {}),
    killApp: jest.fn(async () => {}),
    clearAppData: jest.fn(async () => {}),
    openUrl: jest.fn(async () => {}),
    getScreenInfo: jest.fn(async () => ({ width: 1000, height: 2000, density: 2, orientation: "portrait" })),
  };
  return driver as typeof driver & PlatformDriver;
}

function makeCtx(driver: PlatformDriver, overrides: Partial<FlowContext> = {}): FlowContext {
  return {
    driver,
    platform: "android",
    deviceId: "emulator-5554",
    defaultTimeoutMs: 300,
    appId: "com.app",
    ...overrides,
  };
}

describe("executeFlow", () => {
  it("runs a happy path and reports per-step results", async () => {
    const driver = makeFakeDriver([[makeElement()]]);
    const steps = normalizeSteps(
      [{ launchApp: null }, { tapOn: "Login" }, { assertVisible: { id: "login_btn" } }],
      "steps",
    );

    const run = await executeFlow(steps, makeCtx(driver));

    expect(run.failed).toBe(false);
    expect(run.results.map((r) => r.status)).toEqual(["ok", "ok", "ok"]);
    expect(driver.killApp).toHaveBeenCalledWith("emulator-5554", "com.app");
    expect(driver.launchApp).toHaveBeenCalledWith("com.app", "emulator-5554");
    expect(driver.tap).toHaveBeenCalledWith(100, 125, "emulator-5554");
  });

  it("auto-waits until the element appears", async () => {
    const driver = makeFakeDriver([[], [], [makeElement()]]);
    const steps = normalizeSteps([{ tapOn: "Login" }], "steps");

    const run = await executeFlow(steps, makeCtx(driver, { defaultTimeoutMs: 3000 }));

    expect(run.failed).toBe(false);
    expect(driver.getUiTree.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("skips optional steps whose element never appears", async () => {
    const driver = makeFakeDriver([[]]);
    const steps = normalizeSteps(
      [{ tapOn: { text: "Permitir", optional: true } }, { inputText: "hello" }],
      "steps",
    );

    const run = await executeFlow(steps, makeCtx(driver));

    expect(run.failed).toBe(false);
    expect(run.results[0].status).toBe("skipped");
    expect(driver.typeText).toHaveBeenCalledWith("hello", "emulator-5554");
  });

  it("stops at the first failure and does not run later steps", async () => {
    const driver = makeFakeDriver([[]]);
    const steps = normalizeSteps([{ tapOn: "Missing" }, { inputText: "never" }], "steps");

    const run = await executeFlow(steps, makeCtx(driver));

    expect(run.failed).toBe(true);
    expect(run.results).toHaveLength(1);
    expect(run.results[0]).toMatchObject({ status: "failed" });
    expect(driver.typeText).not.toHaveBeenCalled();
  });

  it("skips a runFlow group when its condition is not met", async () => {
    const driver = makeFakeDriver([[]]);
    const steps = normalizeSteps(
      [{ runFlow: { when: { visible: "Popup" }, commands: [{ tapOn: "OK" }] } }],
      "steps",
    );

    const run = await executeFlow(steps, makeCtx(driver));

    expect(run.failed).toBe(false);
    expect(run.results[0]).toMatchObject({ status: "skipped", detail: "condition not met" });
    expect(driver.tap).not.toHaveBeenCalled();
  });

  it("runs a runFlow group when its condition is met", async () => {
    const popup = makeElement({ text: "Popup", resource_id: "popup", center_x: 50, center_y: 60 });
    const okButton = makeElement({ text: "OK", resource_id: "ok_btn", center_x: 10, center_y: 20 });
    const driver = makeFakeDriver([[popup, okButton]]);
    const steps = normalizeSteps(
      [{ runFlow: { when: { visible: "Popup" }, commands: [{ tapOn: "OK" }] } }],
      "steps",
    );

    const run = await executeFlow(steps, makeCtx(driver));

    expect(run.failed).toBe(false);
    expect(driver.tap).toHaveBeenCalledWith(10, 20, "emulator-5554");
  });

  it("respects platform conditions without querying the device", async () => {
    const driver = makeFakeDriver([[]]);
    const steps = normalizeSteps(
      [{ runFlow: { when: { platform: "iOS" }, commands: [{ tapOn: "OK" }] } }],
      "steps",
    );

    const run = await executeFlow(steps, makeCtx(driver));

    expect(run.results[0].status).toBe("skipped");
    expect(driver.getUiTree).not.toHaveBeenCalled();
  });

  it("waits for elements to disappear with assertNotVisible", async () => {
    const spinner = makeElement({ text: "", resource_id: "spinner" });
    const driver = makeFakeDriver([[spinner], [spinner], []]);
    const steps = normalizeSteps([{ assertNotVisible: { id: "spinner" } }], "steps");

    const run = await executeFlow(steps, makeCtx(driver, { defaultTimeoutMs: 3000 }));

    expect(run.failed).toBe(false);
  });

  it("repeats nested commands N times", async () => {
    const driver = makeFakeDriver([[makeElement({ text: "+", resource_id: "plus" })]]);
    const steps = normalizeSteps([{ repeat: { times: 3, commands: [{ tapOn: { id: "plus" } }] } }], "steps");

    const run = await executeFlow(steps, makeCtx(driver));

    expect(run.failed).toBe(false);
    expect(driver.tap).toHaveBeenCalledTimes(3);
    expect(run.results).toHaveLength(3);
  });

  it("repeat while runs until the condition flips", async () => {
    const home = makeElement({ text: "Home", resource_id: "module-pickup" });
    const driver = makeFakeDriver([[], [], [home]]);
    const steps = normalizeSteps(
      [{ repeat: { while: { notVisible: { id: "module-pickup" } }, times: 5, commands: ["back"] } }],
      "steps",
    );

    const run = await executeFlow(steps, makeCtx(driver));

    expect(run.failed).toBe(false);
    expect(driver.pressKey).toHaveBeenCalledTimes(2);
  });

  it("repeat while records a skipped entry when the condition never applies", async () => {
    const home = makeElement({ resource_id: "module-pickup" });
    const driver = makeFakeDriver([[home]]);
    const steps = normalizeSteps(
      [{ repeat: { while: { notVisible: { id: "module-pickup" } }, commands: ["back"] } }],
      "steps",
    );

    const run = await executeFlow(steps, makeCtx(driver));

    expect(run.results[0]).toMatchObject({ status: "skipped", detail: "while condition not met" });
    expect(driver.pressKey).not.toHaveBeenCalled();
  });

  it("hideKeyboard presses escape", async () => {
    const driver = makeFakeDriver([[]]);
    const steps = normalizeSteps(["hideKeyboard"], "steps");

    const run = await executeFlow(steps, makeCtx(driver));

    expect(run.failed).toBe(false);
    expect(driver.pressKey).toHaveBeenCalledWith("escape", "emulator-5554");
  });

  it("launchApp ifNotRunning skips when the app is already in foreground", async () => {
    const driver = makeFakeDriver([[]]);
    driver.getForegroundApp = jest.fn(async () => ({ package: "com.app" })) as never;
    const steps = normalizeSteps([{ launchApp: { ifNotRunning: true } }], "steps");

    const run = await executeFlow(steps, makeCtx(driver));

    expect(run.failed).toBe(false);
    expect(run.results[0].detail).toContain("launch skipped");
    expect(driver.killApp).not.toHaveBeenCalled();
    expect(driver.launchApp).not.toHaveBeenCalled();
  });

  it("launchApp ifNotRunning launches when another app is in foreground", async () => {
    const driver = makeFakeDriver([[]]);
    driver.getForegroundApp = jest.fn(async () => ({ package: "other.app" })) as never;
    const steps = normalizeSteps([{ launchApp: { ifNotRunning: true } }], "steps");

    const run = await executeFlow(steps, makeCtx(driver));

    expect(run.failed).toBe(false);
    expect(driver.launchApp).toHaveBeenCalledWith("com.app", "emulator-5554");
  });

  it("prefers clickable matches when tapping", async () => {
    const header = makeElement({ text: "DELIVERY BETA", clickable: false, center_x: 10, center_y: 20 });
    const button = makeElement({ text: ", Delivery", clickable: true, center_x: 30, center_y: 40 });
    const driver = makeFakeDriver([[header, button]]);
    const steps = normalizeSteps([{ tapOn: "delivery" }], "steps");

    const run = await executeFlow(steps, makeCtx(driver));

    expect(run.failed).toBe(false);
    expect(driver.tap).toHaveBeenCalledWith(30, 40, "emulator-5554");
    expect(run.results[0].detail).not.toContain("not clickable");
  });

  it("warns when the only match is not clickable", async () => {
    const header = makeElement({ text: "DELIVERY BETA", clickable: false, center_x: 10, center_y: 20 });
    const driver = makeFakeDriver([[header]]);
    const steps = normalizeSteps([{ tapOn: "delivery" }], "steps");

    const run = await executeFlow(steps, makeCtx(driver));

    expect(run.failed).toBe(false);
    expect(driver.tap).toHaveBeenCalledWith(10, 20, "emulator-5554");
    expect(run.results[0].detail).toContain("not clickable");
  });

  it("turns driver exceptions into failed steps", async () => {
    const driver = makeFakeDriver([[makeElement()]]);
    driver.launchApp.mockRejectedValueOnce(new Error("device offline"));
    const steps = normalizeSteps([{ launchApp: null }], "steps");

    const run = await executeFlow(steps, makeCtx(driver));

    expect(run.failed).toBe(true);
    expect(run.results[0].detail).toContain("device offline");
  });

  it("taps by percentage point using screen info", async () => {
    const driver = makeFakeDriver([[]]);
    const steps = normalizeSteps([{ tapOn: { point: "50%,25%" } }], "steps");

    const run = await executeFlow(steps, makeCtx(driver));

    expect(run.failed).toBe(false);
    expect(driver.tap).toHaveBeenCalledWith(500, 500, "emulator-5554");
  });
});

describe("formatFlowReport", () => {
  it("leads with the outcome and lists one line per step", async () => {
    const driver = makeFakeDriver([[]]);
    const steps = normalizeSteps([{ tapOn: { text: "Permitir", optional: true } }, { tapOn: "Missing" }], "steps");
    const run = await executeFlow(steps, makeCtx(driver));

    const report = formatFlowReport(run, 1234);

    expect(report).toMatch(/^Flow FAILED at step 2 \(1\.2s\)/);
    expect(report).toContain('– 1. tapOn "Permitir" — optional, not found within 300ms');
    expect(report).toContain('✗ 2. tapOn "Missing"');
  });
});
