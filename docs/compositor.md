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
  them only while an X11 window has the keyboard.
- **Window management mechanics:** `windows.rs`, `layout.rs` (drag-to-tile
  zones), `fullscreen.rs`, `spaces/` (`switch`), `overview/` (`scene`,
  `input`), `motion/` (animations), `grabs/resize_grab.rs`, `title.rs` and
  `controls.rs` (server-side title bars), `cursor.rs`.
- **Session:** `lock.rs`, `idle/` (`protocols`, `ipc`), `keys/` (keymap,
  bindings, ❖ phases), `agent_seat/` (a second seat an agent drives, drawn
  with its own pointer), `capture.rs`, `wallpaper/` (`request`, `live`,
  `tick`), `outputs/` (`config`, `apply`, `place`, `report`, `chrome`).
- **IPC (`ipc/`):** `requests`, `windows`, `outbox`, `dev`.
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
  backend/
    mod.rs          the backend facade the rest of the compositor sees
    udev/           DRM/KMS, GBM, libinput, libseat, hotplug, multi-GPU, gamma,
                    EDID, keyboard lights (keyboards.rs), VRR (vrr.rs)
    winit.rs        nested in another compositor's window
    headless.rs     no screens: IPC and protocol tests
  handlers/         one module per Wayland protocol (or family): compositor,
                    xdg_shell, layer_shell, seat (clipboard, primary selection,
                    data-control), surface (viewporter, fractional scale, ...),
                    pointer (constraints, relative, gestures, cursor-shape),
                    inhibit, text (text-input, input-method, virtual keyboard),
                    security (security-context), sync (explicit and implicit),
                    toplevel_meta (icons, bell), activation (+ dialog, foreign)
  protocols/        protocols smithay lacks: dashi-chrome-v1, wlr-foreign-
                    toplevel, wlr-screencopy, ext-image-copy-capture
                    (image_capture.rs), ext-foreign-toplevel-list
  render/           scene, title bars, cursor, capture, presentation (present.rs),
                    rounded corners (rounded.rs)
  wm/               windows, placement mechanics, frames, fullscreen, spaces, overview, grabs
  input/            keyboard and pointer routing, decorations, constraints, gestures
  keys/             keymap, bindings, ❖ phases
  xwayland/         Xwayland and the X11 window manager
  ipc/              socket, framing, requests
  outputs/          `outputs`, `output`, `outputs-config`, VRR modes
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
  crashed shell leaves the screen locked, not open.
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
- **Presentation time (done):** feedback at the vblank, from DRM's timestamp.
- **Keyboard lights (done):** Caps, Num, and Scroll Lock on every keyboard.
- **Rounded corners (done):** windows Dashi frames are rounded at the
  Appearance radius (`chrome {radius}`): the bottom corners under Dashi's title
  bar, all four on a unified window; a texture shader on the main surface
  (render/rounded.rs), so such a surface is never scanned out directly.
- **Window controls:** 0.1.0's "Shapes": a circle closes, a bar minimizes, a
  rounded square zooms (ume #D0596F, broth #E5B13F, kombu #4A9A7E), gray on an
  unfocused window, lit and the hovered one grown 1.18× under the pointer;
  the same as the shell gives GTK apps (appearance/gtk-css.ts).
- **Modern protocols (done):** fractional scale (each surface hears the
  scale of the screen it is mostly on) and viewporter, single-pixel buffers,
  alpha modifier, content type, cursor-shape, pointer constraints and
  relative pointer, pointer gestures (pinch and hold go to clients; a swipe
  the shell claims goes to it), idle-inhibit (while its surface is on
  screen), keyboard-shortcuts-inhibit (activated at once; ❖ and the built-ins
  stay Dashi's), text-input and input-method, virtual keyboard (the shell's
  processes only), xdg-toplevel-icon (`window-icon`), xdg-system-bell
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
