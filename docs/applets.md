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
applet speaks; version 2 (below) adds a manifest, popovers, and submenus.

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
| `menu` | | Rows, as the app menus' rows (`src/app-menus/protocol.ts`): `{"id","label","enabled"?,"checked"?}` or `{"type":"separator"}`; up to 40. Version 2 adds `{"type":"submenu","label","enabled"?,"items":[…]}`. |
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
with mirin's `surface` option, which the Metal host supports). The layer
shell is privileged: the shell grants it to that applet's processes for as
long as the popover is open (`applet-clients`, docs/compositor-ipc.md), and
the placement is sent only once the grant is in place. Under the popover the
shell lays a clear sheet over the rest of the screen; a click there, or on
the item again, makes the shell send `dismiss`. The applet sends `dismiss`
when it closes the popover itself (Esc, a choice made in it). Either way the
grant goes, and the compositor closes any layer surface the applet still
has. One popover per connection at a time.

### Submenus

A menu row may be `{"type":"submenu","label":"Units","items":[…]}`, up to
three levels deep; the 40-row limit counts every level, and ids are unique
across all of them. The bar shows a submenu as a heading with its rows
indented under it, as it does a tray item's.

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

### Permissions

| Permission | In the consent sheet | What the sandbox gives |
| --- | --- | --- |
| `network` | Use the network | the network namespace, the resolver, the certificates |
| `notifications` | Show notifications | the session bus through `xdg-dbus-proxy`, talking only to `org.freedesktop.Notifications` |
| `hardware.sensors` | Read temperatures, fan speeds and power draw | the system bus through the proxy, calling only dashi-hardware's `Describe`, `Get`, `GetFanCurve`, `CurveOptimizer`, `BootGuard`, and hearing `Changed` |
| `hardware.power` | Change the power mode, battery charge limit and processor boost | the above, and `Set`, `SetMany` |
| `hardware.lighting` | Change the keyboard light | the above, and `Set` |
| `hardware.fans` | Change fan curves (asks for your password) | the above, and `SetFanCurve`, `ResetFanCurves` |
| `hardware.tuning` | Change power limits and undervolt the processor (asks for your password) | the above, and `Set`, `SetMany`, `SetCurveOptimizer`, `ConfirmTuning`, `ClearSavedTuning` |
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
more, Dashi lists its permissions in those words, and what it can't do ("It
can't read your files or use the network."), once
(`src/applets/consent-sheet.tsx`). The Applet Store asks as it adds one; the
shell asks for one that arrived another way (`dashi-applet install`). The
answer is kept in its `install.json`.

## The sandbox

Each installed applet lives in `~/.local/share/dashi/applets/<id>/` (the
package's files and `install.json`) and keeps its own files in
`~/.local/share/dashi/applet-data/<id>/`. The shell's launcher
(`src/applets/launcher.ts`) runs each one that is allowed, not disabled, and
for this Dashi, as a systemd user unit (`dashi-applet-<id>.service`) outside
the shell's own processes, so the compositor never takes it for the shell.
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
the state. Underneath is `AppletsClient` (`src/client.ts`): one connection,
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
dashi-applet new weather        # weather/: applet.json, package.json, src/main.tsx (a glyph, a menu, a popover)
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
  18:40:01 ✓ connected (protocol 2)
  18:40:01 ✓ “Weather” in the menu bar (dev)
  18:40:02 select refresh
  18:40:09 popover asked 260×170
  18:40:09 popover open 260×170 at 1100,32 on eDP-1
```

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

Applets install from one repository, Netko-Labs/dashi-applets: one folder per
applet, the review is the pull request, the packages are release assets, and
CI builds the index. No server.

```
applets/<id>/applet.json            the manifest
applets/<id>/source.json            {"url": "https://github.com/…", "commit": "<40 hex>"}
applets/<id>/author.pub             the author's minisign key; set by the first pull request, never changed
applets/<id>/versions/<v>.json      {"sha256", "size", "released"}: the package the author built and signed
applets/<id>/versions/<v>.minisig   the author's signature on it
applets/<id>/screenshots/…
applets/<id>/review.json            {"reviewed": true, "by": "…"}: maintainers only
applets/<id>/pulled.json            [{"version", "reason"}]: maintainers only, the kill switch
```

CI on a pull request validates the manifest, rebuilds each new version from
its source at the pinned commit with the Bun in `build.json`, refuses it
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
Dashi's key; the package has the size and sha256 the index lists; it is
signed by the author key the index lists; an update's author key is the one
the installed version was verified with; a pulled version is never
installed, and where it is installed the store disables it and offers the
newest good one.

### Keys

Signatures are Ed25519 in minisign's format (`packages/applet/src/signing/`
checks them; signing with real keys is the `minisign` tool's).

- **Dashi's index key**: made once with `minisign -G` (encrypted with a
  passphrase), kept offline by the maintainers. Its public half is in the
  Applet Store (`apps/applet-store/keys.ts`); its secret half, with the
  passphrase, is the catalog's GitHub Actions secrets `DASHI_INDEX_KEY` and
  `DASHI_INDEX_KEY_PASSWORD`, used only by the job that signs the index on
  `main`. Rotating it is a Dashi update that ships the new public key beside
  the old until every index is signed with the new one. Until it is made,
  the store has no key and says so (`DASHI_APPLETS_KEY` and
  `DASHI_APPLETS_INDEX` point it at a test catalog).
- **An author's key**: made with `minisign -G -p author.pub`, the public half
  committed in the applet's repository, the secret half the author's alone.
  Every update must be signed with it: a lost key means a new applet id.
- **Throwaway keys** (`dashi-applet keygen`, `generateKeys()`) are
  unencrypted and for tests and trying things only. No secret key is ever
  committed: the tests make theirs when they run.

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
- Control Center tiles from applets (SDK C) wait for Control Center's room rules.
- The D-Bus proxy filters hardware calls by method, not by knob (above).
