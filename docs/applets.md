# Applets

An applet is a program's own item in the menu bar's status area, left of
Dashi's battery, network, volume, and Control Center: a timer counting down,
the weather, a VPN switch, a sync status. Dashi shows two kinds of item there
the same way (`packages/shell/src/extras/`):

- **Tray icons**: StatusNotifierItem over D-Bus, what Steam, Discord, Nextcloud,
  and most Linux apps with a tray icon already speak. Dashi hosts the watcher
  (`org.kde.StatusNotifierWatcher`) and reads the items' menus over dbusmenu
  (`src/tray/`). Nothing to do for those apps.
- **Applets**: Dashi's own protocol, described here, for programs written for
  Dashi. An applet's picture is a *glyph* drawn in the menu bar's own ink, so it
  looks like the system's items in Light and Dark Mode, or text, or both.

## The channel

A Unix socket at `$XDG_RUNTIME_DIR/dashi-applets.sock` (mode 0600; only this
user's processes can connect). Newline-delimited JSON, one message per line.
One connection can show up to 8 applets; they go when it closes. The
parsers are `@dashi/applet`'s (`packages/applet/src/protocol.ts`); the shell's
`src/applets/` serves them. What follows first is version 1, which every
applet speaks; version 2 (below) adds a manifest, popovers, and submenus;
version 3, the launcher's commands; version 4, Dashi's power mode; version 5,
tiles in Control Center.

### Applet → shell

```json
{"type":"applet","applet":{"id":"weather","title":"Weather","glyph":"<svg …>…</svg>","label":"21°",
 "tooltip":"Clear, 21°","menu":[{"id":"refresh","label":"Refresh"},{"type":"separator"},{"id":"units","label":"Celsius","checked":true}],
 "click":"menu"}}
{"type":"remove","id":"weather"}
```

An `applet` message says everything about one applet and replaces what was
there under that `id` (send it whole on every change; a clock ticking once a
second is fine).

| Field | | |
| --- | --- | --- |
| `id` | required | Letters, digits, `. _ : -`; up to 64. |
| `title` | required | Who it is (40 characters). |
| `glyph` | one of glyph, icon, label | SVG markup, one `<svg>` element, up to 16 KB, drawn at 16 × 16 in the bar's text color: every fill and stroke becomes the bar's ink (a template, as Dashi's own glyphs). It may not load, link, style, or run anything: no `<image>`, `<use>`, `<a>`, `<script>`, `<style>`, `<foreignObject>`, `href`, `url(…)`, entities, or a doctype. |
| `icon` | | An absolute path to a `.png` or `.svg` file (up to 1 MB), drawn as it is at 16 × 16. A glyph or an icon, not both. |
| `label` | | Text beside the picture, or alone (24 characters). |
| `tooltip` | | Up to 160 characters. |
| `menu` | | Rows, as the app menus' rows (`src/shared/app-menus/protocol.ts`): `{"id","label","enabled"?,"checked"?}` or `{"type":"separator"}`; up to 40. Version 2 adds `{"type":"submenu","label","enabled"?,"items":[…]}`. |
| `click` | | What a primary click does: `"menu"` opens the menu (the default when there is one), `"activate"` sends `activate`. A right-click always opens the menu. |
| `attention` | | `true` marks the item with a dot until it is sent again without it. |

### Shell → applet

```json
{"type":"activate","id":"weather","x":1210,"y":24}
{"type":"select","id":"weather","item":"refresh"}
{"type":"error","message":"applet “weather”: label is longer than 24 characters"}
```

`activate` carries where the click was, in the screen's pixels (the bottom
center of the item), for a window the applet opens near it. `select` names the
chosen row. `error` says why a message was refused; the applet stays as it was.
A line over 64 KB, more than 30 messages in a second, or more than 8 refused
messages ends the connection.

## Version 2

A connection whose first message is `hello` speaks version 2. Anything else
first makes it version 1 for good: its applets work as above, and version 2's
messages are refused.

```json
{"type":"hello","protocol":2,"manifest":{"id":"dev.example.weather","name":"Weather","version":"0.1.0", …},"dev":true}
```

The shell answers `{"type":"welcome","protocol":2}`. `manifest` is the
applet's [applet.json](#appletjson). An installed applet (in the sandbox)
connects on a socket of its own and must say hello first, as exactly what was
installed (same id, version, and permissions); otherwise the connection ends.
`dev: true` (what `dashi-applet dev` sends) puts a small "DEV" badge on the
item; a sandboxed applet is never badged.

### Popovers

```
applet → shell  {"type":"popover","id":"weather","width":280,"height":190}
shell → applet  {"type":"popover","id":"weather","x":1072,"y":32,"width":280,"height":190,"output":"eDP-1","namespace":"dashi.applet.dev.example.weather"}
either way      {"type":"dismiss","id":"weather"}
```

An applet asks for a popover under its item (usually when it hears
`activate`), 120 to 720 points wide and 48 to 900 tall. The shell places it
(`src/applets/placement.ts`): under the menu bar, centered on the item that
was clicked, kept 8 points inside the screen's left, right, and bottom edges,
and no wider or taller than the screen allows (the answer says the size it
got). `x` and `y` are the top-left corner in that screen's own points;
`output` names the screen.

The popover is drawn by the applet's own Metal host, never by the shell: a
layer-shell surface anchored at the screen's top-left with margins `y` and
`x`, on `output`, with `namespace` (`@dashi/applet`'s `popover.tsx` opens it
with mirin's `surface` option, which the Metal host supports), on the
applet's warm host when one is ready (as a view is, under "Commands"). A
screen reader calls it by the applet's name (`MIRIN_METAL_APP_NAME`). The
SDK draws the applet's tree on a solid ground (`PopoverGround`: the card
color, radius 12, clipped), so an applet's own glass tint never lets the
window under it ghost through: a layer surface has no blur behind it. The layer
shell is privileged: the shell grants it to that applet's processes for as
long as the popover is open (`applet-clients`, docs/compositor-ipc.md), and
the placement is sent only once the grant is in place. Under the popover the
shell lays a clear sheet over the rest of the screen; a click there, or on
the item again, makes the shell send `dismiss`. The applet sends `dismiss`
when it closes the popover itself (Esc, a choice made in it). Either way the
grant goes, and the compositor closes any layer surface the applet still
has.

A popover behaves as the shell's own menus do:

- **It takes the keyboard** when it opens (`keyboard: "exclusive"`, as the
  menus' surface does), so Esc and Tab reach it without a click first, and
  a field in it types. The SDK closes it on Esc (`PopoverGround`) and sends
  `dismiss`. A launcher view leaves the keyboard to the launcher, which
  closes it on Esc.
- **One at a time**, with the shell's menus (`src/applets/popovers.ts`): an
  applet's popover opening dismisses the one another applet had open and
  closes a shell menu or panel; a shell menu opening (a title, Control
  Center, the clock, the agents' mark, the battery, ⌃F2) dismisses the
  applet's. One popover per connection, too.

### Submenus

A menu row may be `{"type":"submenu","label":"Units","items":[…]}`, up to
three levels deep; the 40-row limit counts every level, and ids are unique
across all of them. The bar shows a submenu as a heading with its rows
indented under it, as it does a tray item's.

## Version 3: commands

A hello with `"protocol":3` speaks version 3 (a hello's protocol is the
newest the applet speaks; the shell answers with the older of it and its
own, so a newer applet on an older shell stays at 2). Version 3 adds the
launcher's commands: the ones the manifest declares
([applet.json](#appletjson), `commands`), found in the launcher before the
applet has ever run, at `dashi://applet/<applet id>/<command id>`
(docs/actions.md). The shell's side is `src/applets/commands.ts`.

```
shell → applet  {"type":"run","seq":7,"command":"now","args":{}}                        run it
                {"type":"run","seq":8,"command":"city","args":{},"query":"lis"}         a pick command's rows for what is typed
                {"type":"run","seq":9,"command":"city","args":{},"item":"lisbon"}       the row chosen
applet → shell  {"type":"result","seq":7,"text":"21° and clear"}                        a line: the launcher's top row, Return copies it
                {"type":"result","seq":7,"copy":"21°"}                                  put on the clipboard ("Copied")
                {"type":"result","seq":7,"open":"https://example.com/forecast"}         opened: https://, or a dashi:// address (as a link)
                {"type":"result","seq":7,"error":"No signal"}                           why not, said in the field
                {"type":"items","seq":8,"rows":[{"id":"lisbon","title":"Lisbon, now 19°","detail":"clear"}]}
                {"type":"view","seq":10,"height":160}                                   a view command draws its own answer, this tall
shell → applet  {"type":"view","seq":10,"x":416,"y":203,"width":608,"height":160,"output":"eDP-1","namespace":"dashi.applet.dev.example.weather.view"}
either way      {"type":"dismiss","seq":10}                                             the view closed
```

Every run has its own `seq`; an answer to a run the shell didn't send on
that connection is dropped. A result is one of `text` (one line, 2000
characters), `copy` (16 KB), `open`, or `error`. `items` carries up to 20
rows (`id`, `title` up to 80, `detail` up to 80), drawn by the shell:
never applet pixels in the list. A run unanswered after 10 s (rows: 5 s)
is given up.

- **instant** (`"mode":"instant"`): Return runs it; its result is shown,
  copied, or opened.
- **pick**: Return on the command puts a chip with its title in the field
  ("Search Weather"); every keystroke is a `run` with the `query`, and its
  `items` are the rows. Like every source outside the shell, it has 80 ms
  (`src/launcher/budget.ts`): after that the row says "Weather is taking a
  while…", rows that come late still come, and a command late three times
  isn't asked again this session ("Weather isn't answering"). Return on a
  row is a `run` with its `item`. Esc leaves the chip.
- **view**: the applet answers `view` with a height (40 to 400 points). The
  launcher holds that much room where its rows were (whole 40-point rows)
  and says where it is; the applet's own Metal host draws there on a
  layer-shell surface, granted only while it is shown (as a popover's,
  `applet-clients`). Esc, or the launcher closing, sends `dismiss`; the
  applet sends `dismiss` when it closes the view itself. The view draws on
  its first frame: an applet with a popover or a view keeps one Metal host
  started with no window (`@dashi/applet`'s `warm-host.ts`, mirin's deferred
  hosts), started 3 s after the applet and again 1.5 s after each use, and
  opens there. A new host spent a second or two on its GPU context and
  fonts, under the unit's CPU quota, while the launcher's room stayed empty.
  An idle one costs a few megabytes of its own; a host binary without
  deferred hosts gets a new host each time, as before.

A command with `args` asks for them in the field first, one at a time (the
chip names the command, the placeholder the argument), and runs with them
as `args`. They are checked against the manifest before they are sent.

Commands run in the applet's sandbox, as everything it does. A command's
row says whose it is ("Weather" at its right), shows the applet's icon or
a neutral puzzle piece (never Dashi's mark), never ranks above an exact
match of an app's or a setting's name, and a command titled like one of
Dashi's own ("System Settings") reads "Weather › System Settings".

## Version 4: the power mode

A hello with `"protocol":4` from an applet whose manifest asks for
`power.mode` hears Dashi's power mode and may ask for another: Automatic,
or one of the machine's modes. It is the same choice Control Center's
Power Mode page and Settings › Battery make, kept in the same place
(`power.mode` in Dashi's settings, unset for Automatic): the applet asks,
and the shell's mode store (`src/power/modes/store.ts`) decides what is in
effect and applies its recipe, exactly as for a pick in Control Center. The
shell's side is `src/applets/power.ts`; the wire format,
`packages/applet/src/power.ts`.

```
shell → applet  {"type":"power","choice":"automatic","available":["low-power","balanced","performance"],
                 "mode":"performance","automatic":true,"why":"Automatic chose High Performance: plugged in","failed":false}
applet → shell  {"type":"power","choice":"low-power"}
```

The shell sends `power` right after its welcome and again whenever the
state changes (a pick anywhere, the cable, the battery, Fn F5):

| Field | |
| --- | --- |
| `choice` | `automatic`, `low-power`, `balanced`, or `performance`: what the person chose. |
| `available` | The machine's modes, in that order; empty when it has none (no tuned-ppd and no dashi-hardware). |
| `mode` | The mode in effect, or null until the power source is known. |
| `automatic` | Automatic is choosing right now (not a pick, and not Fn F5 holding a mode until the cable changes). |
| `why` | What is in effect and why, one line, as Settings shows it, or null with `mode`. |
| `failed` | The last switch didn't go through everywhere. |

An ask for a mode the machine lacks, from an applet without `power.mode`
(an installed one: as installed), or before the machine's modes are known
is refused with `error`. Setting `platform-profile` through dashi-hardware
still works, and Dashi still takes it as a key press (it holds that mode,
until the cable changes when Automatic is chosen); an applet that wants
Automatic, or wants to read it, uses this instead.

**Feature-detect it.** An older Dashi answers the hello with protocol 3
and never sends `power`; one that doesn't grant it sends nothing either.
`AppletsClient.powerMode` is the state, or null when there is none to use:

```ts
const client = applet.client; // defineApplet's handle
const stop = client.onPowerMode((power) => render(power)); // null: not offered here
if (client.powerMode) client.choosePowerMode("automatic"); // false when not offered, or the machine lacks the mode
```

## Version 5: Control Center

A hello with `"protocol":5` from an applet whose manifest declares
`controls` (and asks for the `controls` permission) puts tiles in Control
Center. They are declared in applet.json, so they are in Control Center's
**Add** list (under the applet's name) before the applet has ever run, and
**Dashi draws them** as its own tiles, in Light and Dark, with the keyboard,
in the sizes they offer and in edit mode. Nothing of the applet's drawing
appears there; it only says each control's state and hears what was
pressed. The shell's side is `src/applets/controls.ts`; the wire format
and the manifest's part, `packages/applet/src/controls.ts`.

```json
"permissions": ["hardware.lighting", "controls"],
"controls": [
  { "id": "lid",  "kind": "toggle", "title": "Lid light", "icon": "assets/controls/lid-light.svg" },
  { "id": "fans", "kind": "choice", "title": "Fans", "choices": ["Quiet", "Auto", "Max"] },
  { "id": "boost", "kind": "slider", "title": "Boost", "min": 0, "max": 100 },
  { "id": "cpu",  "kind": "status", "title": "CPU" }
]
```

| Kind | What it is | Sizes (the first is the one it is added in) | A press |
| --- | --- | --- | --- |
| `toggle` | on or off, with a line under its name (`detail`) | `round`, `wide` | the knob (a round tile: anywhere) toggles; a wide tile's name sends `open` |
| `button` | does one thing | `round`, `wide` | `press` |
| `choice` | one of 2 to 5 `choices` (16 characters each) | `wide`, `round` | the knob steps to the next; the name opens a page of the choices |
| `slider` | a value from `min` to `max` (whole numbers) | `flat`, `tall` | dragging sends `set` |
| `status` | a value to read (`detail`) | `wide`, `round` | `open` |

`id` as an applet's; `title` up to 24 characters; `icon` an `.svg` under
`assets/` (the menu bar glyph's rules: one `<svg>`, nothing that loads,
links or runs), tinted by Dashi; without one, a neutral puzzle piece.
`sizes` narrows the kind's sizes. At most 8 controls.

```
shell → applet  {"type":"controls","shown":["lid","cpu"]}                    after welcome, and when the person changes the layout
applet → shell  {"type":"control","id":"lid","on":true,"detail":"Bounce"}    its state; parts left out stay as they were
                {"type":"control","id":"fans","choice":"Max"}
                {"type":"control","id":"boost","value":40}
                {"type":"control","id":"lid","glyph":"<svg …>…</svg>"}       a glyph in place of the icon
shell → applet  {"type":"control-action","id":"lid","action":"toggle","on":false}
                {"type":"control-action","id":"fans","action":"choose","choice":"Max"}
                {"type":"control-action","id":"boost","action":"set","value":40}
                {"type":"control-action","id":"go","action":"press"}
                {"type":"control-action","id":"cpu","action":"open"}         its name, or a status tile: open the applet
```

- **Checked**: `on` only for a toggle, `choice` only one of its choices,
  `value` only in its range, `detail` up to 40 characters; anything else is
  refused with `error` (and counts toward the refused messages).
- **Spaced**: at most 4 updates a second per control are drawn; one that
  comes sooner waits, and a newer one replaces it. The SDK spaces them too.
- **Not running**: an installed applet's tiles keep the last state they had
  (kept across restarts in `$XDG_STATE_HOME/dashi/applet-controls.json`),
  dimmed, and a press starts the applet again (its unit, if it may run here)
  rather than reaching it. An applet in development has its tiles in Add
  only while it is connected.
- **The permission** `controls` ("Add controls to Control Center" on the
  consent sheet) grants nothing else: a control can only do what the
  applet's other permissions allow. A manifest that declares controls
  without it doesn't parse.

From `defineApplet`, `applet.controls`:

```ts
const stop = applet.controls.on("lid", (action) => action.action === "toggle" && slash.set({ enabled: action.on }));
applet.controls.update("lid", { on: true, detail: "Bounce" });   // false for an id applet.json doesn't declare
applet.controls.onOpen("cpu", () => applet.openPopover());       // with no listener, open opens the popover
applet.controls.shown;                                           // the ids the person has in Control Center now
```

`update` keeps each control's whole state and sends it again on every
welcome (a shell restart), and each declared icon is sent as its glyph once.
Underneath, `AppletsClient.updateControl` and `onControls`; `drawsControls`
says whether the shell speaks 5.

## applet.json

The manifest says who an applet is, when it applies, and what it may touch.
The store lists it from this, the sandbox gives it exactly its permissions,
and the shell checks `hello` against it. `packages/applet/src/manifest.ts` is
the authority; `packages/applet/manifest.schema.json` is the same for editors.

```json
{
  "id": "dev.netko.asus-control",
  "name": "ASUS Control",
  "version": "0.1.0",
  "dashi": ">=0.4",
  "entry": "src/main.tsx",
  "summary": "Fans, power and lights for ROG and TUF laptops.",
  "author": { "name": "Netko Labs", "url": "https://github.com/Netko-Labs" },
  "source": "https://github.com/Netko-Labs/asus-control",
  "categories": ["hardware"],
  "when": { "vendor": "ASUSTeK COMPUTER INC.", "laptop": true },
  "permissions": ["hardware.power", "hardware.lighting", "dbus.system:xyz.ljones.Asusd", "notifications"],
  "screenshots": ["screenshots/popover.png"]
}
```

| Field | | |
| --- | --- | --- |
| `id` | required | Reverse-DNS in lowercase, 64 characters at most. Also its folder's and its systemd unit's name. |
| `name`, `summary` | required | 40 and 80 characters. |
| `version` | required | A semantic version. |
| `dashi` | required | The applet runtime versions it runs on: `>=0.4`, `^0.4`, `~0.4.1`, `0.4` (checked against `@dashi/applet`'s `SDK_VERSION`). |
| `entry` | required | The source file `main.js` is built from. |
| `author` | required | `{name, url?, email?}`. |
| `description`, `license`, `source`, `icon`, `screenshots` | | For the store; paths are inside the applet's folder, `source` is https. |
| `categories` | | Up to 3 of `hardware`, `productivity`, `network`, `status`, `media`, `developer`, `utilities`. |
| `when` | | When it applies: `vendor`, `product`, `board`, `family` (DMI's `sys_vendor`, `product_name`, `board_name`, `product_family`; text or a list, a trailing `*` is a prefix), `laptop` (true or false), `hardware` (names dashi-hardware must report). Every condition given must hold. The store says "fits this machine" from it. |
| `permissions` | | What it may touch (below). None is the default. |
| `commands` | | What it adds to the launcher, up to 16: `{id, title, keywords?, args?, mode}`. `id` as an applet's; `title` 60 characters, sentence case; `keywords` up to 12; `args` up to 4 of `{name, type, title?, required?}` (`name` lowercase, `type` one of `string`, `number`, `boolean`); `mode` one of `instant`, `pick`, `view` ([Version 3](#version-3-commands)). `src/commands.ts` parses them. |
| `controls` | | Its tiles in Control Center, up to 8: `{id, kind, title, icon?, sizes?, choices?, min?, max?}` ([Version 5](#version-5-control-center)); needs the `controls` permission. `src/controls.ts` parses them. |

### Permissions

| Permission | In the consent sheet | What the sandbox gives |
| --- | --- | --- |
| `network` | Use the network | the network namespace, the resolver, the certificates |
| `notifications` | Show notifications | the session bus through `xdg-dbus-proxy`, talking only to `org.freedesktop.Notifications` |
| `hardware.sensors` | Read temperatures, fan speeds and power draw | the system bus through the proxy, calling only dashi-hardware's `Describe`, `Get`, `GetFanCurve`, `CurveOptimizer`, `BootGuard`, `Slash`, and hearing `Changed` |
| `hardware.power` | Change the power mode, battery charge limit and processor boost | the above, and `Set`, `SetMany` |
| `hardware.lighting` | Change the keyboard and lid lights | the above, and `Set`, `SetSlash` |
| `hardware.fans` | Change fan curves (asks for your password) | the above, and `SetFanCurve`, `ResetFanCurves` |
| `hardware.tuning` | Change power limits and undervolt the processor (asks for your password) | the above, and `Set`, `SetMany`, `SetCurveOptimizer`, `ConfirmTuning`, `ClearSavedTuning` |
| `power.mode` | See and choose the power mode, Automatic included | nothing more: the shell answers it on the applets socket ([Version 4](#version-4-the-power-mode)) |
| `controls` | Add controls to Control Center | nothing more: Dashi draws the tiles the manifest declares ([Version 5](#version-5-control-center)) |
| `dbus.system:NAME`, `dbus.session:NAME` | Talk to NAME (known services by their names) | that bus through the proxy, talking only to NAME; `org.freedesktop.DBus`, systemd, logind, polkit, portals, secrets, and `dev.dashi.*` can't be named |
| `files.downloads`, `files.documents`, `files.pictures`, `files.music`, `files.videos`, `files.desktop` (`:read` for read-only) | Read and change files in Downloads (Read files in …) | that folder, at its place in the applet's home |

Hardware is always through dashi-hardware (docs/hardware.md), never sysfs:
its polkit actions still decide (`everyday` for the active session, `tune`
asks for the password), and it clamps every value. The proxy filters by
method, not by knob: an applet with `hardware.lighting` can call `Set` on
any everyday knob; telling them apart needs dashi-hardware to know the
caller's permissions (a later change there).

### The consent sheet

Before an applet runs for the first time, and after an update that asks for
more, Dashi lists its permissions in those words, what it adds to the
launcher ("Adds 3 commands to the launcher"), and what it can't do ("It
can't read your files or use the network."), once
(`src/shared/applet-store/consent-sheet.tsx`, on `@dashi/ui`'s sheet with the applet's icon, who vouches for it, and for an update only what is new up front). Software asks as it gets one; the
shell asks for one that arrived another way (`dashi-applet install`). The
answer is kept in its `install.json`: the permissions' names, and
`launcher.commands` for its commands (`consentNames`, `src/installed.ts`),
so an applet without permissions that adds commands is asked too.

## The sandbox

Each installed applet lives in `~/.local/share/dashi/applets/<id>/` (the
package's files and `install.json`) and keeps its own files in
`~/.local/share/dashi/applet-data/<id>/`. The shell's launcher
(`src/applets/launcher.ts`) runs each one that is allowed, not disabled, and
for this Dashi, as a systemd user unit (`dashi-applet-<id>.service`) outside
the shell's own processes, so the compositor never takes it for the shell.
An applet installed again (an update, or the same version rebuilt: its
`install.json`'s `sha256` changed) has its unit stopped and started on the
new files, once it is allowed.
The unit is held to `CPUQuota=50%`, `MemoryMax=768M` (with its Metal host),
and `Nice=10` (`UNIT_LIMITS`), so one that runs away while it answers the
launcher can't starve the shell or the compositor.
The unit runs `bin/dashi-applet-run.ts`, which starts the D-Bus proxy if the
permissions need one, then bubblewrap with the arguments
`src/applets/sandbox.ts` plans:

- `--unshare-all` (and `--share-net` only for `network`), `--clearenv`,
  `--die-with-parent`, `--new-session`;
- `/usr` read-only, the libraries' and fonts' files in `/etc`, `/dev/dri` and
  `/sys/devices` read-only for the Metal host's GPU, a private `/tmp`;
- the applet's folder read-only at `/app`, its data folder as `$HOME`, the
  Wayland socket, its own applets socket (`/run/applet/socket/applets.sock`,
  `DASHI_APPLETS_SOCKET`), Bun and the Metal host read-only, the shell's Dark
  Mode file read-only;
- with any `hardware.*` permission, `/sys/class/hwmon` and
  `/sys/class/power_supply` read-only (the sensors);
- the proxy's sockets and the folders, as its permissions say; nothing else.

The launcher watches the folder: what the store installs, updates, disables,
or removes is started, restarted, or stopped.

## From TypeScript (Bun): @dashi/applet

`packages/applet` is the SDK. `defineApplet` is an applet as state and what
to show for it; the popover is a React component drawn with `@dashi/ui` and
metal-ui in the applet's own Metal host:

```tsx
import { defineApplet, type PopoverProps } from "@dashi/applet";
import { useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";

function Panel({ state }: PopoverProps<{ celsius: number }>) {
  const colors = useColors();
  return (
    <View style={{ flex: 1, padding: 16, borderRadius: 12, backgroundColor: colors.launcher }}>
      <Text style={{ fontSize: 30, color: colors.text }}>{`${state.celsius}°`}</Text>
    </View>
  );
}

export default defineApplet({
  initial: { celsius: 21 },
  glyph: SUN,
  label: (state) => `${state.celsius}°`,
  menu: () => [{ id: "refresh", label: "Refresh" }],
  onSelect: (item, applet) => item === "refresh" && applet.set({ celsius: 22 }),
  popover: { width: 260, height: 170, component: Panel },
});
```

It finds `applet.json` beside the running file (or `DASHI_APPLET_MANIFEST`),
says hello with it, and sends the whole applet again whenever `set` changes
the state.

Its `commands` answer the manifest's, by id: `run` for an instant one (a
string is a line; `{copy}`, `{open}`, or `{error}` otherwise), `items` and
`choose` for a pick one, `view` for one that draws its answer itself. What
`dashi-applet new weather` writes has one of each:

```tsx
commands: {
  now: { run: (_args, applet) => `${shown(applet.state)} and clear` },
  city: {
    items: (query) => CITIES.filter((city) => city.name.toLowerCase().startsWith(query.toLowerCase()))
      .map((city) => ({ id: city.id, title: `${city.name}, now ${city.celsius}°`, detail: city.sky })),
    choose: (item) => ({ copy: describe(item) }),
  },
  glance: { view: { height: 160, component: Glance } },
},
```

with, in applet.json:

```json
"commands": [
  { "id": "now", "title": "Weather now", "keywords": ["temperature"], "mode": "instant" },
  { "id": "city", "title": "Weather in a city", "keywords": ["forecast"], "mode": "pick" },
  { "id": "glance", "title": "Weather at a glance", "keywords": ["today"], "mode": "view" }
]
```

Underneath, `AppletsClient.onCommands` hears `run`, and `result`, `items`,
`requestView`, and `dismissView` answer it, once the shell's welcome says
protocol 3. Underneath is `AppletsClient` (`src/client.ts`): one connection,
each applet sent whole on change, reconnecting when the shell restarts (and
saying hello again; an open popover is dismissed), typed messages both ways.
The app kit's `appletsClient()` (`packages/shell/apps/kit/applet.ts`) is the
same client without a manifest, version 1, for first-party apps:

```ts
import { appletsClient } from "../kit/index.ts";

const TIMER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="9" r="5.5" fill="none" stroke="#000" stroke-width="1.5"/><path d="M8 6v3l2 1.5M6.5 1.5h3" fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round"/></svg>`;
const applets = appletsClient();
let left = 300;
const show = () =>
  applets.show(
    { id: "timer", title: "Timer", glyph: TIMER, label: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`, menu: [{ id: "stop", label: "Stop Timer" }] },
    { onSelect: (item) => item === "stop" && process.exit(0) },
  );
show();
setInterval(() => {
  left -= 1;
  show();
}, 1000);
```

## From anything else

Any language that can open a Unix socket can be an applet. Python:

```python
import json, os, socket

sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
sock.connect(os.path.join(os.environ["XDG_RUNTIME_DIR"], "dashi-applets.sock"))
send = lambda message: sock.sendall((json.dumps(message) + "\n").encode())
send({"type": "applet", "applet": {"id": "vpn", "title": "VPN", "label": "VPN",
      "menu": [{"id": "on", "label": "Connected", "checked": True}, {"id": "quit", "label": "Quit"}]}})
for line in sock.makefile():
    message = json.loads(line)
    if message["type"] == "select" and message["item"] == "quit":
        break
```

## The dev loop

`dashi-applet` (`packages/applet/src/cli/main.ts`):

```sh
dashi-applet new weather        # weather/: applet.json, package.json, src/main.tsx (a glyph, a menu, a popover, three launcher commands)
cd weather && bun install
bun run dev                     # in the menu bar with a "dev" badge; the message log; reload on save
bun run dev -- --vm             # the same in Dashi's VM (vm/vm ssh; the VM sees ~/Developer at /mnt/developer)
bun run pack                    # dist/dev.example.weather-0.1.0.dashi-applet, its size and sha256
dashi-applet install dist/…     # install it here, unsigned, to try it in the sandbox (Dashi asks first)
bun run publish                 # the pull request to the catalog, prepared in a local checkout; never pushed
```

`dev` runs the applet from source, not sandboxed (it is the developer's own
code). The log reads like this:

```
  18:40:01 hello as dev.example.weather 0.1.0
  18:40:01 ✓ connected (protocol 5)
  18:40:01 ✓ “Weather” in the menu bar (dev)
  18:40:02 select refresh
  18:40:09 popover asked 260×170
  18:40:09 popover open 260×170 at 1100,32 on eDP-1
  18:40:15 run city #4 for “lis”
  18:40:15 #4 → 1 rows
  18:40:16 run city #5 chose lisbon
  18:40:16 #5 → copy: Lisbon: 19°, clear
```

An applet in development that isn't installed has its commands in the
launcher while `dev` runs (from its own applet.json, without a consent
sheet: it is the developer's own code).

When the shell goes (a session or shell restart), the applet waits and
connects again, saying hello and sending its items anew: `defineApplet`'s
client keeps the process running while it waits (`keepAlive`), and tries
again while the socket is missing (0.5 s, then longer, up to 15 s). If the
applet's process ends anyway (an error), `dev` says so ("✗ the applet
stopped …") and starts it again on the next save.

To click it in the VM with the real pointer, use `vm/agent pointer X Y`
(or `pointer` lines in a `vm/agent batch`), at a screenshot's pixels. The
menu bar has the agents' mark in it only while an agent is connected, and
every `vm/agent` run connects one, so a screenshot shows the status items
one place left of where they are once it ends: a bare QMP click
(`vm/qmp.py click`) made at a screenshot's place lands one item off, and
on the newest applet (the leftmost) it hits empty bar and nothing happens.

`publish` packs and checks the signature against `author.pub` in the
applet's folder, needs a clean git tree with an `origin`, and in a checkout
of the catalog (`--catalog DIR`, else `../dashi-applets`) makes the branch
`publish/<id>-<version>` with the applet's folder (below) and one commit. It
prints the `git push` and `gh pr create` to run.

## Packages

A `.dashi-applet` is a gzipped tar of `applet.json`, `main.js` (the entry
and all it imports, bundled by `bun build --target=bun`), `build.json`
(`{"bun", "sdk"}`: what built it) and `assets/…`. Nothing else is allowed in
one, nor links, nor paths outside it. Packing is reproducible: sorted names,
mode 0644, owner 0, time 0, so the same source and Bun make the same bytes,
which is how the catalog checks a package is its source.

## The catalog

Dashi's applets install from one repository, Netko-Labs/dashi-applets: one
folder per applet, the review is the pull request, the packages are release
assets, and CI builds the index. No server. Other catalogs (a team's, a
fork, your own) are the same index format signed with their own key, added
in Software ([Catalogs](#catalogs)).

```
applets/<id>/applet.json            the manifest
applets/<id>/source.json            {"url": "https://github.com/…", "commit": "<40 hex>"}
applets/<id>/author.pub             the author's minisign key; set by the first pull request, never changed
applets/<id>/versions/<v>.json      {"sha256", "size", "released", "bun"}: the package the author built and signed, and its Bun
applets/<id>/versions/<v>.minisig   the author's signature on it
applets/<id>/screenshots/…
applets/<id>/review.json            {"reviewed": true, "by": "…"}: maintainers only
applets/<id>/pulled.json            [{"version", "reason"}]: maintainers only, the kill switch
```

CI on a pull request validates the manifest, rebuilds each new version from
its source at the pinned commit with the catalog's Bun (a version built with another is refused), refuses it
unless the bytes match `versions/<v>.json`, and checks the signature against
`author.pub` (and that `author.pub` didn't change). On merge it uploads
`<id>-<version>.dashi-applet` and its `.minisig` to the release
`<id>-<version>`, builds `index.json` from every folder, signs it with
Dashi's key, and publishes both on the `index` branch.

### index.json (format 1)

```json
{
  "format": 1,
  "generated": "2026-11-05T00:00:00Z",
  "applets": [{
    "manifest": { "id": "dev.netko.asus-control", "…": "the newest version's applet.json" },
    "authorKey": "RWQ…",
    "reviewed": true,
    "source": { "url": "https://github.com/Netko-Labs/asus-control", "commit": "…" },
    "icon": "https://raw.githubusercontent.com/…/icon.svg",
    "screenshots": ["https://raw.githubusercontent.com/…/popover.png"],
    "versions": [{
      "version": "0.1.0", "dashi": ">=0.4", "released": "2026-11-04",
      "url": "https://github.com/Netko-Labs/dashi-applets/releases/download/dev.netko.asus-control-0.1.0/dev.netko.asus-control-0.1.0.dashi-applet",
      "sha256": "…", "size": 217088,
      "signature": "untrusted comment: …\nRUQ…\ntrusted comment: dashi-applet dev.netko.asus-control 0.1.0 sha256:…\n…\n"
    }],
    "pulled": [{ "version": "0.0.9", "reason": "Drains the battery on the GA402" }]
  }]
}
```

`index.json.minisig` beside it is Dashi's signature. The checks before
anything runs (`packages/applet/src/catalog.ts`): the index is signed by
its catalog's key (Dashi's for Dashi's); the package has the size and sha256 the index lists; it is
signed by the author key the index lists; an update's author key is the one
the installed version was verified with, and it comes from the catalog the
installed version came from; a pulled version is never
installed, and where it is installed it is turned off (by the store, and by
the shell's look at each catalog's index a few minutes after login and daily,
`src/applet-store/kill-switch.ts`) and the store offers the newest good one.

**One entry at a time.** The signature is checked over the whole index
first: one that doesn't check refuses all of it. Then each applet's entry is
read on its own (`parseIndex`'s `skipped`). An entry this Dashi can't read (a
permission or a field from a newer Dashi, or a mistake) is left out of the
list, is never installable, and is logged with its id and why
(`dashi-shell: <index>: skipped <id>: <reason>`); the rest are listed. Under
the list the store says how many it left out, once each, quietly: "1 applet
needs a newer Dashi". The kill switch still reaches a skipped entry: its
`pulled` list is read alone. An id listed twice is skipped both times. The
top of the index (`format`, `generated`, `applets`) is still read whole: a
new top-level field is a new `format`. So an index can list an applet only a
newer Dashi reads without hiding the others from 0.5 on; Dashi 0.4 refuses
such an index whole (and keeps its last good copy).

**Installed, but no longer readable.** An installed applet whose
`applet.json` doesn't parse any more (or doesn't match its `install.json`)
never runs; the store lists it on Installed as "Needs an update", with
Remove… (`scanInstalled`'s `unreadable`). An update from the catalog it came
from, signed with the key its `install.json` names, mends it, and what was
allowed stays allowed; with `install.json` damaged too, nothing says which
key may update it, so only Remove… is left.

### Keys

Signatures are Ed25519 in minisign's format (`packages/applet/src/signing/`
checks them; signing with real keys is the `minisign` tool's).

- **Dashi's index key**: made once with `minisign -G` (encrypted with a
  passphrase), kept offline by the maintainers. Its public half is in the
  store (`packages/shell/src/shared/applet-store/keys.ts`, read by Software); its secret half, with the
  passphrase, is the catalog's GitHub Actions secrets `DASHI_INDEX_KEY` and
  `DASHI_INDEX_KEY_PASSWORD`, used only by the job that signs the index on
  `main`. Rotating it is a Dashi update that ships the new public key beside
  the old until every index is signed with the new one. It was made on
  2026-11-07: key id 0316A9AD4F0EF2CF, in `keys.ts` and the catalog's
  `keys/dashi-index.pub`. `DASHI_APPLETS_KEY` and `DASHI_APPLETS_INDEX`
  point Dashi's catalog at a test catalog.
- **Another catalog's key**: its maintainers' own minisign key; the person
  pastes its public half (the `.pub` file or its line) when they add the
  catalog.
- **An author's key**: made with `minisign -G -p author.pub`, the public half
  committed in the applet's repository, the secret half the author's alone.
  Every update must be signed with it: a lost key means a new applet id.
- **Throwaway keys** (`dashi-applet keygen`, `generateKeys()`) are
  unencrypted and for tests and trying things only. No secret key is ever
  committed: the tests make theirs when they run.

### Catalogs

Software reads more than one catalog: Dashi's, built in, always first, and
never removed or edited (`DASHI_APPLETS_INDEX` and `DASHI_APPLETS_KEY` still
stand in for it); and the ones the person added. Menu bar applets' toolbar
has **Catalogs…**: a sheet listing them (Dashi's marked built in, the others
with Remove…) and **Add Catalog…**: a name, the index's address, and its
public key.

A catalog is `{name, url, key}`: `url` is its `index.json` (https, no port or
user; file:// for tests and checks), `key` its minisign public key's line.
The added ones are kept in `~/.config/dashi/settings.json`, written through
the settings store (`src/settings-app/store.ts`, section `applets`):

```json
{ "applets": { "catalogs": [{ "name": "Team Applets", "url": "https://applets.example.com/index.json", "key": "RWQ…" }] } }
```

and read as untrusted, entry by entry (`src/shared/applet-store/catalogs.ts`,
`parseCatalogs`): a bad entry, a second one with the same address, Dashi's
own address, and any past the 16th are left out (the shell logs why).

- **Adding** fetches the index and its `.minisig` and checks them with the
  key given before anything is saved. One that doesn't check isn't added,
  and the sheet says why in people's words ("That catalog isn’t signed with
  this key…", "Dashi couldn’t reach that address…", "There’s no applet
  catalog at that address."). An address already in the list is refused.
- **Hosts**: a catalog's index, packages, icons and screenshots come from
  Dashi's hosts (`CATALOG_HOSTS`) or its index's own host, https only
  (`hostsFor`, `allowedFor`). A version, icon, or screenshot elsewhere is left
  out of the list (an applet with no version left, entirely); a local
  package only from a catalog that is itself a local file.
- **Listing** merges every catalog's applets (`src/shared/applet-store/merge.ts`).
  Each remembers its catalog; one from an added catalog says "From <name>" on
  its row and page and is never shown as reviewed: Dashi's review mark is
  Dashi's catalog's alone. The same id in two catalogs: Dashi's wins in the
  list (then the one added first), except that an installed applet is listed
  from the catalog it came from.
- **Installing** records the catalog (its index address) in `install.json`
  as `catalog`, beside the author key it was verified with; a record from
  before has none and means Dashi's. Updates come only from that catalog, and
  only signed with that key; the same id in another catalog is "installed",
  never an update. Removing a catalog doesn't uninstall its applets: they
  read "catalog removed" and get no updates.
- **The kill switch** looks at the index of each catalog something was
  installed from and turns off only that catalog's pulled versions of the
  applets that came from it.

Every other check stands for every catalog: the index signed by its
catalog's key, the package's size and sha256, the author's signature, the
author key pinned across updates, pulled versions refused.

## Design

- One item, one purpose: the menu bar is shared. Prefer a glyph to a picture,
  and a short label (a number, a time) to words.
- Draw glyphs on a 16 × 16 grid with 1.5 strokes and round caps, like
  `src/glyphs.ts`; give fills and strokes any color (it is replaced).
- Use `attention` for something the person must act on, not for news; a
  notification is for news.

## Limits today

- Applet submenus and a tray item's show as a heading with their rows
  indented under it (the bar's dropdown has one level).
- Tooltips are kept but not drawn yet (Metal has no tooltip).
- A middle click on a tray icon (SecondaryActivate) is not sent yet.
- XEmbed tray icons (old X11 apps) are not shown; StatusNotifierItem only.
- An applet can't hide a control it declared: one that doesn't apply on
  this machine says so in its `detail` ("Not on this lid").
- A slider and a status can't show a line of history yet (proposed: a
  `spark` of the last 30 minutes on a large tile).
- The D-Bus proxy filters hardware calls by method, not by knob (above).
- A command isn't an MCP tool for agents yet (`agents: true` in a command,
  proposed): applets' commands are the person's.
- A view takes no keys: the launcher keeps the keyboard (Esc goes back); it
  is for showing, and its pointer.
