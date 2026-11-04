# dashiOS

A desktop OS on Fedora. **Rust displays; TypeScript decides.**

- `crates/dashi-comp/`: the Wayland compositor (Rust, smithay).
- `packages/shell/`: `@dashi/shell`, the session supervisor, shell, system
  services, and first-party apps (TypeScript on Bun). TypeScript defines the
  UI; mirin Metal (`../mirin`, `mirin-metal-host`) draws it.
- `packages/dashi-ui/`: `@dashi/ui`, Dashi's own components. Anything shadcn
  has comes from `@mirinjs/metal-ui`.
- `session/`: the login entry point and session files.
- `spin/`: packaging and image files.
- `vm/`: the development VM.

Expects mirin checked out next to this repo (`../mirin`, `feat/metal-linux`).

Start with `docs/architecture.md` and `docs/conventions.md`. The plan is
`tasks/todo.md`; what survived 0.1.0 is in `RECOVERY.md`.
