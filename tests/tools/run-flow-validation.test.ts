import { parseFlowYaml, stepsMissingAppId } from "../../src/flow/parse.js";

describe("stepsMissingAppId", () => {
  it("reports steps that need an appId and carry none", () => {
    const { steps } = parseFlowYaml("- launchApp\n- tapOn: OK\n- stopApp");
    expect(stepsMissingAppId(steps)).toHaveLength(2);
  });

  it("accepts steps that bring their own appId", () => {
    const { steps } = parseFlowYaml("- launchApp:\n    appId: com.example\n- tapOn: OK");
    expect(stepsMissingAppId(steps)).toHaveLength(0);
  });

  it("looks inside groups and repeats", () => {
    const { steps } = parseFlowYaml(
      "- repeat:\n    times: 2\n    commands:\n      - launchApp",
    );
    expect(stepsMissingAppId(steps)).toHaveLength(1);
  });

  it("ignores steps that never need an appId", () => {
    const { steps } = parseFlowYaml("- tapOn: OK\n- back\n- hideKeyboard");
    expect(stepsMissingAppId(steps)).toHaveLength(0);
  });
});
