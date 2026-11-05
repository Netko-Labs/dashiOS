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
- **dashi-hardware** (`crates/dashi-hardware`) is Dashi's one privileged
  helper for what a laptop's kernel exposes: firmware attributes, platform
  profiles, the charge limit, fan curves, the keyboard light, cpufreq boost
  and EPP, and AMD's SMU mailbox (the Curve Optimizer). A Rust system-bus
  service (`dev.dashi.Hardware1`), D-Bus activated, root, with a polkit
  action per kind of change. It enforces ranges and decides no policy; the
  shell (`src/power/`, `src/graphics/`) and ASUS Control call it. Its
  contract is `docs/hardware.md`. Graphics switching is cardwire's own
  daemon (`dashi-graphics`), which the shell talks to directly.

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
| shell/applets ↔ dashi-hardware | D-Bus system bus: `dev.dashi.Hardware1` (polkit per method); the shell decides the mode, the helper writes | `docs/hardware.md`, `src/laptop/`, `src/power/modes/` |
| shell ↔ cardwire | D-Bus system bus: `org.opengamingcollective.cardwire` (packaged as dashi-graphics); the shell decides the graphics policy | `docs/hardware.md` (cardwire), `src/graphics/` |
| shell ↔ tuned-ppd | D-Bus system bus, the power-profiles API, on the shell's one kept system-bus connection (`src/system/system-bus.ts`) | `src/system/profiles.ts` |
| kernel log → shell | `journalctl -k -b 0 -f -o json`, followed for a graphics card falling off the bus (Xid 79, pciehp Link Down on its port) | `src/graphics/lost-card.ts` |

## Installed Layout

| Path | From |
| --- | --- |
| `/usr/bin/dashi-session`, `/usr/bin/dashi-mcp`, `/usr/bin/dashi-dialog`, `/usr/bin/dashi-greeter` | `session/` |
| `/usr/share/dashi/greeter/` | `packages/greeter` (with its `node_modules`) |
| `/etc/greetd/config.toml` | `spin/dashi-greeter/` |
| `/usr/bin/dashi-comp` | `crates/dashi-comp` |
| `/usr/libexec/dashi/dashi-hardware`, `/usr/share/dashi/models/` | `crates/dashi-hardware`, `data/models/` |
| `/usr/share/dashi/shell/` | `packages/shell` (with its `node_modules`, `@dashi/ui` included) |
| `/usr/libexec/dashi/mirin-metal-host` | `../mirin/crates/mirin-metal` |
| `/usr/libexec/dashi/bin/bun` | `dashi-bun` |
| everything else | `spin/<package>/` |
