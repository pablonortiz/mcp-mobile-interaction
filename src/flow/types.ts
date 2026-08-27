import type { MatchCriteria } from "../utils/element-matcher.js";
import type { PlatformDriver } from "../platforms/driver.js";
import type { Platform } from "../types.js";

export interface FlowSelector {
  criteria: MatchCriteria;
  index: number;
}

export interface FlowCondition {
  visible?: FlowSelector;
  notVisible?: FlowSelector;
  platform?: Platform;
}

interface StepBase {
  /** Human-readable step description used in the run report. */
  label: string;
}

export type FlowStep = StepBase &
  (
    | { kind: "launchApp"; appId?: string; clearState: boolean; stopApp: boolean; ifNotRunning: boolean }
    | {
        kind: "tap";
        mode: "single" | "double" | "long";
        selector?: FlowSelector;
        point?: string;
        optional: boolean;
        timeoutMs?: number;
      }
    | { kind: "inputText"; text: string }
    | { kind: "eraseText"; maxChars?: number }
    | { kind: "assertVisible"; selector: FlowSelector; optional: boolean; timeoutMs?: number }
    | { kind: "assertNotVisible"; selector: FlowSelector; timeoutMs?: number }
    | { kind: "waitUntil"; condition: "visible" | "notVisible"; selector: FlowSelector; timeoutMs?: number }
    | { kind: "scrollUntilVisible"; selector: FlowSelector; direction: "down" | "up"; timeoutMs?: number }
    | { kind: "swipe"; direction: "up" | "down" | "left" | "right"; durationMs?: number }
    | { kind: "pressKey"; key: string }
    | { kind: "waitForAnimationToEnd"; timeoutMs?: number }
    | { kind: "stopApp"; appId?: string }
    | { kind: "clearState"; appId?: string }
    | { kind: "openLink"; url: string }
    | { kind: "hideKeyboard" }
    | { kind: "group"; when?: FlowCondition; steps: FlowStep[] }
    | { kind: "repeat"; times?: number; while?: FlowCondition; steps: FlowStep[] }
    | { kind: "flowRef"; path: string; when?: FlowCondition; env?: Record<string, string> }
  );

export interface ParsedFlow {
  appId?: string;
  env?: Record<string, string>;
  steps: FlowStep[];
}

export interface FlowContext {
  driver: PlatformDriver;
  platform: Platform;
  deviceId: string;
  /** Auto-wait budget for element lookups (tapOn, assertVisible, ...). */
  defaultTimeoutMs: number;
  /** Default appId for launchApp/stopApp/clearState steps that omit it. */
  appId?: string;
}

export type StepStatus = "ok" | "skipped" | "failed";

export interface StepResult {
  label: string;
  status: StepStatus;
  durationMs: number;
  detail?: string;
}

export interface FlowRunResult {
  results: StepResult[];
  failed: boolean;
}
