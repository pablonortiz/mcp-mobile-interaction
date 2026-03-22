# mcp-mobile-interaction

[![CI](https://img.shields.io/github/actions/workflow/status/pablonortiz/mcp-mobile-interaction/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/pablonortiz/mcp-mobile-interaction/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/mcp-mobile-interaction?style=flat-square&color=CB3837)](https://www.npmjs.com/package/mcp-mobile-interaction)
[![npm downloads](https://img.shields.io/npm/dm/mcp-mobile-interaction?style=flat-square&color=CB3837)](https://www.npmjs.com/package/mcp-mobile-interaction)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

An MCP (Model Context Protocol) server that lets Claude interact with Android and iOS devices/emulators. Take screenshots, tap, swipe, type, inspect UI elements, and more — no Appium required.

## Prerequisites

### Android
- [Android SDK](https://developer.android.com/studio) with `adb` in your PATH
- An Android emulator running or a physical device connected via USB with ADB debugging enabled

### iOS
- macOS with [Xcode](https://developer.apple.com/xcode/) installed (provides `xcrun simctl`)
- For physical devices: [idb](https://fbidb.io/) (`brew install idb-companion && pip install fb-idb`)
- A booted iOS simulator or connected physical device

## Installation

### With Claude Code

```bash
claude mcp add mobile -- npx -y mcp-mobile-interaction
```

Or add `.mcp.json` to your project root (shared with your team):

```json
{
  "mcpServers": {
    "mobile": {
      "command": "npx",
      "args": ["-y", "mcp-mobile-interaction"]
    }
  }
}
```

### With Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mobile": {
      "command": "npx",
      "args": ["-y", "mcp-mobile-interaction"]
    }
  }
}
```

### Manual

```bash
npm install -g mcp-mobile-interaction
```

## Tools

All tools accept a `platform` parameter (`"android"` or `"ios"`) and an optional `device_id` (defaults to the first connected device).

### Core Tools

| Tool | Description |
|------|-------------|
| `list_devices` | List connected devices and emulators/simulators |
| `screenshot` | Capture a screenshot (returns base64 JPEG) |
| `get_ui_tree` | Get a flat list of UI elements with optional filters (`only_clickable`, `only_with_text`, `type_filter`, `resource_id_contains`) |
| `get_screen_info` | Get screen dimensions, density, and orientation |
| `get_screen_state` | Get UI tree + screenshot in a single call (saves a round-trip) |

### Action Tools

| Tool | Description |
|------|-------------|
| `tap` | Tap at (x, y) coordinates (native resolution) |
| `double_tap` | Double-tap at (x, y) coordinates (native resolution) |
| `long_press` | Long-press at (x, y) with configurable duration |
| `swipe` | Swipe between coordinates or by direction (up/down/left/right) |
| `type_text` | Type text into the focused input field |
| `press_key` | Press a key (home, back, enter, delete, volume_up, volume_down, power, tab, recent_apps, menu, escape, search, camera, media_play_pause) or send a raw Android keycode |
| `launch_app` | Launch an app by package name / bundle ID |
| `open_url` | Open a URL or deep link |
| `tap_element` | Find element by text, resource_id, or type and tap it. Supports `scroll_to_find` and `wait_for` |

### Waiting Tools

| Tool | Description |
|------|-------------|
| `wait_for_element` | Poll until an element matching text/type/resource_id criteria appears on screen |
| `wait_for_element_gone` | Poll until a matching element disappears (loading spinners, skeletons, dialogs) |
| `wait_for_stable` | Poll until the screen stops changing (two consecutive UI snapshots match) |

## Coordinate System

Screenshots are scaled down by default (`scale=0.5`) to save bandwidth, while `get_ui_tree` and all coordinate-based tools (`tap`, `double_tap`, `long_press`, `swipe`) work in **native device resolution**.

Every screenshot response includes the native dimensions and scale factor to make this explicit:

```
Screenshot captured (540x1140, scale=0.5 of native 1080x2280).
Coordinate tools expect native resolution — multiply screenshot pixel
positions by 2 to convert, or pass screenshot_scale=0.5.
```

**Two ways to handle this:**

1. **Manual conversion** — multiply the position you see in the screenshot by `1/scale` (e.g. `×2` for `scale=0.5`)
2. **Automatic conversion** — pass `screenshot_scale` to coordinate tools and they convert for you:

```
tap(x=270, y=570, screenshot_scale=0.5)
→ taps at native (540, 1140)
```

The `screenshot_scale` parameter is available on `tap`, `double_tap`, `long_press`, and `swipe`.

## Observe Mode

All 8 action tools (`tap`, `double_tap`, `long_press`, `swipe`, `type_text`, `press_key`, `launch_app`, `open_url`) support optional **observe** parameters that capture the screen state after the action completes — returning the result in a single round-trip instead of two:

| Parameter | Description |
|-----------|-------------|
| `observe` | `"none"` (default), `"ui_tree"`, `"screenshot"`, or `"both"` |
| `observe_delay_ms` | Milliseconds to wait before capturing (default: 500) |
| `observe_stabilize` | If `true`, wait for UI to stop changing instead of a fixed delay |

### Example: before vs after

**Before** (2 calls):
```
tap(x=540, y=960) → get_ui_tree()
```

**After** (1 call):
```
tap(x=540, y=960, observe="ui_tree")
```

For a 5-step test flow, this cuts round-trips roughly in half.

## Examples

### Take a screenshot

```
"Take a screenshot of my Android emulator"
```

Claude will call `screenshot` with `platform: "android"` and display the image.

### Navigate an app

```
"Open Settings on my iOS simulator, then scroll down and tap General"
```

Claude will use `launch_app` and `tap_element` with `scroll_to_find: true` to navigate.

### Tap elements without visible text

```
"Tap the start session button"
```

Claude will use `tap_element` with `resource_id: "start-session-button"` to find icon buttons by their resource ID.

### Wait for loading to finish

```
"Tap 'Picking Flow', wait for the loading to finish, then tap the first session"
```

Claude will use `tap_element`, then `wait_for_element_gone` with the loading indicator's resource_id, then proceed.

### Run a test flow efficiently

```
"Tap 'Picking Flow', wait for the sessions to load, tap the first session, fill in the value, and submit"
```

Claude will use `tap_element` with `observe_stabilize: true` and `wait_for_element` to handle loading states server-side.

### Inspect the UI

```
"What buttons are visible on the screen?"
```

Claude will use `get_ui_tree` with `only_clickable: true` to list only interactive elements.

## How It Works

- **Android**: Uses `adb` commands directly (screencap, input, uiautomator, am, wm)
- **iOS Simulators**: Uses `xcrun simctl` (screenshot, io, launch, openurl)
- **iOS Physical Devices**: Uses `idb` (Facebook's iOS Development Bridge)

Screenshots are compressed with [sharp](https://sharp.pixelplumbing.com/) (resized + JPEG quality) to stay under Claude's 1MB image limit.

UI elements include `type`, `text`, `bounds`, `center_x`/`center_y` (for tapping), `clickable`, `resource_id`, `enabled`, and `focused`.

## License

MIT
