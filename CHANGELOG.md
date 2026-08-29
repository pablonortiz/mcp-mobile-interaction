# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-08-28

Reading the screen went from ~1900 ms to ~4 ms, and several tools now answer
differently when something is wrong instead of answering as if it were fine.
The changes under **Breaking** are why this is a major release — read those
two before upgrading.

### Breaking

- **Ambiguous device selection now fails.** With more than one device
  connected, tools refuse to act instead of silently taking the first one, and
  list the candidates by kind (emulator / usb / network). A network target is
  usually a TV on the same Wi-Fi, and installing an APK on it is not a
  hypothetical. Pass `device_id` to choose.
- **UI tree reads hold `UiAutomation` exclusively.** While the server runs,
  nothing else can use it on that device — not Appium, not Maestro, not
  `adb shell uiautomator dump`. It is released when the server exits. Set
  `MCP_MOBILE_FAST_TREE=0` to keep the previous behaviour if you need those
  tools alongside.
- `get_ui_tree` and `get_screen_state` may answer `unchanged` with a hash and
  a few anchor labels where they previously always returned the whole tree.
  Pass `force_full: true` for the old behaviour.
- `type_text` returns `isError` when the text did not reach the field, and
  `find_element` returns `isError` when the screen no longer belongs to the
  app under test. Both used to report success.
- `wait_for_element` and `wait_for_element_gone` default to 30 s instead of
  10 s. App start, first network-backed list load and login routinely exceed
  10 s.

### Added

- `run_flow` — declarative multi-step flows in a subset of Maestro's YAML, run
  server-side in one call. Supports `runFlow` composition with `${VAR}`
  substitution, `repeat` (`times` / `while`), `retry` (Maestro's block shape,
  `maxRetries` 0-3) and `dry_run`.
- `set_permissions` — grant or revoke Android runtime permissions, so a flow
  can start from a clean install without a human tapping the system dialog.
  Accepts shorthands (`camera`, `location`, `storage`, …) or full names.
- `dismiss_dev_overlays` — closes React Native's LogBox, which sits over the
  app and silently intercepts taps aimed at whatever is underneath.
- On-device daemon for tree reads. A 3.3 KB jar runs with `app_process` from
  `/data/local/tmp` — no APK is installed and `rm` undoes it. It also works on
  screens where the shell command fails outright with
  `ERROR: could not get idle state`.
- `swipe` gains `drag: true` for press-move-release, for reordering lists.
- `doctor` reports which path tree reads take, the device's API level and GPU
  backend, network-attached targets, and whether `screencap` returns a dead
  frame.

### Changed

- `platform` is inferred from what is connected and only required when an
  Android device and a booted iOS simulator are both present. `package` is
  optional on `kill_app`, `clear_app_data` and `get_app_info`, defaulting to
  the foreground app.
- Selector failures list the closest labels on screen with a similarity score,
  and flag a candidate that is `[disabled]`, `[not clickable]` or
  `[under an overlay]`.
- `tap_element` prefers clickable matches, and aims at a free part of the
  element when something covers its centre rather than firing into the cover.
- `launch_app` falls back from `monkey` to the resolved activity to a plain
  MAIN/LAUNCHER intent, verifies the app actually reached the foreground, and
  names installed look-alikes when the package is wrong.
- `get_device_logs` caps the read at the source. A full `logcat -d` routinely
  exceeds the 10 MB buffer (28 MB measured), so the tool used to fail every
  time. `search` now runs device-side, and `dump_to_file` covers the rest.
- Scrolling aims inside the largest scrollable container instead of the centre
  of the screen.
- Icon-font glyphs (Private Use Area) no longer count as text.
- The tool listing is ~1.2k tokens smaller per session.

### Fixed

- The server now exits with its MCP client. It follows the ancestor chain, not
  just the direct parent: an npm-installed server runs as
  `client → npm exec → node`, so watching `ppid` alone watched the wrapper and
  outlived the session. Eight orphaned instances were found on a normal
  workday machine.
- Screenshots that come back as a uniform black frame are refused with the
  emulator GPU fix instead of returned as an image.
- Temp files older than a day are cleaned at startup. Recordings were handed
  over as a path and never removed — 226 MB from a single day's session.
- `run_flow` validates `appId` before touching the device instead of failing
  mid-run, after earlier steps had already changed the app state.
- `record_screen` gains `action: "status"` and `force`, and recovers when the
  handle is lost but the device is still recording.
- Text matching decodes XML entities, and `type_text` routes non-ASCII through
  the clipboard.

## [1.4.0] - 2026-03

- Overhauled the exec layer, added iOS support and a compact UI tree format.
- Added 11 tools: `long_press`, `double_tap`, `open_url`, `wait_for_stable`,
  `get_screen_state`, `install_app`, `uninstall_app`, `get_app_info`,
  `set_location`, `set_appearance`, `rotate_device`, `clear_text`, `doctor`.

## [1.3.1] - 2026-02

- `get_device_logs` handles a failing logcat clear gracefully.

## [1.3.0] - 2026-02

- Added `set_clipboard` and `get_device_logs`.

## [1.2.1] - 2026-02

- Added `clear_app_data`, `kill_app`, `find_element` and `set_network_state`;
  extended `press_key` with more keys and a raw keycode parameter.

## [1.2.0] - 2026-01

- Added element-based interaction and waiting.

## [1.1.0] - 2026-01

- First public release.

[2.0.0]: https://github.com/pablonortiz/mcp-mobile-interaction/releases/tag/v2.0.0
