import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFlow } from "../../src/flow/load.js";

function makeFixtures(): string {
  const dir = mkdtempSync(join(tmpdir(), "flow-load-"));
  mkdirSync(join(dir, "segments"));
  writeFileSync(
    join(dir, "segments", "_ensure-home.yaml"),
    `- launchApp\n- repeat:\n    while:\n      notVisible:\n        id: module-pickup\n    times: 3\n    commands:\n      - back\n`,
  );
  writeFileSync(
    join(dir, "main.yaml"),
    `appId: com.app\n---\n- runFlow: segments/_ensure-home.yaml\n- tapOn:\n    text: "\${ROUTE_ID}"\n`,
  );
  return dir;
}

describe("loadFlow", () => {
  it("resolves runFlow file: relative to the referencing flow", async () => {
    const dir = makeFixtures();
    const flow = await loadFlow({ filePath: join(dir, "main.yaml"), env: { ROUTE_ID: "R-1" } });

    expect(flow.appId).toBe("com.app");
    expect(flow.steps[0]).toMatchObject({
      kind: "group",
      label: "_ensure-home",
      steps: [{ kind: "launchApp" }, { kind: "repeat", times: 3 }],
    });
    expect(flow.steps[1]).toMatchObject({
      kind: "tap",
      selector: { criteria: { text_contains: "R-1" } },
    });
  });

  it("substitutes env into nested referenced flows", async () => {
    const dir = makeFixtures();
    writeFileSync(join(dir, "segments", "_child.yaml"), `- inputText: "\${VALUE}"\n`);
    writeFileSync(
      join(dir, "outer.yaml"),
      `- runFlow:\n    file: segments/_child.yaml\n    env:\n      VALUE: "override"\n`,
    );

    const flow = await loadFlow({ filePath: join(dir, "outer.yaml"), env: { VALUE: "outer" } });
    expect(flow.steps[0]).toMatchObject({
      kind: "group",
      steps: [{ kind: "inputText", text: "override" }],
    });
  });

  it("fails on undefined ${VAR}", async () => {
    const dir = makeFixtures();
    await expect(loadFlow({ filePath: join(dir, "main.yaml") })).rejects.toThrow(/undefined variable \$\{ROUTE_ID\}/);
  });

  it("fails on circular references", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flow-load-"));
    writeFileSync(join(dir, "a.yaml"), `- runFlow: b.yaml\n`);
    writeFileSync(join(dir, "b.yaml"), `- runFlow: a.yaml\n`);
    await expect(loadFlow({ filePath: join(dir, "a.yaml") })).rejects.toThrow(/circular reference/);
  });

  it("rejects relative refs when the entry point is inline YAML", async () => {
    await expect(loadFlow({ yamlText: `- runFlow: segments/x.yaml\n` })).rejects.toThrow(/relative file references/);
  });

  it("keeps runFlow when: on file references", async () => {
    const dir = makeFixtures();
    writeFileSync(
      join(dir, "cond.yaml"),
      `- runFlow:\n    file: segments/_ensure-home.yaml\n    when:\n      visible: "Popup"\n`,
    );
    const flow = await loadFlow({ filePath: join(dir, "cond.yaml") });
    expect(flow.steps[0]).toMatchObject({
      kind: "group",
      when: { visible: { criteria: { text_contains: "Popup" } } },
    });
  });
});
