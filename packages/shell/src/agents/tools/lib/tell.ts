/**
 * Telling the person while the work goes on (docs/actions.md, "Telling the
 * person"): tell_person says one short line aloud without ending the turn;
 * notify_person posts a notification, for when they are elsewhere.
 * Neither asks: nothing about them is critical.
 */

import type { ToolDef } from "../define.ts";
import { custom, tool } from "./args.ts";

/** At most one spoken line this often, and this long (desktop/tell.ts holds to it). */
export const TELL_GAP_MS = 4000;
export const TELL_MAX = 200;

const line = (max: number, says: string, description: string) =>
  custom<string>(
    { type: "string", maxLength: max, description },
    (value) => {
      const flat = typeof value === "string" ? value.replace(/[\p{Cc}\s]+/gu, " ").trim() : "";
      return flat.length > 0 && flat.length <= max ? flat : null;
    },
    says,
  );

export const tellTools: readonly ToolDef[] = [
  tool({
    name: "tell_person",
    title: "Tell the person something",
    description:
      `Say one short line aloud in Dashi's voice, and show it, while you keep working: progress on a long job ("Still looking: three pages read"). ` +
      `At most one every ${TELL_GAP_MS / 1000} seconds, never over the person's own speech (then it is only shown, and the answer says so). Not for the final answer.`,
    scope: "act",
    readOnly: false,
    destructive: false,
    args: { text: line(TELL_MAX, `\`text\` is one line, ${TELL_MAX} characters at most.`, "The line, short and plain.") },
    build: ({ text }) => ({ name: "tell_person", text }),
  }),
  tool({
    name: "notify_person",
    title: "Notify the person",
    description:
      "Post a notification with a title and one line, when work is done or needs them and they may be elsewhere (a long job finished, a question that can wait). It stays in Notification Center.",
    scope: "act",
    readOnly: false,
    destructive: false,
    args: {
      title: line(80, "`title` is a few words, 80 characters at most.", 'A few words: "Prices checked".'),
      text: line(300, "`text` is one line, 300 characters at most.", "One line of what happened or what is needed."),
    },
    build: ({ title, text }) => ({ name: "notify_person", title, text }),
  }),
];
