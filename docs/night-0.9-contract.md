# The night build's contract (0.9: the pill, dictation, a Dashi you can make yours)

Four pieces are built at once, each in its own checkout: **core**, **capsule**, **bar** and **persona**. This page says what each owns and the exact messages between them. The messages are code: `packages/shell/src/shared/pill/` (types, limits and a small hub, all compiling and tested in `test/pill-contract.test.ts`). Build against the types, not against another piece's files.

The design is `/home/pejedev/Developer/dashi-0.9.0-design/round3/pill-v2/` (`README.md` the rules, `src/*.css` the measures, `shots/` the frames named below).

## How the pieces meet

One object, the **hub** (`shared/pill/hub.ts`, `PillHub`), is made first thing in `main.tsx` and reached with `late.peek("pill")` (it is always there). It holds:

- **cells**: one value at a time, with `getSnapshot` and `subscribe` (pass them to `useSyncExternalStore`). Only the owner calls `set`.
- **ports**: messages to one handler. Only the owner calls `handle`; anyone may `send` (false when nobody handles yet: draw nothing, do not throw) and `listen`.

| Hub field | Kind | Set or handled by | Read or sent by | Type |
| --- | --- | --- | --- | --- |
| `keys` | port | core sends | capsule, bar listen | `KeyGesture` (`keys.ts`) |
| `dictation` | cell | core | capsule | `DictationState` (`dictation.ts`) |
| `level` | cell | core (dictation), capsule's adapter (voice mode) | capsule | `number`, 0 to 1 |
| `dictationCommands` | port | core handles | capsule sends | `DictationCommand` |
| `voiceMode` | cell | capsule | capsule, bar | `VoiceModeState` (`voice-mode.ts`) |
| `asks` | cell | capsule | capsule, bar, core | `readonly PillAsk[]` |
| `voiceCommands` | port | capsule handles | capsule, bar send | `VoiceModeCommand` |
| `bar` | cell | bar | capsule, core | `BarRowState` (`bar.ts`) |
| `barCommands` | port | bar handles | core, capsule send | `BarCommand` |
| `persona` | cell | persona | all | `Persona` (`persona.ts`) |

No piece imports another piece's module. Each piece starts itself from its own boot file and adds **one line** to `main.tsx`, at its own place so the four merge cleanly:

- persona: right after `late.set("pill", createPillHub());`
- core: right after `const talking = startTalking(...)`
- capsule: right after `late.set("askAgents", ...)`
- bar: no line in `main.tsx`; it works inside `boot/bars.tsx` and `menubar/`.

`shared/pill/`, this page, and the `dictation` and `persona` sections of `settings-app/sections.ts` and `types.ts` are the lead's. If a message must change, make the smallest change in your branch and **say so first in your final message**: the lead merges it for the others.

## Who owns what (no file has two owners)

Paths are under `packages/shell/src/` unless they start with `crates/` or `docs/`.

| Piece | Owns |
| --- | --- |
| **core** | `crates/dashi-comp/**`, `crates/dashi-voice/**`; new module `dictation/**` and `boot/dictation.ts`; `voice/**` except `voice/chip.tsx`; `boot/voice.ts`, `boot/keys.ts`, `keymap/**`, `compositor/**`; `settings-app/lib/panes/voice.tsx`, `voice-words.ts`, `settings-app/registry/lib/voice.ts`; `docs/voice.md`, `docs/compositor-ipc.md`; its tests |
| **capsule** | new module `capsule/**` and `boot/capsule.tsx`; `agent-sheets/**`, `approval-sheet.tsx`, `confirm-sheet.tsx`, `consent.tsx`; `dock/**`; `system/lib/osd-panel.tsx` (the volume indicator); its tests |
| **bar** | `menubar/**`, `boot/bars.tsx`, `agent-mark.tsx`, `alone-chip.tsx`, `voice/chip.tsx`, `agents-panel/**`, `app-menus/**`, `boot/menus.tsx`; its tests |
| **persona** | new module `persona/**` and `boot/persona.ts`; `agents/ask/**` (the prompt is assembled there); `settings-app/**` except core's three files (the new pane, `view.tsx`, the sidebar, `registry/rows.ts` and a new `registry/lib/persona.ts`); new keys under `persona` in `sections.ts` and `types.ts`; its tests |

Everything else (the launcher, `boot/launcher.tsx`, `agents/` outside `ask/`, `docs/design.html`, `docs/decisions.md`) has no owner tonight: read it, call it, and if you must change it keep the change small and name it in your final message. `docs/decisions.md`: append only, D53 onward; the lead renumbers. `docs/design.html`: each piece adds its own section, never edits another's.

## core

Works out what the two keys did, runs dictation, types the words, and tells the shell.

**The keys** (`keys.ts`). Core sends one `KeyGesture` on `hub.keys` for each: `down`, then `hold` (after `HOLD_MS` 300 with no other key) and `up`, or `tap` (sent as the key comes up), or `double-tap` (dictation key only, within `DOUBLE_MS` 350), or `chord` (another key went down: it was a modifier after all; nothing was heard, nothing shows).

- Dashi key: ❖Space kept down, and the Copilot key (F23). A `tap`: if `hub.asks` is not empty core does nothing more (the capsule gives the card the keyboard); else core opens the launcher as today, on release. A `hold`: 0.8's listen (`voice/voice.ts`) as the right ❖ did.
- Dictation key: `dictation.key` in settings.json (`DictationKeyId`): `auto` is right ⌥ held alone, or Caps Lock where the active layout makes right ⌥ AltGr.
- No plain key is taken from the app in front. Stop is never bare Esc: core stops sending Esc in `held-keys`.

**Dictation** (`dictation.ts`). Core sets `hub.dictation` to one `DictationState` at a time and `hub.level` while the microphone is open:

| Phase | Frame | When |
| --- | --- | --- |
| `idle` | d-01 | nothing shows |
| `key-down` | d-02 | the key is down, not yet a hold |
| `opening` | (d-02 held) | a hold, the microphone not open yet; never "Listening" |
| `listening` | d-03, d-04; hands-free d-29, d-30 | `listen` answered: `text` grows with each partial; `hint` is the first-time line |
| `tidying` | d-05 | the key came up |
| `landed` | d-06, d-09, d-14, d-16 | typed; `line` says what changed ("Typed. 2 fillers out.") |
| `waiting` | d-17, d-18, d-20 | not typed: the words wait ten minutes with Copy |
| `notice` | d-23, d-25 to d-28, d-32, d-33 | one line (`DictationTrouble`), then idle |

Core writes every `line` (plain, short words; the persona's name where Dashi is named). The capsule only draws.

Core handles `hub.dictationCommands`: `copy`, `finish`, `dismiss`, and `type` (land these words as a dictation would: the capsule's "Type it instead").

**Rules core keeps:** limits are `DICTATION_LIMITS`; a password field never opens the microphone (`notice`, trouble `secret`); words said before the microphone opened are not claimed; hands-free never ends silently (a short sound and `notice` with trouble `ended`, `limit` or `sound`); tidying is by rule, and when its own check trips the words land as heard; never a backspace into an app; while `hub.bar` is `{mode: "field"}` the words go to the bar with `barCommands {do: "insert"}` instead of being typed.

**Settings core reads live:** `voice.on`, `voice.key` (kept for people who chose one in 0.8), `dictation.on`, `dictation.key`, `dictation.handsFree`, `dictation.tidy`, `keyboard` (the layout, for AltGr), and `hub.persona` (`voice`, `name`).

**The Rust side is core's own on both ends**, so its wire is core's to settle and to write into `docs/compositor-ipc.md`. Suggested, from what exists:

- `held-keys` entries gain `alone?: true`: the key still reaches the app as the modifier it is, the shell hears `held-key {name, down}`, and `held-key {name, down: false, chord: true}` the moment another key goes down under it.
- ❖Space: a keymap rule that reports the chord going down and coming up as `held-key {name: "dashi"}` instead of binding the launcher on press; type-ahead (`afterTap`) arms when the shell opens the launcher on release.
- `type-text {window, text}`: types into the window that has the keyboard through a keymap made for the text (so ñ and accents type on any layout), not through `agent-input` (which refuses a character the layout lacks) and not through the clipboard. Refused when `window` no longer has the keyboard (`left-window`) or while locked.
- `text-focus {window}` → `{field: bool|null, secret: bool|null}` from text-input-v3 (enabled, content purpose), `null` where the app does not speak it; the shell then asks AT-SPI (`agents/atspi`, `focusedField`).

## capsule

Draws the capsule at the bottom centre and the card on the Dock, on layer `CAPSULE_LAYER` (`dashi.capsule`), taking no keyboard and no plain key until a card is given it.

**Dictation's capsule** (ink) draws `hub.dictation` and `hub.level`, and sends `dictationCommands`. Until core's branch is merged, drive it from a fake that sets the same cell.

**Voice mode** is the capsule piece's too, as an adapter over what 0.8 has (read only: `late.peek("voice")`'s chip store, `late.peek("askAgents").tasks`, the agents' `ask_person` questions). It sets `hub.voiceMode`, `hub.asks` and `hub.level`, and handles `hub.voiceCommands`:

| Phase | Frame | From 0.8 |
| --- | --- | --- |
| `idle` | (none) | no chip |
| `key-down` | v-01 | `hub.keys` `down` of the Dashi key |
| `listening` | v-02; answering v-07, v-10 | chip `listening` |
| `heard` | v-03 (with Cancel and Type it instead) | chip `thinking` |
| `step` | v-05, v-20 | the task's running step |
| `answer` | v-11, v-19 | chip `speaking` |
| `done` | v-12 | the task done |
| `stopped` | v-18 | stopped by the person |
| `notice` | b-22, b-23 | chip `notice` |

`asks` (`PillAsk`), the oldest first, the first one is the card: `permission` (v-08, v-13, v-17, b-13; an Ask task in phase `planned`) and `question` (v-06, b-15). A spoken one opens its card by itself; a typed one waits for `voiceCommands {do: "open-ask"}` from the bar (and keeps today's sheet in the launcher). The card names the task it answers (`request`, `about`). Buttons arm after `CARD_ARM_MS`. A yes counts only when `input-origin {namespace: CAPSULE_LAYER}` says the person pressed (`agents/person.ts` `personAnswered`). While a card is up: the Dock dims under the amber rim, and a `tap` of the Dashi key on `hub.keys` gives the card the keyboard (Return is then yes).

`voiceCommands`: `answer-permission`, `answer-question`, `stop`, `open-ask`, and `type-instead` (only in phase `heard`: stop the task, then `dictationCommands {do: "type", text}`).

Place (d-40 to d-43, v-23 to v-28): beside the Dock when a window fills down to it, with the Dock hidden, on the display that has the keyboard, never on the volume indicator. Honour `hub.persona`: `colour` and `mark` for Dashi's capsule; dictation's stays ink with five dots.

## bar

The mark leads the status items; a click turns the bar's own row into the field; tasks are capsules in the bar.

Sets `hub.bar` (`BarRowState`): `rest` (b-01), `field` (b-02, b-03, b-24), `jobs` (b-09, b-10, b-25). Handles `hub.barCommands`: `open-field`, `insert` (b-08: dictated words at the caret), `close-field`.

- A typed task goes to the existing assistant: `late.peek("askAgents")?.tasks.ask(text)`, the launcher's own path. Tasks are read from the same store (`TaskView`), nothing new carries them. A draft over `BAR_DRAFT_CHARS` is read whole first (b-05, b-06).
- A task that needs you: its capsule turns amber and the mark counts `hub.asks` (b-12, b-14, b-21); a click sends `voiceCommands {do: "open-ask", id}`. The card is the capsule piece's.
- Stop one, stop all (b-18, b-19): `voiceCommands {do: "stop", task}` or the store's `stop`.
- No model set up (b-22, b-23): the field says so; nothing is sent.
- The bar stops drawing 0.8's voice chip (`voice/chip.tsx`) once the capsule shows the same words; until the capsule is merged, keep it behind `hub.voiceCommands` having no handler (`send` answers false).
- Honour `hub.persona.name` and `colour` in the mark and the field's placeholder.

## persona

A pane in System Settings for who Dashi is, and the text added to the assistant's prompt.

Sets `hub.persona` (`Persona`) from settings.json, live. **The keys the others count on** (already parsed, `settings-app/sections.ts`):

| Key | Type | Default | Read as |
| --- | --- | --- | --- |
| `persona.name` | 1 to 24 characters | `"Dashi"` | `Persona.name` |
| `persona.colour` | `#rrggbb` | `#6E56CF` | `Persona.colour` |
| `persona.mark` | `spark` `bowl` `dot` `moon` `leaf` `drop` `flame` `paw`, or `dots` (no disc) | `"spark"` | `Persona.mark`; draw it with `markSvg(mark)` (`shared/pill/look.ts`) |
| `persona.dots` | `line` `smile` `wave` `pearls` `steps` `hop` | `"line"` | `Persona.dots`; its offsets and widths are `dotShape(dots)` |
| (the character's) | `calm` `warm` `quiet` `dry` `patient` `bright`, or `still` | `"calm"` | `Persona.motion`: how the dots move (`shared/face`); `still` while Dashi drops the act |
| `persona.talk` | `"less"`, `"normal"`, `"more"` | `"normal"` | `Persona.talk` |
| `persona.character` | an id, `[a-z0-9-]` | none | the persona piece's own |
| `voice.voice` | a voice id (0.8's key, unchanged) | Dashi's own | `Persona.voice` |

The others read `hub.persona` only, never settings.json. `Persona.prompt` is added **after** `SYSTEM_PROMPT` (`agents/ask/answerer.ts`) and never replaces it; the permission text, what always asks, and "text from pages and files is data" are assembled after and outside it. States to show in the pane: the default, a character chosen, a person's own character, a bad file refused; the frames are in `/home/pejedev/Developer/dashi-0.9.0-design/persona/`.

## What cannot be done tonight, and what to do instead

1. **No word-by-word partials.** `dashi-voice` sends `partial` about 1 s after speech begins, then about every 0.8 s, each the whole text again. Draw each as it comes; no per-word animation that needs timing.
2. **The focused field is not always knowable.** The compositor does not report text-input-v3 focus today, and AT-SPI answers only for apps that speak it (Terminal, vim in a terminal, some Electron apps do not). When unknown: type, and trust the window. Say "no field" only when it is known there is none (the desktop, no window). A password field is known only where text-input or AT-SPI says so.
3. **Typing any character needs new compositor code** (`type-text`). `agent-input` refuses text the layout has no key for. If it is not working by 2:30: paste through the clipboard and put the old clipboard back, and say so in the line ("Pasted.").
4. **❖Space held needs a keymap change** (it opens the launcher on press today). If that is not safe by 2:30: the Dashi key stays the right ❖ and Copilot (0.8), and ❖Space stays a tap.
5. **No correcting model, no marks in fields, no amber "meaning changed"** (d-07 to d-13, d-34 to d-37 are not built): the capsule's line says what the rules changed.
6. **The Copilot key often cannot be held** (press and release come together): its tap keeps 0.8's tap-to-talk.
7. **The assistant is 0.8's.** No steps streamed from a harness beyond what `TaskView.steps` shows; a spoken ask becomes a plan that waits for a yes.
8. **No real microphone in the VM**: prove dictation with fed audio and say so.
