# mcp-mobile-interaction

[![CI](https://img.shields.io/github/actions/workflow/status/pablonortiz/mcp-mobile-interaction/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/pablonortiz/mcp-mobile-interaction/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/mcp-mobile-interaction?style=flat-square&color=CB3837)](https://www.npmjs.com/package/mcp-mobile-interaction)
[![npm downloads](https://img.shields.io/npm/dm/mcp-mobile-interaction?style=flat-square&color=CB3837)](https://www.npmjs.com/package/mcp-mobile-interaction)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

An MCP (Model Context Protocol) server that lets Claude interact with Android and iOS devices/emulators. Take screenshots, tap, swipe, type, inspect UI elements, mock GPS, record the screen, and more — no Appium required.

## Prerequisites

### Android
- [Android SDK](https://developer.android.com/studio) with `adb` in your PATH
- An Android emulator running or a physical device connected via USB with ADB debugging enabled

### iOS
- macOS with [Xcode](https://developer.apple.com/xcode/) installed (provides `xcrun simctl`) — covers screenshots, app lifecycle, clipboard, location, appearance and recording on **simulators**
- [idb](https://fbidb.io/) (`brew install idb-companion && pip install fb-idb`) — **required for all UI interaction** (tap, swipe, type, key presses, UI tree) on simulators AND physical devices. `xcrun simctl` has no UI interaction commands.

Run the `doctor` tool to diagnose your setup.

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

All tools accept a `platform` parameter (`"android"` or `"ios"`) and an optional `device_id` (defaults to the first connected device). Read-only tools are annotated with `readOnlyHint` so MCP hosts can auto-approve them.

### Inspection Tools

| Tool | Description |
|------|-------------|
| `list_devices` | List connected devices and emulators/simulators |
| `screenshot` | Capture a screenshot (base64 JPEG). Supports cropping to a single element (`crop_resource_id` / `crop_text`) for token-efficient component checks |
| `get_ui_tree` | Compact flat list of UI elements with optional filters (`only_clickable`, `only_with_text`, `type_filter`, `resource_id_contains`, `max_elements`) |
| `get_screen_info` | Screen dimensions, density, and orientation (rotation-aware on Android) |
| `get_screen_state` | UI tree + screenshot in a single call (saves a round-trip) |
| `find_element` | Find elements by text/resource_id/type without tapping. For assertions. Supports `scroll_to_find` |
| `get_current_app` | Foreground app package + activity (Android). For asserting navigation/deep links |
| `get_app_info` | Whether an app is installed + its version |
| `get_device_logs` | OS-level logs (Android logcat / iOS log show on simulators). Filter by tag, level, or search string |
| `get_clipboard` | Read the device clipboard (verify copy-to-clipboard features) |
| `doctor` | Diagnose local tooling: adb, ANDROID_HOME, devices, emulator, simctl, idb |

### Action Tools

| Tool | Description |
|------|-------------|
| `tap` / `double_tap` / `long_press` | Touch at (x, y) coordinates (native resolution) |
| `swipe` | Swipe between coordinates or by direction (up/down/left/right) |
| `tap_element` | Find element by text/resource_id/type and tap it. Supports `scroll_to_find` (+`scroll_direction`) and `wait_for`. Warns when the target is disabled or covered by an overlay |
| `type_text` | Type into the focused input. Full Unicode: non-ASCII text (á, ñ, emoji) is delivered via clipboard paste on Android — `adb input text` silently drops it |
| `clear_text` | Clear the focused text field (reads its length from the UI tree on Android) |
| `press_key` | Press a named key (incl. `paste`) or raw Android keycode, with `repeat` support |
| `launch_app` / `kill_app` | Start / force-stop an app |
| `install_app` / `uninstall_app` | Install a local .apk / .app / .ipa, or remove an app |
| `open_url` | Open a URL or deep link (query params with `&` are quoted correctly) |
| `clear_app_data` | Mode `cache` clears temp files only; mode `all` resets to fresh install |
| `set_clipboard` | Set the device clipboard (targets the simulator pasteboard on iOS, not the host Mac) |
| `set_location` | Mock GPS coordinates (Android emulator / iOS simulator+idb). For delivery/route flows |
| `set_network_state` | Wi-Fi, mobile data, airplane mode, and emulator latency/speed throttling (Android) |
| `set_appearance` | Switch dark/light mode |
| `rotate_device` | Rotate to a fixed orientation (Android) |
| `record_screen` | Start/stop an mp4 screen recording — bug repro evidence |

### Waiting Tools

| Tool | Description |
|------|-------------|
| `wait_for_element` | Poll until an element matching text/type/resource_id criteria appears |
| `wait_for_element_gone` | Poll until a matching element disappears (spinners, skeletons, dialogs) |
| `wait_for_stable` | Poll until the screen stops changing (two consecutive UI snapshots match) |

## UI Tree Format

UI trees are returned in a compact one-line-per-element format (~4x fewer tokens than JSON):

```
UI tree (12; format: [n] Type "text" @(center_x,center_y) WxH #resource_id flags):
[0] TextView "Settings" @(270,125) 540x50 #title clickable
[1] EditText "" @(540,300) 900x120 #search_input focused
[2] Button "Save" @(540,960) 300x90 #save_btn disabled
```

Flags: `clickable`, `disabled`, `focused`, `overlay` (an element that looks like a modal scrim). Output is capped (default 120 elements) with a summary line pointing to the filters.

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

Action tools (`tap`, `double_tap`, `long_press`, `swipe`, `type_text`, `press_key`, `launch_app`, `open_url`, `tap_element`, `clear_text`) support optional **observe** parameters that capture the screen state after the action completes — returning the result in a single round-trip instead of two:

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

### Navigate an app

```
"Open Settings on my iOS simulator, then scroll down and tap General"
```

Claude will use `launch_app` and `tap_element` with `scroll_to_find: true`.

### Test a delivery route with mock GPS

```
"Set the location to the first stop of the route and verify the app shows 'You have arrived'"
```

Claude will use `set_location`, then `wait_for_element`.

### Record a bug repro

```
"Record the screen while you reproduce the crash, then give me the video"
```

Claude will use `record_screen` (start), drive the flow, then `record_screen` (stop) and return the mp4 path.

### Verify copy-to-clipboard

```
"Tap the copy tracking code button and verify the clipboard contains the code"
```

Claude will use `tap_element`, then `get_clipboard`.

### Type Spanish text

```
"Fill the notes field with 'Entregar mañana según lo acordado'"
```

`type_text` detects the non-ASCII characters and delivers them via clipboard paste — `adb shell input text` would silently drop them.

## How It Works

- **Android**: Uses `adb` directly (screencap, input, uiautomator, am, pm, dumpsys, emu console). Commands run via `execFile` (no shell), with device-side quoting where needed — text and URLs with special characters are safe.
- **iOS Simulators**: Uses `xcrun simctl` for lifecycle/screenshots/clipboard/location/appearance/recording, and `idb` for all UI interaction (simctl has no tap/swipe/type).
- **iOS Physical Devices**: Uses `idb` (Facebook's iOS Development Bridge).

Screenshots are compressed with [sharp](https://sharp.pixelplumbing.com/) (resized + JPEG quality) to stay under Claude's 1MB image limit.

## Development

```bash
mise install   # pins Node 22
npm install
npm test
npm run build
```

## License

MIT
