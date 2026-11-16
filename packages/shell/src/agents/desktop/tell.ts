/**
 * tell_person: one short line said aloud while the work goes on ("Still
 * looking: three pages read"), never more than one every few seconds and
 * never over the person's own speech (a held talk key, an open microphone,
 * a dictation). A line that can't be said now is not queued: the answer says
 * why, and the line still shows where the agent's status shows (the capsule
 * for Dashi's assistant, the menu bar for others).
 */

import { SHELL_SENDER } from "../../notifications/index.ts";
import { iconPath } from "../../shared/apps/index.ts";
import { type RunContext, type ToolResult, text } from "../context.ts";
import { TELL_GAP_MS } from "../tools/index.ts";

/** The voice as a spoken line needs it (voice/voice.ts). */
export interface SpokenLines {
  say(text: string): void;
  /** The person is talking to Dashi or dictating now. */
  personTalking(): boolean;
  /** How the person talks to Dashi, or null when Voice is off or can't speak (no models, no service). */
  talkKey(): string | null;
}

export type Told = { said: true } | { said: false; why: "too soon"; waitMs: number } | { said: false; why: "the person is talking" | "Voice is off" };

export class Teller {
  private last = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly voice: SpokenLines | null,
    private readonly now: () => number = Date.now,
  ) {}

  tell(line: string): Told {
    const now = this.now();
    if (now - this.last < TELL_GAP_MS) return { said: false, why: "too soon", waitMs: Math.ceil(TELL_GAP_MS - (now - this.last)) };
    if (!this.voice || this.voice.talkKey() === null) return { said: false, why: "Voice is off" };
    if (this.voice.personTalking()) return { said: false, why: "the person is talking" };
    this.last = now;
    this.voice.say(line);
    return { said: true };
  }
}

/** tell_person: said, or why not; shown either way (the status line). */
export function tellPerson(line: string, ctx: RunContext): ToolResult {
  ctx.status(line);
  const told = ctx.desktop.tell?.tell(line) ?? { said: false, why: "Voice is off" };
  if (told.said) return text("Said and shown.", { said: true });
  const wait = told.why === "too soon" ? ` Wait ${Math.ceil(told.waitMs / 1000)} s before the next line.` : "";
  return text(`Shown, not said: ${told.why}.${wait}`, { said: false, why: told.why });
}

/** notify_person: a notification from Dashi, named for the agent that posted it. */
export function notifyPerson(title: string, line: string, ctx: RunContext): ToolResult {
  ctx.status("Notifying you");
  const id = ctx.desktop.notifications.notify(
    {
      appName: "Dashi",
      appIcon: iconPath("agents"),
      summary: title,
      body: line,
      actions: [],
      urgency: "normal",
      expireTimeout: -1,
      imagePath: "",
      desktopEntry: "",
      category: "dashi.agent",
      transient: false,
      resident: false,
    },
    0,
    SHELL_SENDER,
  );
  return text(`Posted: “${title}”.`, { notification: id });
}
