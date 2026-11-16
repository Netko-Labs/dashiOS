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
  each word's time so captions keep step. A stop is at once. Each sentence is
  said by a voice of its own language: an English sentence by the person's
  English voice, a Spanish one by a Spanish voice ("A voice for each
  language").
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
5. **Say an answer:** one `speak` for each sentence, with `queue: true`,
   in order, as the answer is written (`voice/lib/saying.ts`,
   `voice/lib/sentences.ts`): the first is heard while the rest is still
   coming, and none is ever cut, whatever the answer's length. For each a
   `sentence` event comes as its first sound plays, with every word's start
   and end in milliseconds from that moment: show the sentence as the
   caption and move the highlight by the shell's own clock. `spoken` ends
   each; the answer is over when the last has ended. Esc, or the key held
   again: `speak.stop`. A dictation that starts while Dashi speaks opens
   the microphone, which stops the sound (the service's rule): the shell
   keeps the sentences that had not played to their end and says them once
   the dictation is over, with "Paused while you dictate." meanwhile. One
   line an utterance goes to the session's log: `dashi-shell: voice said
   asked="…" handed=N played=M ended=done|stopped|failed|paused` (the
   sentences handed to `speak`, and the ones the service said it played).
   With the voice each `speak` carries `voices` (the voice for each other
   language Dashi speaks, from Settings › Voice) and `hint`, and the
   service tells the sentence's language and says it in that language's
   voice (`voice/tongues.ts`). The first sentence's `hint` is the
   conversation's language: what `heard` last told, else the language
   chosen for Dashi, else the region's formats'. Each later sentence's is
   the language the service said the one before in (`speak`'s reply,
   `language`), so a sentence whose words tell nothing ("OK.") keeps the
   voice of the sentence before it, as it would inside one `speak`. With
   "Speak each language in its own voice" off, `by_language: false` goes
   instead and one voice says it all. A sample (Settings › Voice) is one
   voice read as one `language`.
6. **`ask_person`:** `speak` the question as its card comes up, after
   whatever Dashi is saying. Once its last sentence has played, and 300 ms
   more, the shell opens the microphone by itself (`listen`, then
   `listen.quiet`) and the words heard are the answer instead of an ask;
   with nothing said for 6 s it closes again. The same happens after an
   answer while the conversation is open, unless Settings › Voice turns
   "Listen again after Dashi speaks" off. The microphone never opens while
   a sample still plays: there is no echo cancelling yet, so Dashi would
   hear itself. Holding the talk key works as ever, and takes the place of
   a listen that opened by itself.
7. **Keep it warm:** when Voice is on and the session starts, send `warm`
   so the first hold answers at once. Models unused for ten minutes are let
   go of (the service is then 33 MB, not 1.8 GB), and loaded again when next
   needed (one to four seconds). So as the talk key goes down the shell
   sends `warm` with `speak`, and the speaking model loads while the person
   talks (the listening one loads with the `listen`): the answer never waits
   for a model. Each model has its own lock, so one loading never holds up
   another.
8. **The microphone pill** lights by itself: see "The microphone pill".

Nothing listens unless the shell asked, and a listen ends when the connection
that asked for it closes, when the microphone gives nothing for three
seconds, and after five minutes whatever happens.

## The two keys (0.9)

| Key | Held | Tapped |
| --- | --- | --- |
| **The Dashi key**: ❖Space, and the Copilot key | talks to Dashi (steps 3 to 5 above), from the moment it has been down 300 ms | ❖Space opens the launcher as the key comes up, as it always did; while a card is up the capsule gives the card the keyboard instead. The Copilot key's tap talks (many can't be held) |
| **The dictation key**: the right ⌥ held alone; Caps Lock where the layout makes the right ⌥ AltGr (Spanish, US International, most others) | dictation: the words are typed where the keyboard is | twice: hands-free |

- The compositor only reports the keys (`held-keys` with `super`, `alone`
  and `tapMs`, docs/compositor-ipc.md); `dictation/lib/gestures.ts` works out
  what a press was (`down`, `hold`, `up`, `tap`, `double-tap`, `chord`) and
  tells it on the hub (`hub.keys`, docs/night-0.9-contract.md).
- The right ⌥ stays a modifier: it reaches the app as it is, and the moment
  another key goes down under it the press was a chord and nothing is heard.
  Caps Lock as the dictation key is taken: it no longer turns capitals on.
- The right ❖ is no longer a talk key unless the person picks a key in
  Settings › Voice (`voice.key`, kept from 0.8). Esc is never taken from the
  app in front: Dashi is stopped from its capsule, by its key again, or by
  **❖Esc**, with one hand: what it says stops, and every task of its at
  work (`voiceCommands {do: "stop", all: true}`; the capsule's Stop shows
  the keys as its hint; decisions.md D83). With the ❖Tab switcher up, ❖Esc
  leaves the switcher as before. ⌃❖Esc still cuts every agent off.
- Both follow settings.json live: `voice.on`, `voice.key`, `dictation.on`,
  `dictation.key` (`auto`, `right-option`, `caps-lock`, `right-control`,
  `menu`), `dictation.handsFree`, `dictation.tidy`, and `keyboard.layout`
  (else the system's) for AltGr. With Voice off no key is held and ❖Space
  is the launcher's binding as before.

## Dictation

`packages/shell/src/dictation/`; started by `boot/dictation.ts`. It hears
through the same service and the same models as talking to Dashi, and tells
the capsule one `DictationState` at a time (`shared/pill/dictation.ts`).

1. **The key is a hold.** What stops the microphone is said and nothing
   opens: no models (`no-model`), the service starting or gone (`loading`,
   `voice-gone`), Dashi listening (`busy`), the microphone muted (`muted`,
   from `wpctl get-volume @DEFAULT_AUDIO_SOURCE@`), a password field with the
   keyboard (`secret`). Then `listen`; only its reply makes the state
   `listening`, so words said before the microphone opened are not claimed.
2. **While it is held** `partial` events are the words so far and `level`
   the dots. With nothing said for 30 s it ends by itself; after five
   minutes it lands what was said.
3. **The key comes up:** `listen.stop`, then the words are tidied by rule
   (below) and typed.
4. **Typing** is the compositor's `type-text {window, text}`: one step, into
   the window the key went down in, through a keymap made for the text, so ñ
   and é type on any layout. The clipboard is not touched. A BackSpace is
   sent only to take back what Dashi itself typed ("The insertion record"),
   and a line break is the chord the place wants; both ride in the same
   `type-text` request (`erase`, `breaks`), because a chord sent apart
   (`send-keys`) goes through the input method and arrives after the text. An X11 window can't take it (`x11`): there the words are pasted
   (the clipboard is put back 300 ms later) and the line says "Pasted."
   While the bar's row is the field the words go to it (`barCommands` `insert`). A space is typed after the words (none after a
   line break), so the next words do not join them.
5. **Nothing is typed**, and the words wait ten minutes in memory with Copy,
   when no window has the keyboard (`no-field`), another window took it
   (`left-window`), a password field has it (`secret`), neither typing nor
   pasting worked (`failed`), or the person's own hands pressed a button or
   a key in that window after the key came up (`moved`, "You moved on.";
   the compositor's `input-origin` says so). No app tells one field from
   another well enough (the same field serves the next conversation), so a
   click or a key there means the caret may be elsewhere (decisions.md D81).
   Hands-free asks the same from the first words of each sentence; the tap
   that ends it is not asked, being a key in the window itself.
6. **Hands-free** (a double tap): `listen` with `"until": "silence"` and
   `quiet_ms` 1200; each `heard` is a sentence, which lands, and the next
   is listened for. It ends on a tap of the key, when
   another window takes the keyboard, after 20 s with nothing said, at ten
   minutes, or when a sentence has nowhere to land; each time with a short
   sound (`pw-play`, a freedesktop sound) and a line that stays.

Whether a field is a password field, and the text around its caret, are
asked of AT-SPI (`clipboard/lib/fields.ts`), which dictation turns on at its
first hold. Where it can't be told the window is trusted.

### The insertion record

`dictation/lib/record.ts`, `erase.ts`, `after.ts`, `landings.ts`;
`dictation/history.ts`. Dashi remembers what it typed: the window, the
field as far as AT-SPI tells (its role, and the site of a web page), when,
the recogniser's words and the words that landed, and exactly the
characters it sent. The newest forty, in memory; the words alone also go to
the history on disk.

- **Undo** (the capsule's button after a landing, `dashi://dictation/undo`,
  ⌃❖Z) takes the newest insertion of the window in front back with
  BackSpace, once for each character Dashi sent (`type-text`'s `erase`,
  one request; `send-keys` one key at a time only in an X11 window), and
  only when those characters are still the last thing in the field
  (decisions.md D180, D187):
  - where the field's text can be read (AT-SPI's Text interface, the walk
    the password check uses), the text before the caret must end with them;
  - where it can't (most terminals), the person's own hands must not have
    pressed a key or a button in that window since they landed
    (`input-origin`; the dictation key, ❖ and a chord the keymap takes,
    ⌃❖Z among them, are not keys in the window), and the text must hold
    no line break;
  - otherwise nothing is touched, and the capsule says "That text has
    changed, so I left it." Never the person's own text.
- **Raw** (after a landing that tidying changed) takes the insertion back
  the same way and types the recogniser's own words in its place.
- **Paste last** (`dashi://dictation/paste-last`, ⌃❖V) types the last
  dictation again where the keyboard is now, also one that never landed
  (the words that waited).
- **The history** (Settings › Voice, "Dictation history"): each landing's
  time, app, the words as heard beside the words as typed, Copy, Delete,
  Delete all. `$XDG_STATE_HOME/dashi/dictation/history.jsonl`, mode 600,
  one JSON line each. Kept a day by default (`dictation.history`: `day`,
  `week`, `none`); "Nothing" writes nothing and removes the file. No sound
  is kept, and nothing from a password field (nothing lands there).

The capsule's states for these: `landed` carries `undo` and `raw` (which
buttons show), and `told` is one line of what was done or not ("Removed 14
words.", "That text has changed, so I left it.") `offer` is the
question of "Learning from a fix".

### Vocabulary and profiles

`dictation/lexicon.ts`, `dictation/lib/lexicon-files.ts`, `profiles.ts`,
`compose.ts`, `rules-terms.ts`, `rules-code.ts`, `rules-style.ts`,
`seed.ts`; `dictation/words.ts`, `terminal.ts`.

**The files**, in `~/.config/dashi/dictation/`, plain text a person can
read and edit; read again at each press of the key when one changed:

| File | A line | Means |
| --- | --- | --- |
| `vocabulary` | `Dashi: dashy, dead dash` | a term as it is written; after the colon, what the recogniser tends to hear instead |
| `replacements` | `cloud code -> Claude Code` | heard → typed: whole words, any capitals, the longest first |
| `snippets` | `my address -> 12 Example Street\nSpringfield` | said → text (`\n` is a line break) |
| `profiles/<id>` | `key: value` | one profile: `name`, `apps`, `sites`, `tone`, `polish`, `tidy`, `capitals`, `final period`, `line breaks`, `lists`, `code`, `greeting`, and its own `word:` and `replace:` lines |

A `#` starts a comment; a line that can't be read is skipped. A file that
is missing is written with Dashi's own; one that is there is never written
over. The first run seeds `vocabulary` with Dashi's and mirin's own words
(with what Parakeet was seen to hear: "dashy", "dead dash", "cloud code",
"whisperflow"), the person's own name (the passwd entry), and the installed
apps' names that are names (an inner capital, a digit, or a word the
dictionary does not have: "Kdenlive", not "Notes").

**The five profiles**, chosen with no setup (`pickProfile`): a terminal
(the field's AT-SPI role, or a terminal's app id) is Developer; else the
site of the page the field is in (the web document around it, from AT-SPI;
a page nobody claims is Writing, whatever the browser); else the app; else
Writing.

| Profile | Where | What it does |
| --- | --- | --- |
| Developer | terminals, editors, T3 Code, code hosts | casing by voice ("camel case user id" → `userId`; pascal, snake, kebab, constant, dot), flags and symbols by voice ("dash dash help" → `--help`, "open paren", "underscore", "equals sign"; "pipe" in a terminal only), backticks round identifiers outside a shell; at a shell's prompt no capital and no full stop; its own words (GitHub, TypeScript, …) |
| Writing | documents, notes, anything unclaimed | sentences as tidied |
| Chat | messaging apps and sites | no full stop after a single sentence; a line break is ⇧Return, so Return does not send |
| Email | mail apps and sites | full sentences; "Hi Alex," goes on a line of its own |
| Verbatim | chosen by hand | nothing changed but spacing |

A terminal with an agent's program under its process (`terminal.ts`
`agentUnder`: claude, codex, aider, …, read from /proc) is an agent's
prompt, where words are prose: capitals and full stops stay, identifiers
get backticks, and a line break is ⌃J. A bare shell's words are a command.

The capsule shows the profile's name, small, while it listens and after
the words land; a press on it takes the next profile for that window until
it closes (`DictationCommand` `profile`). Settings › Voice lists the
profiles, the words and the replacements, with add and remove, and opens
the folder.

**The rules, in order** (`compose`): names and terms (a replacement or a
"heard as" form; a term's own capitals; a word no dictionary knows that is
within 0.8 of a term, 0.86 with no dictionary; a contraction that lost its
ending: "shouldt" → "shouldn't", "I dot like" → "I don't like"), then
tidying with its check (below), then snippets, the Developer profile's
casing and symbols, and the profile's style. The vocabulary for one
dictation is the profile's words, then the project's (a place kept for the
repository in front; nothing fills it yet), then the person's.
`words.ts` reads the system's hunspell dictionaries (English and Spanish
stems) the first time it is asked; with none installed, the rules that need
one stand down.

### The gate and the correction model

`dictation/lib/gate.ts`, `rewrite.ts`, `language.ts`, `rules-spoken.ts`;
the seam is `docs/dictation-rewrite.md` (the model, its server and the
checks on its answer are `rewrite/`'s).

1. **Rules first** (above), with what is said aloud written as it is
   written: an email ("alex at example dot com"), a web address ("example
   dot com slash docs"), a file's name ("index dot ts"), numbers from ten
   up ("twenty five" → 25, "dos mil" → 2000, "ten percent" → 10%). Small
   numbers stay words, and so do "first" and "second".
2. **The gate** (`gate`) says whether the rules' text needs the model, and
   why: `cue` (a self-correction after something said: "no, I mean", a
   "no" between two pauses, "actually,", "sorry", "digo", "perdón", "mejor
   dicho", "o sea, no," (with its pause: D196), "quise decir", "espera", "not … but"; never one
   that opens the utterance, "No, I mean it."; or something said twice;
   decisions.md D190), `list` (list
   markers the rules made no list of), `run-on` (twenty words with no
   mark), `non-word` (a word no dictionary knows; English only), `near-term`
   (the first word of what a vocabulary term is heard as: "cloud"),
   `polish` (the profile asks for every utterance). A short clean sentence
   has no reason and is never sent: the model can only make it worse.
   Never at a shell's prompt, in Verbatim, or with tidying off. Of these,
   the model is asked for `cue`, `run-on`, `near-term` and `polish` only
   (`HELPED` in `rewrite.ts`): measured on its evaluation set it does not
   mend a non-word, and its checks refuse an answer that adds a line
   break, so non-words and lists stay the rules' work.
3. **The call**: `Rewriter.rewrite` with the rules' text as `transcript`,
   the languages of what was said (little words and Spanish letters, in
   the words and in the text before the caret; the session's locale when
   they do not say), the first fifty names of the active vocabulary, the
   last 200 characters before the caret, the profile's tone line, and the
   deadline `advice()` gives. `warm()` is called when the key goes down.
   Only an answer that is `text` changes anything: it gets the profile's
   style again and lands. `unchanged`, any failure or the deadline land
   the rules' words. A rewriter whose state is `off`, `no-model` or
   `too-slow`, or no rewriter at all, is not asked: everything above works
   with no model.
4. **The wait**: the capsule shows the dots and the last words at once,
   and says "Tidying" only once 300 ms have passed (`tidying.said`).
5. **Land, then refine** (`advice().land === "refine"`, a machine that
   cannot answer in time): the rules' words land at once and the model is
   asked with the longer deadline; its words take their place only if the
   field still ends with what landed (the insertion record's check), and
   the line says "Refined." A new dictation, Undo or Raw drops the answer.
6. **After**: the line counts what changed ("Typed. 2 fixes."), with Undo
   and Raw. The history keeps what the model said (`model`: "text",
   "unchanged", or the failure's kind).

Until `rewrite/` is merged, `dictation/types.ts` declares the seam's
shapes and nothing passes a rewriter: `boot/dictation.ts` gives
`rewriter: startRewriter(…)` when it is.

### Fitting the field

`dictation/lib/fit.ts`. At the landing the text before and after the caret
is read (AT-SPI's Text interface on the focused field; up to 400
characters each way; never in a password field), and the words are made to
continue it:

- **A space before** them unless the caret is at the start, after a space
  or a line break, or after an opening mark (`(`, `“`, `/`, `-`, …).
- **No capital** when the line before the caret is a sentence already
  begun (it does not end with `.`, `!`, `?`, `…` or `:`), unless the first
  word is a name: one the vocabulary writes with a capital, "I", or a word
  the dictionary lists only with a capital.
- **No full stop** of Dashi's when text follows on the same line: the
  words went into a sentence that has its own end.
- **A space after** them unless what follows starts with a space or a
  closing mark.

Where the field can't be read (Dashi's own apps and most terminals do not
give their text to AT-SPI) the words land as said, with a space after, as
before. Undo's check uses exactly what was typed, the spaces included.

### Instructions and lists

`dictation/lib/instruction.ts`, `instructed.ts`, `lists.ts`.

**An instruction is the whole utterance** (one press, one phrase), from a
short fixed grammar in English and Spanish; sounds and "please" round it
do not count. The same words inside a longer sentence are words and are
typed ("Tell him to scratch that idea.").

| Said alone | Does |
| --- | --- |
| "scratch that", "delete that", "undo that", "remove that", "erase that", "remove (or delete) the previous text", "remove the last text", "remove what I just said"; "borra eso", "quita eso", "elimina eso", "deshaz eso", "borra (or quita) lo anterior", "borra el texto anterior" | takes back Dashi's newest insertion in the window in front, checked as Undo checks it; said again, the one before |
| "new line", "nueva línea", "punto y aparte"; "new paragraph", "nuevo párrafo" | a line break, or two, typed as the place breaks lines (Return, ⇧Return where Return sends, ⌃J in an agent's prompt) |

The capsule says "Took that as an instruction", what it did ("Removed 14
words.") and **Undo**, which puts back what was removed (or takes back the
break) and types the words themselves, as heard. Where nothing of Dashi's
is there, or the field changed, it says so and touches nothing; Undo still
types the words. With "Tidy what I say" off nothing is an instruction.

**Lists**, by rule where the markers are plain (`makeList`):

- "first… second… third…" ("primero… segundo…"), two or more in order,
  not after an article or a preposition ("the first time") and not before
  "of", "time", "thoughts"…: a numbered list.
- "one, … two, … three, …" ("uno… dos… tres…"), three or more, each at the
  start or after a mark: a numbered list.
- "bullet point … bullet point …", "next item", "viñeta", twice or more:
  bullets.

The markers go, each item gets a line and a capital, and what came before
the first is the line that introduces them, ending with a colon. Bullets
are `- ` where the profile's lists are Markdown (Chat, Developer) or the
app is a Markdown editor (`MARKDOWN_APPS`: Notes, Obsidian, …), and bare
lines in a plain field. Never at a shell's prompt. The line says "A list
of 3." Anything less plain is left as said, and the gate sends it to the
model (`list`).

### Learning from a fix

`dictation/lib/learn.ts`. After words land in a field whose text can be
read, the field is read again every 2.5 seconds, four times. If one word
or a short run (three at most) changed, with at least two of Dashi's words
still round it, and the next read finds the same change (the person has
finished typing it), the capsule offers "Always write “Kōji” for “Koji”?" for
eight seconds. Yes is a press on **Always** or a tap of the dictation key
(the one key that is dictation's own; no plain key is taken); it becomes a
line in `replacements`, or a word in `vocabulary` when only its capitals
changed. Nothing is learned silently, and never a number, a path or an
address. The landing is then the person's: Undo no longer takes it back.

### Tidying by rule

`dictation/lib/tidy*.ts`. On this computer, no model; English and Spanish.

- **Fillers out:** "um", "uh", "uhm", "erm", "hm", "hmm", "mm", "eh", "ehm"
  wherever they are, with the comma that was only theirs. "este" and "o sea"
  only where they are set off: between two commas, or starting a sentence
  before a comma. So are "like" and "you know". "like" with no commas is a
  filler only by its place: after a word it cannot follow as a verb or a
  comparison (a verb that takes its object at once, a joining word, an
  article) and before what was meant ("give like an instruction", "gather
  like most of them"); "looks like a", "I like the" and "something like
  that" stay.
- **Punctuation said out loud:** "comma" / "coma", "period" / "full stop" /
  "punto", "question mark", "exclamation mark", "punto y coma", "new line" /
  "nueva línea", "new paragraph" / "nuevo párrafo". Not after a word that
  makes it a noun ("the trial period", "en punto", "que coma"), and "period"
  and "punto" only where a sentence ends.
- **A change of mind:** "no wait", "scratch that", "no, perdón", only when it
  stands apart (a mark or the start before it, a mark or the end after it).
  Nothing after it: the sentence before goes. What follows starts with a
  word the sentence had: the sentence is cut back to that word. One or two
  words follow: they replace its last one or two. More: the sentence starts
  again.
- **Spaces and capitals:** no space before a mark, one after; a capital
  where a sentence or a line starts.
- **The check** (`tidy-check.ts`) reads the result: every word typed was
  said, in that order; no number and no "not", "no", "never" (or "nunca",
  "ni", "sin", …) is lost, except in what the person took back, where the
  part taken back and what replaced it must say "not" as often. When it does
  not hold the words land as heard, and the line says "As you said it."
- `dictation.tidy: false` types the words as heard.

## The shell's side

`packages/shell/src/voice/` (started by `boot/voice.ts`; tests
`packages/shell/test/voice-*.test.ts`):

| File | What |
| --- | --- |
| `client.ts`, `lib/wire.ts` | the socket's client; every reply and event parsed with shapes |
| `lib/launch.ts`, `lib/service.ts` | connecting when first needed and again after the service goes; from a checkout, starting it as the unit `dashi-voice` |
| `../dictation/` | the two keys' gestures, dictation, hands-free, tidying by rule ("The two keys", "Dictation") |
| `keys.ts` | the talk key: which evdev codes the compositor holds (`held-keys`, docs/compositor-ipc.md), and what each choice costs |
| `voice.ts` | the key held and let go, the ask, the answer said, captions, Esc, an agent's question |
| `asker.ts`, `lib/answer.ts` | what was said becomes a launcher Ask task; its answer or its plan in words |
| `chip.tsx`, `lib/captions.ts`, `lib/speech.ts` | the menu bar's chip, how long words are cut, each word lit at its time |
| `tongues.ts` | the other languages Dashi speaks and each one's voice (`voice.voices`, `voice.byLanguage`); what `speak` is sent with |
| `models.ts` | the sets, a fetch's progress, Pause and Resume, removing (Settings › Voice) |

- **The key.** While Voice is on (`voice.on` in settings.json) the shell
  asks the compositor to hold the talk key: the right ❖ (evdev 126) and the
  Copilot key (F23, 193: taken whether it comes alone or as ⇧❖F23), or the
  one key the person picked in Settings › Voice (right ⌥, right ⌃, Caps
  Lock, Menu). A held key reaches no app and is no modifier. With Voice off
  no key is held: the right ❖ is a ❖ like the left.
- **A hold** shorter than 300 ms is a tap: nothing is heard; it stops Dashi
  if it was speaking, and otherwise the chip says "Hold … to talk."
- **The Copilot key's tap talks.** Many laptops send its press and release
  together, whatever the finger does, so it can't be held. The compositor
  holds it under a name of its own (`talk-tap`; the others are `talk`), and
  a tap of it (under 300 ms) keeps the listen its press opened: the shell
  sends `listen.quiet` (1.5 s), and the listen ends when the person has
  talked and gone quiet (its words come in `heard`), at the next tap of a
  talk key (`listen.stop`), or at Esc. If nothing at all is heard in 8 s the
  shell cancels it and the chip says "I didn't hear anything." Held 300 ms
  or more it is a hold like any other key; a tap while Dashi speaks only
  stops it. Settings › Voice says so beside the key.
- **Stopping.** ❖Esc (never bare Esc since 0.9; ⌃❖Esc still stops agents),
  the talk key again, a press on the capsule's Stop, and the screen locking
  each stop it at once.
- **The chip** is laid over the menu bar in the room between the app's menus
  and the status side, so it moves neither (docs/design.html, "The voice
  chip"). Listening: the microphone's level and the end of what was heard so
  far. Thinking: what was heard. Speaking: the line being said, each word
  lighting at its `start`. Its words are a screen reader's too.
- **Settings › Voice** (`settings-app/lib/panes/voice.tsx`): it asks `models`
  when it is shown, and again whenever the models' folder (`folder` in the
  reply) changes while it is open (`models.ts` `watch`), so models copied in
  by hand or fetched from a terminal show without reopening it; the switch,
  which reads on only when Voice is on (asked for, and its models here; while
  it offers or waits for the fetch it reads off and its row says "It turns on
  once its models are here.");
  turning it on with no models says what will come and how big, and only
  "Fetch" fetches; progress with Pause, and Resume from what came; the talk
  key and what it costs; Dashi's voice with "Play a sample"; under it the
  switch "Speak each language in its own voice" (on unless turned off;
  `voice.byLanguage`) and a row for each other language that is spoken, "In
  Spanish", with the voice that says it, changeable, "Off", and "Play a
  sample", which says a line in that language in that voice (`voice.voices`;
  `panes/voice-languages.tsx`). English and Spanish are spoken unless turned
  off; French, Hindi, Italian and Portuguese are turned on from "Speak
  another language". "Corrections" (the model that corrects dictation,
  `docs/dictation-rewrite.md`) and "More languages" (Whisper), each its own
  fetch; Remove. Each set's `credit` shows
  under the page. Only the person's own press turns Voice on, fetches,
  removes, or picks the key or the voice: the pane asks the compositor whose
  press it was (`input-origin`, `settings-app/lib/person-only.ts`), and an
  agent's press changes nothing and the row says "Only you can change this.
  Press it yourself, here." Turning Voice off and Pause only narrow, so they
  are not asked about.

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
| `listen.stop` | none | `text`, `speech_ms`, `language?` |
| `listen.quiet` | `quiet_ms?` | `{}`: the listen under way now ends by itself on a quiet |
| `listen.cancel` | none | `{}` |
| `speak` | `text` or `parts`, `voice?`, `language?`, `voices?`, `hint?`, `by_language?`, `speed?`, `queue?` | `id`, `language?` |
| `speak.stop` | none | `{}` |

### `status`

```json
{"id":1,"method":"status"}
{"id":1,"result":{"version":"0.9.0","state":"idle","listen":true,"speak":true,"whisper":false,"fetching":false}}
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
  {"id":"whisper","name":"More languages","…":"…","basic":false,"bytes":1036613791,"have":0,"installed":false},
  {"id":"rewrite","name":"Corrections","…":"…","basic":false,"bytes":541903616,"have":0,"installed":false}]}}
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
  {"id":"af_heart","name":"Heart","language":"en-US","language_name":"English (US)","installed":true,
   "pairs":{"es":"ef_dora","fr":"ff_siwis","hi":"hf_alpha","it":"if_sara","pt":"pf_dora"}},
  {"id":"bf_emma","name":"Emma","language":"en-GB","language_name":"English (UK)","installed":true,"pairs":{"…":"…"}}, "…"]}}
```

`default` is Dashi's voice. The second letter of an id says who speaks: `f`
a woman, `m` a man. `pairs` is the voice of each other language that goes
with this one ("A voice for each language"): what a sentence in that
language is said by when `speak` names no voice for it.

### `warm`

```json
{"id":9,"method":"warm","params":{"listen":true,"speak":true,"language":"en"}}
{"id":9,"result":{}}
```

Loads the models now. `language` picks which listening model (see
"Languages").

### `listen`, `listen.stop`, `listen.quiet`, `listen.cancel`

```json
{"id":10,"method":"listen","params":{"language":"en"}}
{"id":10,"result":{}}
{"event":"state","state":"listening"}
{"event":"level","level":0.41}
{"event":"partial","text":"Open the"}
{"id":11,"method":"listen.stop"}
{"event":"state","state":"thinking"}
{"event":"heard","text":"Open the calendar.","speech_ms":1632,"language":"en"}
{"event":"state","state":"idle"}
{"id":11,"result":{"text":"Open the calendar.","speech_ms":1632,"language":"en"}}
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
was once the silence was dropped. `language` is the language of the words
(`"en"`, `"es"`, `"fr"`, `"hi"`, `"it"`, `"pt"`), in the reply and in
`heard`, when the words tell it: Parakeet picks the language it hears by
itself and does not say which (its decoder gives words only), so the
service tells it from the words, as it does for what it speaks. Left out
when they give too little ("OK", a name) or are in another language. One listen at a time
(`Voice is already listening.`); `listen.stop` with none running is
`Voice is not listening.` A listen that ended by itself tells its words in
the `heard` event only.

`listen.quiet` turns the listen under way into one that ends by itself, as
`"until": "silence"` would have made it: once the person has spoken and then
been quiet for `quiet_ms` (1200 unless given, 300 to 10000). What was heard
since the listen opened is kept. It is for a key that was tapped, not held:
the listen was opened when the key went down, and no key coming up will end
it. Its words come in the `heard` event; `listen.stop` still ends it sooner.
With no listen running: `Voice is not listening.`

```json
{"id":13,"method":"listen.quiet","params":{"quiet_ms":1500}}
{"id":13,"result":{}}
```

`listen.cancel` closes the microphone and drops what was heard: no `heard`
event, no words worked out.

### `speak`, `speak.stop`

```json
{"id":12,"method":"speak","params":{"text":"It's ten past four. You have two meetings left."}}
{"id":12,"result":{"id":1,"language":"en"}}
{"event":"state","state":"thinking"}
{"event":"state","state":"speaking"}
{"event":"sentence","id":1,"index":0,"text":"It's ten past four.","ms":1650,
 "words":[{"text":"It's","start":350,"end":520},{"text":"ten","start":570,"end":760},
          {"text":"past","start":800,"end":1080},{"text":"four.","start":1120,"end":1625}],
 "voice":"af_heart","language":"en-US"}
{"event":"sentence","id":1,"index":1,"text":"You have two meetings left.","ms":1900,"words":["…"],
 "voice":"af_heart","language":"en-US"}
{"event":"spoken","id":1,"reason":"done"}
{"event":"state","state":"idle"}
```

- `text`: up to 20000 bytes. It is cut into sentences; each is made into
  sound while the one before plays. The first sound waits for the first
  piece to be made whole, so a first sentence of 60 characters or more is
  said in two pieces, cut after its first comma, semicolon, colon or dash
  that leaves both 20 characters or more: each piece has a `sentence` event
  of its own. The speakers are opened as the utterance starts, while the
  first piece is made, not after. The model starts every piece with about a
  third of a second of hush and ends it with half a second: the hush before
  an utterance's first sound is cut to 30 ms, and at the join of a sentence
  said in two pieces to a comma's pause (120 ms, then 30 ms), with the
  words' times moved to match. Between sentences of one voice it is left as
  the model made it; where the voice changes it is cut to a sentence's
  pause ("The seam").
- `parts`: in place of `text`, stretches that each may name their language:
  `[{"text":"Dijo:","language":"es"},{"text":"See you at five."}]`. A
  stretch that names none is told a sentence at a time.
- `voice`: a voice's id. Without it, `language`'s first voice (`"en-GB"` →
  `bf_emma`, `"es"` → `ef_dora`); without both, Dashi's own (`af_heart`).
- `language`: the language of all of `text`, as a BCP 47 tag; nothing is
  told from the words. Said by `voice` when that is its language, else by
  the voice `voices` names for it, else by `voice`'s pair. Its region is
  how it is read (`"es-CO"`: Latin American Spanish, `$` is pesos).
  `Voice can't speak ja.` for a language with no voice.
- `voices`: the voice for each other language that may be spoken, by its
  tag: `{"es-CO":"ef_dora","fr":"ff_siwis"}`. These and `voice`'s own are
  the languages a sentence is told among. Without it: English and Spanish,
  by `voice`'s pairs. A voice named for a language it does not speak is
  refused (`bm_george is not a voice that speaks Spanish.`).
- `hint`: the conversation's language. A first sentence that gives no
  evidence ("OK.", a name) is said in it; without it, in `voice`'s own.
- `by_language`: `false` says everything in `voice`, read as that voice's
  language reads it, as before 0.9.
- `speed`: 0.5 to 2; 1 is the voice's own pace.
- `queue`: `true` says it after what is being said. Without it, a new
  `speak` takes the place of the old one, which ends with
  `"reason":"stopped"`.

The result's `id` names the utterance in its events, and its `language` is
the language its last sentence is said in, by its code (`"es"`; left out
when there is nothing to say): an asker that sends an answer a sentence at
a time gives it as the next one's `hint`. `speak.stop` stops the
sound at once and forgets what was queued; every utterance it ended gets a
`spoken` with `"reason":"stopped"`.

## Events

| Event | Fields | When |
| --- | --- | --- |
| `state` | `state` | The state changed (see "States"). |
| `level` | `level`, 0 to 1 | About 31 times a second while listening: the microphone's loudness (RMS on a decibel scale, −60 dBFS is 0). |
| `partial` | `text` | While listening: all the words so far. Each replaces the one before; `heard` replaces the last. |
| `heard` | `text`, `speech_ms`, `language?` | A listen ended (by `listen.stop`, by silence, by the microphone ending, or at five minutes). Not after `listen.cancel`. |
| `sentence` | `id`, `index`, `text`, `ms`, `words[]` (`text`, `start`, `end`), `voice`, `language` | A sentence's (or, for a long first one, each of its two pieces') first sound plays now. `ms` is how long it lasts; a word's `start` and `end` are milliseconds from now. `voice` says it, read as `language` (`"en-US"`, `"es-419"`). |
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

All 18 are Kokoro v1.0's own voices, 522 240 bytes each, Apache-2.0 with the
model ("The models"). Nothing new is fetched for speaking a second
language: the Spanish, French, Hindi, Italian and Portuguese voices came
with the `speak` set from the start.

## A voice for each language

Kokoro reads a sentence by the rules of its voice's language (the first
letter of the voice's name), so `af_heart` given a Spanish sentence said it
with American letter-to-sound rules. Now each sentence is said by a voice
of its own language (`service/lines.rs`, `service/cast.rs`).

**Telling the language** (`crates/dashi-voice/src/tongue/`): from the
sentence's words, with no model and nothing fetched.

- Each language has a list of its common words; those that hold sentences
  together ("the", "que") weigh double. A word common to two languages
  ("no", "me", "a") is in both lists and tells neither apart.
- Letters tell too: `ñ ¿ ¡` are Spanish, `ã õ` Portuguese, `ì ò` Italian,
  Devanagari is Hindi; so do a few shapes ("don't", "l'ami", "-ing").
- A capital inside a sentence is a name (Helium, YouTube, Settings, Toño)
  and tells nothing, so "abre Helium y ve a YouTube" is Spanish and "Call La
  Casa de Toño" is English.
- The language with the most evidence wins when it leads the next by
  enough. A sentence that gives too little ("OK.", "42.", a name), or as
  much for two, keeps the language of the sentence before it; the first
  keeps `hint`'s.
- Only the languages that may be spoken are told among: English and
  Spanish unless `voices` names others. With two the detector is at its
  best; each language added is one more to mistake a short sentence for.
- It is right for whole sentences. A sentence that changes language half
  way is said in the language most of it is in, by one voice.

**Who says each language.** `voice` says its own. For another, the voice
`voices` names; else `voice`'s pair (`voices`' `pairs`): of that language's
voices with the same kind of speaker (a woman's with a woman's), the one
whose pitch is nearest; where the language has none of that kind, its
first. English for a voice of another language is American, and for a
British voice British: an accent is not chosen by pitch. How close a pair
is, as measured (`dashi-voice levels`: the median pitch of each voice
saying a line of its own language; a semitone is the step between two
piano keys):

| A voice | Its pair in Spanish | Apart |
| --- | --- | --- |
| `af_heart` (Dashi) 195 Hz | `ef_dora` 180 Hz | 1.4 semitones lower |
| `af_bella` (Miso) 202 Hz | `ef_dora` | 1.9 lower |
| `af_nicole` (Yuzu) 152 Hz | `ef_dora` | 3.0 higher: Nicole is low and breathy, Dora is neither |
| `bf_emma` (Nori) 183 Hz | `ef_dora` | 0.3 lower |
| `bm_george` (Kombu) 147 Hz | `em_alex` 134 Hz | 1.6 lower |
| `am_puck` (Wasabi) 122 Hz | `em_alex` | 1.7 higher |
| `am_michael` 118 Hz | `em_alex` | 2.3 higher |
| `am_fenrir` 144 Hz | `em_alex` | 1.2 lower |
| `bm_fable` 127 Hz | `em_alex` | 0.9 higher |

Pitch is the one thing measured. The pair is another speaker: the set has
one woman's and one man's voice in Spanish, so Dashi, Miso, Nori and Yuzu
are all Dora in Spanish, and Kombu and Wasabi both Alex. French has one
voice, a woman's (`ff_siwis`): a man's voice is paired with her. Whether a
pair sounds like one person is for ears, not for this table.

**The same loudness.** The voices differ by up to 9 dB as the model makes
them (`if_sara` −13.3 dBFS, `am_michael` −22.5; the RMS of the sound that
is speech). Each was measured once (`dashi-voice levels`) and the table is
in `engine/kokoro/levels.rs`: every voice is brought to Dashi's own
(`af_heart`, −21.7 dBFS). The loudest is cut by 8.4 dB, none is raised by
1 dB, so nothing is pushed to clip. A voice the table lacks is left as the
model made it (a test names every voice of the manifest).

**The seam.** The model puts hush around every sentence, a different
length for each voice: left alone, the pause where Heart hands over to
Dora is 660 ms and where Dora hands back 480 ms (Heart to Heart is
760 ms). Where the voice changes, each side keeps a sentence's pause and
no more, 300 ms after the last sound and 150 ms before the first, and the
cut edge is faded over 5 ms so there is no step to hear as a click
(`service/seam.rs`). Measured on the service's own sound in the VM, the
owner's four sentences recorded from a null sink: 440, 320 and 420 ms, and
the largest step inside a pause 0.0012 of full scale (0.0013 in a pause
between two sentences of one voice). `speed` is the same for every voice.

**How it is read.** A voice reads by its own language's rules; a tag with a
region changes them where eSpeak NG has others: Spanish with a region that
is not Spain (`es-CO`, `es-MX`, `es-419`) is read as Latin American
(eSpeak's `es-419`: "gracias" with an s), `es` and `es-ES` as in Spain.
The shell sends the region of the person's formats, and `es-419` where
those are not Spanish.

**Numbers, money and measures** are said in the sentence's language.
eSpeak NG says digits, dates and decimals rightly in each language ("15 de
noviembre de 2026", "3,5"), and these it got wrong or never saw, so they
are made into words first (`engine/kokoro/reading.rs`):

| Written | English | Spanish | Before |
| --- | --- | --- | --- |
| `$20` | twenty dollars | veinte dólares; veinte pesos where the region counts in pesos (`es-CO`, `es-MX`, …) | "twenty": the sign was dropped |
| `$20.50` | twenty dollars and fifty cents | veinte dólares con cincuenta centavos | |
| `50%` | fifty percent | cincuenta por ciento | "fifty" |
| `3 km`, `3km` | three kilometers | tres kilómetros | "three kay em", "tres ka eme" |
| `1 h` | one hour | una hora | |
| `20°C` | twenty degrees Celsius | veinte grados centígrados | "twenty degrees C" |
| `15:30` | fifteen thirty | quince y treinta | "quince treinta" |
| `9:00`, `9:05` | nine o'clock, nine oh five | nueve en punto, nueve y cinco | "nine zero zero" |
| `1,000` | one thousand | mil | "uno coma cero cero cero" |
| `&`, `+`, `=` | and, plus, equals | y, más, igual a | nothing |

"sh" between two vowels in a Spanish sentence ("Dashi", "sushi") is given
to eSpeak as "ch", the nearest sound Spanish has: eSpeak's Spanish said it
as s ("Dasi"). At a word's start or end it keeps the sound ("show",
"flash") and the word is left alone.

Measures: km, m, cm, mm, kg, g, mg, l, ml, h, min, ms, km/h, °, °C, °F, KB,
MB, GB, TB, px, after a number or written against it. French, Italian and
Portuguese have money and `%` only; Hindi is left to eSpeak. Not done:
ordinals ("1º"), "veintiún dólares" (it says "veintiuno"), ranges ("3-5").

**To see what was said**, start the service with `DASHI_VOICE_DEBUG=speak`:
each sentence's voice, language, phonemes and text go to its log. Off
unless asked for; the log is otherwise never given what was said.
`dashi-voice speak --json` prints the same for a file.

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
| `rewrite` (542 MB) | `SpeakoFlow-Mini-0.8B-Q4_K_M.gguf` | 541 903 616 | `SpeakoFlow/speakoflow-mini` | Apache-2.0 (a fine-tune of Qwen3.5 0.8B, Apache-2.0) |

The `rewrite` set is the model that corrects dictation
(`docs/dictation-rewrite.md`). This service only fetches, verifies and removes
it, as any other set (it is not `basic`): it is never loaded here. The shell
starts llama.cpp's server on it.

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
  speak [--voice ID] [--language LANG] [--voices LANG=ID,…] [--hint LANG] [--one-voice]
        [--same-voice | --mix] [--speed N] [--json] --out FILE.wav TEXT…
  levels                                           each voice's loudness, pitch and pace
  models [--verify]                                the models, and which are here
  fetch [SET…]                                     fetch models (listen and speak, unless named)
  remove [SET…]                                    delete models (all, unless named)
  inspect FILE.onnx…                               a model's inputs and outputs
```

- `transcribe` reads PCM or float WAV at any rate, any channels. With
  `--json`: `text`, `language` (as `heard` tells it), `audio_ms`,
  `speech_ms`, `load_ms`, `ms`, `real_time_factor`.
- `speak` says what the service would, seams and levels as it would:
  `--voices`, `--hint` and `--one-voice` are `speak`'s `voices`, `hint` and
  `by_language: false`. `--json` prints `voice`, `audio_ms`, `load_ms`,
  `first_sound_ms`, `ms`, `real_time_factor` and each sentence's `voice`,
  `language`, `phonemes`, `level_db`, the hush before and after it
  (`lead_ms`, `tail_ms`), and its words and times; the WAV is 24 kHz,
  16-bit, one channel.
- Two experiments are the command line's alone, for listening. With
  `--same-voice` a sentence of another language is said by the voice asked
  for, read by that language's rules (Heart's own sound with Spanish
  phonemes: the same speaker, with an accent). With `--mix` it is said by
  the mean of the two voices (`ef_dora+af_heart`: a voice between them).
  The service does neither.
- `levels` prints a line of JSON for each installed voice: `level_db`,
  `peak`, `pitch_hz`, `phonemes_per_s`. Its levels and pitches are the
  table in `engine/kokoro/levels.rs`.
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

`docs/decisions.md` D27 to D29 say why.

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
| Key let go → the words (`listen.stop` → its reply), 7 s of speech | 0.31 s to 0.34 s, of which 0.13 s is the last eighth of a second heard |
| Speech begins → first `partial` | about 1 s; then one about every 0.8 s |
| `speak` → first sound (`sentence`), models warm | 0.37 s to 0.42 s for a short sentence |
| Key let go → Dashi heard at the speakers, a 7 s question, a stub agent that answers in 2 ms, a first sentence of 3.9 s (`dashi-0.8.0-review/10-polish/`) | 0.62 s to 0.65 s (before 0.8's cuts: 1.27 s to 1.30 s) |
| The same after ten idle minutes (the models let go of) | 0.68 s (before: 2.03 s) |
| The same under a screen recording | 0.82 s to 0.97 s (before: 1.50 s to 1.61 s) |
| `speak.stop` → silence at the speakers | under 20 ms |
| Fetching both basic sets (1 GB), with a cancel and a resume on the way | 23 s on the VM's connection |

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
  planner and its timing, the fetcher (from `file://` addresses), the
  language told for 83 sentences (English, Spanish, both in one, and the
  four other languages; `src/tongue/tests*.rs`), who says each sentence, the seam, how money and
  measures are read, and the whole service with scripted models and sound
  (`src/service/tests/`). No model and no audio device is needed.
- In the VM, with a null source and sink: `dashi-0.8.0-review/01-voice/` has
  the script, the WAVs, the transcript and the timings.

## What it can't do yet

- Only the Copilot key's tap talks. A key the person picked is held.
- The talk key and the dictation key are each one of a short list, not any
  key pressed to choose it.
- Dictation: no correcting model and no marks drawn in the field; hands-free
  does not end when this computer plays sound; a password field is known only
  where accessibility is on, and a field that takes no text only when no
  window has the keyboard at all.

- No words while Whisper listens are streamed token by token: partials are
  the whole speech so far, worked out again about every 0.8 s, which is
  cheap for Parakeet and slower for Whisper.
- A sentence that changes language half way is said by one voice, in the
  language most of it is in. A language is told among those turned on only.
- A character's voice in another language is another speaker (two Spanish
  voices in all); a mix of two voices and the same voice with another
  language's phonemes are experiments of the command line, not offered.
- No GPU: ONNX Runtime's CPU provider only.
- No Japanese or Mandarin voice (see "Languages").
- The word times of a phrase eSpeak NG re-words (numbers, some French
  liaisons) are shared out by length.
