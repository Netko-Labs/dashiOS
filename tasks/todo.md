# Dashi 0.3.0 (`release/0.3.0`)

Found on the first real install of 0.2.0 (a 2880×1800 panel at 1.75, NVIDIA
+ AMD laptop). Each is checked in the VM before the host gets 0.3.0 packages.

- [x] mirin v0.1.0-alpha.28 merged into `feat/metal-linux` (zbus 6 dialogs)
- [x] libheif: Fedora's `libheif-ffmpeg`, not `libheif-freeworld` (held
      libheif security updates back); `dashi-release` obsoletes freeworld
- [x] Apps' own minimize buttons (xdg `set_minimized`, X11 `WM_CHANGE_STATE`)
      were ignored; they park the window like the yellow light
- [x] ❖Tab showed the generic icon for T3 Code: the switcher read entries
      without the hidden (NoDisplay) ones; it uses the Dock's catalog now
- [x] Steam and other X11 apps blurry at fractional scale: Xwayland draws at
      the largest screen scale (`xwayland-scale`), and X11 apps hear `Xft.dpi`
      and `Xcursor.size` through xrdb (xwayland-scale.ts; dashi requires
      xrdb). Checked in the VM at 1.5: X11 Helium the same size, sharp; clicks
      and tooltips land right. Steam itself not tried in the VM
- [ ] A setting for X11 apps that ignore `Xft.dpi` (they draw small now):
      Displays, "X11 apps: sharp / stretched"
- [x] Maximize did nothing after a minimize and restore: a parked window
      stayed "activated" and came back with no configure, so Chromium and
      Electron still thought they were minimized and ignored clicks. Parking
      deactivates; showing sends a configure. Checked in the VM (Helium on
      Wayland: minimize, Dock, maximize; X11: wmctrl toggle/add/remove,
      xdotool minimize). Steam itself not tried in the VM
- [ ] X11 `_NET_ACTIVE_WINDOW` (an app asking to be shown, e.g. Steam
      opened again) doesn't restore a minimized X11 window: smithay has no
      handler for it
- [x] ❖C/❖V ignored in Electron, Chromium, GTK, and X11 apps: smithay sends
      a key before its modifiers, so a replayed Ctrl+C arrived as "c"; replays
      press real modifier keys first (keys/replay.rs). Checked in the VM:
      Helium, GTK on Wayland, GTK on X11
- [x] The login screen came up at scale 1 on a HiDPI panel: the greeter
      gives each screen its density scale (`defaultScale`, moved to
      @dashi/ui so both use it). It can't read the person's chosen scale
      (their home), so a laptop set to 1.75 logs in at 2. Checked in the VM:
      the greeter set 1920×1200 to 1.5 on its own
- [ ] The pointer looks small on a scaled screen (24 px at 1.5): check the
      compositor's cursor size against the scale
- [ ] `space-remove` is unknown to dashi-comp (the shell asks for it)
- [ ] Apps are slow to open the first time after login: measure
- [ ] First boot after install waits ~30 s on akmods building nvidia-kmod
      (once per new kernel): consider building it in the image

# Dashi 0.2.0

## 1. Monorepo and docs (`feat/monorepo`)

- [x] `shell/` → `packages/shell`, Bun workspace at the root
- [x] `packages/dashi-ui` (`@dashi/ui`): Dashi's own components, palettes,
      glyphs; Dark Mode through an appearance source the host connects
- [x] Session scripts and checkout paths follow the new layout
- [x] `docs/conventions.md`, `CLAUDE.md`/`AGENTS.md`, `docs/architecture.md`,
      `docs/compositor.md`, `docs/compositor-ipc.md`
- [x] VM: install, desktop, ssh, screenshot, type/key, stop (`vm/vm`)
- [x] `bun run fmt-lint` clean: biome.jsonc is mirin's rules at 160 columns;
      the format pass is its own commit
- [ ] Shell tests (`packages/shell/test/`, lost with 0.1.0): parsers first
      (started: compositor IPC, display config, warm host)

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
- [x] C4a: fractional scale, viewporter, single-pixel buffer, alpha
      modifier, content type, cursor-shape, pointer constraints and relative
      pointer, pointer gestures, idle-inhibit, shortcuts-inhibit,
      text-input/IME, virtual keyboard, toplevel icons, system bell,
      xdg-foreign, security-context
- [x] C4b: presentation time, explicit sync (and implicit dmabuf waits),
      direct scanout, VRR (shell's choice, Displays pane), keyboard LEDs
- [x] Per-surface dmabuf feedback with scanout tranches (backend/udev/feedback.rs);
      the VM's virtio-gpu never scans a client buffer out, so the scanout
      tranche is unverified there: check on hardware with a full-screen game
- [x] Rounded bottom corners under Dashi's title bars (render/rounded.rs)
- [x] ext-image-copy-capture: screens and windows (grim 1.5 verified, with -T)
- [ ] Tearing control: needs async page flips in smithay's DRM compositor
- [ ] ext-image-copy-capture with dmabuf buffers (shm only now) and cursor
      sessions (refused now: clients paint the cursor in)
- [x] `vm/dev-session` and `vm/dev-greeter` run on the checkout's dashi-comp
      (the greeter in `--greeter` mode); login through it verified in the VM
- [x] The grabs (from smallvil) no longer `unwrap()` a window's toplevel
- [x] The agent seat is opt-in (`DASHI_AGENT_SEAT=1`): as a second wl_seat it
      took GPUI's keyboard (the greeter and every Metal surface stopped typing)
- [x] The launcher took about 3.8 s to show after ❖ (a new Metal host each:
      0.4 s starting, 2.5 s of Vulkan device in the VM, 0.8 s of fonts). The
      shell keeps a warm deferred host (warm-host.ts, mirin `dd637f2`):
      under 0.7 s. An overlay opened within ~5 s of the last still starts cold
- [ ] mirin: load only the UI's fonts (every host loads all system fonts)
- [x] Dock clicks didn't launch: the agent seat again (GPUI took its pointer)

## 3. Login screen

- [x] `packages/greeter`: greetd IPC, login flow, users, sessions, memory, power
- [x] `@dashi/ui` `LoginScreen`, shared with the lock screen (which now uses it)
- [x] `session/dashi-greeter`; `spin/dashi-greeter/etc/greetd/config.toml`
- [x] In the VM: greetd → greeter → PAM → the chosen session; lock/unlock
- [x] One surface per screen: the form on the main screen, a backdrop on the
      others (verify with two heads in the VM)
- [x] Account pictures (AccountsService) instead of initials, greeter and lock
- [x] Keyboard layout on the login screen: dashi-comp starts in the system's
      layout (localed's 00-keyboard.conf); `keyboard` and `input` were missing
      from the new compositor altogether (layouts, repeat, touchpad settings
      silently not applied): implemented
- [ ] Accessibility on the login screen (larger text, a screen reader)
- [x] `dashi-comp --greeter` (session/dashi-greeter passes it when supported)

## 4. Packaging 0.2.0

- [x] RPM specs for dashi, dashi-comp, dashi-greeter (replaces dashi-sddm;
      greetd), dashi-release (0.2 beta); `spin/build-rpms`
- [x] Specs for the packages unchanged since 0.1.0 (built for 0.2.0 too):
      dashi-logos, dashi-kernel, dashi-nvidia, dashi-helium, dashi-live,
      dashi-bun, mirin-metal-host (built from mirin)
- [x] Build in the VM, install, boot into it: 0.1.0 → 0.2.0 upgrade (dashi-sddm
      obsoleted, greetd made the display manager, its stock config replaced),
      the packaged greeter as the greetd user under enforcing SELinux (no
      denials), login, the session on /usr/bin/dashi-comp with Xwayland
- [x] dashi-live for 0.2.0 (it pins dashi's version); autologin through greetd
- [x] Image build: spin/image/dashi-live.ks and spin/build-image (livemedia-creator);
      boots to the desktop on a plain virtio-vga (software rendering)
- [x] COPR publishing: pejedev/dashi builds every package in a clean root;
      dashi.repo enabled
- [ ] Install test of every new image: install to a fresh disk, reboot, Setup
      Assistant with extras, the Terminal, Steam

## 5. System apps and first boot

- [x] Terminal: dashi-term (PTY + libghostty-vt, Ghostty 1.4.0 with Zig 0.17)
      drawn by a Metal app; keys, scrollback, selection, copy/paste, resize
- [x] Text Editor (dev.dashi.editor), Software's Recommended shelf
- [x] dashi-gaming; Setup Assistant extras (codecs, NVIDIA, gaming, Flathub
      and apps) through dashi-extras and pkexec
- [x] Anaconda profile for Dashi (the installer creates the account)
- [ ] mirin: a clipboard API (wl-copy shows up as an app for a moment)
- [ ] mirin: a way to hold a window open to ask (the Editor's unsaved changes)
- [x] mirin: dynamic window titles (`setTitle`; Terminal uses them on the standard bar)
- [ ] mirin: text selection in TextInput
- [x] Menu bar extras: the tray (StatusNotifierItem host + dbusmenu, src/tray/), the applets
      channel (docs/applets.md, src/applets/, apps/kit/applet.ts), the battery menu, plug glyph,
      time left, and the charging HUD
- [x] Battery monitor (src/battery/): a week's history (charge, state, watts) in
      ~/.local/state/dashi, the draw, per-app processor use, insights; Settings' Battery
      Usage (charts, insights, energy by app) and the battery menu's draw and heavy apps
- [ ] Battery monitor: screen-on time, per-app history beyond ten minutes, the GPU's share
- [ ] Extras: tooltips (Metal has none), nested submenus, middle click (SecondaryActivate),
      XEmbed tray icons, Bluetooth device batteries in the battery menu, reordering/hiding extras
- [x] Terminal: tabs (❖T, ❖W closes a tab, ⇧❖[ ⇧❖], ❖1…❖9; one dashi-term each)
- [ ] Terminal: wide-character width check, mouse reporting to programs,
      Kitty graphics, cursor blink, URL detection, preferences
- [ ] A Dashi-native installer front end over Anaconda

## Later

- [ ] Move `@dashi/ui` components that duplicate shadcn (Button, TextField,
      SearchField, Segmented, Table, Sheet, PopupMenu, the settings Slider and
      Switch) to `@mirinjs/metal-ui`, styled with Dashi's theme
- [ ] Theme tokens: Dashi's palettes as a metal-ui theme, so metal-ui
      components and `@dashi/ui` paint from the same colors
