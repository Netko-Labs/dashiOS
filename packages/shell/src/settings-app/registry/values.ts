/**
 * How a row that is one value reads and changes: a key of a settings.json
 * section (through the settings store, which checks it again before it
 * writes), one of Control Center's switches, or the Dock's settings. And
 * what such a value is checked against and said as, for agents and links.
 */

import { DOCK_DEFAULTS, type DockSettings } from "../../dock/settings.ts";
import type { Flags } from "../../shared/control-center/flags.ts";
import type { Change, SectionName, SettingsData } from "../store.ts";
import type { Binding, ChoiceOption, RegistryStores, RowDef, SettingValue, ValueSchema } from "./types.ts";

const isSettingValue = (value: unknown): value is SettingValue => typeof value === "boolean" || typeof value === "string" || typeof value === "number";

/** The schema of a choice: its options' values. */
export function choiceSchema(options: readonly ChoiceOption[]): ValueSchema {
  const values = options.map((option) => option.value);
  const numbers = values.filter((value): value is number => typeof value === "number");
  return numbers.length === values.length ? { type: "number", enum: numbers } : { type: "string", enum: values.map(String) };
}

/** Whether `value` is one `schema` takes. */
export function accepts(schema: ValueSchema, value: unknown): value is SettingValue {
  switch (schema.type) {
    case "boolean":
      return typeof value === "boolean";
    case "string":
      return typeof value === "string" && schema.enum.includes(value);
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) return false;
      return "enum" in schema ? schema.enum.includes(value) : value >= schema.minimum && value <= schema.maximum;
  }
}

/** What is wrong with a value for `schema`, in the words the agents' tools use. */
export function wrongValue(schema: ValueSchema): string {
  switch (schema.type) {
    case "boolean":
      return "`value` must be true or false.";
    case "string":
      return `\`value\` must be one of: ${schema.enum.join(", ")}.`;
    case "number":
      return "enum" in schema
        ? `\`value\` must be one of: ${schema.enum.join(", ")}.`
        : `\`value\` must be a number from ${schema.minimum} to ${schema.maximum}.`;
  }
}

/** A value as the row says it: on or off, a choice's label, or the number. */
export function describeValue(row: Pick<RowDef, "options">, value: SettingValue): string {
  if (typeof value === "boolean") return value ? "on" : "off";
  return row.options?.find((option) => option.value === value)?.label ?? String(value);
}

interface FileOptions {
  /** This value is saved as no setting, the default (a scrolling speed of 1, Clipboard history on). */
  unset?: SettingValue;
}

/** A key of a settings.json section; `fallback` is what no setting means. */
export function stored<S extends SectionName>(
  section: S,
  key: keyof SettingsData[S] & string,
  fallback: SettingValue,
  schema: ValueSchema,
  options: FileOptions = {},
): Binding {
  return {
    schema,
    key: `${section}.${key}`,
    fallback,
    get: (stores) => {
      const value: unknown = (stores.settings.getSnapshot().data[section] as Record<string, unknown>)[key];
      return isSettingValue(value) ? value : fallback;
    },
    set: (stores, value) => {
      const saved = options.unset !== undefined && value === options.unset ? undefined : value;
      stores.settings.patch(section, { [key]: saved } as Change<S>);
    },
  };
}

/** A switch kept in settings.json. */
export const storedSwitch = <S extends SectionName>(section: S, key: keyof SettingsData[S] & string, fallback: boolean, options: FileOptions = {}): Binding =>
  stored(section, key, fallback, { type: "boolean" }, options);

/** A choice kept in settings.json, by its options' values. */
export const storedChoice = <S extends SectionName>(
  section: S,
  key: keyof SettingsData[S] & string,
  fallback: SettingValue,
  options: readonly ChoiceOption[],
  file: FileOptions = {},
): Binding => stored(section, key, fallback, choiceSchema(options), file);

/** A number in a range kept in settings.json. */
export const storedNumber = <S extends SectionName>(
  section: S,
  key: keyof SettingsData[S] & string,
  fallback: number,
  range: { min: number; max: number },
  file: FileOptions = {},
): Binding => stored(section, key, fallback, { type: "number", minimum: range.min, maximum: range.max }, file);

/**
 * One of Control Center's switches (Dark Mode, Do Not Disturb, Night Shift).
 * They live outside settings.json, so a change made through the registry is
 * told to the change log here (Settings › Recently changed, ❖Z).
 */
export function flag(key: keyof Flags): Binding {
  return {
    schema: { type: "boolean" },
    key: `flags.${key}`,
    fallback: false,
    get: (stores) => stores.flags.getSnapshot()[key],
    set: (stores, value) => {
      const from = stores.flags.getSnapshot()[key];
      stores.flags.set({ [key]: value === true });
      stores.settings.changes?.record([{ key: `flags.${key}`, from, to: value === true }]);
    },
  };
}

/** One of the Dock's settings: through the Dock's store where the shell runs one (it applies at once), else settings.json. */
export function dockSetting(key: keyof DockSettings, schema: ValueSchema): Binding {
  return {
    schema,
    key: `dock.${key}`,
    fallback: DOCK_DEFAULTS[key],
    get: (stores) => (stores.dock ? stores.dock.snapshot[key] : (stores.settings.getSnapshot().data.dock[key] ?? DOCK_DEFAULTS[key])),
    set: (stores, value) => {
      const change = { [key]: value } as Partial<DockSettings>;
      if (stores.dock) stores.dock.set(change);
      else stores.settings.patch("dock", change);
    },
  };
}

/** "Dark Mode is on.", "Set Window corners to Large.", or that it was so already. */
export function changedWords(row: Pick<RowDef, "title" | "name" | "options">, value: SettingValue, changed: boolean): string {
  const title = row.name ?? row.title;
  if (typeof value === "boolean") return `${title} is ${value ? "on" : "off"}${changed ? "" : " already"}.`;
  const shown = describeValue(row, value);
  return changed ? `Set ${title} to ${shown}.` : `${title} is ${shown} already.`;
}

/** The value a row holds now; null where it holds none (no binding, or nothing to read). */
export const valueOf = (row: Pick<RowDef, "value">, stores: RegistryStores): SettingValue | null => row.value?.get(stores) ?? null;
