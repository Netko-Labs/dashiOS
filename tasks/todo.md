# Dashi 0.2.0

## 1. Monorepo and docs (`feat/monorepo`)

- [x] `shell/` → `packages/shell`, Bun workspace at the root
- [x] `packages/dashi-ui` (`@dashi/ui`): Dashi's own components, palettes,
      glyphs; Dark Mode through an appearance source the host connects
- [x] Session scripts and checkout paths follow the new layout
- [x] `docs/conventions.md`, `CLAUDE.md`/`AGENTS.md`, `docs/architecture.md`,
      `docs/compositor.md`, `docs/compositor-ipc.md`
- [x] VM: install, desktop, ssh, screenshot, type/key, stop (`vm/vm`)
- [ ] `bun run fmt-lint` clean (biome config from mirin; one formatting pass,
      its own commit)
- [ ] Shell tests (`packages/shell/test/`, lost with 0.1.0): parsers first

Acceptance: typecheck clean, every module loads, the shell runs from the
checkout in the VM on 0.1.0's dashi-comp.

## 2. Compositor rewrite (`crates/dashi-comp`)

Milestones C0–C4 in `docs/compositor.md`. Each ends with the shell running on
it in the VM.

- [x] C0: workspace, winit + headless backends, xdg-shell, IPC (`subscribe`,
      `session`, `windows`, window events), `-c` client; 11 tests
- [x] C1a: layer-shell, linux-dmabuf, window requests, `window-placing`,
      `outputs`/`output`, the shell's configuration kept; the real shell runs
      on it nested (`vm/nested-session`)
- [x] C1b: keymap, bindings and ❖, `send-keys`, title bars (`chrome`,
      dashi-chrome-v1, xdg-decoration), cursor, `capture` (shell only)
- [x] C1c: udev backend (DRM/KMS, GBM, libinput, libseat), EDID, hotplug
- [x] C2: wallpapers (pictures, native video, live looks), full screen and
      bars, Spaces, overview, wlr-foreign-toplevel (shell only), idle,
      power, gamma, edges, gestures, outputs-config, drag-to-tile, Dock flights
- [x] C3: Xwayland (X11 windows placed by the shell, title bars, focus,
      move/resize, clipboard and primary selection both ways, restart),
      screencopy with grants, agent seat and `agent-input`, xdg-activation and
      attention, session lock, xdg-dialog, `--greeter`, primary selection,
      ext/wlr-data-control (shell only)
- [ ] C4: explicit sync, VRR/tearing, direct scanout, fractional scale,
      viewporter, presentation time, cursor-shape, ext-image-copy-capture,
      idle-inhibit, shortcuts-inhibit, text-input/IME, toplevel icons,
      security-context, pointer constraints, gestures
- [ ] Until C1, `vm/dev-session` and `vm/dev-greeter` run on the installed
      0.1.0 dashi-comp; switch them to the checkout's when C1 drives screens
- [x] The grabs (from smallvil) no longer `unwrap()` a window's toplevel
- [ ] Dock icons pressed by QMP clicks in the VM don't launch (0.1.0's
      compositor too): shell/Metal side, likely the drag guard (`swallows`)

## 3. Login screen

- [x] `packages/greeter`: greetd IPC, login flow, users, sessions, memory, power
- [x] `@dashi/ui` `LoginScreen`, shared with the lock screen (which now uses it)
- [x] `session/dashi-greeter`; `spin/dashi-greeter/etc/greetd/config.toml`
- [x] In the VM: greetd → greeter → PAM → the chosen session; lock/unlock
- [ ] One surface per screen (multi-monitor)
- [ ] Account pictures (AccountsService) instead of initials
- [ ] Keyboard layout and accessibility on the login screen
- [x] `dashi-comp --greeter` (session/dashi-greeter passes it when supported)

## 4. Packaging 0.2.0

- [ ] RPM specs (lost with 0.1.0): dashi, dashi-comp, dashi-greeter (replaces
      dashi-sddm; requires greetd),
      dashi-release, dashi-logos, dashi-kernel, dashi-nvidia, dashi-helium,
      dashi-live, dashi-bun, mirin-metal-host
- [ ] Build in the VM, install, boot into it
- [ ] Image build (kickstart) and COPR publishing

## Later

- [ ] Move `@dashi/ui` components that duplicate shadcn (Button, TextField,
      SearchField, Segmented, Table, Sheet, PopupMenu, the settings Slider and
      Switch) to `@mirinjs/metal-ui`, styled with Dashi's theme
- [ ] Theme tokens: Dashi's palettes as a metal-ui theme, so metal-ui
      components and `@dashi/ui` paint from the same colors
