# Architecture

How Dashi's pieces start, what each owns, and how they talk. The rule they
follow is in `docs/conventions.md`: Rust displays; TypeScript decides; the UI
is defined in TypeScript and drawn by mirin Metal.

## Processes

```txt
greetd
├─ dashi-greeter (login)            sh, as the greetd user: the login screen
│  └─ dashi-comp -c '<bun> packages/greeter/src/main.tsx'
│     └─ greeter                    Bun: greetd IPC, LoginScreen drawn by one Metal host
└─ dashi-session (after login)      sh: the session's environment, then exec
   └─ dashi-comp -c '<bun> packages/shell/src/session.ts'
      │                             Rust: Wayland, DRM/KMS, libinput, Xwayland
      └─ session supervisor         Bun: systemd --user/D-Bus activation, restarts the shell
         └─ shell (src/main.tsx)    Bun: menu bar, Dock, sheets, Settings, system services
            ├─ mirin-metal-host ×N  one per shell surface (layer-shell), draws React with GPUI
            └─ apps/<name>/main.tsx Bun, one process per first-party app
               └─ mirin-metal-host  its window
systemd --user (D-Bus activated)
└─ dashi-portal (apps/portal)       Bun: xdg-desktop-portal's backend for Dashi
   └─ mirin-metal-host ×N           one per open dialog, from a warm host

systemd --user
└─ dashi-applet-<id>.service        one per installed applet, started by the shell's launcher
   └─ bin/dashi-applet-run.ts       Bun: the applet's D-Bus proxy, then its sandbox
      ├─ xdg-dbus-proxy             only the bus names and calls its permissions allow
      └─ bwrap → the applet         Bun on its main.js, sandboxed (docs/applets.md)
         └─ mirin-metal-host        its popover (layer-shell, granted while open) or window
```

- **The greeter** (`packages/greeter`, `session/dashi-greeter`) is Dashi's
  login screen: greetd runs it in its own `dashi-comp`; it logs the person in
  through greetd's IPC (PAM stays greetd's), starts the session they pick,
  and ends its compositor so greetd can hand over the screen. 0.1.0 borrowed
  SDDM in Weston's kiosk shell instead.
- **dashi-session** (`session/dashi-session`) sets the environment (toolkits,
  locale, Flatpak exports, the user bus) and replaces itself with the
  compositor. Paths come from where it lives: an install prefix or a checkout.
- **dashi-comp** owns the screens and input and runs the supervisor as its
  Wayland client (`-c`). When it exits, the session is over.
- **The supervisor** (`src/session.ts`, `src/session/`) tells systemd and D-Bus
  the display, starts `dashi-session.target` (and with it
  `graphical-session.target`, which portals need), and restarts the shell when
  it crashes.
- **The shell** (`src/main.tsx`) is the desktop's logic: window placement,
  shortcuts, Spaces, the overview's plan, displays, power, network, Bluetooth,
  sound, notifications, accounts, polkit, Flathub, agents. Its UI is React,
  each surface drawn by its own Metal host.
- **Apps** (`apps/*`) are separate Bun processes on the app kit (`apps/kit`),
  each with a Metal window, a control socket, and menus served to the shell.
  A close from outside (the close control, ❖W, ❖Q, the Dock's Quit, logging
  out: the compositor's `close`, `xdg_toplevel.close`) is a request mirin's
  host hands the app (`MIRIN_METAL_CLOSE=ask`): the kit closes at once unless
  the app answers it (`apps/kit/close.ts`), and an app with something to lose
  holds the window and asks. Log Out, Restart, and Shut Down from the menus
  ask every window to close first and wait for the answers
  (`src/closing-apps.ts`); a hung app is still ended by Force Quit, or by
  going anyway.
- **Applets** (`docs/applets.md`) installed from Software (its Menu bar applets, the Applet Store folded in) run each in
  bubblewrap with only what their manifest asks for, as systemd user units
  outside the shell's processes, so nothing the compositor trusts the shell
  with reaches them; the shell's launcher (`src/applets/launcher.ts`) starts
  and stops them, and listens on a socket of their own.
- **dashi-mcp** (`session/dashi-mcp`) bridges an agent's MCP stdio to the
  session's socket (`$XDG_RUNTIME_DIR/dashi-mcp.sock`); the person at the
  screen consents before an agent sees or does anything. The tools it lists
  are the agents' part of the shell's action registry (`docs/actions.md`).
  Each call runs as that agent (`src/acting.ts`), so a setting it changes
  is listed under its name in Settings' Recently changed, with Undo
  (`src/settings-app/changes/`, kept in
  `$XDG_STATE_HOME/dashi/settings-changes.json`); Settings › Agents lists
  each agent, what it may do, what it did lately, and takes it back.
- **dashi-open** (`session/dashi-open`, `bin/dashi-open.ts`) hands a
  `dashi://` link to the session (`$XDG_RUNTIME_DIR/dashi-links.sock`); the
  shell's `x-scheme-handler/dashi` entry runs it for `xdg-open`. A link never
  runs a destructive action (`docs/actions.md`).
- **dashi-secretd** (`crates/dashi-secretd`, `docs/secrets.md`) is the vault:
  a system service with its own user (`dashi-secret`), socket-activated on
  `/run/dashi-secretd/socket`. The login opens it through PAM
  (`dashi-secretd-pam`, run by `pam_exec`); it refuses every caller in an
  agent's cgroup. **dashi-secret-bridge** (a user unit the supervisor starts)
  serves it to apps as the Secret Service and the portal's Secret; without
  the vault, the supervisor starts gnome-keyring as before.
- **dashi-agent** (`session/dashi-agent`, `src/agents/sandbox.ts`) runs an
  agent in the agent sandbox, a `dashi-agent-*.scope` with bubblewrap, so it
  can use secrets through Dashi but never read them.
- **dashi-dialog** (`session/dashi-dialog`, `apps/dialog`) shows a dialog for
  a shell script, on Zenity's command line, stdin, stdout, and exit status
  (0 OK, 1 Cancel or closed, 5 timed out, 255 an error), so it can stand in
  for `zenity` (Steam's scripts call it). It is an app on the kit
  (`dev.dashi.dialog`), one process per dialog, not in the launcher. It draws
  the message dialogs, `--progress`, `--entry`, `--password`, `--list`,
  `--text-info`, `--scale`, `--calendar`, and `--file-selection` (Files'
  own chooser, `apps/files/chooser/`, as the portal's is); `--forms`,
  `--color-selection`, and `--notification` exit 255 for now.
- **dashi-hardware** (`crates/dashi-hardware`) is Dashi's one privileged
  helper for what a laptop's kernel exposes: firmware attributes, platform
  profiles, the charge limit, fan curves, the keyboard light, cpufreq boost
  and EPP, and AMD's SMU mailbox (the Curve Optimizer). A Rust system-bus
  service (`dev.dashi.Hardware1`), D-Bus activated, root, with a polkit
  action per kind of change. It enforces ranges and decides no policy; the
  shell (`src/power/`, `src/graphics/`) and ASUS Control call it. Its
  contract is `docs/hardware.md`. Graphics switching is cardwire's own
  daemon (`dashi-graphics`), which the shell talks to directly.
- **dashi-share-picker** (`session/dashi-share-picker`,
  `bin/dashi-share-picker.ts`) is xdg-desktop-portal-wlr's `chooser_cmd`
  (`session/xdg-desktop-portal-wlr.conf`, installed as
  `/etc/xdg/xdg-desktop-portal-wlr/Dashi`). When an app asks to share the
  screen, the portal runs it; it asks the shell over
  `$XDG_RUNTIME_DIR/dashi-share.sock`, the shell shows every screen and
  window as a live picture (`src/share-picker/`), and it prints the choice
  as the portal reads it (`Monitor: <output>`, `Window: <toplevel id>`), or
  nothing when the person cancels.
- **dashi-portal** (`session/dashi-portal`, `apps/portal`) is Dashi's
  xdg-desktop-portal backend; see "The portal" below.

## The portal

Apps ask the desktop for files, permissions, Open With, printing, the look,
and keeping the screen awake through xdg-desktop-portal, which hands each
request to a backend. `session/dashi-portals.conf` makes Dashi's the default;
screen capture stays with xdg-desktop-portal-wlr and Secret with
gnome-keyring. xdg-desktop-portal-gtk is not installed.

- **The process.** `dashi-portal` owns `org.freedesktop.impl.portal.desktop.dashi`
  and serves `/org/freedesktop/portal/desktop`. xdg-desktop-portal starts it
  by D-Bus activation (`org.freedesktop.impl.portal.desktop.dashi.service`,
  which starts the `dashi-portal` user unit); `dashi.portal` lists FileChooser,
  Settings, Access, AppChooser, Inhibit, Print, Notification, Account, Email
  and DynamicLauncher. Its bus connection is an `FdService` (`src/shared/dbus/fd-service.ts`:
  a worker thread blocks in `poll` and reads the socket with SCM_RIGHTS),
  because Print's document arrives as a file descriptor, which Bun's own
  sockets drop. The unit is `PartOf=graphical-session.target`, so the
  backend ends with the session, and each session stops any backend still
  running as it starts (`STALE_UNITS`): after an update and a new login, the
  next dialog runs the new code. A checkout's session links the files into
  the user's data folder instead and writes its own unit,
  `dashi-portal-checkout.service`, in `~/.config/systemd/user`
  (`src/session/portal-files.ts`); an installed session removes them.
- **Dialogs** are Metal windows, React through `@mirinjs/metal` as the
  first-party apps are, one host per dialog, taken from a warm host
  (`src/shared/metal/host.ts`) so a dialog opens as fast as a sheet in Dashi's apps.
  Each is a sheet on the window that asked: xdg-desktop-portal passes that
  window as `wayland:HANDLE` (an xdg-foreign export) or `x11:XID`. mirin's
  host can't import a foreign handle itself, so the shell does the
  parenting: before opening the window, dashi-portal tells the shell
  (`dev.dashi.Shell.Portal1.ExpectSheet`, `src/shared/portal-host/protocol.ts`) the
  one-off title it will have; when that window asks to be placed, the shell
  resolves the handle (IPC `window-for-handle`) and attaches the dialog to
  it (IPC `attach`). The compositor keeps a sheet under its parent's title
  bar, above it, on its Space, without a title bar of its own, and gives it
  the keyboard and the presses the parent would get. With no parent the
  dialog is an ordinary window, opened at once: a question from an app with
  no window (Access, Account) does not wait in the menu bar.
- **What is the shell's stays the shell's.** Holds (Inhibit) go to the
  shell's `InhibitStore` (`src/inhibit/`), which idle reads: while an app
  holds, the screens don't blank and the computer doesn't sleep; the
  battery panel lists the holds with Allow Sleep. The shell also serves
  `org.freedesktop.ScreenSaver` for apps that skip the portal. A caller
  that leaves the bus (an app that dies, or dashi-portal) lets go of its
  holds; xdg-desktop-portal closes a dead app's Request, and its hold goes
  with it. "Add to Dock" (DynamicLauncher) pins the launcher
  xdg-desktop-portal writes (`src/portal-host/launchers.ts`).
- **Interfaces.** FileChooser opens on recent files that pass the app's
  filters, with search (LocalSearch, as the launcher's) focused, then
  folders; Settings serves `org.freedesktop.appearance` and the GTK keys from
  Dashi's own settings (Control Center's Dark Mode, settings.json), with
  SettingChanged; Print sends jobs to CUPS over IPP (`apps/portal/print/`);
  Notification goes into Dashi's notification server; Email opens the
  default mail app with the draft.
- **What was answered.** xdg-desktop-portal keeps the answers (Access's
  camera, microphone, location and background, screenshots, the
  wallpaper, notifications, screen shares started again without asking) in
  its permission store (`org.freedesktop.impl.portal.PermissionStore`).
  The shell reads it from login and hears its `Changed` signal, dating each
  grant when it first sees it (`src/privacy/`;
  `$XDG_STATE_HOME/dashi/privacy/seen.json`), and Settings › Privacy &
  Security lists the grants per app with the agents' kept answers and
  `screenSharing.clients`, each taken back on its own (`DeletePermission`).
  The Access sheet's button opens it there, over the links socket
  (`src/shared/links/open-link.ts`).

## Screens and the power source

The compositor runs what it is told; which modes the screens run, and what
changes when the laptop is unplugged, is the shell's.

- **The arrangement** (`src/display-config/`): where each screen sits, what it
  runs and which is the main display are saved per set of connected monitors
  (`~/.config/dashi/displays.json`) and put back when that set is plugged in,
  at login, and when the lid opens or shuts. A new resolution, rotation, or a
  screen turned off is a trial: "Keep these settings?", and without a yes in
  15 seconds the old arrangement comes back.
- **Automatic refresh rate** (`src/display-config/auto-refresh.ts`, the
  decision in `refresh-policy.ts`): the default on a built-in screen that has
  a lower rate at the size it runs. Plugged in it runs its top rate; on
  battery the rate at that size nearest 60 Hz that is not under 59 (60 over
  59.94 when it has both, 59.94 when that is all it has). Only the rate
  changes, never the size or the scale; external screens are never changed.
  It sets the rate at login, when the power source changes and has held for
  5 seconds (so a loose charger doesn't flicker the screen), when Automatic is
  turned on, and after the arrangement is put back. Picking a rate in
  Displays turns it off for that screen (settings.json
  `displays.<name>.refresh: "fixed"`; no key is Automatic). A mode set any
  other way for the session (Displays' resolution, an agent's
  `set_display_mode`) is kept until the power source next changes, and then
  Automatic picks again. Nothing is set while the screens are blanked or the
  session is locked; the change waits until they are back. Its changes are
  saved with the arrangement, so putting the arrangement back doesn't undo
  them.
- **The graphics card** (`src/graphics/policy.ts`): Automatic uses the
  built-in graphics on battery, so the card sleeps, and the card plugged in.
- **The power mode** (`src/power/modes/`): one recipe per mode, a column for
  plugged in and one for battery (`docs/hardware.md`).

Settings › Battery & Power's "On battery" group names what Dashi lowers when
unplugged, the graphics card and the refresh rate, one row each, with a
button to the pane where each is chosen.

## Sound

The shell talks to PipeWire through PipeWire's and WirePlumber's own tools,
separate MIT programs, with structured arguments only; it links nothing.

- **The outputs, inputs and their volumes** (`src/sound/backend.ts`,
  `levels.ts`): `pw-dump` (or `wpctl status`) lists them, `wpctl
  set-default`, `set-volume -l 1.0` and `set-mute` change them. Nothing
  polls: the pages, Control Center's slider and the menu bar's speaker
  (`src/system/store.ts`) follow the session's `pw-dump --monitor` (below),
  so an output added or a volume changed elsewhere shows at once. For a
  moment after a slider sets a volume, only a word that agrees is shown
  (`src/system/volume-follow.ts`). Only where `pw-dump` is missing are the
  pages and the speaker read every 3 s.
- **The apps' sound** (`src/sound/apps/`): one `pw-dump --monitor` for the
  session (`watch.ts`, `pipewireWatch`, shared by everything above), restarted after 1, 2, then 5 s if it exits. It prints
  every object once, then only the objects that change, whole, so the shell
  keeps a map by id (`graph-map.ts`; a metadata update lists only the
  entries that changed, so those are merged, and since one taken away isn't
  listed, that object is read again with `pw-dump <id>`) and parses streams from it
  (`streams.ts`: a stream's client, its links to a device, its Props, the
  "default" metadata's `target.object`). Streams are named as the Dock
  names apps (`identity.ts`, on `src/process-apps/`): a Flatpak by its portal
  id, else the client's process (the socket's pid for a native client, the
  claimed pid for a Pulse one) and its parents, by itself or by its window;
  else its `application.name`. An app no desktop entry names gets the icon
  its stream names (`application.icon_name`) from the icon theme. Settings'
  search finds each app by name, at its row in Sound's Apps card. Dashi's own streams (Settings' level meter,
  the recorder, event sounds) are not rows. One row per app (`rows.ts`);
  `wpctl set-volume`/`set-mute` on each of its streams, and
  `pw-metadata <id> target.object <node.name>` to send it to an output
  (`commands.ts`). WirePlumber remembers each app's volume and mute (per
  `application.name`); Dashi keeps nothing. The store (`store.ts`) feeds
  Control Center's Sound page, Settings › Sound, the menu bar's microphone
  indicator and agents (`get_sound`, `set_app_volume`). On a development
  run the host is read and never written: changes stay in memory.

## Channels

| Between | Channel | Doc |
| --- | --- | --- |
| greeter ↔ greetd | `$GREETD_SOCK`, length-prefixed JSON (greetd-ipc(7)) | `packages/greeter/src/greetd/` |
| shell ↔ dashi-comp | `$XDG_RUNTIME_DIR/dashi-comp.sock`, newline JSON | `docs/compositor-ipc.md` |
| shell/apps ↔ Metal host | mirin's element-tree protocol over the host's pipes | `../mirin/docs/metal.md` |
| Metal host ↔ dashi-comp | Wayland (xdg-shell for windows, layer-shell for shell surfaces) | |
| app ↔ shell, menus | `$XDG_RUNTIME_DIR/dashi-menus.sock` | `src/shared/app-menus/protocol.ts` |
| applet ↔ shell, menu bar extras | `$XDG_RUNTIME_DIR/dashi-applets.sock` (an installed applet: `dashi-applets/<id>/applets.sock`), newline JSON | `docs/applets.md` |
| tray icon ↔ shell | D-Bus session bus: StatusNotifierWatcher/Item, dbusmenu | `src/tray/` |
| app ↔ shell, "Show in folder" | D-Bus session bus: `org.freedesktop.FileManager1` (ShowFolders, ShowItems, ShowItemProperties), answered with Files windows | `src/file-manager.ts` |
| agent ↔ shell | `$XDG_RUNTIME_DIR/dashi-mcp.sock` | `src/agents/` |
| `dashi://` link → shell | `$XDG_RUNTIME_DIR/dashi-links.sock`, one JSON line each way, from `dashi-open` (the `x-scheme-handler/dashi` entry) | `docs/actions.md` |
| share picker ↔ shell | `$XDG_RUNTIME_DIR/dashi-share.sock`, one JSON line each way | `src/share-picker/protocol.ts` |
| shell → permission store | D-Bus session bus: `org.freedesktop.impl.portal.PermissionStore` (Lookup, List, DeletePermission; `Changed`) | `src/privacy/` |
| shell → screen recorder | wf-recorder, spawned while recording (⇧❖5, `record_screen`); allowed screencopy only then (`screencopy-clients`) | `src/recorder/` |
| PAM, bridge, shell ↔ vault | `/run/dashi-secretd/socket`, newline JSON; callers checked by uid and cgroup | `docs/secrets.md` |
| app ↔ vault | D-Bus session bus: `org.freedesktop.secrets`, `org.freedesktop.impl.portal.Secret` (dashi-secret-bridge) | `docs/secrets.md` |
| dashi-agent ↔ shell, token proxy | `$XDG_RUNTIME_DIR/dashi-tokens.sock`, one JSON line each way, held while the agent runs; then the sandbox's CONNECTs on its own `proxy.sock` | `docs/secrets.md` |
| shell ↔ system | D-Bus (NetworkManager, BlueZ, logind, UPower, polkit, portals) | `src/shared/dbus/` |
| shell/applets ↔ dashi-hardware | D-Bus system bus: `dev.dashi.Hardware1` (polkit per method); the shell decides the mode, the helper writes | `docs/hardware.md`, `src/laptop/`, `src/power/modes/` |
| shell ↔ cardwire | D-Bus system bus: `org.opengamingcollective.cardwire` (packaged as dashi-graphics); the shell decides the graphics policy | `docs/hardware.md` (cardwire), `src/graphics/` |
| shell ↔ tuned-ppd | D-Bus system bus, the power-profiles API, on the shell's one kept system-bus connection (`src/system/system-bus.ts`) | `src/system/profiles.ts` |
| kernel log → shell | `journalctl -k -b 0 -f -o json`, followed for a graphics card falling off the bus (Xid 79, pciehp Link Down on its port) | `src/graphics/lost-card.ts` |
| xdg-desktop-portal → dashi-portal | D-Bus session bus: `org.freedesktop.impl.portal.*` at `/org/freedesktop/portal/desktop` | `apps/portal/` |
| dashi-portal → shell | D-Bus session bus: `dev.dashi.Shell.Portal1` at `/dev/dashi/Shell` (holds, sheets, the Dock) | `src/shared/portal-host/protocol.ts` |
| app → shell, keep awake | D-Bus session bus: `org.freedesktop.ScreenSaver` (Inhibit, UnInhibit) | `src/inhibit/screensaver.ts` |
| program → shell, actions | D-Bus session bus: `dev.dashi.Shell.Actions1` at `/dev/dashi/Shell` (List, Describe, Run; a link's consent) | `docs/actions.md`, `src/actions/dbus.ts` |
| shell → GNOME search providers | D-Bus session bus: `org.gnome.Shell.SearchProvider2`, read as the launcher's slow sources (results only) | `src/search-providers/` |

## Installed Layout

| Path | From |
| --- | --- |
| `/usr/bin/dashi-session`, `/usr/bin/dashi-mcp`, `/usr/bin/dashi-agent`, `/usr/bin/dashi-dialog`, `/usr/bin/dashi-open`, `/usr/bin/dashi-share-picker`, `/usr/bin/dashi-portal`, `/usr/bin/dashi-greeter` | `session/` |
| `/etc/xdg/xdg-desktop-portal-wlr/Dashi` | `session/xdg-desktop-portal-wlr.conf` |
| `/usr/share/xdg-desktop-portal/portals/dashi.portal`, `/usr/share/xdg-desktop-portal/dashi-portals.conf` | `session/` |
| `/usr/share/dbus-1/services/org.freedesktop.impl.portal.desktop.dashi.service`, `/usr/lib/systemd/user/dashi-portal.service` | `session/` |
| `/usr/libexec/dashi/dashi-secretd`, `dashi-secretd-pam`, `dashi-secret-bridge` | `crates/dashi-secretd` |
| `/usr/share/dashi/greeter/` | `packages/greeter` (with its `node_modules`) |
| `/etc/greetd/config.toml` | `spin/dashi-greeter/` |
| `/usr/bin/dashi-comp` | `crates/dashi-comp` |
| `/usr/libexec/dashi/dashi-hardware`, `/usr/share/dashi/models/` | `crates/dashi-hardware`, `data/models/` |
| `/usr/share/dashi/shell/` | `packages/shell` (with its `node_modules`, `@dashi/ui` included) |
| `/usr/libexec/dashi/mirin-metal-host` | `../mirin/crates/mirin-metal` |
| `/usr/libexec/dashi/bin/bun` | `dashi-bun` |
| everything else | `spin/<package>/` |
