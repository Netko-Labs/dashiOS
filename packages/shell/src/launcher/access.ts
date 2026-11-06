/**
 * What a screen reader hears from the launcher (docs/betterments.html,
 * Newcomers and access): the field is a combobox, the results a listbox,
 * each row an option named the way it reads ("Wi-Fi, on, setting, 1 of 3"),
 * the picked one selected, so the reader announces it as the selection moves;
 * the answer reads "equals 12, Return copies", and what just happened
 * ("Copied") is said as it shows.
 *
 * These are props for the accessibility tree Metal publishes over AT-SPI
 * (mirin's patch: the host binary names `MIRIN_METAL_ACCESSIBLE`). With a
 * host that has none the launcher passes nothing, and draws the same.
 */

import type { Row } from "./row-model.ts";

/** What a host binary with an accessibility tree names. */
export const ACCESSIBLE_MARKER = "MIRIN_METAL_ACCESSIBLE";

/** Whether the host binary publishes an accessibility tree: it names `MIRIN_METAL_ACCESSIBLE`. */
export async function hostIsAccessible(binary: string): Promise<boolean> {
  try {
    const grep = Bun.spawn(["grep", "-aqF", ACCESSIBLE_MARKER, binary], { stdout: "ignore", stderr: "ignore" });
    return (await grep.exited) === 0;
  } catch {
    return false;
  }
}

/** A node's props for the tree (React Native's names, as the patch's @mirinjs/metal takes them). */
export interface Access {
  accessibilityRole?: "combobox" | "listbox" | "option" | "group" | "button" | "status";
  accessibilityLabel?: string;
  accessibilityState?: { selected?: boolean; checked?: boolean; expanded?: boolean };
  accessibilityLiveRegion?: "polite";
}

/** A row's kind as it is said ("Settings" is "setting"). */
const SPOKEN_KIND: Readonly<Record<string, string>> = {
  App: "app",
  Settings: "setting",
  Window: "window",
  Command: "command",
  Menu: "menu item",
  File: "file",
  Folder: "folder",
  Files: "Files",
  Software: "Software",
};

/** The words a screen reader says for `row`, the `position`th (from 1) of `count`. */
export function spokenRow(row: Row, position: number, count: number): string {
  const of = `${position} of ${count}`;
  if (row.id === "answer") {
    // "20 km =" before "12.43 mi": "20 km equals 12.43 mi".
    const asked = row.detail?.replace(/\s*=\s*$/, "");
    return [`${asked ? `${asked} ` : ""}equals ${row.title}`, row.kind === "Answer" ? "Return copies" : row.kind, of].join(", ");
  }
  const state = row.control?.kind === "switch" ? (row.control.on ? "on" : "off") : row.control?.kind === "value" ? row.control.text : null;
  const kind = SPOKEN_KIND[row.kind] ?? (row.kind === "" ? null : row.kind.toLocaleLowerCase());
  // A switch says its state, not what it is for; other rows say the words after their name.
  const detail = state === null ? row.detail : undefined;
  return [row.title, state, detail, kind, of].filter((part): part is string => typeof part === "string" && part !== "").join(", ");
}

export function rowAccess(row: Row, position: number, count: number, selected: boolean, expanded?: boolean): Access {
  return {
    accessibilityRole: "option",
    accessibilityLabel: spokenRow(row, position, count),
    accessibilityState: { selected, ...(expanded === undefined ? {} : { expanded }) },
  };
}

export const fieldAccess = (label: string, expanded: boolean): Access => ({
  accessibilityRole: "combobox",
  accessibilityLabel: label,
  accessibilityState: { expanded },
});

export const listAccess = (label: string): Access => ({ accessibilityRole: "listbox", accessibilityLabel: label });

export const groupAccess = (label: string): Access => ({ accessibilityRole: "group", accessibilityLabel: label });

/** A word on what just happened ("Copied"): said as it shows. */
export const noticeAccess = (text: string): Access => ({ accessibilityRole: "status", accessibilityLabel: text, accessibilityLiveRegion: "polite" });

/** A window's picture: "Notes — groceries, window 2 of 3". */
export function pictureAccess(title: string, position: number, count: number, selected: boolean): Access {
  return { accessibilityRole: "option", accessibilityLabel: `${title}, window ${position} of ${count}`, accessibilityState: { selected } };
}
