/**
 * Dashi's agent as the launcher reaches it (launcher/types.ts `LauncherDashi`;
 * decisions.md D261): the assistant's one conversation, typed into, stopped,
 * kept working, its questions answered; the model typed asks go to; the
 * person's recent asks for the empty view; a link opened in its app.
 */

import type { Assistant } from "../../agents/index.ts";
import { openFile } from "../../file-manager.ts";
import type { LauncherDashi } from "../../launcher/index.ts";
import type { LateParts } from "../parts.ts";
import type { Late } from "../services.ts";

/** How many recent asks the empty view offers. */
const RECENT = 5;

export function launcherDashi(assistant: Assistant, late: Late<LateParts>): LauncherDashi {
  const name = (): string => late.peek("pill")?.persona.getSnapshot().name ?? "Dashi";
  return {
    subscribe: assistant.transcript.subscribe,
    getSnapshot: assistant.transcript.getSnapshot,
    type: (words) => assistant.type(words),
    stop: () => assistant.stop(),
    keepWorking: () => assistant.keepWorking(),
    reply: (answer) => assistant.reply(answer),
    model: () => assistant.model("typing"),
    name,
    recent: () => {
      const asked = (late.peek("askAgents")?.launcher.history() ?? []).filter((entry) => entry.who === name() && entry.request);
      return [...new Set(asked.map((entry) => entry.request ?? ""))].slice(0, RECENT);
    },
    openLink: (url) => {
      if (/^https?:\/\//.test(url)) openFile(url);
    },
  };
}
