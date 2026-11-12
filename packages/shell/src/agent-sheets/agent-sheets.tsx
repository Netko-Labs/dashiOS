/**
 * The shell's side of agents (docs/agents.html): consent sheets and
 * single-action questions, one at a time in the order agents asked, and the
 * note after a stop. Each is a Metal overlay; the agents server reaches them
 * through `AgentUi`. The sheets' views are lib/agent-sheet-views.tsx, the banner
 * and the note lib/agent-overlays.tsx.
 */

import { TextSelectionLook } from "@dashi/ui";
import { render } from "@mirinjs/metal";
import type { PersonQuestion } from "../actions/index.ts";
import { type AgentUi, type Answer, DENY, personAnswered, SHEET_LAYERS, SheetQueue } from "../agents/index.ts";
import { CONSENT } from "../consent.tsx";
import { spawnShellHost } from "../shared/metal/index.ts";
import { closeOverlay, createStoppedNotes, createTurns } from "./lib/agent-overlays.tsx";
import { allowSiteSheet, askSheet, confirmSheet, personSheet, type QuestionVoice, questionSheet, type Sheet, signInSheet } from "./lib/agent-sheet-views.tsx";

/** The sheets' layer: blanked in agents' pictures, and asked about for whose press answered. */
const CONSENT_LAYER = SHEET_LAYERS[0];
/** After the last sheet closes, its surface may last a frame; screenshots wait this long. */
const SHEET_GONE_MS = 150;

export interface AgentUiOptions {
  /** The compositor's `input-origin`: it says whose press answered a sheet. */
  inputOrigin(params: { namespace: string }): Promise<{ person: number | null; agent: number | null }>;
  /** Voice, for a question said out loud and answered by the talk key; null where there is none. */
  voice?(): QuestionVoice | null;
}

/** The sheet queue's id for the person's own questions (agents' connections count from 1). */
export const PERSON_SHEETS = 0;

/** What else the queue shows: the person's own questions (actions/lib/run.ts), answered by their press only. */
export interface PersonSheets {
  confirmPerson(question: PersonQuestion, signal?: AbortSignal): Promise<boolean>;
}

export function createAgentUi(options: AgentUiOptions): AgentUi & PersonSheets & { close(): void } {
  let clearWaiters: Array<() => void> = [];
  const turns = createTurns(options.inputOrigin);
  const notes = createStoppedNotes();

  const sheets = new SheetQueue<Sheet>({
    open(entry, given, gone) {
      // A no always counts; a yes only if the person's own hands gave it.
      const answer = (reply: Answer) => {
        if (reply.allow === "deny") return given(reply);
        void personAnswered(options.inputOrigin, CONSENT_LAYER).then((person) => {
          if (person) given(reply);
          else console.error("dashi-shell: a consent sheet's answer did not come from the person; it was ignored");
        });
      };
      const host = spawnShellHost({
        title: "Agent permission",
        appId: "dev.dashi.shell",
        width: entry.size?.width ?? CONSENT.width,
        height: entry.size?.height ?? CONSENT.height,
        // On demand: the sheet never takes the keyboard by itself, so a stray
        // Enter typed elsewhere can't answer it.
        surface: { layer: "overlay", keyboard: "on-demand", namespace: CONSENT_LAYER },
      });
      const root = render(<TextSelectionLook>{entry.view(answer)}</TextSelectionLook>, host);
      // A sheet whose host died can't be answered: that's a no.
      host.onClose(gone);
      // A question is said out loud now that it shows, and a spoken answer is the person's own (the talk key is theirs alone).
      const hidden = entry.shown?.(given);
      return {
        close: () => {
          hidden?.();
          closeOverlay({ host, root });
        },
      };
    },
    onIdle() {
      const waiters = clearWaiters;
      clearWaiters = [];
      setTimeout(() => {
        for (const waiter of waiters) waiter();
      }, SHEET_GONE_MS);
    },
  });

  /** Queue a sheet; if its caller gives up (`signal`), it comes down, or never comes up. */
  const queue = (entry: Sheet, signal: AbortSignal | undefined) => {
    if (signal?.aborted) return entry.resolve(DENY);
    signal?.addEventListener("abort", () => sheets.cancel(entry), { once: true });
    sheets.enqueue(entry);
  };

  return {
    ask: (ask, signal) => new Promise((resolve) => queue(askSheet(ask, resolve), signal)),
    confirm: (confirm, signal) => new Promise((resolve) => queue(confirmSheet(confirm, resolve), signal)),
    allowSite: (ask, signal) => new Promise((resolve) => queue(allowSiteSheet(ask, resolve), signal)),
    confirmPerson: (question, signal) => new Promise((resolve) => queue(personSheet(PERSON_SHEETS, question, resolve), signal)),
    signIn: (ask, signal) => new Promise((resolve) => queue(signInSheet(ask, resolve), signal)),
    question: (ask, signal) => new Promise((resolve) => queue(questionSheet(ask, options.voice?.() ?? null, resolve), signal)),
    turn: (turn, signal) => turns.start(turn, signal),
    dismiss(agent) {
      sheets.dismiss(agent);
      turns.end(agent, false);
    },
    stopped: (names) => notes.show(names),
    whenNoSheet() {
      return sheets.busy ? new Promise((resolve) => clearWaiters.push(resolve)) : Promise.resolve();
    },
    close() {
      sheets.close();
      turns.endAll();
      notes.close();
    },
  };
}
