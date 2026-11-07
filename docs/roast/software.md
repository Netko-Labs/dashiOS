# Software

**The roast**

- Dashi wrote its own one-line pitches for every recommended app ("Plays almost any video or music file"), then threw them away so Flathub's "VLC media player, the open-source…" could get cut off mid-word on the very first card (`recommended.tsx:41`, `src/software/recommended.ts:16`; software.png, VLC and mpv cards).
- A 40 KB menu-bar applet that wants to read the battery gets a full consent sheet. A Flatpak that can read your whole home folder and use the camera gets a grey "Get" pill and nothing else. The trust model only shows up for the small stuff.
- The sidebar says **43** updates (software.png), and the app is the only place that will ever tell you. Close the window and the updates go quiet until you think to look again.
- "Website" on an app page is plain text you can't click (`app-page.tsx:47`, rendered by `Fact`, `app-page.tsx:21-35`). It's a store that tells you where the shop is but won't open the door.
- The toolbar reads "Software / Discover" on two lines (software.png), so the window tells you twice where you are: once in the title stack and once with the green sidebar row right under it.

**Findings**

| # | Severity | Area | What's wrong | Evidence |
|---|---|---|---|---|
| 1 | P1 | Trust / permissions | An app page never shows what the Flatpak can do (files, devices, network, background). Install is one click with no permissions, no size check and no proprietary or EOL warning before it starts. Applets, which are far less powerful, get a full consent sheet. | `AppDetails` has no permission field (`src/software/flathub-types.ts:37-51`); `install` goes straight to the queue (`view.tsx:91`, `store.ts:129`); compare `src/applets/consent-sheet.tsx` |
| 2 | P1 | Updates | Nothing checks for updates or tells you about them unless the window is open. The check runs once, at launch (`view.tsx:63-65`). The only other callers are the agent tools. 43 updates were waiting in the VM. | `view.tsx:63-65`; grep of `src/` finds `flatpakUpdates` only in `src/agents/desktop/software.ts`; software.png badge "43" |
| 3 | P1 | Offline / loading | Discover hides "Recommended for Dashi" while Flathub loads and when Flathub fails, even though that list is local and the code comment says it "needs nothing from the network". Offline with nothing cached, the person gets an empty "You're offline" page instead of the nine apps Dashi picked. | `discover.tsx:48-49` return before `RecommendedCards`; `recommended.tsx:51` |
| 4 | P1 | Chrome | The toolbar uses a two-line title ("Software" over "Discover"), which breaks the owner's one-row rule. The subtitle only repeats the selected sidebar row. On an app page the subtitle is `""`, so the title drops to one line and the stack changes height from page to page. | software.png; `view.tsx:225`, `pageLabel` returns `""` for apps `view.tsx:46-47`; `dashi-ui/src/window.tsx:102-110` |
| 5 | P1 | App page | The app page has no release notes ("What's new"), no install count (`installsLastMonth` is parsed and never shown), no ratings or reviews, and a "Website" you can't click. `releases` is read only for the newest version number. | `app-page.tsx:39-52`; `src/software/flathub-parse.ts:77-84`; `flathub-types.ts:15` |
| 6 | P1 | Progress / cancel | You can only cancel from the app page. Busy pills on cards, Installed rows and Updates rows show progress but give no way to stop. "Update All" for the system can't be cancelled from the UI at all, even though the queue supports it. | `parts.tsx:94` ("stopping it is on the app's page"); `installed.tsx:45-49`; `updates.tsx:37-45,159`; `queue.ts:51-59` |
| 7 | P2 | Updates list | System updates show 8 packages, then "and 35 more" as dead text that can't be expanded. Apps' "Update All" is a plain button, but the system's "Update All" is primary and opens a sheet without an ellipsis. | `updates.tsx:22,161-184,159,195-201` |
| 8 | P2 | Copy | Raw tool output reaches people: the failure sheet prints up to three `flatpak` error lines, and "Flathub didn't answer" shows `state.message` ("Flathub gave an unexpected answer (…)"). Buttons that ask first ("Remove", "Update All") have no ellipsis, while the menu's "Remove…" does. "No Results" is Title Case next to "No apps installed yet". | `src/software/flatpak-parse.ts:157-165`; `sheets.tsx:60`; `states.tsx:22-23`; `installed.tsx:54,83`; `app-page.tsx:72`; `listing.tsx:53`; `menus.ts:66` |
| 9 | P2 | Color tokens | The Games category tile and the letter-icon tints use shiso `#6E56CF`, which the brand reserves for "agents, and only agents". The verified badge is a hard-coded blue `#3b8fd0` that isn't a token. Dark-mode pill ink is a hard-coded `#7fd1b2`, picked by an identity check against `darkColors`. | `glyphs.ts:50`; `parts.tsx:32,56,101` |
| 10 | P2 | Discover | Discover has one layout repeated four times: a 2-column card wall with a heading and subheading. Nothing is featured, there's no screenshot anywhere, and sections stop at 6 with no "See all". Flathub's `recently-added` collection is wired up and unused. | software.png; `discover.tsx:14-20,58-65`; `src/software/flathub.ts:20` |
| 11 | P2 | Layout at size | The card grid is always 2 columns. On a large window each card becomes a ~700 px strip with the Get pill far from the name; on a small one `fitText` guesses at "half the font size per character" and cuts summaries early (VLC and mpv in software.png have room left over). | `cards.tsx:68`; `format.ts:48-54`; software.png |
| 12 | P2 | Performance | Every card, row and pill subscribes to the whole store. A progress tick, which arrives on every chunk of terminal output, re-renders all 24–48 cards in a listing. Each Updates row also fetches the full app details (two HTTP calls) just for its icon. | `cards.tsx:13-17`; `store.ts:92-95`; `queue.ts:71-74`; `updates.tsx:52`; `hooks.ts:56-71`; `flathub.ts:96-107` |
| 13 | P2 | Keyboard / menus | There's no Back command or shortcut, no way to move through the grid with the keyboard, and no Edit menu (the Applet Store gets one by default, applet-store.png). ❖F is implemented by remounting the search field with a new `key`. | `menus.ts:57-87`; `view.tsx:128,199` |
| 14 | P2 | Remove | Remove promises "Its settings and data stay" but never lets you choose to delete them, which is the most common reason for removing an app. | `sheets.tsx:20` |
| 15 | P3 | Gallery | Screenshots: no arrow keys, no full-size view, no hover state on thumbnails, and a grey "Loading…" word in place of a 320 px image. | `gallery.tsx:32-36,46-63` |
| 16 | P3 | Cards | The developer line uses `textDisabled` for text that is live and readable, so "VideoLAN et al." looks greyed out (software.png). The card and the Get pill are nested press targets. | `cards.tsx:56-60,29,62` |
| 17 | P3 | Motion | The indeterminate progress bar steps on a 120 ms `setInterval`, one timer per bar. It looks jerky and ignores Reduce Motion. | `parts.tsx:65-90` |
| 18 | P3 | Sync I/O | Each Installed row makes up to 5 `existsSync` calls while rendering, to find its icon. | `installed.tsx:22`; `format.ts:30-41` |

**Improvements**

1. **Recommended.** *What:* Add a permissions block to the app page ("It can: read and write your files · use the camera · run in the background"), worked out from the Flatpak metadata (the summary endpoint already fetched in `flathub.ts:101` is a likely source; I haven't checked that the API returns it). Write it in the same plain-language lines as `@dashi/applet`'s `describePermission`. When an app asks for broad access (`filesystem=host`, devices, or a proprietary licence), show a pre-install sheet; otherwise keep one-click Get. *Why:* this is the biggest trust gap, and it makes Software and the Applet Store speak one language. *Size:* L.
2. **Recommended.** *What:* Add a background update check owned by the shell (daily, on AC and network). It posts one quiet notification ("12 app updates and a system update are ready") and puts a badge on the Dock tile. It still installs nothing on its own. *Why:* 43 waiting updates is a security problem that looks calm. *Size:* M.
3. **Recommended.** *What:* Render "Recommended for Dashi" from the local list straight away and keep it on screen through loading and offline, with Dashi's own summaries (`src/software/recommended.ts`) instead of Flathub's. Show Trending and the other sections as skeleton cards below it. *Why:* the first screen should never be blank or an error, and Dashi's copy is better. *Size:* S.
4. **Recommended.** *What:* Fold the page name into the single toolbar line. Drop the subtitle (the sidebar already shows where you are) or put it inline after the title in muted ink. Search results can be "Results for “x”" in the search field's own chip. *Why:* one chrome row is the owner's rule, and it also stops the toolbar changing height between pages. *Size:* S (in `@dashi/ui`).
5. **Recommended.** *What:* Add a shared busy pill with a × to cancel, used on cards, rows and the system update (the queue already supports cancel). Add one small "activity" item in the toolbar that lists the queue: "Installing OBS 42% · 2 waiting". *Why:* today you have to open each app's page to stop it, and the queue itself can't be seen. *Size:* M.
6. *What:* On the app page, add "What's new" from AppStream `releases` (the newest 3, collapsed), the install count ("120k installs last month"), make Website and Source open the browser, and add a muted "Proprietary" chip next to the licence. *Why:* these are the basics anyone comparing apps expects. *Size:* M.
7. *What:* Remove sheet: add a "Also delete its settings and data" checkbox (off by default). If it's checked, the sheet names what will be lost. *Why:* the brand's "say exactly what will be lost", and the common reason people remove apps. *Size:* S.
8. *What:* Make the system package list expandable ("Show all 43"). Mark security updates with a broth chip rather than ume text. Give both "Update All" buttons the same weight, and an ellipsis where a sheet follows. *Why:* consistency, and honesty about what's being installed. *Size:* S.
9. *What:* Make the grid responsive: 2 columns below ~900 px of content, 3 up to ~1300 px, then 4. Measure text with Metal's real metrics instead of `fitText`'s guess. *Why:* the app should look right at full screen, not only at its default size. *Size:* M (text measurement is in mirin).
10. *What:* Copy pass. Use "No results" in sentence case. Replace "Flathub didn't answer" plus the raw message with "Flathub isn't responding. Try again in a minute." and put the details behind a "Details" disclosure. Run tool output through a short list of known errors ("Not enough disk space", "Another update is running"). *Why:* the brand voice. *Size:* S.
11. *What:* Move Games and the letter tints off shiso to a tint of their own. Make the verified mark a `@dashi/ui` token. Replace the `colors === darkColors` check with a palette field. *Why:* "one color, one job". *Size:* S.
12. *What:* Subscribe each card to its own app's state through a selector (`useSyncExternalStore` with a per-id memoised snapshot). Get Updates-row icons from `flatpak` locally (`localIcon`) before falling back to the catalog. *Why:* stops whole-grid re-renders on every progress tick and cuts dozens of requests. *Size:* S.
13. *What:* Add a Go menu with Back (❖[) and the sidebar places, arrow-key focus in the grid, and Return to open. *Why:* keyboard people, and menu-bar parity. *Size:* M.

**One big idea**

**Make the app page the place you decide whether to trust an app, not a catalogue entry.** Above the screenshots, put one calm card with four facts in plain words: *who made it* (verified, or "not verified by Flathub"), *what it can reach* (from the sandbox permissions, in the same lines applets use), *what changed recently* (the last release note), and *how many people use it*. The Get button stays one click. When an app asks for much more than its category usually does, the button becomes "Get…" and the same card appears as a sheet. No other Linux store does this well, and it fits Dashi's "tell you what will happen" voice.

**Cross-app notes**

- `AppWindow`'s `title` + `subtitle` stack (`dashi-ui/src/window.tsx:102-110`) is a design-system violation of the one-row rule. Every app that passes `subtitle` gets two lines. Remove the stack, or make the subtitle an inline muted suffix on the same line.
- `EmptyState` (`dashi-ui/src/sheet.tsx:200-222`) draws errors and "nothing here" the same way: a muted title and a `textDisabled` glyph. It needs a `tone: "error"` that uses ink for the title and says what to do next.
- `SearchField` has no imperative `focus()`. Apps fake one by remounting with `key={focus}` (`view.tsx:199`, and the Applet Store's `view.tsx:134`). Add a focus handle.
- Shared pieces that live in `apps/software/` but are used by other apps: `VerifiedBadge`, `ProgressBar`, `Loading`, the category glyphs (the Applet Store imports them from `../software/`). Move them into `@dashi/ui`, and make the verified color a token.
- The indeterminate progress bar should be one shared component that respects Reduce Motion and animates on the design curve, not a 120 ms step.
- "Stale" notes are drawn as a filled box above the content (`states.tsx:30-49`), which is effectively a second bar. The design system should define a toolbar chip for "Offline · showing saved results".
- Category tile colors (`glyphs.ts:46-57`) should be a shared palette. Today the same glyph gets different colors in different apps, and one of them is shiso.
- Sentence case and the ellipsis rule are applied unevenly to buttons that open sheets. A lint for `ConfirmSheet` callers (where the trigger's label should end in "…") would catch it.

**Where it went (0.5.0, wave 2: "Software as a trust card, applets folded in")**

The big idea is in: an app's page leads with the trust card (who made it and whether Flathub verified them, what it can reach in the plain lines applets and Settings use, what changed, how many installed it last month), and an app that reaches far (all your files, every device, a way out of its sandbox, closed source, no longer maintained) is Get… and asks with the card first (`apps/software/trust.tsx`, `trust-words.ts`, `src/software/flatpak-permissions.ts`). The Applet Store is a section of Software (Applet Store roast).

- [x] 1. Permissions on every page, and a sheet before a broad install. The download size is a fact on the page; a free-space check before installing is not done (moved to wave 4's "errors in people's words": a failure for space is now said plainly).
- [x] 2. The shell looks once a day (on a charger, online) and posts one quiet notification for what is new; Show opens Updates (`src/software/update-check.ts`). The Dock tile's badge is not done: moved to the Dock (wave 4).
- [x] 3. Recommended shows at once and offline (0.4.1). Skeleton cards for Flathub's sections are not done: one quiet line stands in their place.
- [x] 4. One-line title (0.4.1).
- [x] 5. What's new, the install count, Website and Source open the browser, a Proprietary chip. Ratings and reviews: Flathub has none to show; not planned.
- [x] 6. Every busy chip has a × (cards, Installed, Updates, the system update), and the toolbar's activity chip names the queue.
- [x] 7. "Show all 43", security as a broth chip, both Update all buttons the same weight, "…" where a sheet follows.
- [x] 8. Copy: "No results", "Flathub isn't responding. Try again in a minute.", failures in plain words with the tool's text behind Details (`src/software/failure-words.ts`).
- [x] 9. Tokens: `verified` for Flathub's seal, `accentInk` for the pill's verb, no palette identity check; no shiso anywhere.
- [x] 10. "See all" on every section, and New on Flathub. A featured row with screenshots: moved to wave 4.
- [x] 11. The grid is 2, 3 or 4 columns by its width. Measuring text with Metal's real metrics is mirin's (moved).
- [x] 12. Each card follows its own app (`useSelected`); installed icons are found locally, off the render path, before the catalog is asked.
- [x] 13. Go menu with Back ❖[ and the places; the grid is one Tab stop with arrows, Return opens. ❖F still remounts the field: a focus handle on `SearchField` is @dashi/ui's (moved).
- [x] 14. Remove… can also delete the app's settings and data (`flatpak uninstall --delete-data`).
- [x] 15. Gallery: arrows through the strip, the large one at full size on a click, hover on thumbnails, a spinner while loading.
- [x] 16. The developer line is muted ink; the chip is its own press target.
- [ ] 17. The indeterminate bar is @dashi/ui's `ProgressBar` now (MO-3 there).
- [x] 18. No sync file checks while rendering.

Cross-app notes: the subtitle stack is gone (0.4.1); `EmptyState`'s error tone and `SearchField`'s focus handle are @dashi/ui's (moved); nothing imports from `apps/software/` any more; the stale note is a toolbar chip (VS-5); the ellipsis lint is wave 4's.
