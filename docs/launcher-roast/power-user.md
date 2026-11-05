# Keyboard-first power user

## The roast

- I typed "set" for Settings, the thing I open ten times a day, and got the Setup Assistant, which I ran once in my life, followed by five Settings panes in alphabetical order (`set.png`).
- I typed "ter" and Terminal came first, then Battery & Power, because "bat**ter**y" contains "ter" (`ter.png`). For a launcher with six results, half the screen is substring noise.
- It never learns. I can pick System Settings over Setup Assistant five hundred times and "set" still ranks them the same way. History only exists while the field is empty, and it holds six apps.
- "2+2" says "= 4", and the answer is just text. Enter does nothing, I can't copy it, and there's no hint (`math.png`). It works out the sum and then won't let me use it.
- The keys are ↑, ↓, Enter and Esc, and Esc throws away what I typed. There are no actions on a result, no modifiers, no aliases, no hotkeys, no windows and no clipboard. Today the launcher only opens things. It doesn't do anything to them.
- Dashi owns the compositor, the windows, the menus, every setting, and an agent tool catalog with typed actions. The launcher uses none of it.

## Findings

| # | Severity | What's wrong | Evidence |
|---|---|---|---|
| 1 | P1 | **Opening rebuilds the whole app index on the shell's thread every time.** Each ❖ tap reads every `.desktop` file and probes the disk for icon files (up to 7 sizes × 2 extensions per icon root, then pixmaps, then the theme) before the panel draws. It also re-reads `recents.json` from disk. | `main.tsx:760` (`loadEntries()` inside `openLauncher`), `entries.ts:222-245`, `entries.ts:141-156`, `main.tsx:778` |
| 2 | P1 | **Two quick opens in a row can hit a cold host.** There is one spare host. It's shared by the launcher, the shortcut sheet and menus, and after it's taken a new one starts only 1.5 s later. A host that isn't warm "spends seconds on its GPU context and fonts". Open, Esc, open again, or hold ❖ for the sheet and then tap ❖, can land on the slow path (I infer this from the code; I didn't measure it). Every open also waits on a compositor round trip for the screen first. | `warm-host.ts:2-4`, `warm-host.ts:14`, `warm-host.ts:55-61`, `overlay.tsx:40-43`, `overlay-slots.ts:37`, `main.tsx:761` |
| 3 | P1 | **The selection can jump to a different item under the cursor.** File results arrive ≥120 ms after a keystroke, and when they do, the number of app rows drops from 7 to as few as 3. The selection is an index, and it resets only when the text changes. If I arrow down to app #5 and the files land, Enter opens a file I never chose. | `launcher.tsx:20`, `launcher.tsx:54-66`, `launcher.tsx:99-101`, `launcher.tsx:69-74` |
| 4 | P1 | **Ranking is six fixed tiers with alphabetical ties.** There's no fuzzy matching, no acronyms ("vsc" and "ss" find nothing), no word-subsequence matching, and no use of my history. "set" puts Setup Assistant (name prefix, tier 2) above System Settings (word start, tier 3). Every pane carries the keyword "settings", so it floods the rest at tier 5. | `entries.ts:254-273` (tiers at `:259-264`, tie-break `:270`), `settings-app/search.ts:39`, `set.png` |
| 5 | P1 | **Substring matching surfaces junk.** Any name containing the query matches (tier 4), so "ter" gives Battery & Power. | `entries.ts:263`, `ter.png` |
| 6 | P1 | **No learning from picks.** Recents are a most-recent-first list of 12 app ids, of which 6 are shown, and only when the field is empty. `search()` takes no history. Files I open aren't remembered, and neither are launches from the Dock or the switcher. | `recents.ts:16-17`, `recents.ts:43`, `launcher.tsx:66`, `main.tsx:780` vs `main.tsx:786`, `empty.png` (one "Recent" row) |
| 7 | P1 | **No actions on a result.** Each row has one fixed verb. There's no action list, no ⌘↵ or ⌥↵, and no Reveal in Files, Copy Path, Quit, New Window, Keep in Dock, alias or hotkey. | `launcher.tsx:69-74`, `launcher.tsx:104-108`, `main.tsx:779-788` |
| 8 | P1 | **Open windows aren't in the launcher, and launching never switches.** `launch()` always spawns a new process. "fire" + Enter with Firefox already open asks for another instance. Type-to-find for windows does exist, but only in the ❖Tab switcher, a second search surface with its own model. | `apps.ts:269-292`, `switcher/model.ts:54`, `keymap.ts:174-188` |
| 9 | P2 | **The math answer is a dead end.** The answer row isn't counted as a result and can't be selected, and Enter picks `results[index]` only, so "2+2" + Enter does nothing. There are no units, currency, time zones, dates or hex. "2+2" also fires a file search, which spawns `tinysparql` for nothing. | `launcher.tsx:67-68`, `launcher.tsx:114-118`, `launcher-math.ts:11`, `launcher.tsx:51-64`, `math.png` |
| 10 | P2 | **The keyboard contract is thin.** Only Escape, ↑ and ↓ are handled. There's no Ctrl+N/P, no Tab between sections, no PageUp/PageDown or Home/End, no wrap-around and no pick-row-N. Esc closes even when there's text, so a typo costs the whole query. | `launcher.tsx:104-108` |
| 11 | P2 | **File search is narrow and slow by design.** It spawns a `tinysparql` process per debounced query and matches on file name only, by plain substring. Results are ordered by modification time, not by how well the name matches, and capped at 4. There's no path mode, scope, folder-only filter or content search. | `file-search.ts:27-32`, `file-search.ts:77`, `main.tsx:798`, `launcher.tsx:17-18` |
| 12 | P2 | **Settings panes open the pane instead of doing the thing.** "wif" finds Network (good: keyword prefix), but Enter only opens Settings. The agents already have typed `join_wifi`, `set_volume`, `set_bluetooth_connection`, `switch_space` and `tile_window`, and the launcher can't call any of them. | `wifi.png`, `settings-app/search.ts:25`, `agents/tools/settings.ts:65,76`, `agents/tools/machine.ts:39,87`, `agents/tools/spaces.ts:27`, `agents/tools/windows.ts:90` |
| 13 | P2 | **No clipboard history, though the compositor is ready for one.** The compositor already serves `ext/wlr data_control` "for clipboard history, wl-copy: the shell's processes only". Nothing in `packages/shell/src` uses it. | `crates/dashi-comp/src/state.rs:142-145`, grep for "clipboard" in `packages/shell/src` returns nothing |
| 14 | P3 | **No aliases, per-command hotkeys or snippets.** The keymap is plain data and could bind an entry, but no rule kind targets a launcher entry. | `keymap.ts:56-161`, `shortcuts.ts:80-81` (only `launcher` itself) |
| 15 | P3 | **None of this is tested.** There are no tests for `search()` ranking, `calculate()`, recents or the selection behavior. The only launcher-adjacent test is the hidden-entries one. | `packages/shell/test/` (only `entries-hidden.test.ts` imports `entries.ts`) |

`notes.png` shows the desktop with no launcher on screen. The brief doesn't say what was typed, so I don't use it as evidence.

## Where Raycast wins today, and where Dashi can win

**Raycast wins today**
- **Ranking:** fuzzy matching ("msg" finds Messages), per-query frecency that learns from picks, and Reset Ranking ([Search Bar](https://manual.raycast.com/search-bar.md)).
- **Actions on every item:** ⌘K opens an action list for the selected item, every action shows its own shortcut, and the list is fuzzy-searchable ([Action Panel](https://manual.raycast.com/action-panel.md)).
- **Aliases and global hotkeys per command,** with alias matches ranked first ([Aliases & Hotkeys](https://manual.raycast.com/command-aliases-and-hotkeys)).
- **Fallback commands** when nothing matches ([Fallback commands](https://manual.raycast.com/fallback-commands)).
- **Clipboard history, snippets, quicklinks,** and a calculator that converts currency and time zones ([PCWorld](https://www.pcworld.com/article/3016518/raycast-is-finally-on-windows-and-it-totally-changed-how-i-use-my-pc.html), [stefanimhoff.de](https://stefanimhoff.de/raycast/)).
- **Navigation keys:** section jumps (⌘↑/⌘↓), page jumps (⌥↑/⌥↓), Esc clears before it closes, and recent files when the field is empty ([Search Bar](https://manual.raycast.com/search-bar.md)).

**Dashi can win**
- **Windows are native.** Raycast's window switching on Windows arrived as an added feature in 2026 ([AlternativeTo](https://alternativeto.net/news/2026/2/raycast-for-windows-supports-script-commands-and-improves-window-switching)), and its tab search needs a browser add-on plus a native host ([Mozilla add-on](https://addons.mozilla.org/addon/raycast-tab-manager/)). Dashi's compositor knows every window, its Space and its state, with no permissions and no lag.
- **One typed action layer for people and agents.** The agent tools (`agents/tools/registry.ts`) already parse and validate arguments for windows, Spaces, Wi-Fi, Bluetooth, volume, power, notes and calendar. The launcher can expose exactly those as commands, with the same consent rules and no extensions to install.
- **Menus are published, not scraped.** Apps publish their menus with shortcuts to the shell (`app-menus/`, `agents/tools/menus.ts:16,34`). Searching the focused app's menu items is a protocol read, not an accessibility scrape. Raycast on the Mac has a menu-item search too, so the edge here is reliability, and that the result can teach you the shortcut.
- **Clipboard and text expansion at the compositor,** with the vault and AT-SPI (`agents/atspi`) able to exclude password fields. No other launcher sits in that layer.
- **Applets.** Applet menu rows have ids and a `select` message (`docs/applets.md`), so a timer applet's "Start 25 min" is a launcher command for free.

## Betterments

1. **Keep the launcher resident and its index cached.** Keep the panel mounted on its own host and show or hide the surface rather than spawning one per open. Load entries once and keep them fresh with inotify on the XDG `applications` directories, resolving icons once. Keep recents in memory. Drop the screen round trip by opening on the last known output and moving if it differs.
   - Why: a launcher I use 200 times a day must open the same fast every time, including the second tap inside 1.5 s.
   - Size: M. Needs: shell, plus mirin (a hide/show surface, or a dedicated warm host per overlay kind).
   - **Recommended.**
2. **Ranking that earns trust.**
   - A subsequence scorer with bonuses for word starts and acronyms ("ss" finds System Settings, "vsc" finds VS Code).
   - Per-query pick memory: after one pick of System Settings for "set", it wins "set" and "se" from then on.
   - Frecency with decay, over everything opened from anywhere (Dock, switcher, files).
   - Drop bare substring matches inside a word for queries under 4 characters.
   - Stop the generic "settings" keyword from flooding results (it matches only when it's the whole query).
   - Demote the Setup Assistant.
   - Size: M. Needs: shell.
   - **Recommended.**
3. **A keyboard contract.**
   - Keep the selection by item id, not index, and reserve the file rows so late results never move the row under the cursor.
   - Esc clears the field, and a second Esc closes.
   - Ctrl+N/P (and Ctrl+J/K) move; Tab and ⇧Tab jump sections; PageUp/PageDown and Home/End work; the selection wraps.
   - ❖1–❖9 picks a visible row, with the digit shown on the selected row's right.
   - ⇧↵ keeps the launcher open after acting.
   - Tests for all of it.
   - Size: S. Needs: shell.
   - **Recommended.**
4. **Windows first, and launching switches.**
   - Open windows are results: title, app icon, and "Space 2" or "minimized" muted on the right.
   - Enter on a running app focuses its last window. ⌘↵ opens a new window.
   - Reuse the switcher's model (`switcher/model.ts`) so the switcher and the launcher agree on names.
   - Size: M. Needs: shell, compositor (already exposes toplevels and activate, `dock/controller.ts:63`).
   - **Recommended.**
5. **An action list on every result.**
   - ❖K, or →, swaps the result list for that item's actions in the same panel. Each action shows its shortcut, and the list filters as you type.
   - Modifiers run actions directly without opening the list: ⌘↵ secondary, ⌥↵ reveal or copy, ⌘C copy path, name or answer.
   - Actions by kind: app (Open, New Window, Quit, Keep in Dock, Set alias, Set hotkey, Reset ranking), window (Switch, Bring here, Tile left/right, Move to Space N, Close), file (Open, Open With, Reveal in Files, Copy Path, Move to Trash), answer (Copy, Paste into the front app).
   - Size: M. Needs: shell.
   - **Recommended.**
6. **The OS as typed commands.**
   - Generate commands from the agent tool catalog (`ToolDef` with `parse`): "vol 30", "bt airpods", "space 3", "tile left", "wifi home", "lock", "dark".
   - Tab moves into an argument chip that `parse()` validates live, so errors show as the row's subtitle.
   - Applet menu rows and the focused app's published menu items join as commands, each with its shortcut shown so I learn it.
   - Same consent: a command that's destructive for agents asks a person too (`force_quit_app`).
   - Size: L. Needs: shell, agents (catalog reuse), applets (v2 menus).
   - **Recommended.**
7. **Calculations you can use.** The answer row becomes selectable, auto-selected when it's the only thing that matched, and Enter copies it. Add units, currency (cached rates, offline-safe), time zones ("3pm PST in Madrid"), date math ("today + 90d") and hex/bin. Skip file search for pure math. Size: S for copy and selection, M for units and currency. Needs: shell (copy through the existing data_control).
8. **Clipboard history in the launcher.** A "clip" prefix, or a ❖V-style hotkey on the same panel, lists recent copies (text, images, files) with a preview on the selected row. Enter pastes into the window that was focused. Pin and delete are actions. It skips copies from password fields (AT-SPI role) and from vault fills. Size: M. Needs: shell, compositor (data_control already present), agents/atspi.
9. **Aliases and per-command hotkeys.** Set them from the action list (an inline key recorder). Aliases match first and show as a small badge on the row. Hotkeys become keymap rules binding `launch:<entry-id>` or `run:<command>`. Size: S/M. Needs: shell (keymap rule kind).
10. **Files that keep up.** Use one persistent LocalSearch connection over D-Bus, not a process per query. Rank by name match first and recency second. Typing "/" or "~/" switches to path mode with Tab completion. Add "in:Developer" style scopes and folder-only results. Opened files count toward frecency, and recent files show when the field is empty. Size: M. Needs: shell.
11. **Snippets at the compositor.** Typed abbreviations expand in any Wayland app, except password fields and terminals by default. Placeholders: date, clipboard, cursor. Manage them from the launcher. Size: L. Needs: compositor (input path), shell, agents/atspi, vault (secret snippets filled without the clipboard).
12. **Fallback to an agent.** When nothing matches, the last row says "Ask an agent: …". It runs with the existing consent sheets, and the result comes back as a row I can act on. Size: M. Needs: agents.

## The beat-Raycast move

**Every verb the OS has, two keystrokes away, learned from my hands.** Today the launcher can only open things. It should be able to do the thing.

Dashi already has a typed, validated, consent-aware catalog of everything the desktop can do: windows, Spaces, tiling, Wi-Fi, Bluetooth, volume, power, notes, calendar, published app menus, applet rows. Agents use it. Put the same catalog in the launcher, with live windows as first-class results, per-query learning, and inline arguments.

Then a three-step task is one breath, with no extension store and no setup. "ff ↵" focuses the existing Firefox window. "tile l ↵" tiles it left. "sp 2 ⇧↵" sends it to Space 2 and keeps the launcher open for the next thing. A Raycast user on Linux can't have this, and on the Mac they need a window-management command plus a browser companion. Here it's the OS.

## Mockup notes

All three are a single panel, 680 × up to 480. The search field row (56 px) is the **only** chrome row: no footer bar, no second header. Hints live on the right of the selected row, and sub-modes show as a chip inside the field row.

**1. Root results, query "ff"** (dark or light glass, radius 16)
- Field row, 56 px: search glyph 20 px; text "ff" at 22 px. No footer.
- Section label "Windows", 22 px, 11 px semibold muted.
  - Row (44 px, selected, kombu fill, white text): Firefox icon 30 px; title "Pull requests · dashiOS", 15 px; muted subtitle "Firefox · Space 2", 12 px. Right side, 12 px at 70% white: "↵ Switch   ⌘↵ New window   ❖K".
  - Row: Firefox icon; "Dashi docs"; subtitle "Firefox · minimized"; right "❖2".
- Section label "Apps".
  - Row: Firefox icon; "Firefox"; alias badge "ff" (rounded 4 px, 11 px, muted outline) after the title; right "❖3".
- Section label "Commands".
  - Row: glyph; "New Private Window"; muted subtitle "Firefox menu · File"; right "⇧❖P" (the shortcut, shown so I learn it).
- Section label "Files" (at most 2 rows here): a file icon, "ffmpeg-notes.md", "~/Developer/notes".
- Digits (❖2, ❖3…) show on non-selected rows only while ❖ is held.

**2. The action list, opened with ❖K on the Firefox window row** (same panel, same height)
- Field row: a chip at the left of the field, 26 px tall, radius 8: Firefox icon 16 px, "Pull requests · dashiOS ›". After it, the placeholder "Search actions". Esc or ⌫ on empty removes the chip and returns to the results.
- Rows (40 px each), title left, shortcut right in 12 px muted mono:
  - Switch to Window, "↵"
  - Bring to This Space, "⌘↵"
  - Tile Left, "⌃❖←"
  - Tile Right, "⌃❖→"
  - Move to Space…, "⌘M" (opens an argument chip)
  - Close Window, "❖W"
  - Quit Firefox, "❖Q", in destructive red text
  - a separator, 1 px, then:
  - Set Alias…, "⌘⇧A"
  - Set Hotkey…, "⌘⇧H"
  - Reset Ranking
- Typing "til" filters the rows to the two Tile rows, keeping their shortcuts visible.

**3. A command with an argument, query "vol"**
- Field row, after Tab on "Set Volume": a chip "Set Volume ›", then an inline argument field showing "30", then a muted suffix "%" inside the same row.
- Result area, one 64 px row: speaker glyph; "Set volume to 30%"; subtitle "MacBook Speakers · now 55%". A 4 px bar under the subtitle shows 55% as a muted fill and 30% as a kombu marker. Right side: "↵ Set   ⇧↵ Set and stay".
- Bad input ("300") turns the subtitle red with the `parse()` message ("volume must be 0–100"), and Enter is disabled.
- Below it, a section label "Outputs" and 44 px rows for each sound output (from `get_sound`). ⌘↵ on one switches the output (`set_sound_output`).
