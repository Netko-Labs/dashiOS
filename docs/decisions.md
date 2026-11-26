# Decisions

When a dilemma comes up again, the answer and why are here, so it is decided
the same way without asking. Part A is how to decide; Part B is what was
decided, one entry each. `docs/conventions.md` is the rulebook; this file is
the reasoning behind the calls that shaped it.

## Part A: how to decide

- **The owner's rules come first.** A rule the code doesn't follow means the
  code is wrong: fix the code and add a check. Never drop or loosen a rule
  without asking the owner. (D1)
- **Make a rule true before you name an exception to it.** An exception is a
  hole the next person widens. (D6)
- **Fix a problem where it starts:** in the library, in the compositor, in the
  shared code, not around it in each caller. A mirin bug is fixed in mirin.
- **When two rules fight,** keep the one that protects what a person sees or
  what keeps them safe, and change what the other one measures, not its
  threshold. (D2)
- **A check starts from today's offenders and may only get stricter:** lists
  shrink, never grow. (D3)
- **Prefer no dependency when Dashi uses a sliver of one.** Take a dependency
  when it removes more code than it adds and its licences are permissive all
  the way down. (D4, D12)
- **When the cause can't be reproduced,** make the failure harmless and make
  the log tell us the cause next time. (D9)
- **A refactor changes no behaviour,** and is not done until the installed
  packages have been run, not only the checkout. (D10)
- **Narrowing who may do something is worth breaking a development
  convenience.** Never widen it to make a tool work. (D8)
- **What can be undone, decide and write down here.** What can't (publishing,
  deleting, anything outside the repository, dropping a rule, a change in what
  a person sees), ask the owner.

## Part B: the decisions

Numbered in the order they were written down; a new one goes at the end.

### D1. `lib/` and `shared/` came back, and the code was made to follow them

- **Date:** 2026-11-10 (95278df8 removed them; da6a95a1 brought them back).
- **Question:** the rulebook's `lib/` rules were followed by nothing: no
  `lib/` folder existed. Drop the rules, or make the code follow them?
- **Choice:** first they were dropped, as "nothing uses it". That was a
  mistake: the rules were the owner's, taken from mirin's rulebook, and an
  unfollowed rule meant the code was wrong, not the rule. They came back the
  same day as hard rules H18 to H20, with `scripts/check-modules.ts`, and every
  module was moved into the shape (`index.ts`, `types.ts`, public files,
  `lib/`).
- **Why:** a module with one public surface and private insides is what the
  owner asked for in both repositories; a check keeps it true.
- **Cost:** every module of the repository moved into the shape, in six areas
  at once, and most import paths changed.
- **Undo:** none wanted. To drop a rule, ask the owner first.

### D2. H16 counts library modules at start, not Dashi's own

- **Date:** 2026-11-10 (07c99949).
- **Question:** H16's ceiling counted every module the shell loads at start.
  H2's file splits added modules without adding code, and the count reached
  1006 against a ceiling of 1000. Raise the ceiling, or stop splitting?
- **Choice:** H16 counts library modules only (21 at the time, ceiling 25).
- **Why:** H16 protects start-up time from heavy libraries (the AI SDKs);
  H2 protects people reading the code. Neither should lose. Raising the
  ceiling would only have moved the fight; measuring the right thing ended it.
- **Cost:** a start-up made slower by Dashi's own files is no longer caught by
  H16. `scripts/entry-weight.ts` watches each entry point's modules instead.
- **Undo:** count every module again in `scripts/boot-weight.ts`, with a new
  ceiling.

### D3. Every hard rule's check starts from a list that may only shrink

- **Date:** 2026-11-10 (279a74c3).
- **Question:** the hard rules had hundreds of offenders on the day they came
  in. Fix them all first, or let the checks pass on day one?
- **Choice:** each check starts from `scripts/lists/<name>.txt`, today's
  offenders and their counts. A new offender fails, a listed one may not grow,
  and one that got better must be trimmed (`--shrink`). Never add an entry by
  hand.
- **Why:** the rules could be enforced at once, on every push, while the old
  offenders were worked down.
- **Cost:** for a while a rule is true only for new code; a list is a debt to
  pay.
- **Undo:** none. A list reaching zero is the goal.

### D4. The AI SDKs were replaced by a small client of Dashi's own

- **Date:** 2026-11-10 (`dashi-0.7.0-review/05-ai`).
- **Question:** keep `@anthropic-ai/sdk` and `openai` (loaded only when
  asked), move to the Vercel AI SDK, or write our own client?
- **Choice:** our own, `agents/ask/http.ts`: one JSON POST, a timeout for each
  try, one retry.
- **Why:** the answerers use one non-streaming request each, a timeout and a
  retry. The SDKs were 64 MB and 494 modules, Apache-2.0 code inside the MIT
  package; the Vercel AI SDK was 31 MB, permissive all the way down, but kept
  all our provider code and added a message-format conversion, so it removed
  nothing. Ours is 0 MB and one file.
- **Cost:** 193 more lines of Dashi's own (retry rules, `Retry-After`, the
  timeout), and keeping up with the providers' APIs by hand.
- **Undo:** put an SDK back behind `http.ts`'s callers. Take one only if it
  removes more code than it adds.

### D5. Outside code imports a module's `index.ts`, or names one public file

- **Date:** 2026-11-10 (the `lib` areas, `dashi-0.7.0-review/11-lib`).
- **Question:** Bun loads every file a barrel re-exports. Must every importer
  use the index, even when that makes another process load the module's
  start-up?
- **Choice:** import the `index.ts`; name one public file (a file the index
  re-exports) only when the index would close an import cycle or load more in
  another process. `scripts/entry-weight.ts --check` holds every entry point
  to the modules it loads.
- **Why:** the index is the surface; but a barrel must never make an app or
  the settings preview load the shell's start-up.
- **Cost:** two ways to import a module, and a judgement for which.
- **Undo:** forbid naming public files in H19, and accept heavier processes.

### D6. Files' chooser moved to `src/shared/file-browser` rather than H4 naming an exception

- **Date:** 2026-11-10 (08e377a4, this file's first change).
- **Question:** dashi-dialog, the portal and Text Editor imported the chooser
  from `apps/files`, which H4 forbids. Move it to the app kit, to
  `src/shared/`, or name the exception in H4?
- **Choice:** `src/shared/file-browser/`: the browser Files and the chooser
  share (store, operations, listing, sidebar, toolbar, the chooser). Files'
  window, menus and path bar stay in `apps/files`. The five other wrong-way
  imports were settled the same way: code two sides need moved to
  `src/shared/<concern>` (`app-entries`, `session-power`, `logind`, `cards`,
  the settings writer, the appearance reader), and `import-ways.txt` is empty.
- **Why:** code four programs use is shared code, not one app's private code.
  An exception would have been a hole in H4 that the next app widens. The kit
  was wrong: it is the runtime, not components, and every app would load the
  browser.
- **Cost:** the biggest move of the release (59 files); Files names public
  files rather than the index, so it doesn't load the chooser.
- **Undo:** `scripts/move.ts` the files back; but then H4 needs an exception,
  which is the owner's call.

### D7. Tests may import a nested module's public files

- **Date:** 2026-11-10 (64a4210f).
- **Question:** a test of `agents/desktop`'s `Hands` reached a public file of a
  nested module, which H19 forbade when the outer index didn't re-export it.
  Widen the outer index for tests, put public pieces in `lib/`, or let tests
  in?
- **Choice:** a test may import a nested module's public files, as it may a
  top-level module's (`scripts/check-modules.ts`, `deep-imports`).
- **Why:** both other fixes made the code worse to suit the check. A nested
  module's public files are public; a test of them is a fair user.
- **Cost:** none in production code; tests see a little more.
- **Undo:** drop the nested-module line in `deepImports`.

### D8. "The shell" is the session client's process group and what it started

- **Date:** 2026-11-10 (2c1d64b7, 657e7433, a007ad6a).
- **Question:** the compositor trusted any client under the session client,
  which is every app the launcher starts. Who is the shell, on the IPC and on
  the privileged Wayland protocols?
- **Choice:** the session client, its process group, and the sessions it
  started (each service it runs is `setsid`). An app the shell launches has a
  session of its own and is not the shell. One table (`ipc/table.rs`) says
  who may ask each method; the privileged protocols use the same rule
  (`session/trust.rs`).
- **Why:** screen capture, clipboard without focus, and the lock screen must
  not be any app's to take.
- **Cost:** `vm/vm ipc` from an ssh login lost the shell-only methods; it gets
  only what anyone may ask (`session`, `outputs`, `gpus`). An app that needs a
  privilege is granted it by the shell (`ipc-clients`, `screencopy-clients`).
- **Undo:** not wanted. Never widen the rule to make a tool work; grant the
  tool instead, or use `--open-ipc` on a compositor run by hand.

### D9. A frame the display refuses is drawn without planes

- **Date:** 2026-11-10 (8d89f9b1, `dashi-0.7.0-review/12-flip`).
- **Question:** on the G14, every page flip failed with EINVAL while
  1Password's prompt was up, and the screen froze. Which plane the driver
  refused could not be proven: the VM has no overlay planes, and the kernel
  logs nothing without `drm.debug`.
- **Choice:** a refused commit steps down: the cursor plane only, then no
  planes; every plane is tried again after 5 s, doubling to 60 s. The log says
  what was on planes when refused and what worked, so the next time names the
  cause.
- **Why:** the screen must keep moving whatever the cause; the likeliest
  (amdgpu refusing a cursor over a scaled overlay) is a guess.
- **Cost:** some frames are composed instead of using planes, for a while: a
  little more GPU work.
- **Undo:** remove the step-down in `backend/udev/planes.rs`; first read the
  logs the laptop gave.

### D10. Shutdown runs in reverse start-up order, from one registry

- **Date:** 2026-11-10 (495f1fd2).
- **Question:** the shell stopped its services from a hand-kept list of 79
  names, which drifted from the start-up order.
- **Choice:** each piece says how it stops on the line where it starts
  (`services.add(name, stop)`); `closeAll()` runs the stops in reverse, once,
  and one that throws doesn't stop the rest.
- **Why:** one list, which can't drift, and the order the pieces depend on.
- **Cost:** the shutdown order changed. The smoke test ran it from the checkout
  and from the installed packages (`dashi-0.7.0-review/10-smoke-final`), and
  the packages caught what the checkout couldn't: the `dashi` RPM lacked the
  new `@dashi/shape`, and the installed session did not start (7adb65d4). Hence
  Part A's rule: a refactor is not done until the packages have run.
- **Undo:** none wanted.

### D11. The compositor's IPC and the shell parse strictly; replies on screen are read leniently

- **Date:** 2026-11-10 (f8e22188, a96e750c, `dashi-0.7.0-review/08-shape`).
- **Question:** the IPC was parsed by hand, with defaults for what was missing
  or wrong. Accept what can be read, or refuse what doesn't fit?
- **Choice:** both sides parse strictly: serde types that refuse unknown
  fields and out-of-range numbers in Rust, `@dashi/shape` in the shell, and a
  refusal names the field. A list shown on screen is read leniently
  (`lenientList`): one bad entry is dropped, not the whole list.
- **Why:** a bad frame is a bug to see, not to guess around; but losing one
  row of a list on screen is better than losing the screen.
- **Cost:** what used to be accepted is refused. A hand-edited settings file
  with a keyboard repeat over 100 loses the whole `keyboard` request, logged
  only.
- **Undo:** make a field lenient where losing it is harmless, one at a time,
  in the shape.

### D12. One parser for outside data, `@dashi/shape`, with no new dependency

- **Date:** 2026-11-10 (a96e750c).
- **Question:** take a schema library (zod) or grow our own from the applet
  package's parser?
- **Choice:** `@dashi/shape`, grown from `applet/parse.ts`: one definition gives
  the parser, the type and a JSON Schema.
- **Why:** Dashi used a sliver of what a schema library does, and a JSON
  Schema it needs for agents' tools; a small kit of our own does both.
- **Cost:** the kit is ours to keep.
- **Undo:** replace the shapes with a library behind the same names.

### D13. Every check runs on every push, in CI, with mirin beside Dashi

- **Date:** 2026-11-10 (95278df8, `.github/workflows/check.yml`).
- **Question:** CI on GitHub Actions, or local hooks only?
- **Choice:** both: CI runs `bun run check` in a Fedora 44 container with
  mirin checked out beside the repository (the branch named like Dashi's, else
  `.mirin-branch`); `.githooks/pre-push` runs the quick ones.
- **Why:** a rule no machine runs isn't a rule; and Dashi doesn't build
  without its mirin.
- **Cost:** a mirin branch to keep for each Dashi branch that needs one.
- **Undo:** none wanted.

### D14. 0.7 ships on the mirin it was built on, not on mirin's `main` yet

Replaced by D51: 0.9 builds on mirin's `main`.

- **Date:** 2026-11-10 (`.mirin-branch`).
- **Question:** Metal reached mirin's `main` on 2026-11-10 (mirin #22), with 15
  commits Dashi had never run on. One of them rebuilt a window's whole
  accessibility tree on every frame of a scroll or resize: Files' host used
  about 30% of a core scrolling a long list, against about 20% before. The
  fix (mirin #23) sits in the same files as performance work another agent has
  in progress, so it waits for that work. Build 0.7 against `main` now, or
  against `wave4-0.7`, the mirin 0.7 was developed and smoke-tested on?
- **Choice:** `wave4-0.7` (4b6ebea). `.mirin-branch` names it again. Dashi moves
  to `main` when the performance work and #23 have landed there.
- **Why:** a release doesn't take a known slowdown to follow a branch name; and
  a fix isn't merged over someone's work in progress in the same files.
- **Cost:** 0.7 misses `main`'s other fixes for now (a screen reader's focus
  no longer presses a button; a dialog that can't start answers as a cancel).
  The chooser's move and the sheet fix were smoke-tested with `main`'s host;
  with this host they have the checks and the earlier smoke tests, not a VM
  pass of their own.
- **Undo:** write `main` in `.mirin-branch` and rebuild the Metal host.

### D15. The focus ring is purple everywhere

- **Date:** 2026-11-11. The owner's decision, open since 0.5.
- **Question:** the ring was kombu in apps and purple (`#6E56CF`) only in
  Control Center and System Settings, where a green ring vanished on green
  tiles, switches and pills. Two rings, and green with a second meaning.
- **Choice:** one purple ring in every app, the shell, the launcher, sheets,
  the lock screen and the login screen. Green means "on" and nothing else.
  `@dashi/ui`'s `focusRing` is the one source: the shell's palette
  (`shared/controls/palette.ts`) and `LOGIN_FOCUS_RING` read it.
- **Why:** a ring must show on whatever it rings, and one color must have one
  job (CO-1).
- **Cost:** shiso has a second job, the keyboard's. It stays a 2 px line,
  never a fill, a tile or a word, so it does not read as an agent.
- **Undo:** ask the owner. The value is two lines of `palette.ts`.

### D16. Primary buttons are ink

- **Date:** 2026-11-11. The owner's decision, open since 0.5.
- **Question:** the one button that goes ahead was kombu under white words.
  Nothing about it is "on".
- **Choice:** ink. In Light the ink (`#1D1D1F`) under white words; in Dark the
  light ink (`#ECECEE`) under black words. It deepens under the pointer and
  more while held, its words AA in every state; disabled, the whole button at
  40%. Danger stays ume. New tokens `primary`, `primaryHover`,
  `primaryPressed`, `onPrimary`; `buttonLook` is the one look, and the sheets
  that drew their own (consent, Force Quit, Restart, the capture toolbar, the
  agents' panel) call it. Selected rows, switches, ticks, "on" tiles, chosen
  pills and the selection wash stay green.
- **Why:** green means on or chosen (CO-1). Settings' and Setup's pills were
  ink already.
- **Cost:** in Light the steps from ink to black are small to the eye (16.8,
  19.3, 21 to 1 under white); the owner asked that they deepen, so they do.
- **Undo:** ask the owner. The fills are eight lines of `palette.ts`.

### D17. The smaller calls that came with D15 and D16

- **Date:** 2026-11-11. The `colours` agent's, each reversible.
- **Dark's ring is the lighter shiso, `#8B76E8`** (Dark's `agent`), not
  `#6E56CF`. `#6E56CF` passes 3:1 on true black and its lifts (3.9, 3.65,
  3.41) but with little to spare, and falls under on a hovered tile; the
  lighter one is 5.1 or more, and the ring is `agent`'s value in both modes.
  The login screen, dark in either mode, takes Dark's. Undo: one line.
- **A default secondary button has a 2 px ink edge** (`isDefault`), where it
  had a kombu ring. It says "Enter presses this", which is the primary
  button's meaning, so it wears the primary's color as a line. Purple would
  say the keyboard is there when it may not be; kombu would say "on".
- **A text field's focused edge is the ring's purple,** where it was kombu
  (`TextField`, Files' rename field, Calendar's and dashi-dialog's fields): it
  is focus, and one ring means one color.
- **A chosen pill is its own kind in `buttonLook`, `chosen`,** still kombu:
  it shared the primary's fills, and it is chosen, not a way ahead.
- **Software's Get, Open and Update pills have ink words,** where they had
  kombu words (`accentInk`): they go ahead and nothing is on. The pill stays
  quiet; the app's page has the ink primary button.
- **The consent sheet's destructive button is `umeFill`,** as every other
  destructive button, where it was `critical` (pink under white in Dark,
  2.9 to 1).
- **The ring around the active window stays kombu** (DE-3): it marks the
  window that is chosen, and a purple ring around a whole window would read as
  an agent at work in it.
- **Left as they are, for the owner:** kombu links (`accentInk`), the kombu
  tile behind an alert's glyph, and GTK apps, whose suggested buttons and
  focus outlines follow GTK's accent, which is kombu.

### D18. An app's output and input are set by the device's serial, so WirePlumber remembers them

- **Date:** 2026-11-11 (the mixer, `dashi-0.8.0-review/02-mixer`).
- **Question:** the owner decided WirePlumber remembers the mixer's choices
  and Dashi keeps no table. 0.5 sent an app to an output with
  `pw-metadata <id> target.object <node.name>`. WirePlumber carries that out,
  but its stream state looks the value up as an object.serial, finds none,
  and stores "no target": the choice was gone when the app restarted.
- **Choice:** `target.object` holds the device's object.serial (`Spa:Id`),
  as WirePlumber itself writes it when it restores a stream. A node.name is
  sent only for a device with no serial. The graph tells either form as the
  device's node.name (`sound/apps/streams.ts`, `lib/commands.ts`).
- **Why:** it is the form WirePlumber stores (as the device's node.name) and
  gives back to the app's next stream, after a restart or a new login.
- **Cost:** what WirePlumber's restore can't do stays undone, since Dashi
  keeps nothing: two streams of one app are not remembered apart (they share
  the app's key, so the last one changed wins for the next stream), and an
  app whose chosen device is away when it starts plays on the default until
  its next stream.
- **Undo:** write names again in `moveCommands`; or keep a table of Dashi's
  own, which is the owner's call.

### D19. A meter is one `pw-record` per node on screen, and never falls back

- **Date:** 2026-11-11.
- **Question:** a live level for each app and each open stream, cheap, with
  no meter running while nothing shows it. Link PipeWire's library, or run
  its own recorder as Settings' microphone meter already does?
- **Choice:** one `pw-record --target <serial>` per node a row on screen
  listens to, 8 kHz mono, read for its loudness and dropped
  (`sound/stream-meters.ts`). A playing stream is listened to itself; an app
  that records is metered at the device it records from, since a recording
  stream has no output to listen to. Rows on one node share one recorder; 16
  run at most; a muted row's meter reads empty and doesn't listen. The
  recorder is told `node.dont-fallback` and `node.dont-reconnect`, so when
  its target is missing or goes it ends.
- **Why:** no dependency, the tool is PipeWire's own, and the rule that
  matters is kept by PipeWire, not by Dashi's care: a meter for an app's
  sound can never end up listening to the microphone.
- **Cost:** a process per metered node while Settings › Sound shows it.
  Control Center's short list has no meters.
- **Undo:** replace `pipewireMeter` behind `StreamMeters` with a client of
  PipeWire's library (MIT), which could meter every node from one process.

### D20. The mixer folds with "More"'s treatment, and the meter takes the line under the name

- **Date:** 2026-11-11.
- **Question:** a folded app must stay one row, yet say it has streams, show
  a live level and keep its slider, mute and output.
- **Choice:** the line under the app's name (20 tall, where "Playing" was)
  holds the fold in "More"'s words ("3 streams" and a chevron, "Hide
  streams" when open) and then the meter, 64 by 4, ink; "Paused" stands
  where the meter would while no sound moves. A stream's row is 44, under
  its app with no line between. Meters are ink, the microphone's too (it
  was green): green means on.
- **Why:** no height is added to a row, and the word that was there
  ("Playing") is said better by a bar that moves.
- **Cost:** "Playing" is no longer written; a screen reader hears it in the
  row's name instead.
- **Undo:** `StatusLine` in `sound-mixer-parts.tsx`.

### D21. Apps that record this computer's own sound are listed, and keep what they record

- **Date:** 2026-11-11.
- **Question:** the recording card listed only microphone users. The mixer
  lists every app that records, with its level and mute; what of a screen
  recorder, which records a sink's monitor?
- **Choice:** it is listed, without the orange dot (it is not the
  microphone, and the menu bar's pill stays off), with its level and mute;
  its "Record from" reads "System sound" and is dimmed. Agents get
  the same refusal (`set_app_input`: `own-sound`).
- **Why:** moving a screen recorder onto a microphone is never what a
  person meant by a pop-up of microphones.
- **Cost:** such an app's source can't be changed from Dashi.
- **Undo:** drop `fixed` in `sound-recording.tsx` and `own-sound` in
  `lib/machine-sound.ts`.

### D22. Agents choose an app's input with a tool of its own

- **Date:** 2026-11-11.
- **Question:** `set_app_volume` already takes an output. Add `input` to it,
  or a second tool?
- **Choice:** `set_app_input {app, level?, muted?, input?}` for the apps
  under `recording`; `set_app_volume` is unchanged, for the apps under
  `apps`. `get_sound` reads the whole mixer. Both are in the `settings`
  scope, as the sound tools were.
- **Why:** an app that plays and records has two rows with two levels; one
  tool with both would have to say which side a level is for.
- **Cost:** one more tool in `tools/list` (the fixture changed with it).
- **Undo:** fold it into `set_app_volume` with a `side` argument.

### D23. dashi-comp's renderer makes no fence per texture it draws

- **Date:** 2026-11-11 (`dashi-0.8.0-review/03-bugs/cpu`).
- **Question:** smithay's GLES renderer, when the card can (`Capability::Fencing`,
  every GLES 3 card), waits on a fence and makes a new one after each quad it
  draws from a texture. A fence flushes the GL context, so each frame flushed
  once per surface, title bar and wallpaper piece drawn: about a seventh of
  dashi-comp's time while a window scrolled. Keep them, patch smithay, or ask
  for a renderer without that capability?
- **Choice:** dashi-comp makes its renderers itself (`backend/udev/renderer.rs`)
  with every capability the card has but `Fencing`. The frame's own fence for
  the display (`ExportFence`) stays.
- **Why:** the fences order reads and writes of one texture between EGL
  contexts that share it. Dashi's share nothing: one context per card, used
  only on the event loop, where GL runs in the order it is called. smithay
  offers the choice (`GlesRenderer::with_capabilities`), so nothing is patched.
- **Cost:** if dashi-comp ever draws from a second thread or shares a context
  between cards, the fences must come back for those textures.
- **Undo:** `GpuManager::new(GbmGlesBackend::default())` in
  `backend/udev/start.rs`.

### D24. Return goes ahead on the Log Out, Restart and Shut Down sheets

- **Date:** 2026-11-11.
- **Question:** those sheets took Esc only, "so a stray key cannot shut the
  machine down", though their go-ahead button is drawn as the default one.
  Design rule UI-6 lets Enter go ahead only when that is safe. Is it, here?
- **Choice:** Return presses the default button (Log Out, Restart, Shut Down);
  Esc cancels.
- **Why:** going ahead loses nothing: every app is asked to close first, one
  with unsaved changes asks the person, and the holding notice still has
  Cancel. A sheet that draws a default button and ignores Return is a broken
  promise. The stray key the old rule feared, the Return that chose the menu's
  row, can't arrive: a held key doesn't repeat into a surface that got the
  keyboard after it went down (GPUI stops its repeat when the keyboard leaves).
- **Cost:** a Return pressed twice by mistake on "Restart…" restarts.
- **Undo:** drop `onSubmit` on `ConfirmSheet`'s `KeyCatcher`
  (`menus/lib/power-sheets.tsx`).

### D25. "Demo mode" is called "Let agents work alone"

- **Date:** 2026-11-11. The `demo` agent's, reversible.
- **Question:** the brief called the switch "Demo mode" and asked for a
  better plain name if there was one.
- **Choice:** the switch is **Let agents work alone**; the feature is "Work
  alone" in code (`agents/alone/`, `get_work_alone`) and "Working alone" in
  the docs. "demo", "demo mode" and "unattended" find it in the launcher and
  in Settings' search.
- **Why:** the name says what happens, to a person who has never seen it.
  "Demo" names one use of it (it is as much for a long task while the person
  is at lunch), and on phones and in shops "demo mode" means a display unit
  with made-up data. "Unattended" is a long word for "alone".
- **Cost:** the plan and the review folder say "Demo mode"; this entry and
  the keywords are the bridge.
- **Undo:** the title in `settings-app/registry/lib/you.ts`, and the words in
  `alone-chip.tsx`, `agents-alone.tsx` and `record-words.ts`.

### D26. The calls that came with working alone

- **Date:** 2026-11-11. The `demo` agent's, each reversible.
- **It ends when the screen locks, unless the person chose to keep it.** A
  lock means the person left the desk closed, or the computer was left idle
  long enough to lock itself; whoever unlocks it should find agents asking
  again. Turning it back on is one press. Kept through a lock, its time
  still runs, and agents still do nothing while it is locked. Undo: the
  default of `throughLock`.
- **What runs is kept in memory only.** Logging out, a restart, or the shell
  crashing ends it; nothing on disk can bring it back or be edited to turn
  it on. Cost: a shell that crashes mid-demo ends it. Undo: not wanted.
- **The person picks kinds of tools, not single tools.** They are the kinds
  the consent sheet already asks about, so the picks start from what was
  allowed, and eleven ticks fit where ninety would not. Cost: no "only
  `screenshot`". Undo: a list of tools beside the kinds in `rules.ts`.
- **It covers every agent,** connected then or later, local or over SSH:
  the person is away, and can't say which agent will ask. What a launcher
  run's card refused stays refused. Undo: a key check in `Scopes.worksAlone`.
- **Only the person's presses change a pick, too.** An agent that may click
  in windows could tick more boxes in Settings and leave them for the person
  to turn on without looking. The pane asks the compositor whose press it was
  for every tick, time and site, as it does for the switch. Cost: one
  `input-origin` round trip for each change. Undo: `mine` in
  `agents-alone.tsx`.
- **Signing in is never covered,** though its sheet is a per-login one and
  not the fingerprint: it uses the vault's secrets, and the brief says
  "anything needing the fingerprint or password, reading secrets". An
  unattended agent that needs a login waits, or the person hands it over.
- **The longest time is 8 hours.** Longer than a working day is a standing
  permission, which Always Allow already is, by agent. Undo:
  `ALONE_MAX_MINUTES`.
- **One click on the chip stops it, with no "are you sure".** Stopping only
  narrows, and a mistaken click costs one press in Settings. ⌃❖Esc and the
  panel's Stop all end it too: "stop the agents" should leave nothing they
  may do by themselves.
- **`get_work_alone` never asks.** Whether it is on is no secret, and an
  agent that must first get a sheet answered to learn it can work alone
  would stall, which is the problem this solves. It is the one tool with no
  permission. Undo: the line in `Scopes.call`.
- **The record lists every call made while it ran,** not only the ones that
  ran without asking: "what agents did" is the question the person comes
  back with. Each says whether it asked.
- **It is shown by a notification and kept in Settings › Agents,** not on a
  sheet or a banner: one chrome row, and a person who comes back to a locked
  screen finds it in the notification center.

### D27. Voice runs on Fedora's ONNX Runtime, loaded at run time; its models are fetched, not shipped

- **Date:** 2026-11-11 (`crates/dashi-voice`, `docs/voice.md`).
- **Question:** which engine hears and speaks, and how does it build on COPR,
  where a build script that downloads a prebuilt library fails? sherpa-onnx
  (Apache-2.0) runs all the models but builds its own ONNX Runtime, or fetches
  one; Handy's crates do the same.
- **Choice:** the models are run directly on ONNX Runtime (MIT) through the
  `ort` crate (MIT OR Apache-2.0) with `load-dynamic`: the library is Fedora's
  `onnxruntime` package, found when a model is first loaded. Nothing is linked
  or downloaded at build time. The pipelines are Dashi's own, a few hundred
  lines each (`src/engine/`): Silero VAD (MIT); Parakeet TDT 0.6B v3
  (weights CC-BY-4.0, credited in the notices and in `models`' `credit`);
  Whisper large-v3-turbo (weights MIT) for the languages Parakeet lacks;
  Kokoro 82M (Apache-2.0) with token lengths for word times. The models are
  fetched to the person's data folder when Voice is turned on, each file
  pinned by commit and SHA-256 (`models/manifest.rs`).
- **Why:** one runtime for four models, from the distribution, with no build
  dependency at all: the crate builds and its tests run on a machine without
  the library, in CI and on COPR. A newer ONNX Runtime keeps the older API, so
  a Fedora update does not break it. sherpa-onnx would have been less code of
  ours and a C++ build with its own downloads.
- **Cost:** the decoding loops, Whisper's spectrogram and the phoneme table
  are ours to keep. `ort` is a release candidate, pinned (`=2.0.0-rc.15`), and
  asks ONNX Runtime for API 21: `api-22` crashes Fedora's 1.22.2 in its device
  listing. Kokoro's full-precision file is used (325 MB): the 16-bit one gives
  silence on some sentences and the 8-bit one is three times slower on a CPU.
  About 1.9 GB of memory while the listening and speaking models are loaded;
  they are let go of after ten minutes unused.
- **Undo:** put sherpa-onnx behind `engine::Recognizer` and
  `engine::Synthesizer`; the service and the protocol don't change.

### D28. eSpeak NG, PipeWire's tools and curl are programs Voice runs, not libraries it links

- **Date:** 2026-11-11 (`engine/kokoro/phonemes.rs`, `audio/pipewire.rs`,
  `models/fetch.rs`).
- **Question:** Kokoro needs phonemes, and eSpeak NG, which gives them, is
  GPL-3.0-or-later. The microphone and speakers need PipeWire; the models
  need HTTPS. Link libraries, or run programs?
- **Choice:** run programs: `espeak-ng` for a phrase's phonemes (the licence
  rule's "a separate program Dashi only runs"), `pw-record` and `pw-play` for
  sound on a pipe, `curl` for fetching (it resumes a stopped file by itself).
- **Why:** nothing GPL is linked, so Dashi stays MIT. No bindgen, no libclang
  and no `-devel` package at build time; no `unsafe` for audio; stopping a
  program closes the microphone and silences speech at once, whatever state
  it was in. A Rust HTTPS client would have brought a TLS stack and a root
  store whose licences need a look each.
- **Cost:** a process start for each phrase said (about 5 ms) and each listen
  (about 30 ms); the streams' latency is `pw-cat`'s (20 ms asked). Kokoro was
  trained on misaki's phonemes, and eSpeak's are close, not the same: a few
  words sound flatter than they could.
- **Undo:** a phonemizer of our own behind `kokoro::Phonemizer`; the
  `pipewire` crate behind `audio::pipewire::Sound`.

### D29. The service that hears has no network; a process of its own fetches

- **Date:** 2026-11-11 (`spin/dashi-voice/usr/lib/systemd/user/`,
  `service/fetching.rs`).
- **Question:** the service must fetch models, and must promise that no sound
  leaves the machine. One process with both the microphone and the network?
- **Choice:** two. `dashi-voice.service` may use Unix sockets only
  (`RestrictAddressFamilies=AF_UNIX`). A fetch is `dashi-voice fetch`, started
  with `systemd-run --user` as a unit of its own, which has the network, runs
  `curl`, and never sees sound; the service reads its progress from a pipe.
  The socket refuses agents by cgroup, as the vault does.
- **Why:** "nothing leaves the machine" should be what the kernel enforces,
  not what the code intends. Narrowing who may do something is worth a little
  machinery (Part A, D8).
- **Cost:** a fetch needs the session's systemd; from a checkout, without the
  unit, the service runs the fetcher as its own child, with the network it
  then has. Filesystem sandboxing (`ProtectHome`) is not used: a user unit
  needs user namespaces for it, and the data folder may not exist yet.
- **Undo:** drop `DASHI_VOICE_FETCH_VIA` and the address-family line from the
  unit; the service then fetches as its own child everywhere.

### D30. Code may be adapted from Apache-2.0 projects, as long as Dashi stays MIT

- **Date:** 2026-11-11 (the owner's call; `docs/conventions.md`, "Licenses").
- **Question:** Voice's phoneme table follows misaki's and its token table is
  Kokoro's, both Apache-2.0. The rulebook let adapted code come only from MIT,
  BSD, ISC or Zlib projects, though Apache-2.0 libraries were already allowed.
- **Choice:** Apache-2.0 joins the list for adapted code. Those files stay
  Apache-2.0 inside an MIT project: the notice names them, says they were
  changed, and carries the project's `NOTICE` text. The owner's line: nothing
  may force Dashi to change its own license.
- **Why:** Apache-2.0 is permissive and asks only for its notice and a word
  that the files changed; it puts no terms on the rest of Dashi. Copyleft and
  non-commercial code is still never copied (clean room only).
- **Cost:** a few files carry a second license, and a person reusing them
  must keep the Apache notice. Apache-2.0's patent terms don't sit with GPLv2
  code, which Dashi doesn't link.
- **Undo:** take Apache-2.0 back out of the rule and rewrite those tables
  clean room from a spec.

### D31. H7's check sees a cast of what a hand-written check left of `unknown`

- **Date:** 2026-11-11 (the review of 0.5 to 0.7, pull request 4).
- **Question:** H7 forbids `as T` on outside data, and its check looked only
  at values typed `unknown` or `any`. `typeof x === "object" && x !== null`
  makes `x` an `object`, and `Array.isArray(x)` an `any[]`: a cast after
  either passed the check, 131 times in 75 files, though it checks as little.
  How far should the check reach?
- **Choice:** it also counts a cast from `object`, from `{}` and from a list
  or tuple of unknown, to any type that claims more. Not counted: a cast to a
  type that claims nothing (`as unknown[]`), a literal written there
  (`{} as T`), and a generic parser's own result (`as Tuple<S>`), which its
  schema types. A cast from `Record<string, unknown>` is not counted either:
  that is what `isRecord` and a parser give, and also a type code builds for
  itself (a section of settings, a tool's arguments, spawn options), which the
  check cannot tell apart. Every offender was fixed, none listed: `isRecord`
  from `@dashi/shape` in place of the private checks, a type predicate where
  a list is checked entry by entry, and a shape where a file is read
  (`orElse` is new there, for a file where one bad field must not lose the
  rest).
- **Why:** the rule was the owner's and the code did not follow it; the check
  is what keeps it true (Part A, D1). The line is drawn where the type alone
  says "this came from unknown".
- **Cost:** `isRecord` refuses a list where `typeof x === "object"` took
  one. Every place read named fields, which a list has none of, so nothing
  that was read before is refused now. Settings still casts each section it
  read from a `Record` to its type (`settings-app/sections.ts`, 21 times, and
  `shared/time/clock.ts`, twice): its checks say true or false, not what type
  they found. Typing them is the next step, and the check does not see it.
- **Undo:** take `isNarrowedCast` out of `scripts/check-boundaries.ts`; the
  code stays stricter than the check.
- **Since:** D42 counts the cast from `Record<string, unknown>` too, and
  Settings' sections are read by their shapes.

### D32. Esc closes an applet's popover from the shell, not from the applet

- **Date:** 2026-11-11.
- **Question:** Esc didn't close an applet's popover while an app had the
  keyboard. The SDK closes it on Esc, but a package bundles the SDK it was
  built with, and a popover from before 0.5 never takes the keyboard. Fix
  the SDK again, make the shell's catcher take the keyboard, or bind the key?
- **Choice:** while a popover is open, Esc is a rule of the keymap, ahead of
  the others (`POPOVER_RULES`, `setOpenRules`); the shell sends `dismiss`.
- **Why:** it works for every applet, old or new, and wherever the keyboard
  is. A catcher that takes the keyboard would fight a new popover for it (the
  compositor gives an exclusive layer the keyboard at each commit).
- **Cost:** Esc never reaches the focused app or the popover itself while one
  is open; a popover that wanted Esc for its own use can't have it.
- **Undo:** drop the `onOpenChange` listener in `boot/keys.ts`.

### D33. Tab types a tab in Text Editor and in a note's body

- **Date:** 2026-11-11.
- **Question:** Tab moved the keyboard out of the document to the toolbar
  (KB-1: Tab reaches every control). A text editor needs to type one.
- **Choice:** mirin's multiline field takes `tabBehavior="insert"`; Text
  Editor's text and a note's body ask for it. Shift+Tab still moves the
  keyboard back, and Ctrl+Tab on. Other multiline fields (an event's notes, a
  dialog's text) keep Tab for focus: they are fields of a form.
- **Why:** a document is where Tab is a character, as in every editor; the
  keyboard can still leave both ways.
- **Cost:** Tab alone no longer walks out of a document.
- **Undo:** drop the prop in `apps/editor/lib/views/text-area.tsx` and
  `apps/notes/lib/views/note-page.tsx`.

### D34. A window title's detail is whole, cut to a useful length, or not shown

- **Date:** 2026-11-11.
- **Question:** in a narrow window "All Notes — 1 note" became "All Notes —
  …", and `dashi-dialog --directory` cut "Choose a folder" while its search
  field still had room to give.
- **Choice:** the detail keeps a place as wide as its words, up to 120: with
  less room it is not drawn at all; a longer one is still cut with an
  ellipsis, never below 120. The title keeps its own width, up to 128
  (`TITLE_KEEP`; at least 96 as before), before a field in the toolbar that
  shrinks gives any (`dashi-ui/src/window-title.tsx`).
- **Why:** a bare "…" says nothing, and a short title is worth more than the
  last 30 points of a search field.
- **Cost:** a short detail disappears a little earlier than it would be cut;
  a toolbar with no field that shrinks needs up to 32 more points.
- **Undo:** `TITLE_KEEP` back to `TITLE_MIN`; `DETAIL_KEEP` to 0.

### D35. Text of two sizes shares a baseline where a row asks for it

- **Date:** 2026-11-11.
- **Question:** 11 to 12 pt text sat up to 1 pt high beside 13 pt text: a
  row centers boxes, and mirin's layout had no baselines. Correct the
  metrics so centered boxes line up, or add baseline alignment?
- **Choice:** baseline alignment, in mirin: GPUI's text names its first
  line's baseline to taffy, and a view takes `alignItems: "baseline"`. The
  sidebar's name and count use it first.
- **Why:** centered boxes of two sizes can't share a baseline whatever the
  metrics; this is what CSS has, and each row opts in.
- **Cost:** rows are fixed one at a time; a glyph has no baseline, so words
  that share one sit in a row of their own beside it. An older Metal host
  refuses a tree that asks for it.
- **Undo:** `alignItems: "center"` in `dashi-ui/src/sidebar.tsx`.
### D36. The talk key is a key the compositor holds for the shell, named by its code

- **Date:** 2026-11-11 (`crates/dashi-comp/src/keys/held.rs`,
  `packages/shell/src/voice/keys.ts`; docs/compositor-ipc.md `held-keys`).
- **Question:** hold-to-talk needs a key going down and coming up, kept from
  the focused app. The keymap binds chords and has no "up"; ❖ is the
  compositor's own; and a Copilot key sends ⇧❖F23 on many laptops.
- **Choice:** a mechanism of its own. The shell lists keys by evdev code
  (`held-keys`), the compositor takes them before anything else (before ❖,
  before the keymap) and says `held-key` down and up. Which keys and what
  they mean stay in the shell. The right ❖ and F23 are held by default; the
  F23 is taken whatever is held with it, and marks the ❖ it came with as a
  chord, so no launcher opens. `bare` keys (Esc) are taken only alone.
- **Why:** a code names the key whatever the layout calls it (F23 is
  `XF86TouchpadOff` on some xkb data and `XF86Assistant` on newer), and a
  key taken before ❖'s own handling can't also be a modifier or open the
  launcher, which is what the owner asked of the right ❖.
- **Cost:** a second way to take keys beside the keymap. The person picks
  the key from a short list, not by pressing any key. Voice off, nothing is
  held, so the right ❖ is a ❖ again.
- **Undo:** an empty `held-keys` list; the mechanism can stay unused.

### D37. The voice chip is laid over the bar's free room, and cut by characters

- **Date:** 2026-11-11 (`packages/shell/src/voice/chip.tsx`,
  `voice/lib/captions.ts`; docs/design.html, "The voice chip").
- **Question:** captions need room in a one-row bar whose status side
  already gives way to the menus. Where does the chip go without pushing
  anything, and what happens to a long sentence?
- **Choice:** it is not in the row. It is laid over the bar, centred in the
  room between the app's menus and the status side, up to 440 wide. A spoken
  sentence is cut into lines at word ends, as many characters as the chip's
  width holds (56 at its widest; `chipChars`), and the line being said
  shows; what the person says shows its newest words with "…" in
  front; a notice shows its first 90 characters. With under 150 of room it
  keeps 150 and covers its neighbours' edges while it shows.
- **Why:** an item in the row would send Sound and Wi-Fi into "…" every time
  the person talked. Laid over, nothing moves (VS-1), and the words never
  wrap or grow the bar.
- **Cost:** on a narrow screen with long menus it covers part of them for as
  long as Dashi listens or speaks. It shows on every screen's bar.
- **Undo:** a status slot `goes: null` in `menubar-program-slots.tsx`.

### D38. Nothing said runs a plan: a spoken ask waits for the person's Return (superseded by D261: plans are left only for GPT by voice)

- **Date:** 2026-11-11 (`packages/shell/src/voice/asker.ts`).
- **Question:** the launcher's agent answers with a plan that runs on the
  person's own Return. Should a spoken "yes" run it?
- **Choice:** no. A spoken ask is a launcher task like a typed one; when it
  comes back with steps Dashi says them and opens the launcher on the plan,
  and Return there runs it, checked by `input-origin` as always.
- **Why:** consent is the person's hands (docs/secrets.md, `agents/person.ts`).
  A microphone hears a video, a guest, or a page read aloud as well as it
  hears the person, and Part A says to narrow who may do something.
- **Cost:** asking Dashi to do something takes one key press after talking.
- **Undo:** not wanted without a way to tell the person's voice from others.

### D39. `ask_person` has its own permission, may be covered by Work alone, and its spoken answer is sent as heard

- **Date:** 2026-11-11 (`agents/tools/lib/ask.ts`, `agents/consent.ts`,
  `agent-sheets/lib/question-sheet.tsx`).
- **Its own permission, "Ask you questions".** The owner asked for a consent
  kind of its own. It is asked for once and can be kept: a question is the
  least an agent can do to the person, and a sheet before every question
  would be two sheets.
- **Work alone may cover it.** The person may tick it with the other kinds.
  Why: a question only talks and shows, and an agent left alone that hits
  something only the person knows should be able to ask and hear "no
  answer" rather than stall on a consent sheet. It is not in the never list
  because its answer is words, not a permission: everything that asks every
  time, or needs the fingerprint or password, still does. Undo: add `ask` to
  `NEVER_ALONE_SCOPES`.
- **Answered by the talk key, not by a listen that opens by itself.** The
  owner's words. The microphone opens only on the person's own press.
- **The spoken answer goes as heard,** shown in the chip ("You said: …"),
  with no second press to confirm. Why: confirming is typing, which is the
  other way to answer. The result says `by: "voice"` and the tool's words
  tell the agent speech may be misheard. Undo: put the words in the sheet's
  field for Return instead (`questionSheet.shown`).
- **The wait is the agent's `seconds`, counted from when the sheet shows,**
  10 to 300, 60 unless given, in place of the queue's two minutes.
- **It can't be turned into a secret's way out.** The field is plain, the
  sheet says it is no place for a password, code or card, the tool's words
  forbid asking for one, and nothing reads the answer but the agent.

### D40. The smaller calls that came with Voice in the shell

- **Date:** 2026-11-11. Each reversible.
- **A tap does nothing but say how.** Under 300 ms nothing is heard; it
  stops Dashi if it was speaking, else the chip says "Hold … to talk." for
  2.5 s. A Copilot key whose firmware releases it at once is a tap: the
  person picks another key. Undo: `TAP_MS`.
- **Esc is held only while there is something to stop,** and only alone, so
  apps keep Esc the rest of the time and ⌃❖Esc still stops agents.
- **A failed ask is said and stays in the chip** for 4 s after, with a press
  that goes where it is fixed. An answer Voice can't say (a language it has
  no voice for) is shown instead.
- **The agent is told the ask was spoken** (a line after the words, as the
  launcher's context chips go), so it answers in a sentence or two.
- **`listen` names no language** unless the session's is one only Whisper
  hears: Parakeet then hears any of its 25, so a person may speak Spanish in
  an English session.
- **The fetch is asked for in the pane, not on a sheet:** turning the switch
  on with no models shows the sizes on the row, and only "Fetch" turns Voice
  on and fetches. Removing the main models removes every set.
- **Voice is the pane after Privacy** in Settings' "You" group, so the four
  the design drew stay first. No agent can set its rows.
- **The chip shows on every screen's bar,** as the agent mark does.

### D41. H3 counts a function's lines as written, with a check of our own

- **Date:** 2026-11-11 (0.8, the `rules` branch).
- **Question:** H3 says no function over 80 lines, and Biome's
  `noExcessiveLinesPerFunction` held it. Biome counts the line breaks between
  a body's tokens: a break inside one token is not counted, and both the
  whitespace between JSX children and a template string are one token. A
  97-line component counted 51. The rule has three options (`maxLines`,
  `skipBlankLines`, `skipIifes`) and none changes that. By lines as written,
  92 functions were over 80 and passed.
- **Choice:** `scripts/function-lines.ts` counts a function from the line it
  starts on to the line its body ends on, everything between included, and
  `scripts/check-structure.ts` holds it on the `long-functions` list, which
  starts empty: all 92 were split, none listed. Biome's rule stays on, as an
  early warning in the editor; its per-file overrides in `biome.jsonc` are
  gone with the list entries they were written for.
- **Why:** the rule says lines, and a reader scrolls lines, not tokens. A
  count that differs by kind of code would keep long views and split short
  logic.
- **Cost:** two lines stricter than Biome on plain code (it left out the
  signature's line and the closing one). A nested function counts in its
  outer function's lines too, as in Biome.
- **Undo:** take `checkFunctions` out of `scripts/check-structure.ts`; the
  code stays shorter than the check.

### D42. H7's check counts a cast from `Record<string, unknown>`

- **Date:** 2026-11-11 (0.8, the `rules` branch).
- **Question:** D31 left one cast uncounted: from `Record<string, unknown>`,
  what `isRecord` and a parse give, because code also builds that type for
  itself (spawn options, a tool's arguments) and the check can't tell the two
  apart. Settings cast each section it read that way, 23 times. Can the check
  see it after all?
- **Choice:** yes, by not telling them apart. Once Settings read its sections
  by their shapes (every key of every section is a shape now; a section's
  type is inferred from them, and the store checks a value with the same
  shape before it writes it), four such casts were left in the whole
  codebase, and none needed to be one: an applet's arguments are copied key
  by key, a link's schema is read field by field, a simulation command has a
  shape checked against mirin's type, and the spawn options are written as
  the two calls they were. The check now counts every cast from a record of
  unknown to a type that claims more, whoever built the record.
- **Why:** a record of unknown says as little about its fields as `object`
  does, so a cast from it checks as little. Code that builds one for itself
  can build the type it means.
- **Cost:** code may no longer gather options into a `Record<string,
  unknown>` and cast at the end; it writes the typed object. A section's
  value is now what its shape parsed, not the file's own (a Desktop's name is
  tidied on read, as the shell already read it).
- **Undo:** take `isRecordOfUnknown` out of `isNarrowedCast` in
  `scripts/check-boundaries.ts`.

### D43. An agent's scroll is so many pixels, from a continuous source

- **Date:** 2026-11-11 (0.8, the `rules` branch).
- **Question:** the agents' `scroll` tool takes pixels, and dashi-comp played
  them as a mouse wheel: 15 px a notch, as libinput counts. A client makes
  its own distance of a notch (GPUI three lines, about 77 px), so 45 px moved
  a Metal window 234. What should an agent's scroll be on the wire?
- **Choice:** a continuous source's (`wl_pointer.axis_source` continuous,
  the value alone, no notches), the one kind of scroll besides a finger's
  whose value is a distance. mirin's GPUI fork multiplied every pixel scroll
  by 3; it now takes a continuous source's as it is and keeps the 3 for a
  finger, the speed a touchpad has. In the VM, 45 asked moved 45.1 points and
  100 moved 100.0.
- **Why:** only a pixel scroll can go as far as it is asked. A finger's
  would start the client's own coasting when it ends; a continuous one does
  not.
- **Cost:** button scrolling (a trackpoint) is a continuous source too, so
  in Metal windows it now moves 1:1, a third of what it did, as it does in
  GTK and Chromium. A client that reads only wheel notches would not scroll
  for an agent; none Dashi ships does.
- **Undo:** `scroll_frame` back to a wheel's frame in
  `crates/dashi-comp/src/session/agent_pointer.rs`, and `pixel_scroll_factor`
  back to 3 in mirin's `vendor/gpui`.

### D44. In Light, an ink button lightens under the pointer and while held

- **Date:** 2026-11-11. The `polish` agent's, reversible. It changes one
  line of D16 ("It deepens under the pointer").
- **Question:** in Light the primary button went from ink to black
  (`#1D1D1F`, `#0E0E10`, `#000000`): steps of 1.15 and 1.09 to 1, which
  nobody sees. UI-4 says every control shows hover and pressed.
- **Choice:** the ink button steps toward the page. In Light it lightens:
  `#1D1D1F`, `#3A3A3E` under the pointer, `#55555B` held (white words at
  16.8, 11.3 and 7.4 to 1, each step 1.49 and 1.53 to 1 from the one
  before). In Dark it was already so (the light ink dims toward black) and
  is unchanged. Ume and a chosen pill still deepen: they have room to.
- **Why:** there is nothing deeper than ink to go to. A step must be seen,
  and the words must stay AA; lighter is the only way to both. "Toward the
  page" is one rule for both modes.
- **Cost:** in Light "pressed is darker" no longer holds for this one
  button. A test holds each step to 1.2 to 1 or more.
- **Undo:** `primaryHover` and `primaryPressed` in `palette.ts`, and the
  test's 1.2.

### D45. Tab stops are every 4 widths of the font's 0, and Text Editor's View menu sets them

- **Date:** 2026-11-11. The `polish` agent's, reversible (mirin `1332472`,
  `d873e0e`; `apps/editor/lib/prefs.ts`).
- **Question:** a typed tab looked like a space. It was in fact a stop every
  four *spaces* of the font, which Linux's shaper set by itself: in a
  proportional font four spaces are about one em, so "name" and "city" ended
  on different stops and nothing lined up. What is a tab stop's width, and
  who sets it?
- **Choice:** mirin sets the stops itself, on every platform, every
  `tabSize` widths of the font's **0** (CSS's `ch`), 4 by default. In a
  fixed-pitch font that is exactly four spaces, as asked; in a proportional
  one it is about twice as far, wide enough for short words to share a stop.
  Text Editor has View › Tab Width: 2, 4, 8, kept with its other View
  settings; a note's body keeps 4.
- **Why:** "four spaces" only means a column in a fixed-pitch font. The 0 is
  what CSS and every editor count columns in, and it gives the same answer
  there.
- **Cost:** three more rows in Text Editor's View menu (it has no
  submenus). On a line that soft-wraps, the stops of its later rows are
  still counted from the paragraph's start. Words longer than a stop still
  need a second tab, as in any editor.
- **Undo:** `tab_interval` in mirin's `line_layout.rs` (count the space
  instead of the 0); `TAB_WIDTHS` and the rows in `apps/editor/lib/menus.ts`.

### D46. Where a wrong press in Settings costs something, only the person's press counts

- **Date:** 2026-11-11. The `polish` agent's, reversible
  (`settings-app/lib/person-only.ts`).
- **Question:** an agent that may click in windows can press what Settings
  shows. D26 closed that for "Let agents work alone". Settings › Voice was
  open (an agent could turn it on and start a 1 GB fetch), and so were
  others. Which presses are asked about?
- **Choice:** the ones that widen what agents may do, or that cost the
  person something they did not ask for. The pane asks the compositor whose
  press it was (`input-origin`), and an agent's changes nothing and the row
  says "Only you can change this. Press it yourself, here.":
  - Voice: turning it on, Fetch and Resume, Remove, the talk key, the voice.
  - Agents: adding a site agents may use, Undo of a revoke, turning on
    "Don't ask for these again".
  A press that only narrows is never asked about: turning Voice off, Pause,
  Revoke, removing a site.
- **Not changed, for the lead:** an app's or the system's sound devices
  (agents have a tool for it, with its own permission; a click costs
  little and is undone by one), a login's "Ask / Never" in Passwords, an
  API token's hosts, and every other row. The general answer would be the
  compositor refusing an agent's input to Settings' window, or a list of
  rows agents may press; this entry closes the plain cases only.
- **Why:** consent is the person's hands (D26, D38). Part A: narrow who may
  do something.
- **Cost:** one `input-origin` round trip for each such press. A press held
  longer than two seconds, or made while no compositor answers, is refused:
  the person presses again.
- **Undo:** drop `byPerson` from `PaneContext` (`boot/settings.ts`); each
  pane then changes at any press.

### D47. The Voice switch reads on only when Voice is on

- **Date:** 2026-11-11. The `polish` agent's, reversible.
- **Question:** the switch went green as soon as it was pressed, while the
  pane only offered the fetch, and stayed green with the models removed.
- **Choice:** on means asked for and usable. While it offers the fetch,
  fetches, or waits with the models gone, it reads off and its row says "It
  turns on once its models are here." A press then takes the ask back.
- **Why:** green means on and nothing else (CO-1).
- **Cost:** pressing the switch with no models shows no change in the
  switch itself; the Models row appearing under it is the answer.
- **Undo:** `on` in `VoicePane`.

### D48. A tap of the Copilot key talks; every other key is still held

- **Date:** 2026-11-11. The `polish` agent's, reversible. It replaces one
  line of D40 ("A Copilot key whose firmware releases it at once is a tap:
  the person picks another key").
- **Question:** many laptops send the Copilot key's press and release
  together, so holding it hears nothing. How does such a key talk, without
  changing what a held key does?
- **Choice:** the Copilot key (F23) has its own name among the held keys.
  A tap of it, under 300 ms, keeps the listen its press opened and asks the
  service to end it on a quiet of 1.5 s (`listen.quiet`, new); the next tap
  ends it sooner, Esc cancels it, and with nothing heard in 8 s it is given
  up on. Held, it is a hold. The right ❖ and the keys a person picks are
  only ever held: their tap still says "Hold … to talk."
- **Why:** nobody can tell from the key's events whether its firmware can
  hold it, but a tap is a tap on both kinds, so the rule needs no guess. A
  key that can be held keeps the surer way: the microphone is open exactly
  while the finger is down.
- **Cost:** after a tap the microphone stays open until the person stops
  talking; a tap by mistake is 8 s of open microphone, shown by the chip
  and the orange pill, and ended by Esc or a second tap. A pause longer
  than 1.5 s ends the ask.
- **Undo:** `TALK_TAP` in `voice/keys.ts` (name F23 `talk` again).

### D49. Dashi's first sound: what was cut, and the speaking model is not kept in memory

- **Date:** 2026-11-11. The `polish` agent's, reversible
  (`crates/dashi-voice/src/service/`, `voice/voice.ts`).
- **Question:** the first sound came long after the key came up. Where did
  the time go, and should the speaking model stay in memory while Voice is
  on, as the brief suggested?
- **Measured** in the VM, from the key coming up to sound at the speakers,
  with a stub agent that answers in 2 ms (`dashi-0.8.0-review/10-polish`):
  1.28 s in all. 0.19 s for the words, 0.73 s to make the first sentence
  (3.9 s of speech) whole, and 0.36 s more before anything was heard, which
  turned out to be the third of a second of hush the model starts every
  piece with. With the speaking model let go of (ten idle minutes), 0.76 s
  more to load it: 2.03 s.
- **Choice:** four cuts, none of which costs memory. A long first sentence
  is said in two pieces, cut at its first pause, so less is made before the
  first sound. The hush before the first sound is cut. The speakers open as
  the utterance starts, while the first piece is made. And the shell sends
  `warm` for the speaking model as the talk key goes down, so it loads
  while the person talks; each model has its own lock, so that never holds
  up the listening one. The model is **not** kept in memory: ten idle
  minutes still bring the service down to 33 MB.
- **After:** 0.63 s warm, 0.68 s with the models let go of; under a screen
  recording 0.82 s to 0.97 s, where it was 1.50 s to 1.61 s. The caption
  now starts with the sound, where it was a third of a second ahead.
- **Why:** 0.48 GB held for as long as Voice is on, to save a load that
  now happens behind the person's own words, is a poor trade on a laptop.
- **Cost:** a first sentence said in two pieces has a comma's pause where
  it was cut (the model's own hush there is cut to 150 ms), and two
  captions. An ask shorter than the model's load (under
  a second, after ten idle minutes) still waits for the rest of it.
- **Undo:** `text::pieces` back to `text::sentences` in `speak.rs`;
  `player.open()` back into `play`; the `warm` in `Voice.keyDown`.

### D50. A logout stops the session's units itself, before it ends the login

- **Date:** 2026-11-11. The `smoke` agent's, reversible
  (`shared/session-power/session.ts`, `session/dashi-session.target`,
  `session/lib/target.ts`, `session/lib/portal-files.ts`).
- **Question:** after Log Out from the installed packages, Voice (1.9 GB
  with its models), the portal backend and sometimes an applet ran on at the
  login screen, and the backend's window host panicked every second and a
  half for want of a compositor (251 times in the smoke run's journal). The
  supervisor stops the session's target as it ends; why was that not enough,
  and where should the stop be?
- **Found:** `loginctl terminate-session` kills everything in the login at
  once. The supervisor logged "session ending" and was gone before the shell
  had stopped, so its stop never ran; a stop started at that moment
  (`stopSessionTargetNow`, tried first) lost the same race. And stopping
  `dashi-session.target` left `graphical-session.target` up, so
  xdg-desktop-portal started the backend again.
- **Choice:** the shell has systemd stop the session's units (the target and
  the portal backend, `SESSION_UNITS`) and waits for it, 3 s at most, before
  it asks logind to end the login. The target carries
  `PropagatesStopTo=graphical-session.target`. The supervisor still asks
  first thing as it ends, for the ends that are not a logout (the login
  manager restarted, the compositor gone). An installed session removes the
  target a checkout's session linked into the person's units, as it already
  removed that checkout's portal files: the link wins over the package's.
- **Why:** only what runs before the login ends is sure to run. The other
  way, a unit of the person's that watches the login, is more machinery for
  the same result.
- **Cost:** a logout takes as long as the units take to stop (tens of
  milliseconds in the VM). Restart and Shut Down are unchanged: the machine
  goes down with them.
- **Undo:** `endLogin` back to one `loginctl terminate-session`; drop the
  `PropagatesStopTo` line.

### D51. Dashi 0.9 builds on mirin's `main`

- **Date:** 2026-11-13 (`.mirin-branch`). The owner's call; it replaces D14.
- **Question:** 0.7 and 0.8 were each built on a mirin branch of their own
  (`wave4-0.7`, `wave5-0.8`), because `main` carried a slowdown (D14). The
  performance work D14 waited for has landed there (mirin #24, 191 commits):
  the host keeps the tree and takes patches, keeps the drawings of what did
  not change, and GPUI, taffy, blade-graphics and AccessKit's Unix adapter
  are forks inside mirin (`forks/`). Stay on a release's own branch, or
  build on `main`?
- **Choice:** `main`. `.mirin-branch` says so, and CI takes it unless mirin
  has a branch named like Dashi's. A fix Dashi needs in mirin goes to `main`
  by pull request; until it lands, the checkout's `../mirin` is on the branch
  that has it (`dashi-0.9` for the release), and the packages are built from
  that checkout's HEAD, as always (`vendor/MIRIN_COMMIT` names it).
- **Why:** the slowdown is gone, and `main` is faster where it was measured
  in the VM against 0.8 (the 0.9 review, `03-mirin-main`): a menu 121 → 82
  ms, a notification's banner 670 → 411, an app's start 426 → 339, a click
  among 5,000 rows 638 → 339, Select All of 5,000 22 s → 11 s. A long text
  gained nothing (a key in 6,000 lines 115 → 111 ms), and Files holds 5.3 GB
  with 5,000 items selected, where it held 2.3. And one mirin for every Dashi
  branch ends the merges from branch to branch.
- **Found on the way:** nothing in Dashi's code had to change: it installs,
  type-checks and passes its tests on `main` as it was; one check's number
  moved (D52). One bug in mirin: a
  host kept warm (every sheet, menu and popover of Dashi's) said which patch
  protocol it takes before anything listened, so its first tree waited
  250 ms and it was never patched. Fixed in mirin (`dashi-0.9`, ff6d252),
  with a test.
- **Cost:** `main` moves under Dashi: a change there can break a build that
  was green. CI runs on every push and says so.
- **Undo:** write a branch's name in `.mirin-branch`, `git switch` the
  sibling checkout to it, `bun install`, and rebuild the Metal host.

### D52. H16's ceiling is 27 library modules at start, for mirin `main`

- **Date:** 2026-11-13 (`scripts/lists/boot-weight.txt`). The `mirin-main`
  agent's; the owner may want it another way.
- **Question:** on mirin's `main` the shell loads 27 library modules at
  start, over H16's ceiling of 25. The ten of React, its reconciler and the
  scheduler are as before; `@mirinjs/metal` went from 11 to 17, because the
  patch protocol split its serializer (`tree-sync`, `view-props`,
  `commit-log`, `order`) and added the handshake and the collection at rest.
  Nothing in Dashi can load fewer: they are the renderer.
- **Choice:** the ceiling is 27, what `main` loads, with no room above it.
  The AI SDKs stay banned, and the check is otherwise as it was.
- **Why:** H16 guards the start from heavy libraries, and none came in: the
  same code in more files, as D2 found for Dashi's own. A ceiling that
  cannot be met is not a rule.
- **Cost:** the next file mirin splits in its renderer fails this check
  again, and someone raises the number again. Not counting mirin (it is
  written to the same file limit as Dashi) would end that, and stop watching
  what mirin loads at start: left for the owner.
- **Undo:** `25` in `scripts/lists/boot-weight.txt` (it fails until mirin
  loads fewer).

### D53. The night build's four pieces meet at one hub in the shell

- **Date:** 2026-11-13. The `n0-foundation` agent's.
- **Question:** core, the capsule, the bar and the persona are built in one
  night by four people who cannot talk. Where do they meet, and who turns
  0.8's voice loop into what the capsule draws?
- **Choice:** one hub in the shell (`shared/pill`, `late.peek("pill")`):
  cells with one owner each, ports with one handler each, and no piece
  imports another (`docs/night-0.9-contract.md`). The Rust wire (keys,
  typing) is core's own on both ends, so it is not part of the contract. The
  capsule piece, not core, adapts 0.8's voice chip and Ask tasks into voice
  mode and the asks. A tap of the Dashi key opens the launcher, never the
  bar's field. `shared/pill` is listed for the two entry points that load it
  at start (`scripts/lists/entry-weight.tsv`): types and a hub of 100 lines.
- **Why:** each piece can be built and tested against a fake of the others
  tonight, and core (Rust, dictation, typing) carries the most already.
- **Cost:** a second way for shell parts to talk beside `Late` and the
  stores; voice mode is an adapter over a chip that will go.
- **Undo:** fold the cells into the modules that own them once the pieces
  are merged, and delete `shared/pill/hub.ts`.

### D54. ❖Space and the dictation key are keys the compositor hears, not keymap rules

- **Date:** 2026-11-13. The night build's `core` agent's.
- **Question:** ❖Space opened the launcher on press, a keymap rule. Held, it
  must talk to Dashi, and a tap must still open the launcher; the right ⌥
  must dictate when held alone and stay AltGr and ⌥ otherwise.
- **Choice:** `held-keys` gains `super` (taken only under ❖ alone, comes up
  when it or ❖ does), `alone` (heard, still the app's modifier, `chord` the
  moment another key goes down) and `tapMs` (the compositor says whether it
  was a tap and arms `afterTap` then). The shell works out hold, tap and
  double tap. While Voice is off none is listed and ❖Space is the keymap's
  rule as in 0.8. The default talk key is ❖Space and the Copilot key: the
  right ❖ is free again unless the person picked a key in 0.8. Esc is no
  longer held while Dashi speaks. Caps Lock as the dictation key is taken
  (it would turn capitals on); the right ⌥ and the right ⌃ are heard alone.
- **Why:** no policy in Rust, and nothing changes for people who only tap or
  who never turned Voice on.
- **Cost:** with Voice on the launcher opens as ❖Space comes up, not as it
  goes down (about 80 ms later for a quick tap). An app sees the right ⌥ go
  down and up when it is held to dictate; one that opens its menu bar on a
  bare Alt will.
- **Undo:** drop the `dashi` entry in `dictation/keys.ts` `pillHeldKeys`,
  and put `KEY_RIGHTMETA` back in `voice/keys.ts`.

### D55. Dictated words are typed through a keymap made for them

- **Date:** 2026-11-13. The night build's `core` agent's.
- **Question:** how do words reach the field as one step, with ñ and é on
  any layout, without the clipboard and without ever sending BackSpace?
- **Choice:** `type-text`: the compositor gives the keyboard a keymap with
  one key for each character of the text, presses the keys, and puts the
  layout back, in one turn of its loop (as `wtype` does from outside). X11
  windows are refused (`x11`: Xwayland applies a keymap too slowly to trust)
  and get a paste, with the clipboard put back and the line saying
  "Pasted." The compositor's `text-focus` was not built: smithay 0.7 keeps
  a text-input's content purpose to itself, so the password check is
  AT-SPI's, only where accessibility is already on.
- **Why:** it is the only way to type any character with no input method in
  the way, and the app sees ordinary keys, so its own undo takes them back.
- **Cost:** the app sees two keymap changes for each landing. A password
  field in an app with no accessibility tree is not known: the microphone
  opens there.
- **Undo:** `dictation/lib/land.ts` `type` can call `paste` alone.

### D56. Tidying is careful rather than clever, and checks itself

- **Date:** 2026-11-13. The night build's `core` agent's.
- **Question:** which words may a rule take out or change with no model to
  understand them?
- **Choice:** only what can be nothing else. A filler word that is also a
  word ("este", "o sea") goes only between two commas. "period", "punto",
  "coma", "new line" stay words after an article or where no sentence ends.
  A change of mind counts only when the phrase stands apart, and does one of
  four simple things (docs/voice.md). A check of its own reads every result:
  no word that was not said, no other order, no number or "not" lost
  outside what the person took back, and there the two sides must say "not"
  as often. When it trips the words land as heard.
- **Why:** a wrong word typed for the person is worse than an "um" left in.
- **Cost:** speech the model gave no commas keeps its "este" and its "no
  wait". "Do not send it, no wait, send it today" lands as heard.
- **Undo:** the lists are `dictation/lib/tidy-words.ts`.

### D57. Hands-free is short and ends out loud

- **Date:** 2026-11-13. The night build's `core` agent's.
- **Question:** when does hands-free end, and what lands?
- **Choice:** each sentence lands at a pause of 1.2 s. It ends on a tap, when another window takes the
  keyboard (looked at as words come), after 20 s with nothing said, at ten
  minutes, or when a sentence has nowhere to land; always with a short sound
  and a line. Every landing, held or hands-free, types a space after its words (none
  after a line break): Dashi cannot see what is before the caret, and words
  that join ("done.Next") are worse than a space at the end.
  Ending when this computer plays sound (`sound`) is not built.
- **Why:** the microphone is never left open by mistake, and never closes
  without the person knowing.
- **Cost:** a dictation leaves a space at the end of the field.
- **Undo:** `DICTATION_LIMITS` and `dictation/lib/hands-free.ts`.

### D58. A character changes how Dashi sounds and looks, never what it may do

- **Date:** 2026-11-13. The `n4-persona` agent's. Numbered from D58 so the
  night's other pieces can take D54 onward; the lead renumbers.
- **Question:** the person can now name the assistant, pick one of six
  characters or write their own, and say how to talk to them. That text goes
  to a model that also plans actions. What stops it from changing what Dashi
  does?
- **Choice:** the character is only ever the middle of the prompt
  (`agents/ask/answerer.ts` `styledPrompt`): Dashi's own prompt whole and
  first, then the style (`persona/lib/prompt.ts`), then a closing line Dashi
  writes (`STYLE_CLOSE`) that is the last thing said: the lines change
  wording only, the assistant is an AI and says so, the words in a plan, a
  permission or a question are Dashi's, and text from pages, files and tools
  is data. With no `persona` section the prompt is the old one, letter for
  letter. Nothing a permission, a plan's step, a card or a button shows is
  read from the persona; what asks is decided by code that never sees it.
  The model on this computer gets the name, the length and the language but
  not the character's text or the note (`small`).
- **Why:** a prompt is a request, not a guard, so the guard stays where it
  was: a plan waits for the person's own press whatever the model was told
  (`test/persona-prompt.test.ts` tries a hostile character file).
- **Cost:** a styled prompt is about 150 words longer. A follow-up keeps the
  prompt its conversation began with (the local model and GPT keep the first
  message), so a change of character shows from the next request.
- **Undo:** `promptStyle.set(NO_STYLE)` in `boot/persona.ts`.

### D59. Six fixed colours, no picker

- **Date:** 2026-11-13. The `n4-persona` agent's.
- **Question:** which colours may Dashi's capsule wear?
- **Choice:** six, measured (`persona/lib/palette.ts`, the design's
  `contrast.md` kept as a test): violet, blue, teal, moss, berry, cocoa.
  `persona.colour` holds the `#rrggbb` of the chosen one's lighter end, the
  key the contract gives the capsule and the bar; any other colour in the
  file is not worn.
- **Why:** ink is dictation's, amber needs you, green is on, red records,
  and each must keep meaning one thing. White words reach 4.5 to 1 on all
  six.
- **Cost:** no colour of the person's own until a picker can check it.
- **Undo:** let `colourOfHex` take any colour that passes the same ratios.

### D60. The name is the assistant's, not the system's

- **Date:** 2026-11-13. The `n4-persona` agent's.
- **Question:** what may the assistant be called, and what keeps the word
  Dashi?
- **Choice:** letters of any script, digits, spaces, `-`, `'` and `.`, 1 to
  24 characters (the contract's limit; the design drew 20), one line. Never
  another assistant's name (Claude, ChatGPT, GPT, Codex, Gemini, Copilot,
  Siri, Alexa, Cortana, Grok, Bixby): the field says "That is another
  assistant's name." The system, its key, System Settings and the pane's
  title ("Your Dashi") keep the word Dashi; a card may say "Miso asks".
- **Why:** Dashi never passes for another product or a person, and help
  written for "the Dashi key" stays true whatever the assistant is called.
- **Cost:** a person who wants to call it Claude cannot.
- **Undo:** empty `TAKEN` in `persona/lib/name.ts`.

### D61. A character of your own is a small file of text and ids

- **Date:** 2026-11-13. The `n4-persona` agent's.
- **Question:** how does a person make and share a character?
- **Choice:** one JSON file in `~/.config/dashi/characters/`, named after
  its id, 8 KB at most: a name, a line about it, the prompt text in English,
  Spanish or both (600 characters each), and ids for the talk, colour, mark
  and voices. No image, hex colour, SVG, voice file or code travels in one.
  "Make a File" writes a copy of the chosen character and opens it in Text
  Editor; the folder is watched, so a saved change shows at once. The pane
  shows in full what a person's own character tells the assistant, and why a
  file was refused. The person's own file is theirs to write (the lead's
  call); "Add a File…" with its reading sheet is not built: a file is added
  by putting it in the folder ("Show Folder").
- **Why:** text can be read before it is trusted and ids cannot carry
  anything; D58 makes the text harmless to what Dashi may do.
- **Cost:** a shared file is not shown before it is in the folder, only
  after it is chosen.
- **Undo:** delete the folder; `persona.character` falls back to Dashi.

### D62. Only the person changes who Dashi is

- **Date:** 2026-11-13. The `n4-persona` agent's.
- **Question:** may an agent rename the assistant, change its character or
  write a character file?
- **Choice:** no. No row of Your Dashi has an agent's name, so
  `get_settings` and `set_setting` know none of them; each change in the
  pane first asks the compositor whose press it was, as the Voice rows do;
  and an agent's sandbox has `~/.config/dashi` (settings.json and the
  characters folder) read-only, or not at all in plan mode and tasks. The
  shell now makes that folder at start, because the sandbox binds it
  read-only only if it exists. The files tools already refuse it
  (`test/persona-agents.test.ts`).
- **Why:** who speaks to the person is the person's to say; an agent that
  could set the prompt's style could try to talk its way past D58.
- **Cost:** "call yourself Miso" said to the assistant does nothing; it is
  done in Settings.
- **What is not closed:** an agent the person lets click and type in
  windows can still drive Terminal or Text Editor as the person, and so
  write any file the person can, this folder included. That is the reach of
  "manage windows" itself, as before tonight, and D58 holds even then.
- **Undo:** give the rows `agent` names in `registry/lib/persona.ts`.

### D63. Where the persona's design and the night's contract disagree, the contract wins

- **Date:** 2026-11-13. The `n4-persona` agent's.
- **Question:** the design (`dashi-0.9.0-design/persona/spec.md`) and the
  contract the capsule and the bar are built against name different keys.
- **Choice:** the contract's, since two other pieces read them tonight:
  `persona.colour` is a `#rrggbb` (one of D59's six), `persona.mark` is
  `spark` or `dots` (the design's eight marks and four dot shapes are not
  built), `persona.talk` is `less`, `normal`, `more` (shown as Brief,
  Normal, Chatty), a character's id has no `file:` prefix (a file's id is
  never a preset's), and the name may be 24 characters. Added keys, the
  persona piece's own: `persona.you`, `persona.language`, `persona.note`.
  The pane's glyph is a speech bubble, since the spark is Agents' and every
  pane has its own. "Hear it" plays the voice's sample, not the preview's
  line. Following the code where the design assumed otherwise: the answer's
  voice is one id (`voice.voice`, which choosing a character sets when that
  voice is installed), not one per language; and the spoken length
  (`persona/lib/prompt.ts` `spokenContext`) is ready but not wired, because
  `voice/asker.ts` is core's tonight: it is one line there.
- **Why:** three pieces built at once must read the same keys.
- **Cost:** the look is narrower than drawn: six colours and two marks.
- **Undo:** widen `shared/pill/persona.ts` and the capsule together.

### D64. The capsule is one resident surface across the bottom edge, with no window while nothing shows

- **Date:** 2026-11-13. The `n2-capsule` agent's (the night build).
- **Question:** the dots must be there as the key goes down, on any screen,
  beside the Dock or above it, and never take the pointer from the window
  under them. A new Metal host takes seconds; a layer surface's screen,
  place and keyboard are fixed when it opens.
- **Choice:** one Metal host kept for the session with no window
  (`capsule/lib/surface.ts`, as the launcher's is). When something shows it
  opens a layer surface (`dashi.capsule`, overlay) as wide as the screen and
  340 tall along the bottom edge, see-through, taking the pointer only on
  what is drawn (`input-region`); when nothing shows it is hidden, so there
  is no surface over a game or a film. A change of screen, or the card
  taking the keyboard, hides it and opens it again.
- **Why:** the seat is then only layout inside one surface (home, beside the
  Dock, a step up), with nothing new asked of the compositor tonight.
- **Cost:** one more host process for the session; a blink when a card takes
  the keyboard; the capsule moves without a transition.
- **Undo:** `capsule/lib/surface.ts` is the only file that knows; a
  compositor-placed surface can replace it behind `show` and `hide`.

### D65. A spoken plan asks in the card; a typed plan keeps the launcher; a question is typed in the sheet (the typed plan: superseded by D261)

- **Date:** 2026-11-13. The `n2-capsule` agent's.
- **Question:** which of 0.8's asks go to the card tonight, and what is a yes?
- **Choice:** a launcher Ask task that waits for a yes is an ask on the hub.
  A spoken one opens its card by itself and the launcher stays shut
  (`boot/voice.ts` sends `open-ask` and opens the launcher only when nobody
  handles it); a typed one keeps the launcher's plan and opens a card only
  when the bar asks. An agent's `ask_person` opens in the card when the
  person can answer by voice; "Type it", or no voice, is 0.8's sheet, which
  has the field: nothing is typed into the card. Other consent sheets (an
  MCP agent's scopes, sign-in, a site) stay sheets. A yes is the person's
  press on `dashi.capsule` (`input-origin`), Return as the first key after a
  tap of the Dashi key gave the card the keyboard, or "yes" said as the
  whole of what was heard while the card listens (for 2 s it counts as the
  press: `Capsule.personAnswered`, which `boot/agents.ts` asks beside the
  launcher's). While a spoken plan's card is up the voice loop's one
  question slot is the card's, so the plan is said by the capsule piece
  ("I would …. Say yes, or press Yes.") and not by 0.8's "Press Return in
  the launcher".
- **Why:** the card must not be a second place that types, and the voice
  loop already keeps the talk key for the person alone.
- **Cost:** a voice in the room that says "yes" while the person holds the
  key counts, as the design accepts. One ask at a time has the voice.
- **Undo:** drop the `runningCapsule` lines in `boot/agents.ts`,
  `boot/voice.ts` and `agent-sheets/agent-sheets.tsx`: everything asks where
  it did in 0.8.

### D66. Where the capsule sits when the design does not say

- **Date:** 2026-11-13. The `n2-capsule` agent's.
- **Question:** the design names the seats; the code needs their edges.
- **Choice:** a window "fills down to the Dock" when the capsule at home
  would lie on it: the window comes down past the capsule's top by 4 or
  more (a tiled window's gap included) and lies under the middle of the
  screen (175 either side of the centre). The side is the focused window's
  centre; a window across both sides, the right. A seat beside the Dock
  needs 200 of room, else one step up (62). With no Dock on screen: 11 from
  the edge, or 74 over a window. The screen is the focused window's, else
  the pointer's, else the primary; a card is on the Dock's screen. The place
  is asked when the capsule appears and when its state changes kind, not at
  every word. With the taskbar there is no rim: the Dock's amber rim is the
  floating Dock's only.
- **Why:** each can be said in a line and tested (`test/capsule-place.test.ts`).
- **Cost:** a window that moves while the capsule is up does not move it
  until its next state.
- **Undo:** the numbers are `SEAT` in `capsule/lib/measures.ts`.

### D67. Dashi's capsule is one flat fill, and a persona's colour is darkened to carry white words

- **Date:** 2026-11-13. The `n2-capsule` agent's.
- **Question:** the design's capsule is a gradient with a glow; a persona may
  pick any colour, yellow included.
- **Choice:** one flat fill: `#4A33B0` for the agents' purple (the middle of
  the design's gradient, 8.5:1 under white), and for any other colour the
  colour itself darkened in steps of a tenth until white words give 7:1
  (`dashiFill`). No gradient, no coloured glow: the design lists both as cut.
  Dictation's capsule stays ink with five dots whatever the persona.
- **Why:** the words must read on any colour a person picks.
- **Cost:** a light colour shows darker in the capsule than in Settings.
- **Undo:** `dashiFill` and `dashiColours` in `capsule/lib/measures.ts`.

### D68. The bar's field is a surface of its own, laid over the bar's row (superseded by D261: the field is gone)

- **Date:** 2026-11-13. The `bar` agent's (night build).
- **Question:** a click on Dashi's mark turns the menu bar's row into a
  field. The bar's own surface never holds the keyboard (a layer that did
  would take it from every window). Where does the caret live?
- **Choice:** a second surface (`dashi.barfield`, the overlay layer, the
  keyboard exclusive), opened only while the field is, whose top 28 points
  sit exactly on the bar and draw the whole row (logo, Dashi's capsule, the
  field, the keys, the signs and the clock). Under the row it is clear, and
  a click there closes the field, as a click closes a menu. It is the way
  the bar's menus already take the keyboard (`menus/lib/popover.tsx`).
- **Why:** one row, always: nothing grows or moves. No compositor change
  tonight, and Esc, Return, the caret and a paste work as in any field.
- **Cost:** the click that closes the field does not also reach the window
  under it, and the windows show inactive while it is open, as under a
  menu. The field's row is drawn twice in code (the bar, and the field's
  row), kept alike by sharing the status slots.
- **Undo:** give the bar's surface the keyboard on demand in the
  compositor, draw the field in `menubar.tsx`, and delete
  `menubar/lib/field-row.tsx` and the surface in `menubar/start-pill.tsx`.

### D69. A job in the bar opens 0.8's panel; the jobs give way before a status item does (superseded by D261: no job capsules)

- **Date:** 2026-11-13. The `bar` agent's (night build).
- **Question:** the design turns the row into the job on a click (b-10,
  b-17) and fills a job's ring as it goes. 0.8 has the agents' panel, and
  knows no job's progress. When the bar is short, who gives way?
- **Choice:** a click on a capsule opens the agents' panel on that job; a
  launcher Ask task has a card there now (steps, Stop, the result, Undo,
  and Answer for a plan that waits). The ring turns while a job works; it
  does not fill. The square that stops a job shows on a speaking task's
  disc only; agents are stopped from the panel. The jobs take the room the
  other status items leave: the name goes first, then discs become "+N",
  and no extra goes into "…" for a job. With no model chosen the field
  offers one way on, System Settings › Agents, not the design's three.
- **Why:** the panel exists, is tested and asks nothing new of the keys.
  A ring that filled would be a guess. Status items a person put in the
  bar outrank the words of a job that is still a click away.
- **Cost:** b-10, b-17 and b-19's rows are not built: a result is read in
  the panel, two clicks from a fresh look instead of one line in the row.
  A draft longer than the row is not read whole in a card before it is
  sent (b-05, b-06): the field scrolls. Choosing Claude Code or Codex from
  the field (b-04) is not built.
- **Undo:** draw the job in `menubar/lib/field-row.tsx` (the row is
  already a surface with the keyboard) and send the capsule's click there
  instead of to `toggleAgents` (`menubar/lib/menubar-pill-slots.tsx`).

### D70. Until the card exists, a plan that waits is answered in the launcher (superseded by D261)

- **Date:** 2026-11-13. The `bar` agent's (night build).
- **Question:** a task typed in the bar becomes a plan that waits for a
  yes. The card that asks is the capsule piece's, built at the same time.
  What does a click on the amber capsule do without it, and how does the
  bar know the capsule now shows what the voice chip showed?
- **Choice:** the bar sends `open-ask` for the ask the capsule piece
  lists (`hub.asks`); with no such ask, or nobody handling the port, it
  opens the launcher, where 0.8 keeps the plan and its Return. The mark
  counts the asks, or the jobs that need the person when there are more of
  those. The voice chip stops drawing once `hub.voiceCommands` has a
  handler, found by sending `open-ask` for no ask (it changes nothing).
- **Why:** the bar works alone tonight and with the capsule tomorrow,
  with no switch to flip at the merge.
- **Cost:** an empty `open-ask` reaches the port's listeners now and then;
  the port has no "is anyone there" of its own.
- **Undo:** give `Port` a `handled()` in `shared/pill/hub.ts` and ask that;
  drop the launcher fallback in `boot/lib/bar-sources.ts` once the card is
  always there.

### D71. The card's keys are heard on a second surface

- **Date:** 2026-11-14. The `join` agent's (night build).
- **Question:** a layer surface's keyboard is fixed when it opens, so
  giving the card the keyboard hid the capsule's surface and opened it
  again: the card blinked away for about a second, and a Return pressed
  meanwhile was lost.
- **Choice:** the capsule's surface never takes the keyboard. A tap of the
  Dashi key opens a second layer surface (`dashi.capsule.keys`,
  `capsule/lib/card-keys.tsx`) that draws nothing, takes no pointer and
  has the keyboard; the card stays put. A yes by Return counts when
  `input-origin` on that layer says the person pressed.
- **Why:** the card must not move under a hand that is about to answer it.
- **Cost:** a second resident Metal host for the session.
- **Undo:** when mirin can change a live layer surface's keyboard, drop
  the second surface and set it on the first.

### D72. A tap of the Dashi key is the card's only while a card is on screen

- **Date:** 2026-11-14. The `join` agent's (night build).
- **Question:** the compositor sends every plain key the launcher's way
  the moment the Dashi key is tapped (type-ahead). With an ask waiting no
  launcher opened, so Return never reached the card and typing stayed
  dead; and an ask that was not on screen (a typed plan in the bar) took
  the tap for nothing.
- **Choice:** boot asks the capsule whether a card is on screen
  (`cardUp`). If so the tap is the card's, and the plain keys go back once
  the card has the keyboard (no window has it), or after two seconds; a
  key pressed in between is dropped, never typed into the window in
  front. Otherwise the tap opens the launcher, whatever asks wait.
- **Why:** "a tap means one thing", and a Return meant for a card must
  not land in a document.
- **Cost:** a Return pressed within a few hundredths of a second of the
  tap can be dropped; it is pressed again.
- **Undo:** have the compositor report when a layer takes the keyboard,
  and play the keys typed ahead into the card.

### D73. A spoken plan is said once, by its card

- **Date:** 2026-11-14. The `join` agent's (night build).
- **Question:** 0.8's voice loop said "Press Return in the launcher to run
  it" for an instant before the card took the turn and read the plan.
- **Choice:** when the capsule handles `voiceCommands`, the asker answers
  the voice loop with nothing to say (`voice/asker.ts`); the card says the
  plan and hears the yes. With no capsule, 0.8's words and the launcher.
  A spoken yes counts for the task whose card heard it, once.
- **Why:** one voice, and no instruction that is no longer true.
- **Undo:** `showPlan` returning false brings 0.8's sentence back.

### D74. A notice takes the step up, and a finished job's tick leaves by itself

- **Date:** 2026-11-14. The `join` agent's (night build).
- **Question:** a notice was cut hard in the narrow seat beside the Dock;
  finished jobs' ticks piled up in the bar until each panel was opened.
- **Choice:** while the capsule shows a notice it sits one step up,
  centred, at full width, never beside the Dock (`capsule/lib/place.ts`,
  `whole`). A finished job nobody opened leaves the bar a minute after it
  finished (`menubar/jobs.ts`, `FIN_LEAVES_MS`); it stays in the
  launcher's history.
- **Why:** a line of trouble must be read whole; a row of ticks says nothing.
- **Cost:** the notice lies over the window's last lines for four seconds.
- **Undo:** drop `whole` in `placeOf`; set `FIN_LEAVES_MS` to infinity.

## How to add a decision

Add one entry at the end of Part B, in the commit that makes the change: its
number, the date, the question, the choice, why, what it cost, and how to undo
it. If it teaches a new way to decide, add a line to Part A naming it. Plain,
short words, as the rulebook is written.

### D75. The five dots are Dashi's face: eight marks, six shapes, ids only

- **Date:** 2026-11-14. The `n6-face` agent's.
- **Question:** the design names eight marks and four shapes of the dots; the
  first slice built two marks (`spark`, `dots`) and no shape. The brief asks
  for a shape for each of the six characters.
- **Choice:** `persona.mark` takes the design's eight glyphs, and still `dots`
  (the first slice's "no disc", so a file that has it keeps working; the pane
  no longer offers it). `persona.dots` takes six shapes: the design's four
  (`line`, `smile`, `wave`, `pearls`, its 6 px dot being 4 points) and two of
  ours, `steps` (Nori) and `hop` (Yuzu), so no two characters share a face.
  The capsule draws the disc and then the dots in every phase of Dashi's line,
  as the design's line-up does; beside the Dock, next to buttons, the disc
  stands alone. The glyphs and shapes are data in `shared/pill/look.ts`,
  because the capsule, the bar and Settings all draw them; the hub's
  `Persona` gained `dots` and `motion`. The spark stays the glyph the shell
  already drew, so a Dashi nobody changed looks as it did. A character's file
  names a mark, a shape and a way of moving by id; anything else in those
  fields is Dashi's (D61 holds: text and ids only).
- **Why:** a face is the cheapest thing that makes six characters six.
- **Cost:** Dashi's capsule is 44 points wider wherever it has the room. The
  bar's mark still draws the spark: `markSvg(persona.mark)` is there for it.
- **Undo:** `FaceLead` in `capsule/lib/face.tsx` back to the disc alone;
  `PERSONA_DOTS` and `DOT_SHAPES` in `shared/pill/`.

### D76. Each character moves the dots its own way, on one timer, and not at all when asked

- **Date:** 2026-11-14. The `n6-face` agent's.
- **Question:** the design put "the dots come alive" in the second slice,
  waiting on mirin width and offset transitions.
- **Choice:** no transitions: `shared/face/motion.ts` is arithmetic from a
  moment to five offsets and sizes, and `FaceDots` draws it anew on one
  `setInterval` (80 ms at rest, 50 or 100 ms thinking, 33 ms speaking). Dashi
  breathes; Miso's smile deepens; Kombu barely moves and only its middle pearl
  answers a word; Wasabi does not breathe and turns its wave over; Nori steps
  along the row; Yuzu bounces. All blink once when they have heard you, jump
  on each spoken word, and rise when the pointer is on them (mirin tells a
  surface that it is hovered, not where the pointer is, so "toward the
  pointer" is "up"). No timer runs while the capsule is hidden (the dots are
  unmounted), while listening (the level's own changes draw them, as bars,
  exactly as dictation's), with Reduce Motion, or while Dashi drops the act
  (D77): those draw the still shape.
- **Why:** it costs five small views redrawn, and only while Dashi is on
  screen doing something.
- **Cost:** a React commit of five views per tick: at most 30 a second while
  it speaks, 12 at rest. Not measured in the VM yet.
- **Undo:** give every character `still` in `persona/lib/characters.ts`.

### D77. Dashi drops the act when a character is out of place

- **Date:** 2026-11-14. The `n6-face` agent's.
- **Question:** a playful character over a shared screen, a film, or right
  after something broke.
- **Choice:** one rule, `dropsAct` in `persona/lib/act.ts`: while another
  program captures the screen, while the screen is recorded (by the person or
  an agent), while any window is full screen, and from a failed ask until a
  later one is done, Dashi is plain: its own character's words, Brief, and
  the dots keep their shape and do not move. The name, colour, mark, dots,
  voice and language stay. The pane still shows what was chosen. With nothing
  chosen only the dots hold still. "During a call" is in the rule
  (`Circumstances.call`) but nothing sets it: the shell cannot tell a call
  from any other use of the microphone tonight.
- **Why:** the person chose a character for themselves, not for the meeting.
- **Cost:** recording Dashi with Dashi's own recorder shows it plain, so the
  dots' motion cannot be filmed that way. Full screen on any Space counts,
  not only the one in front.
- **Undo:** `followCircumstances` in `boot/persona.ts` (one line in
  `main.tsx`) tells the persona; without it Dashi is always as chosen.

### D78. A character is shared as one file: read in full before it is added, written from what was checked

- **Date:** 2026-11-14. The `n6-face` agent's.
- **Question:** how a character goes from one person to another, and what a
  file somebody sent may bring with it.
- **Choice:** "Add a File…" opens the desktop's file chooser, checks the file
  (D61's rules; over 8 KB it is not read), and hangs a sheet from the window
  with its name, who it is, and all of what the assistant would be told, in
  both languages. Only "Add" copies it, and what is written into the folder
  is the checked character written out again, never the sender's bytes, so
  an unknown key cannot ride along. A file whose id is already there is
  refused, not replaced. "Export…" writes this Dashi through the desktop's
  save dialog: the character's text with the name, colour, mark, dots and
  talk as they are now. What it calls the person and their own note are not
  exported. An exported preset takes a new id (`miso-2`): a file may not
  take a preset's.
- **Why:** the text is somebody else's words until the person has read it.
- **Cost:** a long text makes a tall sheet (the confirm sheet does not
  scroll). No link or QR yet.
- **Undo:** `Share` in `settings-app/lib/panes/persona-share.tsx`; the folder
  and "Make a File" work without it.

### D79. The preview says its line when you choose a character

- **Date:** 2026-11-14. The `n6-face` agent's.
- **Question:** the brief left room for one more idea, cheap and delightful.
  The design's fifth, "meet them at first start, by ear", is days of work.
- **Choice:** its smallest part, in Settings: when a character (or its dots)
  is chosen, and at each "Hear it", the preview's dots jump to the words of
  its line, the character's own way, for at most 14 words at 230 ms each,
  then rest. You see how Kombu and Yuzu differ in the moment you pick one.
  Never when the pane opens, never with Reduce Motion.
- **Why:** choosing is when a person wants to see who they are getting.
- **Cost:** one timer for about three seconds after a choice. The jumps do
  not follow the voice's real words; they keep their own time.
- **Undo:** `useSaying` in `settings-app/lib/panes/persona-parts.tsx`.


### D80. The bar wears the mark the person chose, on every capsule that is Dashi's colour

- **Date:** 2026-11-14. The `n7-smoke` agent's.
- **Question:** the bar's mark, the field's lead and the jobs drew the spark
  whatever mark was chosen in Settings › Your Dashi. A job with no harness of
  its own (a launcher task, an agent on another machine) already took
  Dashi's colour: does it take the mark too?
- **Choice:** yes. The mark, the field's lead, and every job that is drawn
  in Dashi's colour draw `markSvg(persona.mark)`; Claude Code, Codex and
  OpenCode keep their own glyphs. The ticks, the square and the amber "?"
  are unchanged.
- **Why:** one colour with two glyphs reads as two things. The colour was
  already the persona's there, so the glyph follows it.
- **Cost:** an agent on another machine wears Dashi's mark in the bar, as it
  already wore Dashi's colour; its name says who it is.
- **Undo:** the `glyph` prop of `AgentMark`, `JobCapsule` and the field's
  `Lead` (`menubar/lib/menubar-pill-slots.tsx` passes it).

### D81. A click or a key in the window after you let go: the words are not typed

- **Date:** 2026-11-14. The `n8-harden` agent's.
- **Question:** dictation belongs to the field where the key went down, but
  Dashi knows the window, not the field. A click on another conversation, a
  Tab to the next field, during the tidying: the words landed there and the
  capsule said Typed. AT-SPI names a focused field in some apps, but a chat
  app uses the same field for every conversation, so "the same field" proves
  nothing.
- **Choice:** no field counts as identified tonight. If the person's own
  hands pressed a button or a key in that window after the dictation key
  came up (the compositor's `input-origin`, the person's presses only, never
  an agent's), nothing is typed: "You moved on. Your words wait here." with
  Copy, for ten minutes (`WaitReason` `moved`, added to `shared/pill`).
  Hands-free asks from the first words heard of each sentence, so Return and
  then the next sentence still lands; the tap that ends hands-free is a key
  in the window itself and is not asked. "Type it instead" asks from its
  press. Where the compositor can't say, the window is trusted as before.
- **Why:** one Return from the wrong person is worse than a paste.
- **Cost:** a harmless click (to place the caret where the words should go)
  loses the landing; the words are one Copy away. A sentence under a second
  in hands-free has no first words to count from and is typed.
- **Undo:** `moved` in `dictation/lib/land.ts`.

### D82. "Read it all" scrolls the card in place, a view at a time

- **Date:** 2026-11-14. The `n8-harden` agent's.
- **Question:** past six lines a card has no Yes, and "Read it all" opened
  the launcher: another surface, away from the question, and for a spoken
  plan the wrong one. The design's "opens the text where it lives" would put
  a message in an app's field before any yes.
- **Choice:** the card itself scrolls. "Read it all" shows the next view of
  the message (five lines and "and N more steps"; a line longer than a view
  is cut at words), then "More", until the end shows; only then is Yes back
  (a question's choices too). The buttons arm again after each scroll, so two
  quick presses on the same spot are never a yes; with the keyboard, Return
  reads on and is yes only at the end. A yes said before the end is answered
  "Read it all first, then say yes." A view at a time, not a free scroll:
  "the end was shown" is then a fact the model knows, not a guess from a
  scroll position. Nothing is typed anywhere and the launcher is not opened.
  "Type it" on a question still answers it where it lives.
- **Why:** the person reads and answers in one place, and nothing acts
  before the yes.
- **Cost:** no way back up tonight (the card says what the task was; No and
  asking again is the way). A plan of forty steps is eight presses.
- **Undo:** `fit` and `OpenCard.from` in `capsule/`; `cardAction("read")`.

### D83. ❖Esc stops Dashi, with one hand

- **Date:** 2026-11-14. The `n8-harden` agent's.
- **Question:** bare Esc is no longer taken from the app (the night's rule),
  so stopping Dashi meant reaching the capsule's Stop with the pointer, or
  ⌃❖Esc, which takes two hands on most keyboards and cuts every agent off.
- **Choice:** ❖Esc. The thumb and a finger of the left hand; no plain key
  is taken (the chord was already the shell's, to leave the ❖Tab switcher,
  and still does that while the switcher is up). It stops what Dashi hears,
  thinks or says, and every task of Dashi's that is at work, typed or
  spoken; a plan that waits for a yes keeps its card. With nothing speaking
  or at work it does nothing and shows nothing. The capsule's Stop wears
  "❖Esc" as its hint. The Dashi key held with Esc comes to the same, since
  the Dashi key is ❖Space. TypeScript only: no compositor change.
- **Why:** one key to learn, on the hand that is already at the keyboard,
  beside the chord people know for "get me out" (⌥❖Esc is Force Quit).
- **Cost:** dictation is not stopped by it (letting go, or a tap in
  hands-free, already does). Agents from outside Dashi are still ⌃❖Esc.
- **Undo:** the `switch-cancel` case in `shortcuts.ts`; `STOP_KEYS`.

### D84. Small things the join left open

- **Date:** 2026-11-14. The `n8-harden` agent's.
- **Question:** seven loose ends from the first run of the four pieces
  together (`04-night/join/README.md`), each small, each a choice.
- **Choice:**
  - The bar's field closes, draft kept, when the window in front changes.
    While the field has the keyboard no window is focused, so "changed" is
    read from what changes it: a window opening or closing (not the
    clipboard's helper or a portal dialog), another Space, Mission Control,
    the ❖Tab switcher.
  - A card says "hold the Dashi key and say yes" only when it listens (a
    spoken plan, a question); a typed plan's card says to press.
  - "Done" goes before a notice that only repeats what was heard, so it
    shows for its four seconds; a notice that leads somewhere (Settings) is
    still first.
  - The capsule's window lingers 350 ms after its last line, so the next
    line is drawn in it instead of in a window that takes half a second to
    reopen. For that time the place it had still takes a click.
  - A tap of ❖Space does not close a launcher that a tap of ❖ alone opened
    in the last 1.5 s.
  - The bar's mark, the field's lead and Dashi's jobs wear the chosen mark.
  - `settings/settings.ts` knows every section `settings-app/sections.ts`
    keeps; a test holds the two together.
- **Why:** each is the plainer reading of what the person meant.
- **Cost:** a window that opens by itself (a download's dialog) closes the
  field; the draft is one click away.
- **Undo:** `frontWatch`; `hintOf`; `voiceStateOf`; `LINGER_MS`;
  `tapClosesLauncher`.

### D85. An agent's input reaches a window off screen without borrowing the person's seat

- **Date:** 2026-11-14. The `n10-elsewhere` agent's.
- **Question:** in a real session the agent has no seat of its own (GPUI
  and Chromium hear one seat), so every action borrows the person's: their
  pointer moves and their keyboard focus goes to the agent's window, after
  they have paused 2 s. For a window on another Desktop that breaks the
  promise twice: their screen is touched, and an agent "out of my way"
  stalls for as long as they type.
- **Choice:** for a window on a Space that does not show, dashi-comp sends
  the events straight to that window's client, on the `wl_pointer` and
  `wl_keyboard` it made on the person's seat, and leaves the seat's own
  state alone (`session/agent_away.rs`): no pointer warp, no focus change,
  modifiers kept in an xkb state of the agent's own, and no wait.
- **Why:** it is the only way that keeps "nothing of the person's moves"
  true for apps that hear one seat, which are Dashi's own.
- **Cost:** the clipboard does not follow (selections go with the seat's
  real focus, so ❖C and ❖V in such a window do nothing useful); a window's
  lights can't be clicked there; X11 windows are refused (Xwayland has one
  focus); the keyboard enters and leaves once per request, so an app that
  closes a popup when it loses the keyboard closes it between requests. On
  the Space that shows nothing changed: an action there still borrows.
- **Undo:** take the `away_content` branch out of `agent_input`
  (`session/agent.rs`); such a window is then "not on screen" again.

### D86. Their pointer and keyboard step aside only for the same app, after 400 ms

- **Date:** 2026-11-14. The `n10-elsewhere` agent's.
- **Question:** a client's pointer or keyboard can be in one of its
  surfaces at a time. When the person is in one window of an app and the
  agent acts in another window of the same app on another Desktop, whose is
  it?
- **Choice:** the person's leaves that app for the length of the agent's
  request and is given back at its end (the pointer, while a drag holds a
  button, when the drag ends or the person moves), and only once their own
  input is 400 ms old; else the usual refusal, which the shell waits out up
  to 6 s.
- **Why:** 2 s (the borrow's rule) would stall the agent for as long as they
  type; no wait at all would cut a key they are holding. 400 ms falls in the
  gaps of ordinary typing.
- **Cost:** in that one case their app sees its keyboard leave and come back
  (a held key stops repeating, a hover is drawn again). Not proved in the VM.
- **Undo:** `ASIDE_AFTER` in `session/agent_away.rs`.

### D87. Which window is an agent's: its launch's process, else its app, else the next one

- **Date:** 2026-11-14. The `n10-elsewhere` agent's.
- **Question:** a window must be put on the agent's Desktop before it is
  ever on screen, so the shell has to know it is the agent's when the
  compositor asks where it goes.
- **Choice:** the tool that opens it says so first (`Elsewhere.claim`):
  `launch_app` and `open_in_preview` by the launch's process (and its
  children) or the app's id, `open_url` by Helium's id, `open_file` by "the
  next new window", until 3 s after its app took the file, since which app
  that is isn't known there. `window-placing` now says the app's `pid`.
  Besides claims: a dialog goes where its window is, and a new window of an
  app whose windows are all on an agent's Space opens there.
- **Why:** moving a window after it opened would show it to the person
  first, with the keyboard.
- **Cost:** a window the person opens in the same moment, of the same app
  (or any, within `open_file`'s seconds), lands on the agent's Desktop. An
  app that shows a file in a window it already has, on the person's Space,
  shows it there.
- **Undo:** `WorkPlaces.spaceFor`; `arranger.elsewhere` in `boot/agents.ts`.

### D88. An app on an agent's Desktop that raises itself does not move the screen

- **Date:** 2026-11-14. The `n10-elsewhere` agent's.
- **Question:** an app may ask to be activated (xdg-activation, X11), and
  activating a window on another Space switches there. One on the agent's
  Desktop would pull the person's view to it.
- **Choice:** the shell names the Spaces agents work in (`spaces {quiet}`);
  a window's own activation there wants attention instead. The shell's own
  `focus` still switches, and so does the person.
- **Why:** the person did not ask to go there; the agent did the thing that
  made the app raise itself.
- **Cost:** while an agent works on a Desktop, an app there that the person
  started from elsewhere (a link opened from the Terminal) does not bring
  them to it either: its Dock icon asks for attention.
- **Undo:** `activation_may_switch` (`wm/spaces.rs`); `WorkPlaces.work`.

### D89. A Space the agent added goes when it is left empty, unless the person is on it

- **Date:** 2026-11-14. The `n10-elsewhere` agent's.
- **Question:** the lead's rule: a Space added by `"new"` is removed when
  the agent leaves it with no windows. What if the person is looking at it?
- **Choice:** it stays. Removing the Space that shows slides the screen to
  its neighbour.
- **Why:** "the person's screen never moves" outranks tidiness.
- **Cost:** an empty Desktop is left over, which they close with its ×. The
  count is saved in settings.json like any Desktop the person adds.
- **Undo:** `Elsewhere.leave`.

### D90. The assistant's plans may work on another Desktop, for their steps and 30 s

- **Date:** 2026-11-14. The `n10-elsewhere` agent's.
- **Question:** a plan's steps run as the person, one after another, with
  no connection to end; where does `work_in_space` in a plan stop holding?
- **Choice:** the tool is a plan step ("Work on a new Desktop, out of your
  way"), the answerers are told the phrase ("on another desktop", "en otro
  escritorio"), and the Space holds from that step until 30 s after the
  last person-run call (`PLAN_SPACE_MS`, `agents/lib/server-person.ts`).
- **Why:** threading a plan's id down to every tool call is a larger change
  than tonight's; the steps of one plan run within a second of each other.
- **Cost:** a tool command the person runs themselves within those 30 s
  (a `dashi://` link that opens an app) opens on that Desktop too.
- **Undo:** take `work_in_space` out of `PERSON_TOOLS`; the sentence in
  `SYSTEM_PROMPT`.

### D91. The bar says where at rest, the panel has Show, and it is always "Desktop N"

- **Date:** 2026-11-14. The `n10-elsewhere` agent's.
- **Question:** how the person sees an agent at work on another Desktop,
  in one chrome row.
- **Choice:** the agent's line reads "Working on Desktop 3" whenever it is
  not saying what it does this moment; its row in the agents' panel has a
  Show button that switches there. The Space is named by its number in
  everything said about it: the shell's label follows the apps on it
  ("Calculator, Text Editor"), which reads as an app in a sentence.
- **Why:** the line is already there; a second one is not allowed.
- **Cost:** a Desktop the person named ("Work") is still "Desktop 3" in the
  agent's line. `work_in_space` answers both.
- **Undo:** `SessionStatus.shown`; `ShowButton` in `agents-panel/lib/agents-rows.tsx`.

### D92. "Trackpad off" is a setting the key flips; the compositor only carries it out

- **Date:** 2026-11-14. The `n12-trackpad` agent's.
- **Question:** where the trackpad key's state lives, so that it survives a
  restart and Settings shows the same thing.
- **Choice:** `input.touchpad.off` in settings.json. The key
  (`XF86TouchpadToggle`, and `XF86TouchpadOn` / `XF86TouchpadOff` where a
  laptop has those) is a keymap rule bound to `trackpad-toggle`, `-on`,
  `-off`; the shell's hardware keys (`system/keys.ts`) flip the setting and
  show the on-screen display, and the compositor hears it through `input`
  like any other trackpad setting (libinput send-events `disabled`).
  Settings › Trackpad has it as a switch named "Trackpad", on until the file
  says `off` (the registry's `storedOffSwitch`, so the change log reads
  "Trackpad on: off"). Agents' `set_setting` takes
  `trackpad_ignore_with_mouse` and not this switch: an agent that turns the
  only pointer off leaves a person without a mouse to find the way back by
  keyboard.
- **Why:** one place, already watched and applied at start, written by the
  key and the switch alike; no state in Rust.
- **Cost:** the key takes a file write and the watcher's turn before the pad
  stops (well under a second). The notice does not say how to turn it back
  on: the key that was just pressed does, and so does the switch, which the
  keyboard reaches.
- **Undo:** the three rules in `keymap/keymap.ts`; `off` in `TOUCHPAD`;
  `agent: "trackpad_on"` on the row in `registry/lib/input.ts` gives it to agents.

### D93. A mouse is what libinput calls one: udev's mouse, on USB or Bluetooth

- **Date:** 2026-11-14. The `n12-trackpad` agent's.
- **Question:** "Ignore the pad while a mouse is connected"
  (`input.touchpad.offWithMouse`) uses libinput's own mode on a laptop's
  built-in touchpad. A touchpad without that mode (one on USB or Bluetooth)
  is turned off and on by dashi-comp: by which rule?
- **Choice:** libinput's (`input/trackpad.rs`): a pointer udev marks
  `ID_INPUT_MOUSE` whose input device is on USB or Bluetooth, and is not a
  touchpad. A trackpoint (PS/2, I2C) and a virtual pointer are not mice. The
  same rule answers `pointers`, which Settings reads. Where libinput has the
  mode, dashi-comp sets it again each time a device comes or goes: libinput
  1.31 looks for a mouse when the mode is set, and in the VM a mouse plugged
  in afterwards did not stop the touchpad until it was.
- **Why:** two rules for one switch would make the pad behave differently by
  how it is wired.
- **Cost:** a USB receiver that shows a mouse with none paired, or a keyboard
  with a pointer of its own, counts as a mouse, as it does in libinput: the
  pad stays off beside it. The switch is off by default. The bus is read from
  sysfs (`id/bustype`) when a device is added: one small read on the loop,
  as libinput itself does.
- **Undo:** `external_mouse` in `input/trackpad.rs`.

### D94. The compositor says which pointer devices are connected

- **Date:** 2026-11-14. The `n12-trackpad` agent's.
- **Question:** the switch must be absent, or say why, on a computer with no
  trackpad; the shell did not know what is plugged in.
- **Choice:** a method, `pointers`, and an event of the same name:
  `{touchpad, mouse}` (docs/compositor-ipc.md). Settings › Trackpad leaves
  the two switches out and says "This computer has no trackpad" when
  `touchpad` is false, says "A mouse is connected: the pad is ignored now"
  on the row when that is so, and the trackpad key does nothing without a
  trackpad. Until the compositor has answered (nested, tests, an older
  dashi-comp) a trackpad is taken to be there.
- **Why:** a fact about devices is the compositor's to report; what to draw
  is the shell's.
- **Cost:** one more method and event. It says kinds, not a list of devices.
- **Undo:** `pointers` in `ipc/table.rs` and `Event::Pointers`; the pane
  falls back to showing every row.

### D95. A pointer lock is held by the pointer's own surface, and goes with the keyboard

- **Date:** 2026-11-14. The `n13-games` agent's.
- **Question:** a game locks the pointer; when does the lock hold, and what
  ends it? dashi-comp asked, on every motion, whether the surface *under* the
  pointer had an active lock, so anything that put the pointer over
  something else (a banner, a title bar's strip, a wrong hint, D97) set it
  free under a game that still thought it locked.
- **Choice:** the surface the pointer is *in* holds it, whatever lies under.
  A lock or confinement takes hold when the pointer is in its window and the
  keyboard is too; it lets go when the keyboard leaves that window (❖Tab, the
  launcher, a sheet that takes the keyboard) or Mission Control opens, and
  holds again on the way back. A lock asked for by the window that has the
  keyboard while the pointer is elsewhere brings the pointer to the middle of
  that window. A surface that is no window of Dashi's (an X11 window that
  manages itself) asks nothing of the keyboard.
- **Why:** it is what a person means by "the game has the mouse": the game
  has it while they are in the game, and their own keys take them out. The
  keyboard is the one signal both the shell and the compositor already
  agree on for "the person is here".
- **Cost:** this is a rule in Rust, where rules are not meant to live; it is
  the protocol's own ("the compositor decides when a lock is active") and has
  no setting. An app with the keyboard can take the pointer from anywhere on
  screen by asking for a lock.
- **Undo:** `may_hold_with`, `hold_follows_keyboard` and
  `bring_pointer_to_lock` in `input/constraints.rs`; `hold_at` back to the
  surface under the pointer.

### D96. A locked pointer is nowhere for Dashi

- **Date:** 2026-11-14. The `n13-games` agent's.
- **Question:** what of Dashi's may answer a pointer that a window has
  locked? The owner saw the Dock, the menu bar and the window's lights come
  out over Minecraft and take its clicks, and "sometimes stay".
- **Choice:** nothing. While a lock holds, no press is the compositor's (a
  light, a title bar, a resize border, a sheet, a banner under the pointer:
  the press goes to the game and the keyboard stays), no edge band or hover
  hears the pointer, and a tablet's absolute motion is dropped. The moment a
  lock takes hold the shell hears the pointer leave the top band and the
  Dock's band (`bars-edge` and `edge` with `inside: false`), and a lit light
  goes out: no later motion would say so. When it lets go, the bands and
  lights are told where the pointer is.
- **Why:** a locked pointer has no place the person can see, so nothing
  should treat it as being somewhere.
- **Cost:** a tablet or touch screen cannot be used over a game that holds a
  lock until the keyboard leaves it.
- **Undo:** `pointer_lock_changed` in `input/claims.rs`; the `pointer_locked`
  checks in `input/buttons.rs` and `input/pointer.rs`.

### D97. Xwayland's position hint is in its pixels, and never followed outside the window

- **Date:** 2026-11-14. The `n13-games` agent's.
- **Question:** an X11 game's lock sends, with every motion, where its
  pointer "is" (pointer-constraints' position hint; Xwayland sends the X
  pointer's place). dashi-comp put the real pointer there, reading Xwayland's
  pixels as points: 1.75 times too far on a 1.75 screen, soon off the window
  or the screen. What to do with a hint?
- **Choice:** divide it by the client's scale (Xwayland's, `xwayland-scale`),
  and follow it only when it lands inside the window; otherwise the pointer
  stays where it was.
- **Why:** this was the cause of the owner's report (review `07-games`). A
  hint is a wish for where the cursor shows when the lock ends; a place
  outside the window cannot be that.
- **Cost:** smithay hands the hint over unscaled, so the scale is applied in
  Dashi; if smithay starts scaling it, this divides twice (the unit test
  `an_x11_games_hint_is_in_xwaylands_pixels` does not see that: check the
  VM cases in `07-games/client` when smithay is updated).
- **Undo:** `hint_in` in `handlers/pointer.rs`.

### D98. A full-screen window's top strip is its own

- **Date:** 2026-11-14. The `n13-games` agent's.
- **Question:** full screen, a window with Dashi's title bar loses the bar,
  but presses along its top 28 points still went to the bar that was not
  drawn: a click at a full-screen game's top left hit the hidden yellow light
  and minimized it. What does a free cursor meet at the top of a full-screen
  window?
- **Choice:** only what is drawn. A title bar that is not drawn takes no
  press (`Decor::pressed`); a unified window keeps its lights, which it
  draws room for. The top row of pixels still brings the menu bar down
  (`fullscreen.ts`), as before; the Dock does not show in full screen.
- **Why:** a bug, not a choice, but it settles what the lights do there.
- **Cost:** none known.
- **Undo:** `Decor::pressed` in `render/titlebar.rs`.

### D99. In Files' list the icon and the name are the item; the rest of a row is empty space to a drag

- **Date:** 2026-11-14. The `n15-marquee` agent's.
- **Question:** Files gets a marquee (a press on empty space, dragged, selects
  what the rectangle touches). In the list every row runs the window's width
  and the whole row dragged the file, so there was no empty space to start
  from except under the last row. What is a press on a row's blank part?
- **Choice:** as the Finder's list: the icon and the name are the item. A
  press there, moved, drags the file (to a folder, the sidebar, another
  app); a press anywhere else on the row, moved, draws a marquee. A click
  anywhere on the row still selects it, a double click still opens it, and
  a right-click anywhere on it is still the item's menu. In the icon view
  the whole tile is the item, as its hover wash shows; a marquee starts in
  the space beside, between and under the tiles.
- **Why:** a list of forty files has no other empty space, and people who
  know the Finder or Explorer press beside the name to drag out a box.
- **Cost:** a file is no longer dragged by its date or size. The name's
  width is estimated (`tile-name.ts`'s letter widths), so the grip can run
  a few pixels past or short of a name.
- **Undo:** in `file-browser/lib/views/list.tsx`, give `Table` its
  `dragFiles` back and take the grip out of `NameCell`.

### D100. A marquee asks its window where the items are painted

**Still so after mirin's scroll position came (D134):** on a long list it is not to be trusted yet.

- **Date:** 2026-11-14. The `n15-marquee` agent's.
- **Question:** the rectangle must stay on the items while they scroll, and
  scroll them at the edges. Metal tells an app neither where a scroll view
  stands nor lets it scroll one, and mirin is not to be changed for this.
- **Choice:** the nearest thing Metal has: its simulation channel, which
  Calendar already uses to scroll to "now". `WindowSurface`
  (`src/shared/metal/surface.ts`) asks the host for the painted bounds
  (`layout`) and scrolls a view by pixels (`scroll`); `runApp` and the
  portal's windows provide it, so Files, `dashi-dialog`, the portal's
  sheets and Text Editor's chooser all get the marquee from the one
  listing. The drag asks when it starts, and then every 150 ms while it
  is not scrolling the listing itself: a wheel moves the items with no word
  to the app (the scroll view takes the turn; `onWheel` on the view around
  it hears nothing, as the VM showed). Its own scrolling it counts, from
  the views' own measures.
- **Why:** no second listing, no change to mirin, and the answer is what
  was painted, so the rectangle lands on what the person sees.
- **Cost:** a `layout` answer names every painted node (some tens of
  kilobytes in a big window) each time it is asked: about seven times a
  second during a drag (the one more for a click on a list's row went with D103: D105). The views' measures (tile 104 × 98, row 26) are now
  also what the rectangle is matched against: change one and
  `tileRects`/`rowRects` change with it.
- **Undo:** when mirin reports a scroll position and takes a scroll, read
  those in `lib/marquee/session.ts` `place` and `tick`, and drop
  `surface.ts`.

### D101. A drag's keys are the keys of the click its release makes

- **Superseded by D104** (2026-11-14): mirin's pointer says the keys. What
  is below is now only what happens on a Metal host older than that.
- **Date:** 2026-11-14. The `n15-marquee` agent's.
- **Question:** plain drag replaces the selection, ⇧ adds, ❖ toggles. But
  Metal's `onPointer` (press, moves, release) carries no keys; only
  `onPress`, the click, does, and it comes at the release.
- **Choice:** the click that ends the drag says the keys: with ⇧ or ❖ the
  selection is worked out again against the one from before the drag, at
  the release. Until then the drag shows as a plain one. A release outside
  the listing makes no click, so it stays plain. The meanings are the
  click's (`selection.ts`): ⇧ adds, ❖ or Ctrl toggles, ⇧❖ adds, as
  ⇧❖-click adds a run. A host that sends `modifiers` with the pointer is
  believed from the press on (`session.ts` reads them when they are there).
- **Why:** the result is right in the common case with what Metal gives
  today; the other choice was no ⇧ or ❖ at all.
- **Cost:** with ⇧ or ❖ held the earlier selection looks dropped during the
  drag and comes back when the button goes up. The fix is three lines in
  mirin: `modifiers` on the `pointer` event's `down`
  (`crates/mirin-metal/src/render.rs`, where `onPointer` hears the press,
  `events.rs` `Pointer`, `PointerInfo` in `packages/mirin-metal/src/types.ts`).
- **Undo:** nothing to undo once mirin sends them; `press` in `session.ts`
  then only keeps the click from clearing the selection.

### D102. A marquee takes an item when it touches its tile or its row

- **Date:** 2026-11-14. The `n15-marquee` agent's.
- **Question:** what does the rectangle have to touch: the icon and the
  name (the Finder), or the item's whole place?
- **Choice:** the whole place: a tile in the icon view (104 × 98), a row
  across the list's width. The keyboard's place after a drag (the anchor
  of ⇧ with the arrows) is the item nearest the corner that moved.
- **Why:** it is what Dashi shows as the item (the hover wash, the
  selection wash), and it needs no measuring of names.
- **Cost:** a rectangle that only crosses a tile's empty corner takes it.
- **Undo:** `tileRects` and `rowRects` say what an item's place is.

### D103. In Files' list a row's click is the listing's

- **Superseded by D105** (2026-11-14): the rows take their press again and
  `rowPress` is gone from `Table`.
- **Date:** 2026-11-14. The `n15-marquee` agent's.
- **Question:** D101 reads a drag's keys from the click its release makes.
  In the VM a ⇧-drag that started on one row and ended on another added
  nothing: Metal gives a press to the innermost view with `onPress` (the
  row), and a row hears a click only when the button goes up on that same
  row. So most drags in a list made no click, and had no keys.
- **Choice:** in Files' list the rows take no press (`Table`'s new
  `rowPress`, off there); the listing around them owns every press that is
  not on an icon or a name, so every release inside it is its click, with
  the keys. A click that was not a drag is then looked up: the listing
  asks the window where the rows are painted (D100) and selects the row
  the press was on, or nothing under the last row. The icon and the name
  keep their own click. Where no window can be asked (a test's host), the
  rows take their presses as before and nothing is dragged out.
- **Why:** it makes ⇧ and ❖ drags right from anywhere in a list, with what
  Metal gives today.
- **Cost:** a click on a row's blank part waits for one `layout` answer
  from the host before it selects (not measured; not seen in the VM), and a
  row is no longer a button to a screen reader (its name still is).
  Activity Monitor and every other `Table` are untouched.
- **Undo:** once mirin sends `modifiers` with the pointer (D101), drop
  `rowPress={false}` in `list.tsx` and `pressed()` in `session.ts`.

### D104. A drag's keys are the keys the pointer says, from the press on

- **Date:** 2026-11-14. The `n16-modkeys` agent's. Supersedes D101.
- **Question:** D101 took a marquee's keys from the click its release
  makes, because Metal's pointer said none: a ⇧ or ❖ drag looked plain until
  the button went up, and one let go outside the listing stayed plain. The
  owner's rule is that a gap in the library is closed in the library.
- **Choice:** mirin Metal's `pointer` event now says the modifiers held on
  `down`, on every move and on `up`, in the names a press uses
  (`PointerInfo.modifiers`; mirin branch `dashi-0.9-pointer-modifiers`), and
  a modifier pressed or let go while the button is down sends a move where
  the pointer is. Files' marquee (`lib/marquee/session.ts`) takes its rule
  from each of them: ⇧ adds and ❖ toggles from the first move, the rule
  follows the keys while the drag goes on (⇧ pressed mid-drag brings the
  earlier selection back at once; let go, it goes), and the release keeps
  the rule wherever it lands. The keys at the release are the ones that
  count, as they are what the screen showed last.
- **Why:** what is selected while the button is down is what is selected
  when it goes up, which is the whole promise of a live marquee.
- **Cost:** ❖ pressed or let go in the middle of a drag changes nothing
  (seen in the VM): ❖ is Dashi's, and the compositor lends Super to a
  window only for a button that goes down with ❖ held, until that button
  comes up (`dashi-comp/src/keys/super_click.rs`). ⇧ and Ctrl do change
  the rule mid-drag, and a drag begun with ❖ is a ❖ drag throughout. On a
  Metal host built before this (the field is optional), D101's path is
  still there: the rule is the keys of the click the release makes, and
  shows only then.
- **Undo:** not wanted. To latch the rule at the press (the keys at the
  press decide, whatever is held later), read `modifiers` only on `down` in
  `pointerEvent`.

### D105. In Files' list a row takes its press again

- **Date:** 2026-11-14. The `n16-modkeys` agent's. Supersedes D103.
- **Question:** D103 took the press away from the list's rows only so that
  every release made a click with keys. With D104 no click is needed for
  the keys. Do the rows get their press back?
- **Choice:** yes. `Table`'s `rowPress` is gone, a row is a button again (to
  a screen reader too), and a click on a row selects it at once, with no
  question to the window. A press on a row's blank part still starts a
  marquee: the listing around the rows hears the pointer, the row hears the
  click. The click a drag's release makes (on the row it started on, or on
  the empty space) is dropped by the marquee (`press`); a release anywhere
  else makes none, and the marquee stops waiting for one after 400 ms
  (`CLICK_MS`), so a row pressed later without the pointer is a click.
- **Why:** less code, one fewer round trip per click, and the row is what a
  screen reader presses.
- **Cost:** on a Metal host older than D104's, a ⇧ or ❖ drag in the list
  that ends on another row than it began on is a plain one again (no click,
  so no keys): the case D103 was for. Dashi 0.9's packages are built from
  the mirin branch that has the keys, so this is a checkout on an old host
  only.
- **Undo:** `git revert` of this entry's commit brings `rowPress` and
  `pressed()` back.

### D118. A Desktop an agent added is watched after the agent leaves it

- **Date:** 2026-11-14. The `n20-agents` agent's. Adds to D89 and D90.
- **Question:** D89 looked at an added Desktop once, as its agent left. Three
  orders of events left an empty one behind: the agent's connection drops
  while its last window is still closing; a plan's hold ends (D90, 30 s)
  with its window open and the person closes it later; the person was
  looking at the empty Desktop and then goes elsewhere.
- **Choice:** a Desktop that could not go when its agent left is kept by
  `AddedSpaces` (`agents/desktop/lib/added-spaces.ts`) and looked at again when a
  window closes or moves to another Desktop, when the screen goes to another
  Desktop, and when an agent stops working on one. It goes the first time it
  has no windows, does not show, and no agent works on it. Only Desktops made
  by `work_in_space "new"` are ever kept there.
- **Why:** the rule is about the Desktop, not about the moment the agent left.
- **Cost:** a Desktop an agent added and the person then took for their own
  windows also goes once they empty it and look elsewhere: Dashi cannot tell
  "theirs now" from "left over". Nothing is kept on disk, so one that waits
  when the shell restarts stays until its × is pressed.
- **Undo:** in `Elsewhere.leave`, call `added.look()` once and forget the
  Desktop (`AddedSpaces.left` without the listener).

### D119. A window's picture waits for the frame after the agent's input, 250 ms at most

- **Date:** 2026-11-14. The `n20-agents` agent's.
- **Question:** a window screenshot asked within about 50 ms of typing
  showed the frame from before (ten of ten). Where does the wait go, and
  how long may it be?
- **Choice:** in the compositor (`session/agent_fresh.rs`). `agent-input`
  and `type-text` note the window; `capture {window}` asked before that
  window has committed a new buffer since is held and taken at that commit,
  or 250 ms after the input, whichever is first. Past 250 ms, or once the
  window has drawn, nothing waits. Screen and `rect` captures never wait.
- **Why:** only the compositor sees the window's commits, so only there can
  the wait end the moment the frame is in (about 20 ms for Text Editor)
  rather than always after a fixed sleep. 250 ms is four times the 66 ms at
  which every picture was current, and short enough that an input which
  draws nothing (a click on empty space) costs a quarter of a second at
  worst, and only when the picture is asked that soon.
- **Cost:** it is the first new buffer after the input, not proof the input
  is in it: an app that was already drawing a frame (a caret's blink) when
  the keys arrived can still hand over the old words, and what an app draws
  later (Text Editor's character count, a quarter of a second after) is not
  waited for. A buffer committed by a synchronised subsurface alone is not
  seen; the bound covers it.
- **Undo:** `capture` calls `capture_now` directly (`ipc/methods/capture.rs`).

### D117. Helium takes the packaged extension through the policy's own update URL and a minimum version

- **Date:** 2026-11-14. The `n20-agents` agent's.
- **Question:** a Helium profile that already had Dashi's extension kept
  0.5.0 for ever. The cause: the policy's `update_url` is asked only for the
  first install; later checks go to the manifest's `update_url`, and with
  none, to the web store. How does an existing profile get the packaged
  version after one restart, with no step from the person?
- **Choice:** two keys in the policy's `ExtensionSettings`:
  `override_update_url: true`, so the package's `file://` update manifest is
  asked for updates too, and `minimum_version_required` set to the packaged
  version, so an older extension is turned off and updated at once (as
  Helium starts, or as soon as the policy file changes) instead of at the
  updater's next round, hours later, and instead of waiting for a busy
  service worker to go idle. The shell also compares the version the
  extension says with the package's and posts one notification per pair of
  versions and shell run when it is older.
- **Why:** it reaches profiles that hold an old manifest (adding
  `update_url` to the manifest would only help installs made after it), it
  is Chromium's own update path (the entry, its permissions and its storage
  are kept), and nothing runs outside the browser. An external-extensions
  JSON was not used: it would install beside the policy's entry under
  another location and the two would take turns.
- **Cost:** `minimum_version_required` must be raised with every extension
  version (a test holds it to the manifest's). While the update is fetched
  the old extension is off (under a second from a local file); if the CRX
  were missing it would stay off, where before it would have run old. The
  notice is not kept on disk, so a shell restart may say it once more.
- **Undo:** drop the two keys from `spin/dashi-helium/…/dashi.json`; the
  `onExtension` line in `agents/server.ts` for the notice.

### D120. dashi-dialog finds the packaged Metal host itself, and says when there is no display

- **Date:** 2026-11-14. The `n20-agents` agent's.
- **Question:** started by cron, over ssh or by a systemd unit, `dashi-dialog`
  has none of the session's environment: what does it take as given?
- **Choice:** its launcher sets `DASHI_METAL_HOST` to the packaged host
  (`<prefix>/libexec/dashi/mirin-metal-host`) when the variable is not set,
  as `dashi-portal` does and as the session's own default is. It never
  guesses a display: with no Wayland socket to connect to (`WAYLAND_DISPLAY`,
  else `wayland-0`, under `XDG_RUNTIME_DIR`) and no `DISPLAY`, it stops with
  exit 255 and says to run it in the session or to give it the session's
  `WAYLAND_DISPLAY` and `XDG_RUNTIME_DIR` (`apps/dialog/lib/where.ts`).
- **Why:** the host's path is the package's fact; which session a script
  means to show a dialog in is the script's.
- **Cost:** a cron job still has to name the display (the session's socket
  is `wayland-1` in the VM, not the default name).
- **Undo:** the block in `session/dashi-dialog`; `cannotShow` in `main.tsx`.

### D121. A Space removed while the screen slides to it ends the slide

- **Date:** 2026-11-14. The `n20-agents` agent's.
- **Question:** found in the VM: `space-remove` of the Space a 250 ms slide
  was going to left the slide running, and its end showed a Space that was
  gone (`current` equal to `count`; the shell then could not list Spaces).
- **Choice:** `remove_space` ends a slide to or from the removed Space where
  the screen is, and renumbers a slide between Spaces after it
  (`wm/space_list.rs`). The shell's `AddedSpaces` still reads `current` from
  its own snapshot, which is the Space the slide started from until it ends.
- **Why:** the compositor must never show a Space it does not have.
- **Cost:** an agent that shows its empty added Desktop and leaves it within
  the slide takes the Desktop away as the person arrives; the screen stays
  where it was. After the slide the Desktop stays, as D89 says.
- **Undo:** not wanted.

### D122. "Type it instead" never waits long on the password-field check

- **Date:** 2026-11-14. The `n20-agents` agent's.
- **Question:** seen once: the first "Type it instead" after a login through
  the greeter stopped the ask and typed nothing. Read, not reproduced. A
  dictation asks at its key's hold whether a password field has the
  keyboard, which also connects to the accessibility bus; words sent by
  Dashi's capsule were first checked at the landing, so the first of a
  session waited there on a cold bus (its timeouts add up to about 8 s), and
  a click or key in the window meanwhile made them wait with Copy ("moved",
  D81) instead of being typed.
- **Choice:** holding the Dashi key warms the same check, and the landing
  waits for its answer 1.5 s at most (`FIELD_CHECK_MS`, `dictation/lib/land.ts`);
  past that the words are typed.
- **Why:** a warm check answers in milliseconds; the bound is for the bus
  that is still starting, where waiting gains nothing the person can see.
- **Cost:** when the check does not answer in 1.5 s, words can be typed into
  a password field that was not recognised. That was already so when the
  bus cannot be reached at all; a dictation's own hold still refuses a
  password field it knows of before listening.
- **Undo:** `secretIn` back to `deps.secret` in `place`; the warm-up line in
  `dictation/start.ts`.

### D111. In Files' icon view the icon and the name are the item, to a press and to a marquee

- **Date:** 2026-11-14. The `n19-polish` agent's. Changes D99's last
  sentence and D102 for the icon view.
- **Question:** a tile filled its whole cell (104 × 98) and the cells stand
  side by side, so a press between two icons dragged a file, and a marquee
  could start only in the margins or after the last tile; the installed
  pass moved two files by accident. What is the item, and what must the
  rectangle touch?
- **Choice:** as the Finder: the item is the icon (its 56 px square) and
  the name, at the name's own width. A press on either selects, opens on
  a second click, drags the file, and a right-click there is the item's
  menu. The rest of the cell is empty space: a press there, dragged, draws
  the rectangle; clicked, it clears the selection; a right-click is the
  folder's menu. The rectangle takes an item when it touches its icon or
  its name, no longer its whole cell: a drag begun inside a cell would
  otherwise always take that cell's item, whichever way it went. The list
  keeps D102 (a row is taken anywhere along it; rows have no empty part
  the rectangle could start in and miss). Files dropped anywhere on a
  folder's cell still go into it, and a selected item still washes its
  whole cell (design.html CO-9); the hover wash is now on the part under
  the pointer, the icon or the name, which shows what a press takes.
- **Why:** it is the default view, and a full folder had almost nowhere to
  begin a rectangle. The press and the rectangle now agree on what an item
  is.
- **Cost:** a smaller target: a press 10 px beside a short name misses the
  item. The name's box is estimated for the rectangle
  (`grid-places.ts` `itemParts`, from `tile-name.ts`'s letter widths), so
  it can take or miss a name by a few pixels; the press itself uses what
  is painted. The selection's wash is wider than what a press takes.
- **Undo:** in `file-browser/lib/views/grid.tsx` spread `grip` on the cell
  and drop `parts` from the model.

### D112. In Files' list the grip is as tall as the row

- **Date:** 2026-11-14. The `n19-polish` agent's. Adds to D99.
- **Question:** the icon and the name are what drags a file out of the
  list (D99), and the grip was as tall as the name's line (about 16 of the
  row's 26): 10 px of every row, between two names, were empty space, and
  a press there drew a thin rectangle instead of dragging the file.
- **Choice:** the grip is the row's height and the icon and name's width.
- **Why:** rows touch; a strip of empty space between two names that
  cannot be seen is a trap, and nobody starts a rectangle in it on purpose.
- **Cost:** none seen.
- **Undo:** take `height: ROW` off the grip in `list.tsx` `NameCell`.

### D113. The keyboard's item is scrolled into view by asking the window

**Still so (D134).**

- **Date:** 2026-11-14. The `n19-polish` agent's.
- **Question:** ↑ or ⇧↑ past the top of what shows left the selection off
  screen, in Files and in the open and save sheets. Metal neither says
  where a scroll view stands nor takes a "show this node".
- **Choice:** after a key that moves the keyboard's place (the arrows, the
  page keys, Home, End, a typed name), the listing asks the window where
  its items are painted and scrolls it there through the simulation
  channel, as a marquee does (D100; `lib/marquee/reveal.ts`): just far
  enough to show the item whole, and all the way when it is in the first
  or last row. One item at a time; a scroll not painted yet is counted, so
  a key that repeats is not scrolled for twice. It is done in
  `BrowserKeys`, so Files, the sheets and `dashi-dialog` all have it.
- **Why:** one place, no change to mirin, and it lands on what is painted.
- **Cost:** a `layout` answer or two per key that moved the place. A
  selection made another way (a new folder off screen, Select after
  paste) is not scrolled to.
- **Undo:** when mirin can scroll a node into view, call that in
  `BrowserKeys` and drop `reveal.ts`.

### D114. The agents' panel is solid, and a row on another Desktop says where and who, whole

- **Date:** 2026-11-14. The `n19-polish` agent's. Adds to D91.
- **Question:** two things in the panel. Its ground was the launcher's
  glass, and over a window, in Dark most, the window's words read through
  it. And a row of an agent at work on another Desktop holds Show as well
  as Stop, so its line "On Desktop 4 · “dev-box”, connected over SSH" was
  cut after the first letter of the agent's name.
- **Choice:** the ground is the menu's tint without its alpha, edged as a
  menu is: what the notification center already does for the same reason.
  The row stays one line under its title (never a second): with Show in
  the row, the two buttons sit beside the title and that line runs the
  row's whole width (the VM showed the name still cut beside Show while
  the agent saw the screen). It says the
  Desktop and who the agent says it is, "On Desktop 4 · “dev-box”". To
  make the room, that row leaves out the chip when all it would say is
  "Connected" (the row being there says it) and a remote agent's
  "connected over SSH" (its title is "Remote agent"). A chip that says more
  ("Waiting for you", "Seeing the screen · 0:07") stays; while it sees or
  records the screen the chip is followed by the name alone (the Desktop
  gives way: Show is there). Rows of agents on the Desktop that shows are
  as they were.
- **Why:** a panel that says who can see the screen has to be readable
  over anything; and a name cut to one letter reads as a mistake.
- **Cost:** the panel no longer shows the wallpaper through. A row with
  Show is about 8 taller than one without. A name longer than about 30
  letters (23 beside a chip) is still cut, at its end.
- **Undo:** `PANEL_GROUND` in `agents-panel.tsx`; `rowLine` in
  `lib/agents-rows.tsx`.

### D115. A key named in a sentence is drawn as a shortcut's glyph, by one component

- **Date:** 2026-11-14. The `n19-polish` agent's.
- **Question:** "Hold ❖Space or the Copilot key", "the right ⌥": inside a
  sentence ❖ and ⌥ were about half the size of the words. There was no
  one place that drew them: each sentence was a plain `Text`, the UI font
  has neither glyph, and the font the Metal host falls back to draws them
  small. (`Shortcut` has always drawn keys as SVG for this reason, but
  only as a shortcut on its own, after a label.)
- **Choice:** one component, `KeyedText` in `@dashi/ui`. A sentence with a
  key glyph is laid out a word at a time in a row that wraps, as a caption
  with keys already was, each glyph an SVG in a box 1.15 of the type's
  size, in the text's colour, kept in one piece with the word it is
  written against ("❖Space"). A sentence with none is the plain `Text` it
  was. It is what draws a Settings row's detail, a caption, the capsule's
  line, the voice chip's line and the card's hint, so every such sentence
  is covered where it is drawn, not where it is written.
- **Why:** mirin was not to be changed this round, and a font with these
  glyphs at text size would be a new dependency for five characters.
- **Cost:** such a sentence is many text nodes, not one: it wraps between
  words only, cannot be selected as one run, and a screen reader gets the
  whole sentence from the row's label. A one-line one (the capsule's) is
  not cut with an ellipsis when it is too long. Text drawn elsewhere with
  a key in it (a notification's body, an app's own words) is still the
  font's.
- **Undo:** when the host's fallback font draws them at size, make
  `KeyedText` a plain `Text` again.

### D116. The capsule has one home; a card says "Stopped"; dictation says once that it needs Voice

- **Date:** 2026-11-14. The `n19-polish` agent's. Three small calls in the
  capsule. Adds to D83.
- **One home.** The capsule sat 11 from the edge in a new session (no Dock
  laid out yet) and higher later, with no Dock on screen either time. Its
  home is now 9 above the top of the Dock's band whether or not the Dock
  shows: hidden by itself, not laid out yet, or a display with none. The
  seats beside the Dock and one step up are still only for a Dock that is
  on screen with a window down to it. *Cost:* with the Dock hidden and a
  window down to the edge, the capsule lies on that window's last lines (as
  the step up from the edge did) and 80 of empty wallpaper are under it
  on a bare desktop. *Undo:* `placeOf` in `capsule/lib/place.ts`.
- **❖Esc under a card.** The capsule's own line is not drawn while a card
  is up, so ❖Esc stopped Dashi's voice and the card looked the same. The
  card's foot now says it: "❖Esc stops the voice." while Dashi speaks (the
  capsule's Stop already wears the keys), and "Stopped" for 2.5 s after,
  as the capsule says after Cancel; then how to answer the card is back.
  What Dashi hears still goes before both. *Cost:* while it speaks, the
  line that says how to answer is away (the buttons are not). *Undo:*
  `footOf` in `capsule/lib/card.tsx`.
- **The dictation key with Voice off.** It did nothing and said nothing.
  Now, while Voice is off and dictation is asked for, the key is still
  heard, and the first hold says one line, "Dictation needs Voice turned
  on. See Settings › Voice."; a press on the capsule goes there (so does
  one on "Dictation needs its models."). After that the key is let go of
  for the rest of the session. Only a key that is heard and not taken (the
  right ⌥ or ⌃, held alone): where the key would be Caps Lock or the Menu
  key, nothing is asked of the compositor and nothing is said, because
  taking Caps Lock from someone who turned Voice off is worse than
  silence. *Cost:* those layouts (Spanish, most European) still get no
  line. *Undo:* `teaching` in `dictation/start.ts`.

### D106. An X11 window keeps the size its app asked for, in X11's pixels

- **Date:** 2026-11-14. The `n18-x11` agent's.
- **Question:** on a screen at 1.75, X11 apps draw in the screen's pixels
  (`appearance.x11Apps: sharp`) and are told the size to draw at through
  `Xft.dpi`. smithay's X11Wm reads a new window's size with the scale cut to
  a whole number (1.75 as 1), so a window that asked for 800 by 600 pixels
  was taken for 800 by 600 points and, when placed, made 1400 by 1050
  pixels. At 2 the same window stayed 800 by 600 pixels. Which is right?
- **Choice:** the app's pixels, at every scale: the size is read again with
  the real scale as the window is made (`xwayland/scale.rs`,
  `x11_read_geometry`), so placing it sends back the size it has.
- **Why:** the window manager was scaling a size that was already in
  pixels. GLFW and SDL (sdl2-compat) asked for 800 by 600 and were made
  1400 by 1050; an app that sizes itself from `Xft.dpi` (Qt, Chromium,
  Steam: not tried here) is scaled twice that way; and a game that keeps
  its size in pixels and asks for it again (Neverball saves 1920 by 1200)
  is given 1.75 times its screen and draws past its window, which is the
  likely cause of the picture drawn too large in `07-games/installed`.
  1.75 now behaves as 2 always did, and as `xwayland-scale.ts` says ("an
  app that ignores it draws small").
- **Cost:** an X11 app that ignores `Xft.dpi` (GLFW: Minecraft's window at
  854 by 480) opens 1.75 times smaller on a 1.75 screen than it did, at the
  size it has on a screen at 2. A size is kept in whole points, so a width
  that is no whole number of points moves by one pixel when the window is
  first configured.
- **Undo:** empty `new_window` in `xwayland/wm.rs`.

### D107. An X11 window asks for full screen before the shell knows it, and covers its screen in X11's pixels

- **Date:** 2026-11-14. The `n18-x11` agent's.
- **Question:** SDL sets `_NET_WM_STATE_FULLSCREEN` on its window before it
  shows and asks again as it shows; GLFW asks as it shows. smithay's X11Wm
  never reads the property, and dashi-comp dropped a request for a window
  the shell had not heard of yet (it has not drawn), so a game that starts
  full screen came up as a window. And a full-screen frame is kept in whole
  points: 1920 by 1200 at 1.75 was 1098 by 686 points, sent back as 1922 by
  1201 pixels.
- **Choice:** dashi-comp keeps a connection of its own to Xwayland
  (`xwayland/probe.rs`) and, as a new X11 window is placed, reads the
  property; a request that comes before the window is announced is kept on
  it; a window with no frame that is exactly a screen's size counts as
  asking too. The shell hears `fullscreen` right after `window-opened` and
  decides as for any request. In full screen an X11 window gets the whole
  points nearest its screen's own pixels, as RandR gives them
  (`xwayland/fullscreen.rs`): 1097 by 686, which is 1920 by 1201. A size
  an app asks for while full screen (GLFW and SDL do as they leave) becomes
  the size it goes back to. A window that asks before the shell knows it
  is made its screen's size at once (the screen under the pointer) and
  told it is full screen: a game sizes its picture as its window is made
  and waits only a moment for the answer (Neverball never looks again, and
  drew 800 by 600 in a corner of a full screen without this).
- **Why:** the policy stays the shell's (it may give the window its own
  Desktop); the compositor only stops losing the request. The nearest size
  because a game draws to the size it is told.
- **Cost:** two waited-for requests to Xwayland when an X11 window opens and
  one when one goes full screen. The window shows at its place for a
  moment before it fills the screen. A game that started full screen and
  leaves it comes back as a window the size of the screen, with a title
  bar: that is the frame the shell saw it open with (`arrange-frames.ts`
  frames it back to it), whatever size the game asks for as it leaves. One
  row of pixels too many at 1.75
  (cut off at the bottom): the exact size cannot be said in whole points,
  and only the window manager's connection may size a window (tried: a
  resize from the probe's connection comes back to X11Wm as a request).
  Exact needs smithay to take a size in pixels.
- **Undo:** drop the calls to `x11_note_fullscreen`, `x11_tell_fullscreen`
  and `x11_screen_frame`.

### D108. ❖ during a pointer drag in a window is that window's modifier

- **Date:** 2026-11-14. The lead's decision, carried out by the `n18-x11`
  agent. Closes D104's cost.
- **Question:** ❖ reached a window only for a button that went down with it
  held, so Files' area drag could not change its rule on ❖ midway.
- **Choice:** while a pointer button is held down in the window that has the
  keyboard, ❖ going down or up is told to that window as Super
  (`keys/super_click.rs`), and such a press is a chord, not a tap: no
  launcher on release. With no button down ❖ is Dashi's, as before.
- **Why:** a drag's modifiers are the app's to read, as ⇧ and Ctrl already
  were.
- **Cost:** ❖ pressed during a drag opens nothing; a ❖ chord typed while a
  button is held (❖Space with the mouse button down) still goes to Dashi,
  and the window has seen Super go down for it.
- **Undo:** take the two `super_in_a_drag` calls out of `keys/super_key.rs`.

### D109. A game that resumes under the bar or the Dock: nothing is done, because nothing is asked

- **Date:** 2026-11-14. The `n18-x11` agent's.
- **Question:** a game leaves its menu while the pointer lies over the menu
  bar brought out over full screen, or over the Dock. The bar stays out
  until the mouse moves. Can dashi-comp bring the pointer back, or hide
  what it revealed, at that moment?
- **Choice:** no change. A window that asks for a lock while the pointer is
  elsewhere already gets the pointer brought to it and what it revealed
  hidden (D95 to D98; `bring_pointer_to_lock`). The games in question ask
  for nothing: GLFW and SDL on Wayland lock only when the pointer is in
  their surface, a cursor can only be hidden with the serial of an enter,
  and Xwayland turns an X11 grab, a hidden cursor and a warp into a lock
  only for the window its pointer is in. dashi-comp has no request to act
  on.
- **Why:** the only signals left are guesses (a key pressed in a window that
  once held a lock), and a guess that moves the person's pointer is worse
  than a bar that waits for the mouse.
- **Cost:** the bar or the Dock stays out until the mouse moves, then the
  lock holds. For X11 games there is one true signal not used yet: the X
  server shows the game's hidden cursor the moment it grabs the pointer
  (XFixes `DisplayCursorNotify` on the probe's connection, the image all
  transparent); with the keyboard in an X11 window and the pointer over a
  layer of Dashi's, that would say "bring it back". Not built: unproved,
  and it is a listener of its own.
- **Undo:** nothing to undo.

### D110. An agent's click, scroll and typing reach an on-screen Wayland window without the person's seat

- **Date:** 2026-11-14. The `n18-x11` agent's. Extends D85.
- **Question:** the server tells agents "the person's pointer and focus stay
  where they are", but on the Space that shows every action in an app that
  hears one seat (Dashi's own, Chromium's family) borrowed the person's
  seat after a two-second pause: their pointer jumped and their keyboard
  went to the agent's window.
- **Choice:** with `borrow`, a move, a click, a scroll and keys that are not
  the clipboard's go to an on-screen Wayland window the way D85 sends them
  off screen (`session/agent_direct.rs`): straight to the app, the seat
  untouched, the window neither raised nor focused, the agent's pointer
  drawn. The seat is still borrowed for what only it can do: X11 windows, a
  press held and its release (drags, and an app's own window move), a
  window's lights, copy, cut and paste, and `borrow {idleMs: 0}`. The
  agent now waits for the person's pause in that one window (their own
  press there 2 s old), no longer the whole desktop.
- **Why:** it makes the words true for click, type_text, press_keys and
  scroll, and an agent no longer stalls while the person works in another
  window.
- **Cost:** the app sees its keyboard enter and leave once per request (a
  popup that closes when the keyboard leaves closes between requests); a
  window behind another is clicked where it is, unseen; in the person's own
  app, their pointer or keyboard steps aside for the request once their
  input is 400 ms old (D86). A drag still moves their pointer.
- **Undo:** take the `agent_goes_direct` branch out of `agent_input`
  (`session/agent.rs`).

### D123. The browser policy sets no minimum version for Dashi's extension

- **Date:** 2026-11-14. The `n21` installed pass.
- **Question:** with D117's `minimum_version_required: "0.9.0"` installed,
  Helium stopped with SIGTRAP at every start on a profile that already held
  an older Dashi extension (the VM's 0.5.0 profile, and a profile Helium made
  itself under the 0.8 packages with 0.8.0): no window, a core dump each
  time. D117 was proved only with Helium open while the package changed. A
  new profile was fine. What makes an old profile start and still update?
- **Choice:** the key is taken out; `override_update_url: true` stays.
- **Why:** measured in the VM on copies of the 0.8 profile, one key removed
  at a time: without the minimum version Helium starts and the profile holds
  0.9.0 within 10 s; with it (with or without `override_update_url`) it
  stops at start. Chromium's own updater still does the work.
- **Cost:** the update is no longer forced at the instant of start: an old
  extension may run for the first seconds, and D117's notice ("Helium needs
  a restart") covers a Helium that keeps running it. A busy service worker
  may put the update off until Helium is next opened.
- **Undo:** put the key back in
  `spin/dashi-helium/etc/chromium/policies/managed/dashi.json` and in
  `browser-pinning.test.ts`, once Helium no longer stops on it.

### D124. Keys typed before Calculator's line took a keypad key land after it; the agent's path is left as it is

**Superseded by D129:** mirin's host now types such keys again on the line's text, and the line's kept texts are gone.

- **Date:** 2026-11-14. The `n22` final fixes.
- **Question:** an agent's click on 7 and `type_text "*6="` sent at once
  left 76 on Calculator's display and no sum, three times of five (D110's
  direct path). Where is the fault: the compositor's order, or the app?
- **Choice:** the app. Calculator's line is written by two hands: the
  keypad writes it in the app, the field types in the Metal host. The keys
  reached the field (in order, with their modifiers) before the field had
  taken the "7" the click made, so it reported "\*", "\*6", "\*6=" typed on
  its old, empty text, and the line read those as edits of "7". Now the
  line keeps the texts the field may still hold (its own older texts, up
  to eight: each went out in a tree, and the field takes the trees in turn
  and types between them), reads each report as the smallest edit of any
  of them, and puts it after what the field never had. A caret the field
  reports in the line's own text says it has taken it. The
  compositor's direct path is not changed: it sends a click and then keys
  in order, and it does not wait for an app to show what a click did.
- **Why:** replayed in the reducer with no compositor at all: key 7, then
  the field's "\*", "\*6", "\*6=" gave "76" and no sum, every time. The two
  good runs of five were the ones where the field had already taken the 7.
  One text kept was not enough: four calls 2 ms apart (click 7, "+2", ⇧8,
  "3=") were right 12 times of 30 in the VM, and 59 of 150 seeded
  crossings of reports and trees in the test; with the older texts kept,
  150 of 150 (and 3,000 of 3,000 from another seed, run once).
- **Cost:** a person who clicks a key and, before the field has taken it (a
  round trip, some tens of ms), replaces a selection by typing is read as
  typing after the key. Any other app whose field is written by the app
  and typed in at the same instant has the same race; mirin could say with
  each change which text it was made on (the selection already carries its
  text's hash), and that is the fix for all of them.
- **Undo:** `held` goes back to null when the line changes another way
  (`calculate` in `apps/calculator/lib/state.ts`), and `sameSpot` in
  `lib/field.ts` to counting the same digits.

### D125. A Dashi app's file dialog is a sheet of its window, named by its process

- **Date:** 2026-11-14. The `n22` final fixes.
- **Question:** a click on Preview with its Open panel up put Preview over
  the panel, which looked gone. The compositor keeps a sheet above its
  parent in every path (`focus_window`); the panel was never a sheet.
  Dashi's own apps asked the portal for it with no parent window
  (`file-chooser.ts` sent `""`), so it was an ordinary window beside
  Preview, and the person's click raised Preview as it would over any
  window. An agent's click never did it (its click raises nothing). The
  empty parent is as old as the portal client (in `8dded6d` and before
  0.8), so this is no regression. How does a Metal app say which window is
  its own? It has no xdg-foreign handle: mirin's host exports none.
- **Choice:** the app gives the portal `dashi:PID`, its own process.
  xdg-desktop-portal hands the string on as it is; dashi-portal expects a
  sheet for it as for any parent, and the shell finds the window: one whose
  client is that process or its child (a Metal host), the focused one
  first, and only a window of Dashi's own apps (`dev.dashi.*`), never a
  portal dialog or a sheet. Then the usual `attach`. Also: a window asked
  to the front while its sheet has the keyboard counts as used (the window
  list had another window between the sheet and its parent).
- **Why:** no change to mirin tonight, and no new IPC; the shell already
  ties windows to processes this way for the menus (`ownerPids`).
- **Cost:** a process number can be guessed where an exported handle
  cannot: any program that can call the portal may hang a file dialog of
  its own on a Dashi app's window by naming that app's process. It gains
  nothing by it (the dialog answers to the caller, and shows on screen),
  and it cannot reach other apps' windows. The bar still names the app used
  before the sheet while a sheet has the keyboard ("Calculator" over
  Preview's panel, when Calculator was in front before).
- **Undo:** send `""` again in `src/shared/portal/file-chooser.ts`. The
  right end is mirin's host exporting its window (xdg-foreign v2) and the
  app passing `wayland:HANDLE`; `dashi:` can go then.

### D126. In the agents' panel a row's buttons always sit beside its title

- **Date:** 2026-11-14. The `n22` final fixes. Adds to D114.
- **Question:** D114 left the rows of agents on the Desktop that shows as
  they were: Stop beside both lines. While such an agent saw the screen the
  line was the chip "Seeing the screen · 0:01" and "“dashi-vm-agent”,
  connected over SSH" in what Stop left, and the name was cut
  ("“dashi-vm-agent…", the installed pass's still). The polish round's
  stills were of an agent on another Desktop, the row D114 did change.
- **Choice:** every row is laid out as D114's: Stop (and Show, when there
  is one) beside the title, the line under it the row's whole width. While
  an agent sees or records the screen the chip is followed by its name
  alone, on this Desktop too; "connected over SSH" gives way there.
- **Why:** one layout, and the name is what the person needs beside "Seeing
  the screen". The chip at its longest ("Recording the screen · 12:14") and
  a 14-letter name fit the 300 points the line has.
- **Cost:** while it watches, a remote agent's row no longer says
  "connected over SSH" (its title is "Remote agent"). A much longer name is
  still cut at the row's end.
- **Undo:** `ConnectionRow` and `rowLine` in
  `packages/shell/src/agents-panel/lib/agents-rows.tsx`.

### D127. The Metal host's package fetches its crates as it builds, the git ones too

- **Date:** 2026-11-15. The `n24` move to sumi, mirin's own engine.
- **Question:** on sumi the host's `Cargo.lock` pins seven repositories by
  git commit (wgpu, Zed's forks of async-process, calloop, font-kit,
  khronos-egl and xim-rs, and smol-rs/async-task); the old engine had none.
  Vendor the crates into the tarball so the build needs no network, or go on
  fetching?
- **Choice:** go on fetching. None of Dashi's Rust packages vendors its
  crates: each `cargo build --locked` reaches crates.io, and
  `spin/copr-publish` turns the builders' network on for that. Cargo clones
  the git ones itself, at the commits the lockfile names, with no `git`
  installed (proved in a root holding only the spec's `BuildRequires`).
  The spec loses `clang`, `cmake`, `pkgconfig(openssl)` and
  `pkgconfig(vulkan)`, which the new engine does not build with, names
  `gcc`, and recommends the two libraries of the GL fallback.
- **Why:** one way for all six packages. A vendored tarball of this tree is
  some hundreds of megabytes in every source RPM, and would be the only
  package that differs.
- **Cost:** a build needs the network and seven more hosts' worth of trust
  in GitHub being up; the lockfile's commits are what make it the same
  build. A builder with no network cannot build any of Dashi's Rust
  packages, as before.
- **Undo:** in `spin/build-rpms`, run `cargo vendor --locked` in
  `crates/mirin-metal` of the staged mirin tree and write its
  `.cargo/config.toml` into the tarball; build with `--offline`.

### D128. A picture the host cannot draw is never handed to it

**Superseded by D133:** the host now says when it cannot draw a file, and nothing reads a file's first bytes. Preview's TIFF conversion stays.

- **Date:** 2026-11-15. `n24`. sumi decodes PNG, JPEG, GIF, WebP, BMP and
  ICO and draws SVG; the old engine also read TIFF, TGA and PNM.
- **Question:** the host draws a file it cannot decode as nothing, and says
  nothing to the driver. Where Dashi shows a picture it did not make, what
  stands in?
- **Choice:** the file's first bytes are read before it is handed over
  (`hostDrawsFile`, `packages/shell/src/shared/apps/drawn.ts`; the name is
  believed only for SVG). An app's icon given by path, a notification's
  picture and an applet's or extension's icon fall back to the generic icon
  or their glyph; an account picture to the person's initials (Settings,
  the account portal, the login screen); an icon an app sends as bytes to
  the sheet's glyph. Preview treats TIFF as it treats HEIC: converted by
  ImageMagick (a `Requires` of `dashi`), and "Preview can’t open TIFF
  pictures on this computer." without it. Its strip of the folder's
  pictures hands a file over as it is only when its bytes say the host
  draws it (a TIFF named `.png` gets the empty frame). Files and wallpapers already took only
  formats the host draws.
- **Why:** a blank where a picture should be reads as a bug and gives no
  way on. One rule over bytes covers TIFF and every format the host never
  read (XPM, HEIC, AVIF), which were blanks on the old engine too.
- **Cost:** one `stat` per draw and a 4 KB read per changed file. A TIFF
  wallpaper or account picture is not converted, only refused. The login
  screen has its own five-line copy of the rule (it cannot import the
  shell). Software's screenshots and the applet store's icons are not
  checked: they are downloaded PNG, JPEG or WebP.
- **Undo:** `resolveIcon` in `shared/apps/icons.ts`, `tiff` in
  `shared/files/kinds.ts`, and the five callers of `hostDrawsFile`.

### D129. Calculator's line trusts the host to carry typing onto a key pressed meanwhile

- **Date:** 2026-11-15. The `n28` take-up of mirin Metal (mirin `a41eac5`, PR 33).
- **Question:** D124 kept up to eight of the line's older texts, to read
  what the field typed before it took a keypad key. mirin now does this
  where it belongs: the host types those keys again on the app's text (a
  rebase) and the driver never passes on a change made on a text the app
  has replaced. What is left for Calculator to do?
- **Choice:** D124's kept texts are removed (`sent`, and reading against
  several texts): the reducer is as it was before D124. Three things mirin's
  answer needs from the app, each small:
  1. The host reports the keys it typed again as **one** change ("7", then
     "\*6=" arrives as "7\*6="). Several characters put in at once that
     are all keys are done one by one, as typed ("=" works the sum out);
     anything else is still read as a paste. ❖V is the app's own paste, so
     the field never pastes by itself.
  2. A key the line refuses (a letter, a space) is taken out of the field
     25 ms after the field's last word, not at once. Taking it out is a new
     `valueRevision`, which the host answers with a reset that drops what
     was typed since: an agent's "12 + 3" typed at once lost the "+ 3". The
     wait is longer than the gap between an agent's keys (2 to 5 ms) and
     shorter than a person's.
  3. A caret at the end of the line is not sent as `selection`. The host
     keeps the caret with the keys it typed again, and then put it where
     the tree's `selection` said (the app's caret, made before it knew of
     those keys): the next key landed in front of them ("12", + on the
     keypad, "3\*4-5=" typed gave −5, 39 crossings of 150).
- **Why:** the three were found with a stand-in for the host that does what
  mirin's does (`test/support/host-field.ts`, from `value.rs` and
  `field/rebase.rs`), in the crossings D124's test already ran: 150 of 150
  in both of its cases now.
- **Cost:** on a host without `rebase` (none ships with Dashi: the host is
  built from the same mirin) the D124 race is back: a click on 7 and
  "\*6=" within a round trip gives 76. Return pressed within a round trip
  of a keypad key works out the line without what was typed (a `submit`
  carries the field's text as it was; "=" is not affected). A keypad key
  pressed with the caret inside the line, and keys typed within the same
  round trip, can still land one place early (3 needs mirin: a rebase
  should not take the tree's `selection`).
- **The other fields the app also writes,** and whether a `submit` that
  carries the field's text as it was when Enter was pressed matters there
  (looked at by `n29`; none needed a change):
  - The launcher's field (`launcher/lib/field.tsx`; the app takes a chip
    out of the words, completes on Tab, empties it as it opens). Enter
    runs the row the launcher's own state has chosen and never reads the
    text the `submit` carries; what was typed before Enter comes as
    changes first. Does not matter.
  - The bar's field and the capsule's (`menubar/lib/field-row.tsx`; the
    app writes it with `valueRevision`: history, "Type it instead",
    emptied when sent). Enter sends the state's text. Does not matter.
  - Settings' search (`settings-app/lib/sidebar-search.tsx`; the app
    empties it on Esc). Enter opens what the state found. Does not matter.
  - Files' omnibox (`apps/files/lib/omnibox/omnibox-editor.tsx`). It
    reads the text the `submit` carries, but the app writes the field only
    on Esc, which ends the edit. Does not matter.
  - Rename in place (`shared/file-browser/lib/views/rename-field.tsx`)
    reads the carried text too, and the app never writes the field after
    it opens. Does not matter.
  - Find in Text Editor and Notes: the app never writes the field. Terminal
    has no text field.
  - Calculator's line is the one where it matters (the cost above).
- **Undo:** `fe547913` and `ec811ee3` are D124's two commits.

### D130. The capsule's window opens and hides when asked; it still lingers

- **Date:** 2026-11-15. The `n28` take-up (mirin `a41eac5`, PR 37).
- **Question:** the capsule kept its window open at least 400 ms and waited
  150 ms after a hide before it opened again, because a resident host died
  when hidden as it opened or opened as it hid. mirin says sumi no longer
  does. Which waits go?
- **Choice:** both of those go (`MIN_OPEN_MS`, `REOPEN_MS`). The 350 ms
  linger after the last line (D84) stays: it was never for the fault. It is
  there so one line replaces another in the same window, and a hide and an
  open in between is still a window opened again.
- **Why:** the waits cost a held key its first 150 ms after a tap, and kept
  an empty window over the Dock's place for 400 ms after a chord.
- **Cost:** mirin could not make the old fault fail on its GPU and did not
  test the VM's driver. If a host dies in the VM's rounds, the respawn
  (1.5 s) still brings it back, and the waits return from this entry.
- **Undo:** `MIN_OPEN_MS` and `REOPEN_MS` in `capsule/lib/surface.ts` as in
  `d93574ad`.

### D131. The Metal host is built from `../mirin`'s HEAD until mirin tags a release

- **Date:** 2026-11-15. The `n28` take-up (mirin `a41eac5`, PR 38). The
  lead's decision.
- **Question:** each mirin release will now publish
  `mirin-metal-<version>-source.tar.xz` and its `.sha256`, with the crates
  inside, which builds with `--offline`. No release has been tagged since,
  so there is no tarball. Build one ourselves, or wait?
- **Choice:** wait. `spin/build-rpms` goes on archiving `../mirin`'s HEAD
  and the package goes on fetching its crates (D127). Nothing in the build
  changes now: `forks/sumi/rust-toolchain.toml` is gone from mirin, and
  only the spec's comment spoke of it.
- **When mirin tags a release:** `spin/build-rpms` downloads the release's
  tarball and its `.sha256` and checks one against the other in place of
  `git archive` (the spec's `Source0` and `Version` are the release's, not
  a snapshot's); `%build` runs `cargo build --release --locked --offline`;
  the builders need no network for this package, so D127's cost goes for
  it; `spin/license-dependencies` reads the tarball's lockfile.
  `@mirinjs/metal`'s TypeScript must come from the same tag.
- **Cost:** until then a build needs the network, as D127 says.
- **Undo:** nothing to undo.

### D132. Dashi's text is subpixel (superseded by D142)

- **Superseded 2026-11-15 by D142.** The heading and "The owner's decision" below were wrong: the owner's decision is grayscale as the supported default, subpixel as an opt-in. What follows is kept as the record of what was built and measured.

- **Date:** 2026-11-15. The `n28` take-up (mirin PR 36). The owner's
  decision.
- **Question:** mirin's hosts now draw grayscale text on Linux unless
  asked (it carries no colour fringes to a rotated or another screen, and
  an idle host is about 1 MB smaller). Which does Dashi ship?
- **Choice:** subpixel, in every host: the shell's, every app's, the
  greeter's, `dashi-dialog`, the portal's, applets'. Until mirin's PR 36 is
  on `main`, `session/dashi-session` and `session/dashi-greeter` set
  `MIRIN_METAL_TEXT=subpixel` (a value already set wins), which every host
  of the session inherits. PR 36 is on `main` now (`db8a00e`), so every
  place Dashi spawns a host gives mirin's
  `NativeHostOptions.textAntialiasing` (`hostTextAntialiasing()`,
  `@dashi/ui`: the shell's `shellHostOptions`, which the portal, the
  launcher and the warm hosts go through; the kit's `runApp`, so every app
  and `dashi-dialog`; the greeter; the applet SDK's two). The greeter's
  script no longer sets the variable. `session/dashi-session` still does,
  for a Metal program in the session that is not Dashi's; and a value
  someone set there (`MIRIN_METAL_TEXT=grayscale`, to measure) is still
  taken by Dashi's hosts, since the option would otherwise hide it.
  A window that is not opaque (a layer surface: the bar, the Dock, the
  launcher, the capsule, banners, the login screen) draws grays whatever
  is asked: mirin's rule, since subpixel text needs to know what is behind it.
- **Left:** the setting (`appearance.textSmoothing`, "subpixel" or
  "grayscale", a row in Settings › Appearance, known to agents). It is not
  a small change: mirin applies a change per host (`setTextAntialiasing`
  on each transport), and Dashi's hosts belong to many processes (the
  shell's bar, Dock, launcher, capsule, sheets and warm hosts; every app;
  the portal; `dashi-dialog`; each applet). Each would watch the settings
  file and keep a list of its live transports, at eight spawn sites. What
  it needs: one `spawnHost` that every site goes through (the shell's
  `spawnShellHost`, the kit's `runApp`, the applet SDK's two), which sets
  `textAntialiasing` from the setting and keeps the transport for a later
  `setTextAntialiasing`. The greeter has no person yet and stays subpixel.
- **Cost:** 0.7 MB more per idle host than grayscale (measured on the
  installed build: six shell hosts 165.4 MB RSS and 56.6 MB PSS in
  subpixel, 161.2 and 52.3 in grays; a cold app's first window is no
  slower), and fringes of
  the wrong order on a rotated screen.
- **Undo:** `hostTextAntialiasing` and the `export` line.

### D133. A picture the host cannot draw says so, and what stands in is drawn then

- **Date:** 2026-11-15. The `n28` take-up (mirin `36ea764`, PR 35).
- **Question:** D128 read a file's first bytes before handing it to the
  host, because the host drew a file it could not decode as nothing and
  said nothing. Now an `<Image>` has `onError`. Keep the reading?
- **Choice:** no. `Picture` (`@dashi/ui`) is an `<Image>` with a
  `fallback`, shown when the host says it cannot draw the source; `AppIcon`
  (`shared/apps`) is a `Picture` whose fallback is the generic icon.
  Every place D128 touched uses one: an app's icon wherever it is drawn
  (the Dock, the taskbar, the switcher, Force Quit, the launcher's rows and
  chip, notifications, the polkit sheet, Open With, the app chooser, the
  sound and clipboard rows, Activity Monitor), an account picture (the
  login screen, Settings, the account portal: the initials), an applet's
  icon in the bar (its first letter), a launcher the portal is asked to
  add (the empty tile), Preview's strip (the empty frame).
  `shared/apps/drawn.ts` and the greeter's copy of it are gone. Preview's
  TIFF conversion stays: it is a conversion, not a check.
- **Why:** the host knows what it decodes; a second list of formats in
  Dashi was one more thing to keep true (and two, with the greeter's).
- **Cost:** the host tries first, so the place is empty for a frame before
  the fallback shows. An extension's row with a picture the host cannot
  draw now gets the generic icon, not the puzzle piece. A path that failed
  stays failed for the host's life (mirin): an account picture replaced by
  a good one under the same path (AccountsService always writes
  `/var/lib/AccountsService/icons/<name>`) shows the initials until the
  window is reopened (Settings, the portal) or the session restarts (the
  lock screen). On a host that does not say (none ships with Dashi) a bad
  file is a blank, as before D128.
- **Undo:** `git revert` of this commit brings `drawn.ts` and its callers
  back.

### D134. Files still asks its window where the items are; Calendar scrolls its hours by their handle (Files: superseded by D143)

- **Date:** 2026-11-15. The `n28` take-up, finished by `n29` (mirin
  `5703b91`, PR 34).
- **Question:** D100 and D113 ask the window where the items are painted
  (every 150 ms during a drag, once or twice per key) and scroll through
  the simulation channel, because Metal said nothing of a scroll view. Now
  a view that scrolls has `onScroll`, and its `ref` is a `ViewHandle`
  (`scrollTo`, `scrollIntoView`). Move Files' marquee and the keyboard's
  reveal onto them?
- **Choice:** not yet. It was built (`fd03ff15`: a `ScrollPlace` fed by the
  listing's `onLayout`, `onScroll` and `ref`) and taken back after the VM:
  on a long list, which both of Files' views are (mirin lays out only the
  rows near the view), the host's offset is wrong once rows have changed.
  A row whose props change is taken out of the list's measures and counted
  as nothing until it is laid out again, and a list that reports its
  offset is counted whole only once. Seen with 89 rows of 26: wheeled to
  1200, then Select All, the list says it is at 0; and a marquee held at
  the bottom edge, which changes the selected rows on every step, was sent
  to 98 and landed on 722, then the end, then 78, and selected 48 rows of
  the 86 under it. The same happens with the simulation channel's scroll
  once the list has `onScroll`. Without `onScroll` the list is as it was,
  and D100's way selects the 86. So Files, the sheets and `dashi-dialog`
  keep D100 and D113 as they were.
  **Calendar is moved:** its hours are a plain scroll view, and
  `scrollTo` on their `ref` puts them at an offset (no longer "to the
  top, then down" through `main.tsx`, whose `scroll` prop is gone). The
  first one, as the view opens, still waits 80 ms: asked in the turn the
  view is mounted it is lost, and the hours stayed at midnight in the VM.
- **When mirin counts a changed list again** (`list.rs`:
  `invalidate_changed` splices rows in with no height; `estimate_rows`
  runs once per width): bring `fd03ff15` back. It is written and tested.
- **Cost:** the 150 ms look stays during a drag. On a host that says no
  `scroll` (none ships with Dashi) Calendar's hours open at midnight.
  Still through the simulation channel as well: Notes' and Text Editor's
  scroll to the caret (`apps/notes/main.tsx`, `apps/editor/main.tsx`) and
  Settings' scroll to a searched row (`src/overlay.tsx`).
- **Undo:** Calendar: `git revert` of this entry's first commit, less the
  files under `shared/file-browser`.

### D135. A file drag to or from an X11 app is not carried yet; a link dropped on Files is refused

- **Date:** 2026-11-15. The `n28` take-up, finished by `n29` (mirin PR 40).
- **Question:** mirin found a Metal file drag right between Wayland apps
  and lost when the other side is an X11 app under Xwayland, and said that
  path is the compositor's. Build the bridge now? And what does Files do
  with a link dropped on it?
- **What was seen** (the VM, real pointer): a file dragged from Files onto
  Helium's upload page is taken when Helium is a Wayland app (the page got
  the file's name and size) and not at all when Helium runs with
  `--ozone-platform=x11` (no `dragover`). A link dragged from Firefox onto
  Files' listing brought nothing, with Firefox on Wayland or on X11.
  Dashi starts Helium with `--ozone-platform=wayland` and Firefox with
  `MOZ_ENABLE_WAYLAND=1`, in the VM and on the laptop, so both are Wayland
  apps as shipped.
- **Choice:** not built in 0.9. `dashi-comp` wires smithay's Xwayland
  selections (the clipboard and the primary selection, both ways:
  `xwayland/selection.rs`) and nothing for drags, because smithay 0.7.0,
  the newest release, has no XDND: no `XdndAware` window, no
  `XdndEnter`/`Position`/`Drop`, in either direction. The bridge is
  Dashi's to write on its second X connection (`xwayland/wm.rs`): a proxy
  window that owns `XdndSelection` for a Wayland drag over an X11 window
  and speaks XDND to it, reading the Wayland source through the data
  device; and the other way, a `wl_data_source` made by the compositor for
  an X11 `XdndSelection` owner. Several days with its headless tests, and
  a fault in it breaks every drag, so it is its own piece of work.
- **A link dropped on Files:** refused, as mirin's host does (the pointer
  shows no drop). A file manager's other answer, a `.desktop` link file in
  the folder, needs the host to hand over a drag with no file in it, which
  it does not; asked of mirin only if someone wants it.
- **Cost:** an app that is X11 only (some games' launchers, old toolkits)
  neither takes a file dragged from Files nor gives one to it. Open and
  Save sheets, the clipboard and paste work there.
- **Undo:** nothing to undo.

### D136. An agent that only connected is not in the bar; it shows from its first call and goes quiet five minutes after its last

- **Date:** 2026-11-15. The `n31` agent's, on the lead's brief.
- **Question:** the owner has Dashi's MCP server in Claude Code's user
  configuration, so every chat and every delegated sub-agent on the laptop
  connects, dozens a day, and almost none calls a tool. Each one was in the
  menu bar and the agents' panel. "why always claude autoconnects to dashi
  mcp, is annoying, also now appears as duplicated". What shows, and when?
- **Choice:** a connection is not an action. A connection is *quiet*, in
  no menu bar, with no row in the panel and not in the launcher's Now,
  until it calls a tool (`lib/session/session-quiet.ts`,
  `AgentInfo.quiet`). `initialize`, `ping`, `tools/list` and a method Dashi
  does not speak are not calls. **Every `tools/call` counts, a read too**
  (`list_windows`, `screenshot`, `get_work_alone`): it looks at the
  person's computer, or at what Dashi lets agents do. It goes quiet again
  **five minutes** after its last call ended, connected or not, and comes
  back with the next. While it holds something it stays, however long ago
  it called: a call running (a recording is one), a sheet waiting on the
  person, the screen seen or recorded, a Desktop of its own
  (`work_in_space`), and Work alone for an agent that has called at least
  once. A launcher run's own connection is its run's, as before.
- **Why five minutes:** an agent at work thinks between calls for a minute
  or two at most, so it does not come and go in the bar; a chat that is
  over is gone before the person wonders what it still does. The wait is
  read once per connection (`DASHI_AGENTS_QUIET_MS` shortens it for a
  proof; under 100 ms is ignored).
- **Cost:** an agent that could act any second (it holds grants) is out of
  sight while it does not. Its first call shows it at once, and what it
  was allowed is in Settings › Agents, which lists every connection as
  "Connected now", quiet or not: nothing is hidden from someone who looks.
- **Undo:** `SessionQuiet.quiet` returning `false` shows every connection
  again.

### D137. One row per agent: the sessions of one program are one, with a count

- **Date:** 2026-11-15. The `n31` agent's.
- **Question:** two Claude Code chats were two rows named the same. What
  makes two connections one agent, what does the row say, and what does
  Stop do?
- **Choice:** connections with the same grants' key (the executable, and
  the script for an interpreter; `ssh:<name>` for a remote one), the same
  name they claim, the same process name and the same run are one row
  (`agents/lib/agent-groups.ts`): "claude · 3 sessions" from two sessions
  in sight. Its line is the session's that waits on the person, else one
  at work, else the one that called last; the red dot shows if any of them
  watches. **The parent application is not part of it:** Claude Code under
  T3 Code and Claude Code in a terminal are one row. It cannot be told
  reliably (some terminals give each tab a scope of its own, which would
  bring the duplicates back), and the person already answered for them as
  one: their grants share a key. **Stop cuts off the sessions in sight**,
  all of them; a quiet session of the same program is left alone (it did
  nothing, and cutting thirty idle chats off Dashi to stop one is not
  what the button says). **No Stop for one session alone:** the sessions
  of one program have nothing the person could tell them apart by, so a
  disclosure would be a list of the same line. "Stop all" and ⌃❖Esc still
  cut every connection, quiet ones too. **Quiet connections are one line**
  above the panel's foot, "5 more connected, idle" ("5 connected, idle"
  with no rows), so the panel says they exist without a row each.
- **Cost:** two different jobs done by two chats of one program read as
  one row with one line. Stopping one of them means stopping both.
- **Undo:** `groupKey` returning the connection's id gives a row each.

### D138. The menu bar has one sign for agents from outside: the mark, with a count. Never a capsule each

- **Date:** 2026-11-15. The owner's rule, given to the lead while `n31`
  ran: "im seeing five indicators, is awful, and spammy, why not just one".
- **Question:** 0.9's bar made every connected agent a job capsule beside
  the mark (D69's jobs: `agentJobs` took every entry of `mergeAgents`), so
  five chats were five discs.
- **Choice:** a hard rule. The bar never shows more than one indicator
  for connected agents, whatever their number or kind. A job capsule is a
  task Dashi's assistant runs or a run started from the launcher; an agent
  connected from outside is never one, and neither are its calls
  (`menubar/lib/bar-jobs.ts` `agentJobs` keeps runs only). Outside agents
  show through Dashi's mark (`agent-mark.tsx`): while one is in sight the
  first one's glyph stands beside the spark, and from two sessions how
  many (`agents/mark.ts` `outsideAgents`). A click on that part opens the
  agents' panel, where the rows are (D137); the spark still opens the
  field. Several things that need the person at once (two consents) are
  still the one mark, amber, with the count (`needCount` adds the outside
  sessions whose sheet is up).
- **Cost:** what an outside agent is doing is no longer in words in the
  bar: it is the mark's tooltip and the panel's row. The keyboard reaches
  the field from the mark, not the panel, when no job capsule is up.
- **Undo:** none wanted: it is the owner's rule.

### D139. A connection that never called a tool is not in the activity log

- **Date:** 2026-11-15. The `n31` agent's.
- **Question:** the laptop's `activity.jsonl` was line after line of
  `"tool":null,"outcome":"disconnected"`, hiding the real lines. Drop
  them, or count them in one line?
- **Choice:** dropped. A connection's end ("disconnected", "stopped") is
  written only if it called a tool at least once (`session.ts`). Nothing
  is counted in their place: a count of nothing done is still noise.
- **Why:** the log is what agents did. The history reads an end line only
  to close a session that has calls (`ask/history.ts`); an idle chat's end
  line could close another chat's session of the same program early,
  which this also stops.
- **Cost:** the log no longer shows that something connected and did
  nothing. Consent, grants and Work alone are untouched.
- **Undo:** log the end line whatever `called` says.

### D140. `dashi-mcp` connects to the shell at the first tool call

- **Date:** 2026-11-15. The `n31` agent's.
- **Question:** can the bridge answer `initialize` and `tools/list` by
  itself, so an idle chat costs the shell nothing? Does the tool list
  depend on the session?
- **What was found:** for the agents' server it does not. `tools/list` is
  `catalog()` and `initialize` is `INSTRUCTIONS` and a version: one table
  (`tools/registry.ts`), the same for every agent whatever it was allowed
  or has installed; grants are checked at each call. **But the bridge also
  serves another server:** plan mode's (`ask/harness/lib/plan-server.ts`,
  reached with `DASHI_MCP_SOCKET`), whose tools and words are its own (30
  tools, not 87).
- **Choice:** when the socket is the agents' own (its file is named
  `dashi-mcp.sock`: the session's, and the tasks' in `dashi-mcp.d/`), the
  bridge answers `initialize`, `ping`, `tools/list` and "method not found"
  itself, from the same code the session uses (`agents/mcp-local.ts`), and
  connects at the first `tools/call`, saying the client's `initialize`
  again first, its answer kept from the client (`mcp-relay.ts`, as after a
  shell restart). From then on every line is the shell's. For any other
  socket it connects at once and answers nothing itself. With no socket
  file at all it still fails to start, as before; a socket nobody answers
  at the first call fails that call with why, and the next call tries
  again.
- **Cost:** the bridge loads the tool table (about 60 ms). A bridge from
  one version of Dashi beside a shell of another could list a tool the
  shell does not have; the call is then refused as unknown. Both are
  installed from one package.
- **Undo:** `OWN_SERVER = false` in `bin/dashi-mcp.ts`.

### D141. The Dock's slide is slow because the engine holds a surface without the keyboard to 30 frames a second; Dashi does not pretend the Dock is the active window

- **Date:** 2026-11-15. `n32`, the owner's "dock sliding from bottom edge
  is laggy", on the laptop, since the install on sumi.
- **What was measured** (the laptop's AMD GPU, a nested `dashi-comp` in a
  1200 × 300 window at scale 1.75, the real `startDock` driven by
  `packages/shell/bench/dock-slide.tsx`, 20 entrances each, medians): the
  Dock sends a patch every 16 ms on every host. The host Dashi 0.9 installs
  (mirin `5703b91`, sumi) draws 18 frames for an entrance's 47 patches, one
  every 48 ms; the host before it (`ba4612d`, gpui 0.2.2) drew 49, one
  every 16 ms. Subpixel or grayscale text makes no difference (18 and 18).
  Opening the surface is not it: the first frame is 162 ms after the
  pointer reaches the edge on the new host and 167 ms on the old, 120 ms
  of which is the wait at the edge (`AUTOHIDE.revealMs`).
- **Cause:** sumi draws a window that is not the active one at most every
  33.3 ms (`WindowOptions::inactive_frame_interval`), and a layer surface
  that takes no keyboard is never active. A frame put off is tried again
  on a 16.67 ms timer, so with a patch every 16 ms it is the third that is
  drawn. The same host given `inactive_frame_interval: None` for desktop
  surfaces (eight lines in mirin's `crates/mirin-metal/src/surface.rs`)
  draws 49 frames, one every 16 ms.
- **Question:** it is mirin's to fix, and mirin's `main` is not this
  branch's to change. Does Dashi work around it meanwhile? It could: a
  host takes `{"sim":{"kind":"window","action":"activate"}}` and then
  counts its window as the active one.
- **Choice:** no. That line is a check's tool; it tells a screen reader
  that the Dock became the active window at every entrance, while the
  keyboard stays in the app. The Dock's code is unchanged: its motion was
  never the fault. The finding, the numbers, the patch and the smallest
  program that shows it are in
  `dashi-0.9.0-review/19-dock-lag/README.md`, "For mirin"; packages built
  with a host that has the patch are what the owner tries.
- **What else it holds back:** everything a surface without the keyboard
  animates: the capsule's dots, a banner, the menu bar's capsules, the
  taskbar. A surface that holds the keyboard (the launcher, a menu,
  Control Center) is active and is not held back; the launcher's entrance
  is the compositor's (`layer-motion`). The same engine holds every
  window, active or not, to 30 frames a second while the power profile is
  `power-saver`: for mirin to decide with Dashi.
- **Kept for later:** the Dock still starts a host for every entrance. On
  a quiet machine that costs about 45 ms; with every core busy it took
  250 to 500 ms on either engine, and past 500 ms the slide starts before
  anything is on screen (`armEntrance`'s wait). A host kept for the
  session, as the capsule and the launcher have, would end that.
- **Cost:** until the host has mirin's fix the Dock slides at about 21
  frames a second.
- **Undo:** nothing to undo.

### D142. Dashi's text is in grays; subpixel is an opt-in

- **Date:** 2026-11-15. The owner's decision, which corrects D132.
- **Question:** D132 recorded "the owner chose subpixel" and made every
  Dashi host ask for it at spawn. The owner's decision is the other way:
  grayscale is Dashi's supported default and subpixel is an opt-in.
- **Choice:** no host is spawned with `textAntialiasing: "subpixel"` by
  default. `hostTextAntialiasing()` (`@dashi/ui`) gives "grayscale" unless
  the session's environment says `MIRIN_METAL_TEXT=subpixel`, and every
  place that spawns a host still goes through it, so the opt-in is applied
  at spawn and never by a switch after a window is open.
  `session/dashi-session` no longer sets the variable. An opted-in host
  draws subpixel text in windows, and on a layer or lock surface only where
  the surface is declared opaque (mirin PR 47); Dashi declares none opaque
  yet, so with the opt-in its bar, Dock, launcher, banners, capsule and
  login screen stay in grays.
- **Why:** grays carry no colour fringes to a rotated or another screen,
  look the same on windows and on the shell's surfaces, and are what the
  design was drawn on; an idle host is 0.7 MB smaller (D132's measure).
- **Left:** the opt-in as a setting (`appearance.textSmoothing`, with a row
  in Settings › Appearance), which D132 says what it needs; and declaring
  the opaque surfaces (the login screen, the lock) so an opted-in session
  has subpixel there too.
- **Undo:** the default in `hostTextAntialiasing`.

### D143. Files' marquee and the keyboard's item go by what the scroll view says

- **Date:** 2026-11-15. `n34`, Dashi on mirin `50241ea`. Supersedes D134 for
  Files (and D100 and D113, which D134 had kept).
- **Question:** D134 took Files back to asking its window where the items
  are painted, every 150 ms during a drag, because a long list's offset
  from the host was wrong once its rows changed. mirin fixed that (PR 42:
  a row that changes keeps its height). Bring the version on mirin's API
  back?
- **Choice:** yes: `fd03ff15` is back as it was written (the revert of
  `3326c307`). A `ScrollPlace` (`shared/file-browser/lib/marquee/place.ts`)
  is fed by the listing's scroll view: `onLayout` says where it is,
  `onScroll` how far its content has gone under it, whoever scrolled it,
  and its `ref` (`ViewHandle.scrollTo`) scrolls it at an edge and for the
  keyboard's item. The 150 ms asking through the simulation channel and
  `locate.ts` are gone, in Files, the open and save sheets and
  `dashi-dialog` (one listing). The keyboard's item is shown by a sum and
  `scrollTo`, not by `scrollIntoView` on its node: both views are long
  lists, and a row far away has no node to name until it is laid out.
- **Left on the simulation channel:** Notes' and Text Editor's scroll to
  the caret and Settings' scroll to a searched row. They are relative
  ("this much further down", "from the top, then down") and are asked
  from outside the view that scrolls; on the handle each needs the view's
  `ref` passed out and its offset kept from `onScroll`. Not the same small
  change, so not made here. Nothing is wrong with them on this host.
- **Cost:** on a host that says no `scroll` in its `protocol` line (none
  ships with Dashi: `mirin-metal-host` is built from the same mirin)
  nothing is dragged out and the keyboard's item is not scrolled to.
- **Undo:** `git revert` of this entry's commit.

### D144. Calendar's hours scroll as they are mounted; Calculator takes a refused key out at once and says its caret wherever it is

- **Date:** 2026-11-15. `n34`, Dashi on mirin `50241ea`. Supersedes
  D134's 80 ms wait and D129's points 2 and 3.
- **Question:** three things Dashi did around faults mirin has fixed.
  Calendar waited 80 ms before its hours' first scroll (asked as the view
  was mounted, it was lost: PR 43 keeps it). Calculator waited 25 ms
  before it took a refused key out of its field (a new `valueRevision`
  reset the field and dropped the keys typed since: PR 46 carries them),
  and did not send `selection` for a caret at the line's end (a rebase put
  the caret where the tree said, in front of the keys it had typed again:
  PR 45 keeps the rebase's own caret and drops a selection made in a text
  the field no longer holds). Keep any of the three?
- **Choice:** none.
  1. Calendar asks `scrollTo` in the effect of the commit that mounts the
     hours. No timer.
  2. Calculator bumps the field's `valueRevision` in the same step that
     refuses a key. The host types what came after it again on the line's
     text and reports it as one change; that change, the first after a
     refusal, is read key by key even when a key among them is refused too
     ("1a2b3" typed at once: the host says "2b3" in one edit, and the line
     takes 2 and 3). Any other edit of several characters is still a paste
     unless every character is a key.
  3. Calculator sends the line's `selection` always. It is the plainer
     code (no "is the caret at the end" in the view), and on this host a
     selection taken from the tree is not reported back (PR 48), so a
     keypad key costs one event less than leaving the field to say where
     its reset put the caret.
- **Why:** checked with the stand-in for the host's field, made to do what
  the host does at `50241ea` (`test/support/host-field.ts`: a revision is a
  write that carries typing, a rebase keeps its caret, a selection made in
  another text is dropped, one taken as said is not reported): D124's
  crossings 150 of 150 in both cases, and refused keys among typing with
  the field's reports and the app's trees crossing in any order, 150 of
  150 in two cases.
- **Cost:** on a host without `revisionRebase` or `selectionHash` (none
  ships with Dashi) D129's two faults are back: an agent's "12 + 3" loses
  "+ 3", and a key typed across a keypad key can land a place early. Two
  pastes the line refuses, made by the field itself one right after the
  other, would have the second read key by key ("c" clears): ❖V is the
  app's own paste and never goes through the field, so it takes an input
  method or a drop of text to do it.
- **Undo:** `git revert` of this entry's two commits (Calendar; Calculator).

### D145. No surface of Dashi's is declared opaque: the login screen and the lock show the wallpaper

- **Date:** 2026-11-15. `n34`, Dashi on mirin `50241ea` (PR 47:
  `opaque` on a layer or lock surface).
- **Question:** a layer or lock surface that says `opaque: true` is opened
  with no alpha, and an opted-in host (D142) draws subpixel text on it.
  D142 left "declare the login screen and the lock opaque". Which of
  Dashi's surfaces are opaque?
- **Choice:** none, so none is declared. Looked at, not assumed:
  - The login screen and the lock paint `LOGIN_GROUND`, true black at 72%
    (`#…b8`, `@dashi/ui` `login-screen.tsx`), over the wallpaper the
    compositor draws behind: the design's rule ("the wallpaper darkened
    to 72% black", design.html). Opened opaque, what the tree leaves
    see-through is over black: the wallpaper would be gone from both.
  - The menu bar (`menuBar`, alpha `c7` in Light, `e6` in Dark) and the
    Dock (`99`, `cc`) are glass over the wallpaper; the Dock is rounded.
  - The launcher (`f5`), menus (`f7`), banners, sheets, the capsule and
    the switcher are rounded panels with a shadow over whatever is under.
- **Why:** taking the wallpaper off the login screen and the lock is a
  change in what a person sees, for an opt-in few will set. It is the
  owner's to make.
- **Cost:** in a session opted in to subpixel (D142), windows are
  subpixel and every surface of the shell, the login screen and the lock
  included, stays in grays.
- **To have subpixel there:** the surface must hold what is behind its
  text: the greeter and the lock would draw the wallpaper themselves (an
  `<Image>` under the ground) and then say `opaque`, asked only of a host
  that names `MIRIN_METAL_OPAQUE_SURFACE` (one from before refuses the
  surface, and a login screen that does not open locks the person out).
- **Undo:** nothing to undo.

### D146. Dashi's speech is never cut: every sentence is handed to `speak`, and each utterance is counted in the log

- **Date:** 2026-11-15. `v09/loop` (the assistant's rebuild, brief b1).
- **Question:** half of a day's spoken answers stopped in the middle of a
  sentence. The words were cut to 140 characters for a launcher row
  (`agents/ask/plan.ts` `spokenWords`) and that cut line was what was
  spoken. What is spoken, and what else stops speech early?
- **Choice:**
  - A task keeps all the model said (`words`, `wholeWords`: every
    paragraph, uncut, without its tools' chatter). Speech and the card
    that reads an answer use it. The launcher's row keeps its one line.
  - The shell cuts the words into sentences and hands each to `speak`
    queued (`voice/lib/saying.ts`). An utterance is over when the last has
    played. One line each in the session's log: asked, handed, played, why
    it ended.
  - A yes on a card lets Dashi finish its sentence; a no, or a card that
    goes, stops it.
  - A dictation that starts while Dashi speaks pauses it: the sentences
    not played to their end are said after the dictation, and the capsule
    says "Paused while you dictate." The service still stops the sound
    when the microphone opens; the shell says the rest again.
- **Why:** the cut was a launcher's measure used for speech. The other two
  dropped the part of an answer that says what Dashi could not do.
- **Cost:** a sentence interrupted by a dictation is said again from its
  start. One `speak` a sentence opens the speakers once a sentence; the
  pause between sentences is the service's (about half a second).
- **Undo:** hand the whole text in one `speak` again (`Saying.add`); the
  log line then counts pieces, not sentences.

### D147. One conversation while it is open: two minutes after Dashi's last word, and nothing guesses a new subject

- **Date:** 2026-11-15. `v09/loop`.
- **Question:** every spoken ask was a new conversation ("Each request
  starts fresh for me"). When does one end, and who decides that a
  sentence is a follow-up?
- **Choice:** one conversation at a time (`agents/assistant/conversation.ts`).
  It is open from the first thing said until two minutes after Dashi's
  last word with nothing said back (the lead's number; the diagnosis said
  90 s), or until the person ends it: "that's all", "new topic", "forget
  that" and their Spanish as the whole of what was said, ❖Esc, the lock.
  While it is open every ask continues it: a harness is resumed by its
  session, a model the shell drives gets the messages. No rule guesses a
  change of subject; the model is good at that and a wrong guess by rule
  loses the thread. The capsule shows it: one quiet line, "Still with
  you", with Done. The exchanges go, in words, to
  `~/.local/state/dashi/agents/conversations.jsonl`.
- **Why:** the owner tested exactly this and was told no each time.
- **Cost:** two minutes of a longer context after an unrelated second
  question. The square in the capsule stops what is said and keeps the
  conversation; only ❖Esc and Done end it.
- **Undo:** `TALK_OPEN_MS`; or have `begin()` always start a new one.

### D148. Spoken asks run on the full server in a loop, two ways; the person's voice is the consent, with the registry's exceptions (its consent table, the first-use sheet and the spoken yes: superseded by D260)

- **Date:** 2026-11-15. `v09/loop`. The owner: "It should have the same
  level of access, even if it is running in the sandbox… use the same tools
  as Claude can with the system MCP."
- **Question:** the voice path planned with 30 tools and ran nothing
  until a yes. How does it get the 87, and what replaces the card?
- **Choice:**
  - **Way one:** the harness the person set up, in the sandbox with the
    task profile as a launcher run has, on the full server's socket. Its
    prompt is Dashi's own (`--system-prompt`, not appended to a coding
    agent's), `--effort low`, `--include-partial-messages`, `--resume` on
    every ask after a conversation's first. One process an ask (0.3 s to
    start, measured in the diagnosis); no process is kept alive.
  - **Way two:** with a key (Claude) or Ollama, the shell runs the loop
    over a session of the same server with no socket. Its tools are not
    strict (all are offered; the server checks every call). A local model
    is offered a core of ten tools and the ones the words name.
  - **GPT keeps plan mode**: its loop is not built.
  - **Consent** is the diagnosis's table. One first-use sheet, then every
    scope is granted to the assistant's connections. `destructive` tools
    with no sheet of their own wait for a yes or no on the capsule's card,
    by voice or typed, and a yes is heard at the start of what was said.
    The ones that ask every time, sign-in and payments are untouched. A
    site new to the conversation is used and said in the capsule's line.
  - **Limits:** 25 calls and two minutes of the ask's own time; the time
    a call waits on the person is not counted.
  - **Plan mode is no longer the default for voice.** It stays for typed
    asks and as "Ask before every step" in Settings › Voice.
- **Why:** the sandbox was never the limit: Dashi's tools run in the
  shell. Only the socket and the policy differed from a launcher run.
- **Cost:** a page can now put words in front of a model that can act on
  them. The guard is the rows that still ask (logins, payments, the Trash,
  installs, the clipboard) and the cap, not a card. The assistant shows in
  the agents' panel as "Dashi" while it works, and Stop there stops it.
  A second sheet can still appear when the person unticked a kind on the
  first-use sheet.
- **Undo:** turn "Ask before every step" on; or make `wayOf` return
  `plan`.

### D149. What is in front goes with every ask, after the words

- **Date:** 2026-11-15. `v09/loop`.
- **Question:** a spoken ask carried the words and one sentence. What
  does the model need of the moment, and where does it go?
- **Choice:** one block after the words in the user turn
  (`agents/assistant/context.ts`), read when the microphone opens: the
  window in front and its title, in Helium the page's address, the
  selection, the time, the Desktop that shows, and the line that the words
  are a transcript and names may be misheard, with the names the person
  uses. The installed apps go once a conversation, not with every ask.
  After the words, never in the system prompt, so the prompt stays the
  same and cached.
- **Why:** "helium", "you tube", "body tech" resolve from the list of
  apps and names without a correcting model.
- **Cost:** the title and address of what is in front, and the selection,
  go to the model the person chose with every spoken ask. The first-use
  sheet is where that is said.
- **Undo:** `contextBlock` returns only the transcript line.

### D150. After Dashi speaks, the microphone opens for the reply: after its last sample, never over it

- **Date:** 2026-11-15. `v09/loop`.
- **Question:** a conversation where the key must be held for every
  reply is not one. There is no echo cancelling: what keeps Dashi from
  hearing itself?
- **Choice:** the simple way (the diagnosis's 9.6 a). When the
  conversation is open and Dashi's last sentence has played, 300 ms later
  the microphone opens until the person goes quiet; with nothing said for
  6 s it closes without a word. After a question (`ask_person`, a spoken
  yes or no) it always opens. It never opens while a sentence still plays
  or waits. A setting, Settings › Voice › "Listen again after Dashi
  speaks", on by default, turns the first kind off. The key and ❖Esc
  interrupt as before; a key held while a listen that opened by itself has
  heard nothing takes its place.
- **Why:** it needs nothing from the service, and it cannot loop on
  itself.
- **Cost:** no talking over Dashi by voice. A room's own sound in those
  six seconds can be taken for a reply.
- **Undo:** the setting; or `Mic.again` does nothing.

### D151. "What I know about you" is a plain file; Dashi writes a line only when told "remember that…"

- **Date:** 2026-11-15. `v09/loop`.
- **Question:** Dashi remembered nothing of the person across
  conversations, and guessed a name from the harness's own account. Where
  does what it knows live, and who writes it?
- **Choice:** one text file, `~/.config/dashi/about-you.md`
  (`persona/lib/about.ts`). Settings › Your Dashi has a row, "What Dashi
  knows about you", that says how many lines it holds and opens it in the
  editor: the person reads and changes every word. Its text (2000
  characters at most) goes with the first ask of each conversation, in the
  block after the words (D149). Dashi adds a line only when the person
  says "remember that…" ("recuerda que…") about themselves: their own
  words, by rule, with no model asked, answered "I'll remember that."
  "Remember to buy milk" and "can you remember…?" are not this.
- **Why:** a file is the one form of memory a person can audit whole.
- **Cost:** the model never offers to remember something (the brief's "or
  agrees" half is not built: it needs a tool and a card). A transcript's
  mishearing is written as heard, for the person to fix in the file.
- **Undo:** delete the file; `remember` left out of the assistant's
  options turns the rule off.


### D160. Each sentence is said by a voice of its own language, told from its words

- **Date:** 2026-11-15. `v09/tongue`, the owner's ask: "the Spanish ones
  with a Spanish voice … because it only uses one single voice".
- **Question:** Kokoro reads by the rules of its voice's language, so
  `af_heart` said Spanish with American sounds. Who decides a sentence's
  language, and how?
- **Choice:** the service, a sentence at a time (`crates/dashi-voice/src/tongue/`):
  the common words of each language, its letters (ñ ¿ ¡ ã ì, Devanagari)
  and a few shapes; a capital inside a sentence is a name and tells
  nothing; a sentence with too little evidence keeps the language before
  it, and the first keeps the conversation's (`hint`). `speak` may name
  the language of all of it (`language`) or of each stretch (`parts`), and
  then nothing is told. On by default; `by_language: false` (Settings'
  switch off) is the one voice as before.
- **Why:** no model, nothing fetched, a few microseconds, and exact enough
  for whole sentences in the two languages the owner speaks (83 sentences
  in the tests, his dictated kind included). Marking the language in the
  answer would put markup in every answerer's words; a language-ID model
  is a download and a licence for what a word list does here.
- **Cost:** a sentence that changes language half way is said by one
  voice, in the language most of it is in. Only the languages that may be
  spoken are told among: English and Spanish unless the person turns on
  more (French, Hindi, Italian, Portuguese), since each language added is
  one more to mistake a short sentence for. `speak {voice, language}` with
  a voice of another language used to say it in that voice with the wrong
  sounds; now the voice's pair says it.
- **Undo:** `voice.byLanguage: false` for one person; for all, make
  `by_language` default to false in `service/lines.rs`.

### D161. A voice's pair is the nearest in pitch of the same kind of speaker; every voice is brought to one level; a seam is a sentence's pause

- **Date:** 2026-11-15. `v09/tongue`.
- **Question:** a character should keep one person's voice across
  languages, and the change of voice should not be heard as a jump: which
  voice, how loud, how long a pause?
- **Choice:** measured, not guessed (`dashi-voice levels`; the table is
  `engine/kokoro/levels.rs`). The pair of a voice in another language is
  that language's voice of the same kind of speaker (the second letter of
  its name) whose median pitch is nearest; English for a voice of another
  language is American, for a British voice British. Every voice is
  multiplied to Dashi's own level (`af_heart`, −21.7 dBFS; they differed
  by 9 dB). Where the voice changes each side keeps 300 ms and 150 ms of
  hush, faded over 5 ms (`service/seam.rs`).
- **Why:** the set has one woman's and one man's voice in each language
  but English, so the pair is forced there; where there is a choice
  (Spanish Alex into English) pitch is the one likeness a machine can
  measure, and it picked Fenrir (1.2 semitones) over the first listed
  (Michael, 2.3). Left as the model made them the seams were 480 and
  660 ms and the Spanish voice 0.6 dB quieter than Heart, the Italian
  8 dB louder.
- **Cost:** the pair is another speaker: four characters are Dora in
  Spanish and two are Alex. The same voice with Spanish phonemes, and a
  mix of two voices, would keep more of the speaker; both are on the
  command line (`--same-voice`, `--mix`) for the owner to hear, and neither is
  offered until ears say it is better. Sentences of one voice keep the
  model's own pause (760 ms for Heart), longer than a seam's.
- **Undo:** empty `MEASURED` in `levels.rs` (no gain, pairs by order); set
  `SEAM_AFTER_MS` and `SEAM_BEFORE_MS` past a second.

### D162. Spanish is read as Latin American unless the formats are Spain's; `$` is pesos where the region counts in pesos; money and measures are made into words before eSpeak

- **Date:** 2026-11-15. `v09/tongue`.
- **Question:** eSpeak's `es` is Spain's ("gracias" with the th of
  "think"), which is how Kokoro's Spanish voices read before. The owner
  is Colombian and his formats are English. And "$20", "50%" and "3 km"
  were said as "twenty", "fifty" and "three kay em" in any language.
- **Choice:** a tag's region picks the rules: Spanish with a region that
  is not Spain is eSpeak's `es-419`. The shell sends the region of the
  person's formats (`es-CO`), and `es-419` when those are not Spanish;
  `es-ES` only when they are Spain's. The service alone, told nothing,
  reads as before (`es`). `engine/kokoro/reading.rs` makes money, shares,
  measures, times and `& + =` into words in the sentence's language
  before eSpeak sees them; `$` is "pesos" for `es-AR, CL, CO, CU, DO, MX,
  PH, UY` and "dólares" elsewhere (`US$` always).
- **Why:** nine in ten Spanish speakers say s, and a Dashi that lisps at a
  Colombian is wrong more often than one that does not at a Spaniard, who
  has `es_ES` formats to say so. The phonemes are ones the model knows.
- **Cost:** the voices were trained on Spain's rules; how Dora sounds with
  s for z is for ears (`dora-es-419.wav` and `dora-es-ES.wav` in the
  review folder). French, Italian and Portuguese get money and `%` only.
- **Undo:** `tagOf` in `voice/tongues.ts` returns `"es"`; drop
  `reading::said`'s call in `plan.rs`.

### D163. What was heard comes with its language, told from the words; what was said goes to the log only when asked

- **Date:** 2026-11-15. `v09/tongue`.
- **Question:** the brief asked whether Parakeet v3 reports the language
  it heard. And the proof needs each sentence's phonemes, in a service
  that logs no words.
- **Choice:** Parakeet does not: its vocabulary has language tokens
  (`<|es|>`) but the TDT decoder Dashi runs names words only. So `heard`
  and `listen.stop` carry `language` when the words tell it, by the same
  detector, among all six languages; left out otherwise. The shell keeps
  the last one as the conversation's language (`hint`).
  `DASHI_VOICE_DEBUG=speak` writes each sentence's voice, language,
  phonemes and text to the service's log; off unless set.
- **Why:** a hint that is sometimes absent is honest; a made-up one is
  not. The log rule ("no sound, no words, no log of either") stands for
  every session that did not ask.
- **Cost:** a short ask ("sí", "OK") gives no language, and the hint
  stays what it was.
- **Undo:** drop `language_of` in `service/listen.rs`.

### D164. Each sentence keeps its own `speak` and its own language's voice: `speak` answers with the language it chose, and the model is told the language the person spoke

- **Date:** 2026-11-15. `v09/loop` joined with the voice work (brief b3).
- **Dilemma:** D146 hands an answer to `speak` a sentence at a time, so
  none is cut; D160 tells each sentence's language inside one `speak`,
  where a sentence that tells nothing ("OK.") keeps the language of the one
  before it. Sent one at a time, every sentence is a first sentence, and
  "OK." after a Spanish one would fall back to the conversation's language
  and change voice.
- **Decision:** both stand. `speak`'s reply carries `language`, the
  language its last sentence is said in, and the shell sends it as the next
  sentence's `hint` (`voice/lib/speak-params.ts`); the first sentence's
  hint is the conversation's (what `heard` told, else `persona.language`,
  else the formats'). A run a dictation paused goes on after the language
  it stopped in. The switch off sends `by_language: false` with every
  sentence. And the answer itself: `heard`'s language goes to the
  assistant with the words, and its context says "They spoke Spanish:
  answer in Spanish. Keep the names of products, apps and sites as they
  are written."; the prompt says the same as a rule, for words that told
  no language.
- **Why not** one `speak` for the whole answer with `parts`: the answer is
  spoken as it is written, before its end is known. **Why not** the
  `sentence` event's language: it comes when the sentence plays, after the
  next one was queued.
- **Cost:** the seam's shorter pause (D161) is made inside one `speak`
  only, so between an answer's sentences the pause is the model's own
  (about half a second) whether or not the voice changes. A language told
  for the ask is a detector's guess from the words: a Spanish ask of two
  names ("YouTube, Helium") tells nothing and the prompt's rule decides.
- **Undo:** drop `language` from the reply in `service/speak.rs` and
  `after` in `voice/lib/saying.ts`; drop `spoke` in
  `agents/assistant/context.ts`.

### D220. A native window is read through AT-SPI, as read_page's lines, by `read_window`

- **Date:** 2026-11-15. `v09/windowtree` (brief t2).
- **Question:** agents read web pages as numbered text and native windows as
  pictures. Where does a native window's element tree come from, and in
  what form?
- **Choice:** AT-SPI, the tree every toolkit publishes for screen readers
  (mirin Metal's through AccessKit, GTK, Qt, Chromium once woken), read by
  the shell (`agents/window-tree/`) and written in read_page's words
  (`[12] button "Save"`, `# Heading`, `(filled: no)`), with the hierarchy
  kept by indentation and layout-only nodes folded away. One tool,
  `read_window {window, list?, from?}`, scope "see".
- **Why:** one source for every toolkit, a window on another Space reads
  the same, acting needs no pointer; one format means a model learns it once.
- **Cost:** the tree is only as good as each toolkit's (Metal's gaps are in
  `29-windowtree/for-mirin.md`); reading turns accessibility on, as the
  sign-in check already does.
- **Undo:** drop `windowTreeTools` from the registry.

### D221. The website tools act on a native window's numbers given `window`; only a critical element waits for the person

- **Date:** 2026-11-15, changed 16 Nov by the owner's rule (`briefs/consent-critical-only.md`).
- **Question:** separate tools for native elements, or the same ones? Which
  presses are put to the person?
- **Choice:** the same tools: `click_element`, `fill_element`,
  `select_option` and `scroll_page` take an optional `window`; with it the
  call is tagged "act" (`ToolDef.scopeFor`), not "Use websites" (whether a
  scope asks at all is `v09/askagent`'s). `act_on_element` adds what a page
  has no word for. read_window flags an element `critical: pays | secret |
  loses work | system | sends` from the toolkit's attribute, else its words
  (English and Spanish) and what is around it (a filled password field
  makes "Sign in" a `secret`); pressing one asks on screen every time
  (`Scopes.criticalYes`: askagent's `confirm`, its sheet, or the launcher's
  line in a typed turn, D261), anything else just runs. The kinds are the
  one critical list, `CRITICAL` in `agents/consent.ts` (D260), from which
  the registry's `ASKS_EVERY_TIME` is drawn: a tool and an element are
  critical by the same words. Work alone covers neither.
- **Why:** two more tools instead of six; the owner: "permissions should be
  only for critical operations", and only the element tells which it is.
- **Cost:** words decide, since no toolkit publishes a destructive hint on
  AT-SPI: a critical button named otherwise ("OK") goes unasked; mirin is
  asked for the hint (for-mirin.md).
- **Undo:** take `window` out of the four tools' args; `criticalOf` returns null.

### D222. Element numbers are the connection's and live as long as their node

- **Date:** 2026-11-15. `v09/windowtree`.
- **Choice:** a number is given to an element's bus name and path and kept
  across reads (`TreeNumbers`), never reused; one whose node is gone
  answers with the window's fresh tree around where it was.
- **Why:** AT-SPI paths are stable while a node lives in every toolkit
  measured; Metal's are hashes of element ids.
- **Undo:** renumber per read in `numbering`.

### D223. A list gives 40 rows a read, and the call for the next

- **Date:** 2026-11-15. `v09/windowtree`.
- **Choice:** lists, tables, trees and menus read only the rows asked for
  (`PAGE`), and say how many there are and the `read_window` call for the
  next page; nodes past the walk's budget (3000, 2.5 s) are said to be cut.
- **Undo:** `PAGE` in `lib/render.ts`.

### D224. What a window says is secret or the person's

- **Date:** 2026-11-15. `v09/windowtree`.
- **Choice:** a password role, or a field named as a password, PIN, code or
  card, is never read (its character count says filled or not; where a
  toolkit gives no count, as Metal today, it says "filled: can't tell"). The Setup
  Assistant, Settings showing the vault, a window handed over, and the
  shell's and portal's own windows (consent sheets) stay the person's alone
  under the critical-only rule too: named, never read, no numbers given.
- **Undo:** `isSecret` and `personOnly`.

### D225. Acting waits for the app's own tree events to settle, never a timer guess

- **Date:** 2026-11-15. `v09/windowtree`.
- **Choice:** the shell registers for AT-SPI object events once
  (`Atspi.watchChanges`) and counts them per app; an action settles when no
  event came for 150 ms (300 ms with none at all, 1.5 s at most), and the
  result says what changed in the page's words (`agents/lib/change-words.ts`,
  shared with reach's D271), with the changed lines. `wait_for` with a
  `window` (`text`, `text_gone`, an `element`, `page: "quiet"`) waits on the
  native tree through `waitOnWindow`; its quiet is this same `settle`.
- **Undo:** `settle` returns false at once.

### D226. A Dashi pressable always has a name

- **Date:** 2026-11-15. `v09/windowtree`.
- **Choice:** `@dashi/ui`'s icon buttons name themselves (Clear, Dismiss),
  `ToolbarButton` needs a `label` or `tooltip` by type, and a test renders
  every @dashi/ui pressable and fails on one with neither label nor words
  (`test/pressable-names.test.tsx`). The apps' and shell's 23 nameless ones
  found by an audit got names (Dock icons, month arrows, Eject, Cancel…);
  full-screen backdrops are a group named "Close", not a nameless button.
  A switch in a settings row takes the row's title (`ControlName`, read by
  @dashi/ui's `Switch` and the shell's `ControlSwitch`: measured in the VM,
  every Settings switch was a nameless "toggle button"), and
  `ToolbarButton` says when it is disabled.
- **Why:** an unnamed button is unusable for a screen reader and an agent.
- **Undo:** none needed; the names cost nothing.

### D170. The model that corrects dictation is SpeakoFlow Mini, a fine-tuned 0.8B, not a prompted 3 to 4B

- **Date:** 2026-11-15. `d1`, branch `v09/rewrite`. The numbers are in
  `dashi-0.9.0-review/24-rewrite/README.md`; the contract is
  `docs/dictation-rewrite.md`.
- **Question:** which small model rewrites a transcript on this computer
  (the owner's must: "no, I mean…" lands as the corrected words), at which
  quantisation? The research's order of testing put prompted 3 to 4B models
  first and a fine-tune of a 0.6 to 1B model as a later goal.
- **Choice:** **SpeakoFlow Mini** (`SpeakoFlow/speakoflow-mini`,
  Apache-2.0, a fine-tune of Qwen3.5 0.8B, itself Apache-2.0), at **Q4_K_M**
  (542 MB). Seven candidates were run through 370 pairs (192 English, 114
  Spanish, 64 mixed), all with Dashi's prompt and checks:

  | Q4 unless said | Size | Right sentences left alone | Self-corrections fixed: en / es / mixed | All edits | Damage | 16 words on the processor |
  | --- | --- | --- | --- | --- | --- | --- |
  | Do nothing | – | 100.0% | 0% / 0% / 0% | 9% | 0.0% | – |
  | The rules alone | – | 98.6% | 5% / 4% / 6% | 17% | 0.3% | – |
  | **SpeakoFlow Mini 0.8B** (fine-tuned) | 542 MB | 98.6% | 76% / 75% / 88% | 61% | 2.4% | 0.26 s |
  | Gemma 4 E2B | 3.11 GB | 98.6% | 72% / 69% / 84% | 76% | 1.1% | 0.49 s |
  | SmolLM3-3B | 1.92 GB | 96.5% | 67% / 69% / 69% | 65% | 1.6% | 0.65 s |
  | Qwen3-4B | 2.50 GB | 92.3% | 74% / 69% / 78% | 68% | 2.7% | 1.02 s |
  | Qwen3-0.6B (Q8) | 639 MB | 94.4% | 66% / 48% / 56% | 52% | 3.8% | 0.28 s |
  | Granite 4.0 H 1B | 901 MB | 93.7% | 66% / 25% / 38% | 46% | 3.2% | 0.42 s |
  | Qwen3.5-0.8B (the base, prompted) | 533 MB | 97.2% | 9% / 8% / 9% | 18% | 2.4% | 0.34 s |

- **Why:**
  1. It is the best at the must in each language, and it leaves right
     sentences alone as often as the rules do (98.6%).
  2. It is the smallest and the fastest: a sentence in a quarter of a
     second on the processor alone, holding 1 GB, so the default needs no
     graphics card and fits a small machine.
  3. Q8 (834 MB) scores the same within the set's noise, and is slower.
  4. The research's guess held for the base: the same 0.8B, only prompted,
     fixes one self-correction in ten; fine-tuned, three in four.
  5. **Gemma 4 E2B is the one that could have been chosen instead**, and
     this is a judgement, not a clear win: prompted, it is as careful
     (98.6%), nearly as good at the must, and far better at everything
     else (non-words 86%, fillers 86%, names 61%, the owner's corpus 57%
     against 24%). It costs 3.1 GB to fetch, 4.3 GB of memory while up,
     half a second for a sentence and 1.4 s for forty words on the
     processor (so it would refine, or need the integrated card: D171). What
     it does better is what rules do for nothing (D174); what SpeakoFlow
     Mini does better is the one thing rules cannot. On the 60 held-out
     pairs: SpeakoFlow Mini 33 of 34 left alone and 17 of 22 fixed; Gemma
     33 of 34 and 16 of 22.
- **Cost:** one developer's fine-tune, published in 2026: if the repository
  goes, the fetch breaks (the file is pinned by commit and SHA-256, and the
  licence lets Dashi mirror it). It does not fix non-words or names heard as
  other words: the rules do (D174). If stage 1's rules do not land, Gemma 4
  E2B is the better model for the owner's corpus, and the lead should swap.
- **Undo:** the model is three lines in `rewrite/lib/model.ts` and one
  `File` in `crates/dashi-voice/src/models/manifest.rs`; the prompt and the
  checks do not change with the model. Run the set first
  (`docs/dictation-rewrite.md`, "The evaluation set").

### D171. The model runs on the processor, and never on the NVIDIA card

- **Date:** 2026-11-15. `d1`.
- **Question:** the laptop has an integrated Radeon 890M (the desktop is
  drawn on it), an NVIDIA card (asleep, or the owner's games) and 24
  threads. Where does the model run by default?
- **Choice:** on the processor: `-ngl 0`, half the threads and eight at
  most, `Nice=5`. `DASHI_REWRITE_DEVICE=gpu` tries a graphics card through
  Vulkan; the NVIDIA driver is disabled for the server either way.
- **Why:** measured on the laptop with the chosen model: sixteen words in
  0.26 s on the processor and 0.16 s on the integrated card; forty-two
  in 0.63 s and 0.41 s. The card is faster by a tenth of a second, which
  nobody sees under a 1.2 s limit, and it costs what could not be measured
  without touching the session: the compositor draws on the same card, and
  a burst of compute may drop its frames. The processor path works on every
  machine, with no Vulkan driver to go wrong. The NVIDIA card: measured once, 0.07 s and 0.26 s, but its first request took 20 s and the server then kept a processor thread spinning while idle; it is the owner's gaming card, and is left alone.
- **Cost:** on a weak processor the speed test will say "refine" or "too
  slow" where an integrated card might have been quick enough. Eight
  threads are busy for a fifth of a second per dictation.
- **Undo:** `deviceOf` in `rewrite/lib/service.ts`; to make the card the
  default, first measure dropped frames in the VM's session and on the
  laptop with the owner.

### D172. llama.cpp's server, as a separate program on a Unix socket, in a package of Dashi's own

- **Date:** 2026-11-15. `d1`.
- **Question:** how does the shell reach the model: linked into
  dashi-voice, a child of dashi-voice, Fedora's `llama-cpp` package, or a
  unit of its own?
- **Choice:** `llama-server` (llama.cpp, MIT) runs as the user unit
  `dashi-rewrite`, started by the shell with `systemd-run --user` on the
  first dictation and stopped after ten idle minutes, listening on
  `$XDG_RUNTIME_DIR/dashi-rewrite.sock` (0600) with
  `RestrictAddressFamilies=AF_UNIX`, `NoNewPrivileges`, `LimitCORE=0`. It
  comes from a new package, `dashi-llama`, at
  `/usr/libexec/dashi/llama/`, which `dashi` recommends.
- **Why:**
  - Not linked: llama.cpp is C++ with its own GPU backends; as a program it
    keeps its licence to itself, crashes alone, and is stopped to free its
    memory.
  - Not a child of dashi-voice: that service hears the microphone and holds
    1.8 GB of speech models; the rewrite model has another life (ten idle
    minutes) and another owner (the shell decides when to rewrite).
  - Not Fedora's `llama-cpp`: Fedora 44 has build 6153, which predates
    Qwen3.5, is built for ROCm (`hipblas`) and has no Vulkan.
  - A transient unit, not a unit file: its whole definition is one function
    (`serverCommand`), tested, and it carries the model's path and the
    device, which a static unit would need a wrapper for.
- **Cost:** a package to build and keep current (the spec is written and
  **not built**: it needs `glslc`, which the laptop lacks). The server's
  HTTP dialect is llama.cpp's and has changed before: `rewrite/lib/complete.ts`
  is the only code that speaks it.
- **Undo:** `unitService` returns null when the program is not there, and
  dictation tidies by rule: removing the package is the undo.

### D173. Dashi's own prompt and checks around the model, not the prompt it was trained with

- **Date:** 2026-11-15. `d1`.
- **Question:** SpeakoFlow Mini's card says to send its own system prompt
  and the bare transcript, "with nothing added". Dashi has a vocabulary, a
  tone and the text before the caret to pass, and its own idea of what must
  never be changed.
- **Choice:** Dashi's prompt (`rewrite/prompt.ts`: seven rules, fifteen
  example turns, then the vocabulary, the tone, the text before the caret
  and the transcript in tags) and Dashi's checks (`rewrite/checks.ts`,
  twelve of them) on every answer.
- **Why:** measured both ways, on the 370 pairs and then on 60 written
  after the prompt and the checks were frozen:

  | | Right sentences left alone | Self-corrections fixed (en / es / mixed) | Damage | Names from the vocabulary |
  | --- | --- | --- | --- | --- |
  | Its own prompt, no checks | 85.9% (held-out: 73.5%) | 81% / 85% / 94% | 13.2% (18.3%) | 4% |
  | Its own prompt, Dashi's checks | 98.6% (94.1%) | 79% / 81% / 94% | 2.7% (3.3%) | 13% |
  | Dashi's prompt, no checks | 96.5% (94.1%) | 78% / 79% / 88% | 6.5% (8.3%) | 35% |
  | **Dashi's prompt, Dashi's checks** | **98.6% (100%)** | **76% / 75% / 88%** | **1.6% (0%)** | **43%** |

  (These rows ran on the integrated card. On the processor, which ships,
  the last row reads 98.6% (97.1%: 33 of 34), 76% / 75% / 88%, 2.4% (1.7%):
  the same weights answer a few sentences differently on the two devices.)

  With its own prompt the model fixes a few more corrections and drops a
  real "No," or "Actually," from one right sentence in seven (one in four
  on sentences it had not been tuned around): the checks then carry the
  whole weight, and they were written against this set. With Dashi's
  examples the model itself is careful, and the checks are a second line.
  What a person forgives least is their own words changed.
- **Cost:** three to six self-corrections in a hundred that the model's own
  prompt would have fixed. The fifteen examples are about 1,100 tokens,
  read once when the server comes up. The tone and the text before the
  caret have a place in the prompt but are **not sent to this model**
  (`MODEL.context`): with them it fixed 67% / 71% / 84% of
  self-corrections instead of 76% / 75% / 88%. The vocabulary is sent.
- **Undo:** `rewriteMessages(request, rules)` takes other rules; the runner
  has `--system speakoflow` to measure the model's own prompt again.

### D174. The model takes words back; the rules keep everything else

- **Date:** 2026-11-15. `d1`.
- **Question:** the same model could also lay out lists, fix words that are
  not words, take out "like", and write names from the vocabulary. Should
  dictation ask it to?
- **Choice:** no. The model is there for what a rule cannot decide: what
  the speaker took back. Lists are the rules' and the profile's (the checks
  refuse an answer that adds or removes a line break); non-words, dropped
  contractions, fillers and names are stage 1's.
- **Why:** measured: this model fixes 5% of non-words, 9% of "like", 39% of
  names heard as other real words, and turned "shouldt" into "should" (the
  `negation` check now refuses that). A rule does each of these every time,
  and for nothing.
- **Cost:** until stage 1 has the contraction rule, replacements and "like"
  by position (`v09/dictate`), rows 1 to 6, 9, 10, 17, 19 and 21 of the
  owner's corpus land as heard.
- **Undo:** the `lines` check in `rewrite/checks.ts` is what keeps lists
  out; the prompt's rule 5 already asks for non-words and names, for a
  model that does them.

### D175. A sentence lands once, under 1.2 s; a long dictation lands by rule and is refined

- **Date:** 2026-11-15. `d1`.
- **Question:** wait for the model and land once, or land the rules' text
  and replace it (research 3.1, "the wait")? Under which deadline?
- **Choice:** by a one-time speed test (sixteen words, three times, the
  middle time kept in `rewrite-speed.json`): when a transcript is expected
  to take under 0.8 s, dictation waits and lands **once**, with 1.2 s as
  the limit; a longer one, or any on a slower machine, lands by rule and is
  **refined** (limit: twice the expected time, 8 s at most); over 2.5 s for
  the test sentence the model is not used. The server starts on the key
  going down and stops after ten idle minutes.
- **Why:** on the laptop the test says 236 ms, so everything up to
  about 54 words lands once, in 212 ms at the median and
  341 ms nine times in ten: under the 300 ms at which the capsule would say
  "tidying". Text that lands and then changes is worse than text that lands
  right a moment later, but only for a moment that short.
- **Cost:** the first dictation after ten idle minutes: the server needs
  about 2 s (3 s the very first time, when the speed test runs) to come up, so a first hold shorter than that lands by rule
  (`starting`). While it is up it holds 1 GB of memory.
- **Undo:** `ONCE_MS`, `TOO_SLOW_MS`, `REFINE_MOST_MS` in
  `rewrite/lib/speed-store.ts`; `IDLE_MS` in `rewrite/rewriter.ts`.

### D176. A Dashi fine-tune is written down, not started

- **Date:** 2026-11-15. `d1`.
- **Question:** the plan's third step is a Dashi fine-tune of a sub-1B
  model for English, Spanish and mixed repairs. Is it still needed, and
  what does it take?
- **Choice:** not started, and not needed to ship: a fine-tune that does
  the job exists under Apache-2.0 (D170). What a Dashi one would be for,
  and what it needs, is in `dashi-0.9.0-review/24-rewrite/README.md`,
  "A Dashi fine-tune".
- **Why:** what is left after D170 is one self-correction in four (a
  phrase started again with no cue word, the owner's rows 11 and 25), and
  the caution Dashi now gets from fifteen examples and twelve checks, which
  a model trained on Dashi's own pairs would have by itself.
- **Cost:** none now.
- **Undo:** nothing to undo.

### D180. Dictation remembers what it typed, and Undo is BackSpace on exactly that

- **Date:** 2026-11-15. The `v09/dictate` engineer's (the research's first
  list, 3.1; briefs/d2-dictate.md).
- **Question:** the night's cut said "never send backspaces into an app".
  Undo, Raw and "scratch that" all need Dashi to take back its own words.
  Three ways: the app's own undo (Ctrl+Z), a range delete through AT-SPI's
  EditableText, or BackSpace.
- **Choice:** BackSpace, once for each character Dashi sent
  (`type-text`'s `erase` since D187), and only when those characters are
  still the last thing in the field. Where AT-SPI gives the field's text, the text before the
  caret must end with them. Where it does not (most terminals), the
  person's own hands must not have pressed a key or a button in that
  window since the words landed (`input-origin`, which the compositor
  knows for certain) and the words must hold no line break. Anything else
  touches nothing and says so. Dashi keeps the newest forty insertions in
  memory (`dictation/lib/record.ts`) and never reasons about text it did
  not write. Undo is on the capsule and at ⌃❖Z, "paste last" at ⌃❖V:
  ❖Z stays the app's own.
- **Why:** the app's undo is unpredictable (a web editor groups typed keys
  as it likes; a terminal has none), and EditableText is missing in
  Chromium's editors and in every terminal. BackSpace works everywhere a
  key does, and the check makes it exact: what it deletes is what Dashi
  typed, or nothing.
- **Cost:** an editor that changes what was typed (auto-indent, a closed
  bracket, autocomplete) no longer ends with Dashi's characters, so Undo
  refuses there: the safe failure.
- **Undo:** `erase()` in `dictation/lib/erase.ts` is the one place; a
  range delete can replace the loop where a field offers one.

### D181. The history keeps a day of raw and final words, on this computer, and no sound

- **Date:** 2026-11-15. The `v09/dictate` engineer's.
- **Question:** how long, where, and what.
- **Choice:** `$XDG_STATE_HOME/dashi/dictation/history.jsonl`, mode 600:
  the time, the app, the profile, the words as heard and as typed. A day
  by default; a week, or nothing (`dictation.history`), in Settings ›
  Voice, where each row has Copy and Delete. "Nothing" writes nothing and
  removes the file. No audio in this slice. Reading the text around the
  caret needed two optional additions to `agents/atspi` (`caretText` on a
  node, `role` and `text` on a focused field): small, and nothing there
  changed its behaviour.
- **Why:** the raw words must never be lost (the corpus's rows 8 and 16
  could not be read back), and a day is what someone needs to recover a
  dictation without keeping a diary of everything said.
- **Cost:** a file with the person's words in their home folder.
- **Undo:** Settings › Voice, "Nothing"; or delete the file.

### D182. Five profiles chosen by what is in front; the person's words are plain files

- **Date:** 2026-11-15. The `v09/dictate` engineer's.
- **Question:** the owner asked for "profiles like a developer profile with
  a subset of names". Who picks the profile, where do the words live, and
  what may a rule change without a model?
- **Choice:**
  - Five profiles (Developer, Writing, Chat, Email, Verbatim), picked by
    the field's role, then the site, then the app, else Writing: no setup.
    The site comes from the web document around the focused field
    (AT-SPI), so it needs neither the browser's extension nor a
    permission. The capsule names the profile and a press changes it for
    that window only; nothing is remembered per app yet.
  - `~/.config/dashi/dictation/`: `vocabulary`, `replacements`, `snippets`
    and `profiles/<id>`, plain text, seeded once and never written over.
    Settings edits the first two; the rest is edited as files.
  - Rules are exact: a replacement needs its words said whole; a near miss
    is taken only for a word no dictionary knows (hunspell's stems, read
    lazily; a system package Dashi only reads); casing and symbols need
    their own names ("camel case…", "dash dash…", "equals sign"), never a
    bare "plus", "star" or "colon".
  - A shell's prompt is told from an agent's prompt by the processes under
    the terminal (`/proc`), not by asking the terminal. In an agent's
    prompt a line break is ⌃J, which Claude Code and Codex take as a new
    line; at a bare shell Dashi adds none of its own.
- **Why:** Wispr's four fixed categories are what people find easiest;
  files are what a developer can keep in a repository and what a person
  can repair by hand. A rule that guesses is worse than no rule: typing
  "+" for "plus" in a sentence costs trust.
- **Cost:** a name that is also a word ("Notes", "Files") is not seeded and
  is never fuzzy-matched; "cloud can do" for "Claude can do" waits for the
  model. A Spanish verb form is unknown to the stem list, so near misses
  are English-leaning. ⌃J and ⇧Return are conventions, not guarantees: an
  app that sends on ⇧Return would send.
- **Undo:** a profile's file changes any of it (`line breaks: return`,
  `code: no`); `PROFILES` in `dictation/lib/profiles.ts` holds Dashi's own.

### D183. The model is asked only where the rules' text says it is needed

- **Date:** 2026-11-15. The `v09/dictate` engineer's (the seam is D170's,
  `docs/dictation-rewrite.md`).
- **Question:** when is the correction model asked, and what lands when it
  does not answer?
- **Choice:** the rules always run and their text is what lands by
  default. A gate of plain patterns decides: a self-correction cue or a
  repeat, list markers the rules did not use, twenty words with no mark, a
  word no dictionary knows, the first word of a term's "heard as" form, or
  a profile that asks for polish. A sentence with no reason is never
  sent. The answer changes the text only when it is `text`; it is styled
  again by the profile. "Tidying" is said after 300 ms. Where the
  rewriter advises `refine`, the rules' words land and are replaced later
  only if the field still ends with them. Numbers from ten up become
  digits by rule; one to nine, and ordinals, stay words. "like" is a
  filler by rule only in the places the corpus shows (after a verb that
  takes its object, before an article or an -ing word).
- **Why:** restraint is measured in what is not touched. The owner's
  corpus has more sentences that are right than wrong; a model that reads
  every one of them will damage some, and each ask is a wait.
- **Cost:** a mishearing that leaves real words and no cue ("through
  boys", "it just start") is not sent: 10 of the corpus's 15 model rows
  have no reason worth asking for. The gate also names `non-word` and
  `list`, but the model is not asked for them: `v09/rewrite` measured that
  it mends 5% of non-words and never lays out a list (its checks refuse a
  new line break), so those stay the rules'. A profile with `polish: yes`
  sends everything.
- **Undo:** `gate()` in `dictation/lib/gate.ts`; `polish: yes` in a
  profile's file asks for every utterance today.

### D184. Dictated words are fitted to the text around the caret, read through AT-SPI

- **Date:** 2026-11-15. The `v09/dictate` engineer's.
- **Question:** every landing began with a capital and ended with a full
  stop and a space, wherever the caret was.
- **Choice:** the field's text before and after the caret is read at the
  landing, by the walk the password check already makes (no second
  round-trip to find the field), and four things follow from it: a
  leading space or none, a capital or none, a final full stop or none, a
  trailing space or none (`dictation/lib/fit.ts`). After a colon the
  words are left as said. A name keeps its capital mid-sentence. Where
  the text can't be read nothing changes from before.
- **Why:** it is the difference between words that continue a sentence
  and words pasted into it; Wispr does this part on the device for the
  same reason.
- **Cost:** accessibility is on from the first hold (it was already, for
  the password check). Dashi's own apps and terminals give no text, so
  they get no fit yet: mirin would have to publish its fields to AT-SPI.
- **Undo:** `fit()` returning the words with a space after.

### D185. An instruction is the whole utterance; lists are made only from plain markers

- **Date:** 2026-11-15. The `v09/dictate` engineer's (research 1.9).
- **Question:** the owner wants "remove the previous text" and "here's the
  list: first…" to be understood. How is an instruction told from words,
  and how much structure may a rule make?
- **Choice:** an instruction must be everything that was said in one
  press, from a fixed list in English and Spanish; it acts on the
  insertion record only (D180's check). The capsule says it took it as an
  instruction and offers Undo, which restores and types the words as
  heard. With nothing of Dashi's to remove, nothing is typed either: the
  line says so and Undo types the words. A list is made from ordinals in
  order, counted items that each start a clause, or repeated "bullet
  point"; numbered when counted, Markdown bullets in chat, at an agent's
  prompt and in Markdown editors, bare lines elsewhere, nothing at a
  shell's prompt.
- **Why:** deleting by mistake costs trust and typing "scratch that" by
  mistake costs one press; the whole-utterance rule removes the quoting
  failures without a classifier. "Tell him to scratch that" is typed.
- **Cost:** "scratch that" at the end of a longer utterance is not an
  instruction (inside an utterance it is tidying's change of mind, or the
  model's). "delete the last sentence" and "replace X with Y" are not
  built. A list said without clear markers waits for the model.
- **Undo:** `ERASE` and `BREAKS` in `dictation/lib/instruction.ts`;
  `makeList` in `lists.ts`.

### D186. A fix made by hand is offered as a replacement; a tap of the dictation key says yes

- **Date:** 2026-11-15. The `v09/dictate` engineer's (the research's
  second list, item 8).
- **Question:** how does Dashi learn the person's words without learning
  the wrong thing?
- **Choice:** the field is read again every 2.5 seconds, four times,
  after a landing (no AT-SPI events: reads of the focused field). One
  changed run of up to three words, with two of Dashi's words still round
  it, seen the same at two reads in a row (in the VM the offer came at
  the first read, when a person could still be typing), is offered on the
  capsule; a press on Always, or a tap of the
  dictation key, stores it in `replacements` (or `vocabulary` when only
  capitals changed). Numbers, paths and addresses are never offered.
- **Why:** the owner's corpus is names; each fix made once by hand should
  be the last. An offer cannot learn a mistake silently, and the
  dictation key is the only key Dashi may take.
- **Cost:** four more reads of the field per landing where it is
  readable; nothing in terminals or Dashi's own apps, whose text AT-SPI
  does not give. A word swapped for meaning ("there" to "here") is
  offered too; saying nothing lets it pass.
- **Undo:** `Landings.watch` in `dictation/lib/landings.ts`.

### D187. `type-text` carries the BackSpaces and the line-break chord; a key the shell takes is not a press in the window

- **Date:** 2026-11-15. The `v09/dictate` engineer's, from what the VM
  showed.
- **Question:** two things failed in the VM that the unit tests could not
  see. (1) Undo by ⌃❖Z, and "scratch that", refused in every field that
  can't be read (Terminal, Text Editor): `input-origin` counted the
  shortcut's own keys, and the dictation key itself, as "the person
  pressed a key in this window". (2) A list in Helium landed as "1. Buy
  milk2. Call Alex": the ⇧Return sent by `send-keys` goes through the
  input method (fcitx5), which hands it on later, while `type-text`'s
  keys go straight to the window; the break arrived after the next line.
  The same would let an Undo's BackSpaces arrive after the words typed
  next.
- **Choice:** both fixed where they start, in the compositor.
  - A key is noted as the person's press where it is given to what has
    the keyboard (`keys/handler.rs` `note_person_key`): not a modifier
    alone, not a key the shell holds (`held-keys`, ❖), not a chord the
    keymap binds or swallows. A chord the keymap turns into other keys
    for the window (❖C as Ctrl+C) still counts. Pointer presses are as
    before.
  - `type-text` takes `erase` (that many BackSpaces before the text) and
    `breaks` (the chord a line break is typed as: its modifier is a key
    of the made keymap, held while Return goes). One request, one route,
    in order. Dictation no longer uses `send-keys` except for BackSpace
    in an X11 window, where `type-text` is refused.
- **Why:** the alternative for (1) was to let Undo trust a window the
  person may have typed in, which breaks the one promise Undo makes; for
  (2) a wait between requests, which is a guess about another program's
  timing.
- **Cost:** consent that counts a person's key (`input-origin` on a
  sheet's layer) now counts only keys the sheet is given: a Return on a
  sheet still counts; a chord the keymap binds while a sheet has the
  keyboard does not. The IPC grew two optional fields.
- **Undo:** note every key press again in `input/events.rs`; drop the
  two fields and send chords with `send-keys`.

### D190. Dictation asks the model wherever a cue follows something said: the gate covers what the model was scored on

- **Date:** 2026-11-15. `v09/voicejoin` (brief d3: dictation joined with
  its model and the assistant).
- **Question:** joined, the two halves disagreed. The gate (D183) asked
  the model for "no, I mean", "actually," and a few Spanish phrases; the
  model was scored on many more ways of taking words back ("at five, no,
  six", "digo", "I mean" with no "no", "espera", "miento", "never mind").
  Of the 134 self-corrections in the model's set the gate sent 70, so
  half of the owner's must never reached the model.
- **Choice:**
  - A cue is any of the phrases the model was scored on, in English,
    Spanish and mixed, **after something was said**: a bare "no" counts
    only set off by a pause and going on to say the thing again (", no,",
    ". No,", ", no the…"); "digo" never after "te", "le", "que"; "actually"
    with a pause beside it or the thing said again after it. A cue that
    opens the utterance ("No, I mean it.", "No, gracias…", "Sorry, I'm
    late") takes nothing back and is not a reason. The gate now sends 122
    of the 138 pairs tagged as self-corrections; the 16 left are ones
    the rules already carry out, and restarts and unpunctuated
    corrections no candidate fixed (below). D195 narrows one case: a
    "no" with no pause after it.
  - The model is asked for `cue`, `run-on`, `near-term` and `polish`, as
    D183 chose; `non-word` and `list` stay the rules'. Both reports agree
    on that.
  - The tone and the text before the caret ride the seam and are not sent
    to this model (D173): the fit to the field (D184) is a rule applied to
    whatever lands, the model's answer included.
  - One rewriter a session, made in `boot/dictation.ts`; turning Voice or
    "Tidy what I say" off takes the model out of memory at once.
- **What is neither the rules' nor the model's** (written down, not
  hidden): a phrase started again with no cue ("Can you send, could you
  forward…", "Lo que pasa es que, el problema es que…"), a correction
  with no pause ("saturday no sunday"), and chains with no cue (the
  corpus's rows 11 and 25). They land as said. The capsule shows them
  like any landing: "Typed", with **Raw** one press away and the heard
  words kept in the history; nothing claims a fix.
- **Why:** the must is the model's job, and a gate narrower than the
  model's training wastes it. Asking costs the wait only (a quarter of a
  second on the laptop); the model's checks hold right sentences (98.6%).
- **Cost:** more sentences wait for the model: of the sentences in
  the set that are already right, 21 of 142 are sent (they hold a real "no" or
  "sorry" after other words) and come back unchanged.
- **Undo:** `CUES` and `OPENERS` in `dictation/lib/gate.ts`.

### D191. `dashi-llama` is built for the processor only, from the commit that was measured

- **Date:** 2026-11-15. `v09/voicejoin`; the lead's call for the device,
  recorded here with what building it settled.
- **Question:** D172's spec built llama.cpp with Vulkan and was never
  built: the laptop has no `glslc`, and no agent installs anything there.
  The model's chosen device is the processor (D171).
- **Choice:** no Vulkan backend (`-DGGML_VULKAN=OFF`): the build needs
  `cmake`, `gcc-c++` and `ninja-build` only, and the server can reach no
  graphics card at all. The source is pinned by commit
  (`b1b770d90d94…`, tag b12359, the build the measurements ran on) and by
  the tarball's SHA-256, checked in `%prep`. Three defaults of that tree
  are turned off because they fetch or link what the server never uses:
  the prebuilt web UI (a download from a Hugging Face bucket at build
  time), OpenSSL, and the unified binary. One processor backend a level
  (`GGML_CPU_ALL_VARIANTS`), chosen when the server starts, as the
  measured binary had. The licences of what is built in (nlohmann/json,
  cpp-httplib, xxHash, rotate-bits, stb_image, miniaudio, subprocess.h,
  sha1, sha256) are in the spec's `License:` and in the package's
  `LICENSE.dependencies`, kept by hand: llama.cpp has no lockfile for
  `spin/license-dependencies` to read.
- **Why:** it builds on the laptop with what is installed, in two
  minutes, and what is not built cannot wake a graphics card.
- **Cost:** `DASHI_REWRITE_DEVICE=gpu` does nothing with this package
  (the server runs on the processor whatever it is told); the integrated
  card's 0.16 s a sentence against 0.26 s is given up until someone asks.
  The licence list must be read again by hand when the pin moves.
- **Undo:** `-DGGML_VULKAN=ON` with `glslc`, `vulkan-headers`,
  `vulkan-loader-devel` and `spirv-headers-devel` as build requirements
  (the spec at `d7f63e4a` has them).

### D192. What the model hands back is the speaker's own words: accents kept, and three rules mended by what the joined run showed

- **Date:** 2026-11-15. `v09/voicejoin`.
- **Question:** the whole set run through dictation as joined (rules,
  gate, model, checks, the profile's style:
  `test/support/rewrite-eval/joined.ts`) showed four things neither
  report had: the model writes "mandame" for "mándame" (its checks read
  words without accents, so they pass it); the rules carried out a
  quoted "scratch that" and lost the words before it; "nine thirty"
  landed as "nine 30"; and "like half" kept its filler (the corpus's
  row 32).
- **Choice:** a word of the model's answer that differs from a word that
  was said only by its accents is written as it was said
  (`keepAccents`, in dictation, after the checks). A change-of-mind
  phrase right after an opening quotation mark is not carried out. A
  time said as two numbers stays words. "like" before "half", "many",
  "few" and "several" is a filler after the same verbs as before.
- **Why:** the model's part is taking words back (D174). A Spanish
  speaker reads a lost accent as a mistake of Dashi's, and it is one.
- **Cost:** where the model rightly adds an accent the speaker's
  recogniser left out, the recogniser's spelling stays.
- **Undo:** drop `keepAccents` from `withModel`
  (`dictation/lib/rewrite.ts`); `clockAt` in `rules-spoken.ts`.

### D193. A consent sheet still takes no Return: the keyboard stays with what the person was typing in

- **Date:** 2026-11-15. `v09/voicejoin`. The installed pass
  (`26-assistant-installed`) found that the real Return does not answer a
  consent sheet and goes to the app under it; the lead asked why, and
  that the default button take the real Return.
- **What it is:** not a fault of the build, and not D187's. The sheet is
  a layer surface with `keyboard: "on-demand"` and no key handler
  (`agent-sheets/agent-sheets.tsx`, `consent.tsx`'s header; the applets'
  and Bluetooth's sheets say the same): it never takes the keyboard by
  itself, so that "a stray Enter typed elsewhere can't answer it". It has
  been so since the sheet was written. D187 changed which keys count as
  the person's *in a window* for Undo; a consent's yes is still checked
  against the sheet's own layer, where only the real pointer's press
  lands.
- **Choice:** keep it. An agent chooses when its sheet appears; a person
  who is typing presses Return several times a minute. A sheet that took
  the keyboard and answered "Allow Once" on Return would let any agent
  get its yes by asking at the right moment, with the person's own real
  key: the one press `input-origin` cannot tell from consent. The pointer
  must travel to the button, which nobody does by accident.
- **Cost:** no keyboard-only way to say yes to an agent (⌃❖Esc stops
  every agent, which is a no).
- **If the owner wants a key:** the safe form is a chord nothing else
  uses, shown on the button, taken by the keymap only while a sheet is
  up and answered only when the compositor says the keys were real
  (the capsule's card does this with a tap of the Dashi key and then
  Return: `capsule/`). That is the owner's call, since it loosens a
  consent rule; it is not built.
- **Undo:** `keyboard: "exclusive"` and a Return handler on the sheet's
  primary button.

### D194. A card that gives up says so; an empty "about you" file opens

- **Date:** 2026-11-15. `v09/voicejoin`; faults 2 and 4 of the installed
  pass.
- **Choice:** when a question on the card runs out of time the capsule
  says "No answer, so nothing was done.", and for ten seconds a few
  words that only answer it ("No.", "Yes, go ahead.") are not a new ask:
  the capsule says "That question is over. Nothing was done." Anything
  else said is an ask as before. `about-you.md` is made with one first
  line that says what it is for (a `#` line, never read to the assistant
  or counted), because an empty file has no kind and no app opens it.
- **Cost:** a person who answers a new, unrelated question with a bare
  "yes" inside those ten seconds is told the question is over.
- **Undo:** `LATE_MS` in `capsule/lib/voice-mode.ts`; `ABOUT_HEAD` in
  `persona/lib/about.ts`.

### D195. A "no" with no pause after it is left as said; the model's answer may not copy a correction in; a correction is one fix

- **Date:** 2026-11-15. `v09/voicejoin`, from the sentences spoken into
  the VM's microphone (`27-dictation-join`).
- **Question:** three things only sound showed. The recogniser writes
  Spanish corrections without the second comma ("tres opciones, no
  cuatro opciones", "a las cinco, no digo a las seis"), and the model
  mends only the form with it. One answer copied the correction in
  beside itself ("the green one, actually the green one") and passed
  every check. And the capsule said "4 fixes" for one correction.
- **Choice:**
  - A comma is put back for the model only where a **second cue** says
    it is a correction: "no digo", "no perdón", "no espera", "o sea, no"
    (not "o sea, no sé", where "o sea" stays a filler the rules take
    out). A bare "X, no Y" is never touched and no longer a reason to
    ask: in Spanish it is "X, not Y" as often as a correction. Given
    the comma, the model turned "Quiero el azul, no el rojo" into
    "Quiero el rojo" on the evaluation set: the opposite of what was
    said. The words cannot tell the two apart; the voice's pause can,
    and when the recogniser writes it (", no, …") the model is asked.
  - A new check, `repeated`: no word of four letters or more may be
    said more often in the answer than the speaker said it.
  - The capsule counts places changed, not words: "1 fix".
- **Measured** (the whole set through dictation as joined, on the
  processor: `out/joined-set.txt`): 100 of 138 self-corrections land
  right (6 by the rules, 94 by the model; 8 more are right but for a
  number the rules write in figures), no sentence that was right is
  changed by the model, 156 of 370 sentences are asked, median 0.23 s.
- **Cost:** a Spanish correction said with no pause after the "no" lands
  as said. Raw and Undo are on the capsule; saying "no, digo" or
  pausing fixes it.
- **Undo:** `withPauses` and `CUES` in `dictation/lib/gate.ts`;
  `repeatsNothing` in `rewrite/checks.ts`; `placesChanged` in
  `dictation/lib/rewrite.ts`.

### D196. "o sea, no" with no pause after it is left as said, like a bare "no"

- **Date:** 2026-11-15. `v09/voicejoin`, reviewing D195 against the
  evaluation set and sentences it does not hold.
- **Question:** D195 made "o sea, no" a cue for the model even with no
  comma after the "no", and put a comma back before asking. The 370
  pairs hold no plain "o sea, no …" sentence, so nothing measured it.
  Said through the joined pipeline on the laptop's processor, "Lo
  hacemos mañana, o sea, no podemos hoy." landed as "Lo hacemos hoy, o
  sea, no, podemos hoy." (meaning turned round, and the comma meant only
  for the model typed into the field), and "Llego tarde, o sea, no llego
  a la reunión de las nueve." lost its "no".
- **Choice:** "o sea, no" is a cue only with its pause written ("mañana,
  o sea, no, pasado mañana"), which the cue for a "no" between two
  pauses already catches; `withPauses` puts a comma back only after
  "no digo", "no perdón", "no espera", "no sorry", "no wait". "o sea"
  before an unclear "no" stays in the text (the rules do not take it out
  as a filler). It is the same reason as D195's bare "no": "El martes, o
  sea, no el lunes" is "Tuesday, that is, not Monday" as often as a
  correction, and the words cannot tell.
- **Measured:** the 370 pairs are unchanged by this (`withPauses` touches
  three of them, all "no sorry"/"no perdón" chains, and gains one, "3, no
  4, no sorry 4:30"); restraint 135 of 142 right as heard, the 7 broken
  by the rules' figures and lists, none by the model; self-corrections
  99 by rules and model of 138.
- **Cost:** "El paquete llega mañana, o sea, no pasado mañana." said
  without a pause after "no" lands as said (in the VM it had been
  corrected). Raw and Undo stay; saying "no, digo" fixes it.
- **Undo:** `withPauses` and `CUES` in `dictation/lib/gate.ts`.

### D197. A filler tells no language and starts no turn

- **Date:** 2026-11-15. `v09/voicejoin`, from the assistant's own report
  of a session on the owner's laptop (`assistant-feedback-2026-11-15.md`,
  section 4): "Um" and "Uh uh" were told as Portuguese, and "Um", "Okay"
  heard when Dashi listened by itself woke the agent for a whole turn.
- **Choice:**
  - The shell keeps the conversation's language (`voice/lib/fillers.ts`,
    `KeptTongue`): the language the service tells is taken only when
    it is one the person turned on (English and Spanish by default,
    D160; `tonguesOn` in `voice/tongues.ts`) and the words hold three or
    more real words; otherwise the last confident one stays. Before any,
    a short reply in a language that is on is taken as told. The
    speaking side reads the same kept language (it already kept it for
    "OK."); a held key's words now count too (before, only listens that
    ended by themselves did). The service's own detector no longer
    weighs fillers either (`6fce6858`).
  - A listen Dashi opened by itself (after it speaks, D150) that hears
    only sounds ("um", "uh", "eh", "hmm") or a nod ("okay", "ok",
    "vale") ends there, as silence does: no turn of the model. A nod
    after an answer that ended in a question is the answer, and goes.
    An agent's question (`ask_person`) always takes what is heard. With
    the key held, what is said is always sent.
- **Why:** a turn costs a model call and an answer the person did not
  ask for; a language no one turned on cannot be the answer's.
- **Undo:** `fillerOnly` and `KeptTongue` in `voice/lib/fillers.ts`;
  the `heard` case in `voice/voice.ts`.

### D198. The assistant hears the person's words as dictation writes them; the computer's names join the vocabulary

- **Date:** 2026-11-15. `v09/voicejoin`, from the same report: the session
  heard "D tree code" for T3 Code, "SBODYDECH" for Bodytech, "Meeting"
  for Mirin.
- **Choice:**
  - What the Dashi key's listen hears goes through dictation's
    replacements and vocabulary (`Lexicon.spell`: whole-word forms,
    capitals, a near non-word; no tidying) before the assistant is
    asked. The context's "The person uses:" line names dictation's
    vocabulary (the person's file, then the computer's names), the apps
    left to their own line, at most 60.
  - The computer's names (`knownTerms`, `boot/known-names.ts`): the
    installed apps that are names, the folders at the top of the home
    and at the top of a folder that holds projects (`~/Developer`,
    `~/Projects`, `~/code`…; the owner keeps every project one level
    down, so the home's top alone names none of them), one word of
    three letters or more and no dictionary word ("dashiOS", "mirin";
    not "Documents", "v09", "smoke-0.9"); and every site the person
    allowed agents, by its name ("bodytech.com.co" → "Bodytech", heard
    as "body tech" when it splits into two dictionary words). They are
    kept beside the vocabulary file, never written into it, and looked
    at again every five minutes: a person who removes one in Settings
    removes it from their file, and it is not put back there. Dashi's
    own words lead them, so a file written before one was added still
    hears it ("T3 Code"; "Dashi agent", heard "dash agent" and "dashing
    agen" in the owner's rows 41, 42 and 52).
- **Cost:** a misheard word that is not near any name still reaches the
  assistant as heard ("Meeting" for Mirin: an ordinary word is never
  replaced by rule); the names line tells the model to doubt it.
- **Undo:** the `asker` in `boot/voice.ts`; `names` in `boot/assistant.ts`;
  the `known` option of `Lexicon`.

### D199. A listen never ends while the person still speaks: the held span is heard whole, the key-up waits for the voice, a turn needs a real pause

- **Date:** 2026-11-15. `v09/voicejoin`, from the owner: "mine was being
  cut even though I'm talking to the microphone", and corpus rows 41, 42
  and 47 ("firs", "experienc", "agen", "r design").
- **What was found**, every way a listen ended while the person spoke:
  - **The gate dropped quiet speech.** Every listen gave the recogniser
    only what the voice detector called speech, with 256 ms before each
    phrase. Fed a sentence at -30 dB under -50 dBFS of noise (a laptop's
    microphone at arm's length), "Ask the agent." came back empty and
    "We need a redesign." as "Yeah."; the same sound given whole came
    back "Ask the agent." and "We need a design." Clean speech at any
    level was heard right either way. This is the "r design" shape.
  - **The key-up tail** was four frames (128 ms) whatever the voice did.
    Parakeet itself fills a clean ending cut 130 ms short ("first",
    "experience", "agent" all whole on the processor), so what is lost
    is what is still being said after those frames.
  - **Hands-free** listened for the next sentence only after the last one
    had landed, which waits for the model (up to 1.2 s): what was said
    meanwhile was never heard.
  - **The 6 s give-up** after Dashi speaks looked for words on the chip;
    the first words come up to 0.8 s after the voice begins, so a person
    who began at 5.5 s was cut off.
  - **A turn ended at 1.5 s of quiet**, short for someone who stops to
    think mid-sentence, as the owner does.
  - Not cuts: five minutes is the most a listen runs (logged as `max`);
    Dashi's own speech never ends a listen (a listen stops Dashi's
    speech, not the other way round).
- **Choice:**
  - A held key's listen hears every sample from key down to key up; the
    detector only says whether anyone spoke (with no speech, nothing is
    sent: silence is never turned into words). A listen that ends by
    itself keeps the gate, now with 480 ms before each phrase.
  - After key up, at least 192 ms more, then on while the detector still
    hears the voice (until two quiet frames), up to 384 ms.
  - Hands-free opens the next listen at once, then lands the sentence.
  - The service tells `speech` once the detector hears the person begin;
    from then a listen that ends by itself is never given up on.
  - The end of a turn: 1.8 s of quiet after Dashi speaks or after a tap
    (was 1.5); a hands-free sentence stays 1.2 s, since a pause there
    only starts the next sentence and loses nothing now. The quiet is
    counted only in frames the detector calls quiet (under 0.35): a
    voice it still hears never ends a listen.
  - Every listen's end is logged, by the service and the shell:
    `listen ended reason=key-up(224)|silence(1824)|max|stopped|closed|gave-up heard_ms=… model=parakeet-v3`.
- **An end-of-turn model:** worth it next, not here. Smart Turn (Pipecat,
  BSD 2-Clause, about 8 MB, a few ms a turn on the processor) tells a
  finished sentence from a thinking pause by its sound, so a turn could
  end at 0.6 s when it is finished and wait 3 s when it is not. It
  needs its own measurement on the owner's Spanish and English; the
  fixed 1.8 s is the safe side meanwhile.
- **Cost:** a held key's dictation sends the silence it held to the
  recogniser (Parakeet does not make words of it; measured on fed
  silence and quiet rooms); 64 to 256 ms more after key up; an
  assistant's turn starts 0.3 s later.
- **Undo:** `whole` in `service/capture.rs` and `engine/gate.rs`;
  `TAIL`, `TAIL_MOST` in `service/capture.rs`; `LEAD` in `engine/gate.rs`;
  `sentence` in `dictation/lib/hands-free.ts`; `spoke` in
  `voice/lib/mic.ts`; `TAP_QUIET_MS` in `voice/keys.ts`.

### D200. The person chooses the models: the recogniser, and what corrects dictation

- **Date:** 2026-11-15. `v09/voicejoin`, from the owner: "I would also like
  to choose the model, because I want to experiment what will give the
  best results."
- **Choice:** two rows in Settings › Voice, each choice with its size,
  its licence and what it was measured to do:
  - **Recogniser** (`voice.recognizer`): Parakeet TDT 0.6B v3 (the
    default) or Whisper large-v3-turbo, which dashi-voice already had
    for the languages Parakeet lacks. `listen` takes `model`; Whisper
    hears only when its set ("More languages", 1.04 GB, MIT) is here,
    else Parakeet does and the row says why. Nothing new is fetched.
  - **Corrected by** (`dictation.corrections`): SpeakoFlow Mini Q4 (the
    default, 542 MB), Gemma 4 E2B Q4 (3.1 GB; the rewrite engineer's
    second, a set of its own, `rewrite-gemma`, pinned by commit and
    checksum, Apache 2.0 since Gemma 4), the rules alone, or Claude
    Haiku 5.5 with the person's own key from Settings › Agents. A local
    choice is fetched by the row under it; a change stops the server
    that ran (one at a time), and the next dictation starts the chosen
    one, with its own speed test. Claude is sent the same prompt and its
    answer passes the same checks; the words land first and are
    corrected after (`refine`), and the row says that what is dictated
    goes to Anthropic. Thinking off, effort low, no sampling parameters.
  - Every listen and every correction says its model in the session's
    log (`listen ended … model=parakeet-v3`, `dictation corrected
    model=gemma-4-e2b-q4 result=text ms=…`), so experiments compare.
- **Why:** the measures disagree by kind of mistake (SpeakoFlow Mini for
  self-corrections, Gemma for fillers and names), and the owner's own
  speech is the test no set has.
- **Cost:** Claude's choice is not scored on Dashi's set yet; Whisper's
  speed on the processor is not timed. Gemma holds 4.3 GB while it runs.
- **Undo:** `voice-choice.tsx`; `dictation.corrections` and
  `voice.recognizer` in `settings-app/sections.ts`; `startRewriter` in
  `rewrite/start.ts`; `REWRITE_GEMMA` in dashi-voice's manifest.

### D201. Formatting: what the rules do, what each model does, and a run-on is fourteen words

- **Date:** 2026-11-15. `v09/voicejoin`, from the owner: "I would like also
  the system to do some formatting." The test is corpus row 22, a whole
  message with no punctuation.
- **What does what** (measured on the laptop's processor, through
  dictation as joined, Writing, Email, Chat and Developer profiles):
  - **By rule, every model:** a list from "first… second… third…" (and
    "primero…", "one, two, three") is a numbered list in Writing, Email
    and Chat, never in a terminal; a spoken "new paragraph" / "nuevo
    párrafo" is a paragraph; Email puts the greeting on its own line;
    spoken punctuation, capitals, fillers.
  - **By the model:** a run-on broken into sentences. **Gemma 4 E2B does
    it** ("…confirm the delivery date. After that, send the contract…",
    and in Spanish a comma where the thought turns); **SpeakoFlow Mini
    does not**, with or without examples in the prompt: two examples of
    a run-on made into sentences changed none and cost three
    self-corrections of the 370, so the prompt stays as scored.
  - **Not done:** a paragraph where the subject changes. The checks refuse
    any line the model adds (D174, so an answer cannot lay a message out
    on three lines in a field that sends on Return), and no model was
    measured placing them. Say "new paragraph".
- **Choice:** the gate's run-on mark goes from twenty words with no mark
  to fourteen. Row 22 (nineteen words after the rules) is now sent; with
  SpeakoFlow Mini the 370 pairs score the same (restraint 135 of 142,
  none broken by the model; self-corrections 99), 8 more sentences wait
  for the model (164 of 370, median 0.39 s). Row 22 still lands as said
  with SpeakoFlow Mini and gains only its full stop with Gemma: its
  wanted form (a quotation inside it) is beyond both.
- **Undo:** `RUN_ON_WORDS` in `dictation/lib/gate.ts`.

### D202. An answer that keeps a cue must keep what followed it

- **Date:** 2026-11-16. `v09/voicejoin`, from the installed packages in
  the VM: "Quiero un café con leche, mejor dicho, un té." landed "Quiero un
  té con leche, mejor dicho." The model moved the later words before the
  cue, kept the cue, and every check passed it. (On the laptop the same
  sentence comes back right; the session's longer vocabulary changes the
  answer.)
- **Choice:** a check, `after-cue`: when the answer still holds a cue word
  past a change, the words after it must be the words that followed it
  when said. A cue in the untouched start of the sentence is no cue
  ("Quiero tres cafés": "quiero" as in "quiero decir").
- **Measured:** the 370 pairs: no right answer refused, restraint 135 of
  142, self-corrections 101 by the model (99 before; the model's answers
  vary by one or two between runs).
- **Undo:** `keepsAfterCue` in `rewrite/checks.ts`.

### D260. Only critical operations ask; everything else runs, says what it did, and offers Undo

- **Date:** 2026-11-16. `v09/askagent`. The owner: "we are over asking
  for permissions, permissions should be only for critical operations"
  (`v09/briefs/consent-critical-only.md`). One rule for Dashi's own
  assistant (voice and the launcher) and for agents from outside.
- **Question:** D148's table asked a spoken yes for closing a window,
  dismissing a notification or choosing a menu item; a first-use sheet
  named every scope; each site was asked about the first time; Trash and
  the clipboard history asked every time; an outside agent met a sheet per
  kind of tool. What asks now?
- **Choice:**
  - **Critical, asks every time, on screen, answered by the person's own
    pointer or key:** money (`pay`, fingerprint or password, as before);
    identity and secrets (`sign_in`, `fill_code`: the login sheet, as
    before); losing work for good (`force_quit_app`); changing the system
    (`request_software_install`, `request_software_update`); speaking for
    the person to others (no such tool yet: one that comes is marked
    critical). The registry's `ASKS_EVERY_TIME` (`actions/tools.ts`) is
    now exactly the critical tools without a sheet of their own: force
    quit and the two software tools. **A new tool that is critical by this
    list goes there; the engineers adding tools (`v09/reach`,
    `v09/windowtree`) mark theirs by this rule.**
  - **Everything else runs:** seeing, opening, clicking and typing,
    closing a window (the app asks to save if it must), notifications,
    menus, Spaces, settings (with Undo), notes and events, moving files to
    the Trash (`trash_file` no longer asks: the Trash is the undo, and the
    tool tells the model to say what it moved), the clipboard history, a
    site used for the first time (`askSite` no longer asks anyone; Dashi's
    assistant still says it in its step line).
  - **No first-use sheet for Dashi's own assistant**
    (`agents/assistant/lib/first-use.ts` is gone): choosing who answers in
    Settings is the consent. Its policy holds every scope.
  - **Outside agents: one sheet, the first time a program calls a tool**:
    "<it> wants to use this computer", every scope at once, kept for that
    program on Always Allow (`session-scopes.ts` `ask`). No per-scope and
    no per-site sheets after it. `NEVER_KEPT` is empty: a payment asks with
    the fingerprint or password whatever was kept.
  - **The spoken yes is gone** (`session-assistant.ts`): what it covered
    is not critical. A critical step of a **typed** turn asks on the
    launcher's line (No, Yes, Return for yes: D261); of a spoken one, on
    its sheet, as before.
  - **Work alone** is for unattended runs; with nothing else asking it
    matters only for the critical list. It still never covers payments and
    sign-ins; force quit and software stay out of it too (the brief allows
    covering installs; not built: stricter is the safe side).
  - The instructions agents read on connect and the tools' words say so;
    the tools/list golden (`test/fixtures/mcp-tools-list.json`) is new.
- **Why:** a sheet for ordinary work trains the person to press Allow
  without reading, which makes the sheets that matter weaker.
- **Cost:** an agent the person allowed once can close windows, read the
  clipboard history and move files to the Trash without another word; the
  activity list, the one bar indicator and Undo are what the person has.
  Return on the launcher's line is a yes from the keyboard (D193 keeps the
  sheets off Return; this line is in the launcher the person typed into,
  which holds the keyboard and which no agent's key reaches).
- **Undo:** put the tools back in `ASKS_EVERY_TIME`; restore
  `needs`'s per-call scopes in `Scopes.ask` and `askSite`'s sheet; bring
  back `first-use.ts` and `session-assistant.ts` from `143d88ab`.

### D261. One Dashi agent, by voice or typed in the launcher; nothing of it in the bar at rest; no plans

- **Date:** 2026-11-16. `v09/askagent`. The owner: "I don't like the
  applet that is in the top, it's useless"; "if I'm using the launcher to
  ask something to AI, it's specifically to the Dashi agent"; "we need a
  unified experience … and not these plan things". The design's direction
  A (`dashi-0.9.0-design/askagent/`), chosen by the owner, with his
  answers to its seven questions.
- **Choice:**
  - **The bar:** the field (D68) and the job capsules (D69) are gone, with
    `menubar/field.ts`, `jobs.ts`, `start-pill.tsx`, `lib/field-row.tsx`,
    `lib/job-capsule.tsx`, `lib/bar-jobs.ts` and the hub's bar cell and
    port. D138's one indicator stays, shown only while something acts that
    the person is not already watching: an agent from outside, a run, or
    Dashi kept working on its own (`menubar/pill.ts` `foreground`): a turn
    in the capsule or the launcher is not in the bar. A click opens the
    agents' panel. "Working" stands beside the spark for a run.
  - **One path in the launcher:** one Ask Dashi row (⇥, or the row; an
    empty ⇥ opens the conversation's empty view). No plan, no hand-off
    rows, no harness to pick, no grants card, no context chips (what is in
    front goes with every ask anyway, D149). The machinery underneath
    stays: runs, outside agents.
  - **The launcher is the conversation's view** (`launcher/lib/talk/`):
    the same panel, the field moves to the bottom (the one chrome row),
    the thread above grows to the launcher's surface (540 points of thread)
    then scrolls, kept at its newest line. Its first line names the model.
    Each Dashi turn is under the persona's mark and name; step lines are
    one line each (a ring, then ✓ or ✗), folded into "N steps" when the
    answer has come, a press opens them; the words stream in as written,
    paragraphs, lists, code and pressable links. Spoken turns are marked
    "Said" and "spoken".
  - **One transcript** (`agents/assistant/transcript.ts`) holds every
    turn of the one conversation, spoken or typed; a typed ask is
    `assistant.type()`, the same loop, the same conversation and the same
    server as voice.
  - **Keys:** Return sends; Esc closes the launcher and the turn carries
    on, the conversation open (D147); ❖Esc stops the turn at work (the
    launcher takes it only while one works); ❖↩ is **Keep working on it**.
  - **Keep working on it** gives the turn at work room for a longer job
    (200 calls and 30 minutes more), lets the launcher close, shows it in
    the bar's indicator, and a notification says when it is done, with
    Show (the launcher on the conversation). **It is not the hand-off
    machinery:** the turn goes on in the same process and the same
    conversation, so the harness's session, the model's messages and the
    transcript are not lost, and it works for a key or a local model too,
    which a hand-off run (a harness only) does not.
  - **Questions in the launcher:** while the turn at work was typed, a
    critical step's yes (D260) and an agent's question in words wait on one
    line in the thread; Return is yes; words typed instead are a no and the
    next turn.
  - **Spoken answers are spoken; typed ones are not**, unless Settings ›
    Agents › Read typed answers aloud is on (off by default).
  - **Plans:** the launcher never shows one. "Ask before every step" is
    gone from Settings and from voice. GPT, which has no loop, keeps plan
    mode by voice only; typed, it says "Not yet: GPT needs Dashi's loop";
    Settings hides it as an answerer and says so in one line.
  - **The empty view** offers the person's recent asks, else five tries.
- **After joining the dictation work (D170 to D202):** what is said goes to
  the assistant through dictation's vocabulary (D198); what is typed goes as
  typed (it was not misheard). A filler alone starts no turn (D197) and the
  microphone opens again only after a spoken turn: voice sees the
  conversation as open only while its last turn was spoken. A turn kept
  working shows in the bar as Dashi's spark and "Working", not as an outside
  agent's disc. "Sites agents may use" is gone from Settings › Agents (no
  site asks, D260); Work alone keeps its sites. A typed settings change
  offers "Type undo that".
- **Cost:** the context chips and the grants card are gone from the
  launcher; a hand-off run can no longer be started from it (its machinery
  is still there for runs that exist). A turn kept working lives in the
  shell's process: a shell restart ends it (a hand-off run would have gone
  on). Dictated words no longer land in a bar field (there is none).
- **Undo:** the commits on `v09/askagent` after `143d88ab`, by part.

### D262. The model Dashi's agent runs with: chosen per answerer, for typing and for speaking

- **Date:** 2026-11-16. `v09/askagent`. The owner: "I would like to have
  the option to choose which model is running the Dashi agent … for the
  voice experience I would also like to choose the model".
- **Choice:** Settings › Agents has two pop-ups, **When you type** and
  **When you speak** ("Same as typed" unless chosen), kept per answerer in
  `agents.models` (`{ "claude-code": { typed: "opus", spoken: "haiku" } }`).
  Claude Code's are its own aliases (`claude --help` 2.1.325: `--model`
  takes an alias such as fable, opus or sonnet, or a full name; Haiku is
  offered as an alias too) and its own default; Codex's its `--model`
  (from its documented flag, **untested**: Codex is not on the laptop);
  an Anthropic key's the provider's own `/v1/models` list; Ollama's what
  `/api/tags` lists. **Each turn uses its own channel's model**, read when
  it starts, so a change in Settings applies from the next turn of an open
  conversation; for Claude Code that is `--resume` with the new `--model`
  (the flag is taken with `--resume`; not run with a real prompt here).
  The launcher's thread names the model on its first line; the log line
  says `model="Claude Code · opus"`, so the owner can compare.
- **Cost:** a full model name typed by hand ("A model's full name…") is
  not built: a name that is not offered can be put in settings.json. A
  conversation that changes model between turns gives the second model
  the first one's thread.
- **Undo:** drop `models` from settings; `modelFor` returns null.

### D270. `wait_for` is one tool; the page waits on itself, a window and a file wait in the shell

- **Date:** 2026-11-15. `v09/reach`. The assistant's own report: "I polled
  read_page over and over while Facebook said Loading."
- **Question:** a tool per thing to wait for, or one; and who watches?
- **Choice:** one tool, `wait_for`, with exactly one of `text`,
  `text_gone`, `element` (+ `state`: present, enabled, gone), `page`
  (loaded, quiet), `window_title`, `file`; `timeout` 10 s by default, 60 at
  most. A page's wait is one request to the extension: the content script
  watches with a MutationObserver (text read again at most every 60 ms,
  "quiet" is 500 ms with no change), a load with `webNavigation`; a page
  that navigates mid-wait is waited on again in its new document until the
  same deadline. The compositor has no title-changed event, so a window's
  title is looked at on every compositor event and every 250 ms in the
  shell; a file on every change in its folder (`fs.watch`) and every
  500 ms. The scope follows what is waited for (`ToolDef.scopeFor`): a page
  "web", a window "see", a file "files". A wait that runs out is not an
  error: `met: false`, with what it saw.
- **Why:** one tool is one line in the model's list (the list must stay
  readable) and one thing for the prompt to say.
- **Cost:** a title that changes and changes back within 250 ms is missed.
- **Undo:** take `waitTools` out of `TOOLS`; the extension's `wait`
  method stays harmless.

### D271. Acting tools say what changed, read from the page; sign-in's outcome is read from the page after Return

- **Date:** 2026-11-15. `v09/reach`. The assistant: "sign_in said submitted:
  true even though login never finished"; "click_element navigated: false
  with no hint whether the click did anything".
- **Choice:** the content script starts a MutationObserver just before a
  click, a key or a choice, and reads it once the page has been quiet
  300 ms (1.5 s at most): changed near the element (its form, list item,
  row, section or three levels up), elsewhere, or not at all; a dialog
  that opened (`dialog[open]`, `role=dialog`, `aria-modal`); the first
  200 characters of new text; the element still there and what it is now;
  where the focus went. A load, seen by `webNavigation`, wins over these.
  `fill_element` says the field's value after. `open_url` says the final
  address and whether it is a sign-in page (a password field shows, or the
  redirect's path says login/auth/accounts) or a CAPTCHA. `sign_in` and
  `fill_code` with `submit` on a browser tab watch the page up to 15 s
  after Return (across navigations) and classify, by rule
  (`page/outcome.ts`): a CAPTCHA frame or words first, then the site's
  words for a block, then an error alert while the field still shows
  (wrong), then a code field or words (a code is asked for), then the
  field gone once the page is quiet (signed in, saying whether the address
  changed); at the deadline, still loading or unchanged. In a native
  window nothing can be seen: it says so and asks for a screenshot.
- **Why:** a model reads the result as the truth; "submitted" made it wait
  and poll.
- **Cost:** a JavaScript `alert()` blocks the page's scripts, so a click
  that opens one answers after the 1.5 s cap with no change seen. Error
  words are English and Spanish only; another language reads as
  "unchanged" with the alert's text, which still says what the site said.
  A sign-in watched 15 s holds the agent's other calls that long.
- **Undo:** `after()` in `background/methods.ts`; `afterSubmit` in
  `secrets/broker.ts`.

### D272. An element keeps its number through a redraw when its key was one element's; a stale number's error carries the page around it

- **Date:** 2026-11-15. `v09/reach`. "Element numbers go stale after small
  changes, costing an extra read each time."
- **Choice:** a frame keeps, for each number, its element (as before) and
  the blocks it sat in (its form, list item, row, section, dialog or three
  levels up, then two more, then the body). The key of an element is its
  role, its name and a link's address. A new element takes a gone
  element's number only when that key was only ever given once in the
  document; keys shared by several elements ("Add to cart" ×10) never move
  a number. A call on a gone number reads the nearest of its blocks still
  in the page (3,000 characters, 40 elements): if that read gives the
  number back to a redrawn element, the call acts on it; otherwise the
  error says it is gone and carries that text, renumbered into the tab's
  numbers by the background. A number whose page navigated carries the new
  page's top, as much.
- **Why:** each stale number cost a whole read_page; the region is what
  the model was working on.
- **Cost:** a redrawn element whose name changed ("Sign in" → "Signing
  in…") gets a new number. A click on a redrawn element is the element the
  page shows now, which is what was meant.
- **Undo:** `Numbering.take` always a new number; `target()` in
  `content/main.ts` back to the plain error.

### D273. read_page has modes (all, main, find, items), and every answer is cut at 15,000 characters with a cursor

- **Date:** 2026-11-15. `v09/reach`. "read_page dumps entire long pages
  (footers, legal links, suggestions)"; "listing Marketplace results meant
  reading raw link text".
- **Choice:** `mode` `all` stays the default, but its answer is cut at
  `max_chars` (15,000, about 4,000 tokens; 1,000 to 60,000) at a line's
  end, with one line naming the `cursor` (a character offset) for the next
  part, and pointing at `main` and `find`. `main` reads only the page's
  own frame: `<main>` or role=main, else its one article (or one article
  holding 60% of all of them), else from the body down the block holding
  70% of its parent's text, never one under half the page's or with fewer
  than two elements; landmarks inside are left out. `find` is done in the
  shell on the whole text: three lines each side of a match, runs joined.
  `items` is the container whose children most often share one shape
  (tag, class, role) and hold a link, scored by count × their text (15 to
  200 characters); each row's title is its heading, else its first line
  that is not a price, else its link's words; a price is found by its
  form (a currency sign or code, or "free"); the rest are details, four
  at most. No model anywhere.
- **Why:** the read was the costliest call in the assistant's session.
- **Cost:** a cursor is an offset into the text of the page as read now;
  a page that changed between parts may repeat or skip a few lines. A
  page whose grid is built of identical anonymous `div`s inside other
  lists can pick the wrong container; `all` and `find` still work.
- **Undo:** `PAGE_PART` to 60,000 and the default mode stays `all`.

### D274. Tab tools; closing a tab never asks; list_tabs names every tab to an agent that may see windows

- **Date:** 2026-11-15, changed 16 Nov by the owner's rule ("permissions
  should be only for critical operations": the `v09/askagent` decision).
  "I closed Facebook with a ❖W keystroke and hoped it hit the right tab."
- **Choice:** `close_tab`, `reload_tab`, `go_back`, `go_forward`, all "web",
  none `destructive`: closing a tab is not on the critical list (no money,
  secret, lasting loss, system change, or speaking for the person), so it
  just runs and says so. A connection keeps the tabs it opened (open_url
  without `tab`, a link that opened one) and `list_tabs` marks them
  `yours`; the description asks a model to close the person's tabs only
  when they ask. `list_tabs` gives title and address for every tab when
  the agent may see windows (Helium's window titles name the tab in front
  anyway) or was allowed the site; else the site only.
- **Before the rule (not kept):** a per-call yes for the person's tab
  (`RunContext.yes`); taken out the same day, so consent has one mechanism.
- **Cost:** a tab with unsent typing closed by mistake loses that typing;
  Helium's ⇧❖T brings the tab back.
- **Undo:** take `tabTools` out of `TOOLS`; `row()` back to `about()`.

### D275. Agents read text files and write, move, copy and rename files; a replaced file goes to the Trash; one list of secret places

- **Date:** 2026-11-15/16. `v09/reach`. "I can list and search files but
  can't read their contents"; "No writing files outside Notes. No move,
  copy, rename."
- **Choice:** `read_text_file`, `write_text_file`, `move_file`,
  `copy_file`, `rename_file`, all scope "files" (no new scope: the owner's
  critical-only rule of 16 Nov drops per-scope sheets), none
  `destructive`: a name already taken is refused unless `replace` is said,
  and then what is there goes to the Trash first (`gio trash`), which is
  the Undo. Paths: the home folder and removable drives as `list_folder`,
  a new path placed by its existing folder. The secret places are one list
  (`shared/files/secret-places.ts`): `list_folder`'s hidden folders, plus
  browser profiles and names that say key, password, token or history;
  `wait_for {file}` keeps to it too. A PDF is read through `pdftotext`
  (poppler-utils, GPL, run as a separate program, never linked) when it is
  installed. No command runner: docs/actions.md, "Files", says what one
  would need.
- **Why:** the owner's rule puts files the person can get back outside the
  critical list; the Trash makes every write one they can.
- **Cost:** `append` changes a file with no copy kept (only what was
  added can be removed, by hand). A secret kept under another name
  (`passwords.txt`) is not caught by the names. `trash_file` still asks on
  a sheet: the registry's ask-every-time list is the `v09/askagent`
  engineer's to change.
- **Undo:** take `fileTextTools` out of `TOOLS`.

### D276. copy_to_clipboard writes through the clipboard history, named Dashi; it does not ask

- **Date:** 2026-11-16. `v09/reach`. "Clipboard is read-only (and asks
  every time). No clean way to put text on the clipboard for the person."
- **Choice:** one tool, scope "act", not destructive: the copy is added to
  the history as from "Dashi" before it is written, and the watch keeps
  that entry when the copy comes back. With the history off, it is only
  written.
- **Why:** the owner's critical-only rule: what was on the clipboard is
  still in the history.
- **Cost:** with the history off, the person's last copy is replaced with
  no way back.
- **Undo:** take the tool out of `clipboardTools`.

### D277. tell_person speaks a line without ending the turn; notify_person posts a notification; neither asks

- **Date:** 2026-11-16. `v09/reach`. "During long jobs the person hears
  nothing until the end"; "No way to notify the person on my own."
- **Choice:** `tell_person` goes through the voice's own `say` (each
  sentence its own queued `speak`, D146), at most one every 4 s, and not
  while the person talks or dictates or the microphone is open; a line it
  can't say is shown only, never queued (a queued progress line is stale
  when it plays). It shows as the capsule's step for the assistant, as the
  status for others. `notify_person` is a plain notification from
  "Dashi". Scope "act", nothing destructive (the critical-only rule).
- **Cost:** an outside agent's line is said in Dashi's voice: the person
  hears it as Dashi. The menu bar's mark names the agent while it works.
- **Undo:** take `tellTools` out of `TOOLS`.

### D278. Notes and events can be changed and deleted; each change says what was there, each delete keeps a way back

- **Date:** 2026-11-16. `v09/reach`. "No calendar edit or delete, no note
  edit or delete (append only)… tasks like 'move my meeting' are
  impossible."
- **Choice:** `edit_note` (one way per call: an exact text there once, a
  range of lines, or an insert; or only a new title), `delete_note` (Notes'
  Recently Deleted), `edit_event` (the whole event; a repeat's every
  occurrence; a moved start keeps the length), `delete_event` (an .ics copy
  to the Trash first, which Calendar imports back). Each result says what
  was there before. Scopes `notes_write` and `calendar_write`, renamed
  "Change your notes" and "Change your calendar". None `destructive`.
- **Cost:** one occurrence of a repeat can't be moved alone yet. The
  assistant's spoken "Undo that" doesn't reach these: the registry has no
  Undo for a tool other than `set_setting`, and adding one is
  `v09/askagent`'s (its README is told).
- **Undo:** take `editTools` out of `TOOLS`.

### D279. Files reach a page's file field with no chooser; downloads are the browser's own list; the extension gains `downloads`

- **Date:** 2026-11-16. `v09/reach`. "No downloads or uploads: can't save a
  file from a page, attach a file to a form, or see the downloads list."
- **Choice:** `attach_file` (the shell reads the file under the same rules
  as `read_text_file`, sends base64 in 512 KB chunks, the content script
  sets the field's files and fires input and change); `list_downloads`
  (`chrome.downloads.search`); a click watches `downloads.onCreated` and,
  when it starts one, answers with where the file landed once complete
  (60 s at most), instead of waiting for a load that never comes. The
  manifest gains the `downloads` permission: a policy-installed extension
  gets new permissions without a prompt. Not destructive: attaching sends
  nothing; submitting a form to someone stays the critical list's.
- **Cost:** 25 MB at most per file; a site that reads files only from its
  own drag-and-drop zone (not an `<input type=file>`) is not reached.
  The packaged extension's version must move with this change (D117):
  `bin/dashi-browser-pack.ts --version` for a development build; a
  release bumps every version together (H14).
- **Undo:** take `transferTools` out of `TOOLS`; the permission stays harmless.

### D280. A page element with nothing inside: its picture is the tab's, cropped; a point of it is clicked with the agent's real pointer

- **Date:** 2026-11-16. `v09/reach`. "canvas or custom widgets (the Lichess
  board) are invisible. I played chess by rewriting the whole PGN."
- **Choice:** `screenshot_element` captures the visible tab in the browser
  and crops it to the element there (the compositor can't crop a window's
  picture, and a screen area would show what covers it); since that
  picture skips the agents' mask, it is refused when any secret field
  overlaps the box. `click_in_element` takes fractions of the box and
  clicks with the agent's own pointer in the browser's window (a trusted
  click, the same `agent-input` as `click`); inside a frame it dispatches
  page events instead and says some pages ignore them.
- **What it doesn't solve:** reading the board (the model reads the
  picture), drags, a frame's trusted click, timing (a game clock).
- **Undo:** take `canvasTools` out of `TOOLS`.

### D281. list_windows and click say what kind of field has the keyboard, from AT-SPI's focus, never the field's name

- **Date:** 2026-11-16. `v09/reach`. "Can't tell which field has focus in a
  native window before typing."
- **Choice:** the focused window in `list_windows`, and a left click's
  window 150 ms after, ask the accessibility bus Dashi's sign-in already
  uses: the app's last focus event (`Atspi.focusedIn`), still focused
  (`fieldAt`), as "text field", "password field" or "no text field".
  Bounded: 600 ms to the bus, 300 to each answer. The element tree of a
  window (`read_window`) is `v09/windowtree`'s; this is only the one fact
  an agent needs before `type_text`.
- **Cost:** an app that never sent a focus event since Dashi joined the
  bus says nothing; Chromium-family apps publish focus only once woken.
- **Undo:** drop `keyboardIn` from `listWindows` and the click.

### D240. Notes draws its Markdown by showing the field a projection of it, laid against the source piece by piece

- **Date:** 2026-11-15. `v09/notesmd` (brief t3, the owner's assistant's
  feedback of 15 Nov, section 8).
- **Dilemma:** the note is plain Markdown (an agent and a text editor read
  and write it), and the owner wants it drawn as what it means: no `##`, dots
  for dashes, boxes, tables. mirin's `TextInput` draws styled runs over its
  value but cannot hide or replace a letter, and its runs have no font family.
- **Decision:** the field's value is not the Markdown but what it means
  (`apps/notes/lib/project.ts`): markers left out, a dash shown as `•`,
  `- [ ]` as `□`, a table's row as one space. A list of pieces lays the shown
  text against the source (`offsets.ts`), and everything the field reports
  is carried back before the model hears it: an edit is the one stretch that
  changed, replaced in the source; a caret goes before the letter after it,
  a range's end after the letter before it, so a selection of drawn words is
  their source, the markers outside it. The model, Undo, Find, the format
  commands and the file stay on the Markdown.
- **Why not** a block editor (a field per block, rendered views between):
  selection, copy, arrows and IME across blocks would all break. **Why not**
  wait for mirin: the gap is written for its agent
  (`dashi-0.9.0-review/30-notesmd/for-mirin.md`).
- **Cost:** the field's own copy would give the drawn words, so Edit's Copy
  and Cut write the source themselves (D244); a code block's text is the
  body's font on a panel, not monospace.
- **Undo:** give `Page` (`views/body.tsx`) `value={body}` and `markup`'s runs again.

### D241. The caret's block shows its Markdown; a selection keeps what was shown; a body not being edited shows none

- **Date:** 2026-11-15. `v09/notesmd`.
- **Decision:** a line is a block, and so are a whole table and a whole
  fenced code block (`blocks.ts`): the caret anywhere in one shows all of its
  source. While a range is selected the shown lines stay as they were, so a
  drag never moves the words under the pointer, and a caret shows its block
  only once it has stayed put 150 ms (`SETTLE_MS`): in the VM a click that
  changed the text under the still-pressed pointer left a one-letter
  selection. The body is "being edited"
  from a caret move or a key in it (or Return in the list) until Esc, the
  title, the list or the search take the keyboard (`NotesState.editing`); a
  note just opened is drawn whole.
- **Cost:** a heading or bullet moves sideways by its marker as the caret
  comes and goes (its height does not: the size is the paragraph's); a table
  entered grows to its source lines.
- **Undo:** `useRevealed` in `views/body.tsx`.

### D242. Tables, rules, code panels and quote bars are drawn under the field, in room the field keeps for them

- **Date:** 2026-11-15. `v09/notesmd`.
- **Decision:** the copy of the text that measures the field (it was there
  for its height) is laid out from the shown paragraphs and now draws what a
  field cannot (`views/page-under.tsx`): a table with its header on a wash,
  each column as wide as its longest cell asks (4 to 40 letters), cells that
  wrap, never narrower than its longest word (in the VM "Model" broke into
  "Mod el" beside a long first column), numbers right-aligned where the
  dashes say; a rule's line; a code
  block's panel; a quote's bar in the gutter. A table's rows in the field are
  spaces sized so their lines add up to the drawn table's height (a probe at
  100 px gives the line height per px). A cell's Markdown is drawn as plain
  words.
- **Cost:** the two layouts agree only as far as the copy wraps like the
  field (the copy's lines take one weight each).
- **Undo:** draw the copy in no ink again (`opacity: 0`).

### D243. Drawn markers are glyphs Inter has: `•` for a bullet, `□` and `■` for a box

- **Date:** 2026-11-15. `v09/notesmd`.
- **Decision:** every level of bullet is `•` in muted ink; an open box `□`
  muted, a ticked one `■` in moss with its words struck. `☐ ☑` are only in
  Noto Sans Symbols 2, a fallback the field's measure would not agree with.
- **Undo:** `BOX` in `project.ts`.

### D244. Copy and Cut in the note give its Markdown; a browser's rich text is pasted as Markdown

- **Date:** 2026-11-15. `v09/notesmd`.
- **Decision:** with the body being edited and a selection, Edit › Copy and
  Cut (and ❖C ❖X, which are their rows) write the selection's source with
  wl-copy, from the first line's marker when the selection starts at that
  line's words (the drawn page hides the marker, so a selection of the
  whole page would otherwise start after `## `); Paste reads `text/html` when the clipboard has it and puts its
  Markdown (`html.ts`: headings, emphasis, links, lists, quotes, rules, code,
  tables) in place of the selection, as its own Undo step. Plain text is
  pasted by the field as before. Elsewhere, or without wl-clipboard, the key
  goes to the field.
- **Undo:** `clipboardActions` in `hooks/use-notes-menus.ts`.

### D245. Typing makes structure; Tab indents a list item; Outdent is ❖[; Mark as Done is ⇧❖U

- **Date:** 2026-11-15. `v09/notesmd`.
- **Decision:** "[] " (or "- [] ") at a line's start becomes `- [ ] `; Tab
  in a list item moves the item a level in (two spaces, or a number's marker
  and a space) instead of typing a tab; Return after an opening fence puts
  the closing one under the caret's new line (`structure.ts`). Return in a
  list and an empty item ending it were already there. ⇧Tab is the field's
  (it leaves for the title, and mirin tells the app nothing), so Format ›
  Indent ❖] and Outdent ❖[ move the selected lines.
  A box ticks with a click or with Format › Mark as Done ⇧❖U (Apple Notes'
  key for it), on every item the selection touches.
- **Undo:** `structure()` in `typing.ts`'s `edit`, and the three Format rows.

### D301. "New bullet point" is an inline command; a spoken bullet is `•` in a plain field

- **Date:** 2026-11-16. `v09/fix-bullets-tables` (brief f1, review 32).
- **Dilemma:** said with no pause, "Things to pack new bullet point
  passport new bullet point charger" landed as "Things to pack New:" /
  "Passport New" / "Charger": the rule took "bullet point" and left "new",
  and Text Editor (Writing, plain lists) got bare lines, so nothing read as
  a list. D185 makes an instruction the whole utterance; Wispr Flow treats
  "new line", "new paragraph", "bullet point", "next bullet" inline.
- **Decision:** a formatting command is not an instruction: "new line",
  "new paragraph" (tidying already did) and now "new bullet point", "next
  bullet", "nueva viñeta", "otra viñeta", "punto nuevo" are taken inline,
  whole. One explicit form is enough for an item; a bare "bullet point"
  still needs a second. Never after an article. A lone one said first
  starts its own line, dropped where the caret is already at a line's start
  (`fit.ts`). A list is made inside each line said, so "new line" and
  bullets mix. Spoken bullets in a plain field are `• ` (the glyph Notes
  draws, D243), not bare lines: the person asked for bullets.
- **Cost:** "next bullet" at a sentence's end in prose becomes an item; a
  plain field gets a character Markdown does not read as a list.
- **Undo:** `BULLET`, `EXPLICIT` and `bulletMark` in
  `dictation/lib/lists.ts`; `LIST_ITEM` in `fit.ts`.

### D302. A spoken flag joins the words that make one flag, from a list

- **Date:** 2026-11-16. `v09/fix-bullets-tables` (review 32).
- **Dilemma:** "dash dash one line" typed `--one line`. Joining every
  word after a flag breaks `git commit --amend message`.
- **Decision:** the Developer profile joins the words after "dash dash"
  only where they make a known flag (`--oneline`, `--dry-run`,
  `--force-with-lease`, `--name-only`, …), after "no" (`--no-verify`), or
  where "dash" is said between them (`--name-only`). A second "dash dash"
  starts a flag of its own.
- **Cost:** a flag of two words not on the list still needs "dash" said
  inside it.
- **Undo:** `JOINED` and `flagName` in `dictation/lib/rules-code.ts`.

### D303. While keys come, what Notes shows as source stays source

- **Date:** 2026-11-16. `v09/fix-bullets-tables` (review 32).
- **Dilemma:** a table typed at 50 ms a key was saved as
  `| --- | ------ -- |`. The caret's block shows its source only once the
  caret stays put 150 ms (D241); typed fast it never does, so the revealed
  block was the one from before the burst, and the moment the dashes made
  a table it was drawn (each row one space) while keys still went into it.
  The field took the new text and typed the next keys into a row's space.
- **Decision:** a caret moved by the text changing is taken at once; the
  wait is only for a caret a click put down. While the text keeps changing,
  the lines that show their source only grow (a block the caret left by
  Return stays source) until the caret settles, then it is drawn. So the
  field's text is the typed text under the keys, at any speed, and an
  agent's typing is the same.
- **Cost:** during a fast burst over many lines, all of them show their
  Markdown until the typing pauses.
- **Undo:** `useSettled` and `useRevealed` in `apps/notes/lib/views/body.tsx`.


### D310. One start or one ❖N, one window: Text Editor brings back one draft

- **Date:** 2026-11-16. `v09/fix-new-window` (reviews 26, 27, 32, 33).
- **Dilemma:** Text Editor opened five windows on a launch and several on
  ❖N. A window started without a file brought back every kept draft no open
  window held, one window each (`main.tsx`), and New (❖N, the toolbar)
  started exactly such a window. Untitled text in a closed window is kept as
  a draft, so drafts piled up over passes, and every start or ❖N opened all
  of them again. The keys were handled once: the shell chooses one row of
  one process, and `launch_app` of an open app only brings it forward.
- **Decision:** New's window is started with `--new` and takes no draft. A
  plain start takes the newest draft only. The others stay kept, and File ›
  Open Drafts (enabled while there are any) brings them back, one window
  each, when the person asks. Nothing is lost and nothing opens unasked.
- **Cost:** a draft beyond the newest is one menu row away instead of on
  screen at the next start.
- **Undo:** `startingDraft` and `KeptDrafts` in `apps/editor/lib/drafts.ts`.
- **Notes, the same pass:** after ❖N the typing went to Search when the open
  note was an empty "Untitled": leaving it discarded its file, the new note
  took the same name, and `select` took it for the note already open (no new
  session, no focus on the title). `newNote` now forgets the note it left
  before opening the new one, so its title always takes the keyboard.

### D320. The Store's catalog is built on the computer, one source at a time

- **Date:** 2026-11-16. `v09/store` (brief s2; `scope/store` §3.9).
- **Dilemma:** 0.8's Software asked Flathub's web API on every key and knew
  nothing of Fedora, Terra or a COPR.
- **Decision:** `shared/software/catalog.ts` reads Flathub's own
  `appstream.xml.gz` (fetched daily with its ETag, kept in
  `~/.cache/dashi/software/catalog/`), Fedora's and RPM Fusion's AppStream
  files (`/usr/share/swcatalog/xml`), and dnf's cache for every enabled
  repository (`dnf5 repoquery --cacheonly`: every package, and the
  `application()` provides that make one an app). An app is matched across
  sources by its AppStream id, then its desktop file. One row per app;
  a package that isn't an app is a command-line tool, found only by its name.
  Each source is read on its own: one that fails leaves the others' rows.
  Parsed AppStream is kept as JSON keyed by its file's size and time.
  Measured on the laptop: about 0.5 s to read everything, 6 to 12 ms a search.
- **Cost:** Terra and COPRs publish no AppStream data, so their apps have
  the package's name and summary, no icon; an app whose ids differ between
  sources (Terra's `codium`, Flathub's `com.vscodium.codium`) is two rows.
- **Undo:** `Catalog` in `shared/software/catalog.ts`; the window's search
  goes back to `Listing` with `kind: "search"`.

### D321. When several sources have an app: Flathub, Fedora, Dashi, Terra, then a COPR

- **Date:** 2026-11-16. `v09/store`. The owner's order (16 Nov), written down.
- **Decision:** what is installed comes first; then Flathub, Fedora, Dashi's
  own COPR, Terra, then a COPR the person enabled or another repository.
  RPM Fusion counts like a COPR ("like any other enabled repository").
  `sourceRank` in `shared/software/sources.ts`.
- **Undo:** that one function.

### D322. Packages install and remove through PackageKit, one file deep

- **Date:** 2026-11-16. `v09/store`.
- **Dilemma:** PackageKit or dnf5daemon for a session that isn't root.
- **Found:** Fedora 44 ships PackageKit 1.4 with its dnf5 backend
  (`libpk_backend_dnf5.so`) and Dashi already depends on it; `dnf5daemon-server`
  is in Fedora's repositories but not installed (laptop, VM).
- **Decision:** `pkcon` with PackageKit's package id (`name;evr;arch;repo`),
  so the source the person chose is the one used. Repositories are turned on
  and off with `pkcon repo-enable/repo-disable`, Flathub with
  `flatpak remote-modify`. Who is asked is PackageKit's polkit rule:
  install, remove and a repository change ask (`auth_admin_keep`); an update
  from a source already on does not. That is the design's rule and D260's.
  Everything is in `shared/software/packages.ts` and `lib/package-cmd.ts`.
- **Undo / move:** those two files, to dnf5daemon's D-Bus API.

### D323. An app installed from one source is not swapped for another by a click

- **Date:** 2026-11-16. `v09/store`.
- **Decision:** the Source pop-up shows the app from any source; when it is
  installed from another, Get is off and the page says "Installed from
  Fedora. Remove that one first to get it from here." The design's swap
  sheet (remove one, install the other) is later work.
- **Undo:** `getAllowed` in `apps/software/lib/source-picker.tsx`.

### D324. Software is called Store; its id stays `dev.dashi.software`

- **Date:** 2026-11-16. The owner's call; how it is done is mine.
- **Decision:** the window, the menu bar, the Dock and the launcher say
  "Store"; "software" is one of its keywords so the old name finds it. The
  app id, the folder and the settings keys keep "software": changing an id
  breaks pins, defaults and every agent that names it.
- **Undo:** `name` in `shared/apps/first-party.ts`, the titles in
  `apps/software/main.tsx` and `lib/view.tsx`.

### D325. Agents name an app and its source in one id

- **Date:** 2026-11-16. `v09/store`.
- **Decision:** `search_software` searches every source and answers each
  result with `id` (`flatpak:org.gimp.GIMP@flathub`, `rpm:htop@fedora`,
  `rpm:helium-bin@copr:imput/helium`), `source`, `sandboxed`,
  `needsPassword`, `installed` and the other sources. A bare Flatpak id
  still means Flathub's. `request_software_install` with a package id asks
  on screen every time (D260: installing changes the system), then
  PackageKit asks for the password.
- **Undo:** `agents/desktop/software-catalog.ts`.

### D326. Shelves: Widgets is an empty shelf, Themes stays hidden

- **Date:** 2026-11-16. `v09/store` (store-v2 §1.1).
- **Decision:** the sidebar is Discover, Apps, Menu bar applets, Widgets,
  Launcher extensions, then Yours (Installed, Updates). Flathub's categories
  are chips on Apps. Widgets shows a "coming" shelf (the frames draw it);
  Themes is hidden until the themes release, as the spec says. An add-on
  with `commands` is on Launcher extensions and on Menu bar applets (every
  add-on today has a menu bar item); `applet.json` gains no `shows` field yet.
- **Undo:** `apps/software/lib/sidebar.tsx`, `shelves.tsx`.

### D327. Add-on updates that ask for nothing new install by themselves

- **Date:** 2026-11-16. The owner's call (16 Nov); how it is done is mine.
- **Decision:** a few minutes after login and then daily, the shell installs
  each add-on update from the catalog that installed it, signed by the same
  author key (the installer refuses otherwise), that asks for no permission
  the person hasn't allowed (`applet-store/add-ons.ts`). One that asks for
  more waits in the Store's Updates. There is no switch to turn this off yet.
- **Undo:** `watchQuietUpdates` in `applets/start.tsx`.

### D328. The launcher's Store asks in place, in one line

- **Date:** 2026-11-16. `v09/store` (store-v2 L15, L16).
- **Decision:** "Store" in the launcher is a scope of Dashi's add-ons
  (extensions, applets, installed, and "Find in the Store" for apps). ↩ on
  one not installed asks in the launcher's own one-line question (what it
  adds, what it can reach, "Nobody at Dashi has read this version's code"
  when that is so); ↩ again gets it. L16's panel with Cancel and Get is
  later work; a click on a row shows the add-on in the Store, it never
  installs.
- **Undo:** `applet-store/launcher-store.ts`.

### D329. Terra is on by default through a dnf5 vendor file in dashi-release

- **Date:** 2026-11-16. The owner's call (Terra on by default); how is mine.
- **Dilemma:** ship Terra's `.repo` and key in `dashi-release`, or
  `Requires: terra-release` with a bootstrap.
- **Found:** `terra-release` (GPL-3.0, Terra's repository) owns
  `/etc/yum.repos.d/terra.repo`; its key comes from `terra-gpg-keys` (MIT).
  Neither is in Fedora, so a `Requires` can't be met by a Dashi that has only
  Fedora and Dashi's COPR on (an upgrade from 0.8 would fail). Two packages
  can't own one file with different contents, and two `[terra]` sections are
  one too many. dnf5 reads `/etc/yum.repos.d`, then `/usr/share/dnf5/repos.d`,
  and a file of the same name earlier replaces a later one whole (tried with
  `dnf5 repolist --setopt=reposdir=…`).
- **Decision:** `dashi-release` ships `/usr/share/dnf5/repos.d/terra.repo`
  (Terra's own settings, the key at `/usr/share/dashi/pki/`) and Terra's two
  public keys. Where `terra-release` is installed its file replaces ours by
  name; nothing conflicts on upgrade. `Recommends: terra-release` stays.
  The Sources page turns Terra off and on (`pkcon repo-disable terra`, an
  override in `/etc/dnf/repos.override.d`).
- **Licences:** a repository is not a dependency. Dashi ships two public
  keys (MIT) and a configuration file; nothing Terra hosts is in Dashi.
  Terra carries software under many licences, some not open (1Password,
  Android Studio), and its own page says some of its packages may conflict
  with RPM Fusion. What a person installs from it keeps its own terms; the
  package page says "Built by Terra… Fedora didn't review them". Dashi stays
  MIT.
- **Undo:** delete the vendor file and keys from `spin/dashi-release`.

### D340. Launcher views are a tree the launcher draws; version 6 of the channel is theirs

- **Date:** 2026-11-16. `v09/launcher-ext` (store-v2 spec § 4, slice 2;
  approved by the owner on 16 Nov).
- **Dilemma:** the spec left the channel's number open ("6 if it lands with
  widgets, else the one after"), and widgets are designed, not built.
- **Decision:** version 6 is the launcher's views (`open`, `tree`, `patch`,
  `push`, `pop`, `toast`, `close`, `event`, `prefs`:
  `packages/applet/src/view/wire.ts`). Widgets' messages
  (`dashi-0.9.0-design/widgets/api.md` § 12) become version 7 when they are
  built. The pixel `view` mode stays as it was.
- **Cost:** api.md's numbering moves by one.
- **Undo:** renumber `VIEW_PROTOCOL` and the parsers' version gates.

### D341. One element set with widgets: six shared elements, widgets' tones

- **Date:** 2026-11-16. `v09/launcher-ext`.
- **Decision:** `Text`, `Image`, `Tag`, `Label`, `Link` and `Action` are
  named once (`packages/applet/src/view/elements.ts`, marked `shared`) and
  used by both the launcher's views and, when they are built, widgets; the
  launcher adds `List`, `Grid`, `Section`, `Item`, `Detail`, `Metadata`,
  `TagList`, `Separator`, `ActionPanel`, `ActionSection`, `EmptyView`. A
  node on the wire is `{t, i, p, c}` (props under `p`, so a prop can never
  be taken for the type or the id). Tones are widgets' (`primary`,
  `secondary`, `tertiary`, `accent`, `ume`, `broth`, `moss`), not the spec
  example's `ok`/`critical`: they were named first and are Dashi's tokens.
  Component names stay Raycast's (spec § 7.8). api.md § 4 and spec § 4.3
  say the same.
- **Cost:** widgets' lower-case `text`/`image` become `Text`/`Image`.
- **Undo:** rename in `elements.ts` and the two documents.

### D342. An extension's view is a launcher scope

- **Date:** 2026-11-16. `v09/launcher-ext`.
- **Decision:** the launcher enters an extension's view the way it enters
  the clipboard history: a `LauncherScope` (`launcher/lib/tree-scope.ts`)
  whose rows are the launcher's own (`ResultRow`, with tags at the right
  end), whose verbs are the item's ActionPanel, ❖K in place. ↩ is the first
  action and ❖↩ the second unless they name a key. Esc goes back a pushed
  view first, then out. A grid is one window of cells (↑ ↓ a line, ← → a
  cell, the arrows taken only while a cell is selected); a detail is one row
  standing for it, the rest of the room its Markdown and a 200-wide facts
  column. Scopes gained `back`, `leave`, `secure` and `notice`.
- **Why:** no second list, selection, key map or action panel to keep in
  step with the first; every rule the launcher's rows keep (TY-1, CO-6, the
  one chrome row) holds for extensions for free.
- **Not built:** list with detail beside it (L11, L15), the dropdown in the
  field row, forms (slice 4).
- **Undo:** `enterTree` in `lib/use-search.ts`.

### D343. A launcher-only extension starts on use and stops a minute after; not kept warm

- **Date:** 2026-11-16. `v09/launcher-ext`.
- **Measured first** (spec § 6): Bun in bubblewrap, a bare script, reaches
  its first message in 6 ms (median of 10, the laptop); the GitHub
  extension's bundle (580 KB: React, the reconciler, the SDK) says hello in
  17 ms; a 40-row tree rendered and sent in 18 ms. In the VM, from the
  command chosen to its first tree, systemd and the runner included: cold
  73 to 204 ms (nine opens), warm 11 to 24 ms
  (`dashi-0.9.0-review/36-launcher-ext/README.md`).
- **Decision:** `"shows": ["launcher"]` is not started at login
  (`AppletLauncher.reconcile` skips it); opening one of its commands starts
  it (`ensure`), the launcher draws the skeleton at once, "Loading…" after
  300 ms, the tree when it comes; it is stopped 60 s after its last view
  closed (`ExtensionViews`, `IDLE_STOP_MS`). Not kept warm when the launcher
  opens: § 6 asked for that only past ~250 ms.
- **Undo:** launch it in `reconcile` as before.

### D344. Open, Copy, Paste and Set run in the shell; Paste copies where it can't paste yet

- **Date:** 2026-11-16. `v09/launcher-ext`.
- **Decision:** as spec § 4.2. Push runs in the extension (it holds the
  element); the shell keeps the stack and pops on Esc. Paste into the window
  that was in front is not wired to the clipboard's paster yet: it copies and
  says "Copied: paste it with ❖V". `set` (new, beside the spec's) asks the
  person for a preference in the launcher's field.
- **Undo:** `TreeSession.builtIn`.

### D345. Preferences are kept by Dashi; a secret in the Secret Service through `secret-tool`

- **Date:** 2026-11-16. `v09/launcher-ext`.
- **Decision:** `text` and `checkbox` in `applet-data/<id>.prefs.json`
  (outside the sandbox: the extension can't write them), `secret` in the
  Secret Service under `dashi-extension=<id> preference=<name>` with
  libsecret's `secret-tool` (LGPL, a separate program: `Requires: libsecret`).
  The extension gets its values with `open` and `prefs`, never reads them
  from disk. Until accounts (slice 4), GitHub takes a pasted token this way
  and says "Public data only: no GitHub account yet" without one.
- **Undo:** `src/applets/preferences.ts`.

### D346. `network:HOST` gives the network until the proxy exists, and the sheet says so (replaced by D463)

- **Date:** 2026-11-16. `v09/launcher-ext`.
- **Decision:** the permission parses and is shown as "Use the network: it
  says it only talks to HOST"; the sandbox shares the network as for
  `network`. Nothing asks at run time (D260). The proxy that holds it to
  the host is slice 4's.
- **Undo:** `usesNetwork` in `permissions.ts`.

### D347. Dashi's own extensions are built from the shell's source at start

- **Date:** 2026-11-16. `v09/launcher-ext`.
- **Decision:** Emoji and GitHub live in `packages/shell/extensions/`, are
  bundled with `Bun.build` (27 ms for both) into the person's applets folder
  when their source changed, with `"firstParty": true` and their permissions
  allowed in `install.json`, and run like anyone's: own unit, bubblewrap,
  their manifest's permissions. Nothing generated is committed and nothing is
  published.
- **Cost:** removed in the Store, they come back at the next start.
- **Undo:** `src/applets/first-party.ts`.

### D348. A tree is one line: 64 KB, not the spec's 256 KB

- **Date:** 2026-11-16. `v09/launcher-ext`.
- **Decision:** the channel's lines and outbox are 64 KB and its rate 30
  messages a second; a tree is one message. 2,000 nodes, 12 deep. A big list
  filters itself or pages; Emoji sends at most 160 cells. The SDK sends at
  most every 50 ms and refuses to send a tree the shell would refuse.
- **Undo:** `TREE_LIMITS`, and the connection's limits for version 6.

### D349. Quicklinks and fallbacks live beside the aliases; Search the Web is the first

- **Date:** 2026-11-16. `v09/launcher-ext` (slice 3, L9, L13).
- **Decision:** `launcher.quicklinks` and `launcher.fallbacks` in
  settings.json. Unset, there is one quicklink, Search the Web
  (DuckDuckGo), and it is the one fallback. Fallbacks come first in "Nothing
  called …", then Search files and Find in Software, then Ask Dashi last.
  ❖K on any action that takes the words alone offers Use When Nothing
  Matches; order is the order they were added (no reordering UI yet).
- **Undo:** `launcher/quicklinks.ts`, `quicklink-list.ts`.

### D350. Thirds and two thirds are tiles; agents get them too

- **Date:** 2026-11-16. `v09/launcher-ext` (L10).
- **Decision:** `left-third`, `center-third`, `right-third`,
  `left-two-thirds`, `right-two-thirds` join `TILES`, with the halves' gap;
  every tile has a named launcher command (`dashi://window/tile/<tile>`) and
  a glyph drawing the part it takes. The shell computes frames; the
  compositor's `frame` needed nothing. `tile_window` takes them (its
  tools/list golden changed). Displays and Desktops from the launcher (the
  rest of L10) are not built.
- **Undo:** `TILES`, `NAMED_TILES`.

### D351. The clipboard's kinds are chosen in ❖K, not a dropdown in the field row

- **Date:** 2026-11-16. `v09/launcher-ext` (L11).
- **Decision:** Show Text, Links, Images or Files Only, and Show All
  Kinds, in the history's ❖K; the head says "214 copies · Links only" and the
  placeholder "Search links". A link is text that is one address. L11's
  "All kinds" dropdown would be a second control in the field row, which
  already holds the hints; ❖K is where the launcher's choices are. The
  preview column is not built.
- **Undo:** `kindVerbs` in `clipboard/lib/scope.ts`.

### D352. The applet runtime is 0.9: an extension's `"dashi": ">=0.9"` is how it asks for views

- **Date:** 2026-11-16. `v09/launcher-ext`. Found in the VM: Emoji and
  GitHub (`"dashi": ">=0.9"`) were never run, because `SDK_VERSION`, what
  `dashi` is checked against, was still 0.5.0.
- **Decision:** `SDK_VERSION` is 0.9.0: the runtime grew (version 6 of the
  channel, the launcher module), and an extension that needs it says
  `>=0.9`. Every applet in the catalog says `>=0.4` or `>=0.5` and still
  runs; one that said `^0.5` would not (none does).
- **Undo:** `SDK_VERSION` in `packages/applet/src/package.ts`.

### D330. A wheel user installs and removes packages without a password; the Store's sheet is the ask

- **Date:** 2026-11-16. `v09/store`, found in the VM pass.
- **Found:** Fedora 44's PackageKit ships
  `/usr/share/polkit-1/rules.d/org.freedesktop.packagekit.rules`: an active,
  local member of `wheel` installs, removes and updates packages with no
  password (`package-install`, `package-remove`, `system-update`). Changing
  a repository (`system-sources-configure`) still asks. The design assumed a
  password for every new package and removal ("hole 2", untested then).
- **Decision:** keep Fedora's rule. Installing system software is critical
  (D260), and the person is asked every time on the Store's own Get sheet
  (and an agent's install on the confirm sheet); the sheet no longer
  promises a password, it says the package isn't sandboxed and is installed
  for everyone. Someone not in `wheel` still gets polkit's password sheet.
- **Owner's call, open:** a Dashi polkit rule could ask for the password
  again on installs and removals (auth_admin_keep), as the design drew.
- **Undo:** the words in `apps/software/lib/source-words.ts` (`packageAsk`),
  `agents/desktop/software-catalog.ts` (`packageDetail`).

### D331. `dnf copr enable` asks for Fedora's chroot on Dashi

- **Date:** 2026-11-16. `v09/store`, found in the VM pass.
- **Found:** dnf5's COPR plugin names the chroot from os-release's `ID`,
  which is `dashi`, so `dnf copr enable atim/lazygit` failed: "Chroot not
  found in the given Copr project (dashi-44-x86_64)". The owner's way to add
  a COPR (by hand in Terminal) didn't work on Dashi at all.
- **Decision:** `dashi-release` ships `/etc/dnf/plugins/copr.d/dashi.conf`
  with `[main] distribution = fedora` (the plugin reads it; tried in the VM:
  the chroot becomes `fedora-44-x86_64`). `%config(noreplace)`.
- **Undo:** delete that file from `spin/dashi-release`.

### D332. A source with no metadata yet is fetched once; an install PackageKit can't place is tried again

- **Date:** 2026-11-16. `v09/store`, found in the VM pass.
- **Found:** a COPR enabled in Terminal has nothing in dnf's cache until
  something refreshes, so the Store didn't list its packages; and PackageKit
  keeps its own copy of the metadata, so an install from it failed at once.
  The Store also read pkcon's "Waiting for authentication" status line as
  "the password was not given" and showed nothing.
- **Decision:** the catalog's network round runs `pkcon refresh` once a
  session when a repository that is on has no packages in the cache, then
  reads again; an install that fails is tried once more after `pkcon
  refresh`. PackageKit lets an active session refresh without a password.
  Only "Failed to obtain authentication", "Not authorized" and the like
  count as a no.
- **Undo:** `emptyRepos` and `refreshMetadata` in `shared/software/catalog.ts`,
  `install` in `shared/software/packages.ts`.

### D333. Installed lists the package apps the person added, not the image's

- **Date:** 2026-11-16. `v09/store`, found in the VM pass (flows/store hole 22).
- **Found:** every installed RPM with a desktop file showed up, the image's
  own helpers first (Anaconda, Geoclue, Fcitx's tools).
- **Decision:** what the system's first transaction installed (the image's
  or the installer's, `dnf5 history info 1 --json`, 0.04 s) came with the
  computer and isn't listed; anything installed later is. (A first try,
  "installed an hour after the oldest package", failed in the VM: an update
  resets a package's install time.) Tools are not listed (dnf can't tell a
  person's from the system's), and a filter that matches nothing says so.
- **Cost:** an app from the image that the person removed and installed
  again is listed as theirs, which it now is.
- **Undo:** `cameWithSystem` in `shared/software/lib/catalog-merge.ts` and
  `apps/software/lib/installed-packages.tsx`.

### D360. The open Store follows the applets folder

- **Date:** 2026-11-16. `v09/fix-polish-1`, found in pass 37.
- **Found:** an add-on got from the launcher (another process) didn't show
  on the open Store's Installed until the window was reopened.
- **Decision:** while the window is open it watches the applets folder with
  its subfolders, as the shell's applet runner does, and reads Installed
  again 300 ms after a burst of writes settles; the list is merged again
  over the catalogs already read (no network). The launcher's scope already
  read the folder each time it opened.
- **Undo:** `apps/software/lib/applets/follow.ts` and `followApplets` in
  `services.ts` and `view.tsx`.

### D361. A question asked in place wraps; every other row stays one line

- **Date:** 2026-11-16. `v09/fix-polish-1`, found in pass 37 (33b).
- **Found:** "Get “ASUS Control”? It can: …" ran under the ↩ key and off
  the panel.
- **Decision:** a verb's `confirm` line (the add-on's question, "Quit Files
  and close its 2 windows?") wraps and its row grows; the key stays at the
  right end. Not cut with "…": what an add-on can reach is the consent, and
  a consent read in part is not one. Every other row keeps VS-2's one
  line. The question's words are Dashi's English with the add-on's own
  name and commands (which may be Spanish); the launcher's own words are
  not translated in 0.9, so "both languages" is an add-on written in
  either, and both fit. The key is said in words inside the sentence
  ("Return again gets it", as "Return keeps it" elsewhere): a ↩ in running
  text is drawn as the colour emoji (mirin's text doesn't honour U+FE0E),
  while the row's end keeps the ↩ glyph.
- **Undo:** `question` in `launcher/row-model.ts`, `verbRow` in
  `launcher/verbs.ts`, `ResultRow` in `launcher/lib/row-view.tsx`.

### D362. Markdown tables are drawn by one view, Notes' and the launcher's

- **Date:** 2026-11-16. `v09/fix-polish-1`, found in pass 37.
- **Found:** a pull request's body showed its table as `| --- |` lines.
- **Decision:** Notes' table reader and its table view move to
  `src/shared/markdown/` (two modules use them: Notes and the launcher's
  detail, H20); the launcher's small Markdown reads a table there as Notes
  does and draws it at its detail size. Inline marks in cells are dropped as
  in a line. The table never shrinks in a column shorter than its words (a
  clipping box's least height is 0: in the VM it shrank to its borders); a
  column keeps its header's semibold word whole; in the detail a column keeps
  at most 12 letters of a word whole (`wholeWord`), so a long path wraps and
  four columns fit beside the facts.
- **Undo:** move `table.ts` back to `apps/notes/lib/` and inline the view
  in `page-under.tsx`; `markdownBlocks` in `launcher/lib/tree-view.tsx`.

### D363. Esc back from a pushed view selects the row that pushed it

- **Date:** 2026-11-16. `v09/fix-polish-1`, found in pass 37.
- **Decision:** an extension's scope remembers, per depth of its stack, the
  row that ran an action and what was typed then; Esc back restores both
  (`returnTo` beside `back` in `LauncherScope`). A row that is no longer
  in the list falls to the first, as any held selection does.
- **Undo:** `returnTo` in `launcher/types.ts`, `lib/tree-scope.ts` and
  `lib/commands.ts`.

### D364. Emoji are named as Unicode names them today

- **Date:** 2026-11-16. `v09/fix-polish-1`, found in pass 37.
- **Decision:** the Emoji extension's names are the CLDR short names from
  `emoji-test.txt` (Emoji 17.0; "red heart", "thumbs up"), not the old
  character names ("heavy black heart"); the set of emoji is unchanged.
  Unicode's data licence is in `THIRD-PARTY-NOTICES.md`.
- **Undo:** the names in `extensions/emoji/lib/emoji-data.ts`.

### D365. Installed leaves out what dnf brought only for another package

- **Date:** 2026-11-16. `v09/fix-polish-1`, found in pass 37.
- **Found:** "Fcitx5 qt Qt6gui" (a GUI wrapper library dnf installed for
  Fcitx) was listed as an app the person added. Its desktop file is
  `NoDisplay`, but so is Orca's, which the person installed and must be
  able to find and remove: hiding `NoDisplay` apps was tried and reverted
  in the VM.
- **Decision:** dnf's own reason decides. A package whose reason is
  "Dependency" or "Weak Dependency" (`%{reason}` in the installed query)
  came for another and isn't listed; "User", "Group", "External" or an
  unknown reason is the person's. It is removed with the package that
  needed it, as dnf removes unused dependencies. "Fcitx 5" leaves the list
  too: its row was `fcitx5-data`, a dependency of the `fcitx5` the person
  asked for; Fcitx's own settings app (Fcitx5 Configtool) stays.
- **Undo:** `dependencies` in `shared/software/lib/rpm-query.ts`
  `parseInstalled`, `dependency` on an `Offer` (`catalog-merge.ts`), and
  `apps/software/lib/installed-packages.tsx`.

### D366. The correcting model loads after login and when Voice turns on

- **Date:** 2026-11-16. `v09/fix-polish-1`, found in pass 37.
- **Found:** the first dictation after the model started landed by rule
  (`why=deadline ms=1200`): the model began loading at the key's press.
- **Decision:** with Voice and tidying on it loads 15 s after login (so it
  doesn't compete with the session coming up), and at once when either is
  turned on; still at each key down. The rewriter's own rule keeps it: out
  of memory after 10 minutes with no call, at once when Voice or tidying is
  turned off. Cost: about 1 GB held for the first 10 minutes of a session
  in which nobody dictates.
- **Undo:** `warmWhenWanted` in `boot/corrections.ts`.

### D367. Each tap of the Dashi key says in the log what it did

- **Date:** 2026-11-16. `v09/fix-polish-1`, found in pass 37 (2 of about
  12 taps "opened nothing").
- **Found:** in the VM 24 of 24 taps opened the launcher, of every kind
  pass 37 tried (zero-length, right after `wl-copy`, right after Voice was
  turned on, typed at once): the misses were not reproduced, and most
  likely came from keys sent inside the 100 ms the settings file takes to
  be read again.
- **Decision:** as D9 says, the session's log says what each tap did ("opens
  the launcher", "closes the launcher", "the card takes it", "the launcher ❖
  just opened stays", "no launcher yet"), with the time, so a miss names its
  cause next time.
- **Undo:** `did` in `boot/dictation.ts` `dashiTap`.

### D375. The Dashi key reads the voice models again before saying they are missing

- **Date:** 2026-11-16. `v09/fix-polish-2`, seen in pass 39.
- **Found:** models copied into the voice folder while the session runs
  were seen only when Settings › Voice opened (it watches the folder only
  while open), so the Dashi key said "Voice needs its models" over models
  that were there.
- **Decision:** when the key finds something missing, it asks the service
  for its models once more (one `models` and one `voices` call, a few
  milliseconds) and only then says what is missing; if the models are there
  now it listens. No folder watch for the whole session: a press is the
  only time the answer matters.
- **Undo:** `recheck` in `voice/start.ts` and `keyDown` in `voice/voice.ts`.

### D376. A launcher detail scrolls, and draws wide tables, rules and GitHub's alerts

- **Date:** 2026-11-16. `v09/fix-polish-2`, seen in passes 38 and 39.
- **Found:** a long pull request's body was cut at the panel's foot; a
  table wider than the column was cut at its right ("Confid…"); `---` and
  `> [!WARNING]` showed as raw text.
- **Decision:**
  - The Markdown column is a scroll view: the wheel and touchpad scroll it,
    and so do the launcher's keys while a detail shows (↑ ↓ by 48 px, Page
    Up and Page Down by its height less 24, Home and End). A detail has one
    row, so the keys had nothing else to do there. Up to 120 blocks are
    drawn (80 before, when nothing scrolled).
  - A table is as wide as the column; one that is wider at its least (each
    column its longest word, at most 12 letters) is drawn at that width and
    scrolls sideways, as GitHub's does (the wheel across, or ⇧ and the
    wheel). Its cells wrap either way. A column is measured by its words as
    drawn (Notes' tables too): a link's address used to count, so
    Renovate's four short columns ran off the side.
  - `---`, `***`, `___` are a hairline; under a paragraph `---` and `===`
    make it a heading, as Markdown says.
  - A quote has a 3 px bar; an alert has its word ("Note", "Tip",
    "Important", "Warning", "Caution") over it, bar and word in the ink of
    the launcher's tones: accent for Note and Important (purple is the
    agents' and the focus ring's, so Important is not purple as GitHub's),
    moss for Tip, broth for Warning, ume for Caution.
- **Undo:** `launcher/lib/detail-view.tsx`, `detail-markdown.ts`,
  `detail-scroll.ts`; `step` in `use-acts.ts`.

### D377. A command found by its own name stays under only the apps found by theirs

- **Date:** 2026-11-16. `v09/fix-polish-2`, seen in passes 38 and 39.
- **Found:** "emoji" opened GNOME Characters, not the Emoji extension. Both
  have "emoji" as a keyword, so both matched in the keyword tier, and a
  command always stayed under an app of its tier.
- **Decision:** a keyword's match whose item's name matched too (at a
  word's start or better: "Search Emoji") is marked `named`. A command or
  a menu row found by its name (or such a keyword) stays under only the
  apps found by theirs; one found only by a keyword still stays under
  every app found as well ("math": Calculator and Characters before a
  command whose keyword it is). An app's own name still wins ("characters"
  is Characters).
- **Undo:** `byName` and `namedFloors` in `launcher/ranking/rank.ts`.

### D378. The screenshot keys work while the launcher is open

- **Date:** 2026-11-16. `v09/fix-polish-2`, seen in passes 31 and 39.
- **Found:** ⇧❖3 made no file while the launcher was open. The launcher's
  keymap puts its own rules first, and its ❖3 (pick the third row) matched
  ⇧❖3 too: a rule that doesn't name Shift matches with Shift held. ⇧❖4 and
  ⇧❖5 were taken the same way, and so were they in the keys typed right
  after a ❖ tap.
- **Decision:** while the launcher is open (and in the type-ahead keymap),
  any session rule with ⇧ whose chord without ⇧ is one of the launcher's
  comes before the launcher's rules: today ⇧❖3, ⇧❖4 and ⇧❖5. The launcher's
  own ⇧ chords (⇧❖A, ⇧❖K, ⇧↩) are unchanged.
- **Then, in the VM:** ⇧❖3 made a file but the launcher wasn't in it: the
  screenshot closed the launcher first, as a Screenshot row chosen in it
  must. A run asked by a key now says so (`byKey` in the action's
  context), and ⇧❖3 by key takes the screen as it is, the launcher in it.
  A row still takes the launcher down first; ⇧❖4 and ⇧❖5 by key do too
  (their selection and toolbar need the pointer and the keys).
- **Undo:** `shiftedPast` and `launcherRulesOver` in `launcher/keys.ts`;
  `byKey` in `actions/lib/run.ts` and `Screenshots.run` (`boot/overlays.tsx`).

### D379. GitHub's words are fitted to a row before they reach the launcher

- **Date:** 2026-11-16. `v09/fix-polish-2`, found in this branch's VM pass.
- **Found:** searching "renovatebot/renovate" showed "This view can't be
  shown: Item “k:renovatebot-renovate-approve-bot”: subtitle is empty". A
  row's words are refused when empty (a subtitle) or longer than the tree
  takes (120 letters for a title or subtitle, 60 a keyword), and one
  refused row hides the whole view.
- **Decision:** the extension fits what GitHub sends: a repository without a
  description has no subtitle; titles, descriptions, labels and the branch
  keyword are one line, cut with "…" at the tree's limits. The tree's rule
  stays strict: an extension that sends a bad row is told, by name.
- **Undo:** `fit` in `extensions/github/lib/api.ts` and its uses.

### D370. Activity Monitor's lost and stacked names are fixed in mirin, not here

- **Date:** 2026-11-16. `v09/fix-monitor-scroll`, the owner's screenshot
  (Dashi `6f12a69`, Metal host `50241ea`, scale 1.75).
- **Found:** Dashi's list is right: rows are keyed by PID or app, and
  the tree it sends matches the order on screen. The fault is in the Metal
  host's retained drawings (sumi). A row hears the pointer, so it is drawn
  even out of view, but its name cell is left out and parked. When the row
  was then copied lower (rows above it changed), the copy also moved the
  record of the name inside the parked cell, but not the parked drawing.
  Back in view, the name was copied by that record and landed rows away from
  its row: over another name, or out of sight. Reproduced in the VM's
  installed session, in a replay of the patches Dashi sent there, and in a
  30-row test.
- **Decision:** fixed at the source (mirin branch `v09-fix-monitor-scroll`,
  `each_told_drawn` in sumi's `retained.rs`, with a test). Nothing changes in
  Dashi: no workaround, no `MIRIN_METAL_RETAIN=0`. Every Metal list gets the
  fix with the host. The ones built like Activity Monitor's (rows that hear
  the pointer, with a name cell inside) are the launcher's results and an
  extension's tree view.
- **Undo:** revert the mirin commit; Dashi has nothing to undo.

### D385. A pushed view starts with an empty field; the launcher's own rows have no actions

- **Date:** 2026-11-16. `v09/fix-polish-3`, from passes 41 and 42.
- **Found:** ↩ on a GitHub repository ("Show Pull Requests") did push its
  pull requests, but the field kept the repository's name, and the launcher
  filtered every pull request away with it ("Nothing in GitHub for
  “renovatebot/renovate47608”"). Keys typed before the view came were sent
  to the repository search. And the launcher's own rows (the list loading,
  "Nothing in … for …") took the view's actions as theirs: ↩ there asked for
  "Repository", ❖↩ for "GitHub token".
- **Decision:** a `push` action's view starts with an empty field. What was
  typed after ↩, before the view came, stays (type-ahead is never lost); it
  is not searched in the view under it. A list that says it is loading and
  has no row shows "Loading…", not "Nothing". The launcher's own rows have
  no actions; an extension's EmptyView keeps its own, or the view's.
- **Undo:** `pushing` and `fieldNow` in `launcher/lib/tree-scope.ts` (and its
  call in `use-search.ts`); the `if (!node) return []` in its `verbs`; the
  `loading` row in `tree-rows.ts`.

### D386. The ranking history is read again when its file changes

- **Date:** 2026-11-16. `v09/fix-polish-3`, from pass 42.
- **Found:** `ranking.json` was read only when the shell started: picks
  taken out of it by hand changed nothing until the session restarted.
- **Decision:** when the ranking is asked, the file is looked at (no more
  than once a second: one `stat`) and read again when it is not the file the
  shell last read or wrote (inode, size, time). A change on disk wins over
  the shell's own not yet written (at most two seconds of picks): the person
  or a tool that edited the file meant it. No file watcher: nothing runs
  while the launcher is not asked.
- **Undo:** `lookAgain` in `launcher/ranking/store.ts`.

### D387. The launcher fits a short screen: higher first, then shorter

- **Date:** 2026-11-16. `v09/fix-polish-3`, from passes 41 and 42.
- **Found:** the launcher's surface was 600 tall, 120 under the menu bar, on
  every screen. On the VM's 1098 × 686 (1922 × 1201 at 175%) that is 748: its
  foot ran under the screen's edge, and a detail scrolled to its end showed
  its last line cut. A 1280 × 800 laptop at 125% or more is the same.
- **Decision:** when it opens, the room under the bar on the person's screen
  is asked with where the person is (one `outputs` call beside the one
  already made). The gap above shrinks first, to 12; then the surface is
  shorter (never under 240), with 12 free under its foot. Its measures take
  the surface's height (a React context), so fewer rows are listed, as at a
  larger text size: nothing is clipped. The window pictures follow its top.
- **Undo:** `launcherPlace` in `launcher/place.ts`; `launcherRooms` in
  `boot/lib/launcher-view.tsx`; `SurfaceHeight` in `launcher/lib/measures.ts`.

### D388. A launcher detail draws a task list with Notes' boxes

- **Date:** 2026-11-16. `v09/fix-polish-3`, from passes 41 and 42.
- **Found:** Renovate's `- [ ] If you want to rebase…` was drawn as
  "• [ ] If you want to rebase…".
- **Decision:** Notes' checklist box (□ open, ■ done, from Inter) moves to
  `shared/markdown/task.ts`, with the one reading of `[ ]` / `[x]`; Notes and
  the launcher's detail both use it, and the detail draws an item as Notes
  does: the box bold, moss once done, a done item's words muted and struck
  through. The box is not pressable in a detail: the body is GitHub's, read
  only.
- **Undo:** the `task` block in `launcher/lib/detail-markdown.ts` and `Task`
  in `detail-view.tsx`; `TASK_BOX` back into Notes' `project.ts`.

### D389. The menu bar's extras keep a fixed order

- **Date:** 2026-11-16. `v09/fix-polish-3`, from pass 42.
- **Found:** after a package downgrade and upgrade, the bar's fan and
  keyboard items had swapped places. Extras were shown newest leftmost (as
  on a Mac), so their order was the order their programs connected in, which
  changes from one start to the next; an applet's key also carries its
  connection's number.
- **Decision:** the order is fixed by who each extra is: tray icons by their
  app's name, then applets by their id (the key without its connection's
  number), each alphabetically; a tie goes by key. A new extra goes in its
  place, not at the left. The person can't move them yet (⌘-drag, as on a
  Mac, is for later); when they can, their order is kept and this is the
  default.
- **Undo:** `placeOf` and `byPlace` in `src/extras/store.ts`.

### D390. GitHub's pull requests send no count until they have come

- **Date:** 2026-11-16. `v09/fix-polish-3`, found in this branch's VM pass.
- **Found:** with D385 the pushed pull requests showed while they loaded, and
  showed "This view can't be shown: Section “n1”: subtitle is empty": the
  section's count was "" until the list came, and the tree refuses an empty
  subtitle (D379), so the whole loading view was refused.
- **Decision:** the section has no subtitle while it loads; the launcher
  shows "Loading…" under it (D385). The tree's rule stays strict.
- **Undo:** the `subtitle` spread in `extensions/github/main.tsx`.

### D400. The inks are their own tokens, and the timer's is wakame, a teal

- **Date:** 2026-11-17. `v09/inks` (brief b5).
- **Question:** where the widgets' inks live beside the accent colour being
  built at the same time (`v09/accent`), and the exact teal the owner chose
  for the timer on 16 Nov ("about H200").
- **Decision:** the inks are in `packages/dashi-ui/src/theme/inks.ts`, not in
  `palette.ts`: six fixed OKLCH inks (miso, mizu, matcha, wakame, shiso,
  album), the tally (one vermilion), the paper, the words on a flood, and the
  two transforms (house lights, the lock's shift), turned into hex once per
  mode. The accent never reads or writes them. The timer's ink is named
  wakame (Dashi's sea-teal tint already has the name): Light L0.545 C0.10
  H205 (#067F8A, 4.6:1 on paper), Dark L0.88 C0.10 H200 (#80ECF1). It stays
  the lightest of the four glanceable inks, as kabocha was. Light values:
  miso #633C2E, mizu #006485, matcha #6B6F03, shiso #5949A3, album #8B467F,
  tally #D9471B; Dark: #B78D7F, #68BDE4, #B3D76D, #B0A4F8, #CF8AC1, #FD6A3A.
  Closest pairs: Light mizu/wakame ΔE 0.083, Dark shiso/album 0.096.
- **Why:** a file of their own means the accent's commits to `palette.ts`
  never collide with these, and the test (`dashi-ui/test/inks.test.ts`)
  checks the distance table, contrast, lightness order and dimming.
- **Cost:** Light wakame sits ΔE 0.057 from kombu's selection green. Kombu
  (and the accent that replaces it) is never drawn inside a widget, so the
  two never meet on a card.
- **Undo:** the `wakame` entry in `INKS`; the file is imported only through
  `@dashi/ui`.

### D401. How the tally's cut rules read where the design leaves a gap

- **Date:** 2026-11-17. `v09/inks`.
- **Question:** round five's rules (≥60 s hold, 10 min no-retake, earliest
  deadline, pin loses to asking, 2 min for a due item and house lights)
  leave four cases open.
- **Decision:** (1) The 10-minute lock-out holds only while something else
  could take the tally; alone, a loser holds again, so a running timer is
  never left unlit. (2) A loser that became more urgent since it lost (a
  running timer reaching zero) may retake at once. (3) A due item spent after
  its two minutes leaves the air entirely (it is in its notification now),
  not back to running. (4) A pin is the person's own act and cuts at once,
  inside the minute's hold. House lights count one stretch: they go down when
  an asking or due holder takes the tally and come up after two minutes or
  when the holder stops being urgent, whichever is first; a new urgent holder
  inside the same stretch does not start a new two minutes.
- **Why:** each reading keeps the tally's one job (one honest "now") with
  the fewest cuts.
- **Undo:** `locked`, `spentNow` and `settle` in `shell/src/tally/lib/rules.ts`;
  the tests in `shell/test/tally.test.ts` say each case.

### D402. Only an ask marked critical takes the tally as asking

- **Date:** 2026-11-17. `v09/inks`.
- **Question:** round five says only a critical question may "ask" (D260's
  five: money, a secret, losing work for good, a system change, speaking
  for the person); Dashi's asks (`PillAsk`) and agents' run questions did
  not say whether they are critical.
- **Decision:** `PillAsk` gains an optional `critical` flag, set by whoever
  makes the ask; an ask without it counts as running and waits in its card.
  An agent run's question asks only when it is a sign-in (a secret). The
  capsule does not set the flag yet, so today only sign-ins and anything
  that sets it go on air as asking.
- **Why:** the tally's house lights must never go down for a plan that only
  moves files; guessing criticality from words would get it wrong both ways.
- **Undo:** `asksOnAir` and `runsOnAir` in `shell/src/widgets/lib/on-air.ts`.

### D403. Pinning is a right-click on a live card

- **Date:** 2026-11-17. `v09/inks`.
- **Question:** the design pins with a long press; mirin's View has no long
  press (it has `onContextMenu` and `onPointer`).
- **Decision:** a right-click on a live card pins it; another unpins.
- **Why:** a long press from `onPointer` would need a timer per card; the
  right-click is where every other "more" lives in Dashi.
- **Undo:** `onContext` on `LiveCard` in `shell/src/widgets/live.tsx`.

### D404. An extension's widget is a tree in a file, not a new message

- **Date:** 2026-11-17. `v09/inks`.
- **Question:** the widget API (`widgets/api.md` § 5, 12) plans a channel
  version 7 with timelines and budgets; the brief wants one outside widget
  now.
- **Decision:** applet.json declares `widgets` (id, title, sizes, privacy);
  the tree is `assets/widgets/<id>.json` in the package until the extension
  writes `widgets/<id>.json` in its own data folder (its sandbox home),
  which the shell watches and redraws. The tree is Dashi's elements: the six
  shared ones, plus widget-only `Widget` (the root), `Row`, `Column`,
  `Value`, `Dots`, `Spacer`, which the launcher refuses. `Text` and `Value`
  may be `private`. Only installed, allowed, not disabled extensions show,
  always in plain ink.
- **Why:** no process needs to run for a widget to show, nothing new is
  added to the protocol, and the file is as checked as a message would be.
- **Cost:** no budgets and no press actions to the extension yet; a widget
  updates as often as its extension writes the file.
- **Undo:** `packages/applet/src/widgets.ts`, the widget elements in
  `view/elements.ts`, `shell/src/widgets/lib/sources/extensions.ts`.

### D405. One OKLCH for the inks and the accent; the lock keeps one look

- **Date:** 2026-11-17. `v09/inks`, at the merge of `v09/accent`.
- **Question:** the inks (`theme/lib/oklch.ts`) and the accent's guard
  (`theme/accent/lib/oklch.ts`) carried the same OKLCH maths twice; and the
  design draws a light lock screen on a light wallpaper (frame 5), while
  Dashi's lock has one look, Dark's, over a darkened wallpaper.
- **Decision:** one copy, `theme/lib/oklch.ts`, with the guard's `contrast`
  and `over` moved in; `theme/accent/` imports it. The lock keeps its one
  look: its widgets are glass (`#00000047`) with the Dark inks shifted for the
  lock, and the Now Bar floods. Frame 5's light lock is not built.
- **Why:** two copies of colour maths drift; a light lock needs the
  wallpaper's luminance behind the clock, which the shell does not measure,
  and the login screen shares the lock's one look.
- **Undo:** the lock's `useWidgetEnvFor(..., { dark: true, lock: true })` in
  `shell/src/lock/lib/screen.tsx`.

### D430. The accent is a seed the guard draws from, Kombu its absence

- **Date:** 2026-11-17. `v09/accent`, the owner's design
  (`dashi-0.9.0-design/accent/`, approved "as designed: buttons stay ink").
- **Decision:** settings.json `appearance.accent` holds a preset, a colour
  or `{wallpaper: true}`; no key is Kombu, so palette.ts's constants stay
  byte for byte (a test says so). @dashi/ui `theme/accent/` is the design's
  `accent.js` in TypeScript: rules 1–2 move the seed (tally's band capped at
  chroma 0.07 and kept ΔE 0.10 from the tally and the microphone; 40° from
  shiso), rules 3–4 move only the drawn tokens (fills 3:1, words 4.5:1 on
  every window ground; the washes thin until the page's ink is AA; 4.5 and
  7 with Increase contrast, which Dashi has no switch for yet). A test runs
  2,000 seeded random seeds per mode, with and without Increase contrast,
  and asks for 0 failures.
- **Owns:** `selection`, its hover and pressed steps, `selectionWash`,
  `textSelection`, `selectionBar`, `accentInk`, and the new `onAccent`
  (white or #111113: a lime fill gets dark words). Control Center's and
  Settings' `on`, `onInk`, `knobOn`. Never `primary` (buttons stay ink,
  D44), `focusRing`, `agent`, the tally or any widget ink, `microphone`,
  `ume`, `broth`, `moss`, `dot`.
- **Steps:** hover and pressed move 0.04 and 0.08 of OKLCH lightness away
  from the words on the fill (deeper under white, lighter under near-black),
  not "deeper in Light, lighter in Dark" as the design said, so the words
  can only gain contrast on them.
- **Undo:** drop the `accent` key; `paletteFor(dark)` without a seed is the
  constants.

### D431. The shell resolves the accent; every process reads the seed from Control Center's file

- **Date:** 2026-11-17. `v09/accent`.
- **Decision:** the shell turns the choice into one seed (a preset's, the
  colour, or the wallpaper's) and writes it as `accent` in
  `control-center.json`, which every app already follows for Dark Mode
  (apps/kit/appearance.ts); `setAppearanceSource` gained an optional
  `accent()`. Apps never decode the wallpaper themselves, and a pick
  repaints everything on the Dark Mode path. settings.json stays the
  person's choice; the file only holds what it came to.
- **Cost:** the flags file is no longer only Control Center's switches.
- **Undo:** each process reads settings.json and resolves alone (and the
  wallpaper's seed would have to be found in each).

### D432. From wallpaper: a 96 × 60 still, read with ImageMagick or FFmpeg, again only when the wallpaper changes

- **Date:** 2026-11-17. `v09/accent`.
- **Decision:** the shell never decoded the wallpaper (the compositor does).
  The still is a bundled wallpaper's or a shader's thumbnail, a photo
  itself, or a video's first frame; `magick` (the dashi package requires
  ImageMagick) or `ffmpeg` prints 96 × 60 packed RGB; each pixel votes for
  its hue in 10° bins weighted by its chroma squared (greys and near-blacks
  don't vote: the VM pass found a plain chroma vote let Aurora's dark sky
  win); the winning bin's weighted lightness, chroma and hue are the seed,
  and the guard draws it like any pick. Dusk comes out magenta (#862281 on
  Light), as the design's; Aurora blue. A picture with no colour keeps Kombu
  and says so in the log.
- **Undo:** `appearance/accent.ts` (`AccentSync`, `readPixels`);
  `seedFromPixels` in @dashi/ui.

### D433. Custom… is a popover in the window's layer; its pictures are PNGs made on the CPU

- **Date:** 2026-11-17. `v09/accent`.
- **Decision:** Metal's `Svg` tints its markup as a mask, so gradients don't
  show; the field (per 2° of hue), the hue strip and the Custom… swatch's
  ring are small PNGs drawn in TypeScript (a 60-line encoder on
  `node:zlib`) into `$XDG_CACHE_HOME/dashi/accent/`, as the design asked
  ("cached Images, not gradients"). The popover is drawn in Settings' window
  layer (as a row's More menu); a press outside, Esc or Cancel leaves the
  accent as it was. The hue strip is HSV (what people know from pickers);
  the guard's bands are marked under it from the guard's own `isGuardedHue`.
- **Undo:** `settings-app/lib/accent/`.

### D434. The eyedropper is in: a clear overlay and a 1 × 1 capture

- **Date:** 2026-11-17. `v09/accent`.
- **Decision:** dashi-comp's `capture` already takes a `rect`; a 1 × 1 rect
  is one point, cheap. The shell shows a clear overlay on Settings' screen
  ("Click a colour to use it. Esc cancels."), closes it, waits a frame,
  captures the point into the runtime folder, reads it with ImageMagick and
  removes the file. No new IPC. `eyedropper/`.
- **Undo:** leave `pickPixel` out of Settings' options: the button is not
  drawn.

### D435. Agents set the accent by name: a preset or the wallpaper

- **Date:** 2026-11-17. `v09/accent`.
- **Decision:** `appearance/accent` is a registry row, so the launcher,
  links and agents' `set_setting` (`accent_colour`) reach it with one of
  kombu, ai, momo, wasabi, kuri, nori, wallpaper. A colour of the person's
  own is the person's, in the pane: the registry's schema has only enums and
  ranges, and widening it for one row was not worth it. `get_settings` reads
  a custom accent as its hex.
- **Undo:** `ACCENT` in `settings-app/registry/appearance.ts`.

### D436. Outside apps: exact in GTK, nearest named through the portal, Helium through GTK

- **Date:** 2026-11-17. `v09/accent`.
- **Decision:** gtk.css's block gets the guarded fill per mode
  (`accent_bg_color`, `--accent-bg-color`, GTK 3's `theme_selected_*`) and
  `onAccent` as `accent_fg_color`, rewritten when the accent changes (an app
  takes it when reopened). The portal's `accent-color` is the Light fill
  (libadwaita snaps it to the nearest of its nine; Qt 6.6+ takes it as is),
  and gsettings' `accent-color` the nearest GNOME name, both live. Helium
  stays in GTK theme mode (`system_theme: 1`, already in dashi-helium's
  initial preferences): no `BrowserThemeColor` policy, which would be a root
  write on every pick. KDE colour schemes are not written (Plasma is not on
  Dashi).
- **Found in the VM (Fedora 44, libadwaita 1.9.4, Helium on Chromium 157):**
  a libadwaita app (zenity) takes the exact fill and `onAccent` words when
  it opens; while it runs it keeps the colour it opened with (gtk.css's
  exact colour outranks the portal's live, nearest-named one). Helium in
  GTK mode takes the accent on restart and makes its own tonal palette from
  it: Kombu green, Momo pink, Ai blue, but Kuri comes out orange and Wasabi
  near-black; web pages' own controls keep Chromium's blue. gsettings' name
  is not what Helium reads (set alone, nothing changed). No Qt app with a
  window was installed to look at.
- **Undo:** `accentPair` in `shared/appearance/gtk-colors.ts`, `accentFill`
  in the portal's `settingsTable`, `AppThemeSync.apply`'s accent.

### D460. Claude's and ChatGPT's subscriptions are never an extension's account

- **Date:** 2026-11-17. `v09/launcher-forms` (launcher slice 4).
- **Decision:** `account:` and `accounts` refuse claude.ai, anthropic.com,
  chatgpt.com and openai.com, and any host under them, when the manifest is
  parsed (`refusedProvider` in `@dashi/applet` permissions.ts), and the
  shell's `providerFor` knows none of them. The owner's rule: Dashi never
  signs anyone in to those subscriptions. An extension may still take an
  API key the person pastes into its own `secret` preference: that is the
  person's to give, not a sign-in Dashi offers.
- **Undo:** `REFUSED_PROVIDERS` in permissions.ts (do not, without the owner).

### D461. A form's values are the launcher's; it checks `required` and `max` before anything is sent

- **Date:** 2026-11-17. `v09/launcher-forms`.
- **Decision:** a `Form` tree's fields (`TextField`, `TextArea`, `Dropdown`,
  `TagPicker`, `Checkbox`, with `Option` and `Description`) are drawn by the
  launcher, which holds what is typed (the shell's `TreeSession`): the
  extension's `value` is where a field starts, a kept draft wins over it, and
  each change is sent as `change` so `onChange` can set its own `invalid`.
  ❖↩ (the form's first action, `Action.SubmitForm`) is refused with the
  missing field's words under it and in the field row while a `required`
  field is empty, a field is over its `max`, or one carries `invalid`; only
  then is `submit` sent with every value by name. The extension's own
  complaint is `invalid` on the wire (the SDK keeps Raycast's `error`): a
  prop named `error` made a node's props look like a refusal to
  `isRefusal` and the whole view was refused, found by the first test.
- **Why:** the launcher keeps the keyboard and the draft; validation that
  needs no round trip doesn't wait for one.
- **Undo:** `lib/tree-form.ts`, the `submit` branch of `TreeSession.act`.

### D462. A form's draft is a file beside the extension's data, gone once sent and closed

- **Date:** 2026-11-17. `v09/launcher-forms`.
- **Decision:** a form whose root says `draft` keeps its values as they are
  typed in `applet-data/<id>.drafts.json`, by command, outside the sandbox
  (the extension can't read or write it); the next open of that command
  starts from it. It goes when the extension closes the view after a
  `submit`. A failed send keeps it.
- **Undo:** `src/applets/drafts.ts`; without `drafts` in `ExtensionViews`, nothing is kept.

### D463. `network:HOST` is no network and a proxy that lets through HTTPS to those hosts only

- **Date:** 2026-11-17. `v09/launcher-forms`. Replaces D346.
- **Decision:** an extension that names hosts (and not `network`) gets
  bubblewrap's own network namespace (only loopback), the certificates, and
  one Unix socket to a CONNECT proxy that runs outside the sandbox in its
  unit (`src/applets/net-proxy.ts`, started by `dashi-applet-run`). The proxy
  answers CONNECT to port 443 of a named host (any case, a trailing dot
  ignored) and 403 to anything else, resolving names itself. Inside, a bridge
  (`bin/dashi-net-bridge.ts`, run before the extension's `main.js` in the same
  process, its listener `unref`ed) listens on the sandbox's own 127.0.0.1:3128
  and passes each connection to the socket; `HTTPS_PROXY` points Bun's
  `fetch` at it. Proved with real bubblewrap (`applets-net-proxy.test.ts`):
  the named host goes through, another is refused (raw CONNECT and `fetch`),
  and around the bridge there is no network. The consent sheet now says
  "Talk to HOST, and no other address", and "It can't reach any other address".
- **Cost:** HTTPS only (plain HTTP and other ports are refused); an extension
  that ignores `HTTPS_PROXY` (a raw socket, a WebSocket library that doesn't
  read it) has no network. Both are what the permission says.
- **Undo:** `proxiedHosts` and the `netDir` branches in `lib/sandbox.ts`.

### D464. Accounts sign in with PKCE on a loopback address; Dashi ships its client id and never a secret

- **Date:** 2026-11-17. `v09/launcher-forms`.
- **Decision:** the shell (or the Store, for Settings…) runs OAuth for a
  native app (RFC 8252, RFC 7636): a server on 127.0.0.1 on a free port for
  this one sign-in, the provider's page opened in Helium, `state` checked,
  the code traded with the S256 verifier, then the provider asked who the
  token belongs to. Dashi registers its own OAuth app per provider and keeps
  only its client id in `src/shared/extension-settings/providers.ts`
  (`GITHUB_CLIENT_ID`, empty until the owner registers it;
  `DASHI_GITHUB_CLIENT_ID` overrides it for a test). No client secret is in
  the package: one shipped to every computer is not a secret, and PKCE is
  what binds the code to this sign-in. Until the id is set, Connect asks for a
  pasted token instead, checked with the provider before it is kept.
- **Risk, said plainly:** GitHub added PKCE for OAuth apps in July 2025, but
  its documents still list `client_secret` for the token exchange; whether
  github.com takes a secret-less exchange for an OAuth app is not proved here
  (that needs the owner's app). If it refuses, the next step is GitHub's
  device flow (no secret, no redirect), not a secret in the package.
- **Undo:** `providers.ts`; `sign-in.ts`.

### D465. An account is the extension's: its token in the keyring, who it is on disk, asked once

- **Date:** 2026-11-17. `v09/launcher-forms`.
- **Decision:** an account is kept per extension, as the spec's § 4.4 has
  it: the tokens (and a refresh token, when a provider gives one) in the
  Secret Service as `dashi-extension <id> account <provider>`, and only the
  login and whether the person said yes once in
  `applet-data/<id>.accounts.json`. The extension gets
  `{login, token}` with `open` and an `accounts` message when it changes
  (`useAccount`). Signing in is "secrets and identity" (D260): the first
  Connect asks one question (the launcher's one line, ↩ Sign In; the Store
  row's Sign In and Cancel), never again for that extension and provider,
  Disconnect included. Nothing else about accounts asks.
- **Not built:** refreshing an expiring token (GitHub's OAuth apps' tokens
  don't expire); one sign-in shared by several extensions.
- **Undo:** `accounts.ts`.

### D466. The preview column is a row's, drawn beside any list that has one

- **Date:** 2026-11-17. `v09/launcher-forms`.
- **Decision:** a launcher row may carry a `preview` (words in a block, a
  picture or Markdown, then facts). A list whose rows on screen have one draws
  them at the left and the selected one's preview in a 236-wide column at the
  right (frame L11). The clipboard's copies carry theirs (the text, From,
  Copied, Kind) and an extension's `List.Item` with a `detail` carries its
  Markdown and its facts' words, so the same column serves both.
- **Undo:** `withPreview` in `launcher/lib/list.tsx`.

### D467. Settings… in the Store keeps what the shell reads; a running extension sees it at its next open

- **Date:** 2026-11-17. `v09/launcher-forms`.
- **Decision:** the Store's Settings… (frame S5, on an installed extension's
  row when it has preferences or an account) reads and writes the same
  stores the shell's views do (`src/shared/extension-settings`), in its own
  process; the account's sign-in runs there too, with the same one question.
  An open view doesn't hear a change made in the Store; the next open of a
  command does. Commands' keys ("Keys…") are not in it yet.
- **Undo:** `apps/software/lib/applets/settings-*.ts(x)`.

### D468. While a form shows, ⇥ and the caret keys are its fields'; ❖↩ sends

- **Date:** 2026-11-17. `v09/launcher-forms`.
- **Decision:** the launcher's keymap takes ⇥, Home, End, the page keys and
  ⌃N ⌃P for its list; while a form shows (`LauncherScope.form`, `ExtraKeys.form`)
  those rules are left out so they reach the fields: ⇥ moves between them.
  Return in a line moves to the next field (`focusNextOnSubmit`) and is a new
  line in a long one; ❖↩ (a binding the launcher keeps) sends, and so does
  ↩ in the launcher's own field and ⌃↩ in a long one. The first field of
  words takes the keyboard when the form comes (L8: the title). Found in the
  VM: when the form went (a dry run pushed over it), nothing had the
  keyboard and ↩ did nothing; the launcher's field is now mounted again when
  a form goes (autoFocus is mirin's only way to give a field the keyboard),
  and only then: mounted again as the form came, it left the keyboard with
  no one.
- **Undo:** `FORM_KEYS` in `launcher/keys.ts`; `useRegained` in `launcher/lib/field.tsx`.

### D469. A form's choices open in place, not in a popover

- **Date:** 2026-11-17. `v09/launcher-forms`.
- **Decision:** a Dropdown is a button with its choice and a chevron; pressed,
  its options open under it inside the launcher (⇥ reaches each, Space or
  Return picks). A TagPicker shows the tags chosen ("+ Add" opens the rest,
  a chosen tag pressed goes). An open list shows six options and scrolls
  (oven-sh/bun's 50 labels ran off the panel in the VM). The launcher is one layer surface; a popover
  over it would be a second surface for one list.
- **Undo:** `launcher/lib/form-choices.tsx`.

### D470. Create Issue without an account is a dry run

- **Date:** 2026-11-17. `v09/launcher-forms`.
- **Decision:** Dashi's GitHub extension files an issue with the connected
  account's token (or one pasted in its preferences). With neither, the
  form still works and checks; ❖↩ pushes a detail with the exact request it
  would send (POST and the JSON) and offers Connect GitHub…; nothing is sent,
  and the draft stays. That is also how its VM pass runs without the owner's
  GitHub.
- **Undo:** `send` in `extensions/github/lib/create-issue.tsx`.

### D480. Editing widgets has one key view for the session, and reads the host's key names

- **Date:** 2026-11-17. `v09/fix-inks-1`.
- **Decision:** While widgets are edited, the area draws one `onKeyDown`
  view (`widgets/edit-session.tsx`) for the column and the gallery
  together; the gallery has no key view of its own. Metal gives such a view
  the keyboard when it appears, so the gallery's took it from the column's
  and kept it after the gallery went. Keys arrive with GPUI's names
  ("tab", "up", "escape"); `hostKey` turns them into the names the edit
  keys are written with. In the gallery ↑ ↓ choose in the list, ← → pick a
  size (ringed in the focus purple), Return adds it, Esc closes the gallery
  (a second Esc ends editing); ⌥ arrows and Tab still work the column.
- **Why:** pass 49 found every advertised key did nothing in the installed
  build; the tests had fed browser names to the pure helper only.
- **Undo:** `EditKeys` in `notifications/area.tsx`.

### D481. A player is named by its desktop entry, then its Identity, never its bus name

- **Date:** 2026-11-17. `v09/fix-inks-1`.
- **Decision:** The Music card's small line names the player from MPRIS's
  root interface: the Name in the desktop entry it gives (`DesktopEntry`,
  so Helium is "Helium" even when its Identity says Chromium), else its
  `Identity`, else its bus name without the prefix and the instance number
  ("Chromium"). The line is one line, cut at 16 characters with an
  ellipsis; `Meta` lines are one line everywhere.
- **Undo:** `playerName` in `widgets/lib/sources/player-name.ts`.

### D482. Dashi's weather has one source; the applet template's reading says it is a sample

- **Date:** 2026-11-17. `v09/fix-inks-1`.
- **Found:** the bar's "☀ 21°" that disagreed with the Weather card (20°,
  then 19°) is not Dashi's weather: it is `dev.example.weather`, the applet
  `dashi-applet new` writes, installed in the VM by an earlier pass, whose
  state starts at a made-up `celsius: 21` and never changes. Everything
  Dashi shows of the weather (the card, the lock's date row, Glance, the
  agents' facts) already reads the hub's one `Weather` (Open-Meteo, rounded
  once in `take`, asked every 30 minutes); 20 and 19 were two real answers.
- **Decision:** no second weather in the bar. The template's bar label says
  "21° sample", its popover "A sample reading, not the weather", so an
  example can never pass for a reading beside Dashi's own.
- **Undo:** `label` in the template (`packages/applet/src/cli/lib/templates.ts`).

### D483. A plan with a critical step is a critical ask

- **Date:** 2026-11-17. `v09/fix-inks-1`.
- **Decision:** The capsule marks a plan that waits for a yes `critical`
  when one of its ready steps calls a tool in `CRITICAL`
  (`agents/consent.ts`: paying, a secret, force quit, installing or
  updating software); so it takes the tally as asking (D402), over a song
  or a timer that holds it. A plan that only changes settings or moves
  files stays a running item and waits in its card. An agent's question
  (`ask_person`) is not critical by itself: it waits in its card.
- **Why:** D402 left the flag to whoever makes the ask, and the capsule set
  it nowhere; the critical list is the one D260 keeps, so nothing is
  guessed from words.
- **Undo:** `permissionsOf` in `capsule/lib/told.ts`.

### D484. Installed names each add-on by what it is

- **Date:** 2026-11-17. `v09/fix-inks-1`.
- **Decision:** The Store's Installed page lists add-ons under three
  headings, each shown only when it has one: Launcher extensions (an
  add-on that shows in the launcher), Menu bar applets (one that puts an
  item in the bar and is not an extension), Widgets (one that only gives
  widgets). Search groups them the same way (`isExtension`, `inMenuBar`).
  One Dashi can't read stays with the applets: nothing says what it is.
- **Undo:** `kindOfInstalled` in `apps/software/lib/applets/pages.tsx`.

### D485. The VM pictures the real lock screen through a checkout's session only

- **Date:** 2026-11-17. `v09/fix-inks-1`.
- **Question:** pass 49 could not see the lock screen: agents are refused
  while locked, the person's ⇧❖3 never reaches the shell then (dashi-comp
  sends no binding), and QEMU cannot read the Venus GPU's screen.
- **Decision:** a shell started with `DASHI_DEV_LOCK_CAPTURE=<folder>`
  takes a picture of the screen while it is locked each time a file named
  `ask` appears in that folder (`lock/lib/dev-capture.ts`), through the
  compositor's own capture, which while locked draws only the wallpaper
  and the lock surface. The installed `dashi-session` unsets the variable
  before it starts anything, so only a checkout's session
  (`vm/dev-session`) can have it; the folder must be absolute, a real
  directory, the user's own and mode 0700, or it is refused and logged.
- **Why it is no path in:** an installed session has no code that reads
  the variable's folder; a person at a locked screen cannot set a
  session's environment; and what it pictures is what anyone at the
  screen already sees (the lock, its widgets redacted).
- **Undo:** `devCapture` in `lock/controller.tsx` and the `unset` in
  `session/dashi-session`.

### D486. Every card on the lock screen can be pressed; one without an app opens the notification area

- **Date:** 2026-11-17. `v09/fix-inks-1`.
- **Found:** pass 49's blind press on the lock opened nothing after the
  unlock, and that was a bug, not a miss: the row under the clock
  (Weather, Battery, what is next) had no press at all, and in the side
  column only Calendar, Rundown, Notes and System had something to open.
  On the first-run layout no card on the lock could open anything.
- **Decision:** the row's cards are pressed like the side column's. A press
  asks for the password and says what it will open; once the password is
  in, a card with an app of its own opens it (Battery now opens Settings)
  and every other card opens the notification area, where it lives
  ("Unlock to open Weather in Notifications").
- **Undo:** `lockOpenerOf` in `widgets/openers.ts`, `press` in
  `lock/lib/screen.tsx`.

### D487. A surface's tree has one root view

- **Date:** 2026-11-17. `v09/fix-inks-1`.
- **Found:** on the real lock screen (pictured for the first time, D485)
  Glance never came: the lock screen's root was two siblings, the login
  screen and Glance, and Metal draws only the first root of a tree
  (mirin's `rootOf` in `tree-sync.ts`), silently.
- **Decision:** the lock screen wraps both in one view. A surface's
  component returns one root view, never a fragment of several; mirin is
  asked to say so when it drops a second root (patch in the pass's
  report), not changed here.
- **Undo:** the `lock-screen` view in `lock/lib/screen.tsx`.

### D490. Surfaces ask what the session's Metal hosts say

- **Date:** 2026-11-17. `v09/inks-metal`.
- **Found:** mirin PR #55 (mirin `main` `cde7c24`) adds light weights, the
  display cut, `<Dots>` and `pulse`, each behind a flag on the host's
  `protocol` line; a host from before refuses a whole tree that uses one.
  Nothing in the shell told a component what its host had said.
- **Decision:** `shared/metal/abilities.ts` keeps one record for the shell:
  every host it spawns (`spawnShellHost`, the warm hosts, the launcher's
  resident host) is noted, and a flag is on only while every live host that
  has spoken says it (`useHostAbilities`). The hosts are one binary in a
  session, so the shell's answer stands for each surface; until a host has
  spoken the answer is no and today's look is drawn. Apps and applets run
  their own processes and do not use the new props yet.
- **Undo:** drop `noteHost` from the three spawns; components then see
  `NO_ABILITIES` and draw as before.

### D491. The Inks' numbers in Inter Display, by their style

- **Date:** 2026-11-17. `v09/inks-metal`.
- **Decision:** `Num` sets `fontFamily: "display"` and the weight from
  round five's rule (300–500 by value, 400 under 40 points, units Regular);
  the lock's and Glance's clocks 200. Set in the style directly:
  `@mirinjs/metal-ui`'s Tailwind `font-light` still maps to normal, since it
  cannot see the host's flags. On an older host: Regular, Medium when big and
  near its end, as before (`widgets/lib/numerals.ts`).
- **Undo:** `numberFace` and `clockFace` return `{}`.

### D492. Dot rows and the album print through `<Dots>`

- **Date:** 2026-11-17. `v09/inks-metal`.
- **Decision:** a `DotRow` is one `<Dots>`, padded by `pitch/2 − r` all
  round so its box stays `count·pitch` by `pitch` and no layout moves; the
  mark is the `head`, ringed. The album print keeps its halftone by rounding
  each dot to one of five sizes: one `<Dots>` (`rows` 22, `cells`) per size
  and colour, at most ten nodes for 484 dots, instead of two 484-circle SVG
  masks rasterised per track. An older host keeps the masks.
- **Cost:** the print has five dot sizes where the masks had any.
- **Undo:** `DotRow` and `Halftone` without their `dots` branch.

### D493. The "Now" tag breathes, and Reduce Motion reaches every shell host

- **Date:** 2026-11-17. `v09/inks-metal`.
- **Decision:** `NowTag` carries `pulse` `{ from 0.4, to 1, periodMs 2000,
  fps 4 }` where the host says `pulse`. Reduce Motion goes to each host the
  shell spawns: at spawn (`reduceMotion` in `shellHostOptions`, an
  environment variable an old host ignores), and as a line on each change
  and when a host first says `pulse` (never to a host that did not say it).
  Applets' and apps' hosts are not reached: none of them breathes yet.
- **Undo:** `NOW_BREATH` off in `widgets/parts.tsx`; the
  `hostAbilities.setReduceMotion` line in `boot/look.ts`.

### D494. The gallery's previews read as its list does

- **Date:** 2026-11-17. `v09/inks-metal`. Pass 52.
- **Found:** Music's line reads "Small · Wide" but its previews came in the
  catalog's order (Wide first), so ↓ to Music and Return added it Wide.
- **Decision:** previews are sorted smallest first (`SIZE_ORDER`), as the
  line is; Return adds the first, the size the line names first.
- **Undo:** drop the sort in `previewSizes` (`widgets/gallery.tsx`).

### D495. A chosen one-row card wears its tag across its bottom edge

- **Date:** 2026-11-17. `v09/inks-metal`. Pass 52.
- **Found:** a chosen Weather at Compact had "Weather · mizu · Compact"
  drawn over its temperature: a one-row card has no room under its number.
- **Decision:** on a card one row high (Mini, Compact, Strip) the tag sits
  across the bottom edge, half outside, over the gap; taller cards keep it
  inside at the bottom (`tagOnEdge`, `widgets/layout.ts`).
- **Undo:** `bottom: 8` for every size in `widgets/edit.tsx`.

### D500. Music on air has words in the bar, and its name and "Now" at Small

- **Date:** 2026-11-17. `v09/fix-inks-2`. Passes 53 and 54.
- **Found:** with Music on air the bar showed only a vermilion dot beside
  the clock (music had no capsule by design), and Music at Small has no
  header, so neither the player's name nor the "Now" tag showed on the card
  that held the tally. A timer on air says "● Timer 24:58".
- **Decision:** music on air takes the holder's capsule like everything else:
  "● Slow Tide", the title cut at 24 characters (`MEDIA_LABEL_MAX`,
  `widgets/lib/on-air.ts`); the clock's dot is gone. At Small, on air, the
  card gets a header: the player's name (12 characters) and the "Now" tag.
  Off air the Small card stays as drawn, with no header. At Wide, on air, the
  label says "Music · Helium" beside the tag instead of losing the name.
- **Cost:** the Small card's print and title sit 22 points lower on air.
- **Undo:** `hasCapsule` and `clockDot` back in
  `menubar/lib/menubar-tally-slots.tsx` and `menubar-slots.tsx`; drop the
  `air` header in `widgets/lib/views/media.tsx`.

### D501. The chosen card's tag sits across its bottom edge at every size, and is never cut

- **Date:** 2026-11-17. `v09/fix-inks-2`. Pass 54. Replaces D495's split.
- **Found:** a chosen Rundown Large wore "Rundown · Large" over its last line
  ("Nothing else today"); D495 had moved only one-row cards' tags. A chosen
  Compact Weather's tag read "Weather · mizu · Small →…": the tag is as wide
  as the card at most, and the host cut the words.
- **Decision:** the tag sits across the bottom edge for every size (half
  over the card's 14-point padding, half over the gap), so it never covers a
  line. Its words are the fullest of "Weather · mizu · Small → Compact",
  "Weather · Small → Compact", "Small → Compact", "Compact" that fit the card
  whole, by `textWidth` at 11 points × 1.1 for semibold (`fittedTag`,
  `widgets/edit.tsx`). The full words stay in `tagOf`.
- **Undo:** `TAG.below` back to 8 for cards taller than a row; `tagOf` in
  place of `fittedTag`.

### D502. A blank beside a number fills its row

- **Date:** 2026-11-17. `v09/fix-inks-2`. Passes 53 and 54.
- **Found:** the lock's compact "Next 10:00 EVENT ___" ran past its card's
  right edge: the blank's line was 48 points whatever the time beside it took.
- **Decision:** `Blank` (and `Private`) take `width: "fill"`: the line takes
  what is left of its row, 12 points at least, and ends before the card's
  corner lock (`REDACT_LOCK`, `widgets/look.tsx`). The compact "Next" uses it;
  the other blanks keep their fixed widths (they sit in a column, alone).
- **Undo:** `width={48}` back in `CompactNext` (`widgets/lib/views/calendar.tsx`).

### D510. Every screen counts what its frames cost, and says so while another GPU shows one

- **Date:** 2026-11-23. `v10/screens-gpu`.
- **Found:** "dual screen is slow, laggy, stutters" on the G14: its Samsung on
  HDMI-A-1 hangs off the NVIDIA card (card0) while the AMD iGPU (card1)
  draws. Nothing measured a screen's frames, so nobody could say whether the
  HDMI screen's frames were copied by the CPU, came late, or held the panel
  back.
- **Decision:** each screen counts, in windows of 10 s rolled as frames come
  (no timer): frames queued, frames shown a vblank or more after the one they
  were aimed at and the vblanks missed, idle turns, failures, frames the loop
  waited on, and the time to draw on the loop, to commit, for the GPUs (start
  to the frame's fence, watched on the loop as a readable sync_file) and to
  the vblank. How the picture reaches the card that shows it (one GPU, a GPU
  copy, a CPU copy) is read from smithay's own two log lines by a tracing
  layer (`udev/copy_path.rs`), not guessed. While a card that does not draw
  shows a screen, or with `DASHI_FRAME_STATS=1`, dashi.log has a `frames`
  line per screen every 10 s and the fences are watched; otherwise nothing
  is watched and only counters move. `frame-stats` (anyone may ask) answers
  the same numbers.
- **Cost:** a few counters per frame; while reporting, one more wakeup of the
  loop per frame (the fence), counted as a frame's turn (wakes.rs).
- **Undo:** drop `udev/stats.rs`, `udev/report.rs`, `udev/copy_path.rs`, the
  layer in `main.rs`, and `frame-stats` on both sides and in the doc.

### D511. A screen whose frames come late starts drawing them earlier

- **Date:** 2026-11-23. `v10/screens-gpu`.
- **Found:** a screen started drawing 0.6 of a frame after its vblank
  (frame.rs since 0.5), leaving 0.4 for drawing, the copy to another card,
  and the commit: 6.7 ms at 60 Hz. A frame that takes longer misses its
  vblank and is shown a whole frame late, and with every frame doing so the
  screen runs at half its rate in steps (stutter). The HDMI screen's frames
  are drawn on card1 and then copied by card0, each waiting on the other's
  fence.
- **Decision:** each frame that started on schedule and was shown late moves
  the start a tenth of a frame earlier, down to a tenth; 600 frames on time
  in a row move it back a twentieth, up to 0.6 (`udev/pacing.rs`). Frames
  started off schedule (after an idle look) don't move it; with variable
  refresh none is late. A screen that makes its vblanks is drawn as before.
- **Cost:** a slow screen draws earlier in the frame, so what it shows is
  older when it appears: input that comes between the new start and 0.6 of
  the frame waits one more frame. In the VM (two screens, a glxgears on
  each) late frames went from 3.4 % to under 0.1 % and the wait from queue
  to vblank from 6 to 12 ms (dashi-0.10.0-review/01-screens-gpu). Clients'
  time to draw is the same (they hear when the frame is queued). At most a
  late frame every 10 s or so while the start settles.
- **Undo:** `schedule(…, frame_time(&output).mul_f64(0.6))` back in
  `frame_finished`; drop `Pacing`.

### D512. When the commit cannot carry the GPUs' fence, the loop waits for it

- **Date:** 2026-11-23. `v10/screens-gpu`.
- **Found:** smithay leaves the wait to the caller when a frame's fence
  cannot ride the atomic commit (`RenderFrameResult::needs_sync`: no
  `IN_FENCE_FD`, NVIDIA's driver before 560.35.3, a fence that can't be
  exported). Dashi never waited, so such a display could show a frame the
  GPUs (two, for a screen another card shows) had not finished: tearing.
- **Decision:** wait on the fence before the commit then, and count it
  (`waited`). On the laptop (NVIDIA 620, AMD) the fence rides the commit and
  nothing waits.
- **Cost:** on such a driver the loop blocks for the rest of the frame's GPU
  work (other screens wait that long); `waited` says how often.
- **Undo:** drop `settle_sync`'s wait in `udev/queue.rs`.

### D513. A screen on the NVIDIA card is composed on the GPU that draws and copied by the NVIDIA card

- **Date:** 2026-11-23. `v10/screens-gpu`.
- **Found:** the laptop's log (19 Nov) says smithay set up a GPU copy for
  HDMI-A-1: "Found dma-copy set for renderD128 <-> renderD129: AB30@[Linear]"
  (card1 draws into a 10-bit LINEAR buffer card0 imports, and card0 copies
  it into its own scanout buffer). No CPU copy. Client buffers (the Metal
  host's, Helium's, GTK's) are allocated on card1 with its tiled modifiers.
- **Options weighed:** (1) compose the HDMI screen on card0 itself: every
  client buffer on it would need importing on card0, which takes only LINEAR,
  so each client there would draw into slow LINEAR buffers (told so by a
  dmabuf feedback tranche) or be copied per surface per commit: more copies,
  and windows moving between screens reallocate. (2) Have card0 scan card1's
  buffer out directly: smithay's exporter offers card0's planes only buffers
  from card0's own node, and whether NVIDIA's display scans out another
  card's memory is untested. (3) Keep smithay's MultiRenderer: one composite on card1, one
  full-frame GPU copy on card0, both on the GPUs; the loop only submits.
- **Decision:** (3), as is, with the frames measured (D510), the start paced
  (D511) and the fence honoured (D512). The rest waits for the laptop's
  numbers: if `path=cpu-copy` or `compose_ms` on HDMI-A-1 is large, (1) is
  next, with a per-screen dmabuf tranche for card0.
- **Undo:** nothing to undo; this records why the path stays.

### D550. A screen taller than a 27-inch one is seen from farther, and its default scale says so

- **Date:** 2026-11-23. `v10/screens-setup`.
- **Found:** `defaultScale` asked every monitor for 105 pixels per inch at
  scale 1, whatever its size. The owner's Samsung (890 × 500 mm, about 40
  inches) at 4K is 110 ppi: it came up at 1, so its text was two thirds the
  angle of the laptop's (2880 × 1800 at 1.75 on 300 × 190 mm), seen from a
  metre away.
- **Decision:** a monitor whose short side is taller than a 27-inch 16:9
  screen's (336 mm) wants fewer pixels per inch, in step with its height
  (`DESK_HEIGHT_MM`, `@dashi/ui` `scale.ts`): seen from farther, the same
  text needs fewer to look as big. The 40-inch 4K comes up at 1.5 (2560 × 1440
  points), at 1080p and 1440p at 1; a 55-inch 4K TV at 1.5. Desk monitors
  (24, 27 inches, a 34-inch ultrawide, as tall as a 27) keep what they had;
  built-in panels too. The short side stands for the height, so a monitor on
  its side counts as itself. The login screen uses the same function.
- **Cost:** a 32-inch 4K now comes up at 1.5, not 1.25.
- **Undo:** drop `comfortablePpi`'s height term.

### D551. A chosen scale belongs to the monitor, not to the port

- **Date:** 2026-11-23. `v10/screens-setup`.
- **Found:** the scale a person chose was kept in settings.json by connector
  (`displays.HDMI-A-1.scale`): the Samsung moved to the other HDMI port lost
  it, and a projector plugged into its port got it.
- **Decision:** kept in `displays.json` `scales`, by the monitor's identity
  (EDID make, model, serial; `identityOf`), beside the arrangements
  (`display-config/scale.ts`, `ScreenScales`). A scale kept by port from
  before is taken over by the first monitor seen on that port, and the
  port's entry goes. Settings and agents' `set_display_scale` remember it
  the same way.
- **Cost:** two monitors of the same model with no serial on different
  ports still share nothing: each is known by its port (as their
  arrangements are).
- **Undo:** `ScreenScales.of` back to `settingsStore.displayScale(name)`.

### D552. A monitor nobody chose a mode for runs its native size at its fastest rate

- **Date:** 2026-11-23. `v10/screens-setup`.
- **Found:** a monitor came up at the mode its EDID prefers and nothing
  changed it until a person did: many TVs prefer 4K at 30 Hz over HDMI and
  take 60. In a new set of screens, a monitor whose mode was saved in
  another set (the laptop with the TV, then with another monitor) ran its
  preferred mode again: in the VM, QEMU's 640 × 480.
- **Decision:** the mode a monitor runs when a set is restored: the set's
  saved one; else the one it last ran in any saved arrangement
  (`DisplayStore.lastMode`); else `defaultMode`, its native size
  (`nativeSize`) at the fastest rate it offers there; else what it runs. A
  monitor that prefers less than it offers has no native size and keeps
  what it came up with (Dashi cannot tell a TV's real size from a list).
  A default the screens refuse (a cable that cannot carry it) is dropped
  and the rest of the arrangement is asked for again, without it.
- **Cost:** a 1080p monitor that offers 144 Hz comes up at 144: what it is
  for, and more power than 60.
- **Undo:** `defaultModes: false` in `DisplayManager.restore`.

### D553. The shell keeps screens apart and touching, on every change

- **Date:** 2026-11-23. `v10/screens-setup`.
- **Found:** the comments said the compositor keeps screens apart and
  touching (`comp/src/outputs/place.rs`); no such file exists, and
  `outputs-config` puts a screen exactly where it is told. A screen that
  grew (a smaller scale, a larger mode) covered its neighbour: in the VM the
  second screen sat at x 640 under the first, 1098 points wide. One that
  shrank left a gap the pointer could not cross.
- **Decision:** every request the arrangement makes (a restore, a mode, a
  rotation, a scale, a screen turned on) carries the positions that keep
  every screen touching another and overlapping none (`settle`,
  `display-config/layout.ts`; `settled`, `plan.ts`): the main display stays,
  the others, nearest it first, keep their place if it is free and touching,
  else go to the nearest spot against those placed. A restore with nothing
  to restore still puts overlapping screens right. Settings' scale and an
  agent's go through the arrangement (`DisplayManager.setScale`); the scale
  at first sight comes with the restore (`startDisplays` keeps only the
  variable refresh rate). Sizes in points are rounded up, as smithay does.
  Policy stays in the shell: the compositor still only places.
- **Cost:** a screen may move by itself when its neighbour changes size.
- **Undo:** drop `settled` from `DisplayManager.apply` and `restore`.

### D554. The lock screen is on every screen; the whole of it where the person is

- **Date:** 2026-11-23. `v10/screens-setup`.
- **Found:** one lock host, on the screen the compositor advertised first.
  The other screen showed the bare wallpaper, bright, as if unlocked
  (dashi-comp drew nothing of the session there, so nothing leaked, but it
  did not look locked), and the password field could be on the screen the
  person was not looking at.
- **Decision:** a lock host for each screen (mirin's lock surface takes
  `output` now): the whole lock screen (widgets, power buttons) on the
  screen the person was on, and on each other screen a quieter one: the day
  and the time, who is signing in and the field, as the login screen's
  backdrop, no widgets (`lock/lib/screens.ts`, `LockScreen` `cover`). Each
  has the field because dashi-comp gives the keys to the lock surface under
  the pointer. A screen plugged in while locked is covered; one unplugged is
  let go; if it held the whole lock, it opens on a screen that is left. One
  password unlocks them all (dashi-comp unlocks every lock at the first
  unlock) and the shell closes the rest. A cover whose lock arrives after the
  unlock would keep the session locked: the lock screen comes back (safe).
- **Cost:** a Metal host per screen while locked.
- **Undo:** `planLock` returning no covers.

### D555. The Dock follows the person to the screen they push against

- **Date:** 2026-11-23. `v10/screens-setup`.
- **Found:** the Dock lived on the main display only. With the laptop as
  the main display and the work on the TV, the Dock was on the screen the
  person was not looking at, and nothing brought it over.
- **Decision:** as on a Mac: the pointer resting 250 ms (`FOLLOW_MS`)
  against another screen's bottom edge moves the Dock there, shown or
  autohidden (`dock/presenter.ts`). While the Dock is not out, the one-pixel
  band is claimed along every screen's bottom edge (IPC `edges` without an
  `output`), and the pointer's screen is asked when it arrives. The Dock
  goes back to the main display when that changes or its screen goes; a
  change of screens that leaves its screen there (a scale) leaves it where
  it is. The notification area's room and the minimize animation follow
  the Dock's real screen (`dockSign`), not the main display's.
- **Cost:** a Dock that stays shown has its exclusive zone on the screen it
  followed to, so windows there are squeezed and the other screen's grow.
- **Undo:** leave `pointerScreen` out of `startDock`'s options.

### D556. Captures and the lock's press go where the person is; ⇧❖3 takes every screen

- **Date:** 2026-11-23. `v10/screens-setup`.
- **Found:** ⇧❖4's selection and ⇧❖5's toolbar opened on the screen of the
  focused window, else the first screen (not the main display); ⇧❖3 took
  only the screen under the pointer; a card pressed on the lock screen
  opened the notification area on the first bar.
- **Decision:** ⇧❖4, ⇧❖5 and the recorder's "screen" open on the pointer's
  screen, else the focused window's, else the main display
  (`boot/overlays.tsx` `screenOf`); ⇧❖3 saves a picture of every screen, the
  main display's first ("… (2).png" for the next), as a Mac does; the lock's
  press opens the area on the person's screen (`boot/inks.ts`). Every
  screen's bar keeps the front app's menus (Dashi has no inactive bar: one
  row, nothing dimmed), and the same wallpaper fills every screen (one
  choice; a wallpaper per screen needs the compositor to take one each).
- **Cost:** ⇧❖3 with two screens makes two files.
- **Undo:** `screenNames` back to one `undefined`.

### D530. A new window opens where the person works; a dialog over its parent; an app's next window beside its front one

- **Date:** 2026-11-23. `v10/screens-windows`. The owner: "windows go to the
  wrong place" on two screens.
- **Found:** placing read the pointer's screen for every window. A dialog
  (a window with a parent) opened on the pointer's screen, cascaded, even
  when its parent was on the other one; an app's second window (❖N) did the
  same, wherever the app's window was.
- **Decision:** `arrange/lib/placing.ts` decides in this order: a window that
  has a parent opens over it (centered across, a third of the way down its
  height), on the parent's screen; an app that asked for a spot (X11) gets
  it, kept inside the screen holding it; an app's further window steps 28
  points down and right from its front window, on that window's screen; an
  app's first window where its last one was (D531); anything else on the
  screen the person works on (the pointer's, else the focused window's:
  `chooseScreen`, now in `layout.ts` so placing and `active-screen.ts` choose
  alike), centered a third of the way down and cascading as before. Every
  frame is kept inside what the bar and the Dock leave free.
- **Cost:** a further window no longer follows the pointer to the other
  screen; ⌃❖ arrows or Window › Move to (D535) take it there.
- **Undo:** `placement` back to the pointer's screen for every window.

### D531. The shell remembers each app's last window, and gives it to the app's next first window

- **Date:** 2026-11-23. `v10/screens-windows`. The owner: "why does Dashi
  not remember window position and size before closing the app".
- **Decision:** when a window closes, the compositor says where it last was
  (`window-closed {frame, fullscreen}`: on screen, waiting on another
  Desktop, or minimized; a full-screen window's frame from before). The shell
  keeps, per app id, that frame from its screen's top left, the screen by its
  identity (EDID make, model and serial: `identityOf`, so the same monitor on
  another port is the same screen), and its tile or Fill, in
  `~/.config/dashi/windows.json` (0600, written atomically once per turn of
  the loop, parsed as outside data: a damaged entry is dropped alone; 256
  apps at most, the longest closed forgotten first). An app's **first** window
  (none of its windows open, on any Desktop, minimized or not) opens there,
  pulled inside the usable area if the bar, the Dock or the screen changed,
  tiled or filled again if it was; if that screen is not here, on the screen
  the person works on at the same size. Never for a dialog, a window that
  asked for a spot (X11), the portal's sheets or the clipboard helper: they
  neither take a memory nor leave one.
- **Why the shell:** placing is the shell's decision, so it works for every
  app at once, without each keeping its own size (D534).
- **Cost:** one small file; an app that sizes itself on purpose each launch is
  resized to its last frame once it is placed (the app may still resize).
- **Undo:** drop `Remembering` from `arrange/arrange.ts` (pass no memory); the
  file can stay, unread.

### D532. Full screen comes back only when the person chose it

- **Date:** 2026-11-23. `v10/screens-windows`.
- **Decision:** a window that closes in full screen comes back full screen
  only if the person put it there (⌥ and the square, ⌃❖F, the View or Window
  menu). One that went full screen by itself (a game, a player, F11 in an
  app) comes back at its frame from before: it goes full screen again by
  itself if it wants, and a game that sizes itself is not fought.
- **Undo:** `Remembering.closed` keeps `closed.fullscreen` whoever asked.

### D533. A screen that goes takes no window with it, and its windows go back when it returns

- **Date:** 2026-11-23. `v10/screens-windows`.
- **Found:** on an unplug the shell moved in only the windows that showed:
  `fitWindows` skips a window with no frame. A minimized window, one waiting
  on another Desktop and a full-screen one stayed where the screen had been,
  out of reach; and nothing went back when the screen returned.
- **Decision:** the compositor reports where a minimized or hidden window
  comes back (`Window.parked`), as it does `away` for another Desktop's.
  When a screen goes (unplugged, off, the lid closed on it, mirroring), every
  window on it (on screen, `away` or `parked`) moves to the nearest screen
  left at the same place in its usable area (`carryFrame`), a tile to its
  tile there, a full-screen one full screen there (out, framed, in); each is
  remembered as displaced. When that screen comes back (by identity), each
  displaced window still as it was moved goes back: a drag, a resize, a tile,
  Fill, Center, Back or Move to by the person forgets it
  (`arrange/lib/screens-gone.ts`). Each change logs one line ("screens: gone
  eDP-1, came none; 5 windows moved off, 0 back"), so a report from the
  laptop says what happened.
- **Cost:** a window the app moved by itself meanwhile still goes back.
- **Undo:** drop `screensChanged` from `Arranger.refresh`; `fitWindows` alone
  is what was.

### D534. Calculator no longer remembers its own size

- **Date:** 2026-11-23. `v10/screens-windows`.
- **Decision:** the Calculator opened at the size it kept in
  `calculator.json`; the shell's memory (D531) now gives every app's first
  window its frame, place included, so the Calculator opens at its least
  size (with the tape's room when it shows) and the shell frames it. It
  still keeps the tape and whether it shows. A `size` an older Calculator
  wrote is left unread.
- **Undo:** `openingSize` and `Remembered.size` back (`apps/calculator/lib/`).

### D535. Window › Move to a screen, by the name Displays gives it

- **Date:** 2026-11-23. `v10/screens-windows`.
- **Found:** a window went to the other screen only by dragging it, or by
  ⌃❖ arrows past a half (which tiles it).
- **Decision:** with two screens or more, the Window menu lists "Move to
  Built-in Display" / "Move to LS49AG95" (the model, as Displays names it)
  for each screen the window is not on, after Back to Previous Size. The
  window keeps its place in the usable area there (`carryFrame`), or its
  tile; Back to Previous Size gives its own frame back on the new screen
  (`Arranger.toScreen`). None for a full-screen window.
- **Undo:** drop `screenItems` from `menus/model.ts`.

### D536. A window off every screen belongs to the nearest one, not the first

- **Date:** 2026-11-23. `v10/screens-windows`.
- **Found:** `screenFor` gave the first screen when no screen held a
  window's center. With a laptop (1029 tall) beside a taller monitor, a
  window whose center sat in the gap below the laptop, next to the monitor,
  was tiled, filled, centered and fitted on the laptop.
- **Decision:** the screen nearest the center (by the distance to its
  nearest edge) when none holds it (`layout.ts`). Everything that asks which
  screen a frame is on (tiles, Fill, Center, Back, fitting, placing, Move to)
  follows.
- **Undo:** `screens[0]` back as `screenFor`'s fallback.
### D570. One clock: the inks clock on the lock screen, the login screen and Glance

- **Date:** 2026-11-24. The owner's answer to Q1 of the 0.10 design plan
  (`dashi-0.10.0-review/10-design-audit/plan/`, theme T31). `v10/design-rules`.
- **Question:** design.html's TY-1 named an 88 Bold clock on one line; the
  lock and Glance draw the approved inks clock (120 Inter Display ExtraLight,
  hours over minutes); the login screen still drew the 0.8-era 88 Bold.
- **Choice:** the inks clock everywhere. TY-1 names it (`TYPE.clock`, 120 over
  a 112 line), TY-2 allows Inter Display's weights for numbers only, and the
  login screen and the greeter take the lock's component (W7).
- **Why:** design.html says the two screens have one look, the inks clock is
  the newer approved drawing and already ships on two of the three, and one
  component is less than two.
- **Cost:** the login screen is redrawn; an older Metal host without display
  weights draws it Regular, as it does on the lock today.
- **Undo:** TY-1 back to "88 Bold, one line" and the lock and Glance redrawn,
  or TY-1 naming two clocks (the plan's options B and C).

### D571. The lock follows the person's mode; the login screen stays Dark

- **Date:** 2026-11-24. The owner's answer to Q2 (T32).
- **Question:** design.html said the login and lock screens have one look,
  Dark's. The inks round drew a Light lock (frame 5), and the inventory said
  the lock should follow the person.
- **Choice:** the lock follows Light and Dark, with the inks' Light set and
  `lockGlass`; the login screen stays Dark. One layout and one clock for both.
- **Why:** the lock belongs to someone signed in; the login screen to nobody
  yet, so Dark stays its neutral. No owner rule forbids it, and two approved
  designs ask for it.
- **Cost:** a second set of lock tokens (from `inks.ts`'s Light inks, which
  exist), and a Light lock to check for contrast.
- **Undo:** "Dark is true black" back to "one look, Dark's", and a line under
  How to use this page that the inks' Light lock frame is superseded.

### D572. Progress bars and links are ink, never the accent

- **Date:** 2026-11-24. The owner's answer to Q3 (T15). Overrides that part
  of the accent design (D430–D436).
- **Question:** the approved accent design shows progress and links in the
  accent; with the default accent that is Kombu's green, and the owner's rule
  is that the on colour means on only.
- **Choice:** a progress bar is ink on its track; a link is ink, underlined.
  `accentInk` is for a chosen pill's words on a wash and the launcher's tags.
  CO-1, CO-10, the Contrast table and the Progress row say so.
- **Why:** a progress bar is not on and a link is not chosen; Control
  Center's and Settings' sliders and Settings' one bar are ink already, and
  the earlier approved inventory said "links in ink and underlined".
- **Cost:** `ProgressBar` changes colour (W1); an approved frame loses.
- **Undo:** CO-1 naming progress and links as the accent's, and the Progress
  row "the accent on track".

### D573. One control kit, `@dashi/ui`, with two looks; metal-ui only inside it

- **Date:** 2026-11-24. The owner's answer to Q4 (T07).
- **Question:** conventions.md said metal-ui first; no app imports it. The
  shell's `shared/controls` was a second kit beside `@dashi/ui`.
- **Choice:** `@dashi/ui` is the one kit, with a window look and a panel look
  (`look="panel"`); `shared/controls` moves in as the panel look (W1).
  `@mirinjs/metal-ui` is used inside `@dashi/ui` where it already has the
  part, and apps never import it. conventions.md's "UI Components", CLAUDE.md
  and AGENTS.md, design.html's Components and UI-1 say so; the open question
  is closed.
- **Why:** every app and fifteen shell modules are built on the two Dashi
  kits; one kit gives one place per control, one slider math, one ring, and
  lets H22 say "controls come from `@dashi/ui`".
- **Cost:** `shared/controls` moves, and its fifteen users' imports change.
  Fixes metal-ui needs still go to mirin (fix-mirin-at-the-source).
- **Undo:** conventions.md's "metal-ui first" back, and a Dashi theme for
  metal-ui (the plan's option B).

### D574. Settings and Control Center keep a named second row of sizes and radii

- **Date:** 2026-11-24. The owner's answer to Q5 (T02, T03).
- **Question:** TY-1 and RA-1 denied the panel language (Settings, Control
  Center, the menu bar, the capsule, the launcher's conversation) that the
  approved designs draw and the code follows.
- **Choice:** TY-1 names a panel row (10.5, 11.5, 12.5, 13.5, 18) beside the
  app row (11, 12, 13, 15, 17, 20), and RA-1 names the surface radii (menu 9,
  widget 14, Settings' card 24, panel 28, capsule card 17.5, Dock 18, icon
  10.5). The stray sizes (8, 10, 14, 16, 22, 30) and radii (6, 8, 9, 16, 18
  outside their surfaces) go. TK-2 names the three looks.
- **Why:** the panel language is designed and approved; naming it turns 174
  "off-scale" sizes into about 80 real fixes.
- **Cost:** a second row to learn; H21a's allow-list is longer.
- **Undo:** drop the panel row and fold the panels onto the app row (the
  plan's option B), which redraws Control Center and pill-v2.

### D575. Three shadows: sm, xl, and lg for floating HUDs

- **Date:** 2026-11-24. The 0.10 design plan's R1 (T04).
- **Choice:** DE-1 names sm (controls, cards), xl (sheets, menus, popovers)
  and lg (the capsule and card, banners, the OSD); no md, no xs. md maps to
  sm or xl, xs to sm.
- **Why:** pill-v2 (approved) says lg, and banners and the OSD float the same
  way.
- **Cost:** a third preset to keep.
- **Undo:** DE-1 back to two, and the HUDs onto xl.

### D576. "On" is one token per mode

- **Date:** 2026-11-24. R2 (T06).
- **Choice:** the guard's `selection` under `onAccent` is "on" for every
  switch, tick, chosen pill and lit tile, in the apps and in Settings and
  Control Center. Control Center's Kombu-only `#2F6F5B` / `#86D3B6` under
  `#0B2A20` go, and so does Settings' own menu highlight (CO-9).
- **Why:** a picked accent already reaches both kits this way
  (`shared/controls/palette.ts`); only Kombu disagreed.
- **Cost:** Control Center's Dark on is deeper; W1 checks it reads as a fill
  on the off tile `#141417` (3:1).
- **Undo:** the two constants back in the panel palette.

### D577. Segmented and choice pills: one look each per kit, glyph segments

- **Date:** 2026-11-24. R3 (T09).
- **Choice:** UI-2's two pick-one controls keep one look each, in each look
  of the kit; `Segmented` takes glyph segments, each with a name, and its
  chosen segment casts sm.
- **Why:** UI-2 already names exactly these two; the drift was hand-made
  copies.
- **Undo:** none needed; a third control would need a rule first.

### D578. An alert's tile says the job; the accent never washes it

- **Date:** 2026-11-24. R4 (T16).
- **Choice:** ume for destroy and failure, broth for caution, shiso for an
  agent's question, neutral for everything else.
- **Why:** the inventory said "the alert tile neutral"; CO-1.
- **Undo:** add the accent back to the Alert row.

### D579. Terminal's cursor and bell are ink; its palette lives in the theme

- **Date:** 2026-11-24. R5 (T30).
- **Choice:** the cursor and the bell's edge are the grid's ink, as a field's
  caret is (CO-9); the Light ground is `surface.window`; the palette moves into
  `@dashi/ui`'s theme as the terminal set, read by foot, kitty and GTK
  terminals. The open question "Terminal colors" is closed.
- **Why:** a cursor is not on; it removes two whites from one window.
- **Undo:** the Cursor row back to kombu, the ground to `#FBFAF7`.

### D580. Copy: American spelling, sentence case, curly apostrophes, no "Are you sure"

- **Date:** 2026-11-24. R6 (T34).
- **Choice:** VO-9 (color, center; "colour" stays a search word), VO-1
  (sentence case everywhere outside the menu bar), VO-3 (curly apostrophes,
  checked), VO-10 ("Log out now?").
- **Why:** design.html's own example says "Accent color"; the code and GTK
  say color and center.
- **Cost:** many strings, each in its workstream.
- **Undo:** drop VO-9 and VO-10.

### D581. The file chooser is a sheet for Dashi's own apps

- **Date:** 2026-11-24. R7 (T39).
- **Choice:** PA-12: a first-party app's Open, Save As and Export show the
  chooser as a sheet over its window, with Files' row; the portal's window is
  for other apps; never a typed path.
- **Why:** it keeps the window's context, and one browser.
- **Undo:** PA-12 without its 0.10 sentences.

### D582. Missing hardware, and the Wi-Fi pane is Network

- **Date:** 2026-11-24. R8 (T42).
- **Choice:** SE-17 for hardware that isn't there; SE-16 renames the Wi-Fi
  pane Network, keeping "Wi-Fi" as a search word and its old address (SE-4).
- **Why:** the pane holds Ethernet and VPN.
- **Undo:** the pane's name back; the address never changed.

### D583. The copy rules are VO-1 to VO-11; the capsule keeps CP

- **Date:** 2026-11-24. R9 (T43).
- **Question:** CP- named two sets of rules on one page: the capsule's
  CP-1…CP-10 and the copy rules CP-1…CP-8.
- **Choice:** the copy rules become VO-n (Voice), keeping their numbers, and
  new ones continue at VO-9. Citations in docs and code comments that are
  about words, casing, ellipses, shortcuts in text, "Dashi", names, pane names
  or disclosure are renamed; one about the capsule stays CP-n. Decisions,
  commit messages and the 0.4 and 0.5 release pages are not rewritten (their
  links point at the new anchor).
- **Why:** fewer citations to rewrite than renaming the capsule's.
- **Undo:** rename back; the anchors `#vo-n` would break.

### D584. Owner rules outrank store-v2's frames

- **Date:** 2026-11-24. R10 (T44).
- **Choice:** the Store's "Reviewed by Dashi" seal is ink, a count muted, a
  sidebar selection CO-9's; "How to use this page" lists them.
- **Why:** owner rules outrank approved frames.
- **Undo:** none wanted while the owner rules stand.

### D585. Appearance's rows keep their knobs

- **Date:** 2026-11-24. R11 (T41).
- **Choice:** the accent frames' knob-less Appearance rows were incidental;
  SE-6 and SE-13 hold.
- **Undo:** an SE-13 exception for Appearance.

### D586. One notification card

- **Date:** 2026-11-24. R12 (T25).
- **Choice:** the new Notifications section: radius 12, padding 12, icon 28
  at radius 7, actions small Buttons, the banner on lg (NO-1 to NO-4).
  CD-29's 36 icon is dropped: one card wins.
- **Undo:** the banner's own card back.

### D587. A checkbox is on in the on token

- **Date:** 2026-11-24. R13 (T12).
- **Choice:** `Checkbox` on is the on token with an `onAccent` tick; Settings'
  Ticks become its panel look (UI-10).
- **Why:** a tick is "chosen", which is the accent's job; the approved accent
  design lists the checkbox.
- **Undo:** the tick in ink.

### D588. A chosen widget is ringed in ink, never purple

- **Date:** 2026-11-24. R14 (T29).
- **Choice:** in the widget area a chosen row or widget is an ink wash with a
  2 px ink edge (CO-9); purple never marks a choice made with the pointer
  (KB-2).
- **Why:** the accent README says "Edit mode's chosen widget uses ink";
  purple is the keyboard's and agents'.
- **Undo:** none wanted while KB-2 stands.

### D589. design.html binds its measures to tokens with `data-token`

- **Date:** 2026-11-24. `v10/design-rules` (W0).
- **Question:** H24 must compare design.html with the code, and the page's
  measures are prose.
- **Choice:** an element that states a measure carries `data-token="NAME"`,
  NAME as in the 0.10 plan's `tokens.md` (`TYPE.body`, `RADIUS.card`,
  `SHADOW.lg`, `MOTION.step`) or an exported constant (`MENU.padding`), and
  its text is the value: the numbers in it, in order, are the token's (a
  `TYPE` role is size then line; a `WEIGHT` its number, which Metal names
  `normal`, `semibold`, `bold`, `extralight`, `light`, `medium`; a `SHADOW`
  its preset's name). The token
  tables carry it on each value cell (the name shows under it); the
  component tables on spans around the numbers. W1's
  `scripts/check-design-sync.ts` reads them.
- **Why:** one attribute is all a check needs, and a person reading the page
  sees which token a number is.
- **Cost:** the rest of the page's measures (component heights, the
  launcher's) are bound only as they get a token.
- **Undo:** strip the attributes and the CSS that shows them.

### D590. A 0.10 rule not yet in code names its workstream

- **Date:** 2026-11-24. W0.
- **Choice:** every rule the 0.10 plan added or changed says "(0.10)", and,
  where the code doesn't follow it yet, carries the page's usual "Not yet in
  code" tag naming the workstream that makes it so (W1 to W7, as "How to use
  this page" lists them) and what the code does today. A workstream edits
  only those notes in the sections it owns.
- **Why:** the page already marks rules ahead of the code this way; naming the
  workstream says who removes the tag.
- **Undo:** none needed; tags go as the code follows.

### D537. Every window follows its screen, on every Desktop; a window shrunk to fit gets its size back

- **Date:** 2026-11-24. `v10/screens-fix`.
- **Found** (the installed pass, `dashi-0.10.0-review/04-screens-installed`):
  after a screen change only the windows that showed were fitted
  (`fitWindows` skipped a window with no `frame`). A tile on a Desktop that
  wasn't showing kept the tile it had while the replugged screen had no bar
  yet (y 6, under the menu bar); a full-screen Terminal kept 820 × 615 in a
  screen that went to 1024 × 768; Files hung 158 pt off a screen that
  shrank. A screen moved in the arrangement left its windows where they
  were, on the other screen. And a window fitted into a screen that came back
  at 640 × 480 before its mode was set kept that size, and its app's memory
  stored it.
- **Decision:** one pass on every screen change, over every window
  (`frame`, `away` or `parked`): one on a screen that went moves off as in
  D533; one on a screen still here goes where the screen went (the same
  place from its top left), inside its usable area as it is now, a tile to
  its tile there, a full-screen one full screen over it again (out, framed,
  in) when the screen moved or changed size. A window the screen has no room
  for is shrunk and remembered as displaced, as a window off a screen that
  went is; whenever its screen has room again it gets its own frame back. A
  window closed while displaced leaves its own frame (and screen) in its
  memory, not the one a screen still settling gave it. A drag, a resize or
  an arrangement by the person forgets it, as before.
  (`arrange/lib/screens-gone.ts`; `fitWindows` is gone.)
- **Cost:** a window the app resized itself while displaced gets the size
  the shell remembered at the next screen change.
- **Undo:** `fitWindows` back after `screensChanged`, and `screensChanged`
  only for screens that went or came.

### D538. A set of screens with nothing saved comes back as it last ran

- **Date:** 2026-11-24. `v10/screens-fix`.
- **Found:** with no arrangement saved for a pair of screens (nobody had
  changed it in Displays), the main display unplugged and plugged back came
  back as the second screen, right of the other, which stayed main
  (`choosePrimary` took the first connector listed, and the compositor puts
  a new screen on the right).
- **Decision:** the display manager notes the arrangement each set of
  screens runs, whenever it changes (`display-config/lib/seen.ts`; not when
  a screen is off or on its way), and a set with nothing saved is restored
  from that: where each was, its mode, and which was main. A set never seen
  makes the built-in panel main, else the main display the person last had
  among several, else the first. Kept in memory only: `displays.json` holds
  what a person or an agent chose.
- **Cost:** after a new login, a pair never arranged in Displays comes up as
  the compositor places it, as before.
- **Undo:** `restore` reads `store.get(key)` alone; `previousMain` out of
  `planRestore`.

### D539. Displays marks the rate the screen runs, the nearest offered

- **Date:** 2026-11-24. `v10/screens-fix`.
- **Found:** a 1920 × 1200 screen offering 59.95 and 59.885 Hz, running
  59.885, showed 59.95 chosen: the first rate within 0.6 Hz won, and
  choosing 59.95 did nothing.
- **Decision:** `rateOf` gives the nearest rate within 0.6 Hz
  (`display-config/monitors.ts`), for the pill and for whether a choice is
  the one running.
- **Undo:** the first within 0.6 Hz, as `RefreshRate` had it.

### D540. A capture of a whole screen is its own pixels

- **Date:** 2026-11-24. `v10/screens-fix`.
- **Found:** ⇧❖3 saved 1922 × 1201 for a 1920 × 1200 screen at 1.75: the
  screen's size in points is rounded up (1098 × 686), and scaled back it is a
  pixel over.
- **Decision:** `capture` of a whole screen (`output`, or the screen under
  the pointer) crops the picture to the screen's mode (`Picture::cropped`).
  A `rect` or a window is as before; screencopy and image capture keep the
  sizes they announce.
- **Undo:** drop the crop in `ipc/methods/capture.rs`.

### D600. The measures are tokens in @dashi/ui's theme, named by role, with Metal's own words

- **Date:** 2026-11-24. The `design-kit` agent's (W1a of the 0.10 design plan).
- **Question:** the 0.10 audit found 3,526 design values written as numbers in 403 files: only
  colours were tokens. The plan's `tokens.md` names the sets; how are they written?
- **Choice:** `packages/dashi-ui/src/theme/measures.ts` holds `TYPE` (each role a `{ size, line }`:
  the app row, the panel row, the named figure and clock, the Inks), `WEIGHT` (Metal's names, the
  display weights under `WEIGHT.display`), `SPACE`, `RADIUS` and `pill(h)`, `SHADOW` (sm, xl, lg),
  `OPACITY`, `MOTION`, `DELAY` and `CURVE` (the curves as functions of t, the Dock's spring among
  them). `useType()` (`theme/type.ts`) is `TYPE` at the person's text size, rounded to the half
  point so the panel row's halves stay halves; the launcher's own measures move onto it with W3.
  Names are `tokens.md`'s exactly, so design.html (W0) and the code agree.
- **Why:** one place per measure, and a check (H21) can tell a token from a literal.
- **Cost:** nothing changes on screen yet: the swaps are each workstream's.
- **Undo:** the file is additive; delete it and its exports.

### D601. The sets that lived in modules live in the theme; the modules keep their names

- **Date:** 2026-11-24. The `design-kit` agent's.
- **Question:** CO-5 says no hex outside the theme, but Control Center's controls, Terminal, the
  file icons, the persona, the capsule and GTK kept their own tables. Move every user to new
  names, or move the tables?
- **Choice:** the tables moved (`theme/controls.ts`, `theme/sets.ts`, `theme/gtk.ts`, and the new
  single colours in `theme/colors.ts`: `CLEAR`, `HIT_AREA`, `KNOB`, `ON_DANGER`, `ON_AGENT`,
  `ON_TINT`, `AMBER`, `CAPTURE_AREA`, `LOCK_GLASS`, `LOGIN`, `MEDIA_SCRIM`, `INK_TILE`, and
  `SCRIM`, which left `sheet.tsx`). Each module still decides how to use its set and keeps its own
  name for it as a constant of its own (`LIGHT_TERMINAL = TERMINAL.light`), so no caller moved and
  nothing re-exports (H19). `tokens.test.ts` holds every set's contrast. The single colours are
  there for W2 to W7 to swap in; only W1's own files use them so far.
- **Why:** the tables are design data, and design data is the theme's; the callers are each
  workstream's to change.
- **Cost:** two names for each set until its module's next change uses the theme's directly.
- **Undo:** copy a table back into its module.

### D602. One "on": Control Center's Kombu greens go

- **Date:** 2026-11-24. The `design-kit` agent's (plan R2, CO-1).
- **Question:** Control Center and Settings painted "on" in their own Kombu greens (`#2F6F5B` in
  Light, `#86D3B6` under `#0B2A20` in Dark), while every other switch used the guard's `selection`.
- **Choice:** the panel look's `on` and `onInk` are `onOf(palette)`: the guard's `selection` under
  `onAccent`, with the person's accent drawn in by `paletteFor`, as every kit draws it. In Dark,
  Kombu's on is now `#357A64` under white, 3.6:1 on Control Center's off tile `#141417` (a fill
  reads at 3:1) and white on it 5.1:1.
- **Why:** a picked accent already reached both kits this way; only Kombu disagreed.
- **Cost:** Dark's on tiles are deeper than before.
- **Undo:** `LIGHT_CONTROLS` and `DARK_CONTROLS` in `theme/controls.ts` take literal greens again.

### D603. The design checks keep one list per workstream, owned by path

- **Date:** 2026-11-24. The `design-kit` agent's.
- **Question:** H21 to H24 start from today's offenders, and seven workstreams empty them in
  parallel. One list per check would be edited by every branch at once.
- **Choice:** each check splits its offences by the workstream that owns the file
  (`scripts/design-lists.ts`, the plan's `owners.py` in TypeScript, first match wins) and holds
  each part to `scripts/lists/<check>/<W>.txt` (`h21` for H21a, `h23`, and `h22` with W1b). The
  lists were written once with `--seed`, which refuses to overwrite one; after that they only
  shrink, as every list does. H23's purple-edge rule accepts a style that also sets
  `focusBorderColor` within six lines (a field's own edge, which the plan allows).
- **Why:** no two branches edit the same list, and a workstream sees only its own offenders.
- **Cost:** a file that moves to another workstream's folder moves lists by hand (`--shrink` on
  both sides).
- **Undo:** merge the seven files into one list per check.

### D604. The panel look is a `look` prop on the kit's own controls; its parts live in `panel/`

- **Date:** 2026-11-24. The `design-kit` agent's (W1b; Q4, D573).
- **Question:** `shell/src/shared/controls` moves into `@dashi/ui`. Keep its names (ControlSwitch,
  PillButton, a second Segmented), or fold them into the kit's controls?
- **Choice:** folded: `Switch`, `Button`, `Segmented`, `Checkbox`, `TextField`, `SearchField` and
  `TextLink` take `look="panel"`. What only the panel look has (its palette reader, the spring,
  the fold of pills, `InkSlider`, `Knob`, `InkFill`, `LimitBar`, and the slider's glyph disc, now
  `GlyphDisc` because `Chip` is the status chip, UI-12) lives in `dashi-ui/src/panel/` and is
  exported by the kit. The slider math is one file. `PillButton`'s `tone` became Button's
  `primary` and `danger`; a module that wraps the kit under the same name imports it as
  `KitButton` or `KitSwitch`.
- **Why:** one control per job, in two looks, is what UI-1 and Q4 say; two names for one switch
  is the second kit again.
- **Cost:** 55 shell files changed their imports; tests that named the shell's files moved.
- **Undo:** none wanted.

### D605. A ring a surface's own keys put somewhere is Metal's: `focusRingShown`

- **Date:** 2026-11-24. The `design-kit` agent's (KB-2, H23).
- **Question:** Control Center and its pages walk their tiles with the arrows in two directions,
  which Metal's focus groups can't, so they drew the purple ring by hand (`FocusRing`), the one
  H23 hit in W1's files.
- **Choice:** fixed in mirin (PR #57, branch `v10-design-kit`): a view with `focusRingShown`
  draws Metal's own ring now, in its nearest `focusRingColor`, while the window is active. The
  tiles, page rows and app rows set it where their keys are; `FocusRing` is gone from the kit.
- **Why:** fix it where it starts; KB-2 says nothing draws a purple border by hand.
- **Cost:** Dashi needs mirin with the PR (`MIRIN_METAL_FOCUS_SHOWN`); an older host refuses a
  tree that sends it, which happens only while Control Center's keys are on a tile.
- **Undo:** the kit's `FocusRing` from git, and the tiles back on it.

### D606. A field's glyph sits over its start, and the field keeps its own edge

- **Date:** 2026-11-24. The `design-kit` agent's (UI-9, UI-11).
- **Question:** TextField's leading glyph and SearchField's magnifier sat in a wrapper with the
  field inside it, which loses the field's focus edge (Metal draws `focusBorderColor` on the
  field itself) or puts it round the text alone.
- **Choice:** mirin's field takes `paddingLeft` and `paddingRight` (PR #57); the field is the
  whole box, edge and focus edge included, the glyph is drawn over its start, its text and caret
  clear of it. SearchField draws its own placeholder (one line, cut with an ellipsis, "Search"
  under 140), so a long one never runs under the clear button; the field is named by it. A plain
  TextField (no glyph, no line under it) is the field alone, as before.
- **Why:** one edge that turns purple with the keyboard, as UI-9 asks.
- **Cost:** needs mirin with the PR.
- **Undo:** the wrapper back, without a focus edge.

### D607. Return in a list of pick rows presses the row, as a click does

- **Date:** 2026-11-24. The `design-kit` agent's (UI-13).
- **Question:** UI-13 says ↑ ↓ and Return. In a focus group Metal gives Return to the focused row
  as a press, so a list can't tell Return from a click.
- **Choice:** `PickList` is a focus group whose selection follows the arrows; Return presses the
  row the keyboard is on. A sheet picks on a press of the chosen row, or on its default button.
- **Why:** no second key path to keep in step with the pointer's.
- **Cost:** a list that wants "choose, then Return opens" uses the sheet's default button.
- **Undo:** a key sink on the list, once Metal lets a group hand Return on.

### D608. A reading's bar is ink; the alert's tiles lose the accent

- **Date:** 2026-11-24. The `design-kit` agent's (CO-13, R4, Q3).
- **Question:** the kit's `LimitBar` (the battery row, the battery panel, Settings' hero) filled
  with "on", `ProgressBar` with the accent, and `AlertTone` had an accent tile.
- **Choice:** `LimitBar` fills with the panel's ink, ume under 10 %; `ProgressBar` fills with ink
  on its track; `AlertTone` is neutral, danger, warning or agent (shiso), and the six places that
  asked for "accent" ask for neutral (Calendar's repeat question, dashi-dialog's info and
  question, Text Editor's sheet, the portal's account and access sheets).
- **Why:** owner rules: on means on, a reading is not on, the accent never washes a tile.
- **Cost:** the battery surfaces and those sheets look different; W3, W4, W5 and W6 own the rest
  of their readings.
- **Undo:** the fills back in `panel/parts.tsx` and `progress.tsx`.

### D609. H22 lets a component built on the kit's Sheet or Button keep its name

- **Date:** 2026-11-24. The `design-kit` agent's.
- **Question:** H22 flags a component named like a control outside the kit. A shell sheet built on
  `AlertSheet` or `FormSheet` (`RenameSheet`) is named like one and is fine.
- **Choice:** a component whose JSX renders a kit frame (`Sheet`, `SheetCard`, `AlertSheet`,
  `FormSheet`, `ConfirmSheet`, `AlertWindow`, `Button`) is not counted; the plan's escape. It
  finds 206 controls today (W2 16 · W3 47 · W4 57 · W5 29 · W6 54 · W7 3), not the plan's 271:
  the escape and W1's own move account for the difference.
- **Why:** the rule is about drawing a control by hand, not about naming a sheet.
- **Cost:** a component that renders a kit Button beside a hand-drawn control passes.
- **Undo:** empty `KIT_FRAMES` in `scripts/check-design-kit.ts`.

### D610. H24 resolves a `data-token` against the kit's exports, and binds the component measures

- **Date:** 2026-11-24. The `design-kit` agent's (D589).
- **Question:** what does a bound name mean when it is not one of the theme's sets?
- **Choice:** any path into `@dashi/ui`'s exports: `TYPE.body`, `MENU.padding`, and the kit's
  component constants (`BUTTON.window.height`, `CHECKBOX.box`, `TEXT_FIELD.height`,
  `SEARCH_FIELD.width`, `SEGMENTED_WINDOW.height`, `CHIP.height`, `PICK_ROW.height`,
  `MONTH_GRID.target`, `ERROR_STATE.glyph`, `PANEL_SWITCH.width`, `BUTTON.panel.height`). A
  name that is no export fails like a wrong number. design.html binds 135 measures; none
  disagree. No list: it fails on any row.
- **Why:** a component's measure is a named constant beside it (TK-1), so it is an export too.
- **Cost:** renaming a constant means editing the page in the same commit, which is the point.
- **Undo:** drop the component bindings from the page.

### D611. Small calls made while building the kit

- **Date:** 2026-11-24. The `design-kit` agent's.
- **Question:** small choices made while building the kit, recorded together.
- **Choice:** a status chip's tones are neutral, agent, danger, warning and success (moss words
  on the neutral wash: done is not on); the month grid's today is an ink disc with the primary's
  words, a marked day an ink dot (an indicator); `ErrorState` uses a new `PROBLEM` glyph (ume)
  and `OFFLINE` (broth); `EmptyState` gains `variant="panel"` and `NoResults`; `Loading` gains
  `inline`; `AppWindow`'s `center` is `titleSlot`, with `hideTitle` and `afterTitle`, and the
  toolbar row shows whenever there is a slot; a sidebar folds to `SIDEBAR.rail` 56 with
  `rail`, its rows named "Name — count".
- **Why:** each follows a rule already written (UI-12, UI-14, PA-6, PA-7, PA-17, VS-8, LA-5).
- **Cost:** none beyond each line.
- **Undo:** per component.

### D541. A surface opens on the screen it names or not at all; the Dock opens again as the bars do

- **Date:** 2026-11-24. `v10/screens-fix`, mirin `v10-screens-fix`.
- **Found:** replugged, the second screen's menu bar opened on the first
  (two bars there, none on the second), every time with a debug compositor.
  Plain overlays (the bars after the first, the Dock) open on the warm
  spare Metal host, started before the screen came. Its registry hears of
  the new `wl_output` when it comes and binds it, and the name arrives a
  round trip later; asked at once for `output: "Virtual-2"`, the host
  didn't know that name, opened with no screen named, and the compositor
  put it on its first screen. A slow compositor (or a screen that wakes
  slowly, NVIDIA's) widens the gap. The lock screen's hosts and the Dock
  name their screen the same way.
- **Decision:** fixed where it starts, in mirin's host (`screen.rs`): a
  layer or lock surface that names a screen the host doesn't know waits for
  it, up to 3 s, and if it never comes opens nothing and ends, saying why;
  it never opens on another screen. The shell's side was there for the bars
  (a bar whose host died opens again a second later, three times a minute)
  and the lock (a lock host that died is put back a second later); the Dock
  now does the same (`dock/lib/surface.ts`) before it reports the loss that
  ends the session.
- **Cost:** a surface for a screen that never becomes known shows 3 s late,
  or not at all; a Dock that dies four times in a minute still ends the
  session, as one that died once did before.
- **Undo:** mirin's `with_role` back to dropping an unknown name;
  `DockSurface` reporting the first death.

### D670. One clock for the lock, the login screen and Glance, in @dashi/ui

- **Date:** 2026-11-24. The `design-lock` agent's (W7), on the owner's Q1.
- **Question:** the lock drew its stacked 120 ExtraLight clock, Glance one line of 120, and the login
  screen 88 Bold. Where does the one clock live, and how does a host that cannot draw Inter Display
  get it?
- **Choice:** `@dashi/ui`'s `InksClock` (hours over minutes, `TYPE.clock`, `WEIGHT.display.extraLight`
  in the display family) and `ClockHead` (the day's row in the Inks' body size, upper case, then the
  clock, then what the host hangs under it). The lock's head, the login screen's default head, the
  greeter's other screens and its picker, and Glance all draw them; Glance is stacked too, as inks
  frame 7 draws it. The face is asked only where the host says `fontWeights` and `displayFont`: the
  shell reads its hosts' registry (`useClockDisplay`), the greeter its own hosts' protocol lines
  (`greeter/src/display.ts`); until a host says, the clock is Regular.
- **Why:** design.html says the two screens have one look, and the inks clock is the newer, approved
  drawing; one component cannot drift.
- **Cost:** on the login screen the clock takes two lines (about 224 points) where it took one; the
  layout still fits a 617-point-tall screen.
- **Undo:** give `ClockHead` a one-line variant and pass it from the greeter.

### D671. The lock follows the person's mode; its Light look

- **Date:** 2026-11-24. The `design-lock` agent's (W7), on the owner's Q2.
- **Question:** what are the lock's colours in Light, and what stays Dark?
- **Choice:** `LoginScreen` takes `mode`; the lock passes the person's (`useDark()`), the greeter
  always Dark. `LOGIN_LIGHT` (beside `LOGIN`, `loginColors(mode)`): the wallpaper lightened to 82% of
  the Inks' Light paper, Light's ink and 70% of it, the washes 10% to 25% of the ink, the light
  palette's `criticalInk` and focus ring. The widgets on it sit on `LOCK_GLASS.light` (`#FFFFFF5C`,
  a 22% ink hairline), the inks' frame 5 values; Dark keeps `LOCK_GLASS.dark`. Glance stays black in
  both modes, in Dark's inks (fewer lit pixels at rest).
- **Why:** the frames' lighter wash (15% to 53% white) leaves dark words unreadable over a dark
  wallpaper in Light Mode; at 82% the ink reads 4.5:1, the error 4:1 and the ring 3:1 over a black
  wallpaper, as Dark's 72% does over a white one (`dashi-ui/test/inks-clock.test.tsx`).
- **Cost:** a milkier lock in Light than frame 5 shows.
- **Undo:** lower `LOGIN_LIGHT.ground`'s alpha in `theme/colors.ts`.

### D672. The lock's ink shift follows its wash: lighter on Dark's, darker on Light's

- **Date:** 2026-11-24. The `design-lock` agent's (W7).
- **Question:** `INK_RULE.lockL` was `{ light: +0.05, dark: -0.04 }`, so the always-Dark lock printed its
  inks 4 points darker on a dark wash, the opposite of inks frame 4 ("5 points lighter for the dark
  wash") and frame 5 ("4 points darker for the milky wash").
- **Choice:** `{ dark: +0.05, light: -0.04 }`, keyed by the mode the lock now follows.
- **Why:** the frames are the approved design, and the lock now has both washes.
- **Cost:** none: the lock was the only reader.
- **Undo:** swap the two numbers back.

### D673. The login screen on the tokens

- **Date:** 2026-11-24. The `design-lock` agent's (W7), closing AB-5, AB-6, AB-42, AB-43.
- **Question:** the login screen's raw values: a pink error, white alphas, 16 and 14 point words, a 32
  tall field with no edge, a typed chevron.
- **Choice:** the name 15 SemiBold (`TYPE.heading`), the field 13 (`TYPE.body`) and 28 tall, a pill,
  its 1 px edge the glass hairline at rest and the focus ring while it has the keyboard (KB-2); the
  hint 12, the power labels 11, the people on the picker 13 SemiBold, the initials 28
  (`TYPE.figure`) at both picture sizes; a wrong password in the mode's `criticalInk`. "Other users"
  in sentence case after a drawn `CHEVRON_LEFT` at 12; the session a chip 22 tall, radius half of it.
  The login screen's own measures are `LOGIN_SCREEN` and `LOGIN_PARTS` beside it in `@dashi/ui`.
- **Why:** TY-1, CO-5, CO-7, KB-2, CP-4, RA-1.
- **Cost:** none.
- **Undo:** per value.

### D674. The login screen's controls live in the kit

- **Date:** 2026-11-24. The `design-lock` agent's (W7).
- **Question:** the greeter drew "Other users", the session pill and the people on its picker as
  hand-made buttons (H22's three hits); the kit's `Button` and `Chip` are the window palette's, not the
  login screen's look on the darkened wallpaper.
- **Choice:** `@dashi/ui`'s `login-parts.tsx`: `Avatar`, `LoginBackLink`, `LoginChip`, `LoginPerson`, each
  taking the look's `LoginColors`, each with a name for screen readers; the Components app shows them
  on its new "Login and lock" page.
- **Why:** a control is never drawn in a module (H22, UI-1); these have one look and one user, the login
  screen, which itself lives in the kit.
- **Cost:** three small components only the greeter uses.
- **Undo:** none needed; fold them into `Button` if it gains a login look.

### D675. The day's upper case is ClockHead's, on the shared formatter's string

- **Date:** 2026-11-24. The `design-lock` agent's (W7), closing SH-13.
- **Question:** the lock wrote its day with `toLocaleDateString(…).toUpperCase()`, beside the shared
  formatter; Metal has no `textTransform`.
- **Choice:** the lock passes `shared/time`'s `formatLongDay` and `ClockHead` upper-cases that string
  (`toLocaleUpperCase`) in one place. The greeter runs before the shell and anyone's Region settings,
  so it keeps its own `formatDay` with the same options in the machine's locale.
- **Why:** PA-14: one formatter; upper case is presentation, not a second format.
- **Cost:** a screen reader reads the day in capitals, as it did.
- **Undo:** a `textTransform` in mirin Metal, then drop the call.

### D660. The Installer is the panel look, a wizard with no footer bar

- **Date:** 2026-11-24. The `design-apps-b` agent's (W6; AB-4, AB-7, AB-8, AB-9, AB-10, VS-3, CO-2, CO-9, TK-2).
- **Question:** the Installer put Back and Continue on a 64-tall bar with a hairline, titled its
  pages 28/22 in Title Case, tinted its mark, ticks and running dot with the accent, drew its
  disks as radio cards, and mixed the window look's `Row`, `Switch` and `TextField` into Settings'
  cards.
- **Choice:** the buttons sit on the window's ground at the content's foot; every title is
  `TYPE.title` (20 Bold) in sentence case with curly apostrophes; the mark is ink, a done step a
  moss `CHECK`, the running one the kit's `Spinner`; the disks are one list (`listbox`, each disk an
  `option` in the selection look, a focus group whose arrows choose); fields and the switch are the
  kit's `look="panel"`, in rows of Settings' geometry (56 tall, 16 in, the name 13.5 SemiBold, its
  line 11.5) kept in `installer/lib/rows.tsx`, since Settings' own row lives in `settings-app`
  (W4's) and an app may not import it. Least size 600 × 480.
- **Why:** VS-3 (no footer bar, a wizard's buttons on the ground), TY-1, VO-1, CO-2, CO-9, TK-2.
- **Cost:** a second copy of Settings' row geometry, small; it should become one row in
  `shared/cards` once W4's work lands.
- **Undo:** `apps/installer/lib/{view,rows}.tsx`.

### D661. Activity Monitor's view is a pop-up of four views; the field shrinks before it folds

- **Date:** 2026-11-24. The `design-apps-b` agent's (W6; AB-2, AB-20, AB-27, AB-28, AB-37, UI-2, UI-11).
- **Question:** the view button was hand-drawn ("Apps ▼", a typed ▼ at 9, no edge or Tab stop, its
  menu 40 pt left of it) and held toggles as well as the view.
- **Choice:** the kit's `PopUpButton` with the four views a person picks between (Apps, My apps,
  All processes, My processes); Kernel Threads and Show Summary stay in the menu bar's View menu,
  where they always were. In a narrow window its glyph opens the same four as a menu hung from it.
  The search field is the kit's 210, shrinking to its least 96 before it becomes a glyph, so the
  window opens 1000 wide (was 940) to show the whole row. Waiting is `Loading`, a search that finds
  nothing `NoResults`; the title gives way through `AppWindow`'s `hideTitle` (the old `center`
  prop no longer existed, so it had silently stopped giving way). The app's disclosure chevron is
  bare (the row lights under the pointer), and the right-click menu is the kit's `PopupMenu` with
  the menu bar's keys.
- **Why:** UI-2 (a pick of one of several is a pop-up), UI-8, UI-11, VS-7, PA-5, PA-17, VS-8.
- **Cost:** the two toggles are one menu away; the window opens 60 wider.
- **Undo:** `apps/activity-monitor/lib/views/view-menus.tsx`, `toolbar-fit.ts`, `sizes.ts`.

### D662. The kit gains TextArea, InlineField and CheckMark; Checkbox can hide its words; a small TextLink

- **Date:** 2026-11-24. The `design-apps-b` agent's (W6; UI-1, UI-9, UI-10, KB-2).
- **Question:** dashi-dialog's editable text and Calendar's notes needed a field of many lines,
  Calendar's new event an in-place name, dashi-dialog's checklist a box in a row that is itself
  the control, Calendar's calendar rows a checkbox whose words the row already says, and a day's
  "3 more" a link at 11; the kit had none, and each module drew its own.
- **Choice:** `TextArea` (a text field's edge, ground and focus over many lines, 13, 12 `small`),
  `InlineField` (no box; a 1 px focus-ring edge while it has the keyboard), `CheckMark` (the box
  alone, no role or Tab stop, round for a pick-one list), `Checkbox hideLabel` (its words only for
  screen readers) and `TextLink size="small"` (11). Each has a test, a Components app entry and a
  row in design.html.
- **Why:** UI-1: a second user moves it into the kit before a second copy ships.
- **Cost:** five more names in the kit.
- **Undo:** the files in `packages/dashi-ui/src/`.

### D663. A window's own view is named for what it is, not as a control

- **Date:** 2026-11-24. The `design-apps-b` agent's (W6; H22).
- **Question:** H22 counts a component named like a control (`…Dialog`, `…Sheet`, `…Chip`,
  `…Field`) that does not render a kit frame. dashi-dialog's nine Zenity modes and the portal's
  Open With and Add to Dock were such names, and so were Calendar's event bars and its sheet's
  rows of kit controls.
- **Choice:** a name says what the thing is. dashi-dialog's modes are views of a window built on
  `AppWindow` and the kit's `Button`s (`EntryView`, `ListView`, …); Open With is `OpenWith`; Add
  to Dock moved onto the kit's `AlertWindow` (it asks a question) with the launcher's icon and its
  name field under the words; Calendar's event bars are options you pick (`EventBar`,
  `EventLine`, `AllDayBar`, role `option`) and its sheet's rows (`DayInput`, `TimeInput`,
  `ZoneInput`, `NotesRow`) only combine kit controls. A component that draws a control is moved
  onto the kit's control, never renamed.
- **Why:** H22 is about controls drawn outside the kit; these draw none.
- **Cost:** none.
- **Undo:** the names.

### D664. Every portal and dialog window states its least size

- **Date:** 2026-11-24. The `design-apps-b` agent's (W6; AB-25, LA-3).
- **Question:** the Store, the Installer, Open With, Print and dashi-dialog's windows could be
  squeezed past where their one row and buttons fit.
- **Choice:** the portal's `least` is required. Open With 360 × 240, Print 400 × 300, an alert
  (access, share your name, Add to Dock) opens at its least; dashi-dialog's least is 320 × 160, or
  the size it opened at when `--width`/`--height` make that smaller; the Installer 600 × 480; the
  Store 610 × 400, from its compact row's parts.
- **Why:** LA-3.
- **Cost:** none.
- **Undo:** each `least` / `minSize`.

### D665. Open With: the kit's pick rows, More apps, and the kind's name

- **Date:** 2026-11-24. The `design-apps-b` agent's (W6; AB-24, AB-29, AB-38, VO-8, VO-11, PA-18).
- **Question:** Open With's rows were 34 tall and its own; "Other…" showed the rest in place; the
  box said "Always use for application/pdf" and was hand-drawn with a typed ✓.
- **Choice:** the kit's `PickRow`s in a `PickList` (30, the selection look, a focus group,
  "Default" at the row's end); `MoreButton` "More apps" / "Fewer apps"; the kit's `Checkbox`
  reading "Always use for PDF documents", the MIME database's description in the plural, its
  first word lowered unless it is an initialism (`shared/files` now exports `mimeKind`, the
  existing `kindOf` of `mime.ts`). The print sheet's and the access sheet's boxes are the kit's
  too.
- **Why:** PA-18 (one pick row), VO-8, VO-11, UI-10.
- **Cost:** an app icon that fails to load shows no generic icon in Open With (`PickRow` draws an
  `Image`, not `AppIcon`).
- **Undo:** `apps/portal/lib/app-chooser/`.

### D666. The Store's cards are list items, its links ink, its failures ume

- **Date:** 2026-11-24. The `design-apps-b` agent's (W6; AB-17 to AB-21, AB-27 to AB-31, AB-37, AB-40, AB-41, AB-48, AB-49, CD-15).
- **Question:** the Store drew its own chips, disclosures, links, error and empty pages, sheet
  titles and search width.
- **Choice:** app and entry cards are `listitem`s in a `list` grid, not buttons (moving the role to a
  plain outer view would square their focus ring); screenshot thumbnails are options in a
  listbox, the chosen one with the accent edge (chosen); Get, Open and Update are the kit's small
  `Button`; chips are the kit's `Chip` (the stale one broth, like the offline state); "See all"
  and the facts' links are `TextLink` (ink); disclosures `MoreButton`; offline, Flathub, the applet
  catalogs, Flatpak missing and "couldn't check" are `ErrorState`, a partial failure a `Notice`;
  no results `NoResults`, an empty category "No apps here yet"; Sources, Catalogs, Add a catalog
  and an extension's settings are `FormSheet`s (its title "‹name› settings"); the failure sheet's
  tile is danger (ume); one `PageHeader` for an app's, a package's and an applet's page, the
  byline 12 muted; the placeholder "Search apps and add-ons" on the kit's 210 → 96.
- **Why:** UI-8 to UI-15, PA-6, PA-17, VO-8, CO-1, Q3.
- **Cost:** the activity chip's words are not cut with an ellipsis yet (the kit's `Chip` has no
  width cap).
- **Undo:** `apps/software/lib/`.

### D667. Calendar: the lit calendar, the rail, and its commands in the menu bar

- **Date:** 2026-11-24. The `design-apps-b` agent's (W6; AB-11, AB-12, AB-13, LA-5, UI-17).
- **Question:** Calendar's rows were hand-made and unfocusable, with a round tick of their own; the
  sidebar menu's commands were nowhere else.
- **Choice:** each calendar is a `SidebarItem` whose tile wears its colour, in the section's focus
  group; the lit row is where new events go; its accessory holds the kit's `Checkbox`
  (`hideLabel`, "Show ‹name›" for screen readers) and the `MORE` button; the sidebar folds to the
  kit's rail. File gains Edit Calendar…, Hide or Show Calendar and Delete Calendar…, acting on the
  lit calendar (UI-17, PA-8). The event sheet's calendar is a `PopUpButton` and its weekdays the
  kit's `Checkbox`es with the region's short names; Today is the kit's small `Button`; Find is a
  `SearchField` (`variant="find"`: Esc closes Find and keeps the query); the steppers' ‹ › are
  drawn chevrons on `ToolbarButton`s with tooltips.
- **Why:** UI-2, UI-8, UI-10, UI-11, KB-1, LA-5, IC-3, UI-17.
- **Cost:** the pop-up's options carry no colour dot; the week's shown days are no longer washed
  in the sidebar's month.
- **Undo:** `apps/calendar/lib/views/sidebar.tsx`, `menus.ts`, `sheets/`.

### D668. Calendar's grid and floating panels

- **Date:** 2026-11-24. The `design-apps-b` agent's (W6; AB-1, AB-14, AB-15, AB-27, AB-34, AB-36, CD-16).
- **Question:** the now line wore the accent, captions were 10, the floating panels were three
  cards, and the sheets were bare `Sheet`s.
- **Choice:** the now line is ink (2 px on today with its dot, 1 px muted elsewhere); every caption
  `TYPE.caption`, the week's day number 13 Bold, the popover's title 13 Bold; Find's answers hang
  as a menu (`MENU`, `menuEdge`, `SHADOW.xl`, "No results" in its one row); the popover is radius
  12, padding 14, `menuEdge`, `SHADOW.xl`; the drag ghost `SHADOW.xl`; the sidebar's month and the
  sheet's date picker are `MonthGrid` (six weeks tall, so the list under it never jumps); New and
  Edit calendar, Import and Export are `FormSheet`s, the problems sheet an `AlertSheet` (broth);
  "3 more" a small `TextLink`; days outside the month on `surface.field`.
- **Why:** CO-2, TY-1, LA-4, DE-1, UI-14, UI-15, PA-17.
- **Cost:** none beyond each line.
- **Undo:** `apps/calendar/lib/grid/`, `views/`, `sheets/`.

### D669. Small calls made in W6

- **Date:** 2026-11-24. The `design-apps-b` agent's.
- **Question:** small choices, recorded together.
- **Choice:** sentence case for buttons, headings and window titles that are not commands
  ("Start over", "Erase and install", "Don’t share", "Share your name", "More options");
  menu-bar and context-menu rows keep Title Case; line heights snap to their size's role and
  spacing by tokens.md (3 → 2, 5 → 4, 22 → 20); process timers are named where they are used;
  dashi-dialog's month is drawn in the region's first weekday and names while `--date-format`
  stays Zenity's C locale; the portal's and dashi-dialog's frames pad by `ALERT_WINDOW.padding`.
- **Why:** VO-1, TK-1, UI-14.
- **Cost:** none.
- **Undo:** per line.

### D630. The notification centre panel goes; the widget area is where notifications are kept

- **Date:** 2026-11-24. The `design-chrome` agent's (W3; NO-1 to NO-3, SH-6, SH-34, CD-29).
- **Question:** the plan asks for one notification card, the month card on `MonthGrid` and an
  ink today in "the notification centre". `NotificationCenterPanel` (`notifications/center.tsx`,
  its cards and its month card) has drawn nothing since 17 Nov: the menu bar opens
  `NotificationArea`, the widget area with paper notes (95ab3a61).
- **Choice:** delete the dead panel, its parts and its month card. The one card is
  `notifications/lib/card.tsx` (`NOTE_CARD`: radius 12, padding 12, icon 28 at radius 7, the
  kit's small Buttons): the banner draws it; the area's paper note takes its measures on a
  widget's paper and corner (CO-11) with the kit's inks Buttons. The month beside the notes is
  the Calendar widget's, which now starts its week on the region's first day.
- **Why:** fixing a surface nobody sees would leave two cards and a dead month grid to maintain.
- **Cost:** no centre to fall back to without the widget area; design.html's Notifications
  section is rewritten to say so.
- **Undo:** restore the three files from cd2f7a44^ and point `menus/lib/popover.tsx` at the panel.

### D631. The widget area's controls are the kit's, in an inks look

- **Date:** 2026-11-24. The `design-chrome` agent's (W3; CO-2, CO-11, TK-2).
- **Question:** the widget area never wears the accent, so the kit's Switch (the one on) and
  Button (window or panel look) can't be dropped in; the gallery's "May go on air" and "Edit
  widgets" were drawn by hand.
- **Choice:** `look="inks"` on the kit's `Switch` (36 × 20, ink on, hairline off, a paper knob)
  and `Button` (a 28 pill on the Inks' paper under a hairline; the one that goes ahead is ink),
  from `INK_TEXT`/`INK_PAPER` by the mode. A chosen widget, size or gallery row is an ink wash
  under a 2 px ink edge (CO-9, D588).
- **Why:** TK-2 names three looks; the kit had two.
- **Cost:** the widgets' own `Btn` (inside cards, filled with a widget's ink) is still hand-drawn;
  it is the next to move onto the inks Button.
- **Undo:** drop the `inks` branches in `switch.tsx` and `button.tsx`.

### D632. A button that is one glyph is the kit's GlyphButton

- **Date:** 2026-11-24. The `design-chrome` agent's (W3; IC-3, SH-29).
- **Question:** the overview's × and +, a notification's ✕ and the capture toolbar's tools were
  font characters or hand-drawn discs, unnamed for screen readers.
- **Choice:** `GlyphButton` in `@dashi/ui`: round, 24 (18 small), `filled` for a disc at rest,
  `quiet`, and `on` for one that turns something on (the one on, read as checked). A
  toolbar's square glyph button stays `ToolbarButton`. `ADD` joins the glyphs.
- **Why:** UI-8's one-button rule, for buttons without words.
- **Cost:** the overview's + is a 24 target in its 34 disc (the disc takes the press too).
- **Undo:** per caller.

### D633. The switcher's pick is a selection; `switcherSelection` is `openWash`

- **Date:** 2026-11-24. The `design-chrome` agent's (W3; CO-9, SH-12, SH-26).
- **Choice:** the chosen app's tile is `selectionWash`, named, an option; the soft ink wash keeps
  its other jobs (an open bar item, the "…" row, the taskbar's open button) under the name
  `openWash`, in the palette (W1's file: a rename only).
- **Undo:** the palette key and five callers.

### D634. H22 lets a status built on the kit's Chip keep its name

- **Date:** 2026-11-24. The `design-chrome` agent's (W3; UI-12, D609).
- **Question:** the agents' `AccessChip` and the bar's `CapturePill` now render the kit's
  `Chip`; H22 still counted their names.
- **Choice:** `Chip` joins `KIT_FRAMES`, as Sheet and Button did in D609.
- **Undo:** take it out of `scripts/check-design-kit.ts`.

### D635. In the two-screen folders, tokens only: their hand-drawn controls wait

- **Date:** 2026-11-24. The `design-chrome` agent's (W3).
- **Question:** the lead's brief: the menu bar, Dock, launcher and lock were just reworked for
  two screens, and a fix for their hosts is merging, so in those folders swap tokens and
  restructure nothing. H22 lists 15 hand-drawn controls in the launcher (its field and chip, the
  form's choices, the conversation's buttons and empty line).
- **Choice:** the launcher, menu bar and Dock get token swaps only (and the launcher's sizes on
  `typeAt()`); their H22 entries stay listed. The bar's own pressable items in other folders
  (work alone, the voice chip, the recording stop) wait for the same move: a kit bar item.
- **Why:** the owner's instruction for this round outranks emptying the list now.
- **Cost:** `h22/W3` ends at 28, not 0.
- **Undo:** none needed: the next round moves them.

### D636. Setup's progress dots and running mark are ink

- **Date:** 2026-11-24. The `design-chrome` agent's (W3; SH-30, CO-2, Q3).
- **Choice:** the mark is Kombu's constant (`KOMBU_SEED`), a done step moss, a running step and
  the current page's dot ink (progress is ink, Q3), titles at `TYPE.title` 20.
- **Undo:** the colours in `setup/lib/`.

### D637. Small calls made in W3's token swap

- **Date:** 2026-11-24. The `design-chrome` agent's (W3).
- **Choice:** the plan's snapping everywhere (5→4, 7→6, 9→8, 11/13→12, 18→16, 22→20, radius
  6→5, 8→7, 9→10, 14/16/18→12 outside the Inks); timers stay named constants in objects
  (`TIMERS`, `KEPT.closeMs`), not MOTION; a hit area's key catcher (`KeyCatcher`) is still a
  hidden `TextInput` (moving every overlay to `KeySink` wants a VM pass of its own); the
  capsule's buttons keep their pill-v2 look (the kit has no persona-coloured button); the
  agents' Stop is the danger Button; panels' empty lines are 12 muted (SH-31).

### D640. One list row in Settings, and how the current item shows

- **Date:** 2026-11-24. The `design-settings` agent's (W4, SE-8, SE-10, SE-A4, SE-A12, SE-A18).
- **Question:** Settings drew a card's rows seven ways and marked the current item four ways
  (bold, a tick at either end, the selection wash); pressable rows had no focus or role.
- **Choice:** every row of a thing is `ListRow` (56, 13.5 SemiBold over 11.5 muted). A list you
  pick one from (Sound's outputs, the answerers) shows its chosen row in CO-9's selection look
  (`chosen`), its rows options of one listbox; a list of things that connect says "Connected" in
  the row's line and nothing else marks it. A pressable row is a Tab stop with a role (option, or
  button), and a card of them is one focus group (`Group list`, `RowList` for rows under a
  setting). Keyboard's layout list is the kit's `PickList`. Agents' head row is a `ListRow` with
  the kit's `Chip`.
- **Why:** SE-8 and SE-10 as written; one look per job (CO-9).
- **Cost:** a long layout name is cut instead of wrapping (PickRow is one line); names that were
  Regular are SemiBold.
- **Undo:** `ListRow`'s `chosen` and `Group`'s `list` in `settings-app/lib/panes/parts.tsx` and
  `shared/cards/cards.tsx`.

### D641. A row's destructive action confirms in place, or acts and offers Undo

- **Date:** 2026-11-24. The `design-settings` agent's (W4, SE-12, PA-1, SE-A7, SE-A8).
- **Question:** deleting asked five ways in Settings, two of them in one pane, and Voice's history
  deleted with no ask at all.
- **Choice:** `ConfirmDelete` takes the row's verb (Delete, Forget, Remove, Delete all, Clear
  history) and is the only in-place confirm: Network, Bluetooth, Passwords, Payments, Tokens (its
  sheet goes; the row's line says what will be lost), Voice's models, Clipboard. One dictation
  entry acts at once and offers Undo (it stays in the file until the next delete, Delete all, or
  the pane closing, so no history API changed); Delete all confirms in place. Agents' Revoke
  keeps acting with Undo.
- **Why:** PA-1 and SE-12: what can be undone acts; what can't confirms where it is.
- **Cost:** Bluetooth can show two rows asking at once (each row keeps its own question).
- **Undo:** per pane.

### D642. Settings' own Slider and Switch are the kit's, set in the panel look

- **Date:** 2026-11-24. The `design-settings` agent's (W4, H22, Q4).
- **Question:** `settings-app/ui.tsx` wrapped the kit's slider and switch, so H22 counted two
  controls named like the kit's.
- **Choice:** `Slider` is `InkSlider` itself and `Switch` the kit's Switch with the panel look set
  in place (`inPanelLook`); the 20 callers keep their imports. "Still looking" is the kit's
  `Loading` with "Looking for ‹things›…"; an empty list says "No ‹things› yet." or "No ‹things›
  found.", then one sentence on what to do. Voice's fetch is the kit's `ProgressBar` (ink, Q3).
  `InkSlider` draws its value in one colour, on the ink once the fill reaches its start
  (`valueOnInk`, SE-A44).
- **Why:** one kit (Q4); PA-5's wait before Loading shows.
- **Cost:** none seen.
- **Undo:** restore the wrappers.

### D643. Control Center's tiles and the round knob button are the kit's

- **Date:** 2026-11-24. The `design-settings` agent's (W4, UI-1, CC-1, H22).
- **Question:** Control Center, Settings' miniature and Sound's page drew the same tiles, and the
  mute button, the page header's switch and edit mode's marks were role-drawn Views.
- **Choice:** `WideTile`, `RoundTile`, `SliderTile` (with a `lead`) and `BatteryTile` move into
  `@dashi/ui`'s `panel/tiles.tsx`; `KnobButton` is the panel look's round glyph button (a switch
  when given `checked`); the panel `Switch` takes `lit` for a lit header, at the kit's 46 × 28
  (was 42 × 24). Edit mode's footer is panel Buttons, 36 tall (was 34), and "ADD" reads "Add".
  The battery panel is radius 28 (RA-2's panel; was 26) and "Battery Settings…" is the panel
  Button (36, was 40). `MuteKnob` is `Mute` and `MicPill` `MicIndicator`; `sound/index.ts`
  re-exports the old names until the menu bar (W3) moves its import.
- **Why:** UI-1: a second user moves it into the kit; RA-1's named panel radius.
- **Cost:** the switch and footer are a few points larger.
- **Undo:** move the tiles back into `control-center/`.

### D644. Battery's charts are readings, and battery rows need a battery

- **Date:** 2026-11-24. The `design-settings` agent's (W4, CO-13, SE-17, SE-A1, SE-A3, SE-A46).
- **Choice:** the draw series is mizu, time on power matcha (`TINTS.matcha`, not `#30d158`), the
  charge line and each app's share ink on the line colour, the tip's glyph muted (a warning keeps
  `batteryLow`). The charge limit and Battery health show only while a battery is present. The
  power button is said once, in its row; the lid's caption says the lid is set for everyone. The
  hero's figure is `TYPE.figure` (28, was 30). Charts take the card's width.
- **Why:** CO-13; SE-7, each fact once; SE-17.
- **Undo:** `battery-usage.tsx`, `battery-laptop.tsx`.

### D645. One ring for a chosen picture; Settings' popovers are the app look

- **Date:** 2026-11-24. The `design-settings` agent's (W4, SE-15, SE-A19, SE-A22).
- **Choice:** `PictureChoice` (`@dashi/ui`): a 2.5 ring around the picture, at its radius plus
  the room plus the ring, in the on colour, or ink where the choices are colours (Your Dashi, the
  swatches); an option inside a listbox group (Metal has no radio role); its name under the ring.
  Appearance's themes use room 4, so their ring's outer radius is 20.5. Displays' chosen screen
  is ringed and the others no longer dim. The Custom accent popover is the app look (radius 12,
  shadow xl, the window's Buttons), its eyedropper the kit's `ToolbarButton`.
- **Why:** one look per job (CO-9); SE-15: a sheet or pop-up is the same wherever it opens.
- **Undo:** per pane.

### D646. Plain names in Settings, and no typed paths

- **Date:** 2026-11-24. The `design-settings` agent's (W4, VO-11, SE-A10, SE-A26, SE-A28, SE-A30, SE-A33).
- **Choice:** a display is its EDID name, "Built-in", or "Display" ("Display N" by connector
  order) when it has none, never its connector; a time zone is its city and offset, its id a
  search word. Wallpaper never asks for a typed path: the registry rows `wallpaper/photo-path` and
  `wallpaper/video-path` go (they were the typed path, not a setting), and when the file chooser
  doesn't answer, Wallpaper and Users show one `Failure` (`NO_CHOOSER`). About and Users open with
  their first card: About's version is a row (`about/version`), Users' account type is in its
  title ("Users · Administrator"), the avatar 40 on `knobRest` with ink initials beside "Change
  picture…". About leaves out a reading it doesn't have. No service, package or file name shows
  (AccountsService, fcitx5, NetworkManager, settings.json, the compositor); Keyboard says to
  install Fcitx 5 from the Store.
- **Why:** VO-11; SE-17: "Unknown" never shows.
- **Cost:** two addresses stop existing; they held a field, not a setting.
- **Undo:** per pane.

### D647. Pane names and headings in sentence case, one spelling

- **Date:** 2026-11-24. The `design-settings` agent's (W4, SE-16, VO-9, SE-A6, SE-A32, SE-A45).
- **Choice:** Network (it holds Ethernet and VPN; "Wi-Fi" a search word, the address
  `dashi://settings/network` kept), Battery & power, Lock screen, Date & time, Language &
  region; every pane page takes its title from `paneTitle`. Captions and buttons are sentence
  case except names (Wi-Fi, Bluetooth, Control Center, "Battery Settings…" in the panel, as the
  menu bar's style). American spelling in the UI (color, recognizer), the British spelling kept
  as a search word.
- **Why:** VO-9 and SE-16.
- **Undo:** `shared/settings/panes.ts` and the registry.

### D648. Voice's and Your Dashi's rows wear their knobs

- **Date:** 2026-11-24. The `design-settings` agent's (W4, SE-13, SE-A17).
- **Choice:** Voice: on WAVE, models and corrections DISK, talk key KEY, Dashi's voice VOLUME,
  each, add and more languages LANGUAGE, In ‹language› GLOBE, dictation MIC, listen again REFRESH,
  dictation key KEYBOARD, hands-free TAP, tidy SLIDERS, words TEXT, replacements REPEAT, history
  HISTORY, recognizer CHIP, corrected by SPARK. Your Dashi: name PERSONA, character SPARK, you
  USER, talk WAVE, language LANGUAGE, voice VOLUME, colour DROP, mark GRID, dots MOTION, note
  TEXT, own SLIDERS, share AT, about HISTORY, reset REFRESH. Dictation history is two cards (the
  keep setting with its knob, then the entries), so each card keeps one left edge (SE-6).
- **Why:** SE-13; Appearance's rows keep theirs (D585).
- **Undo:** the glyphs in `registry/lib/voice.ts` and `registry/lib/persona.ts`.

### D649. Small calls made bringing Settings and Control Center onto the tokens

- **Date:** 2026-11-24. The `design-settings` agent's (W4, TK-1, H21).
- **Choice:** every measure in W4's files is a token or a named constant beside its component
  (658 literals to 1: Caption's tuck, `-SPACE.xs`, which H21b should read as the negative step).
  Snaps: a tile's setting at 0.75 (`OPACITY.soft`, was 0.74 and 0.7); Sound's app slider takes the
  kit's spacing; the battery figure 28. Timers live in named objects (`TIMING`, `SOUND_POLL`,
  `GRAPHICS_REFRESH`, `NIGHT_LOOK`, `AUTO_LOOK`, `SPOT_TIMES`, `MONITOR.slowMs`). `PAGE.margin`
  is `PAGE.sides` (a style name in a constant reads as a literal). The vault's forms share one
  field width, 240. Clipboard's left-out apps are `ListRow`s with an `AppDisc` (the app's icon,
  or its letter on its tint), a small Remove at the end; its field asks for a program's name until
  the installed-apps list reaches Settings. Window lights' colours for GTK are
  `WINDOW_LIGHTS` in the theme.
- **Why:** TK-1; the plan's snap rule (tokens.md).
- **Undo:** per file.

### D620. A shell sheet with no window is the kit's sheet, centred on its own surface, without a scrim

- **Date:** 2026-11-24. The `design-sheets` agent's (W2; UI-5, T17).
- **Question:** the shell's sheets (power, polkit, Wi-Fi, Bluetooth, the agents', Force Quit,
  Displays' keep) are layer surfaces with no window to hang from. Copy the alert frame in the
  shell, or teach the kit's sheet to stand alone?
- **Choice:** the kit's `Sheet`, `AlertSheet` and `FormSheet` take `place="screen"`: the same card
  (radius 12, padding 20, solid, `xl`) centred on the surface, its keys the same, no scrim (there
  is no window to dim; the screen is not the asker's). `AlertSheet` also takes `keys={false}` for a
  sheet that must never take the keyboard by itself, and `icon` puts the asker's own picture (an
  app's, an applet's) in the tile's place. The menus' `Panel` and the three hand-made `Button`s
  are gone; `menus/sheets.tsx` keeps only the surface's size.
- **Why:** UI-5 says one frame, "centred on the screen only when it has none"; a second frame in
  the shell is what T17 found.
- **Cost:** two small kit commits (with tests and a Components app entry).
- **Undo:** drop the props; the shell would need its own frame again.

### D621. Change Password hangs from Settings: its own surface laid exactly over Settings' window

- **Date:** 2026-11-24. The `design-sheets` agent's (SE-A47, SE-15).
- **Question:** the sheet was see-through, centred on the screen, with no scrim. Drawing it inside
  Settings' window would let an agent's pointer (which works in a window it names) reach the
  password fields.
- **Choice:** it stays a surface of its own that holds the keyboard, but the prompt asks the
  compositor for Settings' frame and lays the surface over it exactly (anchored top left, margins
  from the screen's corner, `exclusiveZone: -1`): the kit's `FormSheet` hangs under Settings'
  title row (`hang`, the 38 strip) over the scrim, clipped to the window's radius. Without a
  compositor or a Settings window, it is centred as before. `settings-app/services.ts` and
  `boot/settings.ts` (W4's and W3's files) each gained one line to pass where Settings is.
- **Why:** SE-15 and UI-5: a sheet is the same sheet wherever it opens; the safety stays.
- **Cost:** the surface covers Settings' window, so the window can't be moved or reached while
  the sheet is open (as a sheet holds its window); a window moved by other means (an agent, a
  screen unplugged) leaves the sheet where it was.
- **Undo:** pass no `settingsPlace`.

### D622. What a shell sheet's tile shows

- **Date:** 2026-11-24. The `design-sheets` agent's (UI-5, R4).
- **Choice:** the power sheets: Dashi's mark for Log out, `RESTART`, `SHUT_DOWN`; the agents'
  sheets (consent, confirm, question, sign-in, approval): the shiso tile with the agents' spark
  (`tone="agent"`); polkit: the requesting app's icon, else `LOCK`; Force Quit's question: the
  app's icon; the person's confirm sheet: `WARNING` in ume when it destroys, else `INFO`; Wi-Fi:
  its bars; Bluetooth: its glyph; Displays' keep sheet: `INFO`.
- **Why:** R4: the tile says the job; the accent never washes one.
- **Undo:** per sheet.

### D623. Who answers a shell sheet's keys

- **Date:** 2026-11-24. The `design-sheets` agent's (UI-6, SH-5, CD-18).
- **Choice:** Force Quit's question: Force Quit is ume and Cancel the default, so Enter cancels
  (the controller's `submit` too). A grant or an agent's sheet (consent, confirm, sign-in,
  question, approval, the person's confirm, Displays' keep) has `keys={false}`: only a click or a
  field's own Enter answers it, as before. Bluetooth: Pair is never Enter's; the sheets that
  show a code to type on the device leave Enter alone and only Esc cancels. A field takes Enter
  and Esc while it has the keyboard; the sheet's keys take them otherwise.
- **Why:** a stray Enter must not end an app, pair a device or grant anything.
- **Undo:** per sheet, the button's `isDefault`.

### D624. The shell sheets' words

- **Date:** 2026-11-24. The `design-sheets` agent's (T34 for W2: SH-15, SH-36; VO-10, VO-1).
- **Choice:** answers in sentence case with the curly apostrophe: "Don’t allow", "Always allow",
  "Allow once", "Allow for this task", "Don’t answer", "Log out", "Shut down", "Go back",
  "Change password", "Forget this device", "Search again", and "My devices", "Nearby devices",
  "Not connected" in Control Center's Bluetooth and Wi-Fi pages. Questions say what will happen:
  the first consent sheet's heading, set in `agents/lib/session/session-scopes.ts` (a W3 file, one
  line), is "Allow an agent on another machine to use this computer?";
  "Log out now?", "Restart now?", "Shut down now?"; an agent's: "Allow Claude to use Dashi?",
  "Allow Claude to force “Notes” to quit?"; "Join “Home”?"; "Force “Notes” to quit?" with "Its
  unsaved changes will be lost."; the Force Quit list "Force quit an app". Names keep their
  capitals ("Force Quit" the command). The stop note is a `Notice`: "Stopped Claude. It can
  connect again later."
- **Why:** VO-1, VO-10, and UI-5's question as the first line.
- **Undo:** strings only.

### D625. `menus/sheets.tsx` is W2's

- **Date:** 2026-11-24. The `design-sheets` agent's.
- **Question:** the plan gives W2 "menus/lib/sheets.tsx", which does not exist; the file is
  `menus/sheets.tsx`, which the owners map then filed under W3, with one entry on each of W3's
  H21 and H22 lists.
- **Choice:** the owners map names `menus/sheets` for W2; with the file down to a size constant,
  its two entries leave W3's lists (one line each).
- **Cost:** W3's branch may meet those two removed lines when it merges.
- **Undo:** none wanted.

### D626. Polkit's people are a segmented control; its details a MoreButton

- **Date:** 2026-11-24. The `design-sheets` agent's (R3, VO-8).
- **Choice:** who to authenticate as, when polkitd offers more than one, is the kit's
  `Segmented` (one of a few), not pills in the accent; "Details" is `MoreButton` ("Details" /
  "Hide details"), its rows captions over secondary words.
- **Why:** R3 (pick one is one control) and VO-8; the accent means chosen, and the segment's own
  look says that.
- **Undo:** per control.

### D627. The sign-in sheet's logins are pick rows

- **Date:** 2026-11-24. The `design-sheets` agent's (UI-13).
- **Choice:** each login is the kit's `PickRow` (the account, "site · where it is saved" as its
  detail) in a `PickList`; the hand-drawn radio and the row of dots are gone (the message says
  the agent sees dots).
- **Why:** UI-13: one row to pick one from; the radio was a pick-one drawn by hand.
- **Undo:** the old rows in git.

### D628. The applet consent sheet is the alert frame with the applet's icon

- **Date:** 2026-11-24. The `design-sheets` agent's (UI-5, VO-8).
- **Choice:** `AlertSheet` with `icon` (the applet's icon, or its letter on its tint in
  `ON_TINT`), in Software's window and centred on the shell's surface (`place="screen"`); "Already
  allowed (n)" is a `MoreButton`.
- **Why:** UI-5's one frame; the hand-made disclosure and the `#ffffffee` letter were H21 and H22
  offenders.
- **Undo:** per part.

### D629. Small calls made while moving the sheets

- **Date:** 2026-11-24. The `design-sheets` agent's.
- **Choice:** About's name is a page's title (TY-1, 20 Bold) on the sheet card; the shortcut
  sheet's column heads are captions (11, 600, sentence case) under a 13 Bold title; Bluetooth's
  code is the named figure (28) with the digits the device has taken in ink and the rest muted
  (not the accent: it is progress, not a choice); the agents' "Your turn" banner is radius 12 on
  `lg`; the time zone and language pickers use the kit's `SearchField` (`width="fill"`, a kit
  addition; the window look, since the panel look's ground is Settings' card's and the field
  vanished on it, seen in the VM) and `PickRow`; Control Center's Bluetooth "…" is a `ToolbarButton` and its Forget
  question in place has an ume Forget; Force Quit's list rows are 30 (the pick row's height).
- **Why:** each follows a rule already written (TY-1, CO-1, RA-2, DE-1, UI-11, UI-13, UI-6).
- **Undo:** per line.

### D638. The kit's tinted looks, its bar item, and what H22 counts as built on the kit

- **Date:** 2026-11-24. The `design-chrome` agent's (W3, round 2; UI-8, UI-9, UI-18, IC-3).
- **Question:** the capsule's buttons wear the persona's colours and a widget's the card's (on air,
  on glass); the menu bar's own pills (work alone, the voice, a recording) and the launcher's field
  had no kit control to be.
- **Choice:** `Button` takes two tinted looks drawn in colours their surface gives (`inks`, a
  `ButtonInks`): `look="inks"` (26 small, a card's paper, hairline and fill) and `look="capsule"`
  (pill-v2's 24 and 22, outlined in the persona's words, the yes filled, keys after the words);
  `GlyphButton` an inks look (30, 60 wide), a `large` 28 and a `tone` (ink or the agents' shiso);
  `BarItem` (UI-18), `BareField` (the launcher's), `QUESTION` and `SQUARE` glyphs, a Chip with an
  app's `picture`, a PopUpButton that `opensInPlace`, TextField's `focusNextOnSubmit`, TextArea's
  `onSubmit`, keys after a window Button's words. H22's escape (D609) takes a component that renders
  the kit's `Chip`, `BarItem`, `Checkbox` or `PopUpButton` as that control in place.
- **Why:** UI-8 already said the capsule's and the panel's buttons are Button's looks; each module's
  hand-drawn copy is gone (h22/W3 47 → 0).
- **Cost:** the capsule card's choices are pill buttons, centred, 24 tall (they were 27 rows at radius
  8, left-aligned); the conversation's Stop and Send are 28 GlyphButtons; the launcher form's fields
  are the kit's 13, not the launcher's text-size scale; a wider H22 escape lets a component that
  renders one of those beside a hand-drawn control pass.
- **Undo:** per component; the frames in `scripts/check-design-kit.ts`.

### D639. Round 2's smaller calls: one key sink, the bar's dropdowns named, the conversation's greeting

- **Date:** 2026-11-24. The `design-chrome` agent's (W3, round 2).
- **Choice:** the overlays' `KeyCatcher` (23 callers) and the screenshot area's catcher are the kit's
  `KeySink` (Metal's window keys) instead of a hidden text input; the bar's dropdowns are
  `BarDropdown`, `StatusDropdown` and `TitleDropdown` (built from the kit's `MenuRow`, they are the bar's
  surfaces, not the kit's PopupMenu); the launcher's row is `FieldRow` and the conversation's first
  screen `Greeting` (the approved design, not an empty state); the widgets' `Btn` draws the kit's inks
  Button or GlyphButton in its card's colours; the overview's shelf gap snaps 18 → 16, the switcher's
  and the row's gaps are SPACE tokens, Setup's 56 inset and the eyedropper's 48 line are named beside
  their component.
- **Why:** each follows a rule already written (UI-8, UI-9, KB-1, H21b).
- **Cost:** a surface that had keys only through a focused text input now relies on Metal's window
  keys (checked in the VM: the area, the agents' panel, the capture toolbar, the eyedropper, the
  screenshot area).
- **Undo:** per file.

### D650. Three kit pieces for the apps: words edited in place, title tabs, keypad keys

- **Date:** 2026-11-24. The `design-apps-a` agent's (W5; H22, UI-1).
- **Question:** H22 leaves no bare `TextInput` and no role-drawn control outside `@dashi/ui`. Text
  Editor's page, a note's body and title, Calculator's line and a rename in place are `TextInput`s
  with no box; Terminal's tabs and Calculator's keys are buttons drawn by hand. The kit had nothing
  for any of them.
- **Choice:** the kit gains `EditableText` (`plain`: no ground, no edge; `inline`: the rename look,
  the card inside the ring's edge at radius 4), `TitleTab` and `TitleTabMore` (VS-4's tabs, role
  `tab`, the attention dot an indicator) and `KeypadKey` (digit, quiet and strong tones; = is the
  primary's ink; every label 400, TY-2; a card's radius 10, since a key is a tile of its keypad,
  not 12, a window's). Each has a test and a page in the Components app ("Tabs, keys and text").
- **Why:** a control has one home (UI-1); the apps keep their layout and lose their copies.
- **Cost:** three components with one user each today.
- **Undo:** move them back into Terminal, Calculator and the editors, and list them on H22.
- **After the 0.10 merge:** W6's `TextArea` (a boxed many-line field) and `InlineField` (one line
  in place, no `selection`) don't cover a document's page (line numbers, highlights, a tab that
  types, a kept caret), so the editors keep `EditableText`; its `inline` look and `InlineField` do
  overlap for a rename, and can fold into one once `InlineField` takes a `selection`.

### D651. One Get Info and one Open With, in the file browser, for Files, Preview and the chooser

- **Date:** 2026-11-24. The `design-apps-a` agent's (W5; PA-18, PA-14, UI-13, UI-15).
- **Question:** Files and Preview each drew their own Info and Open With, with different widths,
  rows, headings and ways of writing the same file.
- **Choice:** `src/shared/file-browser/file-sheets.tsx`: Info is a `FormSheet` with the name as
  its heading and a Group of wrapping rows, Done; Open With is "Open “name” with", pick rows with
  the default chosen first and tagged "Default", Cancel and Open. A press on another row chooses
  it; a press or Return on the chosen row, or Open, opens with it (D607). Files and Preview write
  sizes, dates and places with `format.ts` ("58 KB", "Yesterday at 11:32 PM", `~/Pictures`). The
  kit's `PickRow` takes a `picture` (an app's icon with its fallback). Preview loads the two small
  files at start (entry-weight updated).
- **Why:** one sheet per job (UI-1); the same file reads the same everywhere (PA-14).
- **Cost:** Preview's sizes lose their decimal under 100 KB; one click on Open With chooses rather
  than opens.
- **Undo:** the two apps' own sheets from git.

### D652. Files' omnibox is a SearchField with crumbs, and the chooser's row too

- **Date:** 2026-11-24. The `design-apps-a` agent's (W5; UI-11, VS-8, R7, AA-3, AA-36).
- **Question:** the omnibox was a hand-made field (radius 8, its own clear button); the chooser
  had a folder pop-up and a second search field instead, so the same place was reached two ways.
- **Choice:** the kit's `SearchField` takes `fill`, `glyph`, `accessory`, `onClear` and `rest`
  (something else in its box at rest: the crumbs, one Tab stop that a press turns into text). The
  omnibox moves to `src/shared/file-browser/` (`omnibox-view.tsx`, `lib/omnibox/`) and is the
  chooser's title slot too, in its window and its sheet; the pop-up and the second field go. The
  chooser starts with the listing on the keyboard (a save's name field still takes it), and a
  typed path that leads nowhere is said over the listing in ume (PA-6). Its suggestions are
  `MENU`'s rows, `menuEdge`, shadow xl (LA-4).
- **Why:** one browser, one field, one look (R7, UI-11).
- **Cost:** opening a chooser no longer puts the caret in a search field: a press, or typing a
  name ahead, does.
- **Undo:** the chooser's `ChooserTools` from git; the omnibox back under `apps/files`.

### D653. The chooser's sheet hangs on the kit's Sheet, with a window's toolbar and one sidebar width

- **Date:** 2026-11-24. The `design-apps-a` agent's (W5; AB-22).
- **Question:** the chooser sheet drew its own scrim (15 % in Dark too), a 44 header with a
  SemiBold title, and a 170 sidebar where the window form had 180.
- **Choice:** the kit's `Sheet` gains `height`, `bare` (the window's ground, no padding) and
  `label` (its name for screen readers); the chooser sheet is one, its toolbar row 38 as a
  window's, and both forms keep `CHOOSER_SHEET.sidebar` 180.
- **Why:** one scrim and one sheet frame (Sheet, CO-5); a chooser is a window in a sheet.
- **Cost:** none seen.
- **Undo:** the chooser's own frame from git.

### D654. Every window states its least size

- **Date:** 2026-11-24. The `design-apps-a` agent's (W5; LA-3, AA-11, AB-25).
- **Question:** the kit's `minSize` was optional, and Files, Terminal, the Store, the Installer,
  dashi-dialog and the gallery stated none.
- **Choice:** `minSize` is required in `apps/kit/run.tsx`. Files 420 × 300 (its compact toolbar,
  the rail), Terminal 360 × 200. So that the branch builds, W6's apps get first values: the Store
  520 × 360 (Activity Monitor's), the Installer and dashi-dialog their own size (fixed flows); the
  gallery 640 × 420. W6 measures the Store's and the portal's.
- **Why:** LA-3 asks every window for one; a type that can be left out gets left out.
- **Cost:** one line in three W6 files, which W6 may change.
- **Undo:** `minSize?` again.

### D655. The listing's states and one drop look

- **Date:** 2026-11-24. The `design-apps-a` agent's (W5; PA-5 to PA-7, PA-17, CO-9, AA-23, AA-28).
- **Question:** the browser drew a folder it couldn't show as an empty state, "Searching…" as a
  title, its own "No results", and four drop looks.
- **Choice:** a folder that can't be shown is `ErrorState` ("This folder can’t be shown.", Go to
  Home); searching is `Loading` after 200 ms; nothing found is `NoResults`; an empty folder has
  its glyph and "Drop files here, or press ⇧❖N for a new folder." where it can take them.
  `dropLook()` (drop.ts) is the one drop look: `selectionWash` under a 2 px `selection` edge at
  the target's radius, for the listing, a tile, a sidebar place and a crumb. Small calls: a job's
  Cancel and a drive's Eject are the kit's `GlyphButton` (W3's, quiet; Eject in `SidebarItem`'s accessory); the
  alias arrow is a mark (`LinkMark`), not a badge; an unknown file's extension label is part of
  its icon's drawing, scaled with it, not a size on TY-1; Files' menu-bar keys and its context
  menus read one table (`apps/files/lib/shortcuts.ts`), and Show in Folder is in the File menu.
- **Why:** each state has one look (PA-5 to PA-7); one drop look (CO-9).
- **Cost:** a cut item is drawn at 50 % (was 45 %), a hidden one at 60 % (was 65 %).
- **Undo:** per state, from git.

### D656. Terminal: ink for the cursor and the bell, a notice for a lost shell

- **Date:** 2026-11-24. The `design-apps-a` agent's (W5; R5, CO-9, VS-3, PA-6, AA-1, AA-22).
- **Question:** the cursor and the bell were kombu, the selection the accent at 25/40 %, the Light
  ground `#FBFAF7` under a `#F5F5F7` toolbar, the lost shell a hand-drawn card, a missing engine an
  empty state naming a package.
- **Choice:** `TERMINAL`'s cursor is its ink and the Light ground `surface.window`; the grid draws
  the cursor and the bell's edge in its own ink (the program's if it set one) and the selection in
  `textSelection`. A lost shell is the window's Notice, "The shell stopped." with Restart (Return
  still restarts); no dashi-term is an `ErrorState` that names Terminal, not a package. The
  margin's marks are hit areas with no radius; the size pill is 24 tall, `pill(24)`.
- **Why:** the accent means chosen or on (CO-10); one caret look (CO-9); one notice look (VS-3).
- **Cost:** a person who liked the green cursor loses it (a program can still set its own).
- **Undo:** the kombu cursor back in `theme/sets.ts`.

### D657. Calculator's tape: a head in the controls' row, rows the selection look, its commands in Edit

- **Date:** 2026-11-24. The `design-apps-a` agent's (W5; VS-9, PA-8, UI-16, UI-17).
- **Question:** the tape had a worded Clear in a row of its own, rows drawn as buttons, and its
  commands only in its context menu.
- **Choice:** the head is "Tape" 13 Bold and Clear Tape, a glyph `ToolbarButton`, in the 38
  controls' row; rows are options of a listbox in the selection look (a press still uses the
  result); Edit gains Use Result, Edit Sum and Copy Sum, for the entry last pressed or
  right-clicked, disabled until there is one (Clear Tape forgets it). The tape menu's Copy Result
  shows no key: Edit's ⇧❖C copies the line's, not the entry's. The empty tape is the panel
  `EmptyState`.
- **Why:** VS-9 and PA-8; a key shown must be the key that does it.
- **Cost:** none seen.
- **Undo:** from git.

### D658. Notes and Text Editor: glyph toolbars, the kit's rows and sheets, ❖⌫ in a field

- **Date:** 2026-11-24. The `design-apps-a` agent's (W5; UI-16, UI-15, AA-25, AA-35).
- **Question:** small calls while moving Notes and Text Editor onto the kit.
- **Choice:** Recently Deleted's toolbar is glyphs at every width, Delete all with a glyph of its
  own (a can with a second edge); Notes' New folder row is a `SidebarItem` that is never chosen;
  Delete Note is ❖⌫, which while a field has the keyboard deletes to the line's start there
  instead (KB-6); Text Editor's counts readout is `Counts`, a reading on an opaque ground, not a
  chip; Go to line and Find and replace are `FormSheet`s with `keys={false}` (their fields take
  Return and Esc); confirms read "Delete “X”?" / "… You can’t undo this." / Delete; Notes' keys
  come from one table (`NOTE_KEYS`) for the menu bar and its context menus.
- **Why:** UI-16 (two buttons never share a glyph), UI-15, UI-17, PA-1.
- **Cost:** Recently Deleted no longer spells its buttons out in a wide window.
- **Undo:** per item, from git.

### D659. Preview: Move to Trash at once, failures as notices, the chooser as a sheet

- **Date:** 2026-11-24. The `design-apps-a` agent's (W5; PA-1, PA-2, VS-3, VS-8, R7, AA-8, AA-9, AA-32).
- **Question:** Preview asked before moving to the Trash (on ⌫), told failures in one-button
  sheets, drew its own title row, and opened the portal's chooser window for Open and Export.
- **Choice:** ❖⌫ moves to the Trash at once and says so in a Notice with Undo (it puts the file
  back and opens it); a bare ⌫ does nothing. One notice at a time: an error stays until
  dismissed, a note fades after 5 s, Undo stays until used or replaced. The name and size are
  `WindowTitle`'s, the place "3 of 12" for pictures and pages alike. Open… and Export use Files'
  chooser as a sheet, loaded on first use so Preview's start stays small. The error view reads
  "“name” can’t be shown." with Open with… and Open another…; a recent row's folder is shortened
  ("…/last") since a pick row has no column for its detail.
- **Why:** moving to the Trash can be undone, so it never asks (PA-1); sheets are for questions.
- **Cost:** a stray ⌫ no longer offers to trash; the chooser is Files' even on a desktop that has
  another portal.
- **Undo:** per item, from git.

### D680. What H21b reads as a literal measure, and how its last offenders became tokens

- **Date:** 2026-11-24. The `design-finish` agent's (W8; H21b, TK-1, TY-3).
- **Question:** H21b ("every measure in a style is a token or a named constant beside its
  component in `@dashi/ui`") came last, after W2–W7's token swaps. What exactly is a literal, and
  should the 140 left be listed or fixed?
- **Choice:** `scripts/check-design-measures.ts` counts a literal font size, line height,
  spacing, radius, opacity, weight or shadow, written in a style or reached through a name bound
  to a bare literal (the scanner H21a shares, `scripts/design-scan.ts`). A named constant is a
  SCREAMING_CASE `const` at a file's top level holding a value or a table of them (not a
  function); it is fine in the kit and still a literal elsewhere. No measure: 0, `"auto"`, a
  percentage, spacing ±1 (a hairline's offset), a negated token or constant (`-SPACE.xs`),
  arithmetic on a name (`KNOB / 2`). Timers (setTimeout's delay, `…Ms`, `…Duration`) are their
  module's named constants and not style measures: H21b leaves them alone. Weight and shadow
  count too, as TK-1 names `WEIGHT` and `SHADOW` (Metal's words were H21a's only). All 140 were
  fixed, so every `h21b/Wn` list starts empty: the kit's and the Components app's were the
  token they already equalled; Setup's and the Installer's 56 became the kit's `WIZARD_PAGE.inset`
  (UI-1: a second user); the Dock's table is `SPACE` and `RADIUS.dock`; Activity Monitor's graph
  head is its 15 row plus `SPACE.xs`; the consent card's 80 is `CONSENT.below`, beside its
  surface's size. Three moved a little to land on the scale: the shortcuts sheet's columns 22 → 24,
  the Store page's icon gap 18 → 16, Calendar's cell padding 3 → 2; and Bluetooth's Forget question
  now starts under the row's name, as its comment said (40 → 52).
- **Why:** a rule with an empty list protects every file at once; a list of 140 would have been
  a hole. Timers are not drawn, so a token set for them would be a list of every delay.
- **Cost:** a module's table of its own sizes (`FORM.padX`, `PAGE_ROW.knob`) is not followed into
  where it is used: 81 such uses outside the kit (most are a circle's `size / 2`), so a spacing
  written in a table under a key that is not a style's name still slips past.
- **Undo:** drop the step from `scripts/check.ts`; the moved measures, per file, from git.

### D681. A panel field on a Settings card sinks to the window's colour; the region pickers are the panel look again

- **Date:** 2026-11-24. The `design-finish` agent's (W8; UI-11, SE-8, CO-8, TK-2).
- **Question:** the panel look's `SearchField` sat on the off colour, which is also a Settings
  card's: on a card it vanished, in Light and Dark. W2 put the time zone and language pickers on
  the window look to get round it (D629), and Keyboard's layout search was still invisible.
- **Choice:** a card says it is one: the kit's `OnPanelCard` context, provided by Settings'
  `Group` (shared/cards, the Installer's too), and a panel field on it takes the window's colour
  (`panelFieldGround`), the "field" Settings already sinks its lists into (SE-8's compact list).
  Off a card (Settings' sidebar search, design.html's "a pill … the off color") it keeps the off
  colour. The pickers take a `look`: Settings passes the panel look, Setup keeps the window's.
  In the VM the pickers' field then showed alone, the list under it gone: a `width="fill"`
  field was `flex: 1`, which widens it in a row but, in the pickers' column, grew its height
  and pushed the rest off the card. A fill field now holds its height (`minHeight` and
  `maxHeight`, `boxOf`), so `flex` only ever widens it.
- **Why:** a card knows what it is; every field on one gets it right without a prop at each
  use. The window's colour differs from the card's in both modes (Light lilac `#F7F4FA` on
  `#E4DDEE`, Dark black on the second lift), and the search and the list under it now match.
- **Cost:** in Light the sunk field is lighter than its card, not darker (CO-8 speaks of the app
  look); it is the same as the lists Settings sinks already.
- **Undo:** drop the provider in `shared/cards/cards.tsx`; pass `look="window"` to the pickers.

### D682. The widget gallery stays on a narrow screen: its list gives way, then its place

- **Date:** 2026-11-24. The `design-finish` agent's (W8; LA-3, VS-7).
- **Question:** the gallery was 700 wide, 394 from the screen's right edge: it needs 1094
  points, so a 1024-wide screen (1280 × 800 at 1.25, a VM at 1792 × 1344 at 1.75) cut it at its
  left edge. Shrink it, move it, or lay it over the column?
- **Choice:** `galleryPlace` (notifications/lib/place.ts) keeps it beside the column and narrows
  it to the room there (`galleryFit`): the list gives way first, from 240 to at least 180, and the
  previews never, so a whole Wide preview (356 and its ring) always fits. A screen too narrow even
  for that (under 1015) moves it left over the column, 12 from the screen's left edge.
- **Why:** the previews are what the gallery is for, and the list's names already end in an
  ellipsis; covering the column only when there is no other way keeps what was added in sight.
- **Cost:** on a very narrow screen the gallery covers part of the column (its Add · Done bar is
  at the column's foot, under it; Esc still closes the gallery).
- **Undo:** `galleryPlace` returns the old place (`right: 394`, 700 wide).

### D683. The Timer at Compact says "Start one" in its head

- **Date:** 2026-11-24. The `design-finish` agent's (W8).
- **Question:** a Compact Timer with none running stacked its head (14), "Start one" (17) and two
  26-tall buttons in 56 points of room, so the line slid under the buttons.
- **Choice:** at Compact "Start one" is the head's right side (where a running timer says when
  it ends), and the row under it is the buttons'. Small and up keep their own line.
- **Why:** one row of cells has room for a head and one row of controls, not three rows.
- **Undo:** from git (`widgets/lib/views/timer.tsx`).

### D690. OpenCode answers through a private server of its own, never the person's background service

- **Date:** 2026-11-24. `v10/opencode-standalone`.
- **Question:** with OpenCode 2 as Dashi's assistant, every question ended "It stopped before it
  answered." The shell's log said `assistant harness: Location not found: /run/user/1000/dashi-assistant`.
  OpenCode 2 hands `opencode run` to its shared background service (`opencode serve --service`), which
  runs outside the agent sandbox and cannot see the turn's folder, which only exists inside it; nor does
  that service read the turn's `OPENCODE_CONFIG_CONTENT` (Dashi's agent, tools off, its MCP server).
- **Decision:** the harness runs `opencode run --standalone` (a private server inside the sandbox) and
  `--archived`, so Dashi's turns stay out of the person's own session list. Reproduced with a folder that
  exists only inside a bwrap sandbox: without the flag, "Location not found"; with it, the answer.
- **Cost:** a private server starts for each turn (well under a second on the laptop); an OpenCode
  older than 2 has no `--standalone` and refuses the turn (the installer gives 2.x).
- **Undo:** drop the two flags in `agents/ask/harness/catalog.ts`.

### D696. An agent's picture says when the grey block is a sheet waiting for the person

- **Date:** 2026-11-24. `v10/fix-installed` (the installed pass's P1: "an agent's question shows as
  a blank dark rectangle").
- **Question:** the installed pass saw an agent's question, and the consent before it, as a large
  dark grey rectangle, "unreadable and unanswerable", until it timed out. On the person's own
  screenshot (⇧❖3) both sheets draw whole, in Light and Dark. The rectangle was the `agent` capture
  mask (`agents/mask.ts`): every sheet on the `dashi.agent-consent` layer is blanked in agents'
  pictures, its whole surface, and an agent's click never answers one. The pass was driven through
  `vm/agent`, so it only ever saw the blank. Unmask the question, or say what the block is?
- **Choice:** keep the blank (a sheet is the person's to read and answer, and the question's field
  holds their words), and say so: while a sheet waits, a whole-screen screenshot's words add "The
  grey block is a Dashi sheet waiting for the person (a permission or a question), blanked in agents'
  pictures: it is theirs to read and answer, and agents can't press it." (`pictureNote`,
  `agents/lib/run/run-screen.ts`; `AgentUi.sheetUp`).
- **Why:** an agent (or a reviewer reading its pictures) that is told why it can't see a sheet
  waits for the person instead of reporting a broken one or clicking at it.
- **Cost:** the block still covers the sheet's shadow margin as well as its card.
- **Undo:** drop the sentence in `pictureNote`.

### D697. Glass that holds text is opaque until the compositor blurs

- **Date:** 2026-11-24. `v10/fix-installed` (the installed pass's P1, DE-4).
- **Question:** the launcher's glass was `#f5f5f7f5` / `#0b0b0df5` (96%) and menus' 97%. With no
  blur behind it, the window under the launcher read through its field and rows ("Accent color ·
  Kombu", a Save button), in both modes. Raise the alpha, or make it solid?
- **Choice:** solid: `launcher` and `menu` carry no alpha in either palette (the conversation's glass
  was already solid, D261). DE-4 now says "opaque"; `dashi-ui/test/contrast.test.ts` holds it.
- **Why:** any alpha short of 1 shows ink through at some contrast; until a blur pass exists there is
  nothing translucency buys over a window but noise.
- **Cost:** the launcher, the switcher, banners and menus no longer hint at the wallpaper under them.
- **Undo:** put the alpha back on the two tokens (and DE-4's wording) when the compositor blurs.

### D698. A window moved off a screen that went grows back to its size where it is

- **Date:** 2026-11-24. `v10/fix-installed` (the installed pass's P2, D537's unchecked case).
- **Question:** Notes, 980 × 640, moved off a screen that went onto one with the Dock up, shrank to
  980 × 581. When the Dock hid (room for 658) it stayed 581: displaced toward its own screen, it was
  only ever put back there, and that screen stayed away. Wait for its screen, or regrow it here?
- **Choice:** regrow it here: while its own screen is away, a displaced window (not a tile, not full
  screen) follows the screen it is on at its own size, as far as there is room
  (`arrange/lib/screens-gone.ts` `follow`). It is still displaced, so when its screen comes back it
  goes home at its own frame.
- **Why:** D537's promise is "whenever its screen has room again it gets its own frame back"; a
  window that can't go home should at least not stay smaller than it needs to.
- **Undo:** drop `size` in `follow`.

### D699. A window on a Desktop that isn't showing can be arranged; tile_window says when it can't

- **Date:** 2026-11-24. `v10/fix-installed` (the installed pass's P3).
- **Question:** `tile_window` on a window whose Desktop wasn't showing said "w25 (Notes) is arranged."
  and changed nothing: the arranger only arranged a window with a `frame`, and one waiting on another
  Desktop has `away` instead. Refuse, or arrange it there?
- **Choice:** arrange it where it waits (`frameOf` reads `away`; the compositor takes a frame there,
  compositor-ipc.md `frame`), so an agent working on another Desktop can tile its windows. A
  minimized, hidden or full-screen window can't take a tile, and `tile_window` now says so as an
  error instead of "is arranged" (`agents/lib/run/run-windows.ts`).
- **Undo:** from git (`arrange/arrange.ts` `frameOf`, `run-windows.ts`).

### D700. A window-look button never shrinks below its words

- **Date:** 2026-11-24. `v10/fix-installed` (the installed pass: Calendar's Today read "To…" in a
  half tile on a 1024-pt screen).
- **Choice:** `@dashi/ui`'s window-look `Button` keeps `flexShrink: 0` unless it fills its row, as the
  panel look already did: a short toolbar gives way at its title, never inside a button's label
  (`dashi-ui/src/button.tsx`; `kit-controls.test.tsx`).
- **Cost:** a row of buttons wider than its room now overflows instead of cutting labels; rows that can
  be that narrow wrap (the alert's) or have a title that gives way (a toolbar's).
- **Undo:** drop `flexShrink: 0`.

### D701. The chooser's Cancel and Open sit on a strip of their own

- **Date:** 2026-11-24. `v10/fix-installed` (the installed pass, P3).
- **Question:** the listing was cut at its edge, as a scroll view is, but its last row's icons showed
  and their names fell under Cancel and Open, with no edge between them: the names looked hidden by
  the buttons.
- **Choice:** the footer is a strip under a hairline (`separator`), padded like the listing, in both
  forms (`ChooserSheet`, `ChooserView`): the listing ends at a visible edge.
- **Undo:** from git (`shared/file-browser/chooser-view.tsx` `FooterStrip`).

### D702. Small fixes from the installed pass, each with a test

- **Date:** 2026-11-24. `v10/fix-installed`.
- Get Info's Where names the folder in words (`formatPlace`: "Home", "Home › Documents", "Computer"),
  in Files and Preview: a bare `~` read as a dash.
- The This Computer widget without a battery wraps "No battery: it runs on the wall." onto two lines,
  and says "No battery" at Compact.
- Components' "Pick rows, months and forms" is "Picks, months and forms": every page name keeps to
  the longest that showed whole in the 200-wide sidebar (25 characters).
- A slider's stops are named "15%" (a level from 0 to 1) or at the step's places, never
  "0.15000000000000002" (`notchLabel`, `slider-math.ts`; Control Center's ink slider too).

### D691. One place says how Dashi runs OpenCode, by the version the program says it is

- **Date:** 2026-11-24. `v10/opencode-v2`.
- **Question:** D690 put `--standalone --archived` in plan mode's command line only. The launcher's
  assistant and hand-offs build their own (`handoff/lib/commands.ts`, which the assistant takes), so the
  installed 0.10 still ended every OpenCode 2 question with "Location not found". And OpenCode 1 (1.19,
  which `opencode.ai/install` still gives) has neither flag.
- **Decision:** `agents/ask/harness/opencode.ts` builds the one `opencode run` (Dashi's agent in
  `OPENCODE_CONFIG_CONTENT`, every tool off but `dashi_*`) for plan mode (`dashi-plan`), hand-offs and the
  assistant (`dashi-task`). Before a turn the found program is asked `--version` (`version.ts`): once per
  file, kept by its path, modified time, size and inode (OpenCode's installer gives every release the same
  modified time), never at the shell's start, 3 s at most. 2.x gets `--standalone --archived`; 1.x runs
  as before. A version that can't be told (no answer in time, words without a number) is taken as 2, the
  current release and the one Dashi's install line gives (D692), and asked again next turn.
- **Cost:** one `opencode --version` (about 50 ms) the first time a turn runs after an install or update.
  An OpenCode 2 that doesn't answer `--version` in 3 s runs as 2, which is right; a 1.x that doesn't
  would get flags it doesn't know.
- **Undo:** from git (`agents/ask/harness/opencode.ts`, `version.ts`); `opencodeFlags` is the switch.

### D692. Dashi's install line for OpenCode is opencode.ai's own, for the current release

- **Date:** 2026-11-24. `v10/opencode-v2`.
- **Question:** Settings › Agents said "Install it with `curl -fsSL https://opencode.ai/install | bash`".
  That installer now gives OpenCode 1 only (it refuses a 2.x version and names `/v2/install`), so someone
  following Dashi's line got the old release.
- **Decision:** `curl -fsSL https://opencode.ai/v2/install | bash`. On 24 Nov 2026 opencode.ai's home
  page and its docs both give exactly this line, and it installs 2.x (2.4.1 then) into
  `~/.opencode/bin`, where Dashi already looks. OpenCode 1 still works when it is what is installed (D691).
- **Cost:** when opencode.ai moves its installer again, the line goes stale until it is changed here.
- **Undo:** `install` in `agents/ask/harness/opencode.ts`.

### D693. A message that names a harness names it as Dashi shows it, with curly apostrophes

- **Date:** 2026-11-24. `v10/opencode-v2`.
- **Question:** the assistant said "opencode isn't installed." (the program's name, a straight
  apostrophe) where plan mode and hand-offs said "OpenCode isn't installed."
- **Decision:** every message that names a harness takes its display name (`ANSWERERS[id].name`), and
  its apostrophes are curly (design.html VO-3): "OpenCode isn’t installed.", "… isn’t signed in",
  "… isn’t answering", "OpenCode’s model is at its limit", "OpenCode’s configured provider",
  "… didn’t answer.", "… can’t start without a session.", "Claude Code’s own default".
- **Cost:** none; the rest of Dashi's straight apostrophes wait for VO-3's check.
- **Undo:** from git.

### D694. OpenCode's own `read` stays on: its free models refuse a turn without it

- **Date:** 2026-11-24. `v10/opencode-v2`.
- **Question:** with D691's command line, OpenCode 2 ran inside the sandbox and still answered nothing:
  "Free usage limit reached" (HTTP 429, `FreeUsageLimitError`: "Free models work in OpenCode"), while a
  plain `opencode run` beside it answered at once. The 0.10 installed pass saw the same with OpenCode 1.
- **Found (in the VM, run for run, outside the sandbox too):** the free endpoint refuses a request whose
  agent has every one of OpenCode's own tools off. Dashi's prompt, its MCP server and its permissions
  make no difference; `read` does: with only `read` on (beside `dashi_*`) it answered every time, without
  it never, on `deepseek-v4.1-flash-free` and on `hy4-flash-free` (`bash`, `todowrite`, `glob` or `list`
  alone don't do it). `read` can't be on and denied: OpenCode 2.4.1 ignores a top-level `read: "deny"`
  (it read), and an agent's own `read: "deny"` takes the tool out, so the request is refused again.
- **Decision:** the turn's tools are `{"*": false, "read": true, "dashi_*": true}` and `permission`
  adds `external_directory: "deny"` to edits, shell and fetches. What `read` can reach is the turn's
  folder only (`dashi-launcher`, `dashi-task`, `dashi-assistant` under a fresh runtime directory: empty),
  inside a sandbox whose home holds only OpenCode's own folders; any other folder is denied
  (`external_directory`; seen: "Permission denied: external_directory" for `/etc/hostname`).
- **Cost:** a model may spend a call listing an empty folder. The free tier also has a real quota per
  model and address (about 25 turns here, then 60 to 90 minutes of 429), which this doesn't change.
  If OpenCode changes what its free tier checks, turns fail as before, with its words in the log.
- **Undo:** drop `read: true` and `external_directory` in `agents/ask/harness/opencode.ts`.

### D710. Frosted glass is the compositor's pass; the shell names the panes (a spike, off by default)

- **Date:** 2026-11-25. `v10/blur-spike` (review: `dashi-0.10.0-review/24-blur-spike/`).
- **Question:** the owner wants "expressiveness, frosted glass". On Linux nothing blurred behind Dashi's
  surfaces (mirin's `material` is macOS and Windows only; DE-4, D697). Who blurs, and who says where?
- **Decision:** dashi-comp blurs (Rust displays); the shell says which panes of its surfaces are glass,
  where, and how they look (TypeScript decides), over a new IPC method, `glass {namespace, panes}`, the
  way `input-region` already names the parts of a Metal surface that take clicks. The pane is drawn
  just behind its surface, which keeps its own translucent fill over it. Behind `DASHI_GLASS`
  (`1`: the launcher; or `launcher,dock,menubar`), off by default, until the owner picks a direction
  (`glass/frost`, `tint`, `prism`).
- **Cost:** a pane's rect comes from the panel's `onLayout`, a frame or so after the host draws it; a
  panel that changes size (the launcher's list) can show its glass a frame out of step. The shipped
  version moves the rect into the surface's own commit (D712).
- **Undo:** unset `DASHI_GLASS`; drop `render/glass/`, the `Glass` element and the IPC method.

### D711. The blur: the dual filter at half size, done again only when what is behind changes

- **Date:** 2026-11-25. `v10/blur-spike`.
- **Question:** which blur, and how not to pay for it every frame?
- **Decision:** what is behind a pane (the elements after it in the screen's list, glass under it
  already frosted; with `xray`, only the wallpaper) is drawn at half size into a texture of the pane plus the blur's reach, clipped to
  the screen, by a damage tracker of its own; then halved 1 to 6 times and doubled back with the dual
  filter (Bjørge, SIGGRAPH 2015; written from the talk, no copyleft code read). When that tracker finds
  nothing changed, nothing is drawn or blurred and the pane is not damaged on screen. The pane is
  opaque but for its corners, so what is under it is not drawn on screen twice. Saturation, a tint, a
  grain and the rounded corners are one shader over the result. Textures are kept per pane with the
  GPU's EGL context, in sizes rounded up to 64 pixels, so a pane that grows a little keeps them.
  Damage the tracker reports empty (a 1 px line, nothing at half size) is no change; and the pane's
  solid part never holds an empty band, which the display refused as a damage clip (EINVAL) frame
  after frame (`glass/element.rs` `solid`, tested).
- **Cost (measured in the VM, 1920 × 1200 at 1.75, a 60 fps video behind):** 0.16 ms of GPU a
  frame for the launcher's pane, 0.3 ms for the launcher, the bar and the Dock together, when all are
  blurred again every frame; at rest nothing is blurred again and frosting costs 0.05 ms of the loop.
  The passes are plain GL in one go (`glass/gl.rs`): through smithay's frames each pass cost a fence
  and a flush, 1.5 ms of the loop per pane. A blur is not an exact Gaussian; `blur` is close to CSS's
  `blur()`.
- **Undo:** swap `kawase.rs` for another filter; the IPC stays.

### D712. Apps ask for blur with ext-background-effect-v1; the Metal host sends its glass with its commit

- **Date:** 2026-11-25. `v10/blur-spike` (the protocol decision; not built in the spike).
- **Question:** how does a surface say "this rounded rect is glass, this thick"? KDE's
  `org_kde_kwin_blur` (a region), the staging `ext-background-effect-v1` (a region; "the blur algorithm
  is subject to compositor policies"; KWin, Mutter, niri 26.04 serve it, cosmic-comp has a draft), or
  a host prop sent over Dashi's IPC?
- **Decision:** (1) **Other apps:** dashi-comp serves `ext-background-effect-v1` (MIT, in
  wayland-protocols 1.45 staging, in the `wayland-protocols` crate Dashi already uses): a region,
  blurred with the look the shell chose for windows, clipped to the window's rounded corners; the shell
  grants it per client like the other privileged protocols, and says the look. Not `org_kde_kwin_blur`:
  the ext protocol replaced it, and the clients that ask for blur now (foot, kitty, quickshell and the
  shells on it) speak ext. (2) **Dashi's own surfaces:** mirin's `material` on Linux becomes the Metal host binding
  ext-background-effect-v1 and setting the blur region from the laid-out views that carry `material`,
  in the same `wl_surface.commit` as the frame that draws them (so glass and panel never drift), plus
  one request on `dashi-chrome-v1` for what the region can't say: each pane's corner radius and its
  material level (thin, regular, thick). The shell keeps deciding the look per level (`glass` IPC
  becomes `glass-style {levels}`), and whether glass is on at all.
- **Cost:** mirin work (sumi binds one more global; the host turns `material` views into a region);
  a `dashi-chrome-v1` version bump.
- **Undo:** keep the IPC method of D710 for the shell's surfaces.

### D713. Every number of the glass is the shell's

- **Date:** 2026-11-25. `v10/blur-spike`.
- **Decision:** `blur` (0 to 128 points), `saturation` (0 to 3), `tint` (`#rrggbbaa`), `noise` (0 to
  1), `radius` and `xray` come in the IPC; dashi-comp only range-checks them. The spike's look is one
  constant, `GLASS_LOOK` in `packages/shell/src/glass.ts` (30 points, 1.7, a 0.025 grain). The tint is
  the compositor's, not the surface's fill (the launcher paints none over glass): `GLASS_TINTS` in
  `@dashi/ui`'s `theme/glass.ts`, the launcher's colour at 70%, with a floor that raises it, pixel by
  pixel, until the launcher's muted words keep 4.5:1 (CO-6) over whatever is behind; both glass
  directions (tint's "floor", prism's "contrast governor") ask for one.
- **Undo:** change the constant; the designers' directions will set it per material level.

### D714. A capture or a recording shows the glass as the screen does

- **Date:** 2026-11-25. `v10/blur-spike`.
- **Question:** a screenshot, a screen share or an agent's picture: frost the glass (showing a blur of
  what is behind), or draw it clear, or opaque?
- **Decision:** as on screen: captures are drawn by the same scene, so the glass is frosted there too,
  with textures of its own. What is blurred 30 points is not legible, and a recording that differs from
  the screen is a bug report waiting. Masks still blank masked windows in agents' pictures (they paint
  the picture after it is drawn, the glass included).
- **Cost:** a masked window's colours bleed, blurred, into glass beside it in an agent's picture; never
  its words.
- **Undo:** skip `frost` in `render/capture.rs` (the glass then draws nothing, and what is behind shows sharp).

### D715. Where glass is off: the shell's call, and the compositor says when it can't

- **Date:** 2026-11-25. `v10/blur-spike`.
- **Decision:** Reduce Transparency: the shell sends no panes and the surfaces wear their opaque fill
  (DE-4 as today). Battery saver: x-ray glass (`xray`: only the wallpaper, blurred once and kept, as
  niri's default is), so nothing is blurred again while windows move. A screen shared: glass stays
  (D714). A GPU that can't: `glass` answers `{frosted: false}` (nested, headless, or shaders that did
  not compile) and the shell keeps the opaque fill. None of these is built in the spike beyond the
  answer and `xray`; they come with the shipped version.
- **Undo:** each is one condition in the shell.

### D720. Dashi's glass is Frost: four neutral materials, and the rulebook says so

- **Date:** 2026-11-25. The owner's choice (`dashi-0.10.0-design/glass/owner-answers.md`); written into
  the rulebook on `v10/glass-rules` (review: `dashi-0.10.0-review/25-glass-rules/`).
- **Question:** three directions were drawn for "expressiveness, frosted glass": Frost (quiet glass,
  `glass/frost/`), Tint and Prism. Which one, and how does it become rules the code can be held to?
- **Choice:** Frost. Four neutral materials: thin (the menu bar, the Dock), regular (menus, Control
  Center, the launcher and its conversation, banners, sheets, the lock's field), thick (the focused
  window's sidebar), paper (widgets); and the lock's veil. Blur, saturation, a tint per mode with a
  contrast floor, a grain, a light rim and a dark hairline; a window's content stays opaque; words on
  glass a grey that leans to the backdrop's tone; titles of 20 and up in Inter Display SemiBold.
  design.html takes Frost's "rules it changes" (DE-4, DE-2, CO-6, CO-10, CO-11, CO-12, RA-1, RA-2,
  LA-1, UI-5, TY-1, TY-2, KB-2, MO-3, PA-9) and adds GL-1 to GL-4 and MO-4. Every number is a token in
  `@dashi/ui`'s `theme/glass.ts`, one `GLASS` (`levels`, `veil`, `grain`, `rim`, `hairline`, `floor`,
  `ink`, `depth`, `budget`, `frost`, `onAir`, `inks`), bound in design.html's Glass tables, so H24 holds
  the page and the code together before anything reads them. Each rule the code doesn't follow yet says which workstream makes it
  true: y2 (mirin's `material` on Linux), y3 (the compositor's levels, floor and fallbacks), y4 (the
  shell and the kit wearing it).
- **Why:** it keeps Dashi calm (the owner's principles) and lets the wallpaper be the colour; the floor
  makes "readable on any wallpaper" a mechanism instead of a hope; the spike showed it is cheap.
- **Cost:** radii change on sheets, the launcher, menus, widgets and the Dock (y4); the rulebook carries
  "Not yet in code" on every glass rule until y2 to y4 land.
- **Undo:** the materials are tokens; a different direction changes `theme/glass.ts` and the rules with it.

### D721. Sheets and the launcher's conversation are frosted

- **Date:** 2026-11-25. The owner's answer.
- **Question:** both were made solid on purpose (UI-5's "solid ground"; LA-1's "glass made solid", D261)
  so nothing read through. Frost makes them glass again because the floor now guarantees contrast.
- **Choice:** frosted, regular glass. A sheet keeps its scrim, and the floor samples the ground
  through it.
- **Undo:** their material back to the solid twin (UI-5, LA-1).

### D722. The lock screen is frosted

- **Date:** 2026-11-25. The owner's answer.
- **Choice:** the wallpaper under the veil (`GLASS.veil`: blur 10, saturation 1.15, a light tint),
  frosted most in a band behind the clock and the password; the field on regular glass, the widgets
  on paper glass. With glass off (GL-3) the lock is today's washes (`LOGIN`, `LOGIN_LIGHT`).
- **Undo:** drop the veil; the washes stay.
- **Corrected (2026-11-26, D768):** the veil is blur 24, saturation 1.2 (Frost v2), and the lock is
  C · Split (D760): the tint gathers behind the left half's words; Today is regular glass.

### D723. Battery saver keeps glass, wallpaper-only

- **Date:** 2026-11-25. The owner's answer (Frost had proposed the solid twins).
- **Choice:** x-ray: each material blurs the wallpaper alone, once, and keeps it; nothing is blurred
  again while windows move (D715's `xray`, which the spike measured at 0 ms of GPU a frame with a video
  playing). Reduce Transparency, a GPU that can't and a missed budget still give the solid twins.
- **Undo:** one condition in the shell (GL-3).

### D724. On air: a faint glow of its ink and the Now dot; no ring, no flood

- **Date:** 2026-11-25. The owner's answer ("the Now dot is enough"), after "the flood looks like shit".
- **Choice:** CO-12: the card on air is lit: 14% of its ink in its paper glass's tint (floored), lifted
  2 points with the `lg` shadow in its ink at 50% (`GLASS.onAir`); its one number stays inked, its
  words stay ink; the tally is the vermilion dot of the "Now" tag and the bar's capsule. The 3-point
  ring and the flood (D401's) are gone; house lights, holders, cuts and timings are unchanged.
- **Undo:** CO-12's old sentence; `ON_INK` is still in the code until y4 removes the flood.
- **Corrected (2026-11-26, D768):** the 14% stain, the lift and the coloured `lg` shadow were Frost v1's.
  The owner's answer, as Frost v2 drew it: the card keeps its glass as off air, glows faintly in its own
  ink (`0 0 30 3`, 60% Light, 55% Dark, `GLASS.onAir`), and the "Now" tag carries the tally's dot.
  No tint, no lift, no ring, no flood.

### D725. Light glass stays light over a dark wallpaper

- **Date:** 2026-11-25. The owner's answer.
- **Question:** Light's glass over a black or dark busy wallpaper ends near 80% white under the floor.
  Accept that, or let the words flip between dark and light as macOS's do?
- **Choice:** stays light: the glass whitens and its words never flip (GL-1). Dark mirrors it.
- **Undo:** a vibrant ink that follows the backdrop's lightness instead of the mode.

### D726. Matcha is one step darker on glass in Light

- **Date:** 2026-11-25. The owner's answer.
- **Question:** the Inks' Light matcha (`#6B6F03`, 5.2:1 on the paper) is the worst ink on paper glass:
  it forced the battery widget's glass up to α 0.96 over a mid-dark photo.
- **Choice:** on glass, Light matcha is OKLCH L 0.48 (from 0.52): `#606301`, 6.2:1 on the paper
  (`GLASS.inks.matcha.light`). Dark and the other inks are unchanged; the Inks' own table (`INKS`) is
  untouched, so widgets off glass print as before.
- **Undo:** drop `GLASS.inks`.
- **Corrected (2026-11-26, D768):** `#5F6305` (OKLCH 0.48 0.104 112, Frost v2's), not `#606301`:
  the chroma sRGB holds there; 6.2:1 on the paper either way. `GLASS.inks.light.matcha`.

### D727. The cost is accepted: under 5% of a 120 Hz frame

- **Date:** 2026-11-25. The owner's answer, from the spike's numbers (`dashi-0.10.0-review/24-blur-spike/`).
- **Choice:** one pane 0.16 ms of GPU a frame over a playing video in the VM, three about 0.3 ms,
  nothing at rest; the laptop is estimated under 5% of its 8.3 ms frame. The rulebook holds all glass
  together under 1.5 ms (`GLASS.budget`); two misses in a row and the oldest layer is kept, then solid.
- **Undo:** the budget is a token.

### D728. The rulebook's own calls for glass

- **Date:** 2026-11-25. `v10/glass-rules` (reversible; decided here, not asked).
- **Choices:**
  - **The tokens' shape.** One export, `GLASS` (the package's index is at H2's 300 lines, and y3 reads
    one place): `levels`, one record per level (`blur`, `saturation`, and per mode `tint`, `least`,
    `solid`), the veil apart (it has no solid twin), and the shared parts, numbers only, so design.html
    binds every one with `data-token` (H24 reads numbers; a hex can't be bound, so the tints' hex are
    written beside their bound α). Paper's tint is `INK_PAPER`, not a copy. `GLASS_TINTS` (the spike's launcher tint) stays until y4 moves the launcher to `regular`.
  - **"Keel" is called the hairline** in the rules and the tokens (`GLASS.hairline`): one word for the
    line at an edge across the page.
  - **A window left out of a capture is left out of every backdrop in it** (GL-3, Frost's rule). D714
    still holds (captures show the glass as the screen does); this removes its stated cost, a masked
    window's colours bleeding into the glass in an agent's picture.
  - **A rule the code doesn't follow keeps its target in words and today's value bound.** RA-1 says
    "a menu 10 (today 9)" with the 9 bound to `RADIUS.menu`, so H24 stays true until y4 changes the
    token and the page together.
  - **Motion for glass is a new rule, MO-4**, rather than added to MO-1 (MO-1 is the 300 ms ceiling and
    stays one sentence); MO-3 gains "glass appears at full frost".
- **Undo:** each is an edit to `theme/glass.ts` or design.html.

### D730. The compositor draws the whole material; the shell sends each level's look

- **Date:** 2026-11-25. `v10/glass-comp` (reversible; decided here).
- **Question:** who draws a material's tint, floor, grain, rim and hairline, and its solid twin: the
  client over the blur, or the compositor under the client?
- **Choice:** the compositor, from `glass-style {mode, levels, grain, rim, hairline, floor, depth,
  apps}`, which the shell builds from `GLASS` (`packages/shell/src/glass-style.ts`) for the mode it is
  in. A client names only a pane's rect, radius and level (dashi_glass_v1, D733) and paints no fill
  there. The solid twin is the compositor's too, so Reduce Transparency changes no client: every
  pane is drawn in its twin's colour, rim and hairline kept (GL-3).
- **Why:** the floor needs the blurred backdrop, which only the compositor has; one place draws every
  surface's glass the same way; no colour crosses the protocol (D713 still holds: the numbers are the
  shell's).
- **Undo:** clients tint themselves and `glass-style` carries only blur and saturation.

### D731. Other apps get glass by default; the person turns it off

- **Date:** 2026-11-25. `v10/glass-comp` (reversible; the brief asked to decide).
- **Question:** `ext-background-effect-v1` and `dashi_glass_v1` are granted per client by the shell.
  Dashi's own processes yes; other apps?
- **Choice:** yes. The shell's own processes always; any other app that asks unless the person
  turned it off: `appearance.glassForApps: false` in settings.json (a Settings › Appearance row is
  y4's), Reduce Transparency (glass solid everywhere; an app's bare region is then not drawn at all),
  or a program on the deny list `glass-clients {others, deny}` carries. A client not granted hears
  `capabilities(0)` / `drawing(none)` (the protocols' own way to say "no blur here") and is drawn as
  it would be without glass. The grant is read per frame, so turning it off takes effect at once.
- **Why:** blur reveals nothing to the app (it never reads the pixels behind it) and costs what the
  spike measured; KWin, Mutter and niri serve it to everyone. A terminal that asks for blur and gets
  none looks broken.
- **Undo:** `glass-clients {others: false}` from the shell by default.

### D732. An app's bare blur region: a blur, no tint

- **Date:** 2026-11-25. `v10/glass-comp`.
- **Choice:** a surface with a blur region and no dashi_glass panes (foot, kitty) is blurred in each
  of its rectangles with `regular`'s blur and saturation and the grain (`glass-style`'s `apps`), no
  tint, no floor, no rim or hairline: the app paints its own translucent colour over it. A region
  that subtracts, or holds more than 16 rectangles, is blurred in its bounds (the protocol leaves the
  shape to the compositor). A window's glass is cut to its frame and Dashi's rounded corners; the
  overview and a flight to the Dock draw windows small without glass.
- **Undo:** `apps` names another level; a tinted look for apps is one more field.

### D733. dashi_glass_v1 rides dashi-chrome-v1 version 2; Dashi owns the XML

- **Date:** 2026-11-25. `v10/glass-comp` with y2 (`v10-glass-mirin`), through files only.
- **Choice:** `dashi_chrome_manager_v1` v2 `get_glass(wl_surface)` → `dashi_glass_v1`: `add_pane(x, y,
  width, height, radius, level)` (at most 16) and `clear`, double-buffered with the surface (smithay's
  cached state), so a pane changes in the same commit as the buffer drawn on it; events `drawing(none
  | material)` and `tone(0xRRGGBB)`. Where a surface has panes they are its glass and its blur region
  isn't read (the region is for other compositors). The XML is
  `crates/dashi-comp/protocols/dashi-chrome-v1.xml` with `PROTOCOL.md` beside it; mirin copies it.
- **Why:** dashi-chrome-v1 is already the Dashi-private global mirin binds; a v2 is backward
  compatible (mirin binds 1..=1 today). One object per surface, not per pane, keeps it like
  ext-background-effect.
- **Undo:** a protocol of its own (`dashi_glass_manager_v1`), the same requests.

### D734. A third layer of glass is drawn solid, by overlap

- **Date:** 2026-11-25. `v10/glass-comp` (GL-2).
- **Choice:** frosting walks a screen's panes back to front; a pane's depth is one more than the
  deepest pane it overlaps that is already frosted; past `glass-style`'s `depth` (2) it is drawn as its
  level's solid twin. Touching is not overlapping (a menu under the bar is one layer). A capture uses
  the depth the screens last used.
- **Undo:** `depth: 8`.

### D735. The backdrop's tone: read back when it settles, at most every 120 ms

- **Date:** 2026-11-25. `v10/glass-comp` (GL-1's tone).
- **Choice:** the mean colour of the blur's smallest picture (a few dozen texels), lifted as the pane
  lifts it, read back with `glReadPixels` once what is behind has stopped changing, never twice in
  120 ms, and once a second while it keeps changing (a video); sent only when it moved 2/255 or more.
  The shell hears `glass-tone {namespace, tone}` for its own panes, a client `dashi_glass_v1.tone`;
  a surface's first pane speaks for it. Reading back stalls the event loop until the GPU has done the
  blur, which is why it is rare; the cost shows in `DASHI_GLASS_STATS`'s `cpu`.
- **Undo:** a pixel buffer object read a frame later (no stall), if the stall ever shows.

### D736. The floor stays per pixel, now counting the grain

- **Date:** 2026-11-25. `v10/glass-comp`.
- **Question:** Frost asks for one floor α per surface, eased (it rises at once, falls after 300 ms of
  stillness, over `base`); the spike raises the tint per pixel.
- **Choice:** per pixel, as the spike, with the grain at its worst for the words in the test (the
  rule's "grain included"). The blurred backdrop changes smoothly, so the floor does too, and per
  pixel never lets one dark patch force the whole pane opaque. The eased per-surface α (MO-4) needs a
  reduction of the backdrop each frame; it is left for when a flicker is seen (design.html MO-4 says
  so).
- **Undo:** a min/max reduction pass and an α uniform eased on the CPU.

### D737. Battery saver is the low-power mode; Reduce Transparency is a setting

- **Date:** 2026-11-25. `v10/glass-comp` (GL-3, D723).
- **Choice:** the shell sends `mode: "xray"` while the power mode in effect is low-power
  (`ModeStore`'s `effective.mode`), and `mode: "solid"` while `appearance.reduceTransparency` is on
  (Reduce Transparency wins). A GPU whose shaders don't compile answers `frosted: false`: no glass is
  drawn, clients hear `drawing(none)` and paint their fills, and `GlassSync.frosted` tells the
  shell's own surfaces (y4). `glass-style` is sent in every session, once Dark Mode is known; the
  shell's own spike panes stay behind `DASHI_GLASS` until its surfaces wear `material` (y4).
- **Undo:** the shell's `glassMode`.

### D738. The second screen and the copied screen pay their own glass

- **Date:** 2026-11-25. `v10/glass-comp`.
- **Choice:** each screen frosts its own panes with textures of its own (keyed by the screen's
  name). A screen composed on one GPU and copied to another (D513: the laptop's external screen,
  drawn on the AMD and copied to the NVIDIA card) frosts on the drawing GPU, through the same
  renderer as the rest of its frame; the copy carries the result and costs what it did. Nothing in
  the glass knows about the copy.
- **Undo:** nothing to undo; a per-screen opt-out would be a `glass-style` field.

### D729. Frost v2 is the base: its five questions settled

- **Date:** 2026-11-26. The owner's second round (`dashi-0.10.0-design/glass/owner-answers.md`, "Second
  round"; the design: `glass/frost-v2/`), written into the rulebook on `v10/glass-rules`.
- **Question:** Frost v2 drew the first round's answers and asked five things: banners beside the widgets
  or pushing them down; the Dark conversation going solid over a bright wallpaper; the on-air glow's
  strength; the lock (replaced by lock-v3, D760); battery saver's row.
- **Choice:** the recommendations, which the owner didn't object to. Banners have their own lane, left of
  the widget column and top-aligned with it, newest on top, 8 apart, 356 wide, radius 18; a widget is never
  covered or moved (NO-6). Words on a fill inside glass are primary ink, so the Dark conversation stays
  frosted (GL-1). The on-air glow stays faint and the Now dot carries the tally (CO-12, D724). Battery
  saver's row is "Lighter glass on battery saver", on by default (GL-3). The floor learned v2's two rules:
  words on a fill are checked on the fill (white 55% Light, 10% Dark, `GLASS.fill`), and marks are held at
  3:1, words at 4.5:1 (`GLASS.floor.glyphs`). The veil is blur 24, saturation 1.2.
- **Cost:** the lane takes a column of the desktop's width while banners show.
- **Undo:** each is a sentence in its rule and a number in `GLASS`.

### D760. The lock is C · Split, its clock 264 ExtraLight

- **Date:** 2026-11-26. The owner's answer (`glass/lock-v3/`, option C).
- **Question:** "the lock screen needs more work": its layout and its clock. Four layouts were drawn:
  A · Stage (a hero clock, a shelf), B · Desk (widgets lead), C · Split, D · Depth (the clock behind the
  photo's subject).
- **Choice:** C. Time at the left edge (264 / 216 Inter Display ExtraLight, hours over minutes, 88 in on
  the laptop, 96 on a 1920-wide screen, the day 18 above) with who signs in under it; Today on the right, a
  744 pt full-height pane of regular glass with the Calendar widget wide, three small widgets,
  Notifications and Playing on paper glass. The login screen, Glance and the other screens are the left
  half (LK-1 to LK-5, MS-6, TY-1). `LOCK_GLASS` is retired for paper glass. D · Depth not now: it needs a
  segmentation model whose code and weights are MIT-compatible, and would only ever be an opt-in. Below
  1280 pt wide Today becomes a bottom sheet and the clock one line: decided here, not yet drawn. Today's
  title (24) and the initials (52) are new named sizes in TY-1.
- **Why:** one clock in one place on every surface (D570, D571), the face the owner approved, at last at a
  size with presence; Today reads at full size; nothing new from the compositor.
- **Cost:** the pane hides half the wallpaper, frosted; `TYPE.clock` changes (120 → 264 / 216) with y4.
- **Undo:** A's layout is drawn (232 Light, one line); the numbers are `GLASS.lock`.

### D761. Notifications on the lock are hidden by default

- **Date:** 2026-11-26. The owner's answer.
- **Choice:** on the lock a notification shows its app, a count, the time and a lock glyph, never who or
  what. Notifications › an app › Show previews: When Unlocked (the default) or Always (NO-7).
- **Why:** a locked screen is seen by whoever walks past.
- **Undo:** the default is one setting.

### D762. Coloured inks are on the floor's list, and five take a step on glass

- **Date:** 2026-11-26. The owner's answer, from `glass/frost-objects/` (question 1).
- **Question:** the floor only knew the two vibrant inks. Every coloured ink an object shows (ume words,
  the tally, the microphone, the agents' purple, moss, wakame) failed somewhere until it was named, and
  then its surface went near solid (α 0.86 to 1.00).
- **Choice:** both. Every coloured ink a surface shows is on its floor list, words at 4.5:1 and marks at 3:1
  (GL-5); and the inks that failed take one OKLCH step on glass, as matcha did (D726): Light ume words
  `#A0324A`, Light wakame `#00737E`, Light microphone `#9F4800` on a 12% wash (its pill's `microphoneWash`, 16% today), Dark ume on a fill
  `#F6859B` (`GLASS.inks`). The tally keeps its one vermilion (3.15:1 as a mark).
- **Cost:** two reds and two teals in the system, one for glass; the kit picks by where it draws.
- **Undo:** drop the steps and let those surfaces go near solid while the ink shows.

### D763. The focus ring keeps a white gap on the accent

- **Date:** 2026-11-26. The owner's answer (frost-objects question 2).
- **Question:** purple `#6E56CF` on the owner's magenta is 1.05:1: the ring vanished round a knob in a lit
  page header or inside a lit tile.
- **Choice:** one purple ring still (KB-2), with a 1.5 pt `onAccent` gap where it crosses an accent fill
  (`GLASS.focusGap`). Not a white ring: the ring stays one colour everywhere.
- **Undo:** the gap is one number.

### D764. The Dock: a label, ink badges, a download bar, a Trash, autohide that shows nothing, magnification

- **Date:** 2026-11-26. The owner's answer (frost-objects question 3), magnification against the
  designer's advice.
- **Choice:** a new section, The Dock (DK-1 to DK-6): radius 20; a hover label of regular glass after
  300 ms; counts as ink pills, never red; a download as an ink bar on a paper plate, never the accent; a
  Trash after the last divider; hidden shows nothing, a 2 pt band and a 250 ms rest; magnification, the
  icon to 1.42 and its neighbours to 1.18, lifted 12. Decided here: magnification is on by default (the
  owner asked for it) and off under Reduce Motion; the row and its glass widen with it and are blurred again
  only while it moves, inside the glass budget; the label takes the menu's radius (the designer drew 9, off
  RA-1's scale once menus are 10).
- **Cost:** a magnifying Dock re-blurs a thin pane while the pointer moves along it (about the spike's
  0.16 ms a frame); a press must land on the icon as drawn.
- **Undo:** magnification's default is one setting; each part is its own rule.

### D765. Control Center gets a Display page, a Focus page and a Now Playing tile

- **Date:** 2026-11-26. The owner's answer (frost-objects question 4), the tile against the designer's
  advice.
- **Choice:** CC-5 (Display: a brightness slider per screen Dashi can dim, Night Shift, Dark, Displays
  Settings…), CC-6 (Focus: for 1 hour, until this evening, until tomorrow, until I turn it off; "Banners
  wait in the area. Agents' questions still ask."), CC-7 (Now Playing: a wide tile, a 56 pill on a fill,
  the sleeve a 44 disc, Pause or Play and Next in ink; it opens the player). Decided here: with no player
  the tile isn't shown and keeps its place (CC-2); the bar's capsule and the live card are unchanged.
- **Undo:** each is a catalog entry.

### D766. The objects' recommendations, all of them

- **Date:** 2026-11-26. The owner: "accept all the designer's recommendations" (frost-objects questions 5 to 9).
- **Choice:**
  - The bottom capsule's line stays solid (ink for dictation, the persona's colour for voice); only its
    card is glass, with the persona's 1.5 rim (CP-11).
  - Notification cards in the area are paper glass, banners regular (NO-5).
  - A link on glass is primary ink, underlined, never the accent (GL-1).
  - A selection in a window without focus turns neutral: ink 10%, its bar ink 55% (CO-9, `GLASS.selection`);
    on glass the selection wash is the accent at 22%.
  - Words on fills are primary ink (v2's question 2, answer b; GL-1).
  - The glass control edge: ink 56% Light, white 44% Dark, 3:1 on the floored ground (CO-6, `GLASS.edge`).
  - Control Center: muted is the knob in ink; a knob wears the glass edge; a dim applet tile is exempt like
    disabled (CC-1).
- **Undo:** each is a sentence in its rule.

### D767. The objects designer's own calls, taken as rules

- **Date:** 2026-11-26. `glass/frost-objects/` README, "Decided here".
- **Choice:** tooltips are always regular's solid twin (T-1, GL-6); a submenu is one level at most and, as a
  third layer, its solid twin; a group's peeking edges and the widget gallery's previews are solid twins
  (GL-2); the overview's background is the veil with no tint and no floor; the OSD and the switcher are
  regular glass, the Spaces row and the taskbar thin (DE-4); an applet's popover is framed by the shell on
  regular glass, r12, pad 14 (LA-4); no glass over or inside a capture or under the eyedropper (GL-6); the
  login screen is always Dark, the veil full width (LK-3); the snap preview is thin glass, r10, inset 6,
  never the accent (WI-10); "Your turn" pushes the banner lane down (NO-6); chosen in the switcher, the
  Spaces row and the launcher's pictures is the accent, hover ink, and editing a widget rings it in ink
  (CO-9).
- **Undo:** each is a sentence in its rule.

### D768. The leftovers in the tokens and the rules, fixed

- **Date:** 2026-11-26. Found by the objects designer.
- **Choice:** `GLASS.onAir` is the glow only (`blur` 30, `spread` 3, the ink at 0.60 / 0.55): no stain, no
  lift. CO-12, GL-4 ("the one stained glass") and D724 say the same. The veil is 24 / 1.2 (D722, LK-4).
  Light matcha on glass is `#5F6305` (D726). D722, D724 and D726 keep their text and gain a "Corrected" line
  pointing here, so the log still shows what was first decided.
- **Undo:** none wanted.

### D769. Where the second round's numbers live

- **Date:** 2026-11-26. `v10/glass-rules` (reversible; decided here).
- **Choices:**
  - The surfaces' numbers (the lock, the Dock, the banners' lane, the Now Playing tile) sit in
    `theme/glass-surfaces.ts`, gathered into `GLASS` (`GLASS.lock`, `GLASS.dock`, `GLASS.banner`,
    `GLASS.nowPlaying`): the package index is at H2's 300 lines, y4 reads one place, and design.html binds
    each (H24). y4 may move one beside its component (H21b) with the page in the same commit.
  - New sections: The Dock (DK-1 to DK-6) and The lock screen (LK-1 to LK-5); new rules GL-5, GL-6, CC-5 to
    CC-7, NO-5 to NO-7, CP-11, WI-10.
  - Every rule the code doesn't follow yet is tagged "Not yet in code — y4", naming y3 where the
    compositor's part is also missing.
  - Not taken: holding a widget's category figures at 3:1 as large text (lock-v3's question 4). The wakame
    step makes it pass at 4.5:1, and a threshold is not loosened when an ink can move instead (Part A).

### D770. A surface wears a level through the kit's `Frosted`, its solid twin as its fill

- **Date:** 2026-11-26. `v10/glass-kit` (reversible; decided here).
- **Question:** how does a Dashi surface wear Frost (DE-4): mirin's `material` directly, or through the kit?
- **Choice:** `@dashi/ui`'s `<Frosted level="…">` (`packages/dashi-ui/src/frosted.tsx`): a view whose
  `backgroundColor` is the level's solid twin in the mode in use, and which sends `material` only to a
  host whose protocol line says `glass` (an older one refuses the tree), read through mirin's
  `useWindowGlass()`. Below it, `OnGlassContext` says the level and the backdrop's tone, and the kit's
  palettes turn to their glass twins (D771, D772). A third `Frosted` in a tree is its twin with neutral
  inks (GL-2: the compositor's overlap rule, D734, catches glass over glass from other surfaces);
  `solid` turns glass off for one surface; `OffGlass` puts a window's ground back (a tooltip, GL-6).
- **Why:** the twin must be right wherever the compositor draws no glass (another compositor, glass off
  for the app, the first frame), and every control under the surface has to know it is on glass; one
  component does both, so no surface can forget either.
  The compositor draws glass in the session's mode, so a subtree an `Appearance` paints in the other
  mode (the gallery's Dark column in a Light session) gets its twin, not glass of the wrong mode.
- **Cost:** a surface's glass is a React subtree, not a prop on any view.
- **Undo:** surfaces pass `material` themselves and wrap their trees in `OnGlassContext`.

### D771. The vibrant inks: the token's lightness, the backdrop's hue, its chroma up to the token's

- **Date:** 2026-11-26. `v10/glass-kit` (reversible; decided here).
- **Question:** GL-1's words "lean a breath to the backdrop's hue". How much, from what?
- **Choice:** `vibrantInks(dark, tone)` (`theme/on-glass.ts`): `GLASS.ink`'s L, the tone's hue (OKLCH),
  and the smaller of the token's C and the tone's own C, so a grey backdrop gives grey words. Neutral
  (C 0) until the compositor says a tone, on a third layer and with glass off. The tone is the window's
  (mirin reads `dashi_glass_v1.tone` for its first pane: `useWindowGlass().tone`, `useGlassTone()`), not
  per pane. Words keep 4.5:1 on each level's twin (tested); the floor keeps them over the backdrop.
- **Why:** the floor measures neutral grey at this lightness (glass-style's `floor.ink`), and the
  chroma it adds moves luminance by less than the floor's margin; one tone per window is what the
  protocol sends.
- **Undo:** C from the token alone; or neutral inks always.

### D772. The palettes on glass, and a selection without focus

- **Date:** 2026-11-26. `v10/glass-kit` (reversible; frost-objects' builder's table, owner's round 2).
- **Choice:** under `Frosted`, `useColors()` is `paintedPalette(…)`: words and `dot` the vibrant inks,
  disabled words primary at 40 %, `controlEdge` and `checkbox` the glass edge (`GLASS.edge`), `button`
  and `tile` white at `GLASS.fill` (hover 12 points more), `ume`, `critical`, `criticalInk` and
  `batteryLow` the stepped ume (Light `#A0324A`, Dark `#F6859B`: Dark's step for "on a fill" is used for
  all of Dark's ume on glass, lighter being safer on dark glass), Light's microphone `#9F4800` on a 12 %
  wash, `accentInk` primary (a link on glass is ink), a selection the accent at 22 % under primary
  words. `useControlColors()` (the panel look): off tiles and chips a fill, words vibrant, and a new
  `edge` (the glass edge) that off knobs, outline pills and the panel switch's off outline wear.
  `useSurface()`: a field, a card and a stripe are fills. The Inks on glass: `glassInkTokens` steps
  Light matcha and wakame. A chosen segment is raised on paper (`glassRaised`: white, Dark `#4A4A50`).
  A window without focus (`AppWindow` reads mirin's `useWindowActive()` into `WindowFocusContext`)
  turns every selection neutral, on glass or not: ink at 10 %, its bar ink at 55 % (CO-9 says "a window
  without focus", not only glass).
- **Cost:** `useColors()` reads two contexts; a window's focus change repaints its selection's users.
- **Undo:** the glass twins only where a control asks; the neutral selection only on glass.

### D773. The shell's glass switches reach the compositor through `glass-style`

- **Date:** 2026-11-26. `v10/glass-kit` (reversible; the brief's rows, the owner's round 2).
- **Choice:** Settings › Appearance gets a glass group: Reduce transparency
  (`appearance.reduceTransparency`), Tint glass with the wallpaper (`appearance.tintGlass`, on: off sends
  every level's and the veil's saturation as 1, GL-4), Glass for other apps (`appearance.glassForApps`,
  `glass-clients`). Settings › Battery gets Lighter glass on battery saver
  (`appearance.lighterGlassOnSaver`, on: off keeps glass frosted on battery saver, GL-3, D729). The
  battery row's value lives in `appearance` with the others: one section holds how glass looks. Each is
  an agent setting too (`set_setting`). The spike's `DASHI_GLASS` and its panes (`src/glass.ts`: the
  launcher's, the Dock's and the bar's) are gone; the launcher is solid until its engineer moves it.
- **Undo:** drop the rows; settings.json still takes the keys.

### D774. The ring's gap on the accent is mirin's, inherited like the ring's colour

- **Date:** 2026-11-26. `v10/glass-kit` (reversible; KB-2, D763).
- **Choice:** mirin draws a 1.5 px band of `focusRingGapColor` just inside the ring (PR #60), set on a
  view for it and the focusable views inside, as `focusRingColor` is. The kit's `useFocusGap(lit,
  onAccent)` sets it on a lit tile, a lit knob and an on switch, only for a host that says `focusGap`.
  A lit tile's own ring gets the gap too, which shows as a white halo between purple and the tile:
  harmless, and one rule.
- **Why:** the ring is Metal's (KB-2: nothing draws one by hand), so its gap is too.
- **Undo:** drop the style; the ring is purple on the accent again.

### D775. A shadow is cut out of its view, in mirin

- **Date:** 2026-11-26. `v10/glass-kit` (reversible; y3's finding, the brief's item 3).
- **Question:** the launcher's glass read 19 % dark: `SHADOW.xl` under a view with no fill.
- **Choice:** mirin's engine cuts every drop shadow out of its caster, as CSS clips an outer
  `box-shadow` to outside the border box (`Shadow::caster_bounds`; mirin PR #60). Floating glass keeps
  `SHADOW.xl` (DE-1).
- **Why:** the host's bug, fixed where it starts (Part A); a view with a translucent fill was darkened
  by its own shadow too.
- **Also found in the VM** (the first end-to-end run of `material`), fixed in mirin the same way: the
  blur capability was never read (wayland-protocols 0.32.9 says `blur` is 0; Dashi sends 1), an app's
  window was opaque over its own panes, and a surface offering only `Inherit` got straight alpha.
  Proof: `dashi-0.10.0-review/28-glass-kit/`.
- **Undo:** revert the shader's cut; surfaces drop their shadows instead.

### D800. The Dock magnifies by icon, and names it on its own surface

- **Date:** 2026-11-26. `v10/glass-dock` (reversible; DK-2, DK-6; frost-objects board 05).
- **Question:** Metal tells a view that the pointer is over it (`onHoverChange`), not where it is, and has
  no transforms. How does the Dock magnify and where does the label go?
- **Choice:** by icon, as board 05 draws it: the icon under the pointer at `GLASS.dock.magnify.peak`, its
  two neighbours at `.neighbour`, lifted; each icon's box grows with its picture (grown upward), so the row
  widens and the icon under the pointer keeps its centre (its neighbours grow alike on both sides). The
  Dock's surface keeps `DOCK_HEADROOM` above the panel (the tallest icon and the label); the windows' zone
  stays the panel's, and clicks reach the lifted part only while it is lifted (`clickBounds`). Nothing
  grows or is named while a drag, a Dock menu or a card asking is under way, or while the Dock moves; off
  under Reduce Motion and by the new Settings › Desktop & Dock › Magnification row (`dock.magnify`, on).
  The label is regular glass on the Dock's surface, radius 9 (frost-objects' table), and moves at once
  from one icon to the next; only the first waits 300 ms.
- **Why:** a smooth falloff needs the pointer's position, which no Metal host reports; the board drew
  exactly three sizes. A label on its own surface would be a second host for a 26 pt pill.
- **Undo:** `magnify` off; drop `DOCK_HEADROOM` and the label.

### D801. Counts and downloads come from the launcher API apps already speak

- **Date:** 2026-11-26. `v10/glass-dock` (reversible; DK-3).
- **Choice:** the Dock listens on the session bus for `com.canonical.Unity.LauncherEntry` `Update`
  (`count`, `count-visible`, `progress`, `progress-visible`), keyed by the `application://<id>.desktop`
  URI, cleared when the sender leaves the bus (`dock/badges.ts`). Chromium (Helium), Firefox, Thunderbird
  and Telegram send it; a download's progress is the same signal. Counts are ink pills with onPrimary
  words ("99+" past 99), ringed in the thin twin; progress an ink bar on paper's solid twin. Not the
  notifications' count: an app's own number is the one it means.
- **Undo:** drop the listener; nothing else reads it.

### D802. The Trash in the Dock takes drops, opens in Files, asks before it empties

- **Date:** 2026-11-26. `v10/glass-dock` (reversible; DK-4).
- **Choice:** full while the home Trash's `files` folder holds anything (watched); the icons are two new
  SVGs in the app icons' style (empty, full), as board 05 draws them. A press opens Files on that folder
  (Files shows it as the Trash). Its menu: Open, Empty Trash…, which asks through the person's own sheet
  (`confirmPerson`, ume, "Empty the Trash?") and then empties every Trash (`gio trash --empty`). Files
  dropped on it go to the Trash, except the home folder, the root and the folders the sidebar lists.
- **Undo:** leave `trash` out of `startDock`.

### D803. The lock is split on wide screens only; the narrow one waits for its drawing (superseded by D806)

- **Date:** 2026-11-26. `v10/glass-dock` (reversible; LK-1 to LK-5, NO-7, MS-6; lock-v3 C).
- **Choice:** a sign-in screen at least `GLASS.lock.splitMin` (1280) points wide is split (`SplitLogin`,
  `@dashi/ui`): the day and the 264 / 216 clock flush left (88 in, 96 on a 1920-wide screen), who signs
  in (initials on regular glass, the 280 field of regular glass with an ink go arrow, the hint) from
  `GLASS.lock.footer` above the foot (it rides up on a short screen, never over the clock), Sleep, Restart
  and Shut Down as thin pills `GLASS.lock.powerBottom` above it; on the lock where the person is, Today at
  the right (`widgets/lock-today.tsx`): the Calendar widget wide, a row of three compacts (the weather,
  the battery, the person's first compact widget), each app's notifications as one hidden note (its
  count, the time, a lock glyph, NO-7), and the song with its buttons. The other screens, the login
  screen and Glance draw the left half alone at the same place. The split's root wears the veil where the
  host draws glass; dashi-comp now draws a lock surface's own panes (it drew none). Below 1280 points
  (the VM's laptop screen at 1.75, a portrait monitor) everything is as it was: that layout is being drawn
  for the owner and isn't approved.
- **Left out, small:** Metal draws no tracking and no tabular figures, so the clock's −0.02 em and the
  day's 0.06 em are missing; Today's notes show no app icon (the widgets know no catalog); the status
  chip (Wi-Fi, the battery, an agent at work) needs a status source the lock doesn't have; the per-app
  "Show previews" setting isn't built, so every app's words are hidden; Glance folds the next event as
  the tally's on-air line (the event on air), not every next event.
- **Undo:** `isSplitWidth` false: every screen is the column again.

### D804. The split's veil only in the session's mode; the login screen keeps its Dark wash otherwise

- **Date:** 2026-11-26. `v10/glass-dock` (reversible; LK-3, LK-4, GL-3; found in the VM).
- **Question:** the compositor draws glass in the session's mode. The login screen is always Dark; in
  a Light session (and in the greeter, whose compositor knows no mode) its veil came out Light under
  Dark's white words.
- **Choice:** `useVeil(mode)` sends the veil only when the screen's mode is the session's, as `Frosted`
  gives its twin there; the split wraps itself in `Appearance` of its own mode, so its regular and thin
  glass are their Dark twins too. The login screen then shows `LOGIN`'s Dark wash (GL-3's fallback)
  until the compositor can be told to draw the greeter's glass in Dark.
- **Undo:** drop the mode check.

### D805. Hover ends when the pointer leaves a window (mirin, sumi)

- **Date:** 2026-11-26. `v10/glass-dock`, mirin `v10-glass-dock` (reversible; found in the VM, DK-2, DK-6).
- **Question:** the Dock's label and magnification stayed after the pointer left the Dock.
- **Why:** sumi cleared hover on the leave, but the Dock reflows when its icon stops being hovered,
  and the redraw hit-tested the pointer's last place, still over the icon, so it was hovered again.
- **Choice:** sumi's window keeps that the pointer is outside from `MouseExited` until any other pointer
  event, and hit-tests nothing meanwhile (mirin c9787d0, with a test that fails without it). Fixed at
  the source (Part A); nothing in Dashi works around it.
- **Undo:** revert the mirin commit.

### D806. The split lock on every screen size: a narrower pane on landscape, a sheet only on vertical

- **Date:** 2026-11-26. `v10/glass-dock` (the owner's answer on lock-v3 #narrow, 26 Nov; LK-1 to LK-3,
  MS-6). Supersedes D803's "wide screens only".
- **The owner chose:** on a landscape screen narrower than 1646 pt Today stays a side pane,
  `clamp(W − 600, 400, 744)` wide (424 at 1024, 680 at 1280), the clock full size for the screen; the
  bottom sheet only on a screen taller than it is wide; the clock hours over minutes everywhere (LK-1's
  "and the clock one line" is gone).
- **The designer's smaller calls, which stand:** the power pills beside who signs in on a vertical screen
  (the sheet takes the foot); opening Today needs no password (its contents already show); a full band of
  frost across the top 56 pt for the status row; on a vertical monitor the other screen's lock sits at the
  top.
- **How it is built:** one pure function, `lockLayout(W, H)` (`@dashi/ui` lock-layout.ts), gives every
  place: `wide` (C's frame, 1646 and up), `pane` (the clock 30 % of the height, at most 264, its line 0.82,
  64 in, 72 from 1280; who signs in 28 under it; the pills at the foot; Today the narrower pane, two
  compacts under 520 inside) and `vertical` (the day from 120; the pills beside who signs in; the sheet
  open when it leaves the left half whole above it, else its 104 peek: the title, the notifications in one
  card and the song, a thin chevron that opens and closes it). The lock, its other screens, the login
  screen and Glance all read it, so the old centred column, its 120 clock, the row under it, the side
  column and the Now Bar are gone (`LockHead`, `LockSide`, `NowBar`, `noticeCounts`).
- **Decided small, here:** Metal has no per-corner radius, so the sheet runs its 18 radius past the
  screen's foot (the frame draws it 20 taller too); an opened peek covers the left half's lower part
  rather than squeezing the clock (the landscape sheet that squeezed it was not chosen); the peek's row
  holds the notifications as one card and the song, not the frame's five chips (the next event, the
  weather and the battery need a chip of their own the widgets don't draw yet); the band of frost waits
  for the status row (the lock has no status source, and the veil's tint is the compositor's, one even
  tint).
- **Undo:** `lockShape` returns `wide` for every screen.
