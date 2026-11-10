/**
 * Every row of System Settings, once. The panes draw them (setting.tsx), the
 * launcher and links find them (actions/lib/sources/settings.ts), Spot lights
 * them, and the agents' get_settings and set_setting take the ones named
 * for agents.
 */

import { INPUT_ROWS } from "./lib/input.ts";
import { LOOK_ROWS } from "./lib/look.ts";
import { MACHINE_ROWS } from "./lib/machine.ts";
import { YOU_ROWS } from "./lib/you.ts";
import type { RowDef } from "./types.ts";

const ALL = [...LOOK_ROWS, ...INPUT_ROWS, ...MACHINE_ROWS, ...YOU_ROWS] as const;

/** A row's id, `<pane>/<row>`: a pane can only draw a row that is here. */
export type SettingId = (typeof ALL)[number]["id"];

export const SETTINGS_ROWS: readonly RowDef[] = ALL;

const BY_ID = new Map<string, RowDef>(SETTINGS_ROWS.map((row) => [row.id, row]));

/** The row with `id`; ids are checked when the pane is typechecked, so it is always there. */
export function settingRow(id: SettingId): RowDef {
  const row = BY_ID.get(id);
  if (!row) throw new Error(`no settings row ${id}`);
  return row;
}

/** The row at `<pane>/<row>`, from an address or a request. */
export const findRow = (id: string): RowDef | undefined => BY_ID.get(id);

/** Where a row is: its pane, and its id in the pane (the address's last part). */
export function rowPlace(row: Pick<RowDef, "id">): { pane: string; row: string } {
  const slash = row.id.indexOf("/");
  return { pane: row.id.slice(0, slash), row: row.id.slice(slash + 1) };
}

/** How a row reads away from its pane: the launcher's title, and what agents are told. */
export const rowName = (row: Pick<RowDef, "title" | "name">): string => row.name ?? row.title;

/** The rows agents may read and change, by their `set_setting` name. */
export const AGENT_ROWS: readonly RowDef[] = SETTINGS_ROWS.filter((row) => row.agent !== undefined && row.value !== undefined);

/** The row agents call `name`. */
export const agentRow = (name: unknown): RowDef | undefined => AGENT_ROWS.find((row) => row.agent === name);
