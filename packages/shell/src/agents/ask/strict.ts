/**
 * A plan tool's schema as strict tool use takes it (`strict: true`, so the
 * model's arguments always fit the schema's shape). Strict schemas set
 * `additionalProperties: false` on every object and leave out what the API
 * can't enforce: numeric bounds, string lengths and patterns, array sizes
 * past 0 or 1, `oneOf` (sent as `anyOf`), and formats it doesn't know. What
 * is dropped here is still checked: every step runs its action's own
 * `check` before it is shown (plan.ts `stepsFrom`), and a call that doesn't
 * pass is never run.
 */

type Schema = Record<string, unknown>;

const isSchema = (value: unknown): value is Schema => typeof value === "object" && value !== null && !Array.isArray(value);

/** The keywords a strict schema may carry, beside the ones rebuilt below. */
const KEPT = new Set(["type", "description", "title", "enum", "const", "$ref"]);

/** String formats structured outputs support. */
const FORMATS = new Set(["date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid"]);

/** `schema` with only what strict tool use supports; it never throws on odd input. */
export function strictSchema(schema: unknown): Schema {
  if (!isSchema(schema)) return {};
  const out: Schema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (KEPT.has(key)) out[key] = value;
    else if (key === "format" && typeof value === "string" && FORMATS.has(value)) out.format = value;
    else if (key === "minItems" && (value === 0 || value === 1)) out.minItems = value;
    else if (key === "items") out.items = strictSchema(value);
    else if ((key === "anyOf" || key === "oneOf" || key === "allOf") && Array.isArray(value)) {
      const name = key === "allOf" ? "allOf" : "anyOf";
      const before = out[name];
      out[name] = [...(Array.isArray(before) ? before : []), ...value.map(strictSchema)];
    } else if ((key === "$defs" || key === "definitions") && isSchema(value)) {
      out.$defs = Object.fromEntries(Object.entries(value).map(([name, each]) => [name, strictSchema(each)]));
    } else if (key === "properties" && isSchema(value)) {
      out.properties = Object.fromEntries(Object.entries(value).map(([name, each]) => [name, strictSchema(each)]));
    } else if (key === "required" && Array.isArray(value)) {
      out.required = value.filter((name): name is string => typeof name === "string");
    }
  }
  const isObject = out.type === "object" || (Array.isArray(out.type) && out.type.includes("object")) || out.properties !== undefined;
  if (isObject) {
    out.properties ??= {};
    out.additionalProperties = false;
  }
  return out;
}
