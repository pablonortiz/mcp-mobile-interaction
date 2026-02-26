# mcp-mobile-interaction

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
| `get_ui_tree` | Get a flat list of UI elements with bounds and center coordinates |
| `get_screen_info` | Get screen dimensions, density, and orientation |
| `get_screen_state` | Get UI tree + screenshot in a single call (saves a round-trip) |

### Action Tools

| Tool | Description |
|------|-------------|
| `tap` | Tap at (x, y) coordinates |
| `double_tap` | Double-tap at (x, y) coordinates |
| `long_press` | Long-press at (x, y) with configurable duration |
| `swipe` | Swipe between coordinates or by direction (up/down/left/right) |
| `type_text` | Type text into the focused input field |
| `press_key` | Press a key (home, back, enter, delete, volume_up, volume_down, power, tab, recent_apps) |
| `launch_app` | Launch an app by package name / bundle ID |
| `open_url` | Open a URL or deep link |
| `tap_element` | Find an element by text and tap it (combines get_ui_tree + tap) |

### Waiting Tools

| Tool | Description |
|------|-------------|
| `wait_for_element` | Poll until an element matching text/type criteria appears on screen |
| `wait_for_stable` | Poll until the screen stops changing (two consecutive UI snapshots match) |

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

Claude will use `launch_app`, `tap_element`, and `swipe` to navigate.

### Run a test flow efficiently

```
"Tap 'Picking Flow', wait for the sessions to load, tap the first session, fill in the value, and submit"
```

Claude will use `tap_element` with `observe_stabilize: true` and `wait_for_element` to handle loading states server-side.

### Inspect the UI

```
"What buttons are visible on the screen?"
```

Claude will use `get_ui_tree` to list all visible elements with their types, text, and coordinates.

## How It Works

- **Android**: Uses `adb` commands directly (screencap, input, uiautomator, am, wm)
- **iOS Simulators**: Uses `xcrun simctl` (screenshot, io, launch, openurl)
- **iOS Physical Devices**: Uses `idb` (Facebook's iOS Development Bridge)

Screenshots are compressed with [sharp](https://sharp.pixelplumbing.com/) (resized + JPEG quality) to stay under Claude's 1MB image limit.

UI elements include `type`, `text`, `bounds`, `center_x`/`center_y` (for tapping), `clickable`, `resource_id`, `enabled`, and `focused`.

## License

MIT
