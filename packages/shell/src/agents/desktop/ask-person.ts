/**
 * ask_person: the person's own words, or plainly none. The question waits on
 * the sheets' queue like any other; Dashi says it when Voice is on, and the
 * answer is what the person said while holding the talk key, or typed
 * (agent-sheets/lib/question-sheet.tsx). Nothing here ever makes an answer
 * up: no answer in time, a "Don't Answer", the screen locking or the agent
 * leaving all come back as no answer.
 */

import { json, type RunContext, type ToolResult } from "../context.ts";

const NO_GUESS = "There is no answer: don't guess one, and don't ask the same thing again unless the person agrees.";

export async function askPerson(call: { question: string; seconds: number }, ctx: RunContext): Promise<ToolResult> {
  ctx.status("Asking you a question");
  const answer = await ctx.question(call.question, call.seconds);
  if ("text" in answer) return json({ answered: true, answer: answer.text, by: answer.by });
  const why = answer.none === "declined" ? "The person chose not to answer." : `The person did not answer within ${call.seconds} seconds.`;
  return json({ answered: false, reason: `${why} ${NO_GUESS}` });
}
