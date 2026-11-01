# Dashi 0.2.0

## 1. Monorepo and docs (`feat/monorepo`)

- [x] `shell/` → `packages/shell`, Bun workspace at the root
- [x] `packages/dashi-ui` (`@dashi/ui`): Dashi's own components, palettes,
      glyphs; Dark Mode through an appearance source the host connects
- [x] Session scripts and checkout paths follow the new layout
- [x] `docs/conventions.md`, `CLAUDE.md`/`AGENTS.md`, `docs/architecture.md`,
      `docs/compositor.md`, `docs/compositor-ipc.md`
- [x] VM: install, desktop, ssh, screenshot, type/key, stop (`vm/vm`)
- [ ] `bun run fmt-lint` clean (biome config from mirin; one formatting pass,
      its own commit)
- [ ] Shell tests (`packages/shell/test/`, lost with 0.1.0): parsers first

Acceptance: typecheck clean, every module loads, the shell runs from the
checkout in the VM on 0.1.0's dashi-comp.

## 2. Compositor rewrite (`crates/dashi-comp`)

Milestones C0–C4 in `docs/compositor.md`. Each ends with the shell running on
it in the VM.

## 3. Login screen

- [x] `packages/greeter`: greetd IPC, login flow, users, sessions, memory, power
- [x] `@dashi/ui` `LoginScreen`, shared with the lock screen (which now uses it)
- [x] `session/dashi-greeter`; `spin/dashi-greeter/etc/greetd/config.toml`
- [x] In the VM: greetd → greeter → PAM → the chosen session; lock/unlock
- [ ] One surface per screen (multi-monitor)
- [ ] Account pictures (AccountsService) instead of initials
- [ ] Keyboard layout and accessibility on the login screen
- [ ] `dashi-comp --greeter` (C1)

## 4. Packaging 0.2.0

- [ ] RPM specs (lost with 0.1.0): dashi, dashi-comp, dashi-greeter (replaces
      dashi-sddm; requires greetd),
      dashi-release, dashi-logos, dashi-kernel, dashi-nvidia, dashi-helium,
      dashi-live, dashi-bun, mirin-metal-host
- [ ] Build in the VM, install, boot into it
- [ ] Image build (kickstart) and COPR publishing

## Later

- [ ] Move `@dashi/ui` components that duplicate shadcn (Button, TextField,
      SearchField, Segmented, Table, Sheet, PopupMenu, the settings Slider and
      Switch) to `@mirinjs/metal-ui`, styled with Dashi's theme
- [ ] Theme tokens: Dashi's palettes as a metal-ui theme, so metal-ui
      components and `@dashi/ui` paint from the same colors
