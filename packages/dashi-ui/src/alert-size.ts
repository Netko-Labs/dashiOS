/**
 * How tall an `AlertWindow` is with nothing to spare (vertical space is
 * sacred): Metal opens a window at the size it is given and can't fit it to
 * its content afterwards, so a portal's question and a `dashi-dialog`
 * message work their height out first, from alert.tsx's measures and the
 * text wrapped at its width. A longer text than guessed scrolls (the words
 * are a scroll view); the guesses lean wide so it rarely does.
 */

/** alert.tsx's `AlertWindow`, top to bottom. */
export const ALERT_WINDOW = {
  /** The window controls' strip over a unified window (dashi-comp's 38 px row). */
  strip: 38,
  /** Under the strip; a window with an ordinary title bar has `padding` instead. */
  top: 6,
  padding: 18,
  tile: 40,
  /** Between the tile and the words. */
  beside: 14,
  /** Between the question, the message, and anything under them. */
  wordsGap: 4,
  question: { line: 17, char: 7.2 },
  message: { line: 16, char: 6.3 },
  /** Above what the answer needs (a check box, a card). */
  extraTop: 6,
  /** Between the body and the buttons, and the buttons' own margin above them. */
  bodyGap: 10,
  buttonsTop: 6,
  button: 28,
} as const;

/** Lines `text` takes wrapped at `width` points, a word at a time, `char` points a character; a paragraph is at least one line. */
export function wrappedLines(text: string, width: number, char: number): number {
  if (text === "") return 0;
  const perLine = Math.max(Math.floor(width / char), 1);
  return text.split("\n").reduce((sum, paragraph) => {
    let lines = 1;
    let used = 0;
    for (const [index, word] of paragraph.split(" ").entries()) {
      const length = [...word].length;
      if (index > 0 && used + 1 + length <= perLine) {
        used += 1 + length;
        continue;
      }
      if (index > 0) lines++;
      // A word longer than a line breaks across lines.
      lines += Math.max(Math.ceil(length / perLine) - 1, 0);
      used = length > perLine ? length - (Math.ceil(length / perLine) - 1) * perLine : length;
    }
    return sum + lines;
  }, 0);
}

export interface AlertContent {
  question: string;
  message?: string;
  /** Height of what the answer needs under the message (check boxes, a card); none by default. */
  extra?: number;
}

/** The words' width in a window `width` wide: the padding and the tile beside them taken off. */
export const alertWordsWidth = (width: number): number => width - ALERT_WINDOW.padding * 2 - ALERT_WINDOW.tile - ALERT_WINDOW.beside;

/** The height of an `AlertWindow` `width` wide holding `content`; `unified` when the window controls sit over its top. */
export function alertWindowHeight(content: AlertContent, width: number, unified = true): number {
  const { strip, top, padding, tile, wordsGap, question, message, extraTop, bodyGap, buttonsTop, button } = ALERT_WINDOW;
  const words = alertWordsWidth(width);
  const parts = [
    wrappedLines(content.question, words, question.char) * question.line,
    wrappedLines(content.message ?? "", words, message.char) * message.line,
    content.extra ? extraTop + content.extra : 0,
  ].filter((part) => part > 0);
  const said = parts.reduce((sum, part) => sum + part, 0) + Math.max(parts.length - 1, 0) * wordsGap;
  const above = unified ? strip + top : padding;
  return Math.ceil(above + Math.max(tile, said) + bodyGap + buttonsTop + button + padding);
}
