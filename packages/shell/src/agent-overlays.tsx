/**
 * The agents' overlays that are not queued sheets (agent-sheets.tsx): the
 * "Your turn" banner, one per agent, and the note after a stop. Each is a
 * Metal surface in the shell's process.
 */

import { type NativeHostTransport, type NativeRoot, render } from "@mirinjs/metal";
import { personAnswered } from "./agents/person.ts";
import type { Turn } from "./agents/presence.ts";
import { STOPPED, StoppedNote } from "./consent.tsx";
import { spawnShellHost } from "./shared/metal/host.ts";
import { TURN, TurnBanner } from "./turn-banner.tsx";

/** The "Your turn" banner's layer. */
const TURN_LAYER = "dashi.agent-turn";
/** How long the note after a stop stays. */
const NOTE_MS = 2_500;

export interface Overlay {
  host: NativeHostTransport;
  root: NativeRoot;
}

export function closeOverlay(overlay: Overlay | null): void {
  overlay?.root.unmount();
  overlay?.host.close();
}

type InputOrigin = Parameters<typeof personAnswered>[0];

export interface Turns {
  /** Show the banner until Done (true) or it is taken down (false). */
  start(turn: Turn, signal: AbortSignal | undefined): Promise<boolean>;
  end(agent: number, done: boolean): void;
  /** Every agent's banner goes. */
  endAll(): void;
}

/** "Your turn" banners, one per agent: Done (true) or taken down (false). */
export function createTurns(inputOrigin: InputOrigin): Turns {
  const turns = new Map<number, Overlay & { finish(done: boolean): void }>();
  const end = (agent: number, done: boolean) => {
    const turn = turns.get(agent);
    if (!turn) return;
    turns.delete(agent);
    closeOverlay(turn);
    turn.finish(done);
  };
  return {
    start(turn, signal) {
      end(turn.agent, false);
      if (signal?.aborted) return Promise.resolve(false);
      signal?.addEventListener("abort", () => end(turn.agent, false), { once: true });
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
          void personAnswered(inputOrigin, TURN_LAYER).then((person) => {
            if (person) end(turn.agent, true);
          });
        const root = render(<TurnBanner turn={turn} onDone={done} />, host);
        turns.set(turn.agent, { host, root, finish: resolve });
        host.onClose(() => end(turn.agent, false));
      });
    },
    end,
    endAll() {
      for (const agent of [...turns.keys()]) end(agent, false);
    },
  };
}

export interface StoppedNotes {
  show(names: readonly string[]): void;
  close(): void;
}

/** The note after a stop: one at a time, gone after a moment. */
export function createStoppedNotes(): StoppedNotes {
  let note: (Overlay & { timer: ReturnType<typeof setTimeout> }) | null = null;
  const close = () => {
    if (note) clearTimeout(note.timer);
    closeOverlay(note);
    note = null;
  };
  return {
    show(names) {
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
    close,
  };
}
