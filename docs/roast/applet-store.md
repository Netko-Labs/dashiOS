# Applet Store

**The roast**

- The store's key is literally `null` (`src/applet-store/keys.ts:9`). Every person who opens it gets "The Applet Store isn't set up yet", then a "Try Again" button that can't ever work, because `load()` throws before it touches the network (`catalog.ts:79`; applet-store.png). It isn't a store yet, it's a sign saying a store is coming.
- The sidebar still lists seven categories, Installed and Updates around that dead end (applet-store.png). It's a shop with every aisle labelled and no shelves.
- The blue check means "Flathub verified the publisher" in Software and "Dashi's maintainers reviewed this" here. It's the same badge from the same file for two different authorities (`../software/parts.tsx` imported by `page.tsx:14,116` and `rows.tsx:12,123`).
- The consent sheet has the applet's real icon available and shows a white letter on a kombu tile anyway (`consent-sheet.tsx:55-56`). The one moment you're deciding whether to trust something is the moment it hides its face.
- "Not for this Dashi" and "This Dashi has no key…" are two strings in a product whose brand guide says it's never "the Dashi" (`rows.tsx:68`, `catalog.ts:79`; docs/brand.html, "Write it").

**Findings**

| # | Severity | Area | What's wrong | Evidence |
|---|---|---|---|---|
| 1 | P0 | Catalog | The shipped build has no catalog key, so the store can never load anything. "Try Again" just repeats the same `no-key` throw. Every user sees this screen. | `src/applet-store/keys.ts:9`; `catalog.ts:79`; `pages.tsx:22,35`; applet-store.png |
| 2 | P1 | Error state | The no-key copy blames the build in jargon ("no key for the applet catalog"), offers no next step, and is drawn as a muted empty state, not an error. It also doesn't mention the 2 applets that are installed and working (badge "2" in the sidebar). | applet-store.png; `pages.tsx:18-38`; `dashi-ui/src/sheet.tsx:216-217` |
| 3 | P1 | Menus | The app registers no menus (`useAppMenus` isn't used anywhere in `apps/applet-store/`). The menu bar shows a generic File/Edit/View/Window/Help, and there is no ❖F, no ❖1–3, no Check for Updates, no Get or Remove. Software has all of these. | grep of `apps/applet-store/`; applet-store.png; compare `apps/software/menus.ts` |
| 4 | P1 | Consent sheet | When an update asks for more, the sheet lists every permission again instead of just the new ones. The store computes which ones are new (`widens`) and throws the result away. The title "wants to do more" never says what more. | `model.ts:73-76`; `consent-sheet.tsx:34,60,67-76` |
| 5 | P1 | Consent sheet | The consent sheet is a hand-built one-off: radius 18, padding 22, title 15, launcher glass. The design spec says sheet radius 12, padding 20, title 13 Bold, icon 40. It shows a letter tile, not the icon, and says nothing about the signature or where the code comes from, though the installer checks both. | `consent-sheet.tsx:39-56`; docs/design.html "Sheet"; `installer.ts:1-8,175-176` |
| 6 | P1 | Trust signals | "Reviewed" reuses Flathub's verified seal, and the signature (the store's real trust feature) appears nowhere in the UI. Permissions, the most important fact, are buried as a right-aligned multi-line "It can" value in the facts table below the screenshots and description. | `page.tsx:116-117,133-147,34`; `rows.tsx:123` |
| 7 | P1 | Manage after install | There's no way to turn an applet off, look at what you allowed, or take a permission back short of removing it. No Settings pane mentions applets. Remove never offers to delete the applet's data, though the installer supports it. | grep of `src/settings-app/`; `installer.ts:193-195`; `model.ts:98-107`; `view.tsx:157` |
| 8 | P2 | Progress / errors | Installing shows only an indeterminate bar with no cancel. Failures arrive as "That didn't work" with raw verifier text ("the package is x 1.0, not what the index lists"), in a `ConfirmSheet` whose Cancel and OK do the same thing. | `rows.tsx:56-62`; `model.ts:91`; `installer.ts:170-180`; `view.tsx:163-171`; `dashi-ui/src/sheet.tsx:107-108` |
| 9 | P2 | Discover | Discover is the whole catalog sorted A–Z, with an optional "For This Computer" group. There is nothing featured, no screenshot in a list, and no sort or "new". | `pages.tsx:53,70-77` |
| 10 | P2 | Pill copy | The status pill becomes a sentence: "Not for this Dashi", "Pulled" in red as a dead button, "Install 1.2.3". "Installed" looks like a button but does nothing. The store's verb is "Get", but the sheet says "Add “X”?" / "Add Applet", and an update's "Update" becomes "Allow" / "Not Now". | `rows.tsx:64-94`; `consent-sheet.tsx:60,84-85` |
| 11 | P2 | Nav | Back doesn't restore the search text, unlike Software, so after Back the field and the page disagree. Refresh is an unlabelled icon that's always there, while Software only shows a labelled "Check for Updates" on its Updates page. | `view.tsx:131-132`; compare `apps/software/view.tsx:78-82,189-197` |
| 12 | P2 | Chrome | Two-line "Applet Store / Discover" title in the toolbar (the same `AppWindow` subtitle as Software). Updates puts "Update All" on its own row above the list, a second bar. | applet-store.png; `view.tsx:176`; `pages.tsx:163-172` |
| 13 | P2 | Color | The Developer tile is shiso `#6E56CF` (agents only), and so is one letter tint. "Works on … this one ✓" is kombu, but success is moss, and the ✓ is typed text rather than a glyph. | `view.tsx:29`; `rows.tsx:35`; `page.tsx:34,106` |
| 14 | P2 | Sidebar | "Status" and "Utilities" use the same glyph. The same glyphs get different tints from Software (Productivity is orange there and blue here; Network blue there and teal here). | `view.tsx:22-31`; applet-store.png vs software.png |
| 15 | P2 | Updates | Updates are found only when the store opens ("looks again each time it opens"), and nothing tells you otherwise. "Update All" queues one consent sheet per applet that widens, with no count and no "allow all". | `pages.tsx:157,164-170`; `view.tsx:62,146` |
| 16 | P3 | Screenshots | A different gallery from Software's for the same job: 8 px dots, no thumbnails, no keys, "Loading…" text in place of the image. | `page.tsx:40-91` vs `apps/software/gallery.tsx` |
| 17 | P3 | Links | "Source" is a URL you can't click. For an applet store whose pitch is "read the code", that's the one link that has to work. | `page.tsx:143` |
| 18 | P3 | Sync I/O | `installer.installed()` reads the applets folder synchronously on every refresh, install and remove. `store.updates()` runs a `statusOf` scan over the whole catalog on every render. | `model.ts:56,61,94,106,113-119`; `view.tsx:92` |

**Improvements**

1. **Recommended.** *What:* Don't ship a dead store. Either generate and commit the catalog key, or, while `DASHI_INDEX_KEY` is null, hide the Applet Store's Discover and categories and open on Installed with one quiet line: "The applet catalog is coming soon. Applets you add by hand work today." Drop "Try Again" for `no-key`. *Why:* the first screen is currently a broken promise to every user. *Size:* S.
2. **Recommended.** *What:* Rebuild the consent sheet on `@dashi/ui`'s `Sheet` (radius 12, padding 20, 40 px icon) with the applet's real icon. For an update, show "New:" first (the `widens` difference) and "Already allowed" collapsed. Add one trust line: "Signed by Jane Doe · Reviewed by Dashi · Source on GitHub". *Why:* the consent sheet is the store's whole value, and right now it's the least polished surface. *Size:* M.
3. **Recommended.** *What:* Add an applet's "Manage" section, on its page and in a Settings pane: an on/off switch, "Allowed" with a switch per permission, and Remove… with "Also delete its data". *Why:* consent you can't take back isn't really consent, and the installer already supports most of it. *Size:* M.
4. **Recommended.** *What:* Register menus the way Software does: File (Search ❖F, Get, Remove…), View (❖1–3), Store (Check for Updates ❖R). Restore the search query on Back. *Why:* menu-bar parity is a Dashi principle, and it's free since Software's `menus.ts` is the template. *Size:* S.
5. *What:* Use a separate trust mark: a "Reviewed by Dashi" seal built from the bowl glyph in ink (not kombu, which belongs to the person), distinct from Flathub's verified check. Move "It can / It can't" up beside the Get button as a short card (it's the first thing a person needs), not the last row of the facts table. *Why:* two different authorities shouldn't look the same. *Size:* S.
6. *What:* Make the pill one of Get / Update / Open (or Installed as plain text, with no pill shape). Unavailable versions get a muted "Needs a newer Dashi" detail line, not a pill. Use one verb everywhere ("Get" on the pill, "Get “X”?" on the sheet, "Get" on the button). *Why:* one word for one action, and a pill that does nothing shouldn't look like a button. *Size:* S.
7. *What:* Failures: a proper `Sheet` with one OK. Title "“X” wasn't installed", then a plain reason mapped from verifier errors ("Its signature doesn't match. Dashi didn't install it, to keep you safe."), with the technical text behind "Details". *Why:* the brand says errors say what happened and what to do. *Size:* S.
8. *What:* Discover: a small "Made for this computer" row first (it already exists), then "New" and "Popular" when the index carries dates or counts, and a screenshot on the first row. Let the categories collapse when there are fewer than ~20 applets. *Why:* an A–Z list isn't discovery. *Size:* M.
9. *What:* Fix the category tiles: give Status its own glyph, take Developer off shiso, and share one category-to-tint map with Software. *Why:* "one color, one job", and the two sidebars sit side by side in the same OS. *Size:* S.
10. *What:* Read the installed folder off the UI thread (async, or once per change through a watcher), and memoise `updates()` on `index` and `installed`. *Why:* stops sync I/O on every click and an O(catalog) scan on every render. *Size:* S.

**One big idea: should this be one app with Software?**

**Yes. Make applets a section of Software, not a sibling app.** The two are already the same app twice. The windows have the same shape (Discover / Installed / Updates + Categories + search; compare the two screenshots), the nav is the same (`nav.ts` here says "as in Software"), and the Applet Store imports Software's glyphs, `VerifiedBadge`, `ProgressBar` and `Loading` straight from `../software/` (`view.tsx:13`, `rows.tsx:12`, `pages.tsx:10-11`, `page.tsx:14`). People don't think "I need an applet store". They think "I want a battery widget in my menu bar", and they look in Software. One app gives them:

- **One Updates page**: apps, applets and the system, with one badge and one background check (Software report, improvement 2).
- **One Installed page** with a kind filter (Apps · Applets), and Manage / Remove working the same way for both.
- **One trust language.** The applet consent sheet and Software's missing Flatpak permissions become the same "What it can do" card and sheet. Flathub's "Verified" and Dashi's "Reviewed" sit side by side as distinct, explained marks.
- **Honest failure.** While the catalog key is null, the Applets section simply doesn't appear, instead of shipping a whole app that's broken.

Shape it without breaking the one-row rule: the sidebar becomes Discover · Apps by category… · **Menu bar applets** · Installed · Updates. Applets get one sidebar row whose page groups them by category (there are few). The menu bar's "Get more applets…" opens Software straight to that row (`dev.dashi.software` with a deep link). Keep `@dashi/applet`'s signature checks and the shell-side consent sheet as they are: only the storefront merges, the security model stays.

**Cross-app notes**

- `AppWindow`'s title/subtitle stack breaks the one-row rule in every app that passes a subtitle (`dashi-ui/src/window.tsx:102-110`; applet-store.png, software.png).
- Shared store pieces live in `apps/software/` and are imported across apps (`VerifiedBadge`, `ProgressBar`, `Loading`, category glyphs). They belong in `@dashi/ui`, with a token for the verified color, plus a second "reviewed" mark.
- `EmptyState` needs an error tone (ink title, an action that actually helps). Today an error and "nothing here" look the same (`dashi-ui/src/sheet.tsx:216-217`).
- `ConfirmSheet` is used for information-only messages, which gives a Cancel that does the same as OK (`view.tsx:163-171`). Add an `AlertSheet` with a single button to `@dashi/ui`.
- Shell-level consent sheets (`src/applets/consent-sheet.tsx`) should be built on `@dashi/ui`'s `Sheet` so that radius, padding, type and material follow the spec in docs/design.html.
- Define one category taxonomy and tint map for every Dashi store surface, with no shiso.
- "Dashi", never "this Dashi" or "the Dashi": a copy lint for UI strings would catch `rows.tsx:68` and `catalog.ts:79`.
