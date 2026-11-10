/**
 * The settings registry's shapes: one entry per row of System Settings, at
 * `dashi://settings/<pane>/<row>`. A pane draws its rows from here
 * (setting.tsx), and the launcher, links, Spot and the agents' tools read
 * the same entries (actions/lib/sources/settings.ts, agents/tools/lib/settings.ts),
 * so a row added to a pane is found everywhere.
 */

import type { DockPrefs } from "../../dock/prefs.ts";
import type { FlagsStore } from "../../shared/control-center/index.ts";
import type { PaneId } from "../../shared/settings/index.ts";
import type { SettingsStore } from "../store.ts";

/** What a row is: a switch, one of a few choices, a value (a number, a text, a reading), or something to do (a button). */
export type RowKind = "switch" | "choice" | "value" | "action";

/** One value a row holds, as an agent or a link gives it. */
export type SettingValue = boolean | string | number;

/** Where the values live: settings.json, Control Center's switches, and the Dock's settings as the shell runs them. */
export interface RegistryStores {
  /** Its change log (`changes`) hears the switches kept outside the file (Control Center's), so they are listed and undone too. */
  settings: Pick<SettingsStore, "getSnapshot" | "patch"> & Partial<Pick<SettingsStore, "changes">>;
  flags: Pick<FlagsStore, "getSnapshot" | "set">;
  /** Applies a change at once and writes it to settings.json (dock/prefs.ts); without it the file is written and the shell follows. */
  dock?: Pick<DockPrefs, "snapshot" | "set">;
}

/** The values a row takes, as JSON Schema (what agents and links are told). */
export type ValueSchema =
  | { type: "boolean" }
  | { type: "string"; enum: readonly string[] }
  | { type: "number"; enum: readonly number[] }
  | { type: "number"; minimum: number; maximum: number };

/** A row that is one value: how it reads and changes, through the stores the pane uses. */
export interface Binding {
  schema: ValueSchema;
  /**
   * Where the value is kept, as Settings' change log names it
   * (settings-app/changes/): `<section>.<key>` of settings.json,
   * `flags.<key>` for Control Center's switches.
   */
  key: string;
  /** What no setting means (the value shown while the file holds none). */
  fallback?: SettingValue;
  /** Null where there is nothing to read (no Dock). */
  get(stores: RegistryStores): SettingValue | null;
  /** `value` has been checked against `schema` (registry/values.ts `accepts`). */
  set(stores: RegistryStores, value: SettingValue): void;
}

export interface ChoiceOption {
  value: string | number;
  label: string;
}

export interface RowDef {
  /** `<pane>/<row>`: the row's address without `dashi://settings/`. */
  id: `${PaneId}/${string}`;
  /** As the pane's row says it. */
  title: string;
  /** How it reads away from its pane, in the launcher and to agents, when the title leans on the pane ("Mode" in Graphics). */
  name?: string;
  /** The quieter line under the title; a pane may show a live one instead. */
  detail?: string;
  /**
   * The glyph on its row's knob (shared/settings/knob-glyphs.ts), which the search's result
   * carries too. A row in a card of plain facts or a list has none, and every
   * row of a card has one or none does (row.tsx, one left edge).
   */
  glyph?: string;
  /**
   * The setting this row is a part of (Night Shift's hours, the charge limit's
   * slider): the search lists that setting once, and this row only when the
   * words find it and not its setting.
   */
  partOf?: string;
  /** Other words it is found by, lowercase. */
  keywords?: readonly string[];
  kind: RowKind;
  /** The control sits under the label, not beside it. */
  stack?: true;
  /** A choice's pills, in order. */
  options?: readonly ChoiceOption[];
  /** Where it is one value: read and changed through the settings store (or Control Center's switches). */
  value?: Binding;
  /** The value is a factor ("2×": a scrolling speed), as the launcher's row shows it. */
  factor?: true;
  /** Its name in the agents' `get_settings` and `set_setting`; rows without one are the person's alone. */
  agent?: string;
  /** Another action source puts it in the launcher (the radios, the clipboard), so the settings source leaves it out. */
  source?: "controls" | "clipboard";
}
