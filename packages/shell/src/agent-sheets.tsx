/**
 * The shell's side of agents (docs/agents.html): consent sheets and
 * single-action questions, one at a time in the order agents asked, and the
 * note after a stop. Each is a Metal overlay; the agents server reaches them
 * through `AgentUi`.
 */

import { type NativeHostTransport, type NativeRoot, render, spawnNativeHost } from "@mirinjs/metal";
import type { ReactElement } from "react";
import type { AgentUi, Answer } from "./agents/index.ts";
import { SHEET_LAYERS } from "./agents/mask.ts";
import { personAnswered } from "./agents/person.ts";
import { DENY, type QueuedSheet, SheetQueue } from "./agents/sheet-queue.ts";
import { METAL_HOST } from "./apps.ts";
import { ConfirmSheet } from "./confirm-sheet.tsx";
import { CONSENT, ConsentSheet, STOPPED, StoppedNote } from "./consent.tsx";

/** The sheets' layer: blanked in agents' pictures, and asked about for whose press answered. */
const CONSENT_LAYER = SHEET_LAYERS[0];
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
}

export interface AgentUiOptions {
  /** A compositor request: `input-origin` says whose press answered a sheet. */
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
}

export function createAgentUi(options: AgentUiOptions): AgentUi & { close(): void } {
  let note: (Overlay & { timer: ReturnType<typeof setTimeout> }) | null = null;
  let clearWaiters: Array<() => void> = [];

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
      const host = spawnNativeHost(METAL_HOST, {
        title: "Agent permission",
        appId: "dev.dashi.shell",
        width: CONSENT.width,
        height: CONSENT.height,
        // On demand: the sheet never takes the keyboard by itself, so a stray
        // Enter typed elsewhere can't answer it.
        surface: { layer: "overlay", keyboard: "on-demand", namespace: CONSENT_LAYER },
      });
      const root = render(entry.view(answer), host);
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

  return {
    ask(ask) {
      return new Promise((resolve) =>
        sheets.enqueue({
          agent: ask.agent,
          view: (answer) => <ConsentSheet ask={ask} onAnswer={(allow, scopes) => answer({ allow, scopes })} />,
          resolve,
        }),
      );
    },
    confirm(confirm) {
      return new Promise((resolve) =>
        sheets.enqueue({
          agent: confirm.agent,
          view: (answer) => <ConfirmSheet confirm={confirm} onAnswer={(yes) => answer(yes ? { allow: "once", scopes: [] } : DENY)} />,
          resolve: (answer) => resolve(answer.allow !== "deny"),
        }),
      );
    },
    dismiss(agent) {
      sheets.dismiss(agent);
    },
    stopped(names) {
      if (note) {
        clearTimeout(note.timer);
        closeOverlay(note);
      }
      const host = spawnNativeHost(METAL_HOST, {
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
      if (note) clearTimeout(note.timer);
      closeOverlay(note);
      note = null;
    },
  };
}
