/**
 * What the notification center says about agents from the launcher: a run
 * that ended (its last words, with Show and Follow up), and a question that
 * went up while the chip's panel was closed. Pure: main.tsx posts them.
 */

import type { NotifyInput } from "../../notifications/types.ts";
import { type RunQuestion, type RunView, summaryLines } from "./store.ts";
import { cut } from "./words.ts";

export const SHOW = "show";
export const FOLLOW_UP = "follow-up";

const base = (run: RunView): Omit<NotifyInput, "summary" | "body" | "actions"> => ({
  appName: run.harnessName,
  appIcon: "",
  urgency: "normal",
  expireTimeout: -1,
  imagePath: "",
  desktopEntry: "",
  category: "dashi.agent",
  transient: false,
  resident: false,
});

/** A run ended: "Booked your class for Thursday 7:00" with Show and Follow up; nothing when the person stopped it. */
export function endedNotice(run: RunView): NotifyInput | null {
  if (run.phase === "stopped") return null;
  const actions = [
    { key: SHOW, label: "Show" },
    { key: FOLLOW_UP, label: "Follow up" },
  ];
  if (run.phase === "done") {
    const { title, body } = summaryLines(run.summary);
    return { ...base(run), summary: title || `${run.harnessName} is done`, body: body || cut(run.request, 120), actions };
  }
  if (run.phase === "failed") {
    return { ...base(run), summary: `${run.harnessName} stopped`, body: cut(`${run.request}: ${run.error ?? "it ended early"}`, 160), actions };
  }
  return null;
}

/** A question went up while the panel was closed: the sheet is up too, and the chip is amber. */
export function attentionNotice(run: RunView, question: RunQuestion): NotifyInput {
  return {
    ...base(run),
    summary: `${run.harnessName} needs you`,
    // The question, then the task it is for: "Use signin.localhost? · For “sign in to the test site”".
    body: cut(`${question.title} · For “${cut(run.request, 60)}”`, 160),
    actions: [{ key: SHOW, label: "Show" }],
    transient: true,
  };
}

/** The whole log Show opens: the request, every step, what it said, the words sent to it, how it ended. */
export function logText(run: RunView): string {
  const lines = [
    run.request,
    "",
    `${run.harnessName} · started ${new Date(run.started).toLocaleString()}`,
    "",
    ...run.steps.map((step) => `${step.state === "done" ? "✓" : step.state === "failed" ? "✕" : "…"} ${step.words}`),
    ...run.messages.map((message) => `→ You: ${message.text}`),
    "",
    run.phase === "done" ? run.summary : run.phase === "failed" ? `Stopped: ${run.error ?? ""}` : run.phase === "stopped" ? "Stopped by you." : run.said,
  ];
  return `${lines.join("\n").trim()}\n`;
}
