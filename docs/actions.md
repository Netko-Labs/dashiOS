# Actions

One registry holds everything the desktop can do: every app and its
Desktop Actions, every open window, every Settings pane and setting, Dashi's
own commands, the menus running apps publish, the agents' tools, applets'
commands, and your own scripts. Each
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
| `linkOpens` | a link only opens it, though it isn't destructive: running it would hand a program something private (Screenshot of the Screen) |
| `asksEveryTime` | it asks on a sheet every time, the person included (force quit, the Trash) |
| `who` | `person`, `agents`, or `both` |
| `source` | the source that added it |
| `from` | who outside Dashi supplied it ("Weather", "Script"), shown on its row; absent for Dashi's own |
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
| `dashi` | `dashi://dashi/lock-screen`, `…/sleep`, `…/restart`, `…/shut-down`, `…/log-out`, `…/force-quit`, `…/settings`, `…/about`, `…/shortcuts`; `…/capture`, `…/screenshot`, `…/screenshot-area` | the Dashi menu's own action; Restart, Shut Down, and Log Out ask first. The screenshots are ⇧❖5's toolbar, ⇧❖3's screen, and ⇧❖4's area; Screenshot of the Screen is `linkOpens`, so a link only opens it (a program must not get the screen without asking) |
| `settings` | `dashi://settings/<pane>`; `dashi://settings/<pane>/<row>` for every row of every pane, from the settings registry (see below) | opens the pane; a row that is one value is a toggle or a pick: one named for agents runs `set_setting` as the person, the person's own changes through the registry's store; any other row opens Settings scrolled to it and lit |
| `apps` | `dashi://app/<desktop id>`, `dashi://app/<id>/action/<action>` | starts the app, or its `[Desktop Action]` |
| `windows` | `dashi://window/w3`; `dashi://window/arrange/<left\|right\|up\|down\|fill\|center\|restore>`, `dashi://window/full-screen` | brings the window forward; arranges the focused window (or `?window=w3`) |
| `menus` | `dashi://app/<app id>/menu/<item id>` | brings the app's window forward and sends the menu's own `select` |
| `controls` | `dashi://settings/network/wi-fi`, `dashi://settings/bluetooth/bluetooth` | the radios, read from and switched through Control Center's own store (`actions/sources/radios.ts`); no hardware, no action |
| `applets` | `dashi://applet/<applet id>/<command id>` (`dashi://applet/dev.example.weather/now`) | the applet's command, run in its sandbox over protocol 3 (docs/applets.md, "Version 3: commands", `applets/commands.ts`) |
| `scripts` | `dashi://script/<file name>` (`dashi://script/hello.sh`) | one of your own scripts, run as you ([below](#your-own-scripts)) |

The last two are added by `extensions/start.ts` once the registry is up.
Their actions carry `from` ("Weather", "Script"): who outside Dashi
supplied them. Such a row says so at its right, shows its own icon or a
neutral puzzle piece (never one of Dashi's glyphs), is ranked as `foreign`
(never above an exact match of an app's or a setting's name), and one
titled like a first-party row reads "Weather › System Settings"
(`launcher/items.ts`).

Added later by the shell (`main.tsx`, `registry.add`):

| Source | Addresses | What choosing does |
| --- | --- | --- |
| `clipboard` | `dashi://clipboard/history` (⌥❖V), `dashi://clipboard/snippets`, `dashi://clipboard/clear`, `dashi://settings/keyboard/clipboard-history` | opens the launcher in the Clipboard or Snippets scope (chosen in the launcher, the scope is entered in place); Clear Clipboard History asks on the person's sheet every time; the history's switch (off deletes what was kept). The person's alone (`clipboard/actions.ts`) |

Menu rows read "Notes › File › New Note" with the item's shortcut. Items an
app keeps from agents (`agents: false`) are offered here, because the
person is choosing; greyed-out ones are left out. Window titles and menu
labels come from other apps: shown and found by, never obeyed.

### The settings registry

Every row of System Settings is one entry in `settings-app/registry/`
(`look.ts`, `input.ts`, `machine.ts`, `you.ts`; `rows.ts` puts them
together): its id `<pane>/<row>` (its address without `dashi://settings/`),
its title as the pane shows it, a `name` where the title leans on the pane
("Mode" is "Graphics mode" in the launcher), its detail, the words it is
found by, its kind (`switch`, `choice`, `value`, `action`), a choice's
options, and, where it is one value, a binding (`value`): its JSON Schema
and a getter and setter through the settings store (settings.json),
Control Center's switches, or the Dock's store. A row agents may change
has an `agent` name.

Everything reads the one list:

- The panes draw their rows from it: `<Setting id>` (`settings-app/setting.tsx`)
  takes its title and detail from the entry, is a Spot (a link or the
  launcher scrolls to it and lights it), and draws the entry's own switch
  or pills when the pane passes no control. A pane passes a live detail or
  its own control (a slider, a picker) where it must. `<Spot id>` wraps
  other content an entry stands for (a list, a form). A pane draws no plain
  row with a label of its own: data rows (a login, a device) are `Item`s,
  a form's fields are `FormRow`s. Ids are typed, so a pane can't draw a row
  that isn't registered; `test/settings-registry.test.ts` checks the other
  way: every entry is drawn by its pane.
- The launcher and links: this source, one action per row (the radios and
  the clipboard history are their own sources' rows, `source` on the entry).
- Agents: `get_settings` and `set_setting` take every row with an `agent`
  name, checked by its binding's schema. None of Lock Screen, Users &
  Accounts, Passwords, Agents, or Privacy & Security is an agent's.
- Settings' search, in its header strip (`settings-app/find.ts`), finds
  panes and rows by the same words.
- The change log (`settings-app/changes/`): a binding names where its value
  is kept (`key`: `<section>.<key>` of settings.json, `flags.<key>`), and
  every change to it, from a pane, the launcher, a link or an agent, is an
  entry with its words from the row (name, from, to), who made it (the
  person, or the agent `src/acting.ts` says is acting: an MCP agent's call,
  or a launcher Ask's approved step, named for its answerer), and when.
  Recently changed lists them with Undo; ❖Z in Settings undoes the newest.

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
- **An agent's plan, approved.** A step of the launcher's Ask that the
  person ran with their own Return (below) goes through
  `actions.runApproved(action, args, { agent, task })`: only a tool action
  agents may call, checked by its own `check`, run through the same
  `runAsPerson` as the person's commands (that press is the step's Allow
  Once), and logged as the answerer's (`agent: "Claude"`) with the task's id
  (`task`). A tool that asks every time still asks, on the person's sheet.

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
- A destructive action (or one marked `linkOpens`) is never run. It is opened with its arguments filled
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

## Websites

Agents use web pages through Dashi's own extension in Helium, not through
screenshots and clicks by pixel: a page comes back as text with numbered
elements, the tools wait for the browser's own load events, and a number
names the same element until its page goes. In the VM a step takes
0.2–1.1 s, a page load included, against 2–4 s of guessed wait and
screenshot per step by pixel (`dashi-0.5.0-review/25-browser`).

```txt
agent ──MCP──> shell ──dashi-browser.sock──> dashi-browser-host ──native messaging──> extension ──> tab's frames
                (src/browser/bridge.ts)       (bin/dashi-browser-host.ts)              (browser-extension/)
```

- **The extension** (`packages/shell/browser-extension`, Manifest V3) takes
  commands only from its native host (`connectNative("dev.dashi.browser")`):
  no page or other extension can reach it. Its content script runs in every
  frame from the document's start; the background keeps each tab's element
  numbers (`page/refs.ts`: a frame's document and its own number), reads
  every frame, and waits for loads through `webNavigation`, never a timer.
- **The host** (`session/dashi-browser-host`, installed at
  `/usr/libexec/dashi/`) is started by the browser for Dashi's extension
  only: its manifest's `allowed_origins` is the extension's id, and the host
  checks the origin Chromium passes it again (`src/browser/native.ts`). It
  relays to the shell's socket and takes requests from nowhere else.
- **The shell's socket** (`$XDG_RUNTIME_DIR/dashi-browser.sock`, 0600)
  accepts only Dashi's host script, outside any agent's scope (its peer by
  `SO_PEERCRED`, its command line and cgroup); agents' sandboxes never see
  it (docs/secrets.md, "The agent sandbox").
- **Installed by the packages**: `dashi` ships the host; `dashi-helium` ships
  the CRX and its update manifest at `/usr/share/dashi/browser/`, a managed
  policy (`/etc/chromium/policies/managed/dashi.json`:
  `ExtensionSettings`, `force_installed`, `update_url` a `file://` update
  manifest) and the host's manifest
  (`/etc/chromium/native-messaging-hosts/dev.dashi.browser.json`). Helium
  is Chromium unbranded, so it reads Chromium's system paths (its binary
  names `/etc/chromium/policies` and `/etc/chromium/native-messaging-hosts`);
  Chromium gets the extension too. A policy install was chosen over the
  external-extensions JSON (`/usr/share/chromium/extensions/<id>.json`)
  because Chromium enables a policy's extension without asking and keeps it
  installed (the person can't remove it by mistake), while an external
  extension is, by Chromium's rules, held disabled until the person accepts
  an "extension added" prompt (not tried in Helium). Measured in the VM: Helium 0.20.3 installs the CRX from the
  `file://` update manifest at start (location 7, policy download, enabled).
- **The id is pinned** by the manifest's `key` (the public half of the
  extension's signing key): `mngbphpldanjlpbagnkmfalmglolgkmb`.
  `bin/dashi-browser-pack.ts` builds and signs the CRX (CRX3, `src/browser/crx.ts`);
  `spin/build-rpms` runs it with `$DASHI_EXTENSION_KEY` (by default
  `~/.config/dashi-build/browser-extension.pem` on the machine that builds
  the packages). The private key is never in the repository; losing it means
  a new key and a new id in the manifest, the host's manifest, the policy
  and `EXTENSION_ID` (tested to agree: `browser-pinning.test.ts`). The key
  in the manifest today is a development key generated for 0.5.0.

The tools (`src/agents/tools/browser.ts`, carried out by
`src/agents/desktop/browser.ts`), all under the scope "Use websites":

| Tool | What it does |
| --- | --- |
| `open_url {url, tab?}` | Opens an http(s) address in a new tab (or `tab`), starting Helium if no extension is connected, and returns once the page has loaded |
| `read_page {tab?}` | The page as text: headings (`#`), text in reading order, links in their sentence with their address (a path on the page's own site), every other control on its own line: `[7] textbox "Correo electrónico" value="…"`, `[9] password field "Contraseña" (filled: no)`, `[12] button "Ingresar"` |
| `click_element {ref, tab?}` | Clicks an element; when that loads a page, returns once it has |
| `fill_element {ref, text, tab?}` | Replaces a text field's value as typing would (`insertText`, else the value's setter and `input`/`change`); refused on password, card and code fields |
| `select_option {ref, value, tab?}` | Chooses a `<select>`'s option by value or label |
| `press {keys, tab?}` | Keys in Dashi's notation to the page's focus, with the browser's defaults done when the page doesn't prevent them (Return submits, Tab moves, Page keys scroll) |
| `scroll_page {direction?, pages?, ref?, tab?}` | Scrolls, or brings an element into view; says whether the page is at its end |
| `list_tabs`, `switch_tab {tab}` | The browser's tabs (title and address only for allowed sites), and bringing one forward |

Without `tab`, a tool uses the tab the agent used last, else the one in
front. The menu bar's agent chip says what it does in words: "Opening
wikipedia.org", "Reading bodytech.com.co", "Clicking on auth.wikimedia.org".

**Each site is asked about** the first time an agent touches it
(`src/agents/sites.ts`): "Claude wants to use bodytech.com.co" with Don't
Allow, Allow Once (this connection) and Always Allow (kept in
`~/.local/state/dashi/agents/sites.json` by the agent's grant key). A site
covers its subdomains; a refusal holds for the connection; a sheet nobody
answered remembers nothing. Revoking an agent, or its "Use websites", in
Settings forgets its sites.

**Nothing secret leaves the page.** The reader (`page/node.ts`,
`page/read.ts`, pure and tested with made-up trees) never reads the value
of a password field (by its type, or one that was a password field before a
"show password" button made it text), an `autocomplete` password, a card
field (`cc-*`, or a name that says card, CVC, CVV), a one-time code field
(`one-time-code`, or a name that says OTP or 2FA), or a field Dashi typed a
secret into: each says only `(filled: yes|no)`, and `(filled: yes, by
Dashi)`. `fill_element` and typed characters (`press`) are refused there.
`sign_in`, `fill_code` and `pay` take the field's number instead of a window
(docs/secrets.md).

When no extension is connected (another browser), these tools say so, and
the screenshot tools work as before.

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

### Scopes

A scope narrows the panel to one source's rows behind a chip
(`launcher/scope.ts`): its own placeholder, rows, verbs (❖K lists them, ↩
is the first, ❖C the copy verb) and hints. A scope names the address that
opens it; that action chosen in the launcher enters the scope in place, and
Esc goes back to the search; opened by a key or a link (⌥❖V binds
`dashi://clipboard/history`), Esc closes. The two scopes are the
clipboard's (`clipboard/scope.ts`):

- **Clipboard**: the history (`clipboard/`), pinned copies first, then
  newest first; ↩ pastes into the window under the launcher (its app's paste
  chord: ⌃⇧V in a terminal), ❖C copies, ❖K adds Pin, Delete and Clear
  History (which asks in place). The head counts the copies and says what
  was not kept, never what it was.
- **Snippets**: "snippet" in the launcher finds it. The field adds one:
  a keyword, a space, its text (`;addr Calle de la Luna 12`) and ↩. A
  snippet's ↩ pastes its text; typed anywhere, its keyword expands at the
  compositor (docs/compositor-ipc.md, `snippets`), never in a password
  field or a terminal unless Settings › Keyboard allows terminals.
  Placeholders: `{date}`, `{time}`, `{clipboard}`, `{cursor}`.

Agents never read the history through the registry; their tool
`read_clipboard_history` needs the scope "See your clipboard history",
which Always Allow never keeps, and asks the person every time.

`actions.setPresenter` is the launcher's: a link that must not run by
itself opens the launcher with the action and its arguments filled in
(`Presented`, `launcher/host.ts`); Return runs it, as the person.

### What a command from outside shows

An applet's or a script's command may answer with more than a line: its
`Outcome` carries `show` (`actions/types.ts`), which the launcher takes in
place of closing (`launcher/extensions.ts`):

- `text`: its answer is the top row, in SemiBold, selected, with where it
  came from at the right; Return copies it. A link or a D-Bus caller gets
  the same words as `text`.
- `pick`: a chip with the command's title goes in the field ("Search
  Weather"), and each keystroke asks for rows; the one chosen runs.
- `view`: the command draws its answer itself where the rows were; Esc
  goes back.

A command from outside that takes arguments asks for them in the field
first, one at a time, the chip naming it. Esc leaves any of these, as it
leaves the action list.

### Search providers

GNOME's search providers (`org.gnome.Shell.SearchProvider2`) are read as
one more source, results only, behind the registry
(`search-providers/`): the key files in
`<data dir>/gnome-shell/search-providers/` (version 2; one marked
`DefaultDisabled=true` stays off), each asked only while its app is
installed, over one session-bus connection. From two letters typed, each
provider gets the words (`GetInitialResultSet`); three of its results
(`GetResultMetas`) go below every instant row and the files, under the
app's name ("Characters"). Return opens one in its app (`ActivateResult`),
run as the person and logged as `dashi://search/<provider>`. A provider has
no arguments and gives no inline answer, so it is never an action of its
own.

### Budgets

Every source outside the shell (applets' pick commands, search providers)
is asked with a sequence number and has 80 ms (`launcher/budget.ts`,
`SlowSources`). An answer for an older query is dropped. One that is late
says so ("Characters · slow" on its head, "Weather is taking a while…" in a
pick), its rows still come below the rest, and one late three times isn't
asked again this session. Nothing already drawn moves; the selection is
held by row id. Applets and scripts run in units with `CPUQuota=50%`,
`MemoryMax=768M`, and `Nice=10`; D-Bus providers are started by the bus
(D-Bus activation), so their limits are their own units'.

## Your own scripts

Executables in `~/.local/share/dashi/commands/` (`$XDG_DATA_HOME`; made at
the shell's start) are commands, each at `dashi://script/<file name>`, its
row marked "Script" (`actions/sources/scripts.ts`). A few header lines,
in the first 40, after any comment marker (`#`, `//`, `--`, `;`), say what
it is:

```sh
#!/bin/sh
# @dashi.title Say hello
# @dashi.keywords greet, hi
# @dashi.argument name Name
# @dashi.argument loud? Loud
# @dashi.output text
echo "Hello, $1"
```

| Header | |
| --- | --- |
| `@dashi.title` | required: the row's title (60 characters) |
| `@dashi.keywords` | words it is found by, separated by commas or spaces |
| `@dashi.argument NAME [Title]` | an argument, in order; `NAME?` is optional; up to 4. The launcher asks for each in the field; they are passed as `$1`, `$2`… |
| `@dashi.output` | what is done with what it prints: `text` (the default: a row Return copies), `copy` (the clipboard), `open` (its first line, an `https://` or `dashi://` address), `silent` |

Only regular files that are yours, executable, writable by you alone, and
1 MB or less are read; the folder is watched. A script runs as you, as a
transient user unit (`systemd-run --user --pipe --wait`, with
`RuntimeMaxSec=30` and the units' limits above), from your home folder; a
non-zero exit says the last line it wrote to stderr. It is your own code,
so it is `destructive`: a link or a D-Bus caller only opens it for you to
run, never runs it.

## On D-Bus

The registry is served on the session bus as `dev.dashi.Shell.Actions1`
at `/dev/dashi/Shell`, on the shell's name `dev.dashi.Shell` beside
`Portal1` (`actions/dbus.ts`), so GTK and Qt apps, scripts, and tools can
use it without Dashi's sockets:

| Method | |
| --- | --- |
| `List() → a(ssss)` | every action the person may use: address, title, kind, where it came from (`from`, else `source`) |
| `Describe(s address) → a{sv}` | `title`, `description`, `kind`, `source`, `from`, `destructive`, `readOnly`, `arguments` (its JSON Schema, as text) |
| `Run(s address, a{sv} args) → s` | what it came to, in words; arguments are text, numbers, or true or false |

A caller is a program, not the person at the screen: `Run` is a link from
outside ([above](#links-from-outside)), with the same consent: a
destructive action or an agent tool that changes something is opened for
the person to finish, a settings address with no arguments opens Settings
there, and it is logged as "you". An agent's own tools are not listed.
Errors are D-Bus errors (`UnknownObject` for no such action, `Failed` with
the reason for one that didn't run).

```sh
busctl --user call dev.dashi.Shell /dev/dashi/Shell dev.dashi.Shell.Actions1 Run 'sa{sv}' dashi://dashi/lock-screen 0
```

## Agents in the launcher

Local first (docs/betterments.html, "Agents in the launcher",
recommendation B): the rows above never wait for a model, and no model is
called while typing. Code: `agents/ask/` (the answerers, the plan, the
tasks, Now, the history) and `launcher/agents/` (the rows, the plan view,
the keys). Tests: `test/agents-ask-*.test.ts`, `test/launcher-agents.test.tsx`.

- **Who answers.** Settings › Agents (or the Setup Assistant's Agents page):
  "Answer requests with", one row each, in this order: the harnesses
  installed (Claude Code, Codex, OpenCode: "Your Claude subscription",
  "Your ChatGPT plan", "OpenCode's configured provider", each with "Signed
  in" or "Not signed in: run `claude auth login` in Terminal" where that can
  be told without a model call), then a local model, then Claude and GPT
  with the person's key, then None. A harness that isn't installed goes
  after the APIs, reads "Not installed. Install it with …" (its install
  command) and can't be picked. Nothing is checked until the person picks
  (`agents/ask/choices.ts`, `settings-app/panes/answerer-list.tsx`).
  settings.json `agents.answerer` (`"claude-code" | "codex" | "opencode" |
  "local" | "claude" | "gpt" | "none"`, unset until the person picks),
  `agents.localModel` and `agents.gptModel`. A harness answers through plan
  mode (below). A local model is Ollama on
  `127.0.0.1:11434` only; Claude is the Messages API on `api.anthropic.com`
  only (the base URL fixed, whatever `ANTHROPIC_BASE_URL` says), through the
  official SDK (`@anthropic-ai/sdk`, `agents/ask/claude.ts`):
  `claude-opus-5-5` at `output_config.effort: "low"`, thinking left as the
  model has it, `tool_choice: auto` with strict tools (`agents/ask/strict.ts`;
  the system prompt asks for the calls), server-side fallbacks on
  (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`), a
  refusal read before anything else and a reply cut off at `max_tokens`
  never taken as a plan, and the SDK's typed errors for a refused key, a
  rate limit or an outage. The key comes from the vault's token item
  `anthropic` for that host (`VaultTokens.forHost("anthropic", "api.anthropic.com")`,
  `agents/ask/keys.ts`; "Tokens that stay home", docs/secrets.md) or else
  the session's `ANTHROPIC_API_KEY`. The key reaches the Anthropic client in
  the shell's own process only, for each request, and is dropped: never
  logged, shown, sent to the model, or put in a sandbox. Settings learns
  where it is from the token list, without asking for the token. GPT is
  OpenAI's Chat Completions on `api.openai.com/v1` only, through the
  official SDK (`openai`, `agents/ask/gpt.ts`; the base URL fixed whatever
  `OPENAI_BASE_URL` says, organization and project never read from the
  session, `store: false`): the model is `agents.gptModel`, else the most
  capable chat model the key's `/v1/models` lists (`agents/ask/gpt-models.ts`:
  by generation, a full model over its mini and nano, an alias over its
  snapshots; audio, realtime, image, search, embedding and Responses-only
  models left out; nothing hard-coded), and Settings offers the first six as
  pills. The plan's tools are strict function tools: every property
  required, the optional ones nullable, and a null that comes back dropped
  before the action's check (strict holds per call; with several calls in
  one reply OpenAI doesn't promise it, so the check is what decides). A
  refusal, a content filter or a reply cut at its length is never a plan,
  and the SDK's typed errors say what went wrong (a refused key, no such
  model, no credit left, busy, offline). Its key is the vault's token item
  `openai` for `api.openai.com`, else `OPENAI_API_KEY`, handled as Claude's
  is. No other network path, but a harness's own (plan mode).
- **Asking.** An Ask row is added last, never selected for you, when an
  answerer is chosen and the words read like a request (three or more
  words, a verb first, or a "?"; not a sum the launcher answers), or after
  ⇥ (a launcher-only rule, `Tab|ISO_Left_Tab` → `launcher-tab`). It says
  where the words go ("Claude Code · your Claude subscription", "Codex ·
  your ChatGPT plan", "OpenCode · its own provider", "Local · stays on this
  computer", "Claude · Anthropic, your key", "GPT · OpenAI, your key"). With nothing picked yet, ⇥ offers "Set up an agent…"; "None"
  hides Ask. Only the typed words are sent, with the context chips the
  person left on (below, "Agents from the launcher"): after the words, the
  window in front ("The window in front is Notes (window w2)") and the
  selection; never the window's contents.
- **The plan.** The answerer is offered the actions a person and agents
  both use (`who: "both"` with a tool) as tools; its calls come back as
  numbered steps in Dashi's words (from the action and its arguments, never
  the model's), each checked by its action and wearing its scope chip
  ("Change settings · allowed", "· will ask" for a tool that asks every
  time). Nothing runs until Return. Return runs exactly those calls, in
  order, if `input-origin` on the launcher's layer says the person's own
  hands pressed it (`agents/person.ts`, as a consent sheet's yes); if not,
  every step reads "Not allowed" with "Allow once", which asks again on the
  person's press. A step's own sheet answered no is "Not allowed" too. A
  settings change keeps the value it had, for Undo. Typing on a plan and
  Return sends a follow-up: the model hears how each call went, then the new
  words. ⇥ goes back to the words to edit them; Esc leaves the plan running, but
  Esc while it is still being asked for gives up on it (the request, or the
  harness and all it started, stopped).
- **Now.** An empty launcher lists, above Recent, a pending "Your turn"
  (Return brings its window forward), the launcher's own tasks (Return shows
  the plan), and the agents connected over MCP with what each is doing; each
  has a shiso dot and a stop square.
- **History.** "history" in the launcher and the list in Settings › Agents
  read `activity.jsonl` (an MCP agent's calls grouped by connection) and
  `tasks.jsonl` beside it (one line per plan: the request, each step's words
  and how it went, and the value to put back), with Undo for settings
  changes.
- **Failures.** One line under the plan's head says why no plan came and
  what Return does: "Return tries again" (no answer, a timeout, the
  provider's error), "Return opens Settings" (no key, no model, a harness
  not installed), or for a harness that isn't signed in, "Claude Code isn't
  signed in. Return opens Terminal to sign in with claude auth login."
  (Terminal can't be handed a command yet, so the row names it.)

### Plan mode

How a harness the person already has (Claude Code, Codex, OpenCode) answers
the launcher with its own login, so a subscription works, without running
anything (`agents/ask/harness/`; tests `test/agents-ask-harness.test.ts`
with a fake CLI, `test/fixtures/fake-harness.ts`, that speaks MCP to the
plan server and prints each CLI's output):

1. **Found.** On PATH, then where its installer puts it (`~/.local/bin`,
   `~/.claude/local`, `~/.npm-global/bin`, `~/.bun/bin`, `~/.opencode/bin`…),
   links followed (`detect.ts`). Signed in is asked without a model call:
   `claude auth status --json` (`loggedIn`), `codex login status` (exit 0),
   OpenCode's `auth.json` listing a provider (else unknown, and the row
   doesn't claim either).
2. **The plan server.** Each turn gets its own socket,
   `$XDG_RUNTIME_DIR/dashi-plan/<turn>.sock` (0600; a connection from
   outside that turn's sandbox scope is refused), speaking MCP
   (`plan-server.ts`): `tools/list` is the plan's tools, the same actions
   the Claude API answerer is offered (`plan.ts` `planTools`); `tools/call`
   never runs anything. A call's arguments are parsed as its schema means
   them (a `"true"` or `"1.5"` sent as text where a boolean or number goes
   becomes one, as some MCP clients send them), checked by its action, and
   recorded as the next step; the harness hears "Planned as step N; nothing
   runs until the person presses Return". A call that doesn't pass is
   answered with why ("Not planned: … Fix the arguments and call it again")
   and not recorded; nor is an unknown tool, or a tenth step.
3. **The run.** `dashi-agent` with a plan profile (`DASHI_AGENT_PLAN`;
   docs/secrets.md, "A harness in plan mode") runs the CLI headless, its
   own tools off, with only the plan server for MCP, reached through
   `dashi-mcp` with `DASHI_MCP_SOCKET` at the socket (`catalog.ts`, the
   command lines as data):
   - Claude Code (checked against `claude --help` 2.1.317, and run for real
     on the build machine): `claude -p` with the prompt on stdin,
     `--output-format json`, `--system-prompt`, `--tools ""` (no built-in
     tool), `--strict-mcp-config --mcp-config {dashi}`, `--allowedTools
     mcp__dashi`, `--permission-mode dontAsk`, `--setting-sources ""` (no
     hooks or plugins), `--disable-slash-commands`, `--no-chrome`,
     `--effort low`; a follow-up adds `--resume <session_id>`.
   - Codex (from its docs; not yet run): `codex exec --json
     --skip-git-repo-check --sandbox read-only --ignore-user-config` with
     `-c features.shell_tool=false`, `-c web_search="disabled"`,
     `-c approval_policy="never"` and `-c mcp_servers.dashi.*` (command, args,
     env, `default_tools_approval_mode="approve"`, `required=true`), the
     prompt (Dashi's words first) on stdin as `-`; a follow-up is `exec …
     resume <thread_id> -`. Output: JSONL, `thread.started` (`thread_id`),
     `item.completed` (`agent_message`), `turn.failed`/`error`.
   - OpenCode (from its docs; not yet run): `opencode run --format json
     --agent dashi-plan [--session <id>] -- <prompt>` with its config in
     `OPENCODE_CONFIG_CONTENT`: the `dashi` server (`type: local`), tools
     `{"*": false, "dashi_*": true}`, `permission` denying edits, shell and
     fetches, and a `dashi-plan` agent with Dashi's prompt. Output: JSON
     events with `sessionID`, `text` parts, `error`.
4. **The plan.** When the CLI ends, the recorded calls are the plan, shown
   and run exactly as any answerer's (one Return, `input-origin` checked,
   Undo); its words, if any, are the line under the head. Its session is
   kept with the task, so a follow-up resumes it, told how each step went.
   A turn has 120 s; Esc (while it plans) or Stop sends SIGTERM to dashi-agent, which stops
   the CLI and everything in its scope (`systemctl --user stop` of the
   scope if it hasn't ended 3 s later). A CLI that says it isn't signed in
   (`Not logged in`, a 401…) is "isn't signed in"; one that isn't
   installed any more is "isn't installed".

## Agents from the launcher

An agent that works on its own for minutes, in Dashi's sandbox, started
from the launcher and back when it's done or needs the person (the 0.5.0
design, dashi-0.5.0-review/mockups.html sections 1 to 3). Code:
`agents/handoff/` (the service, the store of runs, the stream parsers, the
grants, the chip's words, the questions, the follow-ups), `bin/dashi-task.ts`,
`launcher/agents/handoff-rows.ts` and `handoff-views.tsx` (the rows, the
context chips, the grants card), `agents-panel.tsx` (the chip and its
panel), `handoff-shell.tsx` (the wiring, the notifications, the context).
Tests: `test/launcher-handoff.test.ts`, `test/launcher-commands.test.ts`,
`test/handoff-*.test.ts` (the streams from `test/fixtures/handoff/`, no
network; `handoff-records.test.ts` and the service's "a shell that
restarts"), `test/agents-mcp-relay.test.ts` (the bridge connecting again).

- **Starting.** Words that read as a task (a verb and three or more words,
  or five or more; not a question) put **Hand it off** first: one row per
  installed harness, "Start Codex", the one Settings › Agents names in
  "Hand off to" first (else the one answering Ask, else the catalog's
  order), ⌥1… for the others. Ask stays under **Right now** (⇥ goes to it).
  The ranking decides, not a mode: when the top row found names what the
  words say ("open notes" finding Notes), that row stays first and Hand it
  off comes after it. A short command finds what it names: when the whole
  words find nothing, the verb in front ("turn on", "set", "switch off",
  "enable"…), an article and a value at the end ("to 30", "50%", "on") come
  off and the ranking looks for what is left, three words at most
  (`launcher/ranking/commands.ts`): "turn on dark mode" is Dark Mode, "set
  volume to 30" Output volume, each before Hand it off; "find me a hotel in
  SF next week and add it to my calendar" is still a task. Space never
  flips a switch found so ("turn on dark" then Space types on, and "turn on
  dark mode" may go on "and email alexk the report"); Return does. A harness that isn't installed has no row; one that
  isn't signed in says so and Return opens Terminal. Keys on a hand-off
  row: ↩ Start, ⌥↩ Start and watch (the panel opens on its card), ⇥ Ask
  instead.
- **Context chips.** Under the field, once the words read as a request
  (for a hand-off or Ask): "＋ Browser · signin.localhost" from the window
  in front when the launcher opened (on until clicked, or ⌫ in an empty
  field; in Helium the page's address through Dashi's extension), and
  "＋ Selection" only when there is a primary selection (off until clicked).
  What is on goes with the words: the window's app, id, title and address,
  the selection's text (8 KB at most). A task may hand that window to the
  person (`hand_over`) whatever "Manage windows and apps" says; Ask's plan
  only hears of it.
- **The grants card.** Return on a hand-off row shows, the first time for
  a kind of task, what the agent may use, in words, from the sandbox's real
  limits: "Websites: asks per site", "Your logins: asks each time",
  "Payments: asks each time", "Sees: <the chips left on>", and struck
  through, "Your files" and "Other windows". A kind is the set of grants
  (`grantsKind`), kept in `$XDG_STATE_HOME/dashi/agents/handoff.json` once
  the person starts from the card; then Return starts straight away.
  Settings › Agents' "Don't ask for these again" (`agents.skipGrants`) turns
  the card off. Return on the card starts it; "Change what it may use…"
  (❖,) opens Settings › Agents; Esc goes back.
- **Running.** Each turn is a transient user service,
  `dashi-task-<run>-<turn>.service` (`systemd-run --user`, as applets run),
  whose main process is `dashi-task`: it runs the harness through
  `dashi-agent` with a task profile (docs/secrets.md, "A task from the
  launcher") and appends its JSON lines to
  `$XDG_RUNTIME_DIR/dashi-agents/<run>/turn-<n>.jsonl`, which the shell reads
  as it grows (`runner.ts`), beside the run's record (below, "A shell that
  restarts"). No Terminal opens; closing the launcher never
  stops it. The command lines (`commands.ts`), as data, Dashi's words after
  the harness's own, its own tools off and Dashi's MCP server its only
  tools:
  - Claude Code (checked against `claude --help` 2.1.319, a stream recorded
    with it): `claude -p --output-format stream-json --verbose
    --append-system-prompt … --tools "" --strict-mcp-config --mcp-config
    {dashi} --allowedTools mcp__dashi --permission-mode dontAsk
    --setting-sources "" --disable-slash-commands --no-chrome`, the prompt
    on stdin; a follow-up adds `--resume <session_id>`.
  - Codex (checked against codex-cli 0.167.0's `--help`; run in the VM with
    no account, it starts its thread, retries, and fails with 401 Unauthorized,
    recorded as `codex-signed-out.jsonl`; never run signed in): `codex exec --json
    --skip-git-repo-check --sandbox read-only --ignore-user-config` with the
    shell tool and web search off and `mcp_servers.dashi` approved, the
    prompt on stdin as `-`; a follow-up is `exec … resume <thread_id> -`.
  - OpenCode (checked against opencode 1.19.5's `--help`; run in the VM with
    no account, it makes its session with the `dashi-task` agent and its free
    model's limit stops it, printing no JSON event and not exiting, so the
    card waits at "starting" until stopped; never run signed in): `opencode run --format json
    --agent dashi-task [--session <id>] -- <prompt>`, its config in
    `OPENCODE_CONFIG_CONTENT` (only `dashi_*` tools; edits, shell and
    fetches denied).
  Their events become steps (`stream.ts`): the session, each tool call in
  Dashi's words ("Opening signin.localhost", "Signed in to signin.localhost"),
  how it went, what it said, how it ended. "Steps: N" said before its first
  call is the "about M" of "step 3 of about 6".
- **Each harness's mark.** Its row, the grants card's field, a run's row
  and card, and the chip show the harness's own glyph (`harness-icons.ts`):
  a starburst for Claude Code, a knot of three links for Codex, a block in
  brackets for OpenCode, Dashi's drawings in one color (shiso), never the
  companies' artwork; any other harness gets the agents' sparkle. The done
  notification's icon is the same mark on a shiso tile
  (`shell/icons/claude-code.svg`, `codex.svg`, `opencode.svg`, and
  `agents.svg` for the rest).
- **The menu bar chip.** One chip while any run works: the newest's words
  ("Codex · Opened signin.localhost"), "2 agents · Codex is signing in" with
  more, shiso; broth (amber), "Codex needs you", while one waits on the
  person (`chip.ts`). Click: the panel (380 wide) with each run's card,
  waiting first, then newest first: its words, harness, time, "step N of
  about M", its last three steps (never a transcript), Show (the whole log,
  `log.txt` beside its streams, in Text Editor) and Stop; a finished run
  stays an hour, with Undo for each settings change it made.
- **Questions in the panel.** A run's questions go on its card: a website
  (Allow, Always, Don't), which login (Allow for this task, Once, Other
  login… when there is more than one, Don't), a hand-over (do it, then Done), another permission, one
  action. A yes counts only from the person's own press on the panel
  (`input-origin`, as on a sheet); an answer closes the panel, so what Dashi
  types next (a login, a code) reaches the person's window, not the panel.
  A question shows in one place at a time (`route.ts`): on the card while
  the panel is open, no sheet; while it is closed, the existing sheet (the
  hand-over's banner for a hand-over), the chip amber and, the first time,
  a notification ("Codex needs you · Use signin.localhost? · For “…”").
  Opening the panel takes the sheet down; closing it unanswered puts the
  sheet back up. The first answer, on the card or the sheet, settles it and
  the other comes down; a later press counts for nothing. The same holds
  for a website, a login, a hand-over, another permission and an action. A
  payment has only dashi-secretd's fingerprint or password sheet (that is
  the proof; the card's step reads "Paying …"). A site allowed (not
  always) holds for the whole run, through its follow-ups.
- **The empty launcher** lists up to three runs first, under **Agents**
  (waiting on the person, then working, then ended in the last hour): ↩
  opens its card in the panel, ⇥ turns the field into words to it ("Tell
  Codex something"; Return sends them), ❖⌫ stops a working one.
- **Follow-ups** go into the run's own session (`follow-up.ts`): an ended
  run is resumed with the words; a working one is stopped where it is and
  resumed with them ("The person stopped you to add this…"), since a
  headless harness hears nothing until its turn ends; words for a run still
  starting wait for its session; a run that failed before it had one starts
  over with the request and the words.
- **Done.** A normal notification with the run's last words (its first line
  the title, the rest the body), Show (its card) and Follow up (the launcher
  talking to it). A run the person stopped posts none.
- **Settings › Agents** has "Hand off to" (the installed harnesses as
  pills; `agents.handOff`) beside "Answer requests with", and "Don't ask for
  these again".

- **A shell that restarts** picks its runs up again (`pickup.ts`,
  `records.ts`). Each run keeps a record beside its streams,
  `$XDG_RUNTIME_DIR/dashi-agents/<run>/run.json` (the request, the harness,
  when it started, its turn, unit and stream, the words sent to it since,
  the window its chip named, the sites allowed for the task, what Undo puts
  back, whether the person stopped it or was told it ended; never the
  context's text or a secret), written when any of that changes. A shell
  that starts lists the tasks' units still running (`systemctl --user
  list-units 'dashi-task-*'`) and the runs' folders: a run whose unit runs
  gets its card back from its record and its streams, read again from the
  start (its steps, its session, "step N of about M"), and its turn is read
  on as it grows, so new steps arrive, Stop stops its unit, ⇥ follows up;
  one ended in the last hour comes back as it ended, then, told of by a
  notification only if it ended while the shell was away; the files of one
  ended longer ago go. A running unit without a record (an older shell
  started it) comes back from its first prompt's words and the harness its
  stream reads as. The harness keeps working meanwhile: its bridge
  (`dashi-mcp --reconnect`, `mcp-relay.ts`) connects again for up to two
  minutes, says the client's `initialize` again, and answers a call that
  was on its way when the shell went with an error ("Dashi restarted before
  this finished. Try it again."); its sandbox binds the folder of the
  socket for tasks (`$XDG_RUNTIME_DIR/dashi-mcp.d/dashi-mcp.sock`, which
  the agents server also listens at), not the socket itself, so the
  restarted shell's socket shows inside. A question waiting when the shell
  went is lost with its call (the harness hears the error and may ask
  again).

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
`dashi://window/full-screen`. ⌥❖V is `dashi://clipboard/history`. The
screenshots are too: ⇧❖3 is `dashi://dashi/screenshot` (Screenshot of the
Screen), ⇧❖4 `…/screenshot-area` (Screenshot of an Area…), ⇧❖5
`…/capture` (Screenshot…, the toolbar that also records), on the window
focused when they were pressed; the launcher finds them by "screenshot",
"print screen", "snip" and the like. Chosen in the launcher, the shell
takes it down first and waits until it is gone (`main.tsx` `runCapture`),
so it isn't in the picture.

The other bind names move the same way, one kind at a time: give the
action an address in its source, change the rule's `bind` to it, delete
its `case` in `runBinding`, and move its test to the registry.

| Bind names now | Address | Source |
| --- | --- | --- |
| `lock-screen`, `force-quit`, `settings` | `dashi://dashi/lock-screen`, `…/force-quit`, `…/settings` | `dashi` (exists) |
| `quit-app`, `hide-app`, `minimize-window`, `close-window`, `next-window` | `dashi://window/quit-app` and so on, on the focused window | `windows` |
| `toggle-autohide` | `dashi://settings/desktop-dock/autohide` (exists: a toggle with no value switches) | `settings` |
| `space-left`, `space-right`, `space-1`…`space-9`, `overview` | `dashi://space/left`, `dashi://space/3`, `dashi://dashi/overview` | a `spaces` source |
| `volume-up`, `brightness-up`, `media-*`, `power-key` | `dashi://sound/volume-up` and so on | a `hardware` source |
| `launcher`, `switch-*`, `switcher-*`, `app-chord`, `app-erase` | stay names: they are the launcher and the switcher themselves, and `app-chord` and `app-erase` (❖⌫) are the app's own menu | |
