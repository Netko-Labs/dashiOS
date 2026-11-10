/**
 * Rows from outside Dashi, as data (launcher/extensions.ts draws them in):
 * what a search provider found (GNOME's SearchProvider2), what an applet's
 * pick command offers, what a command answered, and the room a view takes.
 * Pure, so the tests read it.
 *
 * The rules (docs/betterments.html, "Per-source time budgets"):
 * - They come after every instant row, under a head that names where they
 *   came from ("Characters"), so nothing above them moves when they land.
 * - A source past its 80 ms says so on its head ("Characters · slow"), and
 *   is dropped for the session after three misses (budget.ts).
 * - Their rows say where they came from, never wear Dashi's glyph, and run
 *   as the person, through the registry's runner.
 */

import { type ActionDef, type Outcome, type PickRow, ready } from "../actions/index.ts";
import type { SlowSnapshot } from "./budget.ts";
import type { LauncherItem } from "./items.ts";
import { ROW_HEIGHT } from "./row-view.tsx";
import type { Row, RowIcon, Section } from "./rows.ts";

/** One row a slow source found: what it says, and what choosing it does. */
export interface SlowRow {
  id: string;
  title: string;
  detail?: string;
  /** A full-color icon path (the provider's app). */
  icon?: string;
  run(): Promise<Outcome>;
}

/** A puzzle piece: a row from outside Dashi with no icon of its own (never Dashi's mark). */
export const EXTENSION_GLYPH = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M6 2.5a1.5 1.5 0 0 1 3 0V4h3v3h-1.5a1.5 1.5 0 0 0 0 3H12v3.5H3V10h1.5a1.5 1.5 0 0 0 0-3H3V4h3z" fill="none" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
/** A prompt: one of your own scripts. */
export const SCRIPT_GLYPH = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M3 4.5 6.5 8 3 11.5M8 12h5" fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** The icon of a row from outside: its own picture when it has one, else the puzzle piece (scripts, the prompt). */
export function outsideIcon(icon: string | undefined, source: string): RowIcon {
  if (icon?.startsWith("/")) return { image: icon };
  return { glyph: source === "scripts" ? SCRIPT_GLYPH : EXTENSION_GLYPH };
}

/**
 * An action no source lists, for a row that runs once: a provider's result,
 * a pick command's row. The runner logs it under `address` (whose it was).
 */
export function onceAction(address: string, title: string, from: string, run: () => Promise<Outcome>): ActionDef {
  return {
    address,
    title,
    description: "",
    keywords: {},
    kind: "run",
    properties: {},
    scope: null,
    readOnly: false,
    destructive: false,
    who: "person",
    source: "extensions",
    from,
    check: () => ready(run),
  };
}

/** A row that runs once, as the launcher draws it: Return runs it (and nothing else: it has no address of its own). */
export function onceRow(id: string, row: { title: string; detail?: string }, from: string, icon: RowIcon, action: ActionDef): Row {
  const item: LauncherItem = { id, kind: "command", names: [row.title], foreign: true, action };
  return {
    id,
    title: row.title,
    ...(row.detail ? { detail: row.detail } : {}),
    kind: from,
    icon,
    action: { kind: "run", item },
    group: "other",
  };
}

/** A segment from any id ("org.gnome.Characters.BackgroundService" stays, "a b" is "a-b"). */
const segmentOf = (id: string): string => id.replace(/[^A-Za-z0-9._:-]+/g, "-").slice(0, 120) || "source";

/** The sections the slow sources' answers make, below everything else: one per source with rows, its head saying when it is slow. */
export function slowSections(snapshot: SlowSnapshot<SlowRow> | null, icons: ReadonlyMap<string, string | undefined> = new Map()): Section[] {
  if (!snapshot) return [];
  return snapshot.sources.flatMap((source): Section[] => {
    const state = source.state;
    const rows = state.kind === "answered" ? state.rows : [];
    if (rows.length === 0) return [];
    const address = `dashi://search/${segmentOf(source.id)}`;
    return [
      {
        id: `slow:${source.id}`,
        title: source.label,
        ...(state.kind === "answered" && state.isLate ? { aside: "slow" } : {}),
        rows: rows
          .slice(0, 3)
          .map((row) =>
            onceRow(
              `slow:${source.id}:${row.id}`,
              row,
              source.label,
              outsideIcon(row.icon ?? icons.get(source.id), "search"),
              onceAction(address, row.title, source.label, row.run),
            ),
          ),
      },
    ];
  });
}

/** A pick command's rows, from its one slow source: the rows, or a word on why there are none yet. */
export function pickSection(
  snapshot: SlowSnapshot<PickRow> | null,
  pick: { title: string; from: string; icon: RowIcon; address: string; isDropped: boolean; choose(row: PickRow): Promise<Outcome> },
): Section {
  const state = snapshot?.sources[0]?.state;
  const note = (id: string, title: string): Row => ({ id, title, kind: "", icon: pick.icon, action: { kind: "type", query: "" } });
  if (pick.isDropped) return { id: "pick", rows: [note("pick:dropped", `${pick.from} isn't answering`)] };
  if (!state || state.kind === "waiting") return { id: "pick", rows: [], reserved: 1 };
  if (state.kind === "slow") return { id: "pick", rows: [note("pick:slow", `${pick.from} is taking a while…`)] };
  if (state.kind === "failed") return { id: "pick", rows: [note("pick:failed", `${pick.from} couldn't answer`)] };
  if (state.rows.length === 0) return { id: "pick", rows: [note("pick:none", "Nothing here")] };
  return {
    id: "pick",
    ...(state.isLate ? { title: pick.title, aside: "slow" } : {}),
    rows: state.rows.map((row) =>
      onceRow(
        `pick:${row.id}`,
        row,
        pick.from,
        pick.icon,
        onceAction(pick.address, row.title, pick.from, () => pick.choose(row)),
      ),
    ),
  };
}

/** A command's answer as the top row: in SemiBold, where it came from at the right; Return copies it. */
export function resultRow(text: string, from: string, icon: RowIcon): Row {
  return { id: "result", title: text, kind: from, icon, action: { kind: "copy", text }, strong: true, group: "answer" };
}

/** The room a view takes in the list: whole rows (at the text size's row height), so the panel's measures hold. */
export function viewRows(height: number, row: number = ROW_HEIGHT): number {
  return Math.max(1, Math.min(10, Math.ceil(height / row)));
}

/** A command that needs words first: the row that says what is asked for, and what Return does with it. */
export function argRow(prompt: string, typed: string, from: string, icon: RowIcon, last: boolean): Row {
  return {
    id: "arg",
    title: typed.trim() === "" ? prompt : typed.trim(),
    detail: last ? "Return runs it" : "Return goes on",
    kind: from,
    icon,
    action: { kind: "type", query: typed },
  };
}
