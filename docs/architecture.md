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
- **dashi-mcp** (`session/dashi-mcp`) bridges an agent's MCP stdio to the
  session's socket (`$XDG_RUNTIME_DIR/dashi-mcp.sock`); the person at the
  screen consents before an agent sees or does anything.
- **dashi-dialog** (`session/dashi-dialog`, `apps/dialog`) shows a dialog for
  a shell script, on Zenity's command line, stdin, stdout, and exit status
  (0 OK, 1 Cancel or closed, 5 timed out, 255 an error), so it can stand in
  for `zenity` (Steam's scripts call it). It is an app on the kit
  (`dev.dashi.dialog`), one process per dialog, not in the launcher. It draws
  the message dialogs, `--progress`, `--entry`, `--password`, `--list`,
  `--text-info`, `--scale`, and `--calendar`; `--file-selection`, `--forms`,
  `--color-selection`, and `--notification` exit 255 for now.
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
  and DynamicLauncher. Its bus connection is an `FdService` (`src/dbus/fd-service.ts`:
  a worker thread blocks in `poll` and reads the socket with SCM_RIGHTS),
  because Print's document arrives as a file descriptor, which Bun's own
  sockets drop. A checkout's session links the files into the user's data
  folder instead (`src/session/portal-files.ts`).
- **Dialogs** are Metal windows, React through `@mirinjs/metal` as the
  first-party apps are, one host per dialog, taken from a warm host
  (`src/warm-host.ts`) so a dialog opens as fast as a sheet in Dashi's apps.
  Each is a sheet on the window that asked: xdg-desktop-portal passes that
  window as `wayland:HANDLE` (an xdg-foreign export) or `x11:XID`. mirin's
  host can't import a foreign handle itself, so the shell does the
  parenting: before opening the window, dashi-portal tells the shell
  (`dev.dashi.Shell.Portal1.ExpectSheet`, `src/portal-host/protocol.ts`) the
  one-off title it will have; when that window asks to be placed, the shell
  resolves the handle (IPC `window-for-handle`) and attaches the dialog to
  it (IPC `attach`). The compositor keeps a sheet under its parent's title
  bar, above it, on its Space, without a title bar of its own, and gives it
  the keyboard and the presses the parent would get. With no parent the
  dialog is an ordinary window; a question from an app with no window
  waits as a menu bar item (an applet) that opens it.
- **What is the shell's stays the shell's.** Holds (Inhibit) go to the
  shell's `InhibitStore` (`src/inhibit/`), which idle reads: while an app
  holds, the screens don't blank and the computer doesn't sleep; the
  battery menu lists the holds with Allow Sleep. The shell also serves
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

## Channels

| Between | Channel | Doc |
| --- | --- | --- |
| greeter ↔ greetd | `$GREETD_SOCK`, length-prefixed JSON (greetd-ipc(7)) | `packages/greeter/src/greetd/` |
| shell ↔ dashi-comp | `$XDG_RUNTIME_DIR/dashi-comp.sock`, newline JSON | `docs/compositor-ipc.md` |
| shell/apps ↔ Metal host | mirin's element-tree protocol over the host's pipes | `../mirin/docs/metal.md` |
| Metal host ↔ dashi-comp | Wayland (xdg-shell for windows, layer-shell for shell surfaces) | |
| app ↔ shell, menus | `$XDG_RUNTIME_DIR/dashi-menus.sock` | `src/app-menus/protocol.ts` |
| applet ↔ shell, menu bar extras | `$XDG_RUNTIME_DIR/dashi-applets.sock`, newline JSON | `docs/applets.md` |
| tray icon ↔ shell | D-Bus session bus: StatusNotifierWatcher/Item, dbusmenu | `src/tray/` |
| app ↔ shell, "Show in folder" | D-Bus session bus: `org.freedesktop.FileManager1` (ShowFolders, ShowItems, ShowItemProperties), answered with Files windows | `src/file-manager.ts` |
| agent ↔ shell | `$XDG_RUNTIME_DIR/dashi-mcp.sock` | `src/agents/` |
| shell → screen recorder | wf-recorder, spawned while recording (⇧❖5, `record_screen`); allowed screencopy only then (`screencopy-clients`) | `src/recorder/` |
| shell ↔ system | D-Bus (NetworkManager, BlueZ, logind, UPower, polkit, portals) | `src/dbus/` |
| xdg-desktop-portal → dashi-portal | D-Bus session bus: `org.freedesktop.impl.portal.*` at `/org/freedesktop/portal/desktop` | `apps/portal/` |
| dashi-portal → shell | D-Bus session bus: `dev.dashi.Shell.Portal1` at `/dev/dashi/Shell` (holds, sheets, the Dock) | `src/portal-host/protocol.ts` |
| app → shell, keep awake | D-Bus session bus: `org.freedesktop.ScreenSaver` (Inhibit, UnInhibit) | `src/inhibit/screensaver.ts` |

## Installed Layout

| Path | From |
| --- | --- |
| `/usr/bin/dashi-session`, `/usr/bin/dashi-mcp`, `/usr/bin/dashi-dialog`, `/usr/bin/dashi-portal`, `/usr/bin/dashi-greeter` | `session/` |
| `/usr/share/xdg-desktop-portal/portals/dashi.portal`, `/usr/share/xdg-desktop-portal/dashi-portals.conf` | `session/` |
| `/usr/share/dbus-1/services/org.freedesktop.impl.portal.desktop.dashi.service`, `/usr/lib/systemd/user/dashi-portal.service` | `session/` |
| `/usr/share/dashi/greeter/` | `packages/greeter` (with its `node_modules`) |
| `/etc/greetd/config.toml` | `spin/dashi-greeter/` |
| `/usr/bin/dashi-comp` | `crates/dashi-comp` |
| `/usr/share/dashi/shell/` | `packages/shell` (with its `node_modules`, `@dashi/ui` included) |
| `/usr/libexec/dashi/mirin-metal-host` | `../mirin/crates/mirin-metal` |
| `/usr/libexec/dashi/bin/bun` | `dashi-bun` |
| everything else | `spin/<package>/` |
