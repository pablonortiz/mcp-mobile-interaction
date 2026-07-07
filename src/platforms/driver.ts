import * as android from "./android.js";
import * as ios from "./ios.js";
import type {
  AppInfo,
  Device,
  ForegroundApp,
  LogOptions,
  Platform,
  ScreenInfo,
  TypeTextMethod,
  UiElement,
} from "../types.js";

/**
 * Common surface both platforms implement. Platform-only operations
 * (Wi-Fi toggles, rotation, log clearing) stay on the android module and
 * are guarded at the tool level.
 */
export interface PlatformDriver {
  listDevices(): Promise<Device[]>;
  getFirstDeviceId(): Promise<string>;
  screenshot(deviceId?: string): Promise<Buffer>;
  tap(x: number, y: number, deviceId?: string): Promise<void>;
  doubleTap(x: number, y: number, deviceId?: string): Promise<void>;
  longPress(
    x: number,
    y: number,
    durationMs?: number,
    deviceId?: string,
  ): Promise<void>;
  swipe(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    durationMs?: number,
    deviceId?: string,
  ): Promise<void>;
  typeText(text: string, deviceId?: string): Promise<TypeTextMethod>;
  pressKey(
    key?: string,
    deviceId?: string,
    keycode?: number,
    repeat?: number,
  ): Promise<void>;
  getUiTree(deviceId?: string): Promise<UiElement[]>;
  getScreenInfo(deviceId?: string): Promise<ScreenInfo>;
  launchApp(pkg: string, deviceId?: string): Promise<void>;
  openUrl(url: string, deviceId?: string): Promise<void>;
  killApp(deviceId: string, pkg: string): Promise<void>;
  clearAppData(deviceId: string, pkg: string): Promise<void>;
  clearAppCache(deviceId: string, pkg: string): Promise<void>;
  setClipboard(deviceId: string, text: string): Promise<void>;
  getClipboard(deviceId: string): Promise<string>;
  getLogs(deviceId: string, options: LogOptions): Promise<string>;
  installApp(deviceId: string, path: string): Promise<string>;
  uninstallApp(deviceId: string, pkg: string): Promise<void>;
  getAppInfo(deviceId: string, pkg: string): Promise<AppInfo>;
  setLocation(
    deviceId: string,
    latitude: number,
    longitude: number,
  ): Promise<void>;
  setAppearance(deviceId: string, mode: "dark" | "light"): Promise<void>;
  getForegroundApp(deviceId: string): Promise<ForegroundApp>;
  startRecording(deviceId?: string): Promise<string>;
  stopRecording(deviceId?: string): Promise<string>;
  clearTextField(deviceId?: string, maxChars?: number): Promise<number>;
}

const drivers: Record<Platform, PlatformDriver> = { android, ios };

export function getDriver(platform: Platform): PlatformDriver {
  return drivers[platform];
}
