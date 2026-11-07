# Calculator

**The roast**

- The comment at the top of `view.tsx:3-4` says it out loud: "round as on the Mac since Sequoia". The screenshot (`calculator.png`) is exactly that calculator with its orange swapped for kombu. Brand's test is "would nobody mistake it for either?", and this one fails it on sight.
- You can type `1,000` and get `1.000`, because `,` is the decimal point on the keyboard (`keyboard.ts:16`) but the thousands separator on the display (`format.ts:13`). One key, two meanings, on the same screen.
- It has two paste features and they disagree. Ctrl+V types the clipboard one key at a time, so a `c` in the text clears the display. ❖V accepts only a clean number and does nothing at all when the text isn't one.
- The display's big "0" ends 6 px above the keypad, while the keys sit 10 px apart and about 38 px of empty display sits above the number (`calculator.png`, measured: glyph bottom y=285, AC row top y=292). The number is pressed against the keys.
- Zoom it to full screen and you get a 274 × 428 keypad floating in an empty grey field (`view.tsx:145-149`). Even so, the green zoom square in the screenshot is lit and ready to be pressed.
- No history, no memory, no scientific or programmer modes, and one menu (Edit). Day one, it's a 1980s pocket calculator with a nice finish.

## Findings

| # | Severity | Area | What's wrong | Evidence |
|---|---|---|---|---|
| 1 | P1 bad | Number input and format | `,` types a decimal point, but the display groups thousands with `,`. Typing "1,000" gives 1.000. Menu Paste strips commas, so a pasted "1,5" (a European 1.5) becomes 15. Ctrl+V of "Total: 1,234.50" fails `parsePasted` and is typed key by key, which gives **1.23450**. Nothing follows the locale. | `keyboard.ts:15-17`, `format.ts:12-14`, `format.ts:71-79`, `keyboard.ts:54-63` |
| 2 | P1 bad | Paste | There are two paste paths with different rules. Ctrl+V (the KeySink text path) types an expression character by character, so letters in the text act as keys: `c` clears, `x` multiplies. ❖V and Edit ▸ Paste take only a clean number and stay silent on anything else. Neither one shows that a paste happened. | `keyboard.ts:4-5,35-37,54-63`, `view.tsx:131-135` |
| 3 | P1 bad | Missing basics | No history or tape, no memory keys, no scientific or programmer mode, and no View menu to switch modes in. The app's only menu is Edit (Copy, Paste, Clear). | `menus.ts:20-30`; `calculator.png` menu bar shows Edit, Window, Help |
| 4 | P1 bad | Window size and resizing | The keypad is a fixed 274 × 428 block centered in the window, and the kit has no minimum, maximum or fixed size. Zoom or full screen leaves a tiny island. Shrinking presumably clips the keys (inferred: nothing stops it). The zoom control is offered anyway. | `view.tsx:26-29,145-149`, `kit/run.tsx:24-39`; zoom square lit in `calculator.png` |
| 5 | P2 meh | Display layout | The display's "0" sits 6 px above the keys, against 10 px between key rows, with about 38 px of dead space above it. Its right edge (x=936) is 10 px inside the keypad's edge (x=946), so it lines up with neither the ÷ key's edge nor its center (x=919). | `view.tsx:160-162` (`paddingHorizontal: PAD + 6`, `paddingBottom: 6`), `view.tsx:22`; measured in `calculator.png` |
| 6 | P2 meh | Feedback | Keys have only a hover color, with no pressed state. Typing on the keyboard never flashes the matching key, so the display is the only sign anything happened. Copy gives no confirmation. | `view.tsx:98-111` (`hoverBackgroundColor` only; Metal has no pressed style, `mirin-metal/src/types.ts:91`), `view.tsx:130` |
| 7 | P2 meh | Type scale | The top row mixes two sizes: ± is 26 because it counts as a "symbol", while AC and % are 19. In the screenshot ± looks heavier than its neighbors. | `view.tsx:96,113`; `calculator.png` top row |
| 8 | P2 meh | Color meaning | Operators are painted kombu, which the design defines as "yours, selected". The operator that actually *is* selected turns white with kombu ink, so the meaning flips. | `view.tsx:55-56,62-63`; design.html "One color, one job" |
| 9 | P2 meh | Tokens | All key and window colors are hard-coded hex. Light window `#ececef` doesn't match `surface.window` `#f5f5f7`, and dark `#1c1c1e` doesn't match `#1e1e20`. The hover colors `#357a64` and `#4fa085` are fixed instead of derived from the accent. Dark mode is detected by object identity (`colors === darkColors`). | `view.tsx:46-64`, `dashi-ui/src/theme/surface.ts:22-23` |
| 10 | P2 meh | Contrast | In light mode the digit keys are `#ffffff` on `#ececef` with no edge or shadow, so their outlines barely register. | `view.tsx:59-61`; `calculator.png` |
| 11 | P2 meh | Identity | The code describes itself as a copy: "as the Mac's basic calculator does it" and "round as on the Mac since Sequoia". The layout, the shapes and the white chosen operator are the same. | `engine.ts:2`, `view.tsx:3-4`; `calculator.png` |
| 12 | P2 meh | Precision | Entry is capped at 9 digits, "as on the Mac's basic calculator", even though the display shrinks its font down to 22 px and has room for roughly 15–18 digits. | `engine.ts:57-58`, `format.ts:85-90` |
| 13 | P3 polish | Keyboard | No key for ± (negate). No Delete. The keyboard map lives only in a code comment and isn't in any menu or help. | `keyboard.ts:12-41,43-66` |
| 14 | P3 polish | Copy | Copying 1 ÷ 3 puts `0.333333333333333` on the clipboard while the display shows `0.33333333`. What you copy isn't what you see, and nothing says so. | `format.ts:59-64` vs `format.ts:33-51` |
| 15 | P3 polish | Error copy | Dividing by zero and overflow both show the same bare "Error" at display size. It doesn't say what happened. | `format.ts:35,55`, `engine.ts:82,97` |
| 16 | P3 polish | Chrome | The design says an app with no toolbar controls takes the standard 28 px bar. Calculator runs unified instead, with the display as the drag area, and the window's name never appears anywhere. | `view.tsx:150-163`; design.html "Window chrome" |

## Improvements

1. **Follow the locale for separators and the decimal key.** *What:* Format the display with the locale's group and decimal characters. Map the keyboard's decimal key to the locale's decimal. Make paste locale-aware, and refuse ambiguous text (for example "1,234" in a comma-decimal locale) instead of guessing. *Why:* Finding 1 is a wrong answer, not a looks problem. *Size:* M. **Recommended**
2. **Use one paste behavior and show it.** *What:* Send ❖V and Ctrl+V through the same parser. Accept a number, or a small expression built from digits, operators and separators. Ignore all other letters instead of treating them as keys. Briefly highlight the display on paste and on copy. *Why:* Paste now depends on which key you used, and a stray `c` in pasted text clears your work. *Size:* S. **Recommended**
3. **Fix the display's spacing.** *What:* Set the display's bottom padding to `GAP` (10) and its right inset to `PAD` (14) so the number's right edge lines up with the keypad's edge. Reduce the empty band above it (`DISPLAY` 104 minus the title bar inset) or use that band for item 5. *Why:* It's the first thing the eye lands on, and right now it's jammed into the keys. *Size:* S. **Recommended**
4. **Make the window size behave.** *What:* Either fix the window's size (add `minSize`/`maxSize`/`resizable` to the kit and set them) and turn off zoom, or derive `KEY` from the window width so the keypad scales with it, with a sensible minimum. *Why:* Today zooming does nothing useful, and shrinking has nothing to stop it. *Size:* M. **Recommended**
5. **Add history.** *What:* Show the last results as a short tape above the current number, in the dead band and growing upward when the window is taller. Each line can be copied, and clicking one reuses it. Keep the history between launches. Add View ▸ Show History. *Why:* It's the most-missed basic feature and it fits the vertical-space rule (no new bar). *Size:* L. **Recommended**
6. **Give keys a pressed state, including from the keyboard.** *What:* Add a `pressedBackgroundColor` and flash the matching key for about 120 ms on keyboard input. *Why:* Typing should feel connected to the keypad you see. *Size:* S. Metal already sends raw key events (`onKeyDown` with key name and modifiers, `mirin-metal/src/types.ts:168-177,268`, which Terminal uses at `terminal/view.tsx:174,216`). Moving the Calculator from KeySink to `onKeyDown` also separates Ctrl+V from typed text and adds Delete.
7. **Move colors to tokens.** *What:* Use `surface.window`. Add palette entries for the key grounds and an `accentHover` derived from `selection`. Drop the identity check for dark mode. *Why:* It should match the other apps and survive a future accent choice. *Size:* S.
8. **Make the look Dashi's own, and keep kombu's meaning.** *What:* Draw operators as neutral tiles with ink glyphs. Mark the chosen operator with kombu, since it is the selection. Keep a kombu fill only on "=". Consider rounded-square keys that echo the zoom control's square. *Why:* It follows "one color, one job", and nobody would mistake it for the Mac's calculator. *Size:* M.
9. **Add modes.** *What:* View ▸ Basic / Scientific / Programmer. The window widens to the left for more columns and never adds a second bar. *Why:* People expect it from a desktop calculator. *Size:* L.
10. **Small fixes.** *What:* Raise the digit cap to what the display can fit (12–15). Add `n` (or ⌥-) for ±, and Delete. Show "Can't divide by 0" in smaller type in place of "Error". Make Copy copy what is shown, and add a separate "Copy full precision". *Size:* S.

## One big idea

**Make the display an editable expression line with a live result.** Show the whole sum as it's typed ("1,250 × 12 + 340"), with the running answer in muted text underneath and finished lines scrolling up into a tape in the space that's empty today. Every line can be copied, clicked back into, and is remembered across launches. The keypad stays for the pointer, but the keyboard becomes the main way in. That shows the order of operations (the engine's "2 + 3 × 4 = 14" stops being invisible), makes paste make sense, fixes the dead space, and leaves the Mac's calculator behind without adding any chrome.

## Cross-app notes

- **The kit has no window-size constraints.** `AppOptions` (`kit/run.tsx:24-39`) takes only `size`. Fixed-layout apps (Calculator, dialogs) need `minSize`/`maxSize`/`resizable`, and a way to turn off the zoom control.
- **KeySink is out of date.** Its header says Metal reports keys only through a hidden text input, with no left/right arrows and no modifiers (`dashi-ui/src/keys.ts:1-18`). Metal now has `onKeyDown` with key names, modifiers and repeat (`mirin-metal/src/types.ts:168-177,268`), and Terminal already uses it (`terminal/view.tsx:174,216`). `@dashi/ui` should offer a key hook built on `onKeyDown` so that apps get arrows, modifiers, Delete and a real paste chord, and should retire the filler-buffer trick.
- **Theme checks by identity** (`useColors() === darkColors`) appear in `calculator/view.tsx:48`, `preview/canvas.tsx:26` and `dashi-ui/src/theme/surface.ts:26`. The palette should expose a `dark` flag, plus tokens for "control ground", "control ground, secondary" and `accentHover`, so apps stop inventing hex values.
- **Kombu is being used as decoration.** The design gives kombu one job ("yours, selected"). The guidelines should state that accent fills are for selection and the one primary action, not for a category of controls.
- **Numbers need a shared, locale-aware formatter.** Calculator (`format.ts:13`) and Preview (`info.ts:27`, `toLocaleString("en-US")`) both hard-code en-US grouping. `@dashi/ui` should own it.
- **Controls need a pressed state.** Metal views here have `hoverBackgroundColor` but no pressed color, so no `@dashi/ui` control shows a press. The design page should specify one.

## Status (0.5.0, wave 2: the expression line)

The big idea is in: the display is an editable expression line (mirin's
text field, KB-6) with what it works out to under it, and a tape beside the
keypad (View ▸ Show Tape, ❖T) that widens the window, remembered between
launches with the window's size (`apps/calculator/line.ts`, `tape.tsx`,
`store.ts`).

- [x] 1 Locale: the line, the keys, copy and paste follow the region (since `54e902f`; the line groups as it is typed).
- [x] 2 Paste: one reader for every paste (❖V in the line, Edit ▸ Paste, the display's menu): a number, or a sum of numbers, operators and brackets; anything with letters is refused whole and the line says so. Nothing is typed key by key.
- [x] 3 Basics: a tape (click a row to use its result, right-click to copy it or edit the sum, ↑ ↓ to walk it, Clear) and a View menu. Memory keys and Scientific/Programmer modes are not in 0.5.0's plan (`docs/0.5.0.html`); they stay here for a later one.
- [x] 4 Window size (LA-3): a minimum of 274 × 440 (the kit's `minSize`, mirin's `MIRIN_METAL_MIN_SIZE`); past it the keys grow with the window, so zoom gives a bigger keypad. The size is remembered.
- [x] 5 Display: the line ends at the keypad's edge and sits a gap above it. Its width follows an estimate of the text's (a field can't right-align its text), so its right edge can be a few px off.
- [x] 6 Feedback: keys deepen while held and light for 120 ms when typed on the keyboard; Copy Result says "Copied".
- [x] 7 Type scale: C, ± and % are one size.
- [x] 8 Color meaning: kombu only on =; the waiting operator is in the line.
- [x] 9 Tokens: every color from the palette and surfaces (since `54e902f`).
- [x] 10 Contrast: digit keys carry an edge (since `54e902f`; CO-6's 3:1 edges are Wave 4).
- [x] 11 Identity: no comment says Mac; a sum you can read and edit and a tape are not the Mac's calculator.
- [x] 12 Precision: 15 digits, what a double holds; a result stays exact when the next sum goes on from it (1 ÷ 3 × 3 is 1).
- [x] 13 Keyboard: n for ±, ⌫ ⌦ and the arrows as in any field, ↑ ↓ for the tape, Esc to clear (the map is `keys.ts`'s header and the menus' rows; a Help page for it is the shortcut sheet's, not this app's).
- [x] 14 Copy: what is copied is what is shown, ungrouped (Copy Result, ⇧❖C); text selected in the line copies as it is.
- [x] 15 Errors: "Can't divide by 0" and "Too large to work out", in ume, under the line.
- [x] 16 Chrome: kept unified by decision: the display's band is the one chrome row (vertical space), and the tape's head shares it; the menu bar names the app.
