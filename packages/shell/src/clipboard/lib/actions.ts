/**
 * The clipboard's actions (docs/actions.md), the registry's `clipboard`
 * source: Clipboard History (`dashi://clipboard/history`, ⌥❖V) and Snippets
 * (`dashi://clipboard/snippets`) open the launcher in their scope (chosen in
 * the launcher, they are entered in place); Clear Clipboard History asks
 * first, every time; and the history's switch is a setting with state at
 * `dashi://settings/keyboard/clipboard-history`, as Settings › Keyboard has it.
 * The person's alone: agents read the history only through their own tool,
 * which asks every time (agents/tools/lib/clipboard.ts).
 */

import { type ActionContext, type ActionDef, type ActionSource, failed, invalid, ok, ready } from "../../actions/index.ts";
import { HISTORY_ADDRESS, SNIPPETS_ADDRESS } from "./scope.ts";

export interface ClipboardActionDeps {
  /** Open the launcher in a scope, over the window that had the keyboard. */
  open(scope: "clipboard" | "snippets", ctx: ActionContext): void;
  enabled(): boolean;
  setEnabled(on: boolean): void;
  /** How many copies are kept. */
  count(): number;
  clear(): void;
  /** Ask the person on a sheet of their own; true only if they go ahead. */
  confirm(question: { title: string; detail: string; action: string; danger: boolean }): Promise<boolean>;
}

const base = {
  description: "",
  properties: {},
  scope: null,
  readOnly: true,
  destructive: false,
  who: "person" as const,
  source: "clipboard",
};

export function clipboardActions(deps: ClipboardActionDeps): ActionDef[] {
  return [
    {
      ...base,
      address: HISTORY_ADDRESS,
      title: "Clipboard History",
      keywords: { en: ["clipboard", "copies", "copied", "paste", "pasteboard", "history"] },
      kind: "open",
      shortcut: "⌥❖V",
      check: () =>
        ready(async (ctx) => {
          deps.open("clipboard", ctx);
          return ok("Clipboard History is open.");
        }),
    },
    {
      ...base,
      address: SNIPPETS_ADDRESS,
      title: "Snippets",
      keywords: { en: ["snippet", "snippets", "text expansion", "abbreviation", "expand"] },
      kind: "open",
      check: () =>
        ready(async (ctx) => {
          deps.open("snippets", ctx);
          return ok("Snippets are open.");
        }),
    },
    {
      ...base,
      address: "dashi://clipboard/clear",
      title: "Clear Clipboard History",
      keywords: { en: ["clipboard", "clear", "forget copies", "delete history"] },
      kind: "run",
      readOnly: false,
      destructive: true,
      asksEveryTime: true,
      check: () =>
        ready(async () => {
          const count = deps.count();
          if (count === 0) return ok("Nothing is kept.");
          const yes = await deps.confirm({
            title: "Clear clipboard history?",
            detail: count === 1 ? "The one copy kept goes, pinned or not." : `All ${count} copies kept go, pinned ones too.`,
            action: "Clear History",
            danger: true,
          });
          if (!yes) return failed("Cancelled.");
          deps.clear();
          return ok("Clipboard history is cleared.");
        }),
    },
    {
      ...base,
      address: "dashi://settings/keyboard/clipboard-history",
      title: "Keep clipboard history",
      description: "Copies kept 7 days, on this computer only",
      keywords: { en: ["clipboard history", "paste history"] },
      kind: "toggle",
      properties: { value: { type: "boolean", description: "On or off; left out, it switches." } },
      readOnly: false,
      idempotent: false,
      place: { pane: "keyboard", row: "clipboard-history" },
      state: () => deps.enabled(),
      check(args) {
        if (args.value !== undefined && typeof args.value !== "boolean") return invalid("`value` must be true or false.");
        return ready(async () => {
          const on = typeof args.value === "boolean" ? args.value : !deps.enabled();
          deps.setEnabled(on);
          return ok(on ? "Clipboard history is on." : "Clipboard history is off, and what it kept is gone.");
        });
      },
    },
  ];
}

/** The actions as the registry's `clipboard` source; the switch's state is read live (the launcher redraws on a settings change), so the list never changes. */
export function clipboardSource(deps: ClipboardActionDeps): ActionSource {
  const actions = clipboardActions(deps);
  return { id: "clipboard", actions: () => actions };
}
