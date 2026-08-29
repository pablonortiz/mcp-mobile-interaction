// The cache only exists on the `uiautomator dump` path — under the daemon a
// read costs ~4ms and the cache turns itself off.
process.env.MCP_MOBILE_FAST_TREE = "0";


import { jest } from "@jest/globals";
import { readTree, invalidateTree } from "../../src/flow/tree-cache.js";
import type { FlowContext } from "../../src/flow/types.js";
import type { UiElement } from "../../src/types.js";

const SCREEN = [{ text: "Iniciar Control" }] as UiElement[];

function makeCtx(getUiTree: () => Promise<UiElement[]>): FlowContext {
  return {
    driver: { getUiTree } as unknown as FlowContext["driver"],
    platform: "android",
    deviceId: "emulator-5554",
    defaultTimeoutMs: 10_000,
  };
}

describe("flow tree cache", () => {
  it("reads from the device the first time", async () => {
    const getUiTree = jest.fn<() => Promise<UiElement[]>>().mockResolvedValue(SCREEN);
    const ctx = makeCtx(getUiTree);
    expect(await readTree(ctx)).toBe(SCREEN);
    expect(getUiTree).toHaveBeenCalledTimes(1);
  });

  it("reuses the tree while nothing has acted on the device", async () => {
    const getUiTree = jest.fn<() => Promise<UiElement[]>>().mockResolvedValue(SCREEN);
    const ctx = makeCtx(getUiTree);
    await readTree(ctx);
    await readTree(ctx);
    // The assertVisible → tapOn pair now costs one dump instead of two.
    expect(getUiTree).toHaveBeenCalledTimes(1);
  });

  it("reads again once something touched the device", async () => {
    const getUiTree = jest.fn<() => Promise<UiElement[]>>().mockResolvedValue(SCREEN);
    const ctx = makeCtx(getUiTree);
    await readTree(ctx);
    invalidateTree(ctx);
    await readTree(ctx);
    expect(getUiTree).toHaveBeenCalledTimes(2);
  });

  it("keeps separate flows independent", async () => {
    const first = jest.fn<() => Promise<UiElement[]>>().mockResolvedValue(SCREEN);
    const second = jest.fn<() => Promise<UiElement[]>>().mockResolvedValue(SCREEN);
    await readTree(makeCtx(first));
    await readTree(makeCtx(second));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
