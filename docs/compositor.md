# dashi-comp

Dashi's Wayland compositor: `crates/dashi-comp`, Rust on smithay 0.7 and
calloop. It displays and routes input; the shell decides
(`docs/conventions.md`, "The Rule"). This doc is its design and plan.

## Status

The 0.1.0 source was lost (`RECOVERY.md`); 0.2.0 is a rewrite. **C0 is
done**: nested (winit) and headless backends, xdg-shell with move and resize,
the IPC socket with `subscribe`, `session`, `windows`, and `window-opened` /
`window-closed`, and the `-c` session client; checked in the VM with foot,
and by headless integration tests (`crates/dashi-comp/tests/`). The 0.1.0
binary survives as a reference (outside the repo), and the shell's client,
`packages/shell/src/compositor.ts`, is the contract the rewrite must keep:
`docs/compositor-ipc.md`.

## What 0.1.0 Had

Recovered from the binary's panic locations, its dependency list, and the
shell's client:

- **Backends:** `udev/` (DRM/KMS on GBM, `screens`, `hotplug`, `frame`, `gpu`
  for multi-GPU, `gamma`, `edid`), `winit.rs` (nested, for development),
  `devices/libinput.rs`, libseat sessions.
- **Protocols (`handlers/`):** compositor, xdg-shell, layer-shell,
  xdg-activation, xdg-dialog, dmabuf, gestures, screencopy (`serve`,
  `geometry`, `ipc`: per-client grants), a Dashi chrome protocol
  (`chrome_protocol.rs`).
- **Xwayland (`xwayland/`):** started at login (not in greeter or headless
  mode) on a display known at once, so the session gets `DISPLAY` from the
  start; restarted with backoff if it fails, on the same display. dashi-comp
  is its window manager (smithay's X11Wm): X11 windows join the registry,
  are placed by the shell (`window-placing` with the spot asked for), get
  Dashi title bars unless they draw their own, and get the X input focus with
  the keyboard. Menus and tooltips (override-redirect) go where the app puts
  them. The clipboard and primary selection cross both ways; an X11 app reads
  them only while an X11 window has the keyboard. `_NET_ACTIVE_WINDOW`, which
  X11Wm ignores, is heard on a second X connection (`xwayland/activate.rs`):
  a minimized or hidden window comes back, as does one a pager asks for or
  any while an X11 app has the keyboard; others want attention.
- **Window management mechanics:** `windows.rs`, `layout.rs` (drag-to-tile
  zones), `fullscreen.rs`, `spaces/` (`switch`), `overview/` (`scene`,
  `input`), `motion/` (animations), `grabs/resize_grab.rs`, `title.rs` and
  `controls.rs` (server-side title bars), `cursor.rs`. A Space can be added
  at an index (`space_list.rs`), and a window on a Space that is not shown
  can be placed, framed, and put into or out of full screen there: it waits
  off screen and shows so when its Space does. That is what the shell needs
  to give a full-screen window a Desktop of its own and slide to it once
  (`packages/shell/src/spaces/fullscreen.ts`); `window-state` tells it when a
  window is minimized or hidden however that happened.
- **Session:** `lock.rs`, `idle/` (`protocols`, `ipc`), `keys/` (keymap,
  bindings, ❖ phases, the snippets' keywords watched as the person types, Super lent to the window of a ❖-click), `agent_seat/` (a second seat an agent drives, drawn
  with its own pointer), `capture.rs`, `wallpaper/` (`request`, `live`,
  `tick`), `outputs/` (`config`, `apply`, `place`, `report`, `chrome`).
- **IPC (`ipc/`):** `server` (the socket and replies), `incoming` (each connection's requests, read and run), `frame`, `peer` (who connected), `table` (every method, who may ask it, what runs), `methods/` (what each does, by area, with its params and reply as serde types), `protocol/` (the IPC's one Rust definition: `Event`, `Window`, the `outputs` reply, ids and numbers that refuse what is out of range), `grants` (`ipc-clients`).
- Text in the compositor (title bars) with cosmic-text.

## Module Map

The rewrite keeps 0.1.0's shape where it was sound and follows the Rust
conventions: a backend owns its devices, handlers translate protocol requests
into state, IPC carries the shell's decisions in.

```txt
crates/dashi-comp/src/
  main.rs           arguments, logging, picks a backend, runs the loop
  cli.rs            the command line (--backend, --greeter, --no-xwayland, -c)
  state.rs          the compositor's state (one struct, on the loop)
  frames.rs         frame callbacks: the clients on a screen hear to draw the next
  backend/
    mod.rs          the backend facade the rest of the compositor sees
    udev/           DRM/KMS, GBM, libinput, libseat, hotplug, multi-GPU, gamma,
                    EDID, keyboard lights (keyboards.rs), VRR (vrr.rs), the
                    graphics card let go while nothing needs it (sleep.rs; its
                    state machine lifecycle.rs, probes probe.rs, buffers
                    imports.rs, a card gone while open gone.rs)
    winit.rs        nested in another compositor's window (a second, virtual
                    screen beside it with DASHI_NESTED_SCREEN=WxH)
    headless.rs     no screens drawn: IPC and protocol tests (more than one
                    with DASHI_HEADLESS_SCREENS=N)
  handlers/         one module per Wayland protocol (or family): compositor,
                    xdg_shell, layer_shell, seat (clipboard, primary selection,
                    data-control, drag and drop: the drag icon rides under
                    the pointer), surface (viewporter, fractional scale, ...),
                    pointer (constraints, relative, gestures, cursor-shape),
                    inhibit, text (text-input, input-method, virtual keyboard),
                    security (security-context), sync (explicit and implicit),
                    toplevel_meta (icons, bell), activation (+ dialog)
  protocols/        protocols smithay lacks: dashi-chrome-v1, wlr-foreign-
                    toplevel, wlr-screencopy (copy_with_damage paced to the
                    refresh, at most 60 fps), ext-image-copy-capture
                    (image_capture.rs), ext-foreign-toplevel-list,
                    xdg-foreign (ported from smithay, with handles the IPC can look up:
                    `window-for-handle`)
  render/           scene, one window's elements (windows.rs), title bars, cursor,
                    capture, presentation (present.rs), rounded corners (rounded.rs),
                    depth between windows (depth/: `window-style`), live pictures the shell places
                    (thumbnails/: `space-previews`, `window-thumbnails`), a screen showing
                    another's picture (mirror.rs: `mirror`)
  wakes.rs          what woke the event loop: whether idle screens may sleep
  wm/               windows, placement mechanics, frames, fullscreen, spaces, overview,
                    grabs (a move grab survives a Space change), edge holds (edge_hold.rs),
                    sheets (a window attached under another's title bar: IPC `attach`)
  input/            keyboard and pointer routing, decorations, constraints, gestures; a still pointer follows windows moving under it (follow.rs)
  keys/             keymap, bindings, ❖ phases, snippet keywords (snippets.rs), ❖-click (super_click.rs),
                    keys while locked (locked.rs)
  xwayland/         Xwayland and the X11 window manager
  ipc/              socket, framing, who connected, the method table (who may ask what), methods/
  background.rs     blocking work (PNG encoding, file IO) on a thread, back as a calloop event
  outputs/          `outputs`, `output`, `outputs-config`, VRR modes, `mirror` (mirror.rs)
  session/          the session client, trust, lock, idle, agent input
  wallpaper/        pictures, video (GStreamer), live looks
```

## Milestones

Each milestone ends with the shell running on it in the VM.

- **C0, skeleton (done):** Cargo workspace, winit and headless backends, xdg-shell,
  rendering, IPC socket with `subscribe`, `session`, `windows`, window events.
- **C1, the session boots:** layer-shell (menu bar, Dock, sheets) *(done)*,
  linux-dmabuf *(done: moved up from C3, Vulkan clients such as the Metal host
  need it)*, the window requests and `window-placing` *(done)*, `outputs`
  and `output` *(done)*; then the udev backend on one GPU, keyboard and `keymap`/`binding`/`super`, `focus`,
  `close`, `minimize`, `hide`, `frame`, `place`, `restore`,
  `window-placing`, `outputs`, `output`, `chrome` and server-side title bars,
  cursor, `send-keys`.
- **C2, the desktop (done):** Spaces, overview, `fullscreen` and `bars`, `edges`,
  `gestures`, animations (`animation-target`), `idle`, `power`, `gamma`,
  `outputs-config`, `wallpaper`, `layout` zones, `zoom`.
- **C3, the rest of 0.1.0 (done):** Xwayland, screencopy with grants and `capture`,
  `agent-input` and the agent seat, xdg-activation and attention, dmabuf,
  multi-GPU, lock, xdg-dialog, `person-input`.
- **C4, better than 0.1.0:** see below.

## Better Than 0.1.0

- **The session lock is the compositor's guarantee:** ext-session-lock, so a
  crashed shell leaves the screen locked, not open. While locked the keyboard
  is the lock screen's whatever asks for it (0.5.0: keys typed on the lock
  screen once reached System Settings behind it, after something moved the
  keyboard there): every change of keyboard focus goes through
  `Dashi::set_keyboard_focus` (`session/lock.rs`), which gives it only to a
  lock surface then, and every key is checked again before it is sent
  (`keys/locked.rs`); `send-keys`, `snippet-erase`, `agent-input` and the
  overview are refused, only the keymap's `locked` rules apply, no binding,
  ❖ tap or hold, or claimed swipe goes to the shell, and an input method's
  grab is let go (docs/compositor-ipc.md, "While locked";
  `tests/lock.rs` tries each way in).
- **Games:** direct scanout (done: smithay's DRM compositor puts a client
  buffer on a plane when it can, presentation feedback says zero-copy, and
  per-surface dmabuf feedback offers a scanned-out surface the formats its
  plane takes),
  VRR (done: off, on, or full screen only, the shell's choice per screen),
  pointer constraints and relative pointer (done). Tearing control waits on
  async page flips in smithay's DRM compositor.
- **Explicit sync (done):** linux-drm-syncobj when the drawing GPU can wait on
  syncobjs; otherwise commits wait for their dmabufs (implicit sync).
- **Software rendering (done):** when the GPU chosen to draw has only a
  software EGL driver (a VM without 3D, `nomodeset`), it draws on its card
  node with llvmpipe into linear buffers, so the live image starts anywhere.
- **The graphics card sleeps (done, 0.5.0):** a GPU that does not draw (a
  laptop's NVIDIA card beside the AMD or Intel GPU that drives the panel) is
  held open only while it is needed: a screen connected to it, client
  buffers only it can read, or the shell's `gpu-keep`. 10 s after the last
  of those, dashi-comp drops its renderer and EGL display, its GBM device and
  its DRM fd (handed back to the seat), and with them the driver's
  `/dev/nvidia*`, so the card can runtime-suspend. Asleep, it is only a path:
  udev's hotplug uevent comes without the device open, and the connectors'
  sysfs `status` (the kernel's last probe, read without waking it) says
  whether to open it, which happens on its own when a screen is plugged in.
  Clients are told the drawing GPU (dmabuf feedback, Xwayland's glamor), so
  a game offloaded to the card (PRIME render offload, Steam's
  `__NV_PRIME_RENDER_OFFLOAD`) renders there and hands buffers the drawing
  GPU reads directly: the compositor needs no card for it. A buffer no open
  GPU can read wakes the sleeping ones for the import (its answer to the
  client waits for that, the event loop does not), and the card stays open
  while such buffers live. `gpus` reports each GPU, `gpus-changed` says when
  that changes; the shell no longer counts dashi-comp among the card's
  holders. The rules (what holds a card, the grace, probes, retries) are a
  pure state machine with its tests (`udev/lifecycle.rs`); `udev/sleep.rs`
  carries them out.

  *What held the card before (0.4.0 to early 0.5.0):* every GPU udev listed
  was opened at start and kept all session: the seat's fd for
  `/dev/dri/card0` (libseat's `TakeDevice`, so logind held a copy too), the
  `DrmDevice` on it with its event source and `DrmOutputManager`, a
  `GbmDevice` on that fd, an `EGLDisplay` on the GBM device (NVIDIA's EGL
  opens `/dev/nvidiactl` and `/dev/nvidia0` for it) and, through the
  `GpuManager`, a `GlesRenderer` with its EGL context on the card's render
  node. The `DrmScanner` holds no fd of its own. Any one of those keeps the
  card in D0; all of them go now when it sleeps.

  *A card that falls off the bus* (the G14's: pciehp "Link Down", then
  nvidia-modeset "Error while waiting for GPU progress" forever, and every
  call on the card hangs in the driver) must not take the session with it.
  So every opening is probed first (`udev/probe.rs`): a thread opens the
  card's node and closes it, and only when that answers does the event loop
  open it through the seat and set up DRM, GBM and EGL. A probe that does not
  answer in 3 s marks the card stuck (`gpus`: `answering: false`): nothing
  wakes it or looks at it until that thread comes back (or udev removes the
  card); the thread may stay in the kernel for good, the loop never waits.
  A probe the kernel refuses (cardwire blocks the card's nodes in Integrated
  mode) leaves the card asleep; with a screen connected it is tried again
  after 2 s, doubling to a minute, and `gpus-changed` tells the shell, whose
  Automatic graphics switches to Hybrid for a screen on the card, so the
  screen lights up then. A card udev removes while open is let go off the
  event loop (`udev/gone.rs`), since letting it go makes calls on the card
  (smithay restores its CRTCs and drops DRM master, the renderer makes its
  EGL context current to delete its objects, logind closes its copy): its
  screens leave the compositor, its renderer is leaked on purpose (GL lives
  on the event loop's thread; a stand-in on the drawing GPU takes its place
  in the GPU manager), the seat is not asked, and its device, scanouts and
  fd are dropped on a thread of their own, which a dead card stalls instead
  of the session. A card whose sysfs entry is gone when its grace ends is
  let go the same way. A thread stuck in the driver may keep dashi-comp
  from exiting at logout; the session above it is already over then. Left to chance: a card that hangs
  while open with a screen on it and is never removed, since drawing that
  screen (the page flip, the copy to the card) is on the event loop.
- **Presentation time (done):** feedback at the vblank, from DRM's timestamp.
- **Dark screens pace their clients (done, 0.5.0):** a screen blanked by
  `power {on: false}` (the shell, after `idle.blankAfterSeconds` without the
  person's input) used to stop its loop, and with it every client's frame
  callbacks: an agent working on through `agent-input`, which isn't the
  person and doesn't wake the screens, saw every window frozen in its last
  frame (reviews 20 and 21's "display freeze", five minutes after login each
  time; the agent's screenshots are drawn on demand from the clients' last
  buffers, so they looked live). A dark screen now sends its clients frame
  callbacks once a second, at its refresh for five seconds after an agent's
  input, and at once on that input (`udev/pace.rs`); every window on it hears,
  one opened while dark included. A screen has one timer at a time: asking
  for a sooner frame replaces it, so kicks from `power`, a new screen or the
  watchdog never start a second loop.
- **Lost vblanks (done, 0.5.0):** a screen draws its next frame only after the
  last one's page-flip event, so one that never came would stop it for good.
  A second without it, the frame is given up on (`udev/flip.rs`,
  `udev/watchdog.rs`): one warning per stall naming the screen, the scanout
  lets the frame go, and the screen draws again; a vblank that turns up later
  is ignored, or recognized by its timestamp as the old frame's. The nested
  (winit) backend has no such wait: each redraw asks for the next.
- **Refused frames (done, 0.7.0):** on an AMD laptop the display refused every
  frame (the atomic commit failed with EINVAL, "Page flip commit failed")
  while one window was up, 112 times a second for 15 s, and nothing new
  reached the screen (review 12-flip). smithay 0.7 tests a plane's state only
  when it looks different, so a state the driver refuses can get through
  untested, and on a refusal it marks only a client buffer on the primary
  plane as failed: one on an overlay or the cursor plane was tried again each
  frame. Now a refusal steps down (`udev/planes.rs`): the next frame keeps only
  the cursor plane, and the one after that, if refused too, uses no planes,
  the cursor drawn into the picture. Every plane is tried again after 5 s
  (doubling to a minute while retries are refused), or a second after a
  refusal when the screen's windows change. The log has one warning when a
  run starts ("the screen refused a frame: drawing with …", naming what was on
  planes) and one summary when it ends ("planes back on", with the count, the
  seconds, and what drew meanwhile). EBUSY, a flip still pending, is not a
  refusal: the watchdog above handles it as before.
- **Idle screens sleep (done, 0.7.0):** a lit screen that has nothing new to
  draw used to look again every refresh, rebuilding its scene to learn that
  nothing changed (every window's title bar walked, the elements diffed),
  forever. Now a screen sleeps after 30 turns with nothing new since it last
  drew or was poked (a client's request, input, IPC: what starts a fade),
  looking once a second (and pacing its clients' frame callbacks so) until
  something wakes the event loop (`wakes.rs`, `udev/frame.rs`). A poke wakes
  it at once and keeps it looking for another 30 turns; any other wakeup (a
  timer or a channel: a slide's or the overview's frame timer, a video frame,
  the idle watch's tick every half second) makes it look once, and it sleeps
  again at once if nothing changed. What moves by itself draws something new
  each frame, so its screen stays awake while it runs. The nested (winit)
  backend is unchanged.
- **Title bars per scale (done, 0.7.0):** each window keeps its title bar
  image per screen scale (`wm/by_scale.rs`, up to four), so two screens at
  1× and 2× (or a capture at another scale) don't draw each other's out every
  frame.
- **Keyboard lights (done):** Caps, Num, and Scroll Lock on every keyboard.
- **Rounded corners (done):** windows Dashi frames are rounded at the
  Appearance radius (`chrome {radius}`): the bottom corners under Dashi's title
  bar, all four on a unified window, and all four on a window that draws its
  own frame while it is maximized (Fill: its own corners and shadow go then);
  a texture shader on the main surface (render/rounded.rs), so such a surface
  is never scanned out directly.
- **Depth between windows (done, 0.4.0):** the shell's `window-style` look:
  a shadow under each window (deeper on the focused one, cross-faded), a
  hairline just inside its frame, an optional ring outside the focused one's;
  one closed-form pixel shader per side (render/depth/: a Gaussian-blurred
  rounded rectangle by erf on its distance field, no blur pass), cut out
  where the window is, clipped to the window's screen, drawing and damaging
  only the bands around the frame. Full screen windows and clients that draw
  their own shadow get none.
- **Window controls:** 0.1.0's "Shapes": a circle closes, a bar minimizes, a
  rounded square zooms (ume #D0596F, broth #E5B13F, kombu #4A9A7E), gray on an
  unfocused window, lit and the hovered one grown 1.18× under the pointer;
  the same as the shell gives GTK apps (appearance/lib/gtk-css.ts). A unified
  window (dashi-chrome-v1) keeps them in full screen, where they are when
  windowed and working the same (the square, with or without ⌥, leaves full
  screen: the shell's call), since its app keeps their place (`controls`)
  clear in its toolbar; the hidden menu bar is not in their way. A title bar
  goes in full screen, and windows without Dashi's chrome stay edge to edge.
  Wherever a window is drawn small or moving (the overview, a flight to the
  Dock, a Desktop sliding in, the shell's window and Desktop pictures), its
  title bar or lights shrink with it, whole, at the same spot.
- **Modern protocols (done):** fractional scale (each surface hears the
  scale of the screen it is mostly on) and viewporter, single-pixel buffers,
  alpha modifier, content type, cursor-shape, pointer constraints and
  relative pointer, pointer gestures (pinch and hold go to clients; a swipe
  the shell claims goes to it), idle-inhibit (while its surface is on
  screen), keyboard-shortcuts-inhibit (activated at once; ❖ and the built-ins
  stay Dashi's), text-input and input-method (an input method's candidate
  popup goes under the caret, above it near the screen's bottom, kept on
  its screen, for windows and layer surfaces alike; the shell runs the input
  method, `packages/shell/src/input-method.ts`; Metal's fields report their
  caret and take the composition and the commit through mirin's text input,
  and turn text input off in a password field, so the input method never
  sees one; a key the keymap binds, the open launcher's Tab, Home, End, Page
  Up and Page Down among them, is the keymap's even mid-composition, since
  bindings come before the input method's keyboard grab), virtual keyboard
  (the shell's processes only), xdg-toplevel-icon (`window-icon`; off for now: smithay 0.7
  disconnects Chromium for destroying an icon's buffer after the icon),
  xdg-system-bell
  (`bell`), xdg-foreign, ext-image-copy-capture with ext-image-capture-source
  and ext-foreign-toplevel-list (screen and window sharing through newer
  portals; shm buffers, paced to 60 frames a second).
- **Sandboxing (done):** security-context, so a Flatpak app never reaches a
  privileged protocol even though it runs under the shell, nor screencopy
  even if granted to its executable path.
- **Tests:** the headless backend runs IPC and protocol tests in CI without a
  GPU.
- **A greeter mode** for Dashi's own login screen (below).

## Login Screen

0.1.0 borrowed one: SDDM's greeter in Weston's kiosk shell. 0.2.0 has its own:

- **greetd** runs the login: PAM, sessions, the user switch. Dashi does not
  write that part.
- **The greeter** (`packages/greeter`, `@dashi/greeter`) is TypeScript drawn by
  Metal: it talks to greetd's IPC (`$GREETD_SOCK`) and draws `@dashi/ui`'s
  `LoginScreen`, the same component as the lock screen. Done; it runs on
  0.1.0's dashi-comp.
- **dashi-comp in greeter mode** (`dashi-comp --greeter`) shows it with less:
  no Xwayland, no wlr-foreign-toplevel, no screencopy, no data-control.
