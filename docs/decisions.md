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

### D38. Nothing said runs a plan: a spoken ask waits for the person's Return

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

### D65. A spoken plan asks in the card; a typed plan keeps the launcher; a question is typed in the sheet

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

### D68. The bar's field is a surface of its own, laid over the bar's row

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

### D69. A job in the bar opens 0.8's panel; the jobs give way before a status item does

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

### D70. Until the card exists, a plan that waits is answered in the launcher

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
