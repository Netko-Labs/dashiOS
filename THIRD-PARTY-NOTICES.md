# Third-party notices

Dashi is MIT (`LICENSE`), and stays MIT. Two kinds of other people's work are
in the packages, and each travels with its package as `%license` files under
`/usr/share/licenses/<package>/`.

**Libraries Dashi links or bundles.** Each package's `LICENSE.dependencies`
lists every library in it with its license, then carries the license and
notice texts those libraries ship. They are written from the lockfiles by
`spin/license-dependencies` (`--check` fails when one is stale or a package's
`License:` tag does not match its dependencies); nothing is kept by hand.

| Package | Its `LICENSE.dependencies` is in | Covers |
| --- | --- | --- |
| `dashi-comp` | `spin/dashi-comp/usr/share/licenses/dashi-comp/` | the compositor's crates |
| `dashi-hardware` | `spin/dashi-hardware/usr/share/licenses/dashi-hardware/` | the hardware helper's crates |
| `dashi-secretd` | `spin/dashi-secretd/usr/share/licenses/dashi-secretd/` | the vault's crates |
| `dashi-term` | `spin/dashi-term/usr/share/licenses/dashi-term/` | the terminal engine's crates |
| `mirin-metal-host` | `spin/mirin-metal-host/usr/share/licenses/mirin-metal-host/` | mirin's Metal host and its crates |
| `dashi` | `spin/dashi/usr/share/licenses/dashi/` | the npm packages bundled with the shell (`spin/vendored-modules`): React, the Anthropic and OpenAI SDKs (Apache-2.0), OpenTelemetry's API (Apache-2.0), `fast-sha256` (Unlicense) and the rest |

**Code adapted from other projects** keeps its authors' notice below, with the
files it is in.

## smithay (MIT)

Adapted from smithay 0.7.0's smallvil and anvil examples and its
`wayland::xdg_foreign` module (<https://github.com/Smithay/smithay>):
`crates/dashi-comp/src/backend/winit.rs`, `src/handlers/xdg_shell.rs`,
`src/input/mod.rs`, `src/wm/grabs/move_grab.rs`, `src/wm/grabs/resize_grab.rs`,
`src/protocols/xdg_foreign.rs`.

```
MIT License

Copyright (c) 2017 Victor Berger and Victoria Brekenfeld

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
