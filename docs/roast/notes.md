# Notes

**The roast**

- It's a notes app where you can't click inside your own note. The caret moves with the arrow keys only, and you can't select anything except with Select All (`apps/notes/editor.tsx:3-6`). To fix a typo halfway down a paragraph, you press Down eleven times.
- The note count appears three times on one empty screen: the sidebar badge "0", the toolbar subtitle "0 notes", and the footer "0 notes" (notes.png). The window spends two bars on a number that is already in a badge.
- The engineering is excellent: atomic writes, no-clobber moves, symlink checks, a sidecar that treats its own file as untrusted (`store.ts`, `files.ts`, `sidecar.ts`). None of it shows in the window, which is a blank 276 px column next to a gray icon that says "No Notes".
- "Formatting" means Markdown you type yourself, and Preview then shows `**bold**` with its asterisks (`preview.tsx:101`). Checkboxes can only be ticked in Preview, so every grocery list means switching modes.
- The sync story is "files on disk, last writer wins". If your phone's sync tool changes a note while you're typing, your next pause overwrites its change without a word (`model.ts:264`, `model.ts:147-153`).
- The word "Notes" means the app, the default folder, and the list caption at once (`names.ts:15`, `rows.tsx:133`). An empty note shows as "New Note" in the list but is saved as "Untitled.md" on disk (`rows.tsx:72` vs `names.ts:13`).

**Findings**

| # | Severity | Area | What's wrong | Evidence |
|---|---|---|---|---|
| 1 | P0 | Editing | Clicking doesn't place the caret, and there's no selection except Select All. The core action of a notes app, fixing text in place, depends on the arrow keys. This is Metal's input, but the person only sees Notes. | `apps/notes/editor.tsx:3-6`; same limit noted in `apps/editor/text-area.tsx:7-9` |
| 2 | P1 | Editing / menus | There's no Undo or Redo, and no Edit menu at all: Notes publishes File, Note and View only. The Editor app already has an undo history and Edit menu that Notes doesn't reuse. | `notes/menus.ts:139`; compare `apps/editor/menus.ts:59-72`, `apps/editor/history.ts` |
| 3 | P1 | Sync | If the file changes on disk while typing is pending, the draft is kept, then written over the other change at the next save, with no conflict copy and no notice. | `model.ts:264` (skips reload when dirty), `model.ts:147-153` (flush writes regardless) |
| 4 | P1 | Chrome | The toolbar title is two lines ("All Notes" over "0 notes"), and a permanent 26 px footer repeats the count. That breaks the one-chrome-row rule twice. | notes.png; `view.tsx:239-240`, `view.tsx:218-235`; `dashi-ui/src/window.tsx:101-111` |
| 5 | P1 | Formatting | Preview draws only block-level Markdown. Inline bold, italic, code, links and images show as raw text. There are no format commands or shortcuts, and Edit mode is raw Markdown. | `preview.tsx:100-101`, `checklist.ts:66`; `menus.ts:68-82` has no Format items |
| 6 | P2 | Checklists | Boxes can only be ticked in Preview. The toolbar's checklist button always appends `- [ ] ` at the end of the note instead of turning the current line into an item. | `view.tsx:78-84`, `preview.tsx:44-61` |
| 7 | P2 | Attachments | You can't attach anything: no drop target and no images, even though Metal has `onDrop` and `Image`, and the Files app already accepts drops. | `mirin-metal/src/types.ts:278`, `types.ts:319`; `apps/files/drop.ts` |
| 8 | P2 | Files / sync | Every title save renames the file to match the title. Sync tools see a delete plus a create, other editors lose the open file, and pins are keyed by file name. | `store.ts:102`, `store.ts:289-302`, `sidecar.ts:24` |
| 9 | P2 | Performance | Each save (after a 600 ms pause) rescans the whole folder synchronously. The watcher then fires on that same write and scans again, and trashed notes are re-read with no cache on every scan. | `model.ts:151`, `model.ts:337-343`, `main.tsx:29`, `store.ts:45-63`, `store.ts:341-364` |
| 10 | P2 | Empty state | The list column is a blank void while the message sits off to the right. "No Notes" and "No Note Selected" are in Title Case. The copy explains where files live, not what to do, and Kombu is missing although the brand puts him in empty places. | notes.png; `editor.tsx:121-128`, `view.tsx:310`; `rows.tsx:117-135` (no empty row) |
| 11 | P2 | Toolbar | Five icon-only buttons with no labels or tooltips; pin and move-to-folder are hard to tell apart. In Recently Deleted the same toolbar does have labels, so it's inconsistent. | notes.png; `view.tsx:169-183` vs `view.tsx:147-155`; `window.tsx:141-175` |
| 12 | P2 | Menus | The move-to-folder popup is hard-coded at x 330, y 38. The button sits at about x 569 in a 980 px window (notes.png), so the menu opens over the list, about 240 px away from it. | `view.tsx:181` |
| 13 | P2 | Copy / errors | Raw system errors reach the footer: "Couldn't save: EACCES: …" and `"x" is not a note id.`. This is the brand guide's exact "instead of" example. | `model.ts:154`, `model.ts:169`, `store.ts:238-241` |
| 14 | P2 | Information architecture | On first run, "All Notes" and the "Notes" folder are the same list. The default folder can't be renamed. The "Notes" caption in the list can collide with a real folder named Notes. | notes.png; `sidebar.tsx:46-59`, `rows.tsx:133`, `names.ts:15` |
| 15 | P2 | Folders | Folders go one level deep only. You can't drag a note onto a folder, and Rename/Delete Folder only work by right-click or while that folder is open. | `store.ts:3`, `menus.ts:50`, `menus.ts:64-65`; no `onPointer`/`onDrop` in `apps/notes` |
| 16 | P3 | Keyboard | Single-letter commands work when the list has focus: N makes a note, P pins. Backspace trashes the note at once with no undo and no feedback. The comment says Metal has no Ctrl keys, but `onKeyDown` does report modifiers. | `view.tsx:5-6`, `view.tsx:261-276`; `mirin-metal/src/types.ts:168-177` |
| 17 | P3 | Copy | "New Folder…" and "Rename Folder…" open sheets but have no ellipsis, and neither does the context menu's "Delete Forever". The sheet says "Name this folder.", which is filler. | `menus.ts:57`, `menus.ts:64`, `view.tsx:94`, `sheets.tsx:71` |
| 18 | P3 | Search | Matches aren't highlighted and you can't find text inside a note. Esc in an empty search field doesn't return focus to the list. | `view.tsx:194`, `dashi-ui/src/fields.tsx` (SearchField passes Escape only when empty); `text.ts:67-77` |

**Improvements**

1. **Recommended.** *What:* Drop the subtitle and the footer. Put the word count in the editor's "Edited …" line and keep counts in the sidebar badges. *Why:* It restores one chrome row and removes three copies of the same number. *Size:* S.
2. **Recommended.** *What:* Add an Edit menu (Undo, Redo, Cut, Copy, Paste, Select All, Find in Note) backed by the Editor's `history.ts`, moved into the kit. *Why:* No undo in a writing app is a trust problem, and the code already exists. *Size:* M.
3. **Recommended.** *What:* Make saves safe against conflicts. When the disk changed under a dirty draft, save the draft as "Title (conflict)" next to it and say so in one quiet line, or merge if only one side changed. *Why:* "Files on disk" is Notes' whole sync story, and right now it silently loses edits. *Size:* M.
4. **Recommended.** *What:* Render inline Markdown in Preview (bold, italic, code, links, images through Metal `Image`). Add Format items with ❖B, ❖I and ⇧❖L, and make the checklist command turn the current line into an item. *Why:* Formatting is a day-one expectation, and the parser is one regex pass away. *Size:* M.
5. **Recommended.** *What:* Push mirin's TextInput to support pointer caret placement and drag selection, and adopt it here first. *Why:* It's the P0, and it blocks Editor and every form field too. *Size:* L (cross-app).
6. *What:* Stop renaming files on every pause: rename once when the person leaves the note or the title stays stable for ~5 s, and key pins by a stable id stored in the sidecar. *Why:* Less churn for sync tools and other apps. *Size:* M.
7. *What:* Accept dropped files and images. Copy them into a per-note `Attachments` folder and insert a `![](…)` link. *Why:* "Attachments" today means none. *Size:* M.
8. *What:* After saving, update only the saved note in memory, and ignore the watcher event caused by Notes' own write (compare mtimes). Cache the trash like live notes. *Why:* That removes two full synchronous scans per typing pause. *Size:* S.
9. *What:* Redo the empty state. Kombu plus "Write your first note" and a New note button, centered across the list and editor, and a quiet "Nothing here yet" in an empty list. Use sentence case. *Why:* First launch is the brand's chosen moment for warmth. *Size:* S.
10. *What:* Give toolbar buttons tooltips (needs `@dashi/ui`), and anchor the move menu to the button's `bounds`, as Calendar's sidebar already does (`calendar/sidebar.tsx:68`). *Why:* Discoverability, and the menu appearing in the wrong place. *Size:* S.
11. *What:* Translate store errors into plain sentences ("Notes couldn't save this note. Check that your Documents folder isn't full or read-only."). *Why:* Brand voice. *Size:* S.
12. *What:* Let people drag notes onto folders and rename the default folder (or hide it until a second folder exists). *Why:* Folders are half-built without drag and drop. *Size:* M.

**One big idea**

Make it one live page. Drop the Edit/Preview switch and render Markdown as you type: headings grow, `**bold**` turns bold with its markers fading, checkboxes can be ticked right in the text, and images appear inline. The file stays plain Markdown, which is Notes' real advantage. Pair it with pointer editing and undo, and Notes goes from "a Markdown folder viewer" to a place people want to write in, while staying the one notes app whose files are fully yours.

**Cross-app notes**

- `AppWindow`'s `subtitle` (`dashi-ui/src/window.tsx:38`, `window.tsx:106-110`) makes two-line titles the easy path. Remove it, or render it inline after the title in muted ink on the same line.
- A permanent `footer` is a second bar. The guideline should say footers are for transient messages only (Calendar already works this way, `calendar/view.tsx:228`).
- `ToolbarButton` has no tooltip or accessible name (`window.tsx:141-175`). Every icon-only toolbar in Dashi inherits that.
- mirin `TextInput` has no pointer caret, selection or undo (`notes/editor.tsx:3-6`, `editor/text-area.tsx:7-9`). It's the biggest shared gap; undo history (`editor/history.ts`) should move to the kit.
- `KeySink` only reports up, down, Esc, Enter and text (`dashi-ui/src/key-sink.tsx:41`), while Metal's `onKeyDown` gives every key with its modifiers. Upgrade it so apps get left/right and Delete, and drop the stale "no Ctrl" comments.
- `EmptyState` callers use Title Case ("No Notes"). The brand says sentence case and suggests Kombu for empty states, so `EmptyState` could take an optional Kombu.
- Popup menus should always anchor to `event.bounds`. Hard-coded coordinates break as soon as the window size changes.
- System error text needs a shared "plain sentence" helper so errno strings never reach the screen.
