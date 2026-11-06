# Visual and interaction design

**The roast**

- It is a 620 px pale bar with a heavy green slab under it. Take away the kombu and the bowl icon, and nobody could tell it is Dashi and not a 2015 Spotlight clone.
- Settings has twenty hand-drawn pane glyphs (`settings-app/panes.ts:47-66`), and the launcher stamps the same gray gear on every one of them (`settings-app/search.ts:34`). In set.png, six of seven rows look the same.
- The loudest thing on screen is the selection: a 44 px saturated slab with white 15 px text at 4.13:1, below Dashi's own AA rule (CO-6). It is loud and still fails contrast.
- The math answer ("= 4", math.png) is the one result you can't select, copy or press Enter on. Typing nonsense makes the panel shrink back to a bare field and say nothing.
- Nothing moves, so everything jumps: the panel snaps between 115, 137, 159 and 379 px tall while you type, and the file rows pop in 120 ms later underneath.
- It knows the whole OS and shows none of it: no running dot, no live Wi‑Fi state, no previews, no "this is a Settings pane", no keys.

## Findings

| # | Severity | What's wrong | Evidence |
|---|---|---|---|
| 1 | P1 | **One gear for every Settings pane.** Every pane entry gets `iconPath("settings")`, so System Settings, About, Agents, Appearance, Battery & Power and Bluetooth look the same, and System Settings can't be told from its own panes. Settings' sidebar already has a glyph per pane. | set.png (rows 2–7); `settings-app/search.ts:34`; glyphs in `settings-app/panes.ts:47-66` |
| 2 | P1 | **The selection fails contrast and shouts.** Every row selects with a full `colors.selection` (#3E8A72) fill and white text hardcoded at 15 Regular. White on kombu is 4.13:1, under CO-6's 4.5. A 44 px slab that jumps on every keystroke is the opposite of "Calm by default". | ter.png, set.png; `launcher.tsx:135,140,162,168`; `dashi-ui/src/theme/palette.ts:67,102`; design.html CO-6 |
| 3 | P1 | **The math answer is a dead row.** It is drawn above the results, but `selected` indexes only `results` and `files`, so it can't be selected or highlighted, and Enter does nothing when it is the only row (`pick(0)` finds no entry). It has no icon, no "Copy" affordance, and its type (20 SemiBold) is unlike any other row. | math.png; `launcher.tsx:69-74,114-118` |
| 4 | P1 | **There is no grouping or kind label while typing.** Section headers exist only for "Recent" and "Files". Apps and Settings panes interleave unlabeled ("Setup Assistant", "System Settings", "About"…), and a bare "About" or "Agents" says nothing about what opens. VS-2 already allows a muted suffix on the same line, which this list doesn't use. | set.png; `launcher.tsx:119-147`; ranking tie-break `entries.ts:270` |
| 5 | P2 | **The panel's height jumps on every keystroke, with no motion.** The panel hugs its content (137 px in empty.png, 379 px in set.png, 159 px in ter.png, 115 px in math.png), and files arrive after a 120 ms debounce plus the query, so a second reflow adds a header and rows under the apps. Opening and closing are instant pops. The design's own open question lists overlay open/close as unanimated. | screenshots; `launcher.tsx:20,51-65,80-91`; design.html Motion, "Open and close animation" |
| 6 | P2 | **The empty state is a bare field.** The placeholder is set (`launcher.tsx:98`), but empty.png shows only a caret, so in practice nothing says what to type. With no history (first boot), `count === 0` hides the whole list and the launcher is a lone 56 px bar. The one "Recent" row is a Settings pane drawn as a gear. | empty.png; `launcher.tsx:98,112`; `recents.ts:17` |
| 7 | P2 | **No results means nothing at all.** No "No matches", no fallback rows (search files, ask an agent, open Settings search). The panel just collapses. That breaks PA-7 in spirit ("says what goes here"). | `launcher.tsx:112` (inferred from code, no screenshot) |
| 8 | P2 | **The type scale is off Dashi's scale.** The field is 22 and the answer 20 SemiBold, neither on TY-1. Row labels are 15, which TY-1 reserves for an empty state's title. Only the 11 SemiBold section heads and 12 folder text are on scale. | `launcher.tsx:109,116,121,140,168,171`; design.html TY-1 |
| 9 | P2 | **Measures are off the system.** The panel radius is 16, which RA-1 has only as the Large window choice (a sheet is 12). The field row is 56, which LA-1 doesn't list. The rows are 44 with 30 px icons, sized like a settings row rather than a list. The nesting does work: 16 outer − 6 padding = 10 row radius. | `launcher.tsx:14,85,93,113,134`; design.html RA-1, LA-1 |
| 10 | P2 | **Rows have no hover or pressed state.** Rows set `onPress` but no `hoverBackgroundColor`, though SidebarItem uses one. Hovering doesn't move the selection, so mouse and keyboard disagree about what Enter will open. | `launcher.tsx:125-138`; `dashi-ui/src/sidebar.tsx:41`; design.html UI-4 |
| 11 | P2 | **Rows don't show live OS state.** The Terminal row shows no sign it is already running, though the Dock has a 4 px running dot. "wif" → "Network" shows no network name or on/off. No row shows a shortcut glyph or what Enter will do. | ter.png, wifi.png; `launcher.tsx:139-140`; design.html Dock "running dot 4" |
| 12 | P3 | **Noise matches get the same weight as real ones.** "ter" puts "Battery & Power" in row 2 (a substring hit inside a word, score 4). Nothing marks matched letters, so the reason it is there is invisible. | ter.png; `entries.ts:263` |
| 13 | P3 | **Hex in the shell.** `"#ffffff"`, `"#ffffffb3"` and `"#00000000"` are inline, which breaks CO-5. There is no `onSelection` ink token, so dark and light can't tune it. | `launcher.tsx:135,140,162,168,171` |
| 14 | P3 | **Materials.** `colors.launcher` is 92% paper with no blur (DE-4 accepts this for now). The border is `dockBorder` (white at 45%), which disappears on light glass. In empty.png the wallpaper's purple tints the panel lavender, so the hairline does nothing in light mode. | `launcher.tsx:86-89`; `palette.ts:57,61`; empty.png |
| 15 | P3 | **Placement is a fixed 120 px under the menu bar.** That is about 16% down on this 937 px screen (panel top y=148 in every screenshot), and proportionally high on a tall 4K or portrait screen. It opens on the person's screen (pointer, else focus), which is correct. The surface is a fixed 620×440 box (`main.tsx:763-764`), so the "click outside" catcher (`launcher.tsx:79`) only covers that box (inferred). | `main.tsx:756-771`; `active-screen.ts:1-5` |

## Where Raycast wins today, and where Dashi can win

**Raycast wins today**
- A row carries information: an icon, a title, a subtitle, and accessories on the right (a kind label, tags, dates). Every row also has an action list (⌘K) for things beyond the default. ([action panel](https://manual.raycast.com/action-panel.md), accessory API per a [third-party reference](https://mintlify.wiki/SuperCmdLabs/SuperCmd/api/components))
- Density choice: Compact and Expanded window modes. ([settings](https://manual.raycast.com/settings.md), [ghacks on the new UI and Compact Mode](https://www.ghacks.net/?p=179853))
- Previews: list items can open a detail side panel. Grids for images and clipboard items.
- Theming per light and dark mode, through Theme Studio. ([themes](https://manual.raycast.com/themes.md))
- Polish in the basics: smooth resizing, a "no results" fallback, match emphasis, and the keys shown for every action.

**Where Dashi can win** (it draws the compositor, the Settings, the Dock and the agents)
- **Rows that are the thing, not a link to it.** Settings, Wi‑Fi, Bluetooth, Dark Mode and volume could be live controls right in the row, because the shell owns them. Settings agent tools already exist (`agents/tools/settings.ts`).
- **Real window thumbnails and running state** from its own compositor (Dock dot, Desktop number), with no screen-recording permission dance. The compositor-side capture is inferred from `screen-capture.ts` and `agents/tools/windows.ts`.
- **One visual language with the OS.** The same pane glyphs as Settings, the same Shapes, kombu for "yours", shiso for "an agent will do this". Raycast's colors are its own app's, not the OS's.
- **Hand-off to an agent drawn in shiso**, with the consent sheet the OS already has. No other launcher can show who is acting in a system-wide color.
- **Motion on the compositor's curves**, honoring the system Reduce Motion (`settings.ts:41`) from one switch.

## Betterments

1. **Recommended. Give each Settings pane its own glyph.** Draw `PaneInfo.glyph` on a neutral ink tile with Dashi's icon recipe. It stays neutral, not Apple's tints (CO-4), until a Dashi-made tint list exists. *Why:* you find the row by shape before you read it, and System Settings stops looking like its own children. *Size:* S. *Needs:* shell (`settings-app/search.ts:33-35`, a tile renderer in @dashi/ui).
2. **Recommended. A calmer selection that passes contrast.** Keep kombu as "selected" (CO-1), but draw a 14% kombu wash behind ink text (11.99:1), a 3 px kombu bar inset at the row's left edge, and the icon unchanged. Use full kombu only for the pressed instant. If the owner wants to keep the full fill, add a `selectionStrong` token at #2F6F5A (white 5.93:1, the mark's own gradient end). Either way, add `onSelection` and `selectionWash` tokens and drop the inline hex. *Why:* the eye goes to the result, not the slab, and the text is readable. *Size:* S. *Needs:* dashi-ui palette, shell.
3. **Recommended. The answer becomes the first row.** The math row is selectable, highlighted like any row, and has a calculator-glyph icon. It shows `2+2` muted on the left, **4** at 15 SemiBold on the right, and a "Copy ↩" shortcut glyph. Enter copies, and ❖Enter opens Calculator with the expression. *Why:* the most useful row today is the one you can't use. *Size:* S. *Needs:* shell (clipboard from the app kit).
4. **Recommended. A kind label on the same line, then grouping.** Right-aligned 11 px muted text ("Settings", "App", "Folder") on every row, plus ≤12 px matched-letter emphasis (SemiBold, not color). Once two or more kinds show, group them under the existing 22 px 11 SemiBold heads: Top hit, Apps, Settings, Files. *Why:* "About" stops being a riddle. It also follows VS-2 (a suffix on the same line, never a second line). *Size:* S. *Needs:* shell.
5. **Recommended. Live rows.** The selected row may show one control at its right end, in the same 40 px height. Network shows "Home‑5G" muted and a Switch. Bluetooth shows "AirPods · 80%". Appearance shows a Light/Dark segmented control. Battery shows "64% · 3 h left". A running app shows the Dock's 4 px dot at the icon's bottom and "2 windows". Space toggles the control and Enter opens the pane. *Why:* half the "settings" searches are "turn X on". Raycast can't own your Wi‑Fi switch. *Size:* M. *Needs:* shell (control-center state, wifi/, bluetooth/), @dashi/ui Switch moved out of `wifi/switch.tsx` (UI-1).
6. **Recommended. Motion that explains, and no jumps.** Open: 160 ms fade from 0.96 scale to 1.0 on ease-out cubic, with the field ready on frame 1. Close: 120 ms fade. Height changes animate over 120 ms. File rows reserve their slot and fade in, without pushing app rows. Opening a result: the selected row's icon flies to its Dock tile or window (the same flight as minimize, 300 ms, MO-1), so you see where it went. Everything is off with Reduce Motion. *Why:* it should feel like one object, not a re-laid HTML list. *Size:* M. *Needs:* mirin (native opacity/transform transitions, MO-3: no React timers), compositor (icon flight), shell.
7. **Get onto Dashi's measures.** Field row 48 at 17 px text (or 20 if TY-1 gains one launcher size: add it to TY-1, don't invent it ad hoc). Rows 40 with 28 icons. Panel radius 12 (a sheet's), list padding 5, row radius 7 (a control's), so the corners nest per RA-1. Labels 13, kind label and folder 11–12. Eight rows fit where seven did, in less height. *Why:* the launcher stops looking imported. *Size:* S. *Needs:* shell, design.html (TY-1 and LA-1 rows for the launcher).
8. **A real empty state.** With nothing typed, the placeholder must render (fix in Metal or draw it as muted Text). Below it: "Recent" (up to 6), then a single row of 4–6 suggested settings/actions as 28 px pills (Dark Mode, Do Not Disturb, Lock Screen, Screenshot) in `button` fill. On first boot it shows no Kombu (system chrome is off-limits for Kombu), just the suggestion pills and one muted line, "Type an app, a setting, a file, or a sum." *Why:* the first open teaches the vocabulary. *Size:* S. *Needs:* shell, mirin (placeholder while focused).
9. **No results, with a way forward.** A single row "No matches for 'xyzq'" in muted 13. Under it, fallbacks as normal selectable rows: "Search files for 'xyzq'", "Ask an agent…" (shiso glyph, shiso only on that glyph, CO-3), "Search Settings". *Why:* a dead end is the worst state for a launcher. *Size:* S. *Needs:* shell, agents.
10. **Hover moves the selection.** Pointer-over sets `selected`, and `hover` wash (`palette.ts:58`) shows on non-selected rows only until the keyboard is used again. *Why:* one cursor, one truth about what Enter opens (UI-4). *Size:* S. *Needs:* shell.
11. **An inline detail drawer instead of a side pane.** ⇥ or → on a row expands that row in place to 120 px. A file gets a Preview thumbnail (96 px) plus size, modified date and folder in 11 muted. A window gets a live compositor thumbnail. A setting gets its 2–3 rows from the registry (settings roast's "every setting addressable", `docs/proposals.html:500`). ← collapses it. No footer bar, no split view. *Why:* previews without making the panel twice as wide or adding a second chrome row. *Size:* M–L. *Needs:* shell, compositor (thumbnails), settings registry.
12. **Per-row actions on the row, not in a footer bar.** On the selected row's right end, show up to two Shortcut glyph chips ("↩ Open", "❖↩ Show in Files" / "⌥↩ New Window"). ❖K opens the full list as a standard PopupMenu anchored to the row (PA-9). No permanent footer (VS-3). *Why:* the keys are discoverable without Raycast's action bar. *Size:* S–M. *Needs:* shell, @dashi/ui Shortcut, PopupMenu.
13. **Placement and materials.** Top at about 20% of the screen's usable height, clamped to a minimum of 96 px under the menu bar. A hairline from `separator` instead of `dockBorder` in light mode. Once the compositor blurs, drop the glass to about 80% plus blur. Size the surface to the full screen (a transparent click catcher) so a click anywhere closes it. *Why:* the panel sits where the eye rests on any screen, and its edge reads on pale wallpapers. *Size:* S, M for blur. *Needs:* shell, compositor (blur pass, input region).

## The beat-Raycast move

**The answer is in the row.** Type "wif" and the Network row shows your network and a switch you flip with Space, without opening anything. Type "dark" and you get a Light/Dark control. Type "ter" and Terminal shows its running dot and "2 windows", and → slides in live thumbnails of them. Each row is drawn in the same glyphs, Shapes and kombu as the OS around it. When the OS can't answer, the last row is "Ask an agent…" in shiso, so it is always clear who will act. Raycast has to open a view or run a command for this, because it is an app on someone else's OS. Dashi's launcher is a window into the system's own state.

## Mockup notes

**1. "wif", the live row** (panel 620 wide, radius 12, glass `launcher`, 1 px `separator` edge, shadow xl, top at 20% of the screen)
- Field row 48 tall: search glyph 18 muted at x=16, text 17 Regular ink at x=44, "wif" with a caret. Then a 1 px separator.
- List padding 5. Section head 22 tall, "Settings", 11 SemiBold muted at x=12.
- Row 1 (selected), 40 tall, radius 7, fill kombu 14% wash plus a 3×20 kombu bar at x=0, vertically centered:
  - Network glyph on a 28 ink tile (radius 6.7).
  - "**Wi**‑Fi" 13 ink, with the matched letters SemiBold.
  - Muted 12 "Network · Home‑5G" after an 8 gap.
  - Right end: a Switch (on, kombu) at 36×20, then the chips "Space Toggle" and "↩ Open" as 11 muted Shortcut glyphs.
- Row 2, 40 tall, unselected: Network glyph tile, "Network" 13, right-aligned "Settings" 11 muted.
- Section head "Files". Row 3: a folder icon 28, "wifi-notes.md" 13, muted 12 "~/Documents", right-aligned "Edited today" 11 muted.
- Total height about 48+1+5+22+40+40+22+40+5 = 223.

**2. "2+2", the answer row**
- Same field. No section head.
- Row 1 (selected, wash), 40 tall: a calculator glyph tile 28, "2 + 2" 13 muted. Right-aligned: "= 4" at 15 SemiBold ink, then the chip "↩ Copy".
- Row 2: "Open in Calculator" with the Calculator icon, chip "❖↩".
- If files match, they come below under "Files". Panel about 140 tall.

**3. Empty, first boot** (no recents)
- Field row 48 with placeholder "Search apps, settings, files" in 17 muted, visible while focused.
- Separator. Padding 10 12.
- One line of 26 px choice pills (radius 13, `button` fill, 12 Regular ink, glyph 14): Dark Mode · Do Not Disturb · Screenshot · Lock Screen · System Settings. ←/→ move between them and the selected pill takes the kombu fill (as choice pills do).
- One line 11 muted under them: "Type an app, a setting, a file, or a sum. ❖K for actions."
- No Kombu (system chrome). Panel about 110 tall. Opening is a 160 ms fade and scale from 0.96, and nothing animates with Reduce Motion.
