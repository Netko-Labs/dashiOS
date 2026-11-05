# Actions

One registry holds everything the desktop can do: every app and its
Desktop Actions, every open window, every Settings pane and setting, Dashi's
own commands, the menus running apps publish, and the agents' tools. Each
is an *action* at a `dashi://` address. The launcher lists them, agents get
the ones they may call as MCP tools, the keymap binds keys to their
addresses, and a `dashi://` link opens one. What the person can do, agents
can do, and the other way round, under one set of checks and one consent
(docs/betterments.html, "One registry", Recommendation C).

Code: `packages/shell/src/actions/`. Tests: `packages/shell/test/actions-*.test.ts`.

## An action

`ActionDef` (`actions/types.ts`) grew from the agents' `ToolDef`
(`agents/tools/define.ts`):

| Field | Meaning |
| --- | --- |
| `address` | `dashi://…` without arguments; unique in the registry |
| `title` | sentence case, as a row shows it ("Notes › File › New Note") |
| `description` | a sentence for agents and the action list; may be empty |
| `keywords` | words it is found by, per language: `{ en: […], de: […] }` |
| `kind` | `open` (a place), `toggle` (a switch), `run` (do it), `pick` (one of several values) |
| `properties`, `required` | the arguments, JSON Schema, as MCP's `inputSchema` |
| `scope` | what an agent must have been allowed (`agents/consent.ts`); null when no agent can call it |
| `readOnly`, `destructive`, `idempotent` | as the MCP annotations; `destructive` also means a link only opens it |
| `asksEveryTime` | it asks on a sheet every time, the person included (force quit, the Trash) |
| `who` | `person`, `agents`, or `both` |
| `source` | the source that added it |
| `tool` | the MCP tool it is, for agents; only these are in `tools/list` |
| `shortcut` | its key in Dashi's notation, from the keymap or the menu that has it |
| `place` | where it lives in System Settings: `{ pane, row }` |
| `state()` | what a toggle or pick is now |
| `check(args)` | the arguments checked: ready to run, or what is wrong in words for the row ("`value` must be a number from 0.25 to 4") |

`check` is the live validation: it runs on every keystroke of an argument
and never touches the system; only its `run(ctx)` does.

## The registry

`ActionRegistry` (`actions/registry.ts`) takes *sources*
(`ActionSource`: `id`, `actions()`, optionally `subscribe` and `refresh`).
A source can add and take away actions at runtime; the registry re-reads it
when it says it changed, and its own listeners hear of it. `list(filter)`,
`get(address)`, `resolve(link)` (the action and its arguments read by its
schema), and `query(text, filter)` are pure reads of what the sources hold
now, so a keystroke never waits on one. `refresh()` asks every source that
can to read again (the launcher opening). An address two sources both give
stays the first source's.

`query` is plain matching (title, then keywords in any language, then
inside a word from four letters on, accents folded); the launcher's ranking
reads `list` and orders it its own way.

Sources on day one (`actions/start.ts`, in this order):

| Source | Addresses | What choosing does |
| --- | --- | --- |
| `tools` | `dashi://tool/<name>` (`dashi://tool/force-quit-app`) | the agents' tool, as the person when `who` is `both` |
| `dashi` | `dashi://dashi/lock-screen`, `…/sleep`, `…/restart`, `…/shut-down`, `…/log-out`, `…/force-quit`, `…/settings`, `…/about`, `…/shortcuts` | the Dashi menu's own action; Restart, Shut Down, and Log Out ask first |
| `settings` | `dashi://settings/<pane>`; `dashi://settings/<pane>/<row>` for every setting `set_setting` knows | opens the pane; a row's toggle or pick runs `set_setting` as the person |
| `apps` | `dashi://app/<desktop id>`, `dashi://app/<id>/action/<action>` | starts the app, or its `[Desktop Action]` |
| `windows` | `dashi://window/w3`; `dashi://window/arrange/<left\|right\|up\|down\|fill\|center\|restore>`, `dashi://window/full-screen` | brings the window forward; arranges the focused window (or `?window=w3`) |
| `menus` | `dashi://app/<app id>/menu/<item id>` | brings the app's window forward and sends the menu's own `select` |
| `controls` | `dashi://settings/network/wi-fi`, `dashi://settings/bluetooth/bluetooth` | the radios, read from and switched through Control Center's own store (`actions/sources/radios.ts`); no hardware, no action |

Menu rows read "Notes › File › New Note" with the item's shortcut. Items an
app keeps from agents (`agents: false`) are offered here, because the
person is choosing; greyed-out ones are left out. Window titles and menu
labels come from other apps: shown and found by, never obeyed.

A setting's rows are marked in their pane with `<Spot pane row>`
(`settings-app/spot.tsx`), so its address can open Settings there.

## Addresses

`dashi://<segment>/<segment>…?<argument>=<value>` (`actions/address.ts`).
A segment is letters, digits, and `. _ : -`; anything else is refused, never
guessed at. The first segment is matched without case, the rest exactly (app
ids have capitals). Query values arrive as text and are read by the action's
own schema: `?value=true` is a boolean only where the schema says boolean,
`?value=1.5` a number only where it says number.

```
dashi://settings/appearance/dark-mode            open Appearance at Dark Mode
dashi://settings/appearance/dark-mode?value=true turn Dark Mode on
dashi://settings/mouse/scrolling-speed?value=2   mouse scrolling twice as far
dashi://app/dev.dashi.notes/menu/new             Notes › File › New Note
dashi://window/w3                                bring w3 forward
dashi://window/arrange/left                      tile the focused window left
dashi://dashi/lock-screen                        lock the screen
```

`copyAddress(action, args)` (`actions/copy.ts`) puts an action's address,
with its arguments filled in, on the clipboard: the launcher's Copy Address.

## Running an action

Everything the person asks for goes through one runner (`actions/run.ts`),
whatever asked: the launcher (`actions.run`), a key (`actions.runAddress`),
or a link (`actions.openLink`).

- **As the person.** It runs as the person. What the launcher chose and
  what a link opened are written in the agents' activity log
  (`$XDG_STATE_HOME/dashi/agents/activity.jsonl`) with `agent: "you"`, the
  address as the tool, and how it went (`ok`, `error`, `cancelled`,
  `opened`). A key the person pressed (⌃❖←, a key they bound) runs the same
  way but is not logged (origin `key`, `actions/run.ts`): the log is what
  was done, not a record of typing.
- **Same consent.** A tool action runs through `Agents.runAsPerson`
  (`agents/server.ts`): the same code an agent's call runs. A tool that asks
  an agent every time (`force_quit_app`, `trash_file`, the software
  requests) asks the person too, on a sheet of their own
  (`actions/confirm-sheet.tsx`) in the agents' sheet queue, so only the
  person's own press answers yes. No is "Cancelled." A tool doesn't run
  while the screen is locked.
- **Agents' tools stay theirs.** An action with `who: "agents"` (screenshots,
  the agent's own pointer and keys, sign-in, paying) is not the person's
  command.

## Links from outside

The shell writes `dev.dashi.links.desktop` beside the first-party apps'
entries (`actions/entry.ts`, `desktop-entries.ts`): hidden, with
`MimeType=x-scheme-handler/dashi;`, running `bin/dashi-open.ts %u`. The
system default names it (`session/dashi-mimeapps.list`), so `xdg-open`,
`gio open`, a link in a note, or a help page reach it; from a terminal,
`dashi-open dashi://…`.

`dashi-open` hands the link to the shell on
`$XDG_RUNTIME_DIR/dashi-links.sock` (mode 0600; SO_PEERCRED says who
connected) and prints the answer (`actions/links.ts`):

```
client → shell  {"open":"dashi://settings/appearance/dark-mode"}
shell → client  {"ok":true,"text":"Dark Mode is open in System Settings."}
                {"ok":false,"error":"Nothing is at dashi://…"}
```

One request per connection. A link comes from anywhere, so:

- A settings address with no arguments opens the pane, scrolled to the row,
  and lights the row up for a moment.
- A destructive action is never run. It is opened with its arguments filled
  in: the launcher shows it ready for Return when it has taken links
  (`actions.setPresenter`), otherwise a sheet asks "Run “…”?" and shows the
  link. Arguments that don't fit say so and open nothing.
- An agent tool that changes something (`dashi://tool/create-note`,
  `…/close-window`) is opened the same way: a tool carries an agent's reach,
  more than a link should have without the person.
- An action that asks every time (force quit, Restart) asks on its own sheet;
  that sheet is the opening.
- Anything else runs.

## MCP

`tools/list` is written from the actions that name a tool and are not the
person's alone (`mcpListing`, `actions/tools.ts`), in the shape MCP clients
have always seen. `test/fixtures/mcp-tools-list.json` is 0.3's list, taken
before the registry; `actions-tools.test.ts` holds `tools/list` to it byte
for byte and checks every tool is still called the same way (`parseCall`
and an action's `check` share `checkToolArgs`). Changing a tool changes the
fixture in the same commit.

## In the launcher

The launcher (`launcher.tsx`) lists `registry.list({ who: "person" })`
beside the installed apps and panes (`launcher/items.ts`), ranked by
`launcher/ranking/`: every setting's row (a switch Space flips, or its
value), Dashi's commands, the apps' Desktop Actions, the menus running apps
publish, the arranging commands, and the agents' tools a person uses that
need no argument. The registry's apps and panes are the entries' rows, and
the open windows come with their apps' names (`launcher/world.ts`); choosing
a window runs its `dashi://window/w3` action. Every row's action list (❖K)
has Copy Address, Set alias… and Set shortcut….

`actions.setPresenter` is the launcher's: a link that must not run by
itself opens the launcher with the action and its arguments filled in
(`Presented`, `launcher/host.ts`); Return runs it, as the person.

## The keymap

A keymap rule's `bind` may be an address (`keymap.ts`): `shortcuts.ts`
hands any `dashi://` binding to the registry, run for the person on the
window focused when it was pressed. The compositor carries the name as it
carries any other. A row shows the key the keymap binds to its address
(`actions/keys.ts`).

The person's own keys are rules of this kind: Set shortcut… in the
launcher keeps `launcher.keys` in settings.json (`{ "super+alt+n":
"dashi://app/dev.dashi.notes/menu/new" }`, `launcher/person-keys.ts`), and
the shell puts them ahead of Dashi's rules (`keymap-state.ts`) and sends the
keymap again as soon as the file changes. Aliases (`launcher.aliases`, `{
"ff": "dashi://app/org.mozilla.firefox" }`) name addresses the same way.

Window arranging is bound so now: ⌃❖←→↑↓ to `dashi://window/arrange/<arrow>`,
⌃❖↩ to `…/fill`, ⌃❖C to `…/center`, ⌃❖R to `…/restore`, ⌃❖F to
`dashi://window/full-screen`.

The other bind names move the same way, one kind at a time: give the
action an address in its source, change the rule's `bind` to it, delete
its `case` in `runBinding`, and move its test to the registry.

| Bind names now | Address | Source |
| --- | --- | --- |
| `lock-screen`, `force-quit`, `settings` | `dashi://dashi/lock-screen`, `…/force-quit`, `…/settings` | `dashi` (exists) |
| `quit-app`, `hide-app`, `minimize-window`, `close-window`, `next-window` | `dashi://window/quit-app` and so on, on the focused window | `windows` |
| `screenshot-screen`, `screenshot-area`, `capture-toolbar` | `dashi://dashi/screenshot`, `…/screenshot-area`, `…/capture` | `dashi` |
| `toggle-autohide` | `dashi://settings/desktop-dock/autohide` (exists: a toggle with no value switches) | `settings` |
| `space-left`, `space-right`, `space-1`…`space-9`, `overview` | `dashi://space/left`, `dashi://space/3`, `dashi://dashi/overview` | a `spaces` source |
| `volume-up`, `brightness-up`, `media-*`, `power-key` | `dashi://sound/volume-up` and so on | a `hardware` source |
| `launcher`, `switch-*`, `switcher-*`, `app-chord` | stay names: they are the launcher and the switcher themselves, and `app-chord` is the app's own menu | |
