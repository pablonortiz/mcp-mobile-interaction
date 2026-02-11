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
}

export interface ScreenInfo {
  width: number;
  height: number;
  density: number;
  orientation: string;
}
