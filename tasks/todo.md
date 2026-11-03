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
- [x] A setting for X11 apps that ignore `Xft.dpi`: Displays → Older apps
      (X11), Sharp or Stretched (`appearance.x11Apps`). Stretched puts
      Xwayland back at 1 and X11 apps at 96 dpi. Checked in the VM: the X
      screen 1920×1200 ↔ 1280×800, xrdb, zenity on X11 the right size
- [x] Maximize did nothing after a minimize and restore: a parked window
      stayed "activated" and came back with no configure, so Chromium and
      Electron still thought they were minimized and ignored clicks. Parking
      deactivates; showing sends a configure. Checked in the VM (Helium on
      Wayland: minimize, Dock, maximize; X11: wmctrl toggle/add/remove,
      xdotool minimize). Steam itself not tried in the VM
- [x] X11 `_NET_ACTIVE_WINDOW` (an app asking to be shown, e.g. Steam
      opened again) didn't restore a minimized X11 window: smithay ignores
      it, so a second X connection listens (xwayland/activate.rs). Minimized
      or hidden comes back; a pager's request or one while X11 has the
      keyboard focuses; others want attention. Checked in the VM, all three
- [ ] X11 GTK dialogs show black outside their round corners (zenity on X11
      in the VM): likely no `_NET_WM_CM_S0` owner, so GTK picks no alpha
- [x] ❖C/❖V ignored in Electron, Chromium, GTK, and X11 apps: smithay sends
      a key before its modifiers, so a replayed Ctrl+C arrived as "c"; replays
      press real modifier keys first (keys/replay.rs). Checked in the VM:
      Helium, GTK on Wayland, GTK on X11
- [x] The login screen came up at scale 1 on a HiDPI panel: the greeter
      gives each screen its density scale (`defaultScale`, moved to
      @dashi/ui so both use it). It can't read the person's chosen scale
      (their home), so a laptop set to 1.75 logs in at 2. Checked in the VM:
      the greeter set 1920×1200 to 1.5 on its own
- [x] The pointer looked small: it was the standard 24 points (36 px at
      1.5), GNOME's size. Settings → Appearance → Pointer size (24, 32, 40,
      48; `appearance.pointerSize`) goes to the compositor (IPC
      `cursor-size`, resampled to the exact size at any scale), GTK
      (gsettings `cursor-size`), and X11 (`Xcursor.size`). Checked in the VM
- [x] `space-remove` was unknown to dashi-comp (the shell asked for it 17
      times on the installed system): added (wm/space_list.rs). Checked in the
      VM over IPC: removing the shown Space, the first, and refusing the last
- [x] Apps slow to open: on the NVIDIA + AMD laptop, listing GPUs woke the
      sleeping NVIDIA card first: Vulkan 3.5–7.4 s, EGL (Chromium, Electron)
      2.9 s, against 0.01 s with only the AMD GPU in view. Apps the shell
      starts now see only the screens' GPU (VK_LOADER_DRIVERS_SELECT, Mesa's
      EGL); `PrefersNonDefaultGPU` apps (Steam) get NVIDIA's offload instead
      (gpu-env.ts). Dashi's own apps already limit themselves (mirin gpu.rs).
      Measured with the variables on the host; the VM has one GPU. Programs
      started from Terminal are left alone (prime-run must still work)
- [x] The NVIDIA card ran on nouveau at first boot: the image has the akmod
      but no built module, and akmods built it 30 s into the boot, after
      nouveau took the card. Anaconda now runs finish-install
      (finish-install.ks, added to interactive-defaults.ks at live boot: a
      %post in post-scripts/ never runs on a live install): builds the driver at install on a machine
      with an NVIDIA GPU, removes it on one without. Verified in the VM, both ways
- [x] CachyOS's kernel the only one after install where it boots (x86-64-v3,
      Secure Boot off; `default-kernel --check`): finish-install removes
      Fedora's and remakes the rescue entry. dashi-kernel no longer requires
      kernel-core, dashi-nvidia wants Fedora's headers only beside Fedora's
      kernel. Verified in the VM (boots, rescue is CachyOS's)
- [x] The Dock took clicks across the whole bottom strip (its surface spans
      the screen; Metal can't set an input region): the shell sends the
      panel's bounds (IPC `input-region`) and dashi-comp lets the rest
      through, title bars and click-to-focus included
- [x] Brightness 0 left the Zephyrus G14's OLED faintly lit (amdgpu's
      backlight 0 is the panel's minimum, not off): at 0 the shell holds the
      built-in screen (eDP/LVDS/DSI) dark (IPC `power {on, output}`), and the
      first rise lights it; waking from idle leaves it dark. dashi-comp's
      hold checked in the VM; the shell's side by test/screen-dark.test.ts
- [x] Deleting a Desktop did nothing on 0.2.0: its dashi-comp had no
      `space-remove` (dashi.log: 20 "unknown method"). 0.3.0 has it; checked
      in the VM from Mission Control's ×
- [x] Agent control end to end in the VM (dashi-mcp, consent sheet per
      scope): list_windows, list_apps, type_text (Calculator 12+30= → 42),
      a window screenshot, click with the agent's pointer, focus_window.
      press_keys takes unshifted punctuation only; its error says so now
- [x] Clicks beside a revealed Dock reached the window under it, and its
      icons still work (VM, autohide on, a window to the bottom edge)
- [x] Agents saw T3 Code's window as `app: null`: list_windows named windows
      without hidden (NoDisplay) entries; it uses them now
- [x] Dashi's own installer, on Metal (`apps/installer`, dev.dashi.installer):
      Welcome, disk, account, options (NVIDIA's driver: on when the machine
      has an NVIDIA GPU), a last look, progress, Restart. Its root half is
      dashi-live's `dashi-install` (pkexec, polkit dev.dashi.install; the live
      user needs no password): GPT with EFI 600 MiB, /boot ext4 2 GiB, Btrfs
      root and home (zstd); the live root copied with its labels (the ESP
      without: FAT); fstab, machine-id, hostname, account; kernel-install per
      kernel, shim and GRUB with a stub on the ESP, efibootmgr; finish-install;
      setfiles. Checked in the VM: a real install of the dev VM's system onto
      a second disk (vm/vm's DASHI_VM_EXTRA_DISK), which booted on fresh
      firmware (shim's fallback) to CachyOS's kernel with the account,
      Enforcing and no denials; the app walked through as a practice run
- [ ] The installer from the live ISO itself (the next image), on real
      hardware with NVIDIA; then drop Anaconda from the image
- [ ] Installer: install next to another system, disk encryption, BIOS
- [ ] Verify finish-install through a real Anaconda install of the 0.3.0 ISO
      (the live system boots Fedora's kernel: protect_running_kernel is off).
      The first 0.3.0 ISO's install showed Anaconda's post-scripts/ never ran:
      moved to interactive-defaults.ks
- [ ] Dashi's own installer in place of Anaconda's web UI, with "Install
      NVIDIA's driver" as a checkbox (on when the machine has an NVIDIA GPU);
      it ends with the same finish-install

### Files replaces Nautilus

- [x] Drag and drop: items drag out (the selection when the pressed item is
      in it) to folders, sidebar places, the omnibox's crumbs, the Trash, and
      other apps' windows; drops from anywhere move on one disk and copy
      across disks (⌥/Ctrl copies, ⇧ moves) (drag.ts, drop.ts). mirin's
      `dragFiles`/`onDrop` (74aeade); dashi-comp draws the drag icon.
      Checked in the VM: a tile onto a folder, onto sidebar places
- [x] One omnibox in place of the title, its "N items" line, the search
      field, the search row, and the footer's path bar: crumbs and the
      status line at rest; a path (`/`, `~`) goes, with folder completion;
      anything else searches, scope on a chip (omnibox.tsx). The footer
      shows only jobs and notices. Checked in the VM
- [ ] See the drag icon in the VM (its screenshot can't run mid-drag), and a
      drop into another app (Helium's upload, the Terminal)
- [ ] X11 apps: drags to and from them (smithay's X11Wm doesn't bridge XDND)
- [x] org.freedesktop.FileManager1 from the shell (file-manager.ts): "Show
      in folder" opens Files on each folder with the items selected, Get
      Info for ShowItemProperties (Files `--info`); Files is the default for
      inode/directory and the Dock's Files pin. Checked in the VM with gdbus
- [x] Thumbnails made, not only read (thumbnailer.ts): the system's
      .thumbnailer programs (glycin, GStreamer, libgsf) in bubblewrap, into
      the freedesktop cache with URI and MTime. dashi requires gvfs and
      bubblewrap and recommends the thumbnailers and gvfs-fuse/-mtp/-smb,
      which Nautilus pulled in. Checked in the VM (a 4 MB PNG)
- [ ] Then remove Nautilus from the host (the image has none)

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
