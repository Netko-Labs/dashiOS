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
| H3 | No function over 80 lines (tests exempt). | Biome `noExcessiveLinesPerFunction`; `scripts/check-biome.ts` (`long-functions`) | `bun run fmt-lint`, `bun scripts/check-biome.ts` |
| H4 | Imports go one way: apps → `apps/kit` → `src/shared`. `src` never imports `apps`; an app never imports another app; apps reach `src` only through `src/shared`. | `scripts/check-structure.ts` (`import-ways`) | `bun scripts/check-structure.ts` |
| H5 | No import cycles. | Biome `noImportCycles`; `scripts/check-biome.ts` (`import-cycles`) | `bun run fmt-lint`, `bun scripts/check-biome.ts` |
| H6 | An `index.ts` only re-exports (`export … from`). An entry point is named `main.ts`, not `index.ts`. | `scripts/check-structure.ts` (`barrels`) | `bun scripts/check-structure.ts` |
| H7 | Data from outside is parsed, never cast: no `JSON.parse(…) as T`, no `as T` on a value typed `unknown` or `any` (IPC, D-Bus, files, subprocesses). | `scripts/check-boundaries.ts` (`json-casts`, `unknown-casts`) | `bun scripts/check-boundaries.ts` |
| H8 | The compositor is asked only through `src/compositor.ts`'s typed methods: no raw `request("…")` with an IPC method anywhere else. | `scripts/check-boundaries.ts` (`raw-requests`) | `bun scripts/check-boundaries.ts` |
| H9 | The IPC has one definition: every method is in `docs/compositor-ipc.md`, has a type in both languages, and says whether only the shell may call it. | not yet: the contract test with shared fixtures comes with 0.7's typed IPC (step 3) | |
| H10 | Exported functions in `.ts` files have explicit return types. Components in `.tsx` are exempt. | `scripts/check-boundaries.ts` (`return-types`) | `bun scripts/check-boundaries.ts` |
| H11 | Tests never wait on real time: a fake clock, and 2 s per test at most (`bunfig.toml`). | `bunfig.toml` `timeout`; `scripts/check-structure.ts` (`test-sleeps`, `test-timeouts`) | `bun run test`, `bun scripts/check-structure.ts` |
| H12 | Rust: no `unwrap()` outside tests; every `unsafe` block and `unsafe fn` documented; no blocking file or PNG work on dashi-comp's event loop. | `[workspace.lints]` in `Cargo.toml` (and `crates/dashi-term/Cargo.toml`), `clippy.toml`, `crates/dashi-comp/clippy.toml` | `cargo clippy --workspace --all-targets -- -D warnings` (and in `crates/dashi-term`) |
| H13 | Every shell script passes `bash -n` and shellcheck (every severity). | `scripts/check-shell.ts` (`shell-parse`, `shellcheck`) | `bun scripts/check-shell.ts` |
| H14 | Nothing generated is committed (bytecode, build output); `CLAUDE.md` and `AGENTS.md` match; every version matches. | `tools/check-repo` | `tools/check-repo` |
| H15 | Every dependency's licence is on the allowed list ("Licenses"), or listed with its reason. | `scripts/check-licenses.ts` (`license-exceptions`) | `bun scripts/check-licenses.ts` |
| H16 | Heavy libraries never load at shell start (the AI SDKs are banned there); the start-up module count has a ceiling. | `scripts/boot-weight.ts` (`boot-weight`) | `bun scripts/boot-weight.ts` |
| H17 | A system service Dashi ships scores 5.0 or better on `systemd-analyze security`. | `scripts/check-units.ts` (`unit-exposure`) | `bun scripts/check-units.ts` |

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

## Source Of Truth

- `docs/architecture.md`: process model, the session, IPC, how the pieces
  start and talk. Keep it synchronized with behavior changes.
- `docs/compositor.md`: dashi-comp's design, module map, and milestones.
- `docs/compositor-ipc.md`: the IPC protocol between dashi-comp and the shell.
  Both sides change in the same commit as this doc.
- `docs/conventions.md`: this rulebook.
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
| module | A folder or file with a clear public surface and private implementation details. Folder modules expose that surface through `index.ts` (re-exports only) or `mod.rs`. |
| `shared/` | A package-local reuse area for code sibling modules need. |
| public surface | A package's `exports`, the compositor's IPC (`docs/compositor-ipc.md`), and the Wayland protocols it serves. |

## Project Folder Structure

Dashi is an OS workspace: Rust crates, TypeScript packages, session and
packaging files, a VM. Keep those areas distinct, in mirin's order: `crates/`,
`packages/`, then the rest.

```txt
crates/
  dashi-comp/       the Wayland compositor (Rust, smithay)
  dashi-hardware/   the privileged hardware helper (docs/hardware.md)
  dashi-secretd/    the vault, its PAM helper and the Secret Service bridge (docs/secrets.md)
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

`../mirin` is a sibling checkout: `@mirinjs/metal`, `@mirinjs/metal-ui`, and
`mirin-metal-host` come from it. Use the mirin branch that goes with Dashi's
(for a release, the one `.mirin-branch` names; CI picks it the same way, see
"Verification").

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

## Import Direction And `shared/`

In `@dashi/shell`, imports go one way (H4): an app → `apps/kit` →
`src/shared`.

- `src/` never imports `apps/`. What both need lives in `src/shared/`.
- An app imports its own folder, `apps/kit`, `src/shared`, and other packages
  by name. It never imports another app; what two apps need moves to
  `apps/kit` (runtime) or `src/shared` (logic), or to `@dashi/ui` (components).
- No import cycles anywhere (H5).

Use `shared/` for reuse by sibling modules inside the same package.

- Put code in `shared/` only after at least two sibling modules need it.
- Keep `shared/` organized by concern (`shared/fs`, `shared/dbus`), not one
  catch-all helper file.
- Cross-package reuse graduates to an explicit package export or a small
  dedicated package; never reach into another package's `src/`.

Rust uses named modules instead of `lib/` or `shared/`: `state.rs`,
`events.rs`, `outbox.rs`, `hotplug.rs`, not `util.rs`.

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
  Avoid ad hoc string manipulation, and private `isRecord`s: use the shape's.
  Lists refuse at the first bad entry (`list`) unless losing one is harmless
  (`lenientList`, things on screen). `JSON.parse(…) as T` is a cast, not a
  parse (H7).
- Ask the compositor through `src/compositor.ts`'s typed methods, never a raw
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
  effects (H6). An entry point is `main.ts`.
- Keep helpers private to their module unless another module genuinely needs
  them.
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

- **Dashi's own code** is MIT. Code adapted from another MIT, BSD, ISC or
  Zlib project keeps its authors' notice in `THIRD-PARTY-NOTICES.md` and
  says where it came from in a comment.
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
extracted module by responsibility, and keep public imports stable through a
facade. Don't split into ten-line files with one importer either: a module
earns its own file by having a concern of its own.

## Tests

- Tests live in each package's `test/` (`*.test.ts`, `*.test.tsx`), Rust's in
  `#[cfg(test)]` modules and `crates/*/tests/`; `bun run test` and
  `cargo test` run them all.
- Tests never wait on real time (H11): no `Bun.sleep` or `setTimeout` waits;
  drive time with a fake clock. Each test has 2 s (`bunfig.toml`); one that
  needs more is a bug to fix, not a limit to raise. Each package's
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
bun scripts/check-boundaries.ts
bun scripts/check-shell.ts
bun scripts/boot-weight.ts
bun run typecheck
cargo fmt --all --check
(cd crates/dashi-term && cargo fmt --check)
bun scripts/check-licenses.ts
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
`/` turned into `-` (`v07/tooling` → `v07-tooling`) when mirin has it, and
otherwise the one in `.mirin-branch`.

Native behavior is checked in the VM: `vm/vm desktop`, then run the session
from the shared checkout or install the packages built from it. Never test a
compositor or shell change on the host's own session.

If a check cannot be run, state why and name the residual risk.

## Workflow

- Prefer the smallest safe change that solves the problem; follow existing
  patterns before introducing new abstractions; fix root causes.
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
