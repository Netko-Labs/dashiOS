# Preview

**The roast**

- The empty window (`preview.png`) is 1000 × 700, and its main job is to say "Open an image or a PDF here". You can't drop anything "here", though: Preview has no drop target anywhere (`view.tsx:291`; no `onDrop` in `apps/preview/`).
- The toolbar holds eleven glyphs with nothing to act on, plus a gap between − and + where a blank zoom percentage sits (`preview.png`, x≈1035–1108). The only button that looks live is "…", and its first two items silently do nothing.
- To "read" a PDF you get one page at a time, fitted whole, as a PNG. No wheel, no scroll, no fit-width, no selecting text, no search. It's a fax machine with a sidebar.
- Rotating means asking ImageMagick to re-encode the whole photo on every quarter turn, with no spinner (`viewer.ts:278-283`, `busy` never drawn). The rotation is forgotten the moment you press ↓ for the next picture.
- The error messages read like an RPM spec file: "PDF files need poppler-utils (pdftoppm and pdfinfo)" and "Is wl-clipboard installed?"
- The canvas comment says Metal has "no wheel event on a plain view" (`canvas.tsx:3-5`), while Terminal, two folders over, scrolls with `onWheel` (`terminal/view.tsx:217`).

## Findings

| # | Severity | Area | What's wrong | Evidence |
|---|---|---|---|---|
| 1 | P0 broken | PDF reading | A PDF can't be read the way people read PDFs. Pages come one at a time. "Fit" fits the whole page, so on a landscape window the text is small, and there's no fit-width. The wheel and trackpad do nothing, so drag is the only way to pan. ↑/↓ jump to another page even when you're zoomed into the current one. Pages are flat PNGs from `pdftoppm`, so there's no text selection, find, links or outline. | `canvas.tsx:3-5,63-72`, `view.tsx:54,146-147`, `zoom.ts:26-29`, `viewer.ts:368-377`, `pdf.ts:63-66` |
| 2 | P1 bad | Chrome | The title has two lines. The subtitle ("4,032 × 3,024 · 3 of 12", "12 pages · Title") is stacked under the file name in the 38 px toolbar, which breaks the owner's hard rule. | `view.tsx:207-217,306`, `dashi-ui/src/window.tsx:102-110` |
| 3 | P1 bad | Empty state | The copy says "Open an image or a PDF here", but nothing accepts a drop, even though Metal has `onDrop` (used in `dashi-ui/src/table.tsx:129`). There's no list of recent files. "Open…" is a secondary button. | `view.tsx:288-294`; `preview.png` |
| 4 | P1 bad | Toolbar, empty | In the empty state, 10 of 11 controls are disabled, and the blank zoom label leaves a 46 px hole between − and +. The live "…" menu offers Open With… and Show in Files, which are enabled with no file and return without doing anything. | `toolbar.tsx:48-56`, `view.tsx:200-203,111,118,267`; `preview.png` |
| 5 | P1 bad | Progress | The viewer tracks `busy`, but the window never shows it. Loading is the text "Opening…" with no glyph or progress. Rotating, changing page and re-rendering after a zoom run helper processes (up to 60 s for ImageMagick, 45 s for a page) with no sign of work, so presses look ignored. | `viewer.ts:73,236,399`, `view.tsx:285-286` (no `busy` in view.tsx), `convert.ts:18`, `viewer.ts:37` |
| 6 | P1 bad | Rotate | Rotation is a view state that's thrown away when you open the next image (`turns: 0`), with no prompt. The only way to keep it is "Save Turned Copy", which writes `name rotated.jpg` next to the original and re-encodes JPEG at quality 95, losing quality. PDFs can't be rotated at all. | `viewer.ts:157,278-283,340-346,363`, `convert.ts:88-123` |
| 7 | P1 bad | Missing basics | No Copy for the image (Edit has only Copy Path). No Print, no Export or Convert, no markup of any kind, and no crop. Password-protected PDFs are refused ("cannot enter yet"). No slideshow. GIFs show only their first frame. | `menus.ts:59-101` (Edit at `:73`), `viewer.ts:220,358,360` |
| 8 | P1 bad | Shortcuts | They contradict each other. Bare `0` fits and bare `1` is actual size, but the menu has ❖0 = Actual Size and ❖9 = Zoom to Fit. The toolbar shows ‹ › chevrons, yet the arrow keys are ↑/↓. `,` `.` `<` `>` also page, but no menu mentions them. Bare `f` opens Files, and Backspace asks to trash. | `view.tsx:145-163`, `menus.ts:63-99` |
| 9 | P2 meh | Copy | The messages explain how it works instead of what happened: "PDF files need poppler-utils (pdftoppm and pdfinfo), which is not installed", "HEIC files need ImageMagick with HEIC support", "Is wl-clipboard installed?", "Shown reduced to keep memory in check." The wording mixes "Turned", "Rotate" and "rotated" for the same action. | `viewer.ts:227,229,232,261,351`, `view.tsx:108,120,130`; `menus.ts:68,89-90`, `sheets.tsx:29`, `convert.ts:115` |
| 10 | P2 meh | Chrome | The note ("Shown reduced…", "The picture's own rotation is not applied…") appears as a footer bar under the canvas: a second bar, for a fact that belongs in Info. | `view.tsx:297-301,311` |
| 11 | P2 meh | Thumbnails | Thumbnails exist only for PDFs, never for a folder of images. Every thumbnail uses page 1's aspect ratio. The placeholder is hard-coded white at 60%, which glares in Dark Mode. Up to 5,000 views are built eagerly. Pages after 600 never get a thumbnail. The strip doesn't scroll to the page you're on (inferred: no scroll call). The sidebar is 190 px against the design's 200. | `view.tsx:308-309`, `thumbnails.tsx:11-13,36`, `pdf.ts:17`, `viewer.ts:35,439` |
| 12 | P2 meh | Performance | The UI thread does synchronous I/O. `factsFor` runs `statSync` on every render. Every open, which includes every arrow press, runs `readdirSync` on the folder (up to 20,000 names) and sorts it. | `view.tsx:219`, `info.ts:48`, `viewer.ts:172,194,201`, `siblings.ts:45-49` |
| 13 | P2 meh | Rendering | The device scale is fixed at 2. The VM screenshot runs at scale 1, so every PDF page is rendered with 4× the pixels it needs. On a scale-3 screen it would be soft. Thumbnails render 220 px wide for a 150 px slot, which is under 2× and soft on HiDPI. | `viewer.ts:102`, `pdf.ts:20`, `thumbnails.tsx:7` |
| 14 | P2 meh | Color | The canvas ground is hard-coded (`#e4e4e8`/`#161618`) and differs from the empty state's `surface.window` (`#f5f5f7`), so the background jumps when a file opens. The Open With list highlights hovered rows in kombu, which means "selected". Every app in that list gets the same document glyph, and the list can't be driven from the keyboard. | `canvas.tsx:24-27`, `dashi-ui/src/theme/surface.ts:22`, `sheets.tsx:85-98` |
| 15 | P2 meh | Info | The Info sheet is hand-built: the heading says "Info" instead of the file name, and it uses 12 px label/value rows instead of `@dashi/ui`'s Group and Row. Locales are mixed: sizes and dimensions are forced to en-US, while the date follows the system. | `sheets.tsx:13-55`, `info.ts:22,27` |
| 16 | P3 polish | Toolbar | The toolbar is all glyphs with no labels or tooltips. "Fit" (four corners) and "Actual size" (square with a dot) sit next to each other and are hard to tell apart (`preview.png`, x≈1163/1205). "…" is a hand-built view that can't be disabled, and its menu is placed by a guessed offset (`x − 120`). | `glyphs.ts:13-16`, `toolbar.tsx:62-68`, `view.tsx:276`, `dashi-ui/src/window.tsx:141-153` |
| 17 | P3 polish | Windows | Each file starts its own Bun process and Metal host. File ▸ Open… replaces the current window's file, with no option to open it in a new window, and there are no tabs. | `main.tsx:2-5`, `view.tsx:102-109` |

## Improvements

1. **Make PDFs a scrolling document.** *What:* Stack pages in one surface that scrolls with the wheel and trackpad (`onWheel` exists, `mirin-metal/src/types.ts:270`). Ctrl+wheel and pinch zoom around the pointer. Default to fit-width. ↑/↓ scroll and Page Up/Down page. Render only the pages near the screen. *Why:* Reading is the job, and today it's the worst part. *Size:* L. **Recommended**
2. **Keep the title to one line.** *What:* Drop `subtitle` from Preview. Show the dimensions and "3 of 12" in Info, or as muted text on the same line as the name. Fix `AppWindow` so a subtitle can never stack. *Why:* It's a hard rule, and it's broken on every file opened. *Size:* S. **Recommended**
3. **An empty state that works.** *What:* Accept drops on the whole window (`onDrop`). Make "Open…" the primary button. List up to five recent files under it. Hide the zoom, rotate and info controls until a file is open, and disable or remove Open With… and Show in Files when there's nothing to open. *Why:* It's the screen in the screenshot and the first thing a person sees. *Size:* S–M. **Recommended**
4. **Show work, and make rotation stick.** *What:* After about 300 ms of `busy`, show progress (a small spinner in the toolbar or on the canvas). Remember turns for each file during the session. When leaving a rotated image, save the turn in place: rotate JPEGs losslessly (jpegtran or the EXIF orientation flag) and re-encode only formats where that's lossless. Offer "Duplicate" for anyone who wants a copy. Rename to "Rotate" everywhere. *Why:* Today the work is invisible and lost when you move on. *Size:* M. **Recommended**
5. **Copy, Export, Print.** *What:* Edit ▸ Copy (❖C) puts the image on the clipboard. File ▸ Export… (format PNG/JPEG/WebP/PDF, quality, size) converts. File ▸ Print… prints. Keep Copy Path, but secondary. *Why:* These are the three things people do with a picture after looking at it. *Size:* M. **Recommended**
6. **Make the keys agree with the menus.** *What:* Move to `onKeyDown` (Terminal already uses it) so ← → page, ❖ chords and modifiers work. Make bare `0`/`1` match ❖0/❖9, or drop them. Show every bare key in a menu. Stop opening Files on a bare `f`. *Why:* Today the toolbar, the menu and the keyboard each have their own rules. *Size:* S.
7. **Rewrite the error copy and move dependencies into packaging.** *What:* Make poppler-utils and ImageMagick (with HEIC/AVIF/JXL) dependencies of the RPM. Rewrite messages to say what happened and what to do, e.g. "This picture is too large to show." or "Preview can't open HEIC pictures on this computer." Move the footer note into Info. *Why:* Brand voice ("tells you what will happen, not how it works"), and it removes a second bar. *Size:* S.
8. **Make thumbnails a real navigator.** *What:* Render only visible rows. Use each page's own size. Scroll to the current page. Use a themed placeholder. Show a filmstrip of the folder's images in the same sidebar, so the two kinds of file behave alike. *Size:* M.
9. **Take I/O off the render path.** *What:* Memoize `factsFor` per path and stamp. List the folder once per directory, asynchronously, and watch it. Read the real device scale from the host. *Size:* S.
10. **Markup, later and done well.** *What:* Shapes, arrows, text, highlight, signature and crop, drawn as a non-destructive layer that's saved on export. *Size:* L.

## One big idea

**Treat every file as a strip of pages on one calm, scrolling surface.** A PDF is its pages, and a folder of photos is its pictures, both in the same continuous, zoomable view, with the same thumbnail strip on the left and the same keys. Edits (rotate, crop, markup) are a non-destructive layer per file, remembered while you browse and written back when you leave the file. If an edit can't be written back losslessly, Preview asks before writing it. Nothing is lost by pressing ↓, nothing needs a "Turned Copy", and Preview becomes the place you go through a folder or a document, not just glance at one file.

## Cross-app notes

- **`AppWindow`'s subtitle stacks a second line** under the title (`dashi-ui/src/window.tsx:102-110`), which breaks "no two-line titles" in every app that passes `subtitle`. Make it inline and muted on the title's line, or remove the prop.
- **`AppWindow`'s `footer` makes second bars easy** (`window.tsx:49-50,118`). The guidelines should say what may go in a footer, if anything (status that changes as you work, not static notes).
- **Comments and KeySink are behind what Metal can do.** `onWheel`, `onKeyDown` (key names, modifiers, repeat) and `onDrop` all exist (`mirin-metal/src/types.ts:168-177,268-278`). `@dashi/ui`'s KeySink (`keys.ts:1-18`) and Preview's canvas (`canvas.tsx:3-5`) still say they don't. `@dashi/ui` should offer one key hook built on `onKeyDown`, a scroll/zoom surface on `onWheel`, and a standard "drop files here" behavior for empty states.
- **`ToolbarButton` has no tooltip or accessible name** (`window.tsx:141-153`). Icon-only toolbars need both. Add a `ToolbarMenuButton` (a "…" that opens a menu anchored to itself) so apps stop hand-placing popups at a guessed offset.
- **There's no progress primitive.** `EmptyState` is reused as a loading screen with only text (`sheet.tsx:200-222`). `@dashi/ui` needs a spinner or progress control and a rule for when to show it (for example after 300 ms).
- **Hover vs selected.** Rows hovered in kombu (`preview/sheets.tsx:95`) blur kombu's one job. Add a `rowHover` token and say in the guidelines that kombu marks only selection.
- **Hard-coded grounds and identity theme checks** (`preview/canvas.tsx:26`, `calculator/view.tsx:48`, `dashi-ui/src/theme/surface.ts:26`). Add a `canvas` (content-behind-media) surface token and a `dark` flag on the palette.
- **Error copy that names packages** (poppler-utils, ImageMagick, wl-clipboard) shows up in Preview and probably elsewhere. Guideline: a missing dependency is packaging's bug, and the person sees what they can't do, not what to install.
- **Locale.** `toLocaleString("en-US")` in `preview/info.ts:27` and `sheets.tsx:18`. One shared number and byte formatter in `@dashi/ui` should follow the system locale.

## Where it stands (0.5.0, wave 2: Preview's page strip)

The big idea is built for PDFs and for a folder of pictures: one scrolling surface for a PDF's pages, rendered as they come near the screen, and one page strip in the sidebar for both kinds. Rotation is a view of the file Preview remembers (`apps/preview/memory.ts`), not a re-encode; Export writes a rotated copy.

Findings:

- [x] 1. A PDF is one surface: wheel and touchpad scroll (both ways once a page is wider), it opens fitted to the width (View › Zoom to Width; ❖9 fits a page), ↑ ↓ scroll and ← → page, Page Up/Down, Space and Home/End, only the pages near the screen are rendered (`layout.ts`, `document.ts`, `surface.tsx`, `pdf-doc.ts`). A drag selects text from poppler's word boxes (`text.ts`), Edit › Copy copies it and Select All selects the document. Find, links and the outline moved to `tasks/todo.md` (Preview, later).
- [x] 2. One line: no subtitle; the size and place sit on the toolbar row (`detail.ts`, done in 0.4.x) and Info.
- [x] 3. Drops open a file anywhere on the window; Open… is primary; the empty window lists up to five recent files (`states.tsx`), and File lists them under Open… (the menu bar has no submenus yet, so Open Recent is a run of rows).
- [x] 4. No toolbar with nothing open; Open With… and Show in Files are disabled without a file.
- [x] 5. A spinner shows in the toolbar after 200 ms of work (opening, pages in view, rotating, an export); opening says the file's name.
- [x] 6. Rotation sticks per file (kept with its size and date; forgotten if the file changes), PDFs rotate too, "Rotate" everywhere. Save Turned Copy is gone: Export writes the rotated copy. Writing the rotation into the file itself (lossless JPEG) moved to `tasks/todo.md`.
- [x] 7. Copy (the selected text, else the picture or the page in view), Export (PNG, JPEG with a quality, PDF; a PDF whole or a page as a picture), Print (the portal's print dialog, else CUPS's default printer after asking). Password PDFs, markup, crop, a slideshow and animated GIFs moved to `tasks/todo.md`.
- [x] 8. Bare keys only move around (`keys.ts`), each shown in a menu (← →, ⌫); ❖0 Actual Size, ❖9 Zoom to Fit; no bare letters (no `f` to Files, no `0`/`1`).
- [x] 9. Errors say what happened and what to do, never a package (`messages.ts`); the packages are the dashi RPM's dependencies (`spin/rpm/dashi.spec`).
- [x] 10. No footer and no floating note: how a picture is shown is a row in Info.
- [x] 11. The strip is a real navigator: only visible rows drawn, each at its page's shape, scrolled to the open one, a themed placeholder, 200 wide, 300 px thumbnails for 150 px rows, and a filmstrip of the folder's pictures (`strip.tsx`, `folder.ts`).
- [x] 12. No synchronous I/O on the render path: the file's facts come from the open's stat; the folder is listed once, asynchronously, and watched.
- [ ] 13. The device scale is still assumed 2: Metal doesn't report the window's scale yet (moved to `tasks/todo.md`). Thumbnails are now 300 px for a 150 px row.
- [x] 14. The canvas ground is `surface.canvas` and the empty window sits on it too; Open With hovers in a wash, shows each app's icon, and its list is one Tab stop the arrows move through.
- [x] 15. Info's heading is the file's name over `@dashi/ui`'s Group and Row; numbers, sizes and dates follow the system's locale.
- [x] 16. Every toolbar glyph has a tooltip and an accessible name; Actual Size is a "1:1"; "…" hangs from its own right edge.
- [ ] 17. One process and one window per file, as before; tabs and Open in New Window moved to `tasks/todo.md`.

Improvements 1–9 are in, but for ⌃-wheel and pinch zoom (Metal's wheel event carries no modifiers yet) and the device scale; 10 (markup) is later.
