// The design checks' lists (H21 to H24, docs/conventions.md "Hard rules"): one shrink-only list per
// workstream of the 0.10 design plan (W1 to W7), so the branches that empty them never edit the same
// file. A check finds its offences as `file -> count`; `byWorkstream` splits them by the workstream
// that owns the file and holds each part to `scripts/lists/<check>/<W>.txt` (scripts/ratchet.ts).
// `--seed` writes the lists from today's offenders once, when a check comes in; it refuses to
// overwrite a list that exists.

import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { type Counts, listPath, type Outcome, ratchet, writeList } from "./ratchet.ts";

export const WORKSTREAMS = ["W1", "W2", "W3", "W4", "W5", "W6", "W7"] as const;
export type Workstream = (typeof WORKSTREAMS)[number];

const SHELL = "packages/shell/src/";
const APPS = "packages/shell/apps/";

/** Which workstream owns a path, first match wins (the plan's tools/owners.py). */
const OWNERS: ReadonlyArray<[Workstream, readonly string[]]> = [
  [
    "W7",
    ["packages/greeter/", "packages/dashi-ui/src/login-screen", `${SHELL}lock/`, `${SHELL}widgets/lock`, `${SHELL}widgets/glance`, `${SHELL}shared/time/`],
  ],
  ["W1", ["packages/dashi-ui/", `${SHELL}shared/controls/`, `${APPS}components/`, `${SHELL}shared/appearance/`, `${SHELL}theme.ts`, `${SHELL}shared/inks/`]],
  [
    "W2",
    [
      ...["consent", "force-quit/", "menus/lib/sheets", "menus/lib/power-sheets", "polkit/", "wifi/", "bluetooth/", "agent-sheets/"].map((p) => SHELL + p),
      ...["approval-sheet", "confirm-sheet", "actions/", "sheet.tsx", "accounts/", "shared/applet-store/consent-sheet", "region/"].map((p) => SHELL + p),
      ...["share-picker/", "display-config/"].map((p) => SHELL + p),
    ],
  ],
  [
    "W4",
    ["settings-app/", "settings/", "shared/cards/", "control-center/", "battery/", "sound/", "graphics/", "night-shift", "appearance/"].map((p) => SHELL + p),
  ],
  [
    "W5",
    [
      ...["files/", "preview/", "notes/", "editor/", "terminal/", "calculator/", "kit/"].map((p) => APPS + p),
      `${SHELL}shared/file-browser/`,
      `${SHELL}shared/markdown/`,
    ],
  ],
  [
    "W6",
    [
      ...["calendar/", "activity-monitor/", "software/", "installer/", "dialog/", "portal/"].map((p) => APPS + p),
      `${SHELL}shared/software/`,
      `${SHELL}shared/applet-store/`,
    ],
  ],
  ["W3", [SHELL]],
];

/** The workstream that owns `file` (W1 for anything else: the kit's). */
export function ownerOf(file: string): Workstream {
  for (const [workstream, prefixes] of OWNERS) if (prefixes.some((prefix) => file.startsWith(prefix))) return workstream;
  return "W1";
}

/** Today's offences, split by the workstream that owns each file. */
export function splitByOwner(found: Counts): Map<Workstream, Counts> {
  const parts = new Map<Workstream, Counts>(WORKSTREAMS.map((each) => [each, new Map()]));
  for (const [file, count] of found) parts.get(ownerOf(file))?.set(file, count);
  return parts;
}

/** Hold each workstream's part of `found` to its list, `<check>/<W>`. */
export function byWorkstream(check: string, found: Counts, what: string, header: string[]): Outcome[] {
  const parts = splitByOwner(found);
  if (process.argv.includes("--seed")) seed(check, parts, header);
  return WORKSTREAMS.map((workstream) => ratchet(`${check}/${workstream}`, parts.get(workstream) ?? new Map(), what));
}

function seed(check: string, parts: Map<Workstream, Counts>, header: string[]): void {
  for (const workstream of WORKSTREAMS) {
    const name = `${check}/${workstream}`;
    const path = listPath(name);
    if (existsSync(path)) throw new Error(`${path} exists: a list is seeded once, then only shrinks`);
    mkdirSync(dirname(path), { recursive: true });
    writeList(name, header, parts.get(workstream) ?? new Map());
  }
}

/** The counts per workstream a check's lists hold, for its summary line. */
export function listedCounts(outcomes: readonly Outcome[]): string {
  return outcomes.map((outcome) => `${outcome.name.split("/").pop()} ${outcome.listed}`).join(" · ");
}
