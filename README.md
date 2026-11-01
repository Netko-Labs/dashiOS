# dashiOS

A desktop OS on Fedora. Rust displays; TypeScript decides.

- `comp/`: `dashi-comp`, the Wayland compositor (Rust, smithay).
- `shell/`: the shell, session supervisor, and apps (TypeScript on Bun).
  TypeScript defines the UI; mirin Metal (`../mirin`, `mirin-metal-host`)
  draws it natively.
- `session/`: the login entry point and session files.
- `spin/`: packaging and image files.

The rule: Rust for displaying, TypeScript for server logic.

Expects mirin checked out next to this repo (`../mirin`). See RECOVERY.md.
