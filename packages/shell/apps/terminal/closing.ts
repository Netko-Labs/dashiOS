/**
 * Closing a tab or a window that still runs something (a build, `ssh`,
 * `vim`) asks first: closing hangs it up, and that can't be undone. Pure:
 * which question, and its words; the view asks the engines (`running`) and
 * shows the sheet.
 */

export type CloseQuestion =
  /** One tab, its program's name ("" when it has none). */
  | { kind: "tab"; id: number; program: string }
  /**
   * The window: the programs still running in its tabs. `quit`: Terminal is
   * quitting (❖Q, Quit Terminal, logging out), not only this window closing.
   */
  | { kind: "window"; programs: readonly string[]; quit?: boolean };

export interface CloseCopy {
  title: string;
  message: string;
  confirmLabel: string;
}

/** Each tab's answer to `running`: null at the prompt. What the window's question names, in tab order. */
export function stillRunning(answers: readonly (string | null)[]): string[] {
  return answers.filter((answer): answer is string => answer !== null);
}

/**
 * What closing stops: “vim”, “vim” and “ssh”, else a count. Short enough that
 * the sheet's line never wraps onto a lone word: more than two names, or a
 * program with none, is counted instead.
 */
function stopped(programs: readonly string[]): string {
  const distinct = [...new Set(programs)];
  const named = distinct.length === programs.length && !distinct.includes("");
  if (named && distinct.length <= 2) return distinct.map((program) => `“${program}”`).join(" and ");
  return programs.length === 1 ? "a running program" : `${programs.length} running programs`;
}

export function closeCopy(question: CloseQuestion): CloseCopy {
  if (question.kind === "tab") {
    return { title: "Close this tab?", message: `Closing it stops ${stopped([question.program])}.`, confirmLabel: "Close tab" };
  }
  if (question.quit) {
    return { title: "Quit Terminal?", message: `Quitting stops ${stopped(question.programs)}.`, confirmLabel: "Quit" };
  }
  return { title: "Close this window?", message: `Closing it stops ${stopped(question.programs)}.`, confirmLabel: "Close window" };
}
