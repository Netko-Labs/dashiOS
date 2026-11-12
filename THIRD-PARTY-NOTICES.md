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
| `dashi-voice` | `spin/dashi-voice/usr/share/licenses/dashi-voice/` | Voice's crates |
| `dashi-term` | `spin/dashi-term/usr/share/licenses/dashi-term/` | the terminal engine's crates |
| `mirin-metal-host` | `spin/mirin-metal-host/usr/share/licenses/mirin-metal-host/` | mirin's Metal host and its crates |
| `dashi` | `spin/dashi/usr/share/licenses/dashi/` | the npm packages bundled with the shell (`spin/vendored-modules`): React, its reconciler and scheduler (MIT) |

**Models Voice fetches** are not in any package: `dashi-voice` brings them to
the person's data folder when Voice is turned on (`docs/voice.md`, "The
models"; `crates/dashi-voice/src/models/manifest.rs` pins each file). Their
makers and licences, weights included:

| Model | By | Licence | Files from |
| --- | --- | --- | --- |
| Parakeet TDT 0.6B v3 | NVIDIA | CC-BY-4.0 | <https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx> (ONNX export by Ilya Stupakov, MIT), from <https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3> |
| Silero VAD | the Silero team | MIT | <https://huggingface.co/onnx-community/silero-vad>, from <https://github.com/snakers4/silero-vad> |
| Kokoro 82M | hexgrad | Apache-2.0 | <https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX-timestamped>, from <https://huggingface.co/hexgrad/Kokoro-82M> |
| Whisper large-v3-turbo | OpenAI | MIT | <https://huggingface.co/csukuangfj/sherpa-onnx-whisper-turbo> (ONNX export by the sherpa-onnx project, Apache-2.0), from <https://github.com/openai/whisper> |

Parakeet is used under the Creative Commons Attribution 4.0 International
licence (<https://creativecommons.org/licenses/by/4.0/>): "Parakeet TDT 0.6B
v3" by NVIDIA, unchanged but for its conversion to ONNX and 8-bit weights.
Settings shows the same credit where the models are offered.

**Programs Voice runs**, never linked, keep their own licences: eSpeak NG
(GPL-3.0-or-later) for phonemes, PipeWire's `pw-record` and `pw-play` (MIT),
curl (curl licence), and ONNX Runtime (MIT), which is loaded as Fedora's
shared library.

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

## misaki and Kokoro (Apache-2.0)

`crates/dashi-voice/src/engine/kokoro/phonemes.rs` turns eSpeak NG's phonemes
into the letters Kokoro was trained on. Which sound becomes which letter
follows the eSpeak fallback of misaki, Kokoro's own grapheme-to-phoneme
library (<https://github.com/hexgrad/misaki>, `misaki/espeak.py`), written
anew in Rust. `crates/dashi-voice/src/engine/kokoro/vocab.rs` is the table of
Kokoro's tokens, from the model's `tokenizer.json`
(<https://huggingface.co/hexgrad/Kokoro-82M>).

```
Copyright hexgrad and the misaki and Kokoro contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

## onnx-asr, sherpa-onnx and OpenAI Whisper (MIT, Apache-2.0, MIT)

No code was copied. The order in which Parakeet's exported models are called
(`crates/dashi-voice/src/engine/parakeet.rs`, `tdt.rs`) is the one onnx-asr
uses for the same files (<https://github.com/istupakov/onnx-asr>, MIT, Ilya
Stupakov); Whisper's decoding loop and the names of the exported models'
inputs (`engine/whisper/mod.rs`) are those of sherpa-onnx's export
(<https://github.com/k2-fsa/sherpa-onnx>, Apache-2.0); its spectrogram
(`engine/whisper/mel.rs`) is computed as OpenAI's Whisper computes it
(<https://github.com/openai/whisper>, MIT).
