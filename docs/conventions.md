# Conventions

Shared code-style and structure rules for Dashi. `CLAUDE.md` and `AGENTS.md`
are equivalent repository entrypoints; this file is the durable rulebook they
both reference. It follows mirin's (`../mirin/docs/conventions.md`), adapted to
an OS: where the two disagree for Dashi's code, this file wins; for mirin's
code, mirin's does.

## The Rule

**Rust displays; TypeScript decides.**

- Rust (`crates/dashi-comp`) puts pixels on screens and routes input: Wayland
  protocols, rendering, DRM/KMS, libinput, Xwayland, window geometry
  mechanics, animations. It does not decide policy.
- TypeScript on Bun (`packages/*`) is the server logic: where a window opens,
  what a shortcut does, who may capture the screen, power, network, accounts,
  D-Bus, settings. It tells the compositor what to do over IPC; the compositor
  carries it out and reports back.
- TypeScript defines the UI. Every Dashi surface (menu bar, Dock, sheets,
  Settings, the apps, the login screen) is React rendered through
  `@mirinjs/metal`, and mirin's Metal host (`mirin-metal-host`, GPUI) draws it.
  Shell and apps never draw pixels themselves.

When a feature needs both, split it at that line: the compositor exposes a
mechanism (an IPC request, an event), the shell owns the decision. A policy
that creeps into Rust is a bug to move.

## Hard Rules

A hard rule is one a machine checks on every push. Everything else in this
file is guidance that people and agents keep. `bun run check` runs every check
below, the same command CI runs (`.github/workflows/check.yml`);
`bun run check:fast` runs the quick ones (about 15 s) and is the pre-push hook.

| # | Rule | Checked by | Run alone |
| --- | --- | --- | --- |
| H1 | Every check runs on every push: lint, typecheck, tests, `cargo fmt`, clippy, `cargo test`, `dashi-term` included. | CI (`.github/workflows/check.yml`); `.githooks/pre-push` for the fast ones | `bun run check` |
| H2 | No file over 300 lines. A listed file may not grow. Generated code (`ffi_generated.rs`) is exempt. | `scripts/check-structure.ts` (`long-files`) | `bun scripts/check-structure.ts` |
| H3 | No function over 80 lines (tests exempt), counted as written: from the line it starts on to the line its body ends on, JSX, comments and blank lines included. | `scripts/check-structure.ts` (`long-functions`; the measure is `scripts/function-lines.ts`). Biome's `noExcessiveLinesPerFunction` stays on as an early warning, but its count is short (decisions.md D41). | `bun scripts/check-structure.ts` |
| H4 | Imports go one way: apps → `apps/kit` → `src/shared`. `src` never imports `apps`; an app never imports another app; apps reach `src` only through `src/shared`. | `scripts/check-structure.ts` (`import-ways`) | `bun scripts/check-structure.ts` |
| H5 | No import cycles. | Biome `noImportCycles`; `scripts/check-biome.ts` (`import-cycles`) | `bun run fmt-lint`, `bun scripts/check-biome.ts` |
| H6 | An `index.ts` only re-exports (`export … from`). An entry point is named `main.ts`, not `index.ts`. | `scripts/check-structure.ts` (`barrels`) | `bun scripts/check-structure.ts` |
| H7 | Data from outside is parsed, never cast: no `JSON.parse(…) as T`, no `as T` on a value typed `unknown` or `any` (IPC, D-Bus, files, subprocesses), nor on what a check leaves of one (`object`, `{}`, a list of unknown, a `Record<string, unknown>`; decisions.md D31, D42). | `scripts/check-boundaries.ts` (`json-casts`, `unknown-casts`) | `bun scripts/check-boundaries.ts` |
| H8 | The compositor is asked only through `src/compositor/client.ts`'s typed methods: no raw `request("…")` with an IPC method anywhere else. | `scripts/check-boundaries.ts` (`raw-requests`) | `bun scripts/check-boundaries.ts` |
| H9 | The IPC has one definition: every method is in `docs/compositor-ipc.md`, has a type in both languages, and says whether only the shell may call it. | `cargo test` (`ipc::fixtures`: one request, reply and event per method, written from the Rust types to `test/fixtures/ipc/`, failing until they are committed) and `bun test` (`packages/shell/test/ipc-contract.test.ts`: every fixture parses with the shell's shapes; the method table, the doc and `src/compositor/table.ts` name the same methods with the same who, and the same events) | `cargo test -p dashi-comp ipc::fixtures && bun test packages/shell/test/ipc-contract.test.ts` |
| H10 | Exported functions in `.ts` files have explicit return types. Components in `.tsx` are exempt. | `scripts/check-boundaries.ts` (`return-types`) | `bun scripts/check-boundaries.ts` |
| H11 | Tests never wait on real time: a fake clock, and 2 s per test at most (`bunfig.toml`). | `bunfig.toml` `timeout`; `scripts/check-structure.ts` (`test-sleeps`, `test-timeouts`) | `bun run test`, `bun scripts/check-structure.ts` |
| H12 | Rust: no `unwrap()` outside tests; every `unsafe` block and `unsafe fn` documented; no blocking file or PNG work on dashi-comp's event loop. | `[workspace.lints]` in `Cargo.toml` (and `crates/dashi-term/Cargo.toml`), `clippy.toml`, `crates/dashi-comp/clippy.toml` | `cargo clippy --workspace --all-targets -- -D warnings` (and in `crates/dashi-term`) |
| H13 | Every shell script passes `bash -n` and shellcheck (every severity). | `scripts/check-shell.ts` (`shell-parse`, `shellcheck`) | `bun scripts/check-shell.ts` |
| H14 | Nothing generated is committed (bytecode, build output), and no file holds a merge's conflict markers; `CLAUDE.md` and `AGENTS.md` match; every version matches. | `tools/check-repo` | `tools/check-repo` |
| H15 | Every dependency's licence is on the allowed list ("Licenses"), or listed with its reason; each package's `LICENSE.dependencies` and its spec's `License:` tag are current. | `scripts/check-licenses.ts` (`license-exceptions`); `spin/license-dependencies --check` | `bun scripts/check-licenses.ts`, `bun spin/license-dependencies --check` |
| H16 | Heavy libraries never load at shell start (the AI SDKs are banned there); the count of library modules at start has a ceiling (Dashi's own modules don't count: splitting files adds them). | `scripts/boot-weight.ts` (`boot-weight`) | `bun scripts/boot-weight.ts` |
| H17 | A system service Dashi ships scores 5.0 or better on `systemd-analyze security`. | `scripts/check-units.ts` (`unit-exposure`) | `bun scripts/check-units.ts` |
| H18 | Only a module's own files import its `lib/` (a test may, to test a private helper). `lib/` is never in a package's `exports` or `bin`, and holds no `main.ts`. | `scripts/check-modules.ts` (`lib-imports`) | `bun scripts/check-modules.ts` |
| H19 | From outside a module, import its `index.ts`, or a file its `index.ts` re-exports; never another file inside it. A test may also import the module's `lib/`, and a nested module's public files. Only an `index.ts` (or a file a package's `exports` names) re-exports: no file keeps an old import path alive. | `scripts/check-modules.ts` (`deep-imports`, `re-exports`) | `bun scripts/check-modules.ts` |
| H20 | A `shared/` concern is used by two sibling modules or more, and sits in a folder named for its concern: no loose files in `shared/`, no `utils/` or `helpers/`. | `scripts/check-modules.ts` (`shared-use`) | `bun scripts/check-modules.ts` |

### The lists

A check started from a list of the offenders the repository had when the rule
came in, in `scripts/lists/<name>.txt` (`count<TAB>key`: a file and its line
count, a file and how many casts it holds). It fails when:

- anything not on the list offends (a new offender);
- a listed entry's count goes up (a listed file grew);
- a listed entry no longer offends, or its count went down: trim the list.

So a list only shrinks. After fixing offenders, `bun scripts/<check>.ts
--shrink` lowers the list to today's counts; it never adds an entry or raises a
count. Never add an entry by hand: fix the code. Rust keeps its list in the code
as `#[expect(clippy::…, reason = "…")]`, which fails once the offence is gone;
Biome's import cycles keep theirs as `biome-ignore lint/nursery/noImportCycles`
comments, which Biome reports once they are stale. A list's header says what
its count means.

A listed file you move with `git mv` keeps its entry without a hand edit: the
check names the new path, and `--shrink` (or `bun scripts/list-rename.ts`, for
every list at once) carries the entry there at the same count. It reads git's
rename detection, staged or committed; for a move git did not see, give the
pair: `bun scripts/list-rename.ts OLD NEW`. It never adds an entry.

## Source Of Truth

- `docs/architecture.md`: process model, the session, IPC, how the pieces
  start and talk. Keep it synchronized with behavior changes.
- `docs/compositor.md`: dashi-comp's design, module map, and milestones.
- `docs/compositor-ipc.md`: the IPC protocol between dashi-comp and the shell.
  Both sides change in the same commit as this doc.
- `docs/conventions.md`: this rulebook.
- `docs/decisions.md`: the decision log: how to decide a dilemma, and the
  calls already made, each with why, its cost and how to undo it.
- `RECOVERY.md`: what was recovered from 0.1.0 and what was lost.
- `docs/*.html` (start at `docs/index.html`): the distro spec and the design
  guidelines (`docs/design.html`: brand, voice, the mascot, and the rules
  apps follow). Plain HTML, CSS, and JavaScript in `docs/assets/`, no build
  step and nothing fetched. Values on
  them come from the code and name their source; a change to a color, a
  measure, a motion, or the brand updates them in the same commit.
- Code is allowed to move, but source-of-truth docs move with the behavior in
  the same change.

## Vocabulary

| Term | Meaning |
| --- | --- |
| compositor | `crates/dashi-comp`, the Wayland compositor (Rust, smithay). |
| shell | `packages/shell` (`@dashi/shell`): the session supervisor, menu bar, Dock, sheets, System Settings, and the system services written in TypeScript. |
| apps | `packages/shell/apps/*`: the first-party apps, one Bun process and one Metal window each, built on `apps/kit`. |
| app kit | `packages/shell/apps/kit`: the runtime a first-party app runs on (window, menus, clipboard, control socket). Not components. |
| greeter | `packages/greeter` (`@dashi/greeter`): the login screen, greetd's greeter. |
| Dashi UI | `packages/dashi-ui` (`@dashi/ui`): Dashi's own components and palettes. |
| metal-ui | `@mirinjs/metal-ui` (mirin): shadcn/ui ported to Metal. |
| Metal host | `mirin-metal-host`: mirin's native process that draws a React tree with GPUI. |
| session | `session/`: the login entry point (`dashi-session`), the systemd user target, session files. |
| spin | `spin/`: packaging and image files, by package. |
| VM | `vm/`: the development VM. |
| module | A folder with a clear public surface and private implementation details: a folder under `packages/shell/src/`, a concern under `src/shared/`, an app under `packages/shell/apps/`, or a folder under another package's `src/`. It exposes its surface through `index.ts` (re-exports only). A file outside every module folder is a module of one file; in Rust, a `mod.rs` and its files. |
| `lib/` | A module's private implementation area: the helpers, parsers, adapters, hooks, internal types, constants and values only that module uses. |
| `shared/` | A package-local reuse area: code that sibling modules in the same package use, by concern (`shared/dbus`, `shared/time`), never a place to drop unrelated helpers. |
| public file | A file at a module's top level that its `index.ts` re-exports: `types.ts` and the public pieces. |
| barrel/facade | An `index.ts` (or `mod.rs`) that declares a module's intentional public surface by re-exporting it, and does nothing else. |
| public surface | A package's `exports`, the compositor's IPC (`docs/compositor-ipc.md`), and the Wayland protocols it serves; inside a package, each module's `index.ts`. |

## Project Folder Structure

Dashi is an OS workspace: Rust crates, TypeScript packages, session and
packaging files, a VM. Keep those areas distinct, in mirin's order: `crates/`,
`packages/`, then the rest.

```txt
crates/
  dashi-comp/       the Wayland compositor (Rust, smithay)
  dashi-hardware/   the privileged hardware helper (docs/hardware.md)
  dashi-secretd/    the vault, its PAM helper and the Secret Service bridge (docs/secrets.md)
  dashi-voice/      Dashi's voice: speech to text and text to speech on this machine (docs/voice.md)
  dashi-term/       the terminal engine on libghostty-vt; a Cargo workspace of its own
packages/
  shell/            @dashi/shell
    src/              the session supervisor, the shell and its system services
    src/shared/       what src and the apps both use
    apps/             the first-party apps, one folder each
    apps/kit/         the app kit every app runs on
    bin/              the shell's helper programs (dashi-mcp, dashi-agent, …)
    browser-extension/ Dashi's Helium extension
  greeter/          @dashi/greeter: the login screen (greetd's greeter)
  dashi-ui/         @dashi/ui: Dashi's own components and palettes
  applet/           @dashi/applet: the applet SDK and the dashi-applet CLI (docs/applets.md)
  shape/            @dashi/shape: the one parser for outside data (shapes: parser, type, JSON Schema)
data/
  models/           the hardware model database (data/models/*.json, schema.json)
  fixtures/         captured hardware for tests (a laptop's sysfs, the capture script)
session/            dashi-session, dashi-greeter, dashi-mcp, dashi-agent, …, the session target, portal and mime config
spin/               packaging: spin/rpm/*.spec, each package's files, the image (spin/image)
vm/                 the development VM (vm/vm, vm/agent)
docs/               architecture, compositor, IPC, conventions; the illustrated guides
scripts/            the hard-rule checks (bun run check) and their lists (scripts/lists/)
tools/              tools/check-repo
.githooks/          the pre-push hook (git config core.hooksPath .githooks)
.github/workflows/  CI: check.yml
tasks/              todo.md and lessons.md
```

Target TypeScript package layout (each folder of `src/` and `apps/` is a module,
"`lib/` And `shared/`"):

```txt
packages/shell/
  src/
    main.tsx          the shell's entry point
    session.ts        the session supervisor's entry point
    menus/            a shell module (worked example below)
      index.ts        re-exports only: the module's public surface
      types.ts        its public types
      start.tsx       its public pieces, named for what they do
      controller.ts
      lib/            private: helpers, hooks, views, stores, internal types
    agents/           a large module: nested modules, each its own index.ts
      index.ts
      ask/
        index.ts
        lib/
      lib/
    shared/           what src modules and the apps both use, by concern
      dbus/
        index.ts
        types.ts
        connection.ts
        lib/          the wire: marshal, unmarshal, auth, signals, …
      time/
  apps/
    kit/              the app kit: index.ts, its public pieces, lib/
    calendar/         an app: its entry point, and everything else private
      main.tsx
      lib/
        model.ts
        grid/
        sheets/
        views/
        hooks/
packages/applet/src/  a library package: its `exports` are its public surface
  index.ts
  manifest.ts
  signing/            a folder module, as in the shell
    index.ts
    lib/
```

`../mirin` is a sibling checkout: `@mirinjs/metal`, `@mirinjs/metal-ui`, and
`mirin-metal-host` come from it. Use the mirin branch that goes with Dashi's
(for a release, the one `.mirin-branch` names: mirin's `main` since 0.9,
decisions.md D51; CI picks it the same way, see "Verification").

New packages go under `packages/<name>` with a scoped name (`@dashi/<name>`);
new Rust crates under `crates/<name>`, in the root Cargo workspace.

## UI Components

Pick a component's home in this order:

1. **`@mirinjs/metal-ui`** for anything shadcn/ui has (button, input, switch,
   slider, select, dialog, sheet, popover, menu, tabs, table, tooltip,
   calendar, …). Use it as shadcn documents it; do not wrap it to restyle it.
   If metal-ui lacks something shadcn has, fix it in mirin, not here.
2. **`@dashi/ui`** for components that are Dashi's own and that shadcn does not
   have: the grouped-row controls, the app window and its unified title bar,
   sheets in the Dashi style, the key sink, shortcut glyphs, Dashi's palettes.
   Follow metal-ui's conventions there too (props, `data-*` state, composition).
3. **The app or shell module** for a component only one place uses. Promote it
   to `@dashi/ui` when a second app or shell module needs it, not before.

`@dashi/ui` holds components and design tokens only: no D-Bus, no files, no
processes, no shell state. What it needs from the host (Dark Mode) comes in
through a small interface the host connects (`setAppearanceSource`).

Existing `@dashi/ui` components that duplicate a shadcn one move to metal-ui
over time; see `tasks/todo.md`.

## `lib/` And `shared/`

A module is a folder with one public surface: a folder under
`packages/shell/src/`, each concern under `src/shared/`, each app under
`packages/shell/apps/` (`kit` too), and each folder under another package's
`src/`. A file outside every module folder (`src/apps.ts`) is a module of one
file. `scripts/modules.ts` says the same in code. A module looks like this:

```txt
<module>/
  index.ts        re-exports only: the module's public surface (H6)
  types.ts        its public types
  <name>.ts(x)    the public pieces, named for what they do
  lib/            private: helpers, parsers, adapters, hooks, internal types, constants, values
```

- A module of one or two files needs no `lib/` and no `index.ts`.
- What is public is what other modules use: everything else goes in `lib/`.
  A public piece is at the module's top level and its `index.ts` re-exports
  it. A public type lives in `types.ts`, not in `lib/`.
- `lib/` may hold `types.ts`, `constants.ts`, `values.ts`, `parsers.ts`, and
  further folders when a category grows (`lib/grid/`, `lib/sheets/`).
- A module may hold nested modules: a folder inside it with its own
  `index.ts` is a module of its own, with its own `lib/`
  (`agents/ask/`). From outside the outer module, go through the outer
  module's `index.ts`; a test may also name the nested module's public
  files.
- An app's public surface is its entry point, `main.tsx`: nothing imports an
  app (H4), so it has no `index.ts`, and its other files are in `lib/`.
- No file re-exports another's names to keep an old import path alive (H19).
  When a name moves, its importers move with it; only `index.ts` re-exports,
  and a file a package's `exports` names (`@dashi/applet/protocol`).

Rules for `lib/` (H18):

- Only the module's own files import from its `lib/`: files in the folder
  that holds the `lib/`, at any depth.
- Never import another module's `lib/`. Code two modules need is promoted:
  to the module's public surface, to `shared/`, or to a package.
- `lib/` is never in a package's `exports` or `bin`, and holds no entry point
  (`main.ts`), no side-effectful start-up code and no public API declarations.

Imports between modules (H19):

- From outside a module, import its `index.ts`. Never a file inside it.
- A module may expose more than one public file, each re-exported by its
  `index.ts`. Name a public file instead of the index only when the index
  would load more than the importer needs, which `index.ts` does since Bun
  loads every file a barrel re-exports:
  - the importer runs in another process (an app, a program under `bin/`) or
    off the shell's start-up path, and the index would load the module's
    start-up (the choosers name `shared/file-browser/chooser-view.tsx`; the
    sheet pieces' users name `menus/sheets.tsx`);
  - the index would close an import cycle (H5): the module's start-up imports
    the importer.
  `bun scripts/entry-weight.ts --compare <base>` fails when a change makes an
  entry point load a module it did not load before; `--why ENTRY FILE` prints
  the imports that load a file. `bun run check` holds every entry point to
  `scripts/lists/entry-weight.tsv`, the modules each loads at start
  (`--check`): a module not listed for its entry fails, and so does a listed
  one it no longer loads (`--shrink` trims). A module an entry is meant to
  load from now on is added with `--update`, saying why in the commit. Both
  follow moves: a file regrouped into a module folder is not a new module.
- A type-only import may name `types.ts` directly; it loads nothing.
- Tests (in `test/`) import a module's public surface like any other file,
  and may also import its `lib/` files, so a private parser or hook gets its
  own unit test. A test imports nothing else inside a module. Exactly, as
  `scripts/check-modules.ts` counts it, a test may import:
  - a module's `index.ts`, and any file that `index.ts` re-exports by a
    relative path outside `lib/` (its public files), a nested module's
    included: a test of `agents/desktop`'s `Hands` names `hands.ts`, which
    `agents/desktop/index.ts` re-exports, even when `agents/index.ts` does
    not (decisions.md D7);
  - any file under any `lib/` of any module, nested modules' included (H18
    leaves tests out too);
  - a module of one file (a file outside every module folder).

  It may not import a file at a module's top level that the index does not
  re-export (an app's `main.tsx` included: an app has no index), at any
  depth of nesting. These count:
  static imports, `export … from`, type-only imports and `import("…")`.
  `mock.module("…")` paths do not: a test may mock any file. The fix for a
  test that needs a private helper of a public file is to move the helper to
  `lib/`, not to export it from the index for the test.

Rules for `shared/` (H20):

- Put code in `shared/` only after at least two sibling modules use it (the
  modules of `src/` and the apps, for `src/shared/`). Code that one module
  uses moves into that module's `lib/`.
- Keep `shared/` organized by concern (`shared/dbus`, `shared/time`,
  `shared/files`): every file in a concern's folder, never loose in
  `shared/`, never a catch-all (`utils/`, `helpers/`, `common/`).
- A concern is a module like any other: `index.ts`, `types.ts`, its public
  pieces, `lib/`.
- Shared code still has an owner and tests when it handles paths, D-Bus,
  processes, or files.
- Cross-package reuse graduates to an explicit package export or a small
  dedicated package; never reach into another package's `src/`.

The import direction (H4) is unchanged, and the module rules sit on it: an
app → `apps/kit` → `src/shared`. An app's own module boundary keeps its `lib/`
to itself; an app imports `apps/kit` and each `src/shared/<concern>` through
their `index.ts` (or a public file, to stay small: an app is its own
process). `src/` never imports `apps/`, and an app never imports another app.
No import cycles anywhere (H5).

Rust uses named modules instead of `lib/` or `shared/`: `state.rs`,
`events.rs`, `outbox.rs`, `hotplug.rs`, not `util.rs`. `mod.rs` is the facade.

Example, the menu bar's menus (`packages/shell/src/menus/`):

```txt
packages/shell/src/menus/
  index.ts          re-exports the public surface below
  types.ts          MenuAction, MenuEntry, MenuContext, Popover, MenuState, …
  options.ts        what startMenus is given, and the Menus it gives back
  start.tsx         startMenus: the popover surface, the sheets, the actions, wired
  controller.ts     MenuController, useMenus: which popover is open
  model.ts          what each menu holds, as data (buildMenu, barMenus)
  bar-keys.ts       the bar's keyboard ring (⌃F2)
  sheets.tsx        Panel, Button, SHEET_SIZE: the pieces other modules' sheets use
  status-menu.ts    a status item's rows
  launch.ts         findEntry, Help
  lib/
    actions.ts        carrying out a chosen row
    popover.tsx       the popover surface's tree
    popover-host.ts   the popover's state machine
    view.tsx          the dropdown
    place.ts          where a dropdown goes
    dialogs.tsx       the Restart, About and holding sheets on screen
    power-sheets.tsx  those sheets' views
    holding-place.ts  where the holding notice floats
    keystrokes.ts     the Edit menu's chords
    stores.ts         the stores Control Center runs
    wiring.tsx        start.tsx's wiring
    activity-monitor.ts
```

Avoid:

```txt
packages/shell/src/menus/
  model.ts          export type { MenuEntry } from "./model-types.ts";   kept for old paths
  start.tsx         export { aboutInfo } from "./wiring.tsx";            a second barrel
  view.tsx          private, but beside the public pieces, imported by other modules
```

## TypeScript

- No runtime `any`. Use `unknown` at external boundaries and narrow with a
  parser or type guard before use; never `as T` on `unknown` (H7).
- Exported functions in `.ts` files need explicit return types (H10); so do
  public class methods and package-surface helpers. React components in
  `.tsx` are exempt.
- Optional fields must be genuinely optional.
- Prefer `??`, `??=`, spread, `.map`/`.filter`, `Set`, and `Map` over sentinel
  logic and lookup loops. Prefer positive predicates (`isReady`, `hasWindow`).
- Parse JSON, IPC frames, D-Bus replies, config, and subprocess output with
  `@dashi/shape` (`packages/shape`), the one parser for outside data: a shape
  gives the parser (a typed value, or a refusal naming the field), the type
  (`Infer<typeof S>`, never written by hand beside it) and a JSON Schema.
  Avoid ad hoc string manipulation, and private `isRecord`s: use the shape's
  (`typeof x === "object"` followed by a cast is the same cast, and H7's
  check counts it).
  Lists refuse at the first bad entry (`list`) unless losing one is harmless
  (`lenientList`, things on screen). `JSON.parse(…) as T` is a cast, not a
  parse (H7).
- Ask the compositor through `src/compositor/client.ts`'s typed methods, never a raw
  `request("…")` (H8).
- Account for out-of-order async resolution: IPC requests, D-Bus calls, and
  sheets correlate by id or explicit state.
- Bun is the runtime. Use Bun and web APIs; `node:` modules where Bun provides
  them. No Node compatibility shims.

## TypeScript Modules

- `src/` contains production code only; tests live in `test/`.
- A package's public API is its `exports` map. Import other packages by name
  (`@dashi/ui`), never by a relative path into them.
- One concern per file or folder.
- `index.ts` barrels re-export only: no declarations, setup work, or side
  effects (H6). An entry point is `main.ts`. Only `index.ts` re-exports.
  A type is re-exported with `export type` (or `type` on the name): Bun
  loads each file alone and fails at run time on a type re-exported as a
  value. Every tsconfig sets `isolatedModules`, so `bun run typecheck` fails
  first.
- Keep helpers private to their module, in its `lib/` (H18), unless another
  module genuinely needs them; import other modules through their `index.ts`
  (H19). See "`lib/` And `shared/`".
- Prefer structured command arguments (`Bun.spawn([cmd, ...args])`) over shell
  strings. If shell text is unavoidable, quote it with a dedicated helper.

## Rust

- dashi-comp is one smithay compositor on one calloop event loop. Wayland and
  DRM state are touched only from that loop; work that blocks (file IO, EDID
  parsing, image decoding) goes to a thread and comes back as a calloop event.
- Protocol handlers (`handlers/`) translate Wayland requests into state
  changes; they do not decide policy. Policy arrives over IPC (`ipc/`).
- Backends (`backend/udev`, `backend/winit`) own DRM, GBM, libinput, libseat,
  and the nested window. Keep device handles and their unsafe details inside
  the backend that owns them.
- Use `pub(crate)` instead of `pub` unless the symbol is intentionally public.
- `mod.rs` files declare modules and re-export facades; no large
  implementations.
- Never `panic!` or `unwrap()` on input from clients, IPC, devices, or files: a
  bad client loses its connection, a bad IPC frame gets an error reply, a
  failed device is logged and skipped. `expect()` is only for impossible
  invariants and says which. Clippy denies `unwrap()` outside tests (H12).
- No blocking file or PNG work on the event loop (H12):
  `crates/dashi-comp/clippy.toml` disallows the calls; one that runs on a
  thread says so in an `#[expect(clippy::disallowed_methods, reason = "…")]`.

## Rust Safety

- Keep `unsafe` blocks as small as practical, in the lowest-level module that
  owns the invariant, each with a `SAFETY:` comment on the line above (clippy's
  `undocumented_unsafe_blocks`, H12); a public `unsafe fn` has a `# Safety`
  section.
- Wrap unsafe or native calls in small safe functions before the rest of the
  compositor uses them.
- Never expose raw device handles, file descriptors, or registries across
  module boundaries unless that module is the facade for them.

## State And Threading

- The compositor's state lives on its event loop. The shell's state lives in
  its Bun process. They meet only through IPC.
- IPC is newline-delimited JSON on `$XDG_RUNTIME_DIR/dashi-comp.sock`.
  Requests carry an id and get exactly one reply; events are unsolicited.
  Every frame is parsed and validated on receipt, on both sides.
- Keep lock lifetimes short; do not hold a lock across a call that can re-enter.

## Security Boundaries

Treat these as untrusted:

- Wayland clients and every request they send
- IPC frames (the socket is the user's, but a crashed or old shell may send
  anything)
- D-Bus messages and replies, polkit requests
- devices: EDID, input events, hotplug
- files read from the home directory or the network; Flathub metadata
- environment variable overrides, subprocess output
- an agent's MCP requests (`dashi-mcp`): the person at the screen consents
  first

Rules:

- Privileged Wayland protocols (screencopy, virtual input, layer-shell for
  non-shell clients, gamma) are granted per client by the shell's decision,
  never by default.
- Validate before joining paths, copying files, or running commands.
- The login screen never handles a password outside the greeter process and
  greetd; it is not logged, stored, or sent over IPC.
- Do not log secrets or full message bodies from D-Bus or IPC unless the
  output is explicitly diagnostic.

## Licenses

Dashi is MIT (`LICENSE`), and stays MIT. Nothing may change that.

- **Dashi's own code** is MIT. Code adapted from another MIT, BSD, ISC, Zlib
  or Apache-2.0 project keeps its authors' notice in `THIRD-PARTY-NOTICES.md`
  and says where it came from in a comment. Adapted Apache-2.0 code stays
  Apache-2.0: the notice names the files, says they were changed, and carries
  the project's `NOTICE` text if it has one. Nothing adapted may ask Dashi as
  a whole to take another license.
- **Libraries Dashi links or bundles**: permissive (MIT, BSD, Apache-2.0,
  ISC, Zlib; a choice that includes one of these), MPL-2.0 used unmodified
  as a library, or LGPL as a shared library from the system. Models and
  media: permissive, CC-BY (credited) or CC0. Check a model's *weights*
  license as well as its code's.
- **Copyleft or restricted code is never copied, ported or translated into
  Dashi** (GPL, AGPL, MPL, EPL, non-commercial). When Dashi needs what such a
  project does, it is written **clean room**: one person (or agent) reads the
  project and writes down only the facts (a protocol's bytes, a file format,
  behavior) in a spec with no code; someone who has never read the project
  implements from that spec. The spec names its source; the implementation
  names the spec.
- **A separate program** Dashi only runs or talks to (FFmpeg, wf-recorder,
  cardwire, Kdenlive) keeps its own license and may be installed with Dashi;
  name it and its license where it is wired in. Non-commercial terms, or
  anything that binds the person, are only ever **an opt-in the person
  chooses**, saying its license in words.
- A new dependency names its license in the commit that adds it; a license
  that is unclear counts as not permissive until checked.
- `scripts/check-licenses.ts` (H15) reads `bun.lock`, `Cargo.lock` and
  `crates/dashi-term/Cargo.lock` and allows MIT, MIT-0, Apache-2.0,
  BSD-2-Clause, BSD-3-Clause, 0BSD, ISC, Zlib and MPL-2.0, or a choice that
  includes one. Anything else goes in `scripts/lists/license-exceptions.txt`
  only after a person checks it, with the reason there and in the commit.

## File Size And Splitting

Files are 300 lines or less (H2) and functions 80 lines or less (H3); both are
machine rules now, with today's longer ones on shrink-only lists. When a file
nears the limit, split by concern before adding more behavior, name the
extracted module by responsibility, and keep public imports stable through the
module's `index.ts`: a split moves the private half to `lib/` and updates its
importers, and never leaves a file re-exporting what moved. Don't split into ten-line files with one importer either: a module
earns its own file by having a concern of its own.

## Tests

- Tests live in each package's `test/` (`*.test.ts`, `*.test.tsx`), Rust's in
  `#[cfg(test)]` modules and `crates/*/tests/`; `bun run test` and
  `cargo test` run them all.
- Tests never wait on real time (H11): no `Bun.sleep` or `setTimeout` waits;
  drive time with a fake clock. Each test has 2 s (`bunfig.toml`); one that
  needs more is a bug to fix, not a limit to raise. A test waits on the thing
  itself (a node to show, a call to be made: `shows()`, `until()`), never on
  a number of turns of the loop; and a check that reads the whole dependency
  tree or runs a build is a step of `bun run check`, not a test. A test that
  leaves the clock stopped doesn't stop it for the next (`test/real-clock.ts`,
  preloaded). Each package's
  `test/support/time.ts` has `settle()` (let React, mirin and promises
  finish), `until()` (a file, socket or process: turn the loop until a
  condition holds) and `fakeClock()` / `fakeClockEachTest()` (stop timers,
  `Date` and `Bun.sleep`; `clock.advance(ms)` moves them).
- Pure helpers need unit tests when touched: parsers, layout math, IPC
  framing, key handling, recurrence, sort order.
- Compositor and UI behavior is verified in the VM (`vm/vm desktop`), not on
  the session you are working in.
- Bug fixes add the smallest test that would have caught the bug when
  practical.
- If a behavior is hard to automate, write the manual reproduction steps in
  the relevant doc or handoff.

## Packaging

- Every package Dashi ships is a spec in `spin/rpm/` with its files under
  `spin/<package>/`; `spin/build-rpms` builds them from a clean HEAD and
  `spin/copr-publish` publishes them.
- A spec ships its licence (`%license`) and lists what it bundles (H15's
  licences, in `LICENSE.dependencies` or the spec's `License:` line).
- A spec that builds code runs its tests in `%check`.
- Versions agree everywhere (H14): the crates, the packages, the browser
  extension and `spin/build-rpms`.

## Services

- A systemd unit Dashi ships lives under `spin/<package>/usr/lib/systemd/`
  (system) or `…/user/` (the person's session).
- A system service is sandboxed: it scores 5.0 or better on
  `systemd-analyze security --offline=true` (H17); give it only the paths,
  devices and capabilities it uses.
- A D-Bus service's policy names who may call each method; polkit decides
  anything a person must allow.

## Verification

`bun run check` runs every check (the hard rules above, then typecheck, the
tests, and fmt, clippy and tests for every crate, `dashi-term` included) and
prints each step's exit code. `bun run check:fast` runs the quick subset.
Turn on the pre-push hook once per checkout:

```sh
git config core.hooksPath .githooks
```

The steps, to run one alone:

```sh
git diff --check
tools/check-repo
bun run fmt-lint
bun scripts/check-biome.ts
bun scripts/check-structure.ts
bun scripts/check-modules.ts
bun scripts/check-boundaries.ts
bun scripts/check-shell.ts
bun scripts/boot-weight.ts
bun scripts/entry-weight.ts --check
bun run typecheck
cargo fmt --all --check
(cd crates/dashi-term && cargo fmt --check)
bun scripts/check-licenses.ts
bun spin/license-dependencies --check
bun scripts/check-units.ts
bun run test
cargo clippy --workspace --all-targets --locked -- -D warnings
(cd crates/dashi-term && cargo clippy --all-targets --locked -- -D warnings)
cargo test --workspace --locked
(cd crates/dashi-term && cargo test --locked)
```

CI (`.github/workflows/check.yml`) runs `bun run check` on every push and pull
request in a Fedora 44 container, with `Netko-Labs/mirin` checked out beside
the repository. The mirin branch is the one named like Dashi's branch with
`/` turned into `-` (`v09/store` → `v09-store`) when mirin has it, and
otherwise the one in `.mirin-branch` (`main`). A fix Dashi needs in mirin goes
to mirin's `main` by pull request, from a branch named that way, so CI runs
on it before it lands.

Native behavior is checked in the VM: `vm/vm desktop`, then run the session
from the shared checkout or install the packages built from it. Never test a
compositor or shell change on the host's own session.

If a check cannot be run, state why and name the residual risk.

## Workflow

- Prefer the smallest safe change that solves the problem; follow existing
  patterns before introducing new abstractions; fix root causes.
- Facing a dilemma, read `docs/decisions.md` first: decide as it says, and
  add an entry in the commit when the call is new. Ask the owner only for what
  can't be undone (its Part A says which).
- Do not add dependencies unless the current stack cannot solve the problem
  cleanly.
- Keep changes scoped. Update docs, packaging, and version notes with the
  behavior they describe.
- Use `tasks/todo.md` for non-trivial work that needs a visible checklist, and
  `tasks/lessons.md` for failure modes after repeated corrections.
- Work branches from the current release branch, `release/X.Y.0`, and merges
  back into it; `main` gets releases only. Commit at logical checkpoints with
  a conventional subject (`feat`, `fix`, `docs`, `refactor`, `perf`, `test`,
  `chore`, `build`, `ci`, `security`). Push every branch: the 0.1.0 source was
  lost because it lived on one disk.
