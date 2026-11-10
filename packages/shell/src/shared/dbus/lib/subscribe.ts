/**
 * Installing a match rule: the bus is told with `AddMatch`, and the router
 * keeps the handler for the local check (signals.ts).
 */

import { BUS_NAME, BUS_PATH, getNameOwner } from "../bus.ts";
import type { DBusConnection } from "../connection.ts";
import type { Message } from "../message.ts";
import { isWellKnownName } from "../names.ts";
import type { MatchRule } from "../types.ts";
import { matchRuleString, type SignalRouter, type Subscription } from "./signals.ts";

export async function subscribeTo(
  connection: DBusConnection,
  router: SignalRouter,
  rule: MatchRule,
  handler: (message: Message) => void,
): Promise<() => Promise<void>> {
  const subscription: Subscription = { rule, handler };
  const remove = router.add(subscription);
  const bus = { destination: BUS_NAME, path: BUS_PATH, interface: BUS_NAME, signature: "s", body: [matchRuleString(rule)] };
  let stopWatching: (() => Promise<void>) | null = null;
  try {
    // Signals carry the sender's unique name, so a rule naming a well-known
    // sender needs to know who owns that name now and when it changes hands.
    if (rule.sender !== undefined && rule.sender !== BUS_NAME && isWellKnownName(rule.sender)) {
      subscription.senderOwner = null;
      stopWatching = await subscribeTo(
        connection,
        router,
        { type: "signal", sender: BUS_NAME, interface: BUS_NAME, member: "NameOwnerChanged", path: BUS_PATH, args: { 0: rule.sender } },
        (changed) => {
          const owner = changed.body[2];
          subscription.senderOwner = typeof owner === "string" && owner !== "" ? owner : null;
        },
      );
      subscription.senderOwner = await getNameOwner(connection, rule.sender).catch(() => null);
    }
    await connection.call({ ...bus, member: "AddMatch" });
  } catch (error) {
    remove();
    await stopWatching?.().catch(() => {});
    throw error;
  }
  return async () => {
    remove();
    if (connection.closed) return;
    await connection.call({ ...bus, member: "RemoveMatch" }).catch(() => {});
    await stopWatching?.();
  };
}
