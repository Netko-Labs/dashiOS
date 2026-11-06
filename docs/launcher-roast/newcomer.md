# Newcomer, accessibility and copy

Perspective: someone who switched from Windows or macOS this week and has never heard the word "launcher". They have no Raycast habits. They want the computer to answer them in their own words and language, and they need to trust it.

## The roast

- The launcher is a search box nobody tells you about. The Setup Assistant teaches you ⌃❖Esc for agents (`setup/pages/agents.tsx:32-36`) but never mentions ❖. The menu bar has no "Search" item (`menus/model.ts:98-111`). The one place that lists ❖Space is the shortcut sheet, and you only get that by holding ❖ for 800 ms (`keymap.ts:62-64`, `sheet.tsx:84`).
- On day one, an empty launcher is an empty pill. There is nothing to suggest, so the list doesn't render at all (`launcher.tsx:112`). A Windows switcher presses ❖ and gets a text field and no Start menu.
- Type "settings" and System Settings isn't in the seven results; type "preferences" and Setup Assistant comes first. The words people use to find settings land them in first-time setup instead.
- Every Settings pane gets the same grey gear and a bare name, so "About" in `set.png` doesn't say what it's about. Apps, panes and the Setup Assistant look like one list of things.
- You can pick German in the Setup Assistant and the launcher still says "Files", because it skips every `Name[de]` (`entries.ts:33-36`). Type "ecran" and you won't find "Écran".
- Orca hears nothing. Metal has no accessibility tree (`docs/design.html:625`). Meanwhile Dashi's agents read other apps' AT-SPI trees every day (`agents/server.ts:70-72`).

## Findings

| # | Severity | What's wrong | Evidence |
|---|---|---|---|
| 1 | P0 | **Screen readers get nothing.** The field, the rows, the selection and the answer have no role or name, and the highlighted row is never announced. A blind newcomer can't use the main way into the OS. Raycast is criticised for the same gap: "the selected result is still not automatically announced by VoiceOver". | `docs/design.html:625` (UI-3: "Metal has no tooltips and no accessibility tree"); `launcher.tsx:93-178` (no a11y props); [nunonuno review](https://nunonuno.micro.blog/2024/12/28/raycast-an-ultimate-macos-launcher.html) |
| 2 | P1 | **Nothing teaches it.** None of the Setup Assistant pages mentions the launcher. The Done page only sums up your choices. There's no menu-bar or Dock entry. ❖Space is listed only on a sheet you reach by holding ❖. | `setup/flow.ts:9`, `setup/flow.ts:42` ("System Settings has everything…"); `setup/pages/done.tsx:26-63`; `menus/model.ts:98-111`; `keymap.ts:62-64`; `sheet.tsx:84` |
| 3 | P1 | **The first-day empty state is blank.** Recents come only from launcher launches (`main.tsx:776-778`), and the list renders only when something matches, so the first ❖ tap shows just the field. Nothing says that it does settings, files or sums. With a history, `empty.png` shows a single "Recent" row (Appearance). | `launcher.tsx:112`, `launcher.tsx:119-123`; `recents.ts:48-52`; `empty.png` |
| 4 | P1 | **Words for settings land on the wrong thing.** System Settings, Setup Assistant and all 20 panes share the keyword "settings" (`entries.ts:186`, `entries.ts:215`; `settings-app/search.ts:39`). Ties go alphabetically (`entries.ts:270`). I ran `search()` with the real pane list: "settings" returns About, Agents, Appearance, Battery & Power, Bluetooth, Date & Time, Desktop & Dock, with no System Settings. "preferences" returns Setup Assistant first. "set" puts Setup Assistant on top because a name prefix outranks a word start (`entries.ts:261-262`). | `set.png`; probe of `entries.ts:254-273` (inference from real keyword tables, not run in the VM) |
| 5 | P1 | **Rows don't say what they are.** Every pane uses `iconPath("settings")` (`settings-app/search.ts:33-35`), but each pane already has its own glyph and tint in Settings (`settings-app/panes.ts:47-66`). Rows show only `entry.name` (`launcher.tsx:139-140`). There's no "Settings" header, no kind label and no subtitle. In `set.png`, "About" and "Agents" could be anything. The Setup Assistant icon is the Dashi bowl (`apps.ts:148`), so it reads as "Dashi". | `launcher.tsx:124-142`; `set.png`, `ter.png` |
| 6 | P1 | **App names and keywords aren't translated.** Localized keys are dropped on purpose (`entries.ts:33-36`, `entries.ts:50`), so a newcomer who picks a language (`setup/flow.ts:26`) still sees and has to type the English `Name=`. `Keywords[xx]` is ignored too. The words for Dashi's own panes and apps exist only in English (`settings-app/search.ts:11-30`, `entries.ts:186-190`). | `entries.ts:33-50`; probe: a `.desktop` with `Name[de]=Dateien` parses as "Files" |
| 7 | P1 | **Matching is literal and unforgiving.** It only lowercases, with no accent folding, no typo tolerance and no matching inside multi-word keywords (`entries.ts:255-264`). In the probe, "ecran" doesn't find "Écran", "fierfox" and "firefx" find nothing, "wi fi" finds nothing, and "mode" can't reach "dark mode". Raycast's root search is fuzzy ("ftime" finds Facetime). | `entries.ts:254-273`; [Raycast manual: search bar](https://manual.raycast.com/v1/search-bar) |
| 8 | P1 | **No results looks like a broken box.** When nothing matches, the list disappears (`launcher.tsx:112`). There's no "No results for…", no "did you mean", no "search files / Software / ask an agent". Raycast offers fallback commands at exactly this point. | `launcher.tsx:112`; [Raycast fallback commands](https://manual.raycast.com/v1/fallback-commands) |
| 9 | P2 | **Failures are silent.** If an app fails to start, it's only written to the log (`apps.ts:288-290`), and the launcher has already closed (`main.tsx:777-779`). If LocalSearch is missing, file search quietly returns nothing (`file-search.ts:6`, `file-search.ts:81`), yet the placeholder still promises "Search apps and files" (`launcher.tsx:98`, `main.tsx:782`). | as cited |
| 10 | P2 | **The math answer is a dead end.** The `= 4` row isn't in the selection and has no `onPress` (`launcher.tsx:68`, `launcher.tsx:114-118`), so in `math.png` Enter does nothing and you can't copy the answer. Output isn't localized: `2^64` shows as `18446744073709552000`. Decimal commas aren't math: "2,5+1" returns null (probe of `launcher-math.ts:23`). | `math.png`; `launcher-math.ts:106-116` |
| 11 | P2 | **Contrast is below Dashi's own rule (CO-6: 4.5:1).** On `empty.png`'s wallpaper, the 11 px "Recent"/"Files" headers (`#1d1d1f99` on `#f5f5f7eb` glass) come out about 4.1:1. White on kombu `#3E8A72` is 4.13:1. A file's folder name on the selected row (`#ffffffb3`) is about 2.9:1. My computation; the glass result depends on the wallpaper. | `launcher.tsx:121`, `launcher.tsx:145`, `launcher.tsx:171`; `dashi-ui/src/theme/palette.ts:52,61,67`; `docs/design.html:373` |
| 12 | P2 | **Text size is fixed.** It's hard-coded at 22/20/15/12/11 px (`launcher.tsx:109-171`), with a fixed 620×440 panel (`launcher.tsx:14`, `main.tsx:763-764`). There's no Accessibility pane or text-size setting (`settings-app/panes.ts:47-66`), so a low-vision newcomer can't make it bigger. | as cited |
| 13 | P2 | **Keyboard and mouse habits from other systems don't carry over.** Only Esc, ↑ and ↓ are handled (`launcher.tsx:104-108`): no wrap-around, no Tab, no Page or Home keys. Esc closes even when you've typed something, rather than clearing first. Rows have no hover state, though Metal supports `hoverBackgroundColor` (`dashi-ui/src/sidebar.tsx:41`), and hovering doesn't move the selection, so Enter opens the green row rather than the one under the pointer. | `launcher.tsx:104-108`, `launcher.tsx:125-137` |
| 14 | P2 | **The words switchers use, and actions, aren't there.** "control panel" (Windows) and "brightness" find nothing (`settings-app/search.ts:14` has no brightness). "lock" opens the Lock Screen settings pane, not the lock. "shut down" and "restart" find nothing, though the Dashi menu has them (`menus/model.ts:105-109`). The first-party apps are well covered: "finder", "explorer" and "trash" find Files, and "app store" and "uninstall" find Software (`first-party.ts:114`, `first-party.ts:129`). | probe; as cited |
| 15 | P3 | **Typing Chinese or Japanese isn't proven.** The compositor offers text-input-v3 and input-method (`crates/dashi-comp/src/handlers/text.rs:24-33`), and Metal's toolkit binds text-input-v3. But nothing in the session starts an input method (no ibus/fcitx references), and `parent_geometry` only looks at regular windows (`text.rs:49-55`). The candidate popup for the launcher's overlay surface probably lands in the wrong place. Inferred; needs a VM check. | as cited |

## Where Raycast wins today, and where Dashi can win

**Raycast wins today**
- Fuzzy root search over titles, subtitles, keywords and aliases ([manual](https://manual.raycast.com/v1/search-bar)). Dashi matches literally.
- No-results fallbacks you can customise (search the web or your files with what you typed) ([manual](https://manual.raycast.com/v1/fallback-commands)). Dashi shows nothing.
- A real onboarding flow in v2 ([changelog](https://www.raycast.com/changelog/macos-beta)), and macOS gives it some VoiceOver support, uneven as it is ([review](https://nunonuno.micro.blog/2024/12/28/raycast-an-ultimate-macos-launcher.html)). Dashi has no accessibility tree at all.
- Results say what they are (subtitles, kinds), and Enter on any result does something.

**Dashi can win**
- **It is the OS.** It can teach the launcher in the Setup Assistant, put it in the menu bar, and answer "wi-fi" with the actual Wi-Fi switch, not a link. Raycast is a guest app on macOS.
- **Trust is simple and true.** Everything is local: file search goes to the on-device LocalSearch index with the query as a bound parameter (`file-search.ts:1-6`, `file-search.ts:31-33`), and history is a 0600 file (`recents.ts:68`). Dashi can say so in one line, and has no account or cloud to explain.
- **Language is set once, system-wide.** The Setup Assistant already asks for it, and the `.desktop` files already carry the translations. Dashi only has to stop throwing them away.
- **Accessibility as an OS service.** Dashi already reads AT-SPI for agents. Publishing its own tree in Metal fixes the launcher and every Dashi app at once.
- **Agents with consent built in** (`docs/secrets.md`, consent sheets). "Make the text bigger" can be done, with a consent prompt that names what changes, instead of a chat window.

## Betterments

1. **Teach it on day one** *(Recommended)*. The Setup Assistant's Done page gets one row: "Tap ❖ to find anything", plus a "Try it" button that opens the launcher. The Dashi menu gets "Search…" with ❖Space shown. A short-lived menu-bar hint appears the first three times a window opens and the launcher hasn't been used yet. *Why:* a person can't love a feature they never find. *S.* Shell (setup, menus).
2. **A teaching empty state** *(Recommended)*. With no history: a "Try" section of four example rows, each a real working action (an app, a setting, a sum, a file), plus "All apps", which lists every app A–Z (Windows switchers expect a Start menu). Once there's history: Recent first, with "All apps" kept as the last row. *Why:* it answers "what is this for?" without a tutorial. *S–M.* Shell.
3. **Rank by what people mean** *(Recommended)*. Give "settings", "preferences" and "control panel" an exact-intent boost to System Settings. Drop the generic shell keywords from Setup Assistant (`entries.ts:215`) and let it answer to "setup", "welcome" and "first run" only, with a subtitle "Run first-time setup again". Panes shouldn't win on the bare word "settings". Add tests: there are no launcher-ranking tests, only `test/entries-hidden.test.ts`. *Why:* the obvious word should give the obvious result. *S.* Shell.
4. **Say what each row is** *(Recommended)*. Use each pane's own glyph and tint (`panes.ts:47-66`). Add a muted subtitle on the same line, as file rows already do (`launcher.tsx:167-173`), for example "About · Settings: version and hardware" or "Network · Settings: Wi-Fi, Ethernet, VPN". When results mix, use section headers (Apps, Settings, Files, Answer). *Why:* a newcomer can't tell apps from settings from setup by name alone. *S.* Shell.
5. **Your language, your spelling** *(Recommended)*. Read `Name[xx]`/`Keywords[xx]`/`GenericName[xx]` for the language the person picked, falling back to the default, and also match the English name. Fold accents and case (NFD with marks stripped). Add typo tolerance (an edit distance of 1 for queries of 4+ characters) and matching inside multi-word keywords. Ship translations of the pane and first-party keywords. Add pinyin and romaji matching later. *Why:* a French newcomer should find Écran by typing "ecran" or "screen". *M.* Shell, plus translation files.
6. **Accessible launcher** *(Recommended)*. Metal gets a minimal AT-SPI tree: the field is a combobox, the results a listbox, and each row an option named "Network, Settings pane, 1 of 3". The selected option is announced as you arrow, and the answer row reads "equals 4, Enter copies". Add a text-size setting (an Accessibility pane) that the launcher honours: row heights grow and the panel grows to 600 px. Fix CO-6 contrast: muted headers at ≥4.5:1, and a darker kombu for selected rows or dark text on a lighter tint. *Why:* the launcher is the front door, and today it's locked for screen-reader users. *L* (the Metal a11y tree), *S* (contrast). Mirin and shell.
7. **No results that help.** Show "Nothing called 'fierfox'." Then rows for: "Did you mean Firefox?", "Search files for 'fierfox'", "Find 'fierfox' in Software", and, only if an agent is set up, "Ask <agent> to…" with a muted note "Sends what you typed to <agent>". *Why:* a dead end teaches people to stop trying. *S–M.* Shell, agents.
8. **Errors that show.** If an app fails to start or exits within 2 s, a notification says "Couldn't open Firefox" with "Try again" and "Show details". If file search is unavailable, the placeholder changes to "Search apps and settings", and a row typed after 2+ characters says "File search is off — Set up". *Why:* silence reads as "this computer is broken". *S.* Shell.
9. **Make the answer useful.** The answer row is selectable and is the default when present: Enter copies it, and a "Copied" confirmation shows in place. Format output for the region (grouping, decimal separator) and accept a decimal comma in comma locales. *S.* Shell.
10. **Keyboard, mouse and Esc that match habits.** Hover highlights the row. Selection wraps at both ends, and ⌃N/⌃P and Page keys work. The first Esc clears typed text and the second closes. A right-aligned "↵ Open" hint sits in the field row (no new bar). *S.* Shell.
11. **Actions newcomers expect.** Lock Screen, Sleep, Restart…, Shut Down…, Log Out… and Take Screenshot become launcher entries that run the same actions as the Dashi menu (`menus/model.ts:105-110`; the ones marked … keep their confirmation). Add "brightness" and "control panel" synonyms. *S.* Shell.
12. **Live controls in the row.** For a setting that has a state (Wi-Fi, Bluetooth, Dark Mode, Do Not Disturb, Low Power), the row shows the switch on its right and Space flips it. Enter still opens the pane. Dashi owns Settings and Control Center, so this is a call into its own stores, not scripting. *M.* Shell.
13. **Say what it searches.** One muted line in the empty state's header row: "Searches this computer only". A pane in Settings lists what the launcher looks through (apps, settings, files in Home via LocalSearch) and offers Clear history. *S.* Shell, settings.
14. **Typing Chinese, Japanese or Korean in the launcher.** The session starts the configured input method. Place the candidate popup for overlay surfaces using the field's cursor rectangle (`text.rs:49-55`). Add an input-method choice to Keyboard. Test it in the VM with fcitx5 or IBus. *M.* Compositor, session, settings.

## The beat-Raycast move

**A launcher that answers in plain words, in your language, out loud.** You type "wifi" (or "wlan", or "réseau") in your own language, misspelled or not. The row reads "Wi-Fi · On · Home-5G", with a live switch you flip with Space. Orca says "Wi-Fi, on, setting, 1 of 2". The header says "Searches this computer only", and that's true. A power user's launcher makes you learn its vocabulary. This one learns yours, and only an OS that owns Settings, the compositor and the accessibility bus can do it. Raycast can't localize macOS app names it doesn't own, can't drive every system setting from a row, and on its own platform still doesn't announce the selection.

## Mockup notes

All three keep the launcher's one chrome row: the 56 px field. Hints live inside that row or inside list rows, never in a footer bar. Panel: 620 px wide, 16 px radius, light glass `#f5f5f7eb`, 6 px list padding, 44 px rows, 22 px section headers (11 px semibold, ink at ≥4.5:1, e.g. `#1d1d1fb8`).

**1. First tap ever (empty state that teaches).**
- Field row, 56 px: 20 px search glyph, then placeholder "Type an app, a setting, a file, or a sum" at 22 px. Right-aligned in the same row, a muted "❖ opens this anywhere" at 12 px.
- Header, 22 px: "Try" on the left; on the right, a muted "Searches this computer only" at 11 px.
- Four rows, 44 px each. Each has a 30 px icon, a 15 px name, a 12 px muted subtitle on the same line, and a right-aligned 11 px kind pill (6 px radius, `#1d1d1f12`):
  1. Network glyph (blue tint): "Wi-Fi", subtitle "· turn it on or off", pill "Setting"
  2. Files icon: "Files", subtitle "· your documents and downloads", pill "App"
  3. Calculator glyph: "15% of 80", subtitle "· = 12", pill "Answer"
  4. Contrast glyph (indigo): "Dark Mode", subtitle "· Appearance", with a live switch instead of a pill
- Last row, 44 px: grid glyph "All apps", subtitle "· every app, A to Z", right "→".
- Row 1 is selected: kombu fill, white text, and a right-end "↵ Try".
- Total height: 56 + 6 + 22 + 5×44 + 6 = 310 px.

**2. "set", results that say what they are.**
- Field row: "set". Right-aligned "↵ Open" at 12 px muted.
- Header "Top hit".
- One row, selected: System Settings icon, "System Settings", subtitle "· all your settings", pill "App".
- Header "Settings".
- Four rows, each with its pane's glyph and tint (not the gear):
  1. "Setup Assistant", subtitle "· run first-time setup again", bowl icon, pill "Setup"
  2. "Language & Region", subtitle "· language, formats"
  3. "Date & Time", subtitle "· clock, time zone"
  4. "Network", subtitle "· Wi-Fi, Ethernet, VPN"
- The subtitle is 12 px `#1d1d1fb8`. On the selected row, it's white at full opacity, not 70%.
- Height: 56 + 6 + 22 + 44 + 22 + 4×44 + 6 = 332 px.

**3. "fierfox", no results that help (with an agent set up).**
- Field row: "fierfox".
- Header: "Nothing called “fierfox”".
- Rows:
  1. Selected: Firefox icon, "Did you mean Firefox?", pill "App"
  2. Search glyph: "Search files for “fierfox”", pill "Files"
  3. Software icon: "Find “fierfox” in Software", pill "Install"
  4. Shiso sparkle: "Ask Claude about “fierfox”", subtitle "· sends what you typed to Claude", pill "Agent" in shiso tint
- Variant when file search is unavailable: row 2 becomes a muted info glyph, "File search is off", subtitle "· set up in Settings".
- Height: 56 + 6 + 22 + 4×44 + 6 = 266 px.
