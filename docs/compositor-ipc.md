# dashi-comp IPC

How the shell (TypeScript, `packages/shell/src/compositor/client.ts`) and the
compositor (Rust, `crates/dashi-comp/src/ipc/`) talk. Both sides and this doc
change in the same commit, and a test holds them to it (H9): `cargo test`
writes one request, reply and event per method from the Rust types to
`test/fixtures/ipc/`, and the shell's `test/ipc-contract.test.ts` parses
each with its shapes (`src/compositor/`) and checks that the compositor's
table, this doc's tables and the shell's methods name the same methods, each
with the same "Who", and the same events.

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
- Each method's params and reply are one Rust type each (serde, beside the
  method in `ipc/methods/` or the module whose they are; the shared ones in
  `ipc/protocol/`), and every event a variant of `protocol::Event`. Params
  are read strictly: a field the method does not name is refused (``unknown
  field `x` ``), and so is a number out of its range (a window id is a
  positive whole number; a finger count, a pid, a Space's index, a
  millisecond count each have theirs), never wrapped or truncated. A refusal
  names the path to what was wrong (`` `rules[3].when`: … ``). A reply may come after replies
  to later requests: `capture` answers once its file is written, which runs
  off the compositor's event loop. Correlate by `id`.
- A client that falls 8 MiB behind on reading is dropped: its socket is shut
  down (it reads the end of the stream, or a reset) and nothing it sent after
  is run.
- The shell (`Compositor.request`) gives a request 10 s for its reply
  (`REQUEST_TIMEOUT_MS`, or the caller's own) and then rejects it with
  `dashi-comp: no reply to <method>`; once the socket closes, what waits is
  rejected and every later request is refused at once. `session()` is the one
  reader of the lock state at start (`locked`); the `lock` event follows it.
- Event, unsolicited, only after `subscribe`: `{"event": "<name>", ...}`.
- Window ids are positive integers, never reused within a session.
- A `Window` also says `sheetOf: int|null`, the window it is a sheet of (`attach`).
- Coordinates are global logical pixels unless a field says otherwise.

## Who may ask

The socket is the user's, but not every program the user runs is the shell.
Each method below says who may ask it (`ipc/table.rs` holds the same list;
`cargo test` fails when the two differ):

- **shell**: only the shell's own processes: the session client (`-c`, the
  supervisor) and its process group, and the sessions it started (each
  service it runs is `setsid`: the shell, and what the shell runs without a
  session of its own). An app the shell launches has a session of its own and
  is not the shell. The peer is told once, when it connects, by its
  `SO_PEERCRED` pid held by a pidfd while `/proc` is read (a pid reused under
  it can't pass).
- **granted**: the shell, and a process (or one under it) the shell named for
  that method with `ipc-clients`.
- **anyone**: any connection.

Anyone else gets `"<method> is only for the shell"` (or `"… and what it
grants it to"`), before its params are read and with nothing changed; an
unknown method gets `"unknown method: <name>"`. With `--open-ipc` (tests, a
shell started by hand without `-c`) every connection is the shell's; without
`-c` and without it, nobody is. `vm/vm ipc` (an ssh login, not under the
session) gets the `anyone` methods.

## Requests

### Session and windows

| Method | Who | Params | Result |
| --- | --- | --- | --- |
| `subscribe` | shell | `{}` | `{}`; events start flowing to this connection |
| `session` | anyone | `{}` | `{waylandDisplay, display: string\|null, xwayland: "off"\|"starting"\|"ready"\|"failed", pointer: {x,y}\|null, locked: bool}` |
| `windows` | granted | `{}` | `{windows: Window[]}`, front to back: the windows that show, most recently given the keyboard first, then the minimized, then the hidden (each latest first) |
| `focus` | granted | `{window}` | `{}`; raises, unminimizes, unhides, switches to its Space. While locked it is raised but not given the keyboard, which stays on the lock screen; the unlock gives it to the window in front (*see* "While locked" below) |
| `close` | granted | `{window}` | `{}`; asks the client to close |
| `minimize` | granted | `{window}` | `{}` |
| `hide` | granted | `{window}` | `{}` |
| `suspend` | shell | `{window, on: bool}` | `{}`; tells the app whether anyone can see its window: xdg_toplevel's `suspended` state (apps on xdg-shell 6 and later; older ones are not told), an X11 app's `_NET_WM_STATE_HIDDEN`. Only a change is sent on to the app. The shell decides: it suspends the windows that are off screen (minimized, hidden, or on a Space that is not shown) and lifts it when they show (`src/suspend.ts`); Metal apps hear it as the `visibility` event and stop polling (Activity Monitor). The compositor never suspends a window itself, except that an X11 window it minimizes is marked hidden as before |
| `frame` | granted | `{window, x, y, width, height, maximized?: bool, tiled?: bool}` | `{}`; `maximized` tells the app it is maximized (xdg `Maximized`, X11 `_NET_WM_STATE_MAXIMIZED_*`; the shell's Fill), and its absence that it is not. `tiled` says the shell made it a tile: it casts the `window-style` `tiled` shadow until another `frame` without it, Fill, full screen, or the person moves or resizes it (the app is not told). The frame a window had before a tile or Fill is the shell's to remember (`src/arrange/arrange.ts`). Ending maximized (a `frame` without it after one with it) sends the app two configures, so an app that answers the first with the size it had before it was maximized (GPUI does) takes this one at the second. A window held in a move grab is held at the new frame from the next motion on, for the pointer where the press was (what the shell sends on `window-grab`). A window off screen (minimized, hidden, or on a Space that is not shown) takes the frame where it waits: it comes back there |
| `place` | shell | `{window, x, y, space?}` | `{}`; answers `window-placing`. With `space` (not the one that shows) the window waits there, off screen and without the keyboard, until that Space shows; *see* `src/arrange/arrange.ts`, `src/spaces/fullscreen.ts`. An unknown Space is an error |
| `fullscreen` | granted | `{window, on: bool}` | `{}`; a window on a Space that is not shown goes full screen there (on the screen its frame is mostly on) and shows so when that Space does; out of full screen off screen (another Space, minimized, hidden), it waits at the frame it had before. A minimized window cannot enter full screen |
| `send-keys` | shell | `{window, chord: "ctrl+shift+z"}` | `{}`; delivers the chord to that window. Refused while locked ("the screen is locked"), before the window is touched |
| `animation-target` | shell | `{targets: [{window, rect: Frame\|null}]}` | `{}`; where minimize shrinks to |
| `layer-motion` | shell | `{namespace, ms: 0 to 300, scale?: 0.5 to 1}` | `{}`, or an error; from now on a layer surface opened with that namespace fades in from `scale` of its size (about its top middle) over `ms`, ease-out cubic, counted from the first frame it draws (the shell's launcher: `dashi.launcher`, 160 ms from 0.96). `ms` 0 stops it for the namespace. Instant with `chrome {reduceMotion}`. Closing is not animated |
| `window-for-handle` | granted | `{handle}`: a portal's parent window, `wayland:<xdg-foreign handle>` or `x11:<X window id, hex>` | `{window: int\|null}`; null for a handle that names no window (unknown, revoked, or a window gone) |
| `attach` | shell | `{window, parent: int\|null, top?: int}` | `{}`; `window` becomes a sheet of `parent` (null: an ordinary window again): no title bar, centred under the parent's title bar (or `top` points, 0 to 512, below the top of the parent's frame: for a parent that draws its own title bar and toolbar, whose height only the shell can guess), moved only as far as it takes to stay inside the usable area of the parent's screen (a sheet taller than the room below a small parent rises over it), and kept there, above it, on its Space, off screen with it; the keyboard goes to the sheet when the parent would get it, and a press inside the parent only brings the sheet forward. A window not yet placed is placed there (an answer to `window-placing`). A sheet whose parent closes becomes an ordinary window. Refused for a parent that is itself a sheet.; *see* `src/portal-host/sheets.ts` |

`Window` is `{id, appId, title, pid: int|null, focused, state:
"normal"|"minimized"|"hidden", frame: Frame|null, configuring: {width, height}|null, minSize: {width, height}|null, titleBar: int,
attention?: true, x11?: true, fullscreen?: true, space?: int, icon?: {name:
string|null, path: string|null}, toplevel?: string, sheetOf?: int, parent?: int}`;
`parent` is the window it is a dialog of (its xdg parent, or the X11 window
it is transient for), absent for a window of its own; `toplevel` is the
window's ext-foreign-toplevel-list identifier (what a screen-share picker
answers with; absent until the list has it); `icon` is what the app gave
(xdg-toplevel-icon): a theme icon name and/or a PNG the compositor saved under
`$XDG_RUNTIME_DIR/dashi-comp-icons/`; `configuring` is the outer size an
xdg app was last asked to take (`frame`, full screen, a resize) while it has
not yet acked and committed that configure (until then `frame` has the old
size; the position is already the new one), null once it has and for X11
windows; `minSize` is the smallest outer frame (title bar included) the app
allows (xdg `set_min_size`, X11's `WM_NORMAL_HINTS`), null when it sets none:
a person's resize stops there, and the shell keeps the frames it asks for at
least that big (`src/arrange/arrange.ts`, `keepLeast`); an X11 window's `pid` is its own
(`_NET_WM_PID`); `Frame` is
`{x, y, width, height}` (outer frame, title bar included).

### Screens

| Method | Who | Params | Result |
| --- | --- | --- | --- |
| `outputs` | anyone | `{}` | the screens and their usable areas; *see* `src/displays.ts`, `src/active-screen.ts`; each has `vrr: {supported, active, mode: "off"\|"on"\|"fullscreen"}`; `mirrorOf: name\|null`: the screen it shows (`mirror`), when it shows another's picture: then it is `enabled` and `lit` with no `frame` or `usable` |
| `mirror` | shell | `{output, source: name\|null}` | `{}`; `output` shows `source`'s picture (windows, layers, wallpaper, pointer) scaled to fit, centered, black bars where the shapes differ; `null` gives it its own desktop again, where it was. While it mirrors it is out of the space (no window, layer surface or pointer is on it; the shell moves its windows as for a screen unplugged) but stays lit at its mode. Errors: an unknown or off screen, a screen mirroring itself, a `source` that mirrors or is gone, an `output` that another mirrors. Mirroring ends by itself when the source goes away, and when `outputs-config` turns the screen on or off or moves it. `outputs-changed` each time. Which screen mirrors which is the shell's (`src/display-config/mirror.ts`) |
| `output` | granted | `{name, scale}` | `{}` |
| `xwayland-scale` | shell | `{scale}`, 1 to 4 | `{}`; X11 pixels per logical pixel (Xwayland's client scale, kept across its restarts). Above 1, X11 apps see the screens that much bigger and draw sharp if they size themselves from `Xft.dpi`, which the shell sets |
| `cursor-size` | shell | `{size}`, a whole number of points from 16 to 128 | `{}`; the pointer dashi-comp draws (named shapes, its own arrows), that size on every screen at every scale; starts at `XCURSOR_SIZE` or 24. The shell sends Settings → Appearance → Pointer size |
| `input-region` | shell | `{namespace, rects}`: a shell layer namespace (`dashi.*`) and up to 32 `{x, y, width, height}` in surface coordinates, or `rects: null` for the whole surface | `{}`; that namespace's layer surfaces take the pointer only inside the rects (their popups anywhere); elsewhere it reaches what is under them. The Dock sends its panel, so clicks beside it reach the windows |
| `outputs-config` | granted | a full arrangement; *see* `toWire` in `src/display-config/plan.ts`; an entry may set `vrr: "off"\|"on"\|"fullscreen"` (only while a window is full screen there) | `{}`; the shell reverts on its own timer if not kept |
| `power` | shell | `{on: bool, reset?: bool, output?: name}` | `{}`; screens on/off (DPMS). A dark screen still sends its clients frame callbacks, once a second and at its refresh for a few seconds after `agent-input`, so windows keep drawing for an agent while the person is away. With `output`, just that screen, held so: lighting every screen (waking from idle) and Displays leave a held-dark screen dark until `{on: true, output}`; an unknown name is an error. The shell holds the built-in screen dark at brightness 0 (`src/system/lib/screen-dark.ts`) |
| `gamma` | shell | the Night Shift tint; *see* `tintFor` in `src/night-shift.ts` | `{}` |
| `gpus` | anyone | `{}` | `{gpus: [{card, open, draws, kept, screens: string[], buffers, answering}]}`, by card name (`card0`); empty outside a seat of dashi-comp's own (nested, headless). The GPU that `draws` is always `open`; any other is open only while a screen is connected to it (`screens`), client buffers only it can read are alive (`buffers`, a game on the graphics card handing over buffers the drawing GPU cannot read), or the shell keeps it (`kept`), and is let go 10 s after the last of those ends (its renderer, EGL display, GBM device and DRM fd closed), so its driver can suspend it. At start (and when one is added) a GPU is opened only if it draws, is kept, or a connector's sysfs `status` says `connected` (or `unknown`: opening it probes). Every opening of a GPU that does not draw is probed first, off the event loop (a thread opens its node); `answering` is false while a probe has gone 3 s without an answer (the card may have fallen off the bus): it is left alone until the probe returns. A probe refused (cardwire blocks the card) leaves it asleep, and with a screen connected it is tried again after 2 s, doubling to a minute; `gpus-changed` says so. Asleep, a hotplug uevent on it with a connector saying `connected` opens it again (and one without opens it to look, unless it went to sleep in the last 30 s); so does a client buffer no open GPU can read (not again for 30 s after one no GPU could; the client's import is answered once the woken GPUs are open or have failed). A GPU udev removes while open is let go off the event loop (its screens removed, its device closed on a thread of its own). `gpus-changed` when one opens or goes to sleep |
| `gpu-keep` | shell | `{card, on: bool}` | `{}`, or an error for no GPU of that name; `on`: hold that GPU open even with nothing on it (warm for a game: no wait to open it when a screen or a game comes), opening it now if asleep; `off`: it goes to sleep 10 s later if nothing else holds it. Kept by card name until `off` or dashi-comp exits, across the card being removed and added again (a graphics mode switch). Nothing sends it yet: when to keep the card warm is the shell's |
| `wallpaper` | shell | a `WallpaperRequest` (*see* `src/wallpaper/catalog.ts`; `{video, mode}` plays a video, looped and muted) or `{paused: bool}` | `{}`, or an error if the file is refused; `wallpaper` event when loaded |

### Shell chrome and input claims

| Method | Who | Params | Result |
| --- | --- | --- | --- |
| `chrome` | shell | title bar style; *see* `src/appearance/chrome.ts` | `{}` |
| `window-style` | shell | the depth between windows, the whole look each time; *see* `windowStyle`, `src/appearance/window-style.ts`: `{shadow?: {focused?, other?, tiled?, filled?, sheet?}, edge?: Line & {filled?: bool}, ring?: Line & {on?: bool}, fade?: ms}`, each shadow a list of up to two `{x?, y?, blur?, spread?, alpha?}` (logical pixels as CSS `box-shadow` has them, offsets and spread −128 to 128, blur 0 to 128 for a Gaussian of sigma blur/2; black at `alpha` 0 to 1; the first drawn over the second), a `Line` `{color: "#rrggbb[aa]", width: 0 to 8}`, `fade` 0 to 1000 | `{}`, or an error (nothing changes). Until the first, windows have none. A window casts `focused` while it or its sheet has the keyboard, else `other`, cross-faded over `fade` ms (instant with `chrome {reduceMotion}`); `tiled` while it is a tile (`frame {tiled}`), `filled` while it is filled (`frame {maximized}`, until another `frame` or the person resizes it); `sheet` while attached (`attach`). The shadow is cut out where the window is (a rounded corner shows what is behind) and stays on the screen under the window's middle. `edge` is drawn just inside every frame, following its rounded corners (a filled window's too unless `edge.filled` is false); `ring` just outside the focused window's frame, in place of its edge (fading with the shadows), never on a sheet, and not in the overview. A full screen window, and a client whose surfaces reach past its geometry (it draws its own shadow), get none; neither do popups, layer surfaces, or a capture of one window. Overview windows and flights to the Dock get the shadow and edge at their scale |
| `keymap` | shell | the bindings; *see* `src/keymap/keymap.ts` (`KEYMAP`), plus `afterTap?: Rule[]` and `locked?: Rule[]` | `{}`; matching chords become `binding` events. `afterTap` is a second list of rules the compositor switches to by itself the moment ❖ is tapped (before the `super {phase: "tap"}` event goes out), once, until the next `keymap`: the shell's launcher takes the keys typed after a tap from that instant (`src/launcher/type-ahead.ts`). Without it a tap changes no rules. A `bind` rule with `armsAfterTap: true` switches to them too, right after its `binding` event goes out (❖Space opens the launcher as a tap does), so keys queued behind it while the compositor was busy are typed ahead, not sent to the focused window; `armsAfterTap` on any other rule is an error. `locked` is the only list matched while the screen is locked, its `send`, `tap` and `swallow` going to the lock screen (`LOCKED_RULES`: ❖A ❖C ❖X ❖V ❖Z as Ctrl chords, every other ❖ chord swallowed); a key none matches reaches the lock screen as it is. A locked rule that binds or names an `app` is an error (nothing changes) |
| `bars` | shell | the top-edge band for fullscreen menu bars; *see* `src/fullscreen.ts` | `{}`; `bars-edge` events |
| `edges` | shell | `{bottom: band, output?}` | the claim's answer; *see* `parseClaimAnswer`, `src/dock/lib/edges.ts`; `edge` events |
| `layout` | shell | `{zones: [{area, frame}], dwellMs}`: drag-to-tile zones; *see* `dragZones`, `src/arrange/arrange.ts` | `{}`; resting `dwellMs` in an `area` while dragging a window shows `frame`; letting go there is a `window-drop` (the compositor frames nothing itself) |
| `gestures` | shell | `{swipe: number[]}`: finger counts the shell claims | `{}`; `gesture` events (none while locked: every swipe goes to the lock screen) |
| `idle` | shell | `{timeouts: number[]}` (seconds) | `{}`; `idle` / `active` events |
| `keyboard` | shell | `{layout?, variant?, options?, repeatRate?, repeatDelay?}`: xkb name lists ("" is the system's own: `DASHI_XKB_*`, else localed's `00-keyboard.conf`), repeat in characters a second and ms; *see* `keyboardRequest`, `src/settings/settings.ts` | `{}`, or an error (nothing changes) when the layout does not compile |
| `input` | shell | `{touchpad?: {tap?, naturalScroll?, accelSpeed?, disableWhileTyping?, clickMethod?, scrollSpeed?}, mouse?: {naturalScroll?, accelSpeed?, accelProfile?, scrollSpeed?}}`; a key left out is the device's default; *see* `src/settings/settings.ts` | `{}`; devices plugged in later get them too |

### Spaces and overview

| Method | Who | Params | Result |
| --- | --- | --- | --- |
| `spaces` | shell | `{}` | *see* `parseSpaces`, `src/agents/desktop/spaces.ts` |
| `space-add` | shell | `{at?}` | `{count, current, space}`: a new Space at the end, or at index `at` (0 to `count`): the Spaces from there move up one, their windows with them (`window-space` for each), and so do what shows and a slide under way; *see* `src/spaces/lib/controller.ts` (a full-screen window's own Desktop goes in beside the one it came from, `src/spaces/fullscreen.ts`). Refused at 16 Spaces |
| `space-remove` | shell | `{space}` | `{count, current}`; its windows go to the Space on its left (the first's to the second), later Spaces move down one; refused for the last Space |
| `space-switch` | granted | `{space, progress?, carry?: window}` | `{}`; `progress` follows a swipe. A window held in a move grab (dragged by its title bar, or an app's own move) goes along: it is put on the new Space (`window-space`), stays under the pointer while the Spaces slide, and is still held after. `carry` does the same for a window on the Space that shows (an error otherwise, and with `progress`): it stays where it is on screen while the Spaces slide under it, is put on the new Space as the slide ends, and has the keyboard there (the shell's full-screen Desktops, `src/spaces/fullscreen.ts`) |
| `space-move` | granted | `{window, space}` | `{}` |
| `overview` | shell | `{windows: plan}` to open (*see* `planOverview`, `src/overview/lib/plan.ts`), `{duration?}` to close | `{}`; opening is refused while locked (it would take the lock screen's presses); locking closes it |

### Live pictures

Pictures of windows the shell places, drawn by the compositor every frame
while set (no pixels from TypeScript): in front of the shell's own layer
surfaces (its panels are opaque) and behind the pointer, each cut to its
rect. Rects are global logical `{x, y, w, h}`, a positive size; at most 64
per request. Each request replaces what it set before; empty `rects` clears
it. Windows in a picture that are not on screen (another Space's, minimized,
hidden) keep getting frame callbacks, so they stay live.

| Method | Who | Params | Result |
| --- | --- | --- | --- |
| `space-previews` | shell | `{output, rects: [{space, x, y, w, h, screen?}]}` | `{}`; drawn on `output`: each Space's windows (top first, as they stand or wait on that Space) and the wallpaper, as screen `screen` (default `output`) shows them, scaled into its rect (the rect should have that screen's shape; the share picker shows every screen this way); an unknown screen or a `space` past 15 is an error. Per screen: one screen's request leaves the others' |
| `window-thumbnails` | shell | `{rects: [{window, x, y, w, h}]}` | `{}`; each window (title bar included) as large as fits its rect, never larger than it is, centered; windows that are gone are left out |

### Capture and agents

| Method | Who | Params | Result |
| --- | --- | --- | --- |
| `capture` | shell | what and where to save; *see* `src/screenshots/screenshots.ts`, `src/agents/lib/run/run.ts`; `output: name` takes that whole screen (else the one under the pointer); one that mirrors is taken as it shows, its source's picture with the bars, at its own pixels (no `mask` there: an error); `cursor: true` draws the pointer (and a drag's icon) into a screen or `rect` capture; `mask: name` blanks what `capture-mask` set for that name | the capture |
| `screencopy-clients` | shell | `{paths: string[]}`: executables allowed to use screencopy | `{}` |
| `applet-clients` | shell | `{applets: [{pid, layerShell: bool}]}`, up to 64: the processes that run applets (docs/applets.md), the whole list each time | `{}`; a Wayland client under one of these processes may open layer surfaces only while its `layerShell` is true (an open popover); when it turns false or the process leaves the list, that client's layer surfaces are closed. Clients under no applet are unaffected, but a client whose process is unknown (one that connected through a security-context socket) may open no layer surface, since it could be an applet's |
| `ipc-clients` | shell | `{clients: [{pid, methods: string[]}]}`, up to 64, the whole list each time; only `granted` methods (an error names one that is not, and nothing changes) | `{}`; a connection from that process, or one under it, may ask those methods ("Who may ask" above). Nothing outside the shell needs one yet |
| `agent-input` | shell | an agent's pointer/key action (*see* `src/agents/desktop/hands.ts`), or `{release: true}` | `{}`; on the agent's own seat only with `DASHI_AGENT_SEAT=1` (a second `wl_seat` takes single-seat toolkits' keyboards, GPUI's among them); otherwise every action borrows the person's seat, once their own last input is `borrow.idleMs` old (3000 by default; a surface inhibiting idle and the agent's own input don't count), else the error `the person is using the desktop (free in N ms)`. Its clicks, presses and keys are noted as the agent's (`input-origin`). Its keys go to the window, never through an input method that holds the keyboard (`session/agent_keys.rs`). In a key step's `text`, a newline is the Return key and a tab is Tab; text with a character the layout has no key for is refused whole, before any key of it is pressed (`this keyboard's layout can't type 'x'; nothing was typed`). Refused while locked, except `{release}`. A `scroll` is a mouse wheel's: its pixels and their 120ths of a notch, 15 px a notch, as libinput reports a real wheel (GPUI reads only the notches). The shell plays a long agent scroll as flicks of at most 120 px, a frame apart (`wheelFlicks`), as a wheel spun fast would send them. A `click` on one of the window's lights (close, minimize, the square: dashi-comp's, over a unified window) is the light's, as the person's press is, whether the window is active or not |

### Secrets for agents (0.4.0, `docs/secrets.md`)

| Method | Who | Params | Result |
| --- | --- | --- | --- |
| `capture-mask` | shell | `{client, windows?: int[], rects?: [{window?, x, y, width, height}], layers?: string[], pids?: int[], popups?: int[]}`, at most 256 of each | `{}`; sets (replaces) what is blanked, painted opaque, in the pictures for `client` (a name: `"agent"`): those windows with their popups and title bars, those rects (in a window's content coordinates when `window` is set, else global; a window not on screen adds nothing; a window's rect stops where a window in front of it declares an opaque region, less that window's corners, except while the overview, a slide or a flight runs), the popups (xdg_popups with their subsurfaces) of the `popups` windows, without the windows, and those shell layers by namespace. A popup blanked once stays blanked for `client` while it lives, whatever later requests say. `capture {mask: client}` applies it, and so does every screencopy or image-copy frame for a client whose pid is in `pids` (a recorder the shell started for an agent). The blanks follow a window where it is drawn: small in the overview, flying to the Dock, sliding with its Space; a `space-previews` or `window-thumbnails` picture that shows a blanked window is blanked whole. A mask with nothing in it is dropped |
| `input-origin` | shell | `{namespace}` (a shell layer) or `{window}` | `{person: ms\|null, agent: ms\|null}`: how long ago the person's own hands (libinput) and an agent (`agent-input`, even on the person's borrowed seat) last pressed a button or a key there, within the last minute. Consent sheets count a yes only when the person's press is recent and no agent's is newer (`src/agents/person.ts`) |

### Clipboard history and snippets (0.4.0, `packages/shell/src/clipboard/`)

The compositor reports each new copy (`selection`) and never reads it: the
shell decides whether to keep it (its privacy rules) and reads it itself
over ext-data-control (`wl-paste`, one of its processes). For snippets the
compositor watches what the person types into windows for the shell's
keywords and says when one was typed (`snippet`); what was typed is never
sent, and only the tail as long as the longest keyword is held, while
keywords are set. The tail starts over on a click, a chord or a key the
keymap takes, a key that types nothing (an arrow, Return; BackSpace drops one
character), and a change of keyboard focus; keys typed into the shell's own
surfaces and keys an agent or a `send-keys` typed are not watched.

| Method | Who | Params | Result |
| --- | --- | --- | --- |
| `snippets` | shell | `{keywords: string[]}`, at most 256, each 2 to 32 characters with no spaces or control characters | `{}`, or an error (nothing changes); replaces the keywords (`[]` stops watching) |
| `snippet-erase` | shell | `{window, keyword}` | `{}` once `keyword` is deleted from `window` (BackSpace once per character, as `send-keys` taps keys); an error, and nothing typed, unless `window` has the keyboard and `keyword` is still the last thing typed there; refused while locked |

## In the 0.2.0 compositor

- **Done:** every request above, with every event; `wallpaper` also takes
  `{video, mode}`, played by the compositor. Unknown methods are answered
  with an error.
- **The shell's own Wayland protocols:** wlr-foreign-toplevel, ext- and
  wlr-data-control (clipboard without focus), ext-session-lock, the input
  method, and `capture` are for the shell's own processes only, by the same
  rule as "Who may ask" (`session/trust.rs`): an app the shell launches runs
  under it but in a session of its own, and is not the shell;
  screencopy, ext-image-copy-capture (screens, and windows named through
  ext-foreign-toplevel-list) also for the executables in
  `screencopy-clients`. None of them exist in greeter mode.
- **Xwayland:** `session.display` is set from the start (the X socket listens
  before the server is ready); `session-changed` follows when it is ready or
  fails.

## While locked

From the shell's ext-session-lock `lock` (the `lock {locked: true}` event)
to its unlock, the keyboard is the lock screen's, and the compositor holds
it there whatever the shell or a client asks: every change of keyboard focus
goes through one guard (`session/lock.rs`), and every key is checked against
it again before it is sent (`keys/locked.rs`).

- The keyboard goes to the lock surface on the pointer's screen (else any);
  before the lock screen has a surface, or after its client died, to nothing.
  A key typed then reaches no one.
- `focus`, a new window, an xdg-activation or foreign-toplevel or X11
  activation, a Space switch, a closed or minimized window, a click: the
  window is raised or placed as asked, but neither active nor given the
  keyboard. A shell sheet that takes the keyboard (a layer surface with
  `exclusive` keyboard) does not get it either, nor does the window under one
  that closes.
- Refused with "the screen is locked": `send-keys`, `snippet-erase`,
  `agent-input` (but `{release}`), and opening the `overview`.
- Only the keymap's `locked` rules apply, to the lock screen; no `binding`,
  no `super` `tap` or `hold`, no claimed `gesture`, no `snippet`.
- An input method's keyboard grab is let go (it grabs again when a field
  activates it after the unlock), and the pointer leaves what it was over (a
  move grab ends).
- Unlocking gives the keyboard to a shell sheet that takes it, if one came up
  meanwhile (a Wi-Fi password, a pairing code), else to the window in front.

## Events

| Event | Fields |
| --- | --- |
| `window-opened` | `window: Window` |
| `window-closed` | `id` |
| `window-placing` | `window: {id, appId, title, width, height, position?: {x, y}, parent?}`; answer with `place` or `frame`. `parent` as in `Window` (a dialog's own window) |
| `window-attention` | `window` |
| `window-space` | `window, space` |
| `window-state` | `window, state: "normal"\|"minimized"\|"hidden"`: a window was minimized, hidden, or shown again, whoever asked (the shell, the person at a title bar, the app itself, a taskbar) |
| `zoom` | `window, on`: an app asked to be maximized (`on: true`, xdg `set_maximized`, X11 `_NET_WM_STATE`; Dashi's unified title bars ask so on a double-click) or not (`on: false`), or a taskbar did (wlr-foreign-toplevel). The shell decides (`src/arrange/arrange.ts`) |
| `window-control` | `window, control: "zoom", alt, double`: a press on the square of a title bar dashi-comp draws (or of a unified window's lights), or a double-click on its title bar (`double: true`); `alt` is whether ⌥ was held. The compositor does nothing else with it: what it means (Fill, its own frame back, full screen) is the shell's |
| `window-grab` | `window, kind: "move"\|"resize", frame, pointer: {x, y}`: the person began to move (a title bar drag or an app's `move`, once the pointer has gone 4 points from the press; until then the window stays put) or resize (the first motion) a window; `frame` is its frame then (at its `configuring` size, if its app has not drawn that yet) and `pointer` where the press was. A resize also ends the window's maximized state. The shell decides the rest (a tiled window dragged out gets its own size back: a `frame` the grab then holds) |
| `window-drop` | `window, zone, frame`: a dragged window was let go while zone `zone` (its index in the last `layout`) showed its preview, `frame`. The shell frames it (`frame`) |
| `fullscreen` | `window, on` |
| `shortcut` | `name` |
| `binding` | `name, window: int\|null, key?, text?, shift?, ctrl?, alt?`; `text` is what the key types with the modifiers held ("a", "A", "é", " "), absent for keys that type nothing (Return, BackSpace, Escape, arrows) |
| `super` | `phase: "tap"\|"hold"\|"chord"\|"up"`; no `tap` or `hold` while locked (a tap then switches to no `afterTap` rules either) |
| `bars-edge` | `inside, output?` |
| `edge` | `edge: "bottom", inside` |
| `outputs-changed` | |
| `gpus-changed` | none: a GPU was opened, went to sleep, appeared or went away, stopped or started answering, or would not open with a screen on it (`gpus` says how they are now) |
| `session-changed` | |
| `lock` | `locked` |
| `screen-capture` | `active` |
| `person-input` | `window: int\|null` (throttled) |
| `overview` | `active` |
| `overview-pick` | `window: int\|null` |
| `overview-key` | `key` (keysym name); not while a shell layer surface holds the keyboard (a press gave it the keyboard: the Desktops row, renaming), whose keys are its own |
| `overview-drag` | `window, x, y`: a press on a window in the open overview became a drag (once per drag; the pointer still reaches the shell's surfaces, so the Desktops row sees where it goes) |
| `overview-drop` | `window, x, y` (over the shell's surfaces too: a drag that began in the overview ends there) |
| `space` | `current, previous, count` |
| `edge-hold` | `edge: "left"\|"right"\|"top"\|"bottom", output, window, count, preview`: the window held in a move grab has rested against that edge of that screen for 400 ms, and again every 400 ms it stays (`count` 1, 2, …); `preview` is whether a drag-to-tile preview shows. Pushing on outward at the edge is not resting for the `layout` zones: their wait starts over, so a push shows no tile preview. What a hold does is the shell's |
| `gesture` | `kind: "swipe"`, then `phase: "begin", fingers` / `"update", dx, dy` / `"end", cancelled` |
| `idle` | `seconds` |
| `active` | |
| `wallpaper` | `path: string\|null, ok, error?` |
| `window-icon` | `window, name: string\|null, path: string\|null` (not sent while xdg-toplevel-icon is off; docs/compositor.md) |
| `bell` | `window: int\|null` (xdg-system-bell) |
| `selection` | `mimeTypes: string[], window: int\|null, x11?: true`: the clipboard (not the primary selection) has a new copy, from a Wayland app, a data-control client, or an X11 app (`x11`); its types (at most 64, each at most 256 bytes) and the window that had the person's keyboard then; when that window is wl-copy's own (wl-copy without data-control maps one for a moment to copy), the app's: the last used other window in wl-copy's session (null for none, or a shell surface). Sent as the compositor takes the copy: a data-control read the shell starts after it gets this copy (or a newer one) |
| `snippet` | `keyword, window`: one of the `snippets` keywords was just typed into that window (the longest, when two end there). The shell decides; `snippet-erase` deletes it |
