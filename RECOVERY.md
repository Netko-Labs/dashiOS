# Recovery notes (2026-11-01)

The original dashiOS checkout was lost when this PC was reinstalled from the
Dashi 44 beta image: Anaconda's `mkfs.btrfs` TRIMmed the whole NVMe partition,
and the drive reads deallocated blocks back as zeros, so nothing was
recoverable from disk. The repo had never been pushed.

This tree was rebuilt from the installed packages, all built from commit
`8ca85a9` on 2026-11-01 (`rpm -V` clean, so they match the build exactly).

Paths below are 0.1.0's; since then `shell/` is `packages/shell/`, and its
custom components moved to `packages/dashi-ui/`.

## Recovered as source

- `shell/`: the whole TypeScript shell, session supervisor, first-party apps,
  `bin/` helpers, icons, wallpapers, `package.json`, `tsconfig.json`,
  `bun.lock`. Typechecks clean against `../mirin` at `feat/metal-linux`
  (`27bafd2`, the commit `mirin-metal-host` was built from).
- `session/`: `dashi-session`, `dashi-mcp`, the Wayland session entry, the
  systemd user target, mimeapps and portal config.
- `spin/<package>/...`: every other file the Dashi packages installed,
  mirrored by install path (release files, kernel selection, NVIDIA, SDDM,
  live image, Helium defaults, logos and Plymouth theme).

## Lost

- `comp/`: the Rust source of `dashi-comp`, the Wayland compositor (smithay
  0.7, calloop, libinput, libseat, DRM/GBM, winit for nested runs). Only the
  binary survives; a copy and its strings are kept outside the repo, in
  `~/dashi-recovery/reference/`, as the reference for the rewrite.
- `shell/test/`: not packaged.
- RPM specs, the `spin/` image build (kickstart, COPR publishing), `vm/`.
- Git history.
