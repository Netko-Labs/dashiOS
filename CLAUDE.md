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
- mirin is a sibling checkout at `../mirin`, branch `feat/metal-linux`.

## Source Of Truth

- `docs/architecture.md` - process model, session startup, IPC, how the pieces
  talk.
- `docs/compositor.md` - dashi-comp's design, module map, and milestones.
- `docs/compositor-ipc.md` - the compositor/shell IPC protocol; both sides and
  this doc change together.
- `docs/applets.md` - the applets channel (programs' items in the menu bar,
  beside tray icons); the protocol, its limits, and examples.
- `docs/conventions.md` - shared code-style, structure, safety, and verification
  rules.
- `RECOVERY.md` - what was recovered from 0.1.0 and what was lost.
- `docs/*.html` - the illustrated guides (open `docs/index.html`): the distro
  spec, brand guidelines, the mascot, and design guidelines (tokens, type,
  spacing, chrome, motion, icons). A change to a color, a measure, or a
  motion updates them in the same commit.
- `tasks/todo.md` - the current plan and its checkpoints.

The shared code-style and structure rules live in:

@docs/conventions.md

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
- `packages/shell` - `@dashi/shell`: session supervisor (`src/session.ts`), shell
  (`src/main.tsx`), system services, first-party apps (`apps/*`, on `apps/kit`).
- `packages/greeter` - `@dashi/greeter`: the login screen, greetd's greeter.
- `packages/dashi-ui` - `@dashi/ui`: Dashi's own components and palettes.
- `session/` - `dashi-session`, `dashi-greeter`, `dashi-mcp`, `dashi-dialog`, session target, portal/mime config.
- `spin/` - packaging and image files, by package.
- `vm/` - the development VM (`vm/vm`).
- `docs/` - architecture, compositor, IPC, and convention docs.

## Commands

- Install dependencies: `bun install` (at the root; `../mirin` must be checked out)
- Typecheck: `bun run typecheck`
- Tests: `bun run test`
- Lint/format: `bun run fmt-lint` (fix: `bun run fmt-lint:fix`)
- Rust: `cargo build --workspace`, `cargo clippy --workspace --all-targets -- -D warnings`,
  `cargo fmt --all --check`, `cargo test --workspace`
- Metal host (in mirin): `cd ../mirin/crates/mirin-metal && cargo build --release --bin mirin-metal-host`
- VM: `vm/vm desktop` (boot), `vm/vm ssh` (shell in, user `dashi`), `vm/vm screenshot`,
  `vm/vm stop`; `vm/vm install` and `vm/vm live` boot an image. The VM sees
  `~/Developer` at `/home/dashi/Developer`.
- VM checkout runs (`DASHI_VM_PASSWORD` for the guest's sudo): `vm/vm checkout-greeter on`
  (greetd with this checkout's login screen; pick "Dashi (checkout)" there for this
  checkout's session), `vm/vm checkout-session on` (SDDM autologin into it instead).
- VM screenshots: QEMU reads the screen with `DASHI_VM_GPU=none`; with the default
  Venus GPU, `vm/vm screenshot` needs a running session (it presses the shell's ⇧❖3).

## Verification

- Start with the smallest relevant check, then broaden when shared contracts
  (IPC, `@dashi/ui`'s surface) or platform behavior are affected.
- Docs-only changes: `git diff --check`.
- TypeScript: `bun run typecheck`, the relevant `bun run test`, `bun run fmt-lint`.
- Rust: `cargo fmt --all --check`, clippy with `-D warnings`, build, tests.
- Compositor, shell, and UI behavior: check it in the VM.
- If a command cannot be run, record the reason and the remaining risk in the
  handoff.

## Git Rules

- Branch off `main` before committing; commit at logical checkpoints.
- Push branches as you go. Open a PR when asked.
- Never force-push, amend, rebase, squash, reset, or discard shared/user changes
  unless explicitly requested.
- The working tree may be dirty. Preserve unrelated changes and work with them.
