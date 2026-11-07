/**
 * The gallery's pages: one per @dashi/ui control family, then the tokens,
 * in the sidebar's order; and which modes the exhibits are drawn in.
 */

export type PageId =
  | "buttons"
  | "pickers"
  | "switches"
  | "fields"
  | "progress"
  | "menus"
  | "alerts"
  | "rows"
  | "lists"
  | "notices"
  | "shortcuts"
  | "colors"
  | "grounds"
  | "tints"
  | "type";

export interface Page {
  id: PageId;
  label: string;
  section: "Controls" | "Tokens";
}

export const PAGES: readonly Page[] = [
  { id: "buttons", label: "Buttons", section: "Controls" },
  { id: "pickers", label: "Pickers", section: "Controls" },
  { id: "switches", label: "Switches and sliders", section: "Controls" },
  { id: "fields", label: "Fields", section: "Controls" },
  { id: "progress", label: "Progress", section: "Controls" },
  { id: "menus", label: "Menus", section: "Controls" },
  { id: "alerts", label: "Alerts", section: "Controls" },
  { id: "rows", label: "Rows and groups", section: "Controls" },
  { id: "lists", label: "Sidebars and tables", section: "Controls" },
  { id: "notices", label: "Notices and empty states", section: "Controls" },
  { id: "shortcuts", label: "Shortcuts and glyphs", section: "Controls" },
  { id: "colors", label: "Colors", section: "Tokens" },
  { id: "grounds", label: "Grounds", section: "Tokens" },
  { id: "tints", label: "Tints", section: "Tokens" },
  { id: "type", label: "Type", section: "Tokens" },
];

/** The page `by` steps from `id` (the arrow keys), stopping at the ends. */
export function stepPage(id: PageId, by: number): PageId {
  const at = PAGES.findIndex((page) => page.id === id);
  const next = Math.min(Math.max(at + by, 0), PAGES.length - 1);
  return PAGES[next]?.id ?? id;
}

export const pageLabel = (id: PageId): string => PAGES.find((page) => page.id === id)?.label ?? "";

/** What the exhibits are drawn in: one mode, or both side by side. The window itself follows Dark Mode. */
export type Mode = "light" | "dark" | "both";

export const MODES: ReadonlyArray<{ value: Mode; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "both", label: "Both" },
];

/** The modes a column is drawn for, left to right: `dark` true or false. */
export const columnsFor = (mode: Mode): boolean[] => (mode === "both" ? [false, true] : [mode === "dark"]);
