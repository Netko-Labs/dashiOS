# Platform and extension architect

## The roast

- Nobody but the shell can add anything to the launcher. Its inputs are a fixed set of props (`entries`, `recent`, `findFiles`), and Dashi's whole applet platform, with its signing, sandbox and catalog, adds nothing to it.
- Dashi has four registries of things you can do, and none of them knows about the others: launcher entries, keymap bindings, menu actions and agent tools. An agent can turn on Dark Mode through `set_setting`. You can't, from the launcher.
- The shell already holds the menus of every running app. An agent can choose any of their items without focusing the window. The launcher shows none of them.
- "Every setting has an address" exists only as a proposal in a roast. Today the smallest thing you can address is a pane, and typing "wif" gives you a gear icon called Network, not a Wi-Fi switch.
- Every source the launcher reads runs inside the shell's event loop, synchronously, on the keystroke path. That's fine with two sources. With twenty, typing will stutter.
- Raycast's extension store is its real advantage. Dashi already has a better foundation for one (signed packages, a bubblewrap sandbox, a consent sheet), but none of it reaches the launcher.

## Findings

| # | Severity | What's wrong | Evidence |
|---|---|---|---|
| 1 | P0 | **No extension point.** The launcher takes a closed set of props. The only way to add rows is `registerShellEntry`, which runs in the shell's process, can only *open* something (no arguments, no inline result), and is used only by Settings panes. | `launcher.tsx:29-45`; `apps.ts:164-179`; `settings-app/search.ts:43-48` |
| 2 | P0 | **Four action registries that don't know each other.** (1) Launcher entries, (2) the keymap's `bind` names in a closed `switch`, (3) the menus' `MenuAction` union, (4) the agents' `TOOLS`, which run.ts dispatches through 68 `case`s. One capability gets written up to four times or ends up in only one place. Agents can set Dark Mode, Dock style, volume and scale; the launcher can only open the pane. | `entries.ts:210-247`; `shortcuts.ts:66-84`; `menus/model.ts:33-62`; `agents/tools/registry.ts:48-64`, `agents/run.ts:45`; `agents/tools/settings.ts:23-63` |
| 3 | P1 | **Settings are addressable only down to the pane.** Entry ids are `dev.dashi.settings/<pane>` and `open(pane?)` takes nothing finer. There is no URI scheme: `dashi://` appears nowhere in code. Typing "wif" offers only "Network" (wifi.png). The idea of addressing each setting is written down as a proposal and nothing more. | `settings-app/search.ts:33-35`; `settings-app/start.tsx:31`; grep for `dashi://` finds nothing; `docs/roast/settings.md:110`; `docs/proposals.html:500` |
| 4 | P1 | **App menus are known but never offered.** `AppMenuStore` keeps every process's menus (`byPid`), and `menusFor` answers for any window, focused or not. `menusOf(window)` builds the full menus for any window. Agents use all of this through `list_menus` and `choose_menu_item`. The launcher never asks. | `app-menus/store.ts:24-31,66-73`; `menus/start.tsx:247-262`; `agents/tools/menus.ts:14-58` |
| 5 | P1 | **.desktop Actions are thrown away.** The parser reads only `[Desktop Entry]`, so `[Desktop Action new-private-window]` and similar groups never become rows. These are commands for apps that aren't even running, and the launcher ignores them. | `entries.ts:37-54` (line 43 keeps only `[Desktop Entry]`) |
| 6 | P1 | **Applets can't contribute commands.** `Manifest` has no `commands` field, and the protocol has only `applet`, `remove`, `hello`, `popover` and `dismiss`. The Weather applet is right there in the menu bar ("21°" in set.png), but "weather" in the launcher finds nothing from it. | `packages/applet/src/manifest.ts:35-56`; `docs/applets.md:25-108` |
| 7 | P1 | **Rows jump under the cursor.** App rows are capped at `max(7 − files, 3)`, so when file hits land 120 ms after a keystroke, app rows 4–7 disappear. `selected` is still the same index, now pointing at a different row, so pressing Enter at the wrong moment opens something else. Every async provider added in this design makes it worse. | `launcher.tsx:17-20,65-66,101,103` |
| 8 | P1 | **Providers run on the shell's loop (inferred).** The launcher's tree is rendered by the shell process. Every time it opens, `loadEntries()` makes synchronous `readdirSync`, `readFileSync` and `existsSync` calls over every XDG directory and icon size. Search re-scores every entry on each keystroke. Any provider added the same way would share the loop with the menu bar, the MCP server and D-Bus. | `main.tsx:758-794` (`loadEntries()` at 760); `entries.ts:141-157,222-245,254-273` |
| 9 | P2 | **Rows don't say where they came from.** A Settings pane, the Settings app and the Setup Assistant all look alike: icon and name, nothing else (set.png: seven rows, six identical gears). Once third parties can add rows, a row could pass itself off as "System Settings". | `launcher.tsx:124-142`; set.png |
| 10 | P2 | **Enter is the only verb.** No secondary actions (reveal, copy path or address, open with, bind a key), no arguments, no result shown inline apart from math. | `launcher.tsx:103-108,114-118` |
| 11 | P2 | **You can't give a command its own key.** Bindings form a closed set of names handled in a `switch`, and remapping means editing keymap.ts and restarting the shell. | `keymap.ts:5,122`; `shortcuts.ts:66-84` |
| 12 | P2 | **Applet units have no resource limits.** `systemd-run` sets only `Restart=on-failure`: no `CPUQuota`, `MemoryMax` or `Nice`. Before applets answer queries while you type, a runaway applet must not be able to starve the shell or the compositor. | `applets/launcher.ts:42-45` |
| 13 | P2 | **The existing Linux ecosystem is ignored.** Nothing consumes GNOME's `org.gnome.Shell.SearchProvider2` or KRunner's D-Bus runners: grep finds neither. `dev.dashi.Shell` serves only the portal, so other programs can't list or run Dashi's actions over D-Bus. | grep `SearchProvider\|krunner` finds nothing; `portal-host/protocol.ts:1-19` |
| 14 | P3 | **Nothing is tested.** There are no tests for launcher ranking, math or row stability. The only related test is `entries-hidden.test.ts`. | `packages/shell/test/` listing |

## Where Raycast wins today, and where Dashi can win

**Raycast wins today**
- It has an extension store with a large catalog, a React-based API with list, form and detail views, and no-view commands that show a toast or HUD ([Raycast API](https://openapps.pro/packages/raycast-api); a third-party listing, check it against Raycast's docs).
- Any command has a deep link: `raycast://extensions/<owner>/<ext>/<cmd>`, plus `fallbackText`, script commands with `arguments`, and a "Copy Deeplink" action ([manual: Deeplinks](https://manual.raycast.com/deeplinks), [v1](https://manual.raycast.com/v1/deeplinks), [createDeeplink](https://developers.raycast.com/utilities/functions/createdeeplink)). A command can be launched in the background without bringing Raycast forward ([lifecycle](https://developers.raycast.com/information/lifecycle/deeplinks)).
- Script commands in any language, a hotkey per command, aliases.
- AI Extensions: an extension's tools can be called from Quick AI, AI Chat and Root Search, with approval set per tool. MCP servers have been installable since 1.98 ([AI Extensions](https://manual.raycast.com/ai/ai-extensions), [1.98 changelog](https://www.raycast.com/changelog/1-98-0), [AlternativeTo](https://alternativeto.net/news/2025/5/raycast-1-98-adds-model-context-protocol-support-and-mcp-tool-integration)).

**Where Dashi can win**
- **Trust.** Raycast's extensions run with full Node.js access: no limits on file I/O or network, only a V8 isolate and store review ([Raycast Security](https://developers.raycast.com/information/security), [extensions#200](https://github.com/raycast/extensions/issues/200)). Dashi already has declared permissions, bubblewrap, a D-Bus proxy, author-signed and reproducible packages, and a kill switch (`docs/applets.md:154-206,326-382`).
- **Reach.** Raycast sees other apps only through Accessibility and AppleScript. Dashi *is* the menu bar, the compositor and Settings. Every app's menus, every window, every setting and every tray row is first-hand data (Findings 4 and 5).
- **Zero-authoring commands.** On macOS a command exists only once someone writes an extension. On Dashi, thousands exist on day one: menus, Desktop Actions, settings, tray rows.
- **One registry for people and agents.** Raycast added AI tools on top of extensions. Dashi can make the launcher and the MCP server two views of the same list, with the same consent scopes (`agents/consent.ts:14-52`) and the same activity log.

## Betterments

1. **One action registry.** **Recommended.**
   - *What:* Promote the agents' `ToolDef` (`agents/tools/define.ts:17-31`) into an `ActionDef`, the single list everything else reads from:
     - Fields: `address`, `title`, `keywords`, `kind` (open, toggle, run, pick), argument schema (JSON Schema, as MCP already uses), `scope`, `readOnly`, `destructive`, `who` (`person` | `agents` | `both`), `provider`.
     - Readers: the launcher lists it, `tools/list` is generated from it, the keymap binds to addresses, and menu rows refer to it.
     - Migration: keymap names, `MenuAction` kinds and the 68 tool calls become entries in it, one at a time.
   - *Why:* Anything you can do, you can find, bind, link and delegate, and the launcher and agents can no longer drift apart.
   - *Size:* L. *Needs:* shell, agents.
2. **An address for everything: `dashi://`.** **Recommended.**
   - *What:* Every action and every setting gets an address, for example `dashi://settings/battery/charge-limit`, `dashi://app/dev.dashi.notes/menu/new`, `dashi://applet/dev.example.weather/refresh?city=Lisbon`.
     - Register `x-scheme-handler/dashi` next to the first-party desktop entries (`desktop-entries.ts`, `default-handlers.ts`), so `xdg-open` works from a terminal, a note or a web page.
     - Any row gets a "Copy Address" action.
     - Settings opens to the pane and scrolls to and highlights the row (the sidebar already expects outside opens: `settings-app/sidebar.tsx:31`).
     - Opening a link from outside never runs a destructive action without asking: it opens the action with its arguments filled in.
   - *Why:* Help pages, notifications ("Battery low, set charge limit"), agents and people can all point at one exact place.
   - *Size:* M. *Needs:* shell, settings.
3. **Menus as commands.** **Recommended.**
   - *What:* Search the menus of running apps (`AppMenuStore.byPid`, `menusOf`), Dashi's own Window and app rows (`MenuAction`), tray dbusmenu and applet menu rows, and `[Desktop Action]` groups, which also covers apps that aren't running.
     - Rows read "Notes › File › New Note" with the item's ❖ shortcut on the right. Choosing one sends `select` (`app-menus/store.ts:76-81`).
     - Items marked `agents: false` (`app-menus/protocol.ts:58`) are still allowed here, because the launcher is the person.
   - *Why:* Thousands of commands without anyone writing an extension, and you learn each app's shortcuts as you go.
   - *Size:* M. *Needs:* shell.
4. **Every setting is an action, with the control in the row.** **Recommended.**
   - *What:* A registry with one entry per setting (the settings roast's proposal, `docs/roast/settings.md:110`) gives the launcher rows such as "Dark Mode" with a switch, "Volume" with a slider-as-number ("vol 30"), and "Wi-Fi" with on/off plus the known networks (the same calls as `list_wifi_networks` and `join_wifi`).
   - *Why:* "wif ⏎" should turn Wi-Fi off, not open a pane.
   - *Size:* M–L. *Needs:* shell, settings, agents (same tools).
5. **Applet commands.** **Recommended.**
   - *What:* `applet.json` gains `commands: [{id, title, keywords, args?, mode}]`, where `mode` is `instant`, `pick` or `view`.
     - **Static, so it can be indexed** without starting the applet and found before the applet has ever run.
     - **Protocol v3:**
       - `run`: shell to applet, `{"type":"run","command","args","seq"}`.
       - `result`: applet to shell, `{"type":"result","seq","text"|"copy"|"open"}`.
       - `items`: for `pick` mode, the applet streams rows with `{"type":"items","seq","query","rows":[…]}`, which the shell parses and draws (no applet pixels in the list).
       - `view` mode reuses the popover machinery: the applet's own Metal host draws a layer surface where the result list was, granted only while it is shown (`docs/applets.md:97-108`).
     - **Permissions don't change:** commands run inside the same sandbox. The consent sheet adds a line such as "Adds 3 commands to the launcher". A command marked `agents: true` also becomes an MCP tool under the applet's name and is listed in Settings › Agents.
   - *Why:* A store that's safe to install from. This is Dashi's answer to Raycast's moat without copying its store.
   - *Size:* L. *Needs:* applets SDK and CLI, shell, mirin (surface placement), agents.
6. **Typing never waits on a provider.** **Recommended.**
   - *What:*
     - Build the app, menu and setting index in the background and update it on file-watch and menu publish, instead of on every open (`main.tsx:760`).
     - Search runs in memory against a ~2 ms budget.
     - Every outside provider (files, applets, scripts, D-Bus) gets the query with a `seq` and an ~80 ms deadline. Late answers only *append* below the current rows and never move the selected row (this fixes Finding 7). A provider that keeps missing the deadline is shown as "Weather · slow" and then dropped for the rest of the session.
     - Applet units get `CPUQuota=`, `MemoryMax=` and `Nice=` (`applets/launcher.ts:44`).
   - *Why:* The field must feel instant even with fifty providers installed. Raycast's single shared Node child can't promise that.
   - *Size:* M. *Needs:* shell, applets.
7. **Your own commands, and commands an agent writes for you.**
   - *What:*
     - Executables in `~/.local/share/dashi/commands/`, with a small JSON sidecar giving title, arguments and `mode`.
     - They run as transient user units with `RuntimeMaxSec`, because they are your own code (the same reasoning as `dashi-applet dev`).
     - An agent can propose one ("make a command that…"). It lands on a consent sheet that shows the script, and becomes yours.
   - *Why:* People who write shell scripts get what Raycast's script commands give them. On top of that, an agent can write the command and the consent sheet shows its code before it runs.
   - *Size:* M. *Needs:* shell, agents.
8. **D-Bus both ways.**
   - *What:* Read the `SearchProvider2` providers that Fedora's GNOME apps already install (Calculator, Characters, Contacts, Nautilus: inferred from the GNOME spec, check `/usr/share/gnome-shell/search-providers/` on the image). Then serve `dev.dashi.Shell.Actions1` with `List`, `Describe(address)` and `Run(address, args)`, checked by the same scopes, so GTK and Qt apps and scripts can call actions without speaking Dashi's sockets.
   - *Why:* Commands from GNOME apps on day one, and an API that programs outside Dashi's own sockets can use.
   - *Size:* M. *Needs:* shell (dbus/).
9. **Bind any action to a key, live.**
   - *What:* A keymap rule's `bind` takes an address (`super+alt+n → dashi://app/dev.dashi.notes/menu/new`). Bindings are pushed to dashi-comp without restarting the shell (`keymap.ts:5` says a restart is needed today). The row action "Bind to Key…" records the chord and warns about collisions with `reservedBy` (`app-menus/reserved.ts:56`).
   - *Size:* M. *Needs:* shell, compositor (keymap reload IPC).
10. **Show who supplied every row, and stop spoofing.**
    - *What:* Each row gets a muted trailing source tag ("Setting", "Notes menu", "Weather"). Rows from third-party providers can't use Dashi's glyphs or a first-party app's name, and never rank above an exact app or setting match.
    - *Size:* S. *Needs:* shell.
11. **Tests for the launcher's contract.**
    - *What:* Ranking, stable rows while answers stream in, deadlines, and math (none exist today).
    - *Size:* S. *Needs:* shell.

## The beat-Raycast move

**Every action on the desktop is a command at an address, and the launcher and agents share it.**

The day you install Dashi, the launcher can already do the following without a single extension:
- Run every menu item of every running app.
- Run every `.desktop` action.
- Change every setting.
- Run every tray and applet menu row.

Each one has a `dashi://` address you can bind to a key or paste in a note. The MCP server serves the same registry, so anything you can do from ❖Space an agent can do under your consent scopes, and anything an agent can do you can do yourself.

What third parties add arrives signed, reproducible and sandboxed, and can't slow your typing. Raycast has to persuade developers to write each command, and its extensions get full Node access. Dashi's commands come from the system it already runs.

## Mockup notes

One chrome row: the 56 px field row is the only chrome. No footer bar, no tab strip. Hints live in the selected row's trailing edge. Panel is 620 wide (`LAUNCHER.width`), rows are 44 px, the list area has 6 px padding, section labels are 22 px at 11 px semibold muted (as today, `launcher.tsx:120-122`).

**1. "dark": settings and menus as commands.** Field row: search glyph 20 px, text "dark" at 22 px. Rows:
1. *Selected.* 30 px appearance glyph, "Dark Mode" at 15 px. Trailing, right to left: a 36×20 switch (off) in white on kombu selection, then "Setting · Appearance" at 12 px in `#ffffffb3`, then a hint "⏎ Turn On" at 12 px.
2. "Night Shift": switch, "Setting · Displays".
3. Notes icon, "Notes › View › Dark Editor": trailing "⇧❖D" in a 12 px key chip, "Notes menu".
4. Gear, "Appearance": trailing "Settings pane".
5. Terminal icon, "Terminal › Profiles › Dark": "Terminal menu".

Section label "From your apps" at 22 px above rows 3–5. The panel grows to 5 × 44 + 22 + 12 + 57 px. No footer.

**2. "wea lisbon": an applet command in `pick` mode.** Field row: a token chip on the left of the text (24 px tall, radius 12, applet glyph plus "Weather", `colors.button` fill), then the text "lisbon". The token appears after Tab on a "Weather" row and is the whole scope UI, inside the one row. Rows stream in from the applet:
- "Lisbon, now 19° · clear", with a trailing 12 px provenance tag "Weather".
- "Lisbon, tomorrow 22°".
- "Lisbon, Fri 17° · rain".

While waiting, a single 2 px indeterminate line sits along the field row's bottom separator (not a new row). If the 80 ms deadline passes with nothing, one muted 44 px row says "Weather is taking a while…". Rows above never move.

**3. ❖K on a selected row: the action list.** It replaces the result list in place under the same field row. The field keeps the query, and a token chip "Dark Mode ›" shows what you're acting on.

| Row | Trailing hint |
|---|---|
| Turn On | ⏎ |
| Copy Address | `dashi://settings/appearance/dark-mode` (truncated, 12 px muted) |
| Bind to Key… | — |
| Show in Settings | — |
| Who changed it | "you · 2 h ago" (from the settings registry's log) |
| Let Agents Change This | Scope "Change settings" with its current state |

Esc goes back to the results. There is never a second bar.
