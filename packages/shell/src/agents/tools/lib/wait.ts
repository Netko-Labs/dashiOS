/**
 * wait_for: one call that waits for what the agent would otherwise poll for
 * (docs/actions.md, "Waiting"). A page's text or element, or its load, is
 * watched by Dashi's extension in the page itself; a window's title by the
 * compositor's windows; a file by the folder it lands in. Exactly one thing
 * is waited for; the answer says whether it happened and how long it took.
 */

import { optional } from "@dashi/shape";
import type { Scope } from "../../consent.ts";
import { fail, type ToolDef } from "../define.ts";
import type { Call, WaitUntil } from "../types.ts";
import { custom, tool } from "./args.ts";
import { refArg, tabArg } from "./browser.ts";

export const WAIT_DEFAULT_S = 10;
export const WAIT_MAX_S = 60;

const words = (max: number, says: string) =>
  optional(
    custom<string>(
      { type: "string", description: says },
      (value) => (typeof value === "string" && value.trim() !== "" && value.length <= max ? value.trim() : null),
      `\`text\` must be a few words, ${max} characters at most.`,
    ),
  );

/** What a wait needs the person to have allowed: a page is "web", a window "see", a file "files". */
export function waitScope(until: WaitUntil): Scope {
  if ("window" in until) return "see";
  if ("file" in until) return "files";
  return "web";
}

export const waitTools: readonly ToolDef[] = [
  tool({
    name: "wait_for",
    title: "Wait for something",
    description:
      "Wait, instead of reading again and again, until one thing happens: `text` appears on a web page or `text_gone` leaves it, " +
      "an `element` read_page numbered is there, enabled or gone (`state`), the page has `loaded` or gone `quiet` (nothing changing for half a second), " +
      "a window whose title holds `window_title` is open, or a `file` exists. Give exactly one. Returns `met` (true, or false when `timeout` ran out), " +
      "what it saw, and how long it took. The page is watched by the browser itself.",
    scope: "web",
    readOnly: true,
    destructive: false,
    idempotent: true,
    args: {
      text: words(200, "Wait until a web page shows this text (case ignored)."),
      text_gone: words(200, 'Wait until a web page no longer shows this text ("Loading…").'),
      element: optional(refArg("Wait on this element of read_page's.")),
      state: optional(
        custom<"present" | "enabled" | "gone">(
          { type: "string", enum: ["present", "enabled", "gone"], description: "For `element`: present (default), enabled, or gone." },
          (value) => (value === "present" || value === "enabled" || value === "gone" ? value : null),
          "`state` is present, enabled or gone.",
        ),
      ),
      page: optional(
        custom<"loaded" | "quiet">(
          { type: "string", enum: ["loaded", "quiet"], description: "Wait until the page has loaded, or has stopped changing." },
          (value) => (value === "loaded" || value === "quiet" ? value : null),
          "`page` is loaded or quiet.",
        ),
      ),
      window_title: words(200, "Wait until a window whose title holds this is open (case ignored)."),
      file: words(4096, "Wait until a file exists at this absolute path (home folder and removable drives)."),
      timeout: optional(
        custom<number>(
          { type: "number", description: `Seconds to wait at most (default ${WAIT_DEFAULT_S}, at most ${WAIT_MAX_S}).` },
          (value) => (typeof value === "number" && value > 0 && value <= WAIT_MAX_S ? value : null),
          `\`timeout\` must be a number of seconds from 0.1 to ${WAIT_MAX_S}.`,
        ),
      ),
      tab: tabArg(),
    },
    build: (args): Call | ReturnType<typeof fail> => {
      const given: WaitUntil[] = [
        ...(args.text !== undefined ? [{ text: args.text }] : []),
        ...(args.text_gone !== undefined ? [{ textGone: args.text_gone }] : []),
        ...(args.element !== undefined ? [{ ref: args.element, state: args.state ?? "present" }] : []),
        ...(args.page !== undefined ? [{ page: args.page }] : []),
        ...(args.window_title !== undefined ? [{ window: args.window_title }] : []),
        ...(args.file !== undefined ? [{ file: args.file }] : []),
      ];
      const [until] = given;
      if (given.length !== 1 || until === undefined) return fail("Give exactly one of `text`, `text_gone`, `element`, `page`, `window_title` or `file`.");
      if (args.state !== undefined && args.element === undefined) return fail("`state` goes with `element`.");
      return { name: "wait_for", until, seconds: args.timeout ?? WAIT_DEFAULT_S, tab: args.tab ?? null };
    },
    scopeFor: (call) => (call.name === "wait_for" && "until" in call ? waitScope(call.until) : "web"),
  }),
];
