/**
 * Where a launcher run's question shows, one place at a time (docs/actions.md,
 * "Agents from the launcher"): on its card in the menu bar's panel while the
 * panel is open, else in the existing sheet (or the hand-over banner), the
 * first time with a notification. Opening the panel takes the sheet down;
 * closing it unanswered puts the sheet back. The first answer, from either
 * place, settles the question and the other comes down; a later one doesn't
 * count. Pure: questions.ts carries out what each step says.
 */

/** What to do now: put the sheet up or take it down, and post the notification. */
export interface RouteStep {
  sheet?: "show" | "hide";
  notify?: true;
}

/** Who settled it: the person in the panel or the sheet, or nobody (the agent gave up, the run ended). */
export type SettledBy = "panel" | "sheet" | "gone";

export class QuestionRoute {
  private sheetUp = false;
  private noticed = false;
  private by: SettledBy | null = null;

  /** The question arrives: in the panel if it is open, else in a sheet with a notification. */
  start(panelOpen: boolean): RouteStep {
    return panelOpen ? {} : this.showSheet();
  }

  /** The panel opened: the question is on its card, so the sheet comes down. */
  panelOpened(): RouteStep {
    if (this.by || !this.sheetUp) return {};
    this.sheetUp = false;
    return { sheet: "hide" };
  }

  /** The panel closed with the question still open: the sheet goes (back) up. */
  panelClosed(): RouteStep {
    if (this.by || this.sheetUp) return {};
    return this.showSheet();
  }

  /** An answer, or the question taken back: `counts` only for the first; whatever still shows comes down. */
  settle(by: SettledBy): { counts: boolean; step: RouteStep } {
    if (this.by) return { counts: false, step: {} };
    this.by = by;
    const hide = this.sheetUp && by !== "sheet";
    this.sheetUp = false;
    return { counts: true, step: hide ? { sheet: "hide" } : {} };
  }

  /** Who settled it, or null while it is open. */
  get settledBy(): SettledBy | null {
    return this.by;
  }

  /** Whether the sheet is up now. */
  get sheetShown(): boolean {
    return this.sheetUp;
  }

  private showSheet(): RouteStep {
    this.sheetUp = true;
    if (this.noticed) return { sheet: "show" };
    this.noticed = true;
    return { sheet: "show", notify: true };
  }
}
