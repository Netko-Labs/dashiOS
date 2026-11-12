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

## How to add a decision

Add one entry at the end of Part B, in the commit that makes the change: its
number, the date, the question, the choice, why, what it cost, and how to undo
it. If it teaches a new way to decide, add a line to Part A naming it. Plain,
short words, as the rulebook is written.
