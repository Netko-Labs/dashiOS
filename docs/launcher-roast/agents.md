# The AI and agent-native product designer

## The roast

- Dashi gives agents 73 tools that reach into the OS, but the person gets a box that finds app names. The OS can switch Wi-Fi for Claude. It can't do it when you type "wifi off".
- Type a sentence and press Return and nothing happens. There's no "ask", no "did you mean", not even an empty state. The launcher's whole vocabulary is the names of things.
- The agent stack is serious work: a yes counts only when the person pressed it, secrets never reach the model, captures are blanked, agents run in a sandbox. But you can only reach it from a terminal (`dashi-agent claude`), so it's an OS feature most people never meet.
- The pill in the menu bar says what an agent is doing for three seconds, then "Idle". Every call is written to a log no screen reads. The launcher, where you'd look first, has no idea an agent exists.
- The best thing about the launcher: no model sits between "ter" and Terminal. Keep that while adding everything above.

## Findings

| # | Severity | What's wrong | Evidence |
|---|---|---|---|
| 1 | P0 | A request in plain words has nowhere to go. Search scores only the whole query against names and keywords. "turn on dark mode" matches nothing (no keyword *starts with* that string), and Return on an empty list does nothing: `pick` finds no entry and returns. The placeholder promises only "Search apps and files". | `entries.ts:254-266`, `launcher.tsx:69-74`, `launcher.tsx:98`; inferred from the code, no screenshot of a sentence |
| 2 | P1 | Nouns, no verbs. "dark mode" finds the Appearance *pane*, because "dark mode" is a pane keyword. Turning Dark Mode on would be one call: `set_setting dark_mode`, already parsed and checked for agents. Same for "wif": you get Network, not the networks. | `settings-app/search.ts:12,25`, `agents/tools/settings.ts:23-61`, `wifi.png` (one row: Network) |
| 3 | P1 | Nobody to ask. Dashi runs no model and holds no provider. Agents are outside programs on the MCP socket, started by `dashi-agent claude` in a terminal, then `claude mcp add`. Nothing in the GUI starts one, so an "ask" lane would have no one to answer it. | `bin/dashi-agent.ts:5-8`, `agents/server.ts:1-5`; grep for anthropic/openai/ollama/llm in `src/` found nothing |
| 4 | P1 | You don't see what will happen before it happens. Consent is granted per category (11 scopes, e.g. "Manage windows and apps") and "Always Allow" keeps the category, not the action. Only force quit, trash, installs and sign-ins ask about the specific act. There is no step that says "these 3 calls, with these arguments". | `agents/consent.ts:14-52`, `agents/session.ts:1-7,324-341` |
| 5 | P1 | Running agents and "Your turn" are invisible to the launcher. An empty launcher shows only recent apps. A pending hand-over lives only in its own banner. If you miss the banner, ❖ doesn't lead you back to it. | `launcher.tsx:119-121`, `main.tsx:776`, `turn-banner.tsx:1-6`, `empty.png` (just "Recent · Appearance") |
| 6 | P2 | History is write-only. Every call is appended to `activity.jsonl`, but no UI reads it. The Agents pane lists grants and Revoke only. The pill's status falls back to "Idle" 3 s after each call. | `agents/consent.ts:173-181` (grep: no reader in `src/`), `settings-app/panes/agents.tsx:1-5`, `agents/session.ts:27,357-364` |
| 7 | P2 | No follow-ups and no way to talk back. The MCP server offers tools and one instruction string, and no channel from the person to a running agent. "Your turn" offers Done and nothing else: you can't say "no, use my work account". | `agents/tools/registry.ts:27-45`, `turn-banner.tsx:15`, `agents/presence.ts:66-72` |
| 8 | P2 | You can't tell which model or provider is acting. An agent is named by its executable, plus what it claims in `clientInfo`, which is marked unverified. That's honest, but nothing says "this goes to Anthropic" or "this stays on this machine". | `agents/presence.ts:18-26`, `agents/session.ts:154`, `settings-app/agent-names.ts:6-9` |
| 9 | P1 | Provider API keys aren't in the vault. "Tokens that stay home" is designed but not built. The sandbox gives the agent "the person's files as they are", so any API key under `$HOME` is readable to it (inferred). The vault protects passwords, not the keys that run the AI. | `docs/secrets.md:410-427`, `agents/sandbox.ts:7` |
| 10 | P2 | The highlighted row can change under you. When file hits arrive about 120 ms later, the app list shrinks from 7 to as few as 3 (`max(ROWS - files, ROWS - FILE_ROWS)`), and `selected` is neither clamped nor re-anchored. A selected app at row 5 becomes the second file, and Return opens that file instead. | `launcher.tsx:17-20,65-66,101,106` |
| 11 | P2 | The instant path isn't free today. Every open re-reads the XDG application dirs and resolves icons synchronously (`loadEntries()`), and every pause in typing spawns `tinysparql`. This isn't AI, but it's the budget AI must never add to. Not measured. | `main.tsx:758`, `entries.ts:222-244`, `file-search.ts:31-33`, `launcher.tsx:54-59` |
| 12 | P2 | Failures are silent. Without LocalSearch there are just no files. A failed search, a missing agent or a refused scope never surface in the launcher, because the launcher has no row type for a status or an error. | `file-search.ts:6,80-81`, `launcher.tsx:112-179` |
| 13 | P3 | An answer isn't a result. "= 4" isn't selectable or copyable: it isn't counted in `count` and has no `onPress`. A Quick-AI-style answer would inherit that dead end. | `launcher.tsx:67-68,114-118`, `math.png` |
| 14 | P3 | Every Settings pane wears the same gear and takes a row. "set" fills 7 of 7 rows (Setup Assistant, System Settings, About, Agents, ...), and there's no room left for an action or an ask row. | `set.png`, `launcher.tsx:17,66` |
| 15 | P3 | The launcher has no tests at all (no test in the 78 test files imports `launcher`, `launcher-math` or `recents`). Adding a second, slower lane without tests invites "ter waits". | `packages/shell/test/` listing |

## Where Raycast wins today, and where Dashi can win

**Raycast wins today**
- You can ask from the root search: type, press Tab, get a Quick AI answer, then continue in AI Chat for follow-ups. ([manual](https://manual.raycast.com/v1/ai))
- AI Commands with `{selection}` placeholders; presets and prompts you can import. ([manual](https://manual.raycast.com/v1/ai))
- @-mention any extension or local MCP server, with tool confirmations and a "Confirm Always" option you can reset. ([1.98 changelog](https://www.raycast.com/changelog/macos-v1/1-98-0), [AlternativeTo](https://alternativeto.net/news/2025/5/raycast-1-98-adds-model-context-protocol-support-and-mcp-tool-integration))
- A model picker, Auto model, BYOK (Anthropic, Google, OpenAI, OpenRouter) and local Ollama models. ([1.100 changelog](https://www.raycast.com/changelog/1-100-0), [manual](https://manual.raycast.com/v1/ai))
- Chat history and branching. Dashi has neither chat nor history in any UI.

**Where Dashi can win**
- **Reach.** Raycast's tools are whatever extensions expose. Dashi's 73 tools are the OS itself: windows, Spaces, displays, Wi-Fi, Bluetooth, sound, power, notes, calendar, menus, software, files (`agents/tools/registry.ts:48-64`).
- **Consent only the person can give.** The compositor tracks whether each press came from the person or an agent, so a "yes" counts only from the person's own press (`agents/person.ts:1-28`). An app on top of macOS can't prove that.
- **Secrets used, never seen.** Dashi types the password or code into a field it has checked, and password fields and sheets are blank in the agent's screenshots (`docs/secrets.md:241-282`). Raycast's AI has nothing comparable.
- **Privacy.** Raycast says BYOK requests, except OpenRouter, pass through Raycast's servers ([manual](https://manual.raycast.com/v1/ai)). Dashi has no server of its own: the request can go straight to the provider, or to a local model.
- **One "what is acting now" across the OS.** The shiso pill, ⌃❖Esc to stop every agent, "Your turn" hand-overs, and the agent sandbox. The launcher only has to show them.
- **No-model verbs.** The same tool registry can run deterministic commands for the person with zero AI, which Raycast reaches only through per-extension commands.

## Betterments

1. **Two lanes, one field; local always wins.** **Recommended.**
   - What: local results render on the same frame as the keystroke from an in-memory index built once and refreshed when the app dirs change. An "Ask" row appears only as the *last* row, and only when the query reads like a sentence (3+ words, a verb first, or a "?") or when the person presses Tab. Return on the top local hit never waits for anything. No model is called while typing, ever.
   - Why: "ter" opens Terminal the instant you hit Return, every time. AI is something you choose, never a delay.
   - Size: M. Needs: shell.

2. **Verbs from the tool registry, no model.** **Recommended.**
   - What: "dark mode" → "Turn Dark Mode On", with the current state on the row. Also "wifi off", "join Home-5G", "volume 30", "tile left", "move to Space 2", "lock". Each verb is a `ToolDef` (`agents/tools/define.ts:17-31`) whose `parse` already checks its arguments. It runs as the person: kombu selection, logged as "you". The launcher row gets a trailing state ("Off now") and a ⏎ hint.
   - Why: it does the thing instead of opening the place where the thing is. Most "AI commands" people need are really these.
   - Size: M. Needs: shell (verbs over `run.ts`). Lines up with "every setting an addressable entry" (`docs/proposals.html:500`).

3. **Plan before act.** **Recommended.**
   - What: an Ask becomes a plan the launcher shows: numbered steps in plain words, each with its tool, its arguments and its scope chip ("Change settings · allowed", "Manage windows · will ask"). ⏎ runs exactly those calls, Esc cancels, and ⇥ edits the request. The approval is bound to the arguments, not the category: running the plan is "Allow Once" for those calls only. A call that isn't in the plan falls back to today's sheets. The press is checked with `input-origin` like a sheet (`agents/person.ts:22-27`).
   - Why: you see what will happen before it happens. This answers finding 4 without adding a new sheet.
   - Size: L. Needs: agents (a `propose_plan` tool, or a server-side hold on write calls for launcher tasks) and shell.

4. **An agent you can start from ❖.** **Recommended.**
   - What: Settings › Agents gets "Answer my requests with: [Claude Code ▾ / Codex / Local (Ollama) / None]". The launcher starts it headless through `dashi-agent` in the sandbox, wired to `dashi-mcp`, one task per Ask. "None" hides the Ask row entirely.
   - Why: the agent stack stops being something only terminal users find. Turning AI off is one switch.
   - Size: L. Needs: agents, shell, Settings.

5. **Provider keys in the vault (build "Tokens that stay home").** **Recommended.**
   - What: model API keys become vault token items. The sandbox's HTTPS proxy swaps the placeholder in only for that provider's host (`docs/secrets.md:410-427`). Settings shows "Key: in your vault, Claude never sees it".
   - Why: the key that runs the AI gets the same protection as your bank password.
   - Size: L. Needs: agents, dashi-secretd.

6. **"Now" at the top of an empty launcher.** **Recommended.**
   - What: above Recent, one row per running agent task: a shiso dot, the agent, its live status, and Stop. A pending "Your turn" sits first, and ⏎ brings its window forward. Type while a task row is selected to send a follow-up, which reaches the agent as the next turn.
   - Why: ❖ becomes the one place to check what the computer is doing for you.
   - Size: M. Needs: shell (AgentStore is already a store: `agents/presence.ts:105-124`), agents (a follow-up channel).

7. **History you can read and undo.**
   - What: "history" in the launcher, and a list in Settings › Agents, reading `activity.jsonl`, grouped by task: who, what, when, and the outcome. Each settings change gets Undo. Arguments stay out of the log as they do today (`agents/consent.ts:1-7`), so add a per-task summary written by the shell.
   - Why: "what did it just do?" gets an answer that outlives the 3-second pill.
   - Size: M. Needs: shell, agents.

8. **Say where it goes, on the row.**
   - What: the Ask row carries one trailing caption: "Claude · Anthropic, via your key", or "Local · stays on this computer". Only the typed text is sent by default. Context is added only by explicit chips the person adds with ⇥: "+ this window", "+ selection".
   - Why: privacy is visible every time you ask, not buried in a document.
   - Size: S. Needs: shell.

9. **Failure states as rows, never dialogs.**
   - What: no agent set up → "Set up an agent…" opens Settings › Agents. Agent offline or timed out → that step reads "Didn't answer", with Retry. A scope is refused → the step reads "Not allowed", with "Allow once" right there. No files index → "File search is off" once.
   - Why: when something fails you learn why, right where you looked.
   - Size: S–M. Needs: shell.

10. **Keep the highlight on what you chose.**
    - What: re-anchor `selected` to the entry's id when files arrive; make "= 4" selectable (⏎ copies).
    - Why: Return opens what was highlighted, always.
    - Size: S. Needs: shell.

11. **Tests for the instant lane.**
    - What: tests that keep the "ter" path synchronous and never awaiting a model or a process, plus the selection re-anchoring.
    - Why: "never wait" stays true as the launcher grows.
    - Size: S. Needs: shell tests.

## The beat-Raycast move

**Say it, see the plan, press Return.**

You type "put Safari and Notes side by side, mute, and hold my notifications". Without waiting on you, the launcher shows three numbered steps it will take with Dashi's own tools (`tile_window` Safari left, `tile_window` Notes right, `set_volume` muted, `set_setting do_not_disturb`). Each step is marked allowed or "will ask". One Return, pressed by you and checked by the compositor, runs exactly those calls. The agent runs in the sandbox, its key sits in your vault, the request goes straight to your provider or a local model, and the shiso row in ❖ shows it working until it finishes or hands you a "Your turn".

Raycast can chat and call extension tools. It can't prove a person pressed Run, can't type a password the model never sees, and can't touch the window manager it sits on top of. And typing "ter" still opens Terminal on the next frame.

## Mockup notes

All three are the existing panel: 620 wide, 16 px radius, launcher glass, the 56 px field row as the *only* chrome, 44 px rows with 10 px radius, 22 px section labels, 6 px list padding (`launcher.tsx:14,80-121`). No footer bar. Key hints go inside the field row, right-aligned, 12 px, `textMuted`.

**1. Empty launcher with live work (❖ tapped)**
- Field row: magnifier, an empty field with the placeholder "Search, or say what to do", and on the right "⇥ Ask" (12 px muted).
- Section label: "Now".
- Row 1, selected, kombu fill because it's the person's selection:
  - Left: a 30 px avatar with a 6 px shiso dot.
  - Text: "Claude" (15 semibold), then "Your turn: enter the code from your bank" (13).
  - Right: "⏎ Go to window" (12).
- Row 2:
  - Left: a shiso dot.
  - Text: "Codex", then "Looking at your windows · 2 of 4 steps".
  - Right: a 9 px stop square in `agentInk`.
- Section label: "Recent".
- Rows 3–6: apps, as in `empty.png`.
- Total height: 56 + 6 + 22 + 2×44 + 22 + 4×44 + 6 = 376 px. Fits the 440 surface.

**2. Typing "dark mode" (no AI)**
- Field row: "dark mode", with "⏎ Turn on" at the right.
- Row 1, selected:
  - Left: the Appearance glyph.
  - Text: "Turn Dark Mode On".
  - Right: a 28×16 switch drawn off, and "Off now" (12 muted).
- Row 2: gear, "Appearance", with "Settings" (12 muted) beside the name.
- No Ask row, because the query is 2 words with no verb first.
- Then type "dark mode and hide the dock". The verb row stays first, and an Ask row is added as the *last* row:
  - Left: a shiso spark.
  - Text: "Ask Claude: dark mode and hide the dock".
  - Right: "⇥ · Anthropic, your key".
  - The Ask row is shiso-tinted text on transparent, never pre-selected.

**3. The plan (after ⇥ on the Ask row)**
- Field row: the magnifier becomes the shiso spark, the request text stays editable, and the right side reads "⏎ Run 3 · Esc".
- One 22 px label: "Claude will" (muted).
- Three 44 px step rows, each with:
  - Left: a 20 px number.
  - Text: the step in plain words (15).
  - Right: a scope chip (20 px tall, agentWash fill, agentInk 11 px text).
- The steps:
  - "Turn Dark Mode on", chip "Change settings · allowed".
  - "Hide the Dock automatically", chip "Change settings · allowed".
  - "Add a note 'night setup' to Notes", chip "Add to your notes · will ask".
- After ⏎, each row's number becomes a spinner, then a check (moss) or "Not allowed" (broth) with "Allow once" right there. The panel never grows past 440, and longer plans scroll.
