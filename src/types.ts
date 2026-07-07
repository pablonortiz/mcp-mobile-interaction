export type Platform = "android" | "ios";

export interface Device {
  id: string;
  name: string;
  platform: Platform;
  status: string;
}

export interface UiElement {
  index: number;
  type: string;
  text: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  center_x: number;
  center_y: number;
  clickable: boolean;
  resource_id?: string;
  enabled?: boolean;
  focused?: boolean;
  is_overlay?: boolean;
}

export interface ScreenInfo {
  width: number;
  height: number;
  density: number;
  orientation: string;
}

export interface AppInfo {
  installed: boolean;
  version_name?: string;
  version_code?: string;
}

export interface ForegroundApp {
  package: string;
  activity?: string;
}

export type TypeTextMethod = "keyboard" | "clipboard_paste";

export interface LogOptions {
  tag?: string;
  level?: string;
  lines?: number;
}
