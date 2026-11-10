/**
 * Closing asks first when a program runs in what closes: a tab (its ×, ❖W)
 * or the window (❖⇧W, the close control, ❖Q, the Dock's Quit, logging out).
 * At a prompt, nothing runs in it and it closes at once (closing.ts says what
 * the question reads). A log out that was cancelled takes the window's
 * question with it; a tab's own question stays.
 */

import { useState } from "react";
import { type CloseReason, useCloseRequest, useCloseWithdrawn } from "../kit/index.ts";
import { type CloseQuestion, stillRunning } from "./closing.ts";
import type { Sessions } from "./sessions.ts";

export interface Closing {
  /** The question on screen, if one is asked. */
  asking: CloseQuestion | null;
  /** Keeps what the question asks about open. */
  cancel(): void;
  /** Closes what the question asks about. */
  confirm(): void;
  requestCloseTab(id: number): void;
  requestCloseWindow(reason?: CloseReason): void;
}

export interface ClosingInput {
  sessions: Sessions;
  onExit(): void;
  /** Puts the keyboard back in the grid once a question is answered. */
  refocus(): void;
}

export function useClosing({ sessions, onExit, refocus }: ClosingInput): Closing {
  const [asking, setAsking] = useState<CloseQuestion | null>(null);

  /** A tab's ×, ❖W: at once at the prompt, else after asking. */
  const requestCloseTab = (id: number): void => {
    const each = sessions.engine(id);
    if (!each) {
      sessions.close(id);
      return;
    }
    void each.running().then((program) => {
      if (program === null) sessions.close(id);
      else setAsking({ kind: "tab", id, program });
    });
  };

  /** ⇧❖W, Close Window: at once when every tab is at its prompt, else after asking. */
  const requestCloseWindow = (reason: CloseReason = "close"): void => {
    void Promise.all(sessions.engines().map((each) => each.running())).then((answers) => {
      const programs = stillRunning(answers);
      if (programs.length === 0) onExit();
      else setAsking({ kind: "window", programs, ...(reason === "quit" ? { quit: true } : {}) });
    });
  };
  // The close control, ❖Q, the Dock's Quit, logging out: as Close Window, asking "Quit Terminal?" when it quits.
  useCloseRequest(requestCloseWindow);
  // The log out that asked was cancelled: "Quit Terminal?" goes with it (a tab's own question stays).
  useCloseWithdrawn(() => {
    if (asking?.kind !== "window") return;
    setAsking(null);
    refocus();
  });

  return {
    asking,
    cancel: () => {
      setAsking(null);
      refocus();
    },
    confirm: () => {
      const current = asking;
      setAsking(null);
      if (current?.kind === "window") onExit();
      else if (current) {
        sessions.close(current.id);
        refocus();
      }
    },
    requestCloseTab,
    requestCloseWindow,
  };
}
