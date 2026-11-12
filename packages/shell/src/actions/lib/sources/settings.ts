/**
 * Settings as actions, from the settings registry (settings-app/registry/):
 * every pane at `dashi://settings/<pane>`, and every row of every pane at
 * `dashi://settings/<pane>/<row>`. A row that is one switch or one value
 * changes in place: a toggle with its state, or a pick of values. One
 * agents may change too runs the same `set_setting` call an agent makes, as
 * the person, so the launcher's switch, a key, a link, and an agent are one
 * change with one set of checks; the person's own rows change through the
 * registry's store directly, with the registry's checks. Any other row
 * opens Settings at it, scrolled to and lit.
 *
 * A settings address with no arguments, from a link, opens the pane at the
 * row and lights it up (`place`); with `?value=…` it sets it.
 */

import { parseCall } from "../../../agents/tools/registry.ts";
import {
  accepts,
  changedWords,
  describeValue,
  type RowDef,
  rowName,
  rowPlace,
  SETTINGS_ROWS,
  type SettingValue,
  type ValueSchema,
  wrongValue,
} from "../../../settings-app/registry/index.ts";
import { PANE_KEYWORDS } from "../../../settings-app/search.ts";
import { PANES } from "../../../shared/settings/index.ts";
import { formatAddress } from "../../address.ts";
import { type ActionContext, type ActionDef, type ActionKind, type ActionState, failed, invalid, type Outcome, ok, ready } from "../../types.ts";

export interface SettingsDeps {
  /** What a row holds now; null where it holds no value (no Dock, no stores). */
  state(row: RowDef): ActionState;
  /** Change a row the person alone changes; `value` is checked already. Absent: such rows only open. */
  set?(row: RowDef, value: SettingValue): void;
  /** Open System Settings at `pane`, scrolled to `row` and lighting it up. */
  open(pane: string, row?: string): void;
}

/** A row's action kind: a switch toggles and a value picks when it can be changed here; anything else opens. */
function kindOf(row: RowDef, settable: boolean): ActionKind {
  if (!settable || !row.value) return "open";
  return row.kind === "switch" ? "toggle" : "pick";
}

const valueProperty = (schema: ValueSchema): Record<string, unknown> =>
  schema.type === "boolean" ? { type: "boolean", description: "On or off; left out, it switches." } : { ...schema };

/** A row as the launcher finds it: by its title, its name away from the pane, its words, and an agent's name for it. */
const keywordsOf = (row: RowDef): string[] => [
  ...new Set([row.title.toLowerCase(), rowName(row).toLowerCase(), ...(row.keywords ?? []), ...(row.agent ? [row.agent.replaceAll("_", " ")] : [])]),
];

/** One row's action: run with `value`, or, for a toggle, with none to flip it; a row that can't be changed here opens Settings at it. */
export function rowAction(row: RowDef, deps: SettingsDeps): ActionDef {
  const place = rowPlace(row);
  const title = rowName(row);
  const settable = row.value !== undefined && (row.agent !== undefined || deps.set !== undefined);
  const kind = kindOf(row, settable);
  const base = {
    address: formatAddress(["settings", place.pane, place.row]),
    title,
    description: "",
    keywords: { en: keywordsOf(row) },
    kind,
    who: "person",
    source: "settings",
    destructive: false,
    place,
  } as const;
  const binding = row.value;
  if (kind === "open" || !binding) {
    return {
      ...base,
      properties: {},
      scope: null,
      readOnly: true,
      check: () =>
        ready(async () => {
          deps.open(place.pane, place.row);
          return ok(`${title} is shown in Settings.`);
        }),
    };
  }
  const toggle = kind === "toggle";
  const change = (value: SettingValue, ctx: ActionContext): Promise<Outcome> => (row.agent ? viaTool(row, value, ctx) : direct(row, value, deps));
  return {
    ...base,
    properties: { value: valueProperty(binding.schema) },
    ...(toggle ? {} : { required: ["value"] }),
    scope: row.agent ? "settings" : null,
    readOnly: false,
    idempotent: !toggle,
    state: () => shownState(row, deps.state(row)),
    check(args) {
      if (toggle && args.value === undefined) {
        return ready(async (ctx) => {
          const now = deps.state(row);
          if (typeof now !== "boolean") return failed(`${title} isn't here.`);
          return change(!now, ctx);
        });
      }
      if (!accepts(binding.schema, args.value)) return invalid(wrongValue(binding.schema));
      const value = args.value;
      return ready((ctx) => change(value, ctx));
    },
  };
}

/** A row's state as its launcher row shows it: a switch's on or off, a factor as a number ("2×"), anything else in its words ("Large"). */
function shownState(row: RowDef, state: ActionState): ActionState {
  if (typeof state === "boolean" || state === null) return state;
  if (typeof state === "number" && row.factor) return state;
  return describeValue(row, state);
}

/** A row agents may change: the same `set_setting` call an agent makes, as the person. */
async function viaTool(row: RowDef, value: SettingValue, ctx: ActionContext): Promise<Outcome> {
  const call = parseCall({ name: "set_setting", arguments: { name: row.agent, value } });
  if ("arguments" in call || "unknown" in call) return failed(`${rowName(row)} can't be set to ${String(value)}.`);
  if (!ctx.tool) return failed("Settings can't be changed in this session.");
  const result = await ctx.tool(call);
  const words = result.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(" ");
  return result.isError ? failed(words) : ok(words);
}

/** A row the person alone changes: through the registry's store. */
async function direct(row: RowDef, value: SettingValue, deps: SettingsDeps): Promise<Outcome> {
  if (!deps.set) return failed(`${rowName(row)} can't be changed here.`);
  try {
    deps.set(row, value);
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error));
  }
  return ok(changedWords(row, value, true));
}

/** Every pane, opening System Settings there. */
export function paneActions(open: SettingsDeps["open"]): ActionDef[] {
  return PANES.map(
    (pane): ActionDef => ({
      address: formatAddress(["settings", pane.id]),
      title: pane.title,
      description: "System Settings",
      keywords: { en: [...pane.id.split("-"), ...(PANE_KEYWORDS[pane.id] ?? []), "settings"] },
      kind: "open",
      properties: {},
      scope: null,
      readOnly: true,
      destructive: false,
      who: "person",
      source: "settings",
      place: { pane: pane.id },
      check: () =>
        ready(async () => {
          open(pane.id);
          return ok(`${pane.title} is open.`);
        }),
    }),
  );
}

/** The panes, then every row (but those another source lists: the radios, the clipboard history). */
export function settingsActions(deps: SettingsDeps): ActionDef[] {
  return [...paneActions(deps.open), ...SETTINGS_ROWS.filter((row) => row.source === undefined).map((row) => rowAction(row, deps))];
}
