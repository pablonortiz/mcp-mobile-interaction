import { run, runBuffer, shellQuote } from "../../src/utils/exec.js";

describe("run", () => {
  it("resolves with stdout for a successful command", async () => {
    const result = await run("echo", ["hello"]);
    expect(result).toContain("hello");
  });

  it("passes arguments verbatim without local shell interpretation", async () => {
    const result = await run("echo", ["a&b", "$(uname)", "it's"]);
    expect(result).toContain("a&b $(uname) it's");
  });

  it("rejects when command fails", async () => {
    await expect(run("nonexistent_cmd_xyz_123", [])).rejects.toThrow(
      /Command failed/
    );
  });

  it("rejects when command times out", async () => {
    await expect(run("sleep", ["10"], { timeout: 100 })).rejects.toThrow();
  });

  it("pipes stdin to the process when provided", async () => {
    const result = await run("cat", [], { stdin: "piped content" });
    expect(result).toBe("piped content");
  });
});

describe("runBuffer", () => {
  it("resolves with a Buffer for a successful command", async () => {
    const result = await runBuffer("echo", ["binary"]);
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it("rejects when command fails", async () => {
    await expect(runBuffer("nonexistent_cmd_xyz_456", [])).rejects.toThrow(
      /Command failed/
    );
  });
});

describe("shellQuote", () => {
  it("wraps the value in single quotes", () => {
    expect(shellQuote("hello world")).toBe("'hello world'");
  });

  it("neutralizes shell metacharacters", () => {
    expect(shellQuote("a&b|c$(x)`y`")).toBe("'a&b|c$(x)`y`'");
  });

  it("escapes embedded single quotes", () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });
});
