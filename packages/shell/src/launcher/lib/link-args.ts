/**
 * What a link's arguments say, for the chip a `dashi://` link opens the
 * launcher with ("Set the volume or mute · 30%"), so the person sees what
 * Return will do before pressing it. Pure: the values are untrusted text
 * from a link, shown, never obeyed.
 */

import type { ActionDef, Args } from "../../actions/types.ts";

/** The longest a shown value is, in characters. */
const MAX_VALUE = 32;

interface Schema {
  type?: unknown;
  minimum?: unknown;
  maximum?: unknown;
}

const schemaOf = (action: Pick<ActionDef, "properties">, name: string): Schema => {
  const schema = action.properties[name];
  return typeof schema === "object" && schema !== null ? (schema as Schema) : {};
};

const clip = (text: string): string => (text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE - 1)}…` : text);

/** One value as a person reads it: a 0–1 level as a percent, a flag by its name. */
function shown(name: string, value: unknown, schema: Schema): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (schema.minimum === 0 && schema.maximum === 1) return `${Math.round(value * 100)}%`;
    return String(value);
  }
  if (typeof value === "boolean") return value ? name : `not ${name}`;
  if (typeof value === "string") return value.trim() ? clip(value.replace(/\s+/g, " ").trim()) : null;
  return null;
}

/** The arguments in the action's own order, as short words; empty when there are none to show. */
export function describeArgs(action: Pick<ActionDef, "properties">, args: Args): string[] {
  const names = [...Object.keys(action.properties), ...Object.keys(args).filter((name) => !(name in action.properties))];
  return names.flatMap((name) => {
    if (!(name in args)) return [];
    const text = shown(name, args[name], schemaOf(action, name));
    return text === null ? [] : [text];
  });
}

/** The chip's title for a link: the action, then what its arguments say. */
export function linkTitle(action: Pick<ActionDef, "title" | "properties">, args: Args): string {
  const parts = describeArgs(action, args);
  return parts.length > 0 ? `${action.title} · ${parts.join(", ")}` : action.title;
}
