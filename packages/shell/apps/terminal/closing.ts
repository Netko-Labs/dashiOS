/**
 * Closing a tab or a window that still runs something (a build, `ssh`,
 * `vim`) asks first: closing hangs it up, and that can't be undone. Pure:
 * which question, and its words; the view asks the engines (`running`) and
 * shows the sheet.
 */

export type CloseQuestion =
  /** One tab, its program's name ("" when it has none). */
  | { kind: "tab"; id: number; program: string }
  /** The window: the programs still running in its tabs. */
  | { kind: "window"; programs: readonly string[] };

export interface CloseCopy {
  title: string;
  message: string;
  confirmLabel: string;
}

/** Each tab's answer to `running`: null at the prompt. What the window's question names, in tab order. */
export function stillRunning(answers: readonly (string | null)[]): string[] {
  return answers.filter((answer): answer is string => answer !== null);
}

const quoted = (program: string): string => (program === "" ? "A program" : `“${program}”`);

/** “a”, “a” and “b”, “a”, “b” and “c”; null unless every program has a name of its own. */
function names(programs: readonly string[]): string | null {
  const distinct = [...new Set(programs)];
  if (distinct.length !== programs.length || distinct.includes("")) return null;
  const marked = distinct.map((program) => `“${program}”`);
  return marked.length === 1 ? (marked[0] as string) : `${marked.slice(0, -1).join(", ")} and ${marked.at(-1)}`;
}

export function closeCopy(question: CloseQuestion): CloseCopy {
  if (question.kind === "tab") {
    return {
      title: "Close this tab?",
      message: `${quoted(question.program)} is still running. Closing the tab stops it.`,
      confirmLabel: "Close tab",
    };
  }
  const count = question.programs.length;
  const named = names(question.programs);
  const message =
    count === 1
      ? `${quoted(question.programs[0] ?? "")} is still running. Closing the window stops it.`
      : `${count} programs are still running${named ? `: ${named}` : ""}. Closing the window stops them.`;
  return { title: "Close this window?", message, confirmLabel: "Close window" };
}
