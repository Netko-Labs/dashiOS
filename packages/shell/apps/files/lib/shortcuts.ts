/**
 * Files' keys, one table for the menu bar (appmenus.ts) and the context menus
 * (menus.ts), so a row shows the same key in both (UI-17, PA-8).
 */

export const KEYS = {
  newFolder: "⇧❖N",
  open: "❖O",
  info: "❖I",
  duplicate: "❖D",
  trash: "❖⌫",
  cut: "❖X",
  copy: "❖C",
  paste: "❖V",
  selectAll: "❖A",
  find: "❖F",
  viewIcons: "❖1",
  viewList: "❖2",
  hidden: "⇧❖.",
  refresh: "❖R",
  back: "❖[",
  forward: "❖]",
  goToFolder: "⇧❖G",
} as const;
