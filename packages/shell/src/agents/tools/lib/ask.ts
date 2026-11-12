/**
 * ask_person: an agent asks the person a question in words (docs/actions.md,
 * "Asking the person"). Dashi says it out loud when Voice is on and shows it;
 * the person answers by holding the talk key and speaking, or by typing; the
 * agent gets the answer as text, or is told there is none. It is never a way
 * round a fingerprint or a password: paying and signing in ask on their own
 * sheets, whatever was answered here.
 */

import { optional } from "@dashi/shape";
import type { ToolDef } from "../define.ts";
import { custom, tool, wholeArg } from "./args.ts";

export const ASK_SECONDS = { least: 10, most: 300, usual: 60 } as const;
/** A question is one or two sentences: it is said out loud. */
export const QUESTION_MAX = 300;

export const askTools: readonly ToolDef[] = [
  tool({
    name: "ask_person",
    title: "Ask the person a question",
    description:
      "Ask the person at the screen one short question in words. Dashi says it out loud in its own voice (when they turned Voice on) and shows it; " +
      "they answer by holding the talk key and speaking, or by typing, and you get their answer as text (`by` says which; spoken words may be misheard). " +
      "If they choose not to answer, or don't within `seconds`, you are told there is no answer: never guess one. " +
      "Ask only what you can't find out yourself, one thing at a time. Never ask for a password, a code, a card number or any secret: " +
      "sign_in, fill_code and pay ask the person on their own sheets, and an answer here never stands in for those or for any permission.",
    scope: "ask",
    readOnly: true,
    destructive: false,
    args: {
      question: custom(
        { type: "string", description: `The question, in a sentence or two (at most ${QUESTION_MAX} characters). It is said out loud.` },
        // Said and shown on a few lines: no control characters, and no longer than a person would listen to.
        (value) => {
          if (typeof value !== "string") return null;
          const text = value
            .replace(/\p{Cc}/gu, " ")
            .replace(/\s+/g, " ")
            .trim();
          return text !== "" && [...text].length <= QUESTION_MAX ? text : null;
        },
        `\`question\` is required: one short question, at most ${QUESTION_MAX} characters.`,
      ),
      seconds: optional(
        wholeArg(
          ASK_SECONDS.least,
          ASK_SECONDS.most,
          `\`seconds\` must be a whole number from ${ASK_SECONDS.least} to ${ASK_SECONDS.most}.`,
          `How long to wait for the answer once the question shows, default ${ASK_SECONDS.usual}.`,
        ),
      ),
    },
    build: ({ question, seconds }) => ({ name: "ask_person", question, seconds: seconds ?? ASK_SECONDS.usual }),
  }),
];
