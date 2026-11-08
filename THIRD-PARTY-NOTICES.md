# Third-party notices

Dashi is MIT (`LICENSE`). Code in this repository adapted from other projects
keeps its authors' notices here. Libraries Dashi depends on carry their own
licenses in their packages (crates.io, npm, the distribution).

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
