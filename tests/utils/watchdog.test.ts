import { jest } from "@jest/globals";
import { startParentWatchdog } from "../../src/utils/watchdog.js";

describe("startParentWatchdog", () => {
  const realPpid = process.ppid;
  let exitSpy: jest.SpiedFunction<typeof process.exit>;

  beforeEach(() => {
    jest.useFakeTimers();
    exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    jest.useRealTimers();
    exitSpy.mockRestore();
    Object.defineProperty(process, "ppid", { value: realPpid, configurable: true });
  });

  it("stays alive while the client process is there", () => {
    const onExit = jest.fn();
    startParentWatchdog(onExit, 10);
    jest.advanceTimersByTime(100);
    expect(onExit).not.toHaveBeenCalled();
  });

  it("cleans up and exits once the process is reparented", async () => {
    const onExit = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    startParentWatchdog(onExit, 10);
    Object.defineProperty(process, "ppid", { value: 1, configurable: true });
    jest.advanceTimersByTime(20);
    await Promise.resolve();
    expect(onExit).toHaveBeenCalled();
  });
});
