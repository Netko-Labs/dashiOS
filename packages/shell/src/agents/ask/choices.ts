/**
 * "Answer requests with", as Settings › Agents and Setup's Agents page list
 * it: installed harnesses first (Claude Code, Codex, OpenCode), then a
 * local model, then the APIs (Claude, GPT), then none. Each row says what
 * it answers with and, for a harness, whether it is signed in, or how to
 * install it. Pure: the panes draw it, the tests read it.
 */

import { ANSWERER_CHOICES, ANSWERERS, type AnswererChoice, isHarnessId } from "./answerer.ts";
import { HARNESSES, type HarnessStatus, signInCommand } from "./harness/index.ts";

export interface AnswererRow {
  value: AnswererChoice;
  name: string;
  detail: string;
  /** Whether it can be picked now (a harness that isn't installed can't). */
  available: boolean;
}

const DETAILS: Readonly<Record<"local" | "claude" | "gpt" | "none", string>> = {
  local: "A model on this computer. Nothing you ask leaves it.",
  claude: "Anthropic's API, with your key.",
  gpt: "OpenAI's API, with your key.",
  none: "The launcher only searches.",
};

/** A harness's row words, from what was found (null while looking). */
function harnessDetail(status: HarnessStatus | null | undefined, uses: string, install: string, signIn: string | null): { detail: string; available: boolean } {
  if (status === undefined || status === null) return { detail: `${uses}. Looking…`, available: true };
  if (!status.installed) return { detail: `Not installed. Install it with ${install}`, available: false };
  if (status.signedIn === true) return { detail: `${uses}. Signed in.`, available: true };
  if (status.signedIn === false) return { detail: `${uses}. Not signed in: run ${signIn ?? "its sign-in"} in Terminal.`, available: true };
  return { detail: `${uses}.`, available: true };
}

/**
 * The rows, in order. Installed harnesses come first, in the catalog's
 * order; a harness that isn't installed goes after the APIs, before None,
 * unless it is the one chosen (it stays where the person left it).
 */
export function answererRows(harnesses: readonly HarnessStatus[] | null, chosen: AnswererChoice | undefined = undefined): AnswererRow[] {
  const rows = ANSWERER_CHOICES.map((value): AnswererRow => {
    if (value === "none") return { value, name: "None", detail: DETAILS.none, available: true };
    const name = ANSWERERS[value].name;
    if (!isHarnessId(value)) return { value, name, detail: DETAILS[value], available: true };
    const spec = HARNESSES[value];
    const status = harnesses === null ? null : harnesses.find((each) => each.id === value);
    const { detail, available } = harnessDetail(status, spec.uses, spec.install, signInCommand(value));
    return { value, name, detail, available: available || value === chosen };
  });
  const missing = rows.filter((row) => isHarnessId(row.value) && !row.available);
  const none = rows.filter((row) => row.value === "none");
  return [...rows.filter((row) => !missing.includes(row) && row.value !== "none"), ...missing, ...none];
}
