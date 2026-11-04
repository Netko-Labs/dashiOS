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
One connection can show up to 8 applets; they go when it closes.

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
| `menu` | | Rows, as the app menus' rows (`src/app-menus/protocol.ts`): `{"id","label","enabled"?,"checked"?}` or `{"type":"separator"}`; up to 40. |
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

## From TypeScript (Bun)

Dashi's app kit has a client (`packages/shell/apps/kit/applet.ts`) that
connects, sends each applet whole when it changes, reconnects when the shell
restarts, and hands back clicks and chosen rows:

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

## Design

- One item, one purpose: the menu bar is shared. Prefer a glyph to a picture,
  and a short label (a number, a time) to words.
- Draw glyphs on a 16 × 16 grid with 1.5 strokes and round caps, like
  `src/glyphs.ts`; give fills and strokes any color (it is replaced).
- Use `attention` for something the person must act on, not for news; a
  notification is for news.

## Limits today

- Menus are one level: a tray item's submenus show as a heading with their rows
  indented under it.
- Tooltips are kept but not drawn yet (Metal has no tooltip).
- A middle click on a tray icon (SecondaryActivate) is not sent yet.
- XEmbed tray icons (old X11 apps) are not shown; StatusNotifierItem only.
