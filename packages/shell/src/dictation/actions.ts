/**
 * Dictation's actions (docs/actions.md), the registry's `dictation` source:
 * Undo Last Dictation (⌃❖Z) and Paste Last Dictation (⌃❖V). Each asks the
 * engine through the hub, as the capsule's own buttons do; the capsule says
 * what came of it. The person's alone.
 */

import { type ActionDef, type ActionSource, failed, ok, ready } from "../actions/types.ts";
import type { DictationCommand, PillHub } from "../shared/pill/index.ts";

export const UNDO_ADDRESS = "dashi://dictation/undo";
export const PASTE_LAST_ADDRESS = "dashi://dictation/paste-last";

const base = {
  description: "",
  properties: {},
  scope: null,
  readOnly: false,
  destructive: false,
  who: "person" as const,
  source: "dictation",
  kind: "run" as const,
};

export function dictationActions(hub: Pick<PillHub, "dictationCommands">): ActionSource {
  const ask = (command: DictationCommand, done: string) => () =>
    ready(async () => (hub.dictationCommands.send(command) ? ok(done) : failed("Dictation is off. Turn it on in Settings › Voice.")));
  const actions: ActionDef[] = [
    {
      ...base,
      address: UNDO_ADDRESS,
      title: "Undo Last Dictation",
      keywords: { en: ["dictation", "undo", "take back", "remove", "scratch that"], es: ["dictado", "deshacer", "borrar"] },
      shortcut: "⌃❖Z",
      check: ask({ do: "undo" }, "Asked dictation to take its last words back."),
    },
    {
      ...base,
      address: PASTE_LAST_ADDRESS,
      title: "Paste Last Dictation",
      keywords: { en: ["dictation", "paste last", "type again", "last transcript"], es: ["dictado", "pegar", "último"] },
      shortcut: "⌃❖V",
      check: ask({ do: "paste-last" }, "Typing your last dictation again."),
    },
  ];
  return { id: "dictation", actions: () => actions };
}
