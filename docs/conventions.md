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

## Source Of Truth

- `docs/architecture.md`: process model, the session, IPC, how the pieces
  start and talk. Keep it synchronized with behavior changes.
- `docs/compositor.md`: dashi-comp's design, module map, and milestones.
- `docs/compositor-ipc.md`: the IPC protocol between dashi-comp and the shell.
  Both sides change in the same commit as this doc.
- `docs/conventions.md`: this rulebook.
- `RECOVERY.md`: what was recovered from 0.1.0 and what was lost.
- `docs/*.html` (start at `docs/index.html`): the distro spec, brand
  guidelines, the mascot, and design guidelines. Plain HTML, CSS, and
  JavaScript in `docs/assets/`, no build step and nothing fetched. Values on
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
| module | A folder or file with a clear public surface and private implementation details. Folder modules expose that surface through `index.ts` or `mod.rs`. |
| `lib/` | A module's private implementation area. |
| `shared/` | A package-local reuse area for code sibling modules need. |
| public surface | A package's `exports`, the compositor's IPC (`docs/compositor-ipc.md`), and the Wayland protocols it serves. |

## Project Folder Structure

Dashi is an OS workspace: one Rust compositor, TypeScript packages, session and
packaging files, a VM. Keep those areas distinct, in mirin's order: `crates/`,
`packages/`, then the rest.

```txt
crates/
  dashi-comp/       the Wayland compositor (Rust, smithay)
packages/
  shell/            @dashi/shell: session supervisor, shell, system services, first-party apps
  greeter/          @dashi/greeter: the login screen (greetd's greeter)
  dashi-ui/         @dashi/ui: Dashi's own components and palettes
session/            dashi-session, dashi-mcp, the session target, portal and mime config
spin/               packaging and image files, by package
vm/                 the development VM (vm/vm)
docs/               architecture, compositor, IPC, and convention docs
tasks/              todo.md and lessons.md
```

`../mirin` is a sibling checkout (`feat/metal-linux`): `@mirinjs/metal`,
`@mirinjs/metal-ui`, and `mirin-metal-host` come from it.

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

Use `lib/` for private implementation under the nearest module.

- Only the parent module imports from its `lib/`.
- Do not export `lib/` paths through package `exports`.
- Do not import from another module's `lib/`; promote the code to `shared/` or a
  named module if it is genuinely reused.
- `lib/` should not contain entrypoints, side-effectful boot code, or public API
  declarations.

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
  parser or type guard before use.
- Exported functions, public class methods, and package-surface helpers need
  explicit return types.
- Optional fields must be genuinely optional.
- Prefer `??`, `??=`, spread, `.map`/`.filter`, `Set`, and `Map` over sentinel
  logic and lookup loops. Prefer positive predicates (`isReady`, `hasWindow`).
- Parse JSON, IPC frames, D-Bus replies, config, and subprocess output with
  structured parsers; avoid ad hoc string manipulation.
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
  effects.
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
  invariants and says which.

## Rust Safety

- Keep `unsafe` blocks as small as practical, in the lowest-level module that
  owns the invariant, each with a nearby `SAFETY:` comment.
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

## File Size And Splitting

Target normal source files at 300 lines or less. When a file exceeds that,
split by concern before adding more behavior, name the extracted module by
responsibility, and keep public imports stable through a facade. Line count is
a smell, not a machine rule.

## Tests

- Pure helpers need unit tests when touched: parsers, layout math, IPC
  framing, key handling, recurrence, sort order.
- Compositor and UI behavior is verified in the VM (`vm/vm desktop`), not on
  the session you are working in.
- Bug fixes add the smallest test that would have caught the bug when
  practical.
- If a behavior is hard to automate, write the manual reproduction steps in
  the relevant doc or handoff.

## Verification

Run the relevant subset before handoff:

```sh
git diff --check
bun run fmt-lint
bun run typecheck
bun run test
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo build --workspace
cargo test --workspace
```

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
- Branch off `main` before committing; commit at logical checkpoints with a
  conventional subject (`feat`, `fix`, `docs`, `refactor`, `perf`, `test`,
  `chore`, `build`, `ci`, `security`). Push every branch: the 0.1.0 source was
  lost because it lived on one disk.
