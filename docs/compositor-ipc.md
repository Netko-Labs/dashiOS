# dashi-comp IPC

How the shell (TypeScript, `packages/shell/src/compositor.ts`) and the
compositor (Rust, `crates/dashi-comp/src/ipc/`) talk. Both sides and this doc
change in the same commit.

Recovered from the 0.1.0 shell, which is the client this protocol must keep
working with; the 0.1.0 compositor side (`comp/src/ipc/requests.rs`) was lost.
Request parameter shapes marked *see* are defined by the TypeScript that sends
them until the compositor side pins them down here.

## Transport

- Unix socket `$XDG_RUNTIME_DIR/dashi-comp.sock`, owned by the session user,
  mode 0600. `DASHI_COMP_SOCKET` puts it elsewhere (a nested or test
  compositor beside the session's); the compositor exports it to its `-c`
  client, and the shell connects to it when set. A socket that still answers
  is never taken over.
- Newline-delimited JSON, UTF-8, one message per line.
- Request: `{"id": <int>, "method": "<name>", "params": {...}}`.
- Reply, exactly one per request: `{"id": <int>, "result": <any>}` or
  `{"id": <int>, "error": "<message>"}`. Unknown methods and invalid params
  get an `error`, never a dropped connection.
- Event, unsolicited, only after `subscribe`: `{"event": "<name>", ...}`.
- Window ids are positive integers, never reused within a session.
- Coordinates are global logical pixels unless a field says otherwise.

## Requests

### Session and windows

| Method | Params | Result |
| --- | --- | --- |
| `subscribe` | `{}` | `{}`; events start flowing to this connection |
| `session` | `{}` | `{waylandDisplay, display: string\|null, xwayland: "off"\|"starting"\|"ready"\|"failed", pointer: {x,y}\|null, locked: bool}` |
| `windows` | `{}` | `{windows: Window[]}` |
| `focus` | `{window}` | `{}`; raises, unminimizes, unhides, switches to its Space |
| `close` | `{window}` | `{}`; asks the client to close |
| `minimize` | `{window}` | `{}` |
| `hide` | `{window}` | `{}` |
| `restore` | `{window}` | `{}`; back to the remembered frame |
| `frame` | `{window, x, y, width, height, remember?: bool, maximized?: bool}` | `{}`; `remember` keeps the old frame for `restore` |
| `place` | `{window, x, y}` | `{}`; answers `window-placing` |
| `fullscreen` | `{window, on: bool}` | `{}` |
| `send-keys` | `{window, chord: "ctrl+shift+z"}` | `{}`; delivers the chord to that window |
| `animation-target` | `{targets: [{window, rect: Frame\|null}]}` | `{}`; where minimize shrinks to |

`Window` is `{id, appId, title, pid: int|null, focused, state:
"normal"|"minimized"|"hidden", zoomed, frame: Frame|null, titleBar: int,
attention?: true, x11?: true, fullscreen?: true, space?: int, icon?: {name:
string|null, path: string|null}}`; `icon` is what the app gave
(xdg-toplevel-icon): a theme icon name and/or a PNG the compositor saved under
`$XDG_RUNTIME_DIR/dashi-comp-icons/`; an X11 window's `pid` is its own
(`_NET_WM_PID`); `Frame` is
`{x, y, width, height}` (outer frame, title bar included).

### Screens

| Method | Params | Result |
| --- | --- | --- |
| `outputs` | `{}` | the screens and their usable areas; *see* `src/displays.ts`, `src/active-screen.ts`; each has `vrr: {supported, active, mode: "off"\|"on"\|"fullscreen"}` |
| `output` | `{name, scale}` | `{}` |
| `outputs-config` | a full arrangement; *see* `toWire` in `src/display-config/plan.ts`; an entry may set `vrr: "off"\|"on"\|"fullscreen"` (only while a window is full screen there) | `{}`; the shell reverts on its own timer if not kept |
| `power` | `{on: bool, reset?: bool}` | `{}`; screens on/off (DPMS) |
| `gamma` | the Night Shift tint; *see* `tintFor` in `src/night-shift.ts` | `{}` |
| `wallpaper` | a `WallpaperRequest` (*see* `src/wallpaper/catalog.ts`; `{video, mode}` plays a video, looped and muted) or `{paused: bool}` | `{}`, or an error if the file is refused; `wallpaper` event when loaded |

### Shell chrome and input claims

| Method | Params | Result |
| --- | --- | --- |
| `chrome` | title bar style; *see* `src/appearance/chrome.ts` | `{}` |
| `keymap` | the bindings; *see* `src/keymap.ts` (`KEYMAP`) | `{}`; matching chords become `binding` events |
| `bars` | the top-edge band for fullscreen menu bars; *see* `src/fullscreen.ts` | `{}`; `bars-edge` events |
| `edges` | `{bottom: band, output?}` | the claim's answer; *see* `parseClaimAnswer`, `src/dock/edges.ts`; `edge` events |
| `layout` | `{zones, dwellMs}`: drag-to-tile zones; *see* `dragZones`, `src/arrange.ts` | `{}` |
| `gestures` | `{swipe: number[]}`: finger counts the shell claims | `{}`; `gesture` events |
| `idle` | `{timeouts: number[]}` (seconds) | `{}`; `idle` / `active` events |

### Spaces and overview

| Method | Params | Result |
| --- | --- | --- |
| `spaces` | `{}` | *see* `parseSpaces`, `src/agents/desktop/spaces.ts` |
| `space-add` | `{}` | the new Space; *see* `src/spaces/controller.ts` |
| `space-switch` | `{space, progress?}` | `{}`; `progress` follows a swipe |
| `space-move` | `{window, space}` | `{}` |
| `overview` | `{windows: plan}` to open (*see* `planOverview`, `src/overview/plan.ts`), `{duration?}` to close | `{}` |

### Capture and agents

| Method | Params | Result |
| --- | --- | --- |
| `capture` | what and where to save; *see* `src/screenshots.ts`, `src/agents/run.ts` | the capture |
| `screencopy-clients` | `{paths: string[]}`: executables allowed to use screencopy | `{}` |
| `agent-input` | an agent's pointer/key action (*see* `src/agents/desktop/hands.ts`), or `{release: true}` | `{}`; on the agent's own seat only with `DASHI_AGENT_SEAT=1` (a second `wl_seat` takes single-seat toolkits' keyboards, GPUI's among them); otherwise every action borrows the person's seat, once they have paused (`borrow.idleMs`, 3000 by default) |

## In the 0.2.0 compositor

- **Done:** every request above, with every event; `wallpaper` also takes
  `{video, mode}`, played by the compositor. Unknown methods are answered
  with an error.
- **The shell's own Wayland protocols:** wlr-foreign-toplevel, ext- and
  wlr-data-control (clipboard without focus), ext-session-lock, and
  `capture` are for the session client and the processes under it only;
  screencopy, ext-image-copy-capture (screens, and windows named through
  ext-foreign-toplevel-list) also for the executables in
  `screencopy-clients`. None of them exist in greeter mode.
- **Xwayland:** `session.display` is set from the start (the X socket listens
  before the server is ready); `session-changed` follows when it is ready or
  fails.

## Events

| Event | Fields |
| --- | --- |
| `window-opened` | `window: Window` |
| `window-closed` | `id` |
| `window-placing` | `window: {id, appId, title, width, height, position?: {x, y}}`; answer with `place` or `frame` |
| `window-attention` | `window` |
| `window-space` | `window, space` |
| `zoom` | `window` |
| `fullscreen` | `window, on` |
| `shortcut` | `name` |
| `binding` | `name, window: int\|null, key?, shift?, ctrl?, alt?` |
| `super` | `phase: "tap"\|"hold"\|"chord"\|"up"` |
| `bars-edge` | `inside, output?` |
| `edge` | `edge: "bottom", inside` |
| `outputs-changed` | |
| `session-changed` | |
| `lock` | `locked` |
| `screen-capture` | `active` |
| `person-input` | `window: int\|null` (throttled) |
| `overview` | `active` |
| `overview-pick` | `window: int\|null` |
| `overview-key` | `key` (keysym name) |
| `overview-drop` | `window, x, y` |
| `space` | `current, previous, count` |
| `gesture` | `kind: "swipe"`, then `phase: "begin", fingers` / `"update", dx, dy` / `"end", cancelled` |
| `idle` | `seconds` |
| `active` | |
| `wallpaper` | `path: string\|null, ok, error?` |
| `window-icon` | `window, name: string\|null, path: string\|null` |
| `bell` | `window: int\|null` (xdg-system-bell) |
