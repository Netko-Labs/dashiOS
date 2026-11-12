# Voice

`dashi-voice` (`crates/dashi-voice`) hears what a person says and speaks in
Dashi's voice. Everything runs on the machine: no sound and no text leaves
it. This file is the contract between the service and the shell; both change
with it.

- **Listen:** the default microphone through PipeWire, only between `listen`
  and its end. Silero VAD drops the silence; Parakeet TDT 0.6B v3 turns the
  speech into words (25 European languages), and Whisper large-v3-turbo does
  for the languages Parakeet lacks.
- **Speak:** Kokoro 82M, played through PipeWire a sentence at a time, with
  each word's time so captions keep step. A stop is at once.
- **Models:** never in the package. The service fetches them when asked, to
  the person's data folder, each file pinned by commit and SHA-256.

The service decides nothing: the shell says when to listen, what to say, and
when to fetch. The key, the chip, the captions, `ask_person` and Settings ›
Voice are the shell's.

## What the shell does

1. **Connect** to `$XDG_RUNTIME_DIR/dashi-voice.sock` and send `subscribe`.
   The socket is there in every Dashi session (`dashi-voice.socket`, a user
   unit wanted by `dashi-session.target`); the service starts on the first
   connection. From a checkout, see "From a checkout".
2. **Is Voice ready?** `status` says which model sets are here. If `listen`
   or `speak` is false, Voice is off: Settings › Voice shows the sizes
   (`models`), and the person's "Turn On" sends `fetch`. Follow the `fetch`
   events for the progress bar; `models` again when the `models` event comes.
3. **The key goes down:** send `listen` (with the person's language). The
   reply comes once the microphone is open; the state is `listening`. Draw
   the meter from `level` events and the words so far from `partial` events.
   `listen` stops whatever was being said.
4. **The key comes up:** send `listen.stop`. Its reply carries the words;
   the state is `thinking` until then. Esc: `listen.cancel` (nothing is
   worked out).
5. **Say an answer:** send `speak`. For each sentence a `sentence` event
   comes as its first sound plays, with every word's start and end in
   milliseconds from that moment: show the sentence as the caption and move
   the highlight by the shell's own clock. `spoken` ends it. Esc, or the
   person talking: `speak.stop`.
6. **`ask_person`:** `speak` the question, wait for its `spoken` (`done`),
   then `listen` with `"until": "silence"`: the listen ends by itself when
   the person has spoken and gone quiet, and the `heard` event carries the
   answer. Give the wait a limit of the shell's own, and `listen.cancel` at
   the limit.
7. **Keep it warm:** when Voice is on and the session starts (or when the
   key's sheet opens), send `warm` so the first hold answers at once. Models
   unused for ten minutes are let go of, and loaded again when next needed
   (one to four seconds).
8. **The microphone pill** lights by itself: see "The microphone pill".

Nothing listens unless the shell asked, and a listen ends when the connection
that asked for it closes, when the microphone gives nothing for three
seconds, and after five minutes whatever happens.

## The socket

- `$XDG_RUNTIME_DIR/dashi-voice.sock`, mode 0600; `DASHI_VOICE_SOCKET` puts
  it elsewhere (`dashi-voice serve --socket PATH` too).
- Newline-delimited JSON, UTF-8, one message per line, as the compositor's
  IPC is framed (`docs/compositor-ipc.md`).
- Request: `{"id": <int>, "method": "<name>", "params": {...}}`. `params` may
  be left out when a method takes none.
- Reply, exactly one per request: `{"id": <int>, "result": <object>}` or
  `{"id": <int>, "error": "<words for the person>"}`. An unknown method, an
  unknown field or a bad value gets an `error`, never a dropped connection.
  A line that is not a request gets `{"id": null, "error": …}`.
- Replies may come out of order: `listen.stop` and `warm` wait on a model and
  are answered from a thread of their own, so `speak.stop` sent meanwhile is
  answered first. Correlate by `id`.
- Event, unsolicited, only after `subscribe`: `{"event": "<name>", ...}`.
- A request line is 1 MiB at most. A subscriber that stops reading for two
  seconds is dropped.
- Errors are sentences a person can read ("Voice can't listen yet: its
  listening models are not on this computer."): show them as they are.

### Who may ask

The person's own processes, and never an agent's. The socket is 0600, and
each connection is checked once from the kernel's word (`SO_PEERCRED`): a
caller of another user, or one whose cgroup is in a `dashi-agent-*` unit
(`session/dashi-agent`, the agent sandbox), is told
`agents may not use Voice themselves; ask the person through Dashi` and
dropped. An agent reaches the person's voice through the shell's tools
(`ask_person`), which the shell answers by talking to this socket itself.
The same rule as the vault's (`docs/secrets.md`).

## Methods

| Method | Params | Result |
| --- | --- | --- |
| `status` | none | `version`, `state`, `listen`, `speak`, `whisper` (each set here?), `fetching` |
| `subscribe` | none | `state`; events follow on this connection |
| `models` | none | `folder`, `fetching`, `sets[]` |
| `fetch` | `sets?` | `bytes` still to fetch, `fetching` |
| `fetch.cancel` | none | `{}` |
| `remove` | `sets?` | `{}` |
| `voices` | none | `default`, `voices[]` |
| `warm` | `listen?`, `speak?`, `language?` | `{}`, once the models are in memory |
| `listen` | `language?`, `until?`, `quiet_ms?`, `partials?` | `{}`, once the microphone is open |
| `listen.stop` | none | `text`, `speech_ms` |
| `listen.cancel` | none | `{}` |
| `speak` | `text`, `voice?`, `language?`, `speed?`, `queue?` | `id` |
| `speak.stop` | none | `{}` |

### `status`

```json
{"id":1,"method":"status"}
{"id":1,"result":{"version":"0.8.0","state":"idle","listen":true,"speak":true,"whisper":false,"fetching":false}}
```

`listen`, `speak` and `whisper` say whether each model set is on this
computer. Voice can be used when `listen` and `speak` are true.

### `subscribe`

```json
{"id":2,"method":"subscribe"}
{"id":2,"result":{"state":"idle"}}
```

### `models`

```json
{"id":3,"method":"models"}
{"id":3,"result":{"folder":"/home/alexk/.local/share/dashi/voice","fetching":false,"sets":[
  {"id":"listen","name":"Listening","about":"Hears what you say in 25 European languages.",
   "credit":"Parakeet TDT 0.6B v3 by NVIDIA (CC BY 4.0), ONNX export by Ilya Stupakov; Silero VAD by the Silero team (MIT).",
   "basic":true,"bytes":672862728,"have":0,"installed":false},
  {"id":"speak","name":"Speaking", "…":"…","basic":true,"bytes":334932491,"have":0,"installed":false},
  {"id":"whisper","name":"More languages","…":"…","basic":false,"bytes":1036613791,"have":0,"installed":false}]}}
```

`bytes` is the set's size and `have` what is already here (whole files, and
the part of one a stopped fetch left), so `bytes - have` is what a fetch
would bring. `basic` sets are the ones Voice needs. Show `credit` where the
set is offered: Parakeet's licence asks for it.

### `fetch`, `fetch.cancel`

```json
{"id":4,"method":"fetch"}
{"id":4,"result":{"bytes":1007795219,"fetching":true}}
{"id":5,"method":"fetch","params":{"sets":["whisper"]}}
{"id":6,"method":"fetch.cancel"}
{"id":6,"result":{}}
```

Without `sets`, the basic ones (`listen` and `speak`). The reply says how
many bytes will come and returns at once; progress comes as `fetch` events
and the end as `fetch` with `"done": true`, then `models`. When everything
asked for is already here: `{"bytes":0,"fetching":false}` and no events. One
fetch runs at a time (`Models are already being fetched.`). A cancelled or
failed fetch keeps what came: the next `fetch` goes on from there.

### `remove`

```json
{"id":7,"method":"remove","params":{"sets":["whisper"]}}
{"id":7,"result":{}}
```

Deletes the sets' files and lets go of their models in memory; without
`sets`, all of them (Voice is off again). A `models` event follows. Refused
while a fetch runs.

### `voices`

```json
{"id":8,"method":"voices"}
{"id":8,"result":{"default":"af_heart","voices":[
  {"id":"af_heart","name":"Heart","language":"en-US","language_name":"English (US)","installed":true},
  {"id":"bf_emma","name":"Emma","language":"en-GB","language_name":"English (UK)","installed":true}, "…"]}}
```

`default` is Dashi's voice. The second letter of an id says who speaks: `f`
a woman, `m` a man.

### `warm`

```json
{"id":9,"method":"warm","params":{"listen":true,"speak":true,"language":"en"}}
{"id":9,"result":{}}
```

Loads the models now. `language` picks which listening model (see
"Languages").

### `listen`, `listen.stop`, `listen.cancel`

```json
{"id":10,"method":"listen","params":{"language":"en"}}
{"id":10,"result":{}}
{"event":"state","state":"listening"}
{"event":"level","level":0.41}
{"event":"partial","text":"Open the"}
{"id":11,"method":"listen.stop"}
{"event":"state","state":"thinking"}
{"event":"heard","text":"Open the calendar.","speech_ms":1632}
{"event":"state","state":"idle"}
{"id":11,"result":{"text":"Open the calendar.","speech_ms":1632}}
```

- `language`: what is spoken, as a BCP 47 tag (`"en"`, `"pt-BR"`); only its
  first part is used. Without it, Parakeet tells which of its languages it
  hears.
- `until`: `"stop"` (the default: the key is held, `listen.stop` ends it) or
  `"silence"` (it ends by itself once the person has spoken and then been
  quiet for `quiet_ms`, 1200 unless given, 300 to 10000).
- `partials`: `false` turns the `partial` events off.

`listen.stop` hears a last eighth of a second (the key comes up as the last
word ends), then answers with the words. `text` is `""` when nothing was
said: silence is never turned into words. `speech_ms` is how long the speech
was once the silence was dropped. One listen at a time
(`Voice is already listening.`); `listen.stop` with none running is
`Voice is not listening.` A listen that ended by itself tells its words in
the `heard` event only.

`listen.cancel` closes the microphone and drops what was heard: no `heard`
event, no words worked out.

### `speak`, `speak.stop`

```json
{"id":12,"method":"speak","params":{"text":"It's ten past four. You have two meetings left."}}
{"id":12,"result":{"id":1}}
{"event":"state","state":"thinking"}
{"event":"state","state":"speaking"}
{"event":"sentence","id":1,"index":0,"text":"It's ten past four.","ms":1650,
 "words":[{"text":"It's","start":350,"end":520},{"text":"ten","start":570,"end":760},
          {"text":"past","start":800,"end":1080},{"text":"four.","start":1120,"end":1625}]}
{"event":"sentence","id":1,"index":1,"text":"You have two meetings left.","ms":1900,"words":["…"]}
{"event":"spoken","id":1,"reason":"done"}
{"event":"state","state":"idle"}
```

- `text`: up to 20000 bytes. It is cut into sentences; each is made into
  sound while the one before plays.
- `voice`: a voice's id. Without it, `language`'s first voice (`"en-GB"` →
  `bf_emma`, `"es"` → `ef_dora`); without both, Dashi's own (`af_heart`).
- `speed`: 0.5 to 2; 1 is the voice's own pace.
- `queue`: `true` says it after what is being said. Without it, a new
  `speak` takes the place of the old one, which ends with
  `"reason":"stopped"`.

The result's `id` names the utterance in its events. `speak.stop` stops the
sound at once and forgets what was queued; every utterance it ended gets a
`spoken` with `"reason":"stopped"`.

## Events

| Event | Fields | When |
| --- | --- | --- |
| `state` | `state` | The state changed (see "States"). |
| `level` | `level`, 0 to 1 | About 31 times a second while listening: the microphone's loudness (RMS on a decibel scale, −60 dBFS is 0). |
| `partial` | `text` | While listening: all the words so far. Each replaces the one before; `heard` replaces the last. |
| `heard` | `text`, `speech_ms` | A listen ended (by `listen.stop`, by silence, by the microphone ending, or at five minutes). Not after `listen.cancel`. |
| `sentence` | `id`, `index`, `text`, `ms`, `words[]` (`text`, `start`, `end`) | A sentence's first sound plays now. `ms` is how long it lasts; a word's `start` and `end` are milliseconds from now. |
| `spoken` | `id`, `reason` (`done`, `stopped`, `failed`), `error?` | An utterance ended. |
| `fetch` | `set?`, `file?`, `received`, `bytes`, `done`, `error?` | A fetch's progress, about five times a second: `received` of `bytes` over every file asked for. `done: true` ends it; with `error`, it failed or was cancelled. |
| `models` | none | Which models are here changed (a fetch ended, a set was removed): ask `models` again. |
| `error` | `message` | Something failed outside a request: the microphone gave no sound, a sentence could not be said. |

A word's `text` is the word as it was written, with its punctuation
(`"four."`). Word times come from the model's own token lengths. Where the
phonemes can't be matched to the words one to one (a number such as `1999`,
which is said as several words), the phrase's time is shared out by the
words' lengths, so a highlight there is close, not exact.

## States

| State | Meaning |
| --- | --- |
| `idle` | Nothing. |
| `listening` | The microphone is open. |
| `thinking` | Working: speech into words after a listen, or words into the first sound before speaking. |
| `speaking` | Sound is playing. |

One state at a time: `listening` wins over `speaking`, which wins over
`thinking`. `listen` → `listening` → `thinking` → `idle`; `speak` →
`thinking` → `speaking` → `idle`. The `heard` event comes before the state
goes back to `idle`, and a new `listen` may be sent as soon as `heard`
arrives.

## Languages

**Heard by Parakeet** (the `listen` set): bg, cs, da, de, el, en, es, et, fi,
fr, hr, hu, it, lt, lv, mt, nl, pl, pt, ro, ru, sk, sl, sv, uk.

**Heard by Whisper** (the `whisper` set): every other language Whisper knows
(ja, zh, ko, ar, hi, tr, he, th, vi, id, …). A `listen` with such a
`language` uses Whisper; without the set it is refused in words (`Voice
can't hear ja yet: that needs the More languages models, which are not on
this computer.`).

**Spoken** (Kokoro's voices that eSpeak NG can read for):

| `language` | Voices |
| --- | --- |
| `en-US` | `af_heart` (Dashi's), `af_bella`, `af_nicole`, `am_michael`, `am_fenrir`, `am_puck` |
| `en-GB` | `bf_emma`, `bm_george`, `bm_fable` |
| `es` | `ef_dora`, `em_alex` |
| `fr` | `ff_siwis` |
| `hi` | `hf_alpha`, `hm_omega` |
| `it` | `if_sara`, `im_nicola` |
| `pt-BR` | `pf_dora`, `pm_alex` |

Kokoro also has Japanese and Mandarin voices; they need dictionaries eSpeak
NG lacks, and are not offered. `speak` with a language outside the table is
`Voice can't speak ja.`: the shell shows the text instead.

## The models

Kept in `$XDG_DATA_HOME/dashi/voice` (`~/.local/share/dashi/voice`), a
folder per set; `DASHI_VOICE_MODELS` or `--models DIR` puts them elsewhere.
Nothing else is ever written to disk: no sound, no words, no log of either.

| Set | File | Bytes | From | Licence |
| --- | --- | --- | --- | --- |
| `listen` (673 MB) | `silero-vad.onnx` | 2 243 022 | `onnx-community/silero-vad` | MIT |
| | `parakeet/nemo128.onnx` | 139 764 | `istupakov/parakeet-tdt-0.6b-v3-onnx` | CC-BY-4.0 (NVIDIA's weights) |
| | `parakeet/vocab.txt` | 93 939 | | |
| | `parakeet/decoder_joint-model.int8.onnx` | 18 202 004 | | |
| | `parakeet/encoder-model.int8.onnx` | 652 183 999 | | |
| `speak` (335 MB) | `kokoro.onnx` | 325 532 171 | `onnx-community/Kokoro-82M-v1.0-ONNX-timestamped` | Apache-2.0 |
| | `voices/<id>.bin`, 18 of them | 522 240 each | | |
| `whisper` (1037 MB) | `turbo-tokens.txt` | 816 730 | `csukuangfj/sherpa-onnx-whisper-turbo` | MIT (OpenAI's weights) |
| | `turbo-decoder.int8.onnx` | 361 080 764 | | |
| | `turbo-encoder.int8.onnx` | 674 716 297 | | |

`crates/dashi-voice/src/models/manifest.rs` is the list: each file's address
on Hugging Face names a commit, so it can't change under its SHA-256, which
is checked before a file gets its name. A file comes down as `<name>.part`;
a fetch that stops keeps the part and the next one goes on from it (`curl
--continue-at -`, one curl for all the files, four at a time), and a part
whose hash turns out wrong is thrown away and fetched once more from
nothing. Before it starts, a fetch checks the disk
has room and says so in words if not. `dashi-voice models --verify` checks
every installed file again.

A set is "here" when each of its files is there at its full size.

**No network in the service.** The process that hears the microphone may use
Unix sockets only (`RestrictAddressFamilies=AF_UNIX` in its unit). A fetch is
`dashi-voice fetch`, run as a unit of its own
(`systemd-run --user --unit dashi-voice-fetch`), which runs `curl`, never
sees sound, and ends when the files are here. The service reads its progress
from a pipe.

## The microphone pill

The shell's pill (`packages/shell/src/sound/mic-pill.tsx`) lights for any
PipeWire stream that records from a microphone and is not Dashi's own
helper. While a listen runs, the service's `pw-record` is such a stream:
`application.name` "Dashi", `node.name` "dashi-voice-listen", media role
Communication. Its process is a child of the `dashi-voice.service` unit, not
of the shell, so `sound/apps/lib/identity.ts` names it by its
`application.name`: the pill says "Dashi is using the microphone." for as
long as the key is held, and the stream is gone the moment the listen ends.

Do not start `dashi-voice serve` as a child of the shell: a `pw-record`
under the shell is read as one of Dashi's own helpers (`DASHI_HELPERS`) and
hidden, and the pill would stay dark while Dashi listens.

What is spoken plays through `pw-play` as `node.name` "dashi-voice-speak",
`application.name` "Dashi", media role Accessibility. It is a stream like any
app's while it plays; whether Control Center lists it is the mixer's choice.

## The command line

`/usr/libexec/dashi/dashi-voice`, the same models on files, so tests and the
VM need no microphone:

```
dashi-voice [--models DIR] <command>
  serve [--socket PATH]                            the service
  transcribe [--language LANG] [--json] FILE.wav   the words in a WAV file
  speak [--voice ID | --language LANG] [--speed N] [--json] --out FILE.wav TEXT…
  models [--verify]                                the models, and which are here
  fetch [SET…]                                     fetch models (listen and speak, unless named)
  remove [SET…]                                    delete models (all, unless named)
  inspect FILE.onnx…                               a model's inputs and outputs
```

- `transcribe` reads PCM or float WAV at any rate, any channels. With
  `--json`: `text`, `audio_ms`, `speech_ms`, `load_ms`, `ms`,
  `real_time_factor`.
- `speak --json` prints `voice`, `audio_ms`, `load_ms`, `first_sound_ms`,
  `ms`, `real_time_factor` and each sentence's words and times; the WAV is
  24 kHz, 16-bit, one channel.
- `fetch` prints a line of JSON for each step and `{"done":true,"error":…}`
  last; the service reads the same lines.

## What it runs on

- **ONNX Runtime** (MIT), Fedora's `onnxruntime` package, loaded at run time
  through the `ort` crate (MIT OR Apache-2.0): nothing is linked or
  downloaded when the crate builds, so it builds offline and its tests run
  without the library. `DASHI_VOICE_ONNXRUNTIME` names another
  `libonnxruntime.so`.
- **eSpeak NG** (GPL-3.0-or-later), run as a program (`espeak-ng`) for a
  phrase's phonemes, never linked; the phonemes are turned into Kokoro's
  letters in `engine/kokoro/phonemes.rs`.
- **PipeWire's tools**, `pw-record` and `pw-play` (MIT), run as programs.
- **curl**, run as a program by the fetcher.

`docs/decisions.md` D15 to D17 say why.

## Speed and memory

Measured on the development laptop (AMD Ryzen AI 9 HX 370, 12 cores, CPU
only, eight threads per model), release build, on 7.35 s of speech in three
sentences, while other builds ran on the machine (load 6 to 10):

| What | Measured |
| --- | --- |
| Parakeet (with the VAD's pass) | 0.23 s to 0.30 s: 0.03 to 0.04 of real time |
| Whisper turbo | 1.3 s to 3.9 s: 0.18 to 0.53 of real time |
| Kokoro | 1.10 s to 1.17 s: 0.15 of real time; first sound after 0.28 s |
| Kokoro, one word ("Okay.") | 0.21 s |
| Loading from disk: Parakeet, Kokoro, Whisper | 1.3 s to 2.1 s, 0.5 s to 0.6 s, 1.4 s to 5.2 s |
| Memory while loaded: Parakeet, Kokoro; both | 1.45 GB, 0.48 GB; 1.81 GB |
| Memory once let go of (ten minutes unused) | 33 MB |

Through the service in the VM (8 cores, PipeWire, a null source and sink;
`dashi-0.8.0-review/01-voice/`):

| What | Measured |
| --- | --- |
| Key let go → the words (`listen.stop` → its reply), 7 s of speech | 0.31 s, of which 0.13 s is the last eighth of a second heard |
| Speech begins → first `partial` | about 1 s; then one about every 0.8 s |
| `speak` → first sound (`sentence`), models warm | 0.37 s to 0.43 s |
| `speak.stop` → silence at the speakers | under 20 ms |
| Fetching both basic sets (1 GB) | 62 s on the VM's connection |

The 8-bit Kokoro file is a third of the size and three times slower on a
CPU (0.57 of real time); the 16-bit one gives silence on some sentences.
Hence the full one.

## From a checkout

`cargo build --release -p dashi-voice` gives `target/release/dashi-voice`;
`vm/dev-session` exports it as `DASHI_VOICE` when it is built. Where no
`dashi-voice.socket` unit is installed, start the service as a unit of its
own, never as the shell's child (see "The microphone pill"):

```sh
systemd-run --user --collect --unit dashi-voice "$DASHI_VOICE" serve
```

It needs `onnxruntime`, `espeak-ng`, `pipewire-utils` and `curl` installed.

## Checks

- `cargo test -p dashi-voice`: the protocol, the gate, the decoders, the
  planner and its timing, the fetcher (from `file://` addresses), and the
  whole service with scripted models and sound (`src/service/tests/`). No
  model and no audio device is needed.
- In the VM, with a null source and sink: `dashi-0.8.0-review/01-voice/` has
  the script, the WAVs, the transcript and the timings.

## What it can't do yet

- No words while Whisper listens are streamed token by token: partials are
  the whole speech so far, worked out again about every 0.8 s, which is
  cheap for Parakeet and slower for Whisper.
- No GPU: ONNX Runtime's CPU provider only.
- No Japanese or Mandarin voice (see "Languages").
- The word times of a phrase eSpeak NG re-words (numbers, some French
  liaisons) are shared out by length.
