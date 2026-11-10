# CLAUDE.md - Dashi

Dashi is a desktop OS on Fedora: a Rust Wayland compositor (`dashi-comp`), a
TypeScript shell and first-party apps on Bun, and UI defined in React and
drawn natively by mirin Metal. This file applies to the whole repository
unless a deeper entry file overrides it.

Keep `CLAUDE.md` and `AGENTS.md` equivalent. If one changes, update the other in
the same change.

## Project Overview

- **Rust displays; TypeScript decides.** The compositor renders and routes
  input; every decision (placement, shortcuts, permissions, power, network,
  accounts) is the shell's, sent over IPC.
- **TypeScript defines the UI; mirin Metal draws it.** Surfaces are React
  through `@mirinjs/metal`, drawn by `mirin-metal-host` (GPUI).
- **Components:** `@mirinjs/metal-ui` (shadcn) for anything shadcn has;
  `@dashi/ui` for Dashi's own; app-local otherwise. See `docs/conventions.md`,
  "UI Components".
- Runtime and package manager: Bun. Compositor: smithay on calloop.
- mirin is a sibling checkout at `../mirin`, on the branch that goes with
  Dashi's (for a release branch, the one `.mirin-branch` names).

## Source Of Truth

- `docs/architecture.md` - process model, session startup, IPC, how the pieces
  talk.
- `docs/compositor.md` - dashi-comp's design, module map, and milestones.
- `docs/compositor-ipc.md` - the compositor/shell IPC protocol; both sides and
  this doc change together.
- `docs/applets.md` - the applets channel (programs' items in the menu bar,
  beside tray icons); the protocol, its limits, and examples.
- `docs/actions.md` - the action registry (every command at a `dashi://`
  address, shared by the launcher, the keymap, links, and agents' MCP tools),
  the address scheme, and the links socket.
- `docs/secrets.md` - the vault and secrets for agents: the socket protocol,
  sign-in, codes, passkeys, payments, the agent sandbox.
- `docs/hardware.md` - dashi-hardware's contract (the hardware helper's D-Bus
  interface, the model database, and cardwire's API); the service and its
  callers change with it.
- `docs/conventions.md` - shared code-style, structure, safety, and verification
  rules.
- `RECOVERY.md` - what was recovered from 0.1.0 and what was lost.
- `docs/*.html` - the illustrated guides (open `docs/index.html`): the distro
  spec and the design guidelines (`docs/design.html`: the brand, voice, the
  mascot, tokens, type, spacing, chrome, window management, motion, icons,
  components, and the numbered rules apps follow). A change to a color, a
  measure, or a motion updates them in the same commit.
- `tasks/todo.md` - the current plan and its checkpoints.

The shared code-style and structure rules live in `docs/conventions.md`. Read
it before changing code (an agent that expands includes gets it here):

@docs/conventions.md

## Hard Rules

A machine checks these on every push (`docs/conventions.md`, "Hard rules", has
each check and how to run it alone). `bun run check` runs them all, as CI does.
Each starts from a list of today's offenders in `scripts/lists/`: the list may
only shrink, so fix offenders, never add them, and trim the list
(`bun scripts/<check>.ts --shrink`) when you fix one.

- H1: every check runs on every push (CI, and `.githooks/pre-push` for the fast ones).
- H2: no file over 300 lines; a listed file may not grow.
- H3: no function over 80 lines (tests exempt).
- H4: imports go one way, apps → `apps/kit` → `src/shared`; `src` never imports `apps`, an app never imports another.
- H5: no import cycles.
- H6: an `index.ts` only re-exports; entry points are `main.ts`.
- H7: outside data is parsed, never cast: no `JSON.parse(…) as T`, no `as T` on `unknown`.
- H8: the compositor is asked only through `src/compositor.ts`'s typed methods.
- H9: the IPC has one definition in both languages and the doc (golden fixtures from the Rust types, parsed by the shell's shapes).
- H10: exported functions in `.ts` have return types (`.tsx` components exempt).
- H11: tests never wait on real time; 2 s per test.
- H12: Rust: no `unwrap()` outside tests, every `unsafe` documented, no blocking file or PNG work on dashi-comp's loop.
- H13: every shell script passes `bash -n` and shellcheck.
- H14: nothing generated is committed; `CLAUDE.md` and `AGENTS.md` match; versions match.
- H15: every dependency's licence is on the allowed list, or listed with its reason.
- H16: heavy libraries (the AI SDKs) never load at shell start; the count of library modules at start has a ceiling (Dashi's own modules don't count: splitting files adds them).
- H17: a system service scores 5.0 or better on `systemd-analyze security`.

Keep `CLAUDE.md` and `AGENTS.md` equivalent. If one changes, update the other in
the same change.

## Hard Constraints

- No policy in the compositor. If Rust is choosing, it is in the wrong place.
- No pixels from TypeScript. Shell and apps render through Metal only.
- Privileged Wayland protocols are granted per client by the shell.
- The session runtime is Bun (`dashi-bun` installs it at
  `/usr/libexec/dashi/bin/bun`). No Node shims.
- Never test compositor or shell changes on the host session; use the VM.
- Push branches to `Netko-Labs/dashiOS`: the 0.1.0 source was lost because it
  was never pushed.

## Repository Layout

- `crates/dashi-comp` - the Wayland compositor.
- `crates/dashi-hardware` - the privileged hardware helper (`docs/hardware.md`):
  firmware attributes, power profiles, the charge limit, fans, the SMU; the
  model database is `data/models/`, a captured laptop `data/fixtures/`.
- `crates/dashi-secretd` - the vault (`docs/secrets.md`): secrets agents can use but never read, its PAM helper, and the Secret Service bridge.
- `crates/dashi-term` - the terminal engine on libghostty-vt; a Cargo workspace of its own
  (its own `Cargo.lock`), checked like the others.
- `packages/shell` - `@dashi/shell`: session supervisor (`src/session.ts`), shell
  (`src/main.tsx`), system services, first-party apps (`apps/*`, on `apps/kit`),
  and Dashi's Helium extension (`browser-extension/`, docs/actions.md "Websites").
- `packages/greeter` - `@dashi/greeter`: the login screen, greetd's greeter.
- `packages/dashi-ui` - `@dashi/ui`: Dashi's own components and palettes.
- `packages/applet` - `@dashi/applet`: the applet SDK (client, popovers, manifest,
  packages, signatures, the `dashi-applet` CLI; `docs/applets.md`).
- `packages/shape` - `@dashi/shape`: the one parser for outside data (a shape is
  the parser, the type and a JSON Schema; `docs/conventions.md`, "TypeScript").
- `session/` - `dashi-session`, `dashi-greeter`, `dashi-mcp`, `dashi-agent` (the agent sandbox), `dashi-browser-host`, `dashi-dialog`, `dashi-applet`, session target, portal/mime config.
- `spin/` - packaging and image files, by package.
- `vm/` - the development VM (`vm/vm`).
- `docs/` - architecture, compositor, IPC, and convention docs.
- `data/` - the hardware model database (`data/models/`) and captured fixtures (`data/fixtures/`).
- `scripts/` - the hard-rule checks behind `bun run check`, and their lists (`scripts/lists/`);
  `tools/check-repo`; `.githooks/pre-push`; CI in `.github/workflows/check.yml`.

## Commands

- Install dependencies: `bun install` (at the root; `../mirin` must be checked out)
- Every check: `bun run check` (what CI runs); the quick ones: `bun run check:fast`.
  Pre-push hook: `git config core.hooksPath .githooks` once per checkout.
- Typecheck: `bun run typecheck`
- Tests: `bun run test`
- Lint/format: `bun run fmt-lint` (fix: `bun run fmt-lint:fix`)
- Rust: `cargo build --workspace`, `cargo clippy --workspace --all-targets -- -D warnings`,
  `cargo fmt --all --check`, `cargo test --workspace`; the same three in `crates/dashi-term`
  (its own workspace)
- Metal host (in mirin): `cd ../mirin/crates/mirin-metal && cargo build --release --bin mirin-metal-host`
- Packages: `spin/build-rpms [package...|all]` on the laptop (set up with
  `sudo dnf builddep spin/rpm/*.spec`; no VM needed), from a clean HEAD; RPMs in
  `~/rpmbuild/RPMS`. Publish: `spin/copr-publish` (the pejedev/dashi COPR).
- VM: `vm/vm desktop` (boot), `vm/vm ssh` (shell in, user `dashi`), `vm/vm screenshot`,
  `vm/vm stop`; `vm/vm install` and `vm/vm live` boot an image. The VM sees
  `~/Developer` at `/home/dashi/Developer`.
- VM checkout runs (`DASHI_VM_PASSWORD` for the guest's sudo): `vm/vm checkout-greeter on`
  (greetd with this checkout's login screen; pick "Dashi (checkout)" there for this
  checkout's session), `vm/vm checkout-session on` (SDDM autologin into it instead).
- Drive the VM through Dashi's own agent integration (dogfood it): `vm/agent`
  speaks MCP to the VM session's `dashi-mcp` over ssh (`vm/vm mcp`), the server
  any agent uses: `vm/agent screenshot [PNG]`, `vm/agent call TOOL JSON`
  (`launch_app`, `click`, `type_text`, `press_keys`, `record_screen`, …),
  `vm/agent batch -` for several calls; `vm/agent pointer X Y [right]` clicks the
  real pointer at a screenshot's pixels inside the session. A bare QMP click after
  a screenshot lands one menu bar item off: the agents' mark is in the bar only
  while an agent is connected. `.mcp.json` offers the same server to
  Claude Code as `dashi-vm`. The first call of each kind asks for consent on the
  VM's screen; allow it there once ("Always Allow"). `vm/vm ipc METHOD JSON` sends one
  compositor request from outside the session: only the methods anyone may
  ask (`session`, `outputs`, `gpus`; docs/compositor-ipc.md, "Who may ask").
- Start the VM as its own user unit, so it outlives the shell that started it:
  `systemd-run --user --unit=dashi-vm --collect vm/vm desktop`.
- VM screenshots: QEMU reads the screen with `DASHI_VM_GPU=none`; with the default
  Venus GPU, `vm/vm screenshot` uses `vm/agent` (works mid-drag), else presses the
  shell's ⇧❖3 (needs a running session).

## Verification

- Start with the smallest relevant check, then broaden when shared contracts
  (IPC, `@dashi/ui`'s surface) or platform behavior are affected. Before you
  push: `bun run check` (or at least `bun run check:fast`).
- Docs-only changes: `git diff --check`.
- TypeScript: `bun run typecheck`, the relevant `bun run test`, `bun run fmt-lint`,
  and the hard-rule scripts (`docs/conventions.md`, "Verification").
- Rust: `cargo fmt --all --check`, clippy with `-D warnings`, build, tests;
  `crates/dashi-term` too.
- Compositor, shell, and UI behavior: check it in the VM.
- If a command cannot be run, record the reason and the remaining risk in the
  handoff.

## Git Rules

- Branch from the current release branch, `release/X.Y.0`, and merge back into
  it; `main` gets releases only. Commit at logical checkpoints.
- Push branches as you go. Open a PR when asked.
- Never force-push, amend, rebase, squash, reset, or discard shared/user changes
  unless explicitly requested.
- The working tree may be dirty. Preserve unrelated changes and work with them.
