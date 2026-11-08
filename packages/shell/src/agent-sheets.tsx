/**
 * The shell's side of agents (docs/agents.html): consent sheets and
 * single-action questions, one at a time in the order agents asked, and the
 * note after a stop. Each is a Metal overlay; the agents server reaches them
 * through `AgentUi`.
 */

import { TextSelectionLook } from "@dashi/ui";
import { type NativeHostTransport, type NativeRoot, render } from "@mirinjs/metal";
import type { ReactElement } from "react";
import { PersonConfirmSheet, type PersonQuestion } from "./actions/confirm-sheet.tsx";
import type { AgentUi, Answer } from "./agents/index.ts";
import { SHEET_LAYERS } from "./agents/mask.ts";
import { personAnswered } from "./agents/person.ts";
import { DENY, type QueuedSheet, SheetQueue } from "./agents/sheet-queue.ts";
import { ConfirmSheet } from "./confirm-sheet.tsx";
import { CONSENT, ConsentSheet, STOPPED, StoppedNote } from "./consent.tsx";
import { spawnShellHost } from "./metal-host.ts";
import { SIGN_IN, SignInSheet } from "./sign-in-sheet.tsx";
import { TURN, TurnBanner } from "./turn-banner.tsx";

/** The sheets' layer: blanked in agents' pictures, and asked about for whose press answered. */
const CONSENT_LAYER = SHEET_LAYERS[0];
/** The "Your turn" banner's layer. */
const TURN_LAYER = "dashi.agent-turn";
/** After the last sheet closes, its surface may last a frame; screenshots wait this long. */
const SHEET_GONE_MS = 150;
/** How long the note after a stop stays. */
const NOTE_MS = 2_500;

interface Overlay {
  host: NativeHostTransport;
  root: NativeRoot;
}

function closeOverlay(overlay: Overlay | null): void {
  overlay?.root.unmount();
  overlay?.host.close();
}

/** A sheet and how to draw it, given how the person's answer gets back. */
interface Sheet extends QueuedSheet {
  view(answer: (answer: Answer) => void): ReactElement;
  /** The surface, when not the consent sheet's. */
  size?: { width: number; height: number };
}

export interface AgentUiOptions {
  /** A compositor request: `input-origin` says whose press answered a sheet. */
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
}

/** The sheet queue's id for the person's own questions (agents' connections count from 1). */
export const PERSON_SHEETS = 0;

/** What else the queue shows: the person's own questions (actions/run.ts), answered by their press only. */
export interface PersonSheets {
  confirmPerson(question: PersonQuestion, signal?: AbortSignal): Promise<boolean>;
}

export function createAgentUi(options: AgentUiOptions): AgentUi & PersonSheets & { close(): void } {
  let note: (Overlay & { timer: ReturnType<typeof setTimeout> }) | null = null;
  let clearWaiters: Array<() => void> = [];
  /** "Your turn" banners, one per agent: Done (true) or taken down (false). */
  const turns = new Map<number, Overlay & { finish(done: boolean): void }>();
  const endTurn = (agent: number, done: boolean) => {
    const turn = turns.get(agent);
    if (!turn) return;
    turns.delete(agent);
    closeOverlay(turn);
    turn.finish(done);
  };

  const sheets = new SheetQueue<Sheet>({
    open(entry, given, gone) {
      // A no always counts; a yes only if the person's own hands gave it.
      const answer = (reply: Answer) => {
        if (reply.allow === "deny") return given(reply);
        void personAnswered(options.request, CONSENT_LAYER).then((person) => {
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
      return { close: () => closeOverlay({ host, root }) };
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
    ask(ask, signal) {
      return new Promise((resolve) =>
        queue(
          {
            agent: ask.agent,
            view: (answer) => <ConsentSheet ask={ask} onAnswer={(allow, scopes) => answer({ allow, scopes })} />,
            resolve,
          },
          signal,
        ),
      );
    },
    confirm(confirm, signal) {
      return new Promise((resolve) =>
        queue(
          {
            agent: confirm.agent,
            view: (answer) => <ConfirmSheet confirm={confirm} onAnswer={(yes) => answer(yes ? { allow: "once", scopes: [] } : DENY)} />,
            resolve: (answer) => resolve(answer.allow !== "deny"),
          },
          signal,
        ),
      );
    },
    allowSite(ask, signal) {
      const confirm = {
        agent: ask.agent,
        who: ask.who,
        summary: `use ${ask.site}`,
        detail: `It could read the pages of ${ask.site} in your browser as text, and click, fill in and choose things on them. It never sees what password, card or code fields hold.`,
        action: "Allow",
      };
      return new Promise((resolve) =>
        queue(
          {
            agent: ask.agent,
            view: (answer) => (
              <ConfirmSheet
                confirm={confirm}
                onAnswer={(yes) => answer(yes ? { allow: "once", scopes: [] } : DENY)}
                onAlways={() => answer({ allow: "always", scopes: [] })}
              />
            ),
            resolve: (answer) => resolve(answer.allow),
          },
          signal,
        ),
      );
    },
    confirmPerson(question, signal) {
      return new Promise((resolve) =>
        queue(
          {
            agent: PERSON_SHEETS,
            view: (answer) => <PersonConfirmSheet question={question} onAnswer={(yes) => answer(yes ? { allow: "once", scopes: [] } : DENY)} />,
            resolve: (answer) => resolve(answer.allow !== "deny"),
          },
          signal,
        ),
      );
    },
    signIn(ask, signal) {
      // On the queue's Answer: "always" stands for "Allow for This Task", the login's key rides in `scopes`.
      return new Promise((resolve) =>
        queue(
          {
            agent: ask.agent,
            size: SIGN_IN,
            view: (answer) => (
              <SignInSheet
                ask={ask}
                onAnswer={(choice) =>
                  answer(choice.allow === "deny" || !choice.login ? DENY : { allow: choice.allow === "task" ? "always" : "once", scopes: [choice.login] })
                }
              />
            ),
            resolve: (answer) =>
              resolve(
                answer.allow === "deny"
                  ? { allow: "deny", login: null }
                  : { allow: answer.allow === "always" ? "task" : "once", login: answer.scopes[0] ?? null },
              ),
          },
          signal,
        ),
      );
    },
    turn(turn, signal) {
      endTurn(turn.agent, false);
      if (signal?.aborted) return Promise.resolve(false);
      signal?.addEventListener("abort", () => endTurn(turn.agent, false), { once: true });
      return new Promise((resolve) => {
        const host = spawnShellHost({
          title: "Your turn",
          appId: "dev.dashi.shell",
          width: TURN.width,
          height: TURN.height,
          surface: { layer: "overlay", anchor: ["top"], margin: { top: 36 }, keyboard: "on-demand", namespace: TURN_LAYER },
        });
        // Done counts only when the person pressed it, not an agent.
        const done = () =>
          void personAnswered(options.request, TURN_LAYER).then((person) => {
            if (person) endTurn(turn.agent, true);
          });
        const root = render(<TurnBanner turn={turn} onDone={done} />, host);
        turns.set(turn.agent, { host, root, finish: resolve });
        host.onClose(() => endTurn(turn.agent, false));
      });
    },
    dismiss(agent) {
      sheets.dismiss(agent);
      endTurn(agent, false);
    },
    stopped(names) {
      if (note) {
        clearTimeout(note.timer);
        closeOverlay(note);
      }
      const host = spawnShellHost({
        title: "Agents stopped",
        appId: "dev.dashi.shell",
        width: STOPPED.width,
        height: STOPPED.height,
        surface: { layer: "overlay", anchor: ["top"], margin: { top: 90 }, namespace: "dashi.agent-stopped" },
      });
      const root = render(<StoppedNote names={names} />, host);
      const timer = setTimeout(() => {
        closeOverlay(note);
        note = null;
      }, NOTE_MS);
      note = { host, root, timer };
    },
    whenNoSheet() {
      return sheets.busy ? new Promise((resolve) => clearWaiters.push(resolve)) : Promise.resolve();
    },
    close() {
      sheets.close();
      for (const agent of [...turns.keys()]) endTurn(agent, false);
      if (note) clearTimeout(note.timer);
      closeOverlay(note);
      note = null;
    },
  };
}
