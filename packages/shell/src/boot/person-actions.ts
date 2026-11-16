/** Actions the launcher's agents run as the person, by address (boot/agents.ts hands them to the handoff shell). */

import { formatAddress, type startActions } from "../actions/index.ts";

type Actions = ReturnType<typeof startActions>;

/** An action run as the person, by its address; an address with nothing at it is an error, not a throw. */
export function runAddressAsPerson(
  actions: Actions,
  address: string,
  args: Record<string, unknown>,
): ReturnType<Actions["run"]> | Promise<{ ok: false; error: string }> {
  const action = actions.registry.get(address);
  return action ? actions.run(action, args) : Promise.resolve({ ok: false as const, error: `Nothing is at ${address}.` });
}

/** The Terminal, through its action (a harness that isn't signed in signs in there). */
export function openTerminal(actions: Actions): void {
  const terminal = actions.registry.get(formatAddress(["app", "dev.dashi.terminal"]));
  if (terminal) void actions.run(terminal, {});
}
