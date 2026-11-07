# Dashi 0.5.0 (plan)

The plan is `docs/0.5.0.html`: what 0.4.0 left undone, in four waves and a
verification track. Nothing starts until the owner makes the picks at the
page's end. Each area is its own branch, reviewed in the VM on video, as in
0.4.0.

## Picks (made 2026-11-06)
- [x] The order of the waves: as written
- [x] Where the text model lives: mirin's TextInput, a document view on top
- [x] How a close asks: a close request mirin hands to the app
- [x] One file browser: Files' core as a component
- [x] The Applet Store: a section of Software
- [x] Text size: every Dashi window, through @dashi/ui's type scale
- [x] KDE runners: left out until someone asks
- [x] D3cold: off until the next reboot (2026-11-06); the drops came with the card busy, so it isn't the cause

## Wave 1 · Platform foundations
- [ ] mirin text model: caret placement, drag and ⇧ selection, Cut and Copy (L)
- [ ] Focus model: Tab, arrows in groups, a focus ring; KeySink on onKeyDown (L; KB-1, KB-2)
- [ ] The graphics card sleeps: dashi-comp opens the NVIDIA card only while a screen or a buffer needs it (M; found 2026-11-06)
- [ ] Modifiers on onPress (S; PA-10)
- [x] A close that asks: ❖Q and the close control on a busy Terminal (M; PA-4)
- [x] An undo stack in @dashi/ui (M; PA-2)
- [ ] A visibility signal; Activity Monitor stops sampling while hidden (S; PA-15)
- [ ] A settings registry behind every row (M; today `SPOT_ROWS`)
- [ ] Privacy & Security pane: review and revoke (M)
- [ ] Components as the @dashi/ui gallery (M; UI-7)
- [ ] The missing controls: pop-up button, progress, one Slider, one alert frame, menu separators (L; UI-1, UI-2, UI-4, UI-5, PA-5, PA-9)

## Wave 2 · The apps' big ideas
- [x] One file browser everywhere, with Files' keyboard, selection, Replace / Keep Both / Skip, free names, one icon family (L; PA-3, IC-2; `feat/0.5-files`, VM: not yet)
- [ ] Left from the Files and portal roasts: a drag-out selection box (needs mirin to report a scroll view's offset), scrolling the selection into view from the keyboard (the same), Peek through Preview's renderers, a slow second click to rename, per-folder view settings and the window size, shortcuts drawn in `PopupMenu`, a copy's counts and time left, async thumbnails and completions, mount watching instead of `lsblk`, other disks' Trash, editable Favorites, New Window, Extract, Open in Terminal, Copy Path, column widths, a collapsible sidebar; region-aware dates and drops from Files in the chooser; `dashi-dialog`'s `--forms`, `--color-selection`, `--notification`, `--icon`; the portal's other dialogs (print, access, frames, copy, checkboxes, calendar, progress); Calendar's and Settings' typed-path fallback with no portal (M)
- [x] Settings entries with Undo and "Recently changed"; search in the header; Agents as a consent dashboard (M; `feat/0.5-settings-undo`, VM: not yet)
  - Settings: left for later (docs/roast/settings.md, "Where it went"): Appearance's previews over your wallpaper and Auto's times; a "Let agents connect" switch and denied agents; Passwords split from Payments with reveal, copy, edit and search; one `Failure` in @dashi/ui; a View menu of panes, Back and Forward (❖[ ❖]); Setup's Return and Esc; a Dashi name for Night Shift; one "Menu bar" group; slider values, headings and button copies; the rest of the Title Case pass; per-app Notifications, password delay, shortcuts, manual time, renaming the computer; Battery & Power's live value, Charge Now's reason, the lid summary; settings.json written off the shell's thread and an error boundary; Setup's dots, Install as primary, a shorter Agents page
- [x] Software as a trust card, applets folded in; permissions block, daily update check, one queue, the state chip (L; VS-5)
- [x] Activity Monitor app-first: rows by app, an Energy tab (M; CP-6; `feat/0.5-activity`, VM: not yet). Apps by their folder, Flatpak scope or desktop entry (`src/process-apps/`, shared with the battery monitor), helpers folded under them; Energy (% CPU, % GPU from DRM fdinfo, wakeups); the battery menu opens it at the app (`open` on the menus channel); the roast's rest in `docs/roast/activity-monitor.md`
- [x] Calendar's grid as the editor: drag, the clicked occurrence, time zones (L; PA-11; `feat/0.5-calendar`, VM: not yet)
- [x] Notes as a live page; an Edit menu, ❖B and ❖I (L; PA-8; `feat/0.5-notes`, needs mirin's styled-runs patch, VM: not yet)
- [x] Editor's document surface with versioned autosave (L; `feat/0.5-editor`, mirin patch `mirin-editor.patch`: `TextInput` `highlights` and `lineNumbers`; VM: not yet)
  - Left from the Editor roast (docs/roast/editor.md): per-keystroke O(n) passes and the 4 MB cap, the view following the caret, Reopen with Encoding, Replace one at a time and a find row, wrap/tabs/auto-indent/Print/syntax, tabs, a Settings pane
- [ ] Terminal shell integration; tabs in the title bar; a fixed cell grid (M; VS-1, VS-4)
- [ ] Preview's page strip; progress, rotation, Copy, Export, Print, recent files (L; PA-6)
- [ ] Calculator's expression line and tape; a window size that behaves (M; LA-3)
- [x] Wave 1's nits from the VM reviews (11–14): the bar names an Access dialog; log-out asks one app at a time; no stray kombu cell in Terminal; PopUpButton and Slider take the keyboard; the Dock's Quit asks the app's question; "snip" is Screenshot… and the screenshots stay together; ⇧❖5 leaves an agent's recording running; record_screen's real length (S; `fix/0.5-wave1-nits`, VM: not yet)

## Wave 3 · Launcher and agents
- [ ] Agent tools that take arguments, as rows (M)
- [x] The screenshots as rows: Screenshot… (⇧❖5), Screenshot of the Screen (⇧❖3), Screenshot of an Area… (⇧❖4); the keys bind their `dashi://dashi/` addresses (S; `feat/0.5-launcher-screenshot`, VM: not yet)
- [ ] Context chips: "+ this window", "+ selection" (M)
- [ ] The close fade, 120 ms (S)
- [ ] A result's flight to the Dock (M)
- [ ] Tab, Home and End reaching the input method mid-composition (S)
- [ ] A snippet erases its keyword and pastes in one compositor request, so a paste that can't be sent leaves the keyword as typed (S; PR #2 review, expand.ts)
- [ ] Orca's first announcement is the field, not the selected row (S)
- [ ] An applet view's first draw well under 0.7 s (M)
- [ ] Left from 0.4.0: the green control's press-and-hold menu (M), the bottom edge as a drag zone (S), a title-bar menu with Move to (M), Dashi's apps parent their dialogs (M), late prompts blanked for agents (M), errors in people's words (S)

## Wave 4 · The open design rules
- [ ] CO-6: 3:1 control edges (S)
- [ ] UI-6: Enter on a bare Sheet follows the risk (S)
- [x] PA-12: the chooser's drives and real icons; dashi-dialog --file-selection (M; with the file browser, `feat/0.5-files`)
- [ ] CP-7: pane names from the pane list (S)
- [ ] Text size beyond the launcher (M; TY-1)
- [ ] The rest of the tagged rules: CO-2, CO-5, CO-8, TY-1, LA-1, RA-1, DE-1, MO-3, UI-3, KB-4, PA-14, CP-1, CP-3, CP-5 (M)

## Verification (alongside)
- [ ] Real hardware: each mode, charge limit 80 across a reboot, Curve Optimizer under load, fan curves, Integrated on battery, Steam through Xwayland, ASUS Control's panes
- [ ] Live Claude and GPT APIs, with the owner's keys as tokens
- [ ] Codex and OpenCode for real (the 0.4.0 video's OpenCode was a stand-in)
- [ ] Claude Code in the VM (verified only on the laptop)
- [ ] Input methods: a click while composing, password fields
- [ ] D3cold off for the graphics card: waits for the owner's decision
- [ ] Packages: COPR, a rebuilt image, a fresh install with `vm/vm install`

# Dashi 0.4.0 (`release/0.4.0`)

The plan is `docs/plan.html` (built from the recommended options in
`docs/0.4.0.html`). Built overnight on 2026-11-05 in six streams, merged into
`release/0.4.0`. `[x]` means built with tests passing; "VM:" says what was
seen working in the VM, and an item without one hasn't run in a session yet.
Hardware writes (SMU, charge limit, profiles) were never run on the laptop.

After the spec (2026-11-05, up to `1f59d0b`): window management, depth,
full-screen Desktops, the launcher's three waves and the app roasts' first
wave, each reviewed on video in the VM (`~/Developer/dashi-0.4.0-review/`,
01–13). The release page is `docs/0.4.0.html`; what's left is the 0.5.0 plan
above.

## Proposals (`docs/proposals.html`, `docs/betterments.html`)
- [x] Window management: the green control fills (⌥ = full screen), one Fill, ⌃❖ arrows = four halves with chained quarters, ⌃❖↩ / C / R, and the seven tiling bugs found (`feat/0.4-windows`; VM: 01-windows)
- [x] Depth between windows: shadow + hairline by default, accent ring as an Appearance option (`feat/0.4-depth`: IPC `window-style`, render/depth/; VM: 02-depth)
- [x] A full-screen window gets its own Desktop; stoplights kept in full screen and small pictures (`feat/0.4-fullscreen-desktops`, `fix/0.4-stoplights`; VM: 03, 04)
- [x] The roast of every app (`docs/roast/`), wave 1: one chrome row, AA tokens, confirm sheets, tooltips, per-app fixes, one selection look (`feat/0.4-apps-wave1`, `fix/0.4-apps-review`; VM: 07, 08, 09, 11)
- [x] The launcher, waves 1–3: bugs; one registry, ranking, ❖K, answers, a resident launcher; tokens, Ask and plans, clipboard and snippets, extensions, access (VM: 05, 06, 10, 13)
- [x] Answerers: Claude Code, Codex, OpenCode, a local model, Claude and GPT (`feat/0.4-answerers`; VM: 12, OpenCode as a stand-in)
- [x] Input methods in every Metal field (`fix/0.4-ime`, mirin `1cde80e`; VM: 13, Pinyin)
- [ ] The roast's waves 2 and 3, and the launcher's deferred rows: in the 0.5.0 plan
- [x] The design guidelines are one page, `docs/design.html` (brand and Kombu folded in; numbered rules, tagged where the code doesn't follow them yet)

## Packages
- [x] `spin/build-rpms` builds dashi, dashi-comp, dashi-hardware, dashi-secretd, dashi-greeter, dashi-release, dashi-term, dashi-graphics at 0.4.0~beta; a set is in ~/Developer/dashi-0.4.0-rpms (not published to COPR)
- [x] VM: they install over 0.3 and upgrade over an earlier 0.4.0 snapshot; tuned-ppd, the vault's socket, the portal and the bridge come up
- [ ] Publish to COPR, rebuild the image, a fresh install with `vm/vm install`

## 1 · Power base and a lost card
- [x] `dashi-release` requires tuned-ppd (conflicts with power-profiles-daemon)
- [x] Power modes over tuned-ppd's D-Bus API (`src/system/profiles.ts`, one kept system-bus connection)
- [x] The lost-card watch (`src/graphics/lost-card.ts`, `journalctl -k -f -o json`; this laptop's real 11-03/11-04 lines in the tests); `gpu-env.ts` stops offloading to a lost card
- [x] Shutdown can't hang: SIGTERM, 10 s, SIGKILL the exact PIDs, then logind regardless; user units stop in 10 s
- [x] VM: the 0.4.0 packages install over 0.3 (dashi-release pulls tuned-ppd; tuned-ppd active on dashi-balanced; the power-profiles API answers)
- [ ] VM: a fake loss through /dev/kmsg (needs a two-GPU VM or a fake card); shutdown with a stuck FUSE reader
- [ ] D3cold off for the card on the laptop (`d3cold_allowed=0`): waits for a yes

## 2 · dashi-hardware and power in sync
- [x] `crates/dashi-hardware`: system-bus service `dev.dashi.Hardware1`, polkit per method, every knob in docs/hardware.md, fan curves, the SMU (Curve Optimizer, 20-bit encoding, lockdown check), the boot guard and countdown tokens, `--sysfs-root` fake mode
- [x] Model database (`data/models/`, GA403WR) and the G14's captured sysfs (`data/fixtures/ga403wr/`)
- [x] Read-only `dashi-hardware describe` on the laptop: model, fans, hotkeys, every knob with its range
- [x] Packaging: dashi-hardware.spec, tuned profiles dashi-{powersave,balanced,performance} + ppd.conf
- [x] Shell: mode store with plugged/battery columns, both ways (one key press, one change), Automatic, battery health (limit, one full charge, full-by schedule), keys (Fn F5, Fn F4, ROG) with the OSD, ApplySavedTuning at login and wake, the boot-guard notice
- [x] UI: the battery menu as the hub, Control Center's laptop row, Battery & Power / Displays / Keyboard rows
- [x] VM, the shell on a fake G14 (`DASHI_HARDWARE_BUS=session`, `dashi-hardware --sysfs-root … serve`): Control Center's laptop row (mode, keyboard light); a click on the mode writes the whole recipe (both profiles, SPL 55→80 W, EPP); a click on the light 0→3; a profile changed behind Dashi's back (Fn F5) pulls the recipe along (SPL 30 W, EPP power) and the tile follows
- [x] Packaging found in the VM: dashi-hardware and tuned-ppd both owned /etc/tuned/ppd.conf (now a scriptlet); the tuned profiles were outside /usr/lib/tuned/profiles (tuned-ppd refused to start)
- [ ] Laptop (asked first): set each mode, charge limit 80 across a reboot, Curve Optimizer −5 under load then 0, a fan curve and reset; check Fn F5's keysym

## 3 · Graphics switching
- [x] `dashi-graphics.spec` (cardwire from Terra), finish-install adds `bpf` to `lsm=` and installs it on two-GPU machines
- [x] `src/graphics/`: cardwire client, Automatic policy, holders, "Using the Graphics Card", the Graphics tile and pane (MUX), the lost-card state
- [x] cardwire's own battery and external-screen switching turned off by the shell (Config properties), so Automatic is the one decider
- [ ] Laptop: Integrated on battery with the card in D3cold, Hybrid plugged in, Steam through Xwayland

## 4 · Desktops, moving windows, the switcher
- [x] dashi-comp: `space-previews`, `window-thumbnails`, a move grab across `space-switch`, `edge-hold`
- [x] Desktops row opening into pictures, names in place, automatic names; drop on a picture, edge push, carry while switching, Move to in the Window menu
- [x] The switcher: windows per app (live pictures), type to find, Q/H/M/W. VM: the row, live pictures, badges, typing, each action; H or M then ❖ up leaves it put away; recency order fixed (the compositor listed oldest first)
- [x] `dashi-share-picker` as xdg-desktop-portal-wlr's chooser
- [x] VM: Mission Control, the row opening into pictures, rename, drop on a picture, edge push (relative mouse), carry with ⌃2, Move to (agent pictures of the overview were gray: the agents' mask blanked whole frames; fixed)
- [ ] ⌃→ never arrives through QMP in the VM (QEMU), so switching mid-drag was checked with ⌃2
- [x] A dragged window in Mission Control draws over the Desktops row, its pictures, and the menu bar (VM: dropped on Desktop 2)
- [ ] Title-bar right-click menu with Move to (there is no title-bar menu yet)

## 5 · The Dashi portal
- [x] `dashi-portal` (apps/portal), all ten interfaces; sheets parented through xdg-foreign (IPC `window-for-handle`, `attach`)
- [x] Inhibit in the shell plus `org.freedesktop.ScreenSaver`; keep-awake in the battery menu
- [x] `dashi-portals.conf` default=dashi; GTK_USE_PORTAL / GDK_DEBUG; xdg-desktop-portal-gtk dropped from dashi.spec
- [x] VM, packages installed and xdg-desktop-portal-gtk removed: Settings.ReadAll, ScreenSaver.Inhibit, Helium's Open File as a sheet of its window (the shell refused the portal's second connection; fixed)
- [x] VM: Firefox's Open File as a sheet of its window, with its filters as pills
- [ ] VM: a GTK 4 app, a Flatpak, a Qt app; printing to CUPS-PDF; Add to Dock
- [x] A sheet on a window that draws its own bar hangs below its toolbar (`attach {top}`; VM: Firefox)
- [x] Sheets have no shadow: they cast `xl` from the compositor (`window-style`; VM: 02-depth)
- [ ] Dashi's own apps pass no parent window (mirin can't export an xdg-foreign handle), so their dialogs are plain windows
- [ ] Keep-awake on a machine with no battery has nowhere to show

## 6 · Secrets for agents
- [x] `crates/dashi-secretd` (own user, Argon2id + TPM share + XChaCha20-Poly1305, pidfd/cgroup callers, agent scopes refused), `dashi-secret-bridge` (Secret Service + portal Secret), the gnome-keyring import, pam_exec unlock (optional lines)
- [x] `capture-mask` and `input-origin`; agent captures blank secrets; consent counts only the person's press
- [x] `list_logins`, `sign_in`, `fill_code`, `hand_over`; TOTP; Settings › Passwords; 1Password through `op` (tested with a fake `op`)
- [x] Passkeys: a virtual FIDO2 key over uhid in dashi-secretd (unit-tested only)
- [x] `pay` with limits, single-use cards, "Pay for you" never always-allowed
- [x] `dashi-agent`: the agent sandbox (systemd scope + bubblewrap)
- [x] The token proxy (`feat/0.4-vault-tokens`: token items in dashi-secretd, the shell's proxy, Settings › Passwords › Tokens; payment-provider tokens dropped). VM: an Anthropic key saved and named in Settings › Agents (10-launcher-wave3); live APIs untested
- [x] VM, packages installed: the vault made at a password login, `secret-tool` store/lookup, a lookup from a `dashi-agent-*` scope refused; `list_logins` (no secrets) after the scope sheet; `sign_in` on the test site (the person's Allow Once; the page reached /2fa)
- [x] fill_code's sheet ignored the person's Allow Once: it opened under a still pointer, and dashi-comp moved pointer focus only on motion (it now enters what is under the pointer before a press). A call the agent gives up on (`notifications/cancelled`) takes its sheet down; a waiting sheet no longer holds the agent's other calls
- [x] Chromium (Helium) without `--force-renderer-accessibility`: the shell wakes its web tree and places fields by their page. Firefox: its first GetExtents answers nothing (asked again)
- [x] Sheets are solid; the scope sheet fits 1280×720 points (its list scrolls)
- [x] VM, Firefox and Helium: sign_in, fill_code, a passkey made and used (the person's password on dashi-secretd's sheet), `pay` on the checkout; agents' pictures blank the password, code and card fields, and a filled field's blank goes with its page
- [x] A blank for a window's field is painted over windows above it: clipped by the opaque windows in front (VM: Helium's field behind Firefox)
- [x] Firefox's "Securely save this card?" (last four, expiry) and "Save password?" after a fill: the window's popups are blanked a minute after its filled fields were last seen, each for its whole life, and new windows of the app whole (VM: agent pictures blank them, the person's ⇧❖3 shows them)
- [ ] A prompt that opens over ten minutes after a fill (FILLED_MS) isn't blanked; an app that shows a secret in its main window outside a filled field isn't either

## 7 · The applet SDK
- [x] `packages/applet` (`@dashi/applet`), manifest and schema, protocol v2 (hello, popover, dismiss, submenus), layer-shell grants per pid (`applet-clients`), the sandbox (bwrap + xdg-dbus-proxy), `dashi-applet` CLI
- [x] VM: `dashi-applet new weather`, `dev` (DEV badge), its popover under the item, a button in it updating the item, a click outside closing it; `pack`, `install`: running in bubblewrap as its own unit, its popover from inside the sandbox
- [x] One React and one @mirinjs/metal per applet (pack bundles one; dev drops @dashi/ui's nested copies): with two, AppWindow's sidebar ran under the window controls
- [ ] Popover placement at each screen edge; a permission it didn't declare refused
- [ ] The switcher's surface shows a pale haze where the panel doesn't reach (sized for the largest window row)

## 8 · The Applet Store and ASUS Control
- [x] The Applet Store app, signature checks, the kill switch; the catalog at ~/Developer/dashi-applets and ASUS Control at ~/Developer/asus-control (local repositories, no remotes)
- [ ] Dashi's index key (`minisign -G`), the GitHub secrets, creating the two repositories on GitHub
- [x] VM: ASUS Control in dev on the fake G14: the popover (mode, charge limit, lights from the fake tree), a mode picked there followed by the shell, the window's Power pane with the model's recipes; named "ASUS Control" in the menu bar
- [x] VM: the Applet Store on a test catalog (real packages, throwaway keys, file:// URLs): a catalog that doesn't parse, and one signed by another key, are refused with the reason; the list with Reviewed and Installed; Get → the permissions in plain words → ASUS Control installed and running in its sandbox (the consent sheet squeezed the page; fixed); the popover says when there is nothing to read
- [ ] VM: ASUS Control's Fans, Lighting, Advanced panes on the fake G14; an update and a pulled version through the store
- [ ] Laptop: lighting (Slash mode numbers unchecked), sensors, fan curves, a per-core Curve Optimizer search with the boot guard

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
- [x] See the drag icon in the VM: a `record_screen` video of a drag in
      Files shows the file's icon riding under the pointer
- [ ] A drop into another app (Helium's upload, the Terminal)
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
- [x] Then remove Nautilus from the host (the image has none): removed with
      nautilus-extensions; gvfs and the thumbnailers kept (`dnf mark user`)

### dashi-dialog replaces Zenity

- [x] `dashi-dialog` (apps/dialog, session/dashi-dialog): Zenity's command
      line, stdin, stdout, and exit status (0, 1, 5 timeout, 255) for the
      messages (`--info`, `--warning`, `--error`, `--question` with labels,
      `--extra-button`, `--switch`, `--default-cancel`, `--timeout`),
      `--progress` (stdin's numbers, `#` text, `pulsate:`, `--auto-close`,
      `--auto-kill`), `--entry`, `--password`, `--list` (checklist,
      radiolist, `--print-column`, `--separator`), `--text-info`, `--scale`,
      and `--calendar`. Markup is taken out, not drawn (Metal has one style
      per text). Tests: test/dialog-*.test.ts
- [ ] Check each dialog in the VM: the size it opens at, the keys (Enter,
      Esc, arrows), the progress bar from a pipe, Dark Mode
- [ ] `--file-selection` (the portal's FileChooser), `--notification`
      (org.freedesktop.Notifications), `--forms`, `--color-selection`: they
      exit 255 for now
- [ ] A package that provides `/usr/bin/zenity` pointing at it (provides and
      obsoletes zenity), once Steam's scripts are checked against it

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
- [x] mirin: a way to hold a window open to ask (the Editor's unsaved changes; `MIRIN_METAL_CLOSE=ask`)
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
- [x] Terminal: ⌥/❖ arrows and ⌥⌫ in readline's keys (keymap.ts), as on the Mac
- [x] Terminal: Dashi's 16-color palette, light and dark, AA on the ground (apps/terminal/palette.ts),
      programs' own colors honored; ⇧❖W closes the window; closing a busy tab or window asks
- [ ] Terminal and Text Editor: the close control and ❖Q ask too (needs the mirin item above)
- [x] Text Editor: ❖W asks like File › Close, unsaved text kept as it is typed, a window title
      per document, Revert asks (and is one Undo step), the caret stays put on ❖S and after sheets
- [ ] Terminal: wide-character width check, mouse reporting to programs,
      Kitty graphics, cursor blink, URL detection, preferences
- [ ] A Dashi-native installer front end over Anaconda

## Later

- [ ] Move `@dashi/ui` components that duplicate shadcn (Button, TextField,
      SearchField, Segmented, Table, Sheet, PopupMenu, the settings Slider and
      Switch) to `@mirinjs/metal-ui`, styled with Dashi's theme
- [ ] Theme tokens: Dashi's palettes as a metal-ui theme, so metal-ui
      components and `@dashi/ui` paint from the same colors
- [ ] Calendar, after 0.5.0's grid: a VTIMEZONE written for a zone a file had none for;
      Subscribe to a URL; a second alert and travel time; a custom calendar color
      (docs/roast/calendar.md, "Where this went")

### Screen recording and dogfooding the agent integration

- [x] ⇧❖5: the screenshot and recording toolbar, one row (recorder/toolbar.tsx):
      screen, window, area; record the screen or an area, with the microphone;
      the menu bar's stop button with the time (recorder/indicator.tsx); a
      notice when saved (Videos/Screen Recordings), click to open
- [x] wf-recorder (H.264 MP4, VP9 WebM fallback), allowed screencopy only
      while Dashi records; dashi-comp paces copy_with_damage to the refresh
- [x] Agents: `record_screen` (a video, and stills with the pointer through it)
- [x] Agents' ⌥/❖ chords pass the keymap as the person's do (keymap-match.ts):
      ⌥← in a terminal is Esc b, ❖S in Dashi's apps picks the menu item, the
      desktop's own shortcuts (❖Q, ❖Tab) are refused
- [x] The VM driven through Dashi's MCP server: `vm/agent`, `vm/vm mcp`, `.mcp.json`
- [ ] Recording cost: dmabuf screencopy (no CPU readback) and VAAPI encoding;
      the debug compositor uses a whole core at 60 copies a second
- [ ] The consent sheet doesn't fit small screens (640×480: its buttons are
      off screen) and Return doesn't answer it
- [ ] The menu bar's agent pill wraps "Waiting for you" onto two lines
- [ ] After a shell restart in the VM, new Metal windows sometimes don't draw
      (black, or stale until a real key press); a reboot fixes it
