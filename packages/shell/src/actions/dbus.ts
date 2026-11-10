/**
 * The registry on the session bus: `dev.dashi.Shell.Actions1` at
 * `/dev/dashi/Shell`, on the shell's own name `dev.dashi.Shell`
 * (docs/actions.md, "On D-Bus"), so a GTK or Qt app, a script, or a tool can
 * list and run Dashi's actions without speaking its sockets:
 *
 *   List() → a(ssss)                     every action the person may use: address, title, kind, where it came from
 *   Describe(s address) → a{sv}          title, description, kind, source, from?, destructive, readOnly, arguments (JSON Schema, as text)
 *   Run(s address, a{sv} args) → s       what it came to, in words; a D-Bus error says why not
 *
 * A caller is a program, not the person at the screen, so `Run` is a link
 * from outside (actions/lib/run.ts): a destructive action, or an agent tool that
 * changes something, is opened for the person to finish, never run; a
 * settings address without arguments opens Settings at the row. The same
 * consent as `dashi-open`, logged as "you" in the activity log.
 */

import { DBusError, ERRORS, type InterfaceSpec, Variant } from "../shared/dbus/index.ts";
import { withArgs } from "./address.ts";
import { type ActionRegistry, mayUse } from "./registry.ts";
import type { Args, Outcome } from "./types.ts";

export const ACTIONS_INTERFACE = "dev.dashi.Shell.Actions1";
/** Arguments one call may give. */
const MAX_ARGS = 16;

export interface ActionsBusDeps {
  registry: Pick<ActionRegistry, "list" | "get">;
  /** A `dashi://` link from outside (actions/start.ts `openLink`). */
  open(url: string): Promise<Outcome>;
}

/** `a{sv}` as an action's arguments: text, numbers and true/false only. */
export function argsFromVariants(value: unknown): Args {
  if (!(value instanceof Map)) throw new DBusError(ERRORS.invalidArgs, "args must be a{sv}");
  if (value.size > MAX_ARGS) throw new DBusError(ERRORS.limitsExceeded, `at most ${MAX_ARGS} arguments`);
  const args: Args = {};
  for (const [name, wrapped] of value) {
    const inner = wrapped instanceof Variant ? wrapped.value : wrapped;
    if (typeof name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)) throw new DBusError(ERRORS.invalidArgs, "an argument's name is not one");
    if (typeof inner === "bigint") {
      if (inner > BigInt(Number.MAX_SAFE_INTEGER) || inner < BigInt(-Number.MAX_SAFE_INTEGER)) throw new DBusError(ERRORS.invalidArgs, `${name} is too large`);
      args[name] = Number(inner);
    } else if (typeof inner === "string" || typeof inner === "boolean" || (typeof inner === "number" && Number.isFinite(inner))) {
      args[name] = inner;
    } else {
      throw new DBusError(ERRORS.invalidArgs, `${name} must be text, a number, or true or false`);
    }
  }
  return args;
}

function personAction(registry: ActionsBusDeps["registry"], address: unknown) {
  const action = typeof address === "string" ? registry.get(address) : undefined;
  if (!action || !mayUse(action, "person")) throw new DBusError(ERRORS.unknownObject, `Nothing is at ${String(address).slice(0, 200)}.`);
  return action;
}

export function actionsInterface(deps: ActionsBusDeps): InterfaceSpec {
  return {
    name: ACTIONS_INTERFACE,
    methods: {
      List: {
        out: "a(ssss)",
        handler: () => deps.registry.list({ who: "person" }).map((action) => [action.address, action.title, action.kind, action.from ?? action.source]),
      },
      Describe: {
        in: "s",
        out: "a{sv}",
        handler: ([address]) => {
          const action = personAction(deps.registry, address);
          return new Map<string, Variant>([
            ["title", new Variant("s", action.title)],
            ["description", new Variant("s", action.description)],
            ["kind", new Variant("s", action.kind)],
            ["source", new Variant("s", action.source)],
            ...(action.from ? [["from", new Variant("s", action.from)] as [string, Variant]] : []),
            ["destructive", new Variant("b", action.destructive)],
            ["readOnly", new Variant("b", action.readOnly)],
            ["arguments", new Variant("s", JSON.stringify({ type: "object", properties: action.properties, required: action.required ?? [] }))],
          ]);
        },
      },
      Run: {
        in: "sa{sv}",
        out: "s",
        handler: async ([address, args]) => {
          const action = personAction(deps.registry, address);
          const outcome = await deps.open(withArgs(action.address, argsFromVariants(args)));
          if (!outcome.ok) throw new DBusError(ERRORS.failed, outcome.error);
          return outcome.text;
        },
      },
    },
  };
}
