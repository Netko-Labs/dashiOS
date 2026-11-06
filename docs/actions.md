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
| `dashi` | `dashi://dashi/lock-screen`, `…/sleep`, `…/restart`, `…/shut-down`, `…/log-out`, `…/force-quit`, `…/settings`, `…/about`, `…/shortcuts` | the Dashi menu's own action; Restart, Shut Down, and Log Out ask first |
| `settings` | `dashi://settings/<pane>`; `dashi://settings/<pane>/<row>` for every setting `set_setting` knows | opens the pane; a row's toggle or pick runs `set_setting` as the person |
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
  "Answer requests with" a local model (first), Claude, or none;
  settings.json `agents.answerer` (`"local" | "claude" | "none"`, unset until
  the person picks) and `agents.localModel`. A local model is Ollama on
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
  where it is from the token list, without asking for the token. No other
  network path.
- **Asking.** An Ask row is added last, never selected for you, when an
  answerer is chosen and the words read like a request (three or more
  words, a verb first, or a "?"; not a sum the launcher answers), or after
  ⇥ (a launcher-only rule, `Tab|ISO_Left_Tab` → `launcher-tab`). It says
  where the words go ("Claude · Anthropic, your key", "Local · stays on this
  computer"). With nothing picked yet, ⇥ offers "Set up an agent…"; "None"
  hides Ask. Only the typed words are sent.
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
  words. ⇥ goes back to the words to edit them; Esc leaves the plan running.
- **Now.** An empty launcher lists, above Recent, a pending "Your turn"
  (Return brings its window forward), the launcher's own tasks (Return shows
  the plan), and the agents connected over MCP with what each is doing; each
  has a shiso dot and a stop square.
- **History.** "history" in the launcher and the list in Settings › Agents
  read `activity.jsonl` (an MCP agent's calls grouped by connection) and
  `tasks.jsonl` beside it (one line per plan: the request, each step's words
  and how it went, and the value to put back), with Undo for settings
  changes.

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
`dashi://window/full-screen`. ⌥❖V is `dashi://clipboard/history`.

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
