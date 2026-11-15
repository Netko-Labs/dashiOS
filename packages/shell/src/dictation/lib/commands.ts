/**
 * What the capsule asks of dictation (shared/pill/dictation.ts
 * `DictationCommand`; dictation.ts): Copy, Done, Close, "Type it instead",
 * and what can be done with a landing (landings.ts): Undo, Raw, paste last,
 * the next profile.
 */

import type { DictationCommand, DictationState } from "../../shared/pill/index.ts";
import type { DictationDeps, Front } from "../types.ts";
import type { Landings } from "./landings.ts";

/** What a command reaches of the engine. */
export interface CommandHost {
  deps: DictationDeps;
  landings: Landings;
  state(): DictationState;
  show(state: DictationState): void;
  /** The microphone is open, or about to be (a hold, hands-free). */
  hearing(): boolean;
  /** The turn now, and the next one (what an older press waited for is no longer wanted). */
  turn(): number;
  nextTurn(): number;
  /** End the listen and land what was said. */
  finish(): void;
  stop(): void;
  /** Land words from elsewhere as a dictation would. */
  type(text: string): void;
  /** Say the profile's name on the listening line. */
  named(turn: number, at: Promise<Front | null>): void;
}

/** Something done with what landed; never while the microphone is open. */
async function after(host: CommandHost, run: () => Promise<DictationState>): Promise<void> {
  if (host.hearing()) return;
  const turn = host.nextTurn();
  const state = await run();
  if (turn === host.turn()) host.show(state);
}

/** A press on the profile's name: the next one for this window. While listening the line only changes its name. */
async function chooseProfile(host: CommandHost): Promise<void> {
  const listening = host.state().phase === "listening";
  const turn = host.turn();
  const state = await host.landings.nextProfile();
  if (turn !== host.turn()) return;
  if (!listening) return host.show(state);
  if (host.state().phase === "listening" && state.phase === "told" && state.tone === "ok") host.named(turn, host.deps.front());
}

export function runCommand(host: CommandHost, command: DictationCommand): void {
  const state = host.state();
  switch (command.do) {
    case "copy": {
      if (state.phase !== "waiting" && state.phase !== "landed") return;
      const text = command.heard ? state.heard : state.phase === "waiting" ? state.text : state.typed;
      void host.deps.copy(text);
      // Copied, the words need not wait any longer.
      if (state.phase === "waiting") host.show({ phase: "idle" });
      return;
    }
    case "finish":
      return host.finish();
    case "dismiss":
      return host.stop();
    case "type":
      return host.type(command.text);
    case "undo":
      return void after(host, () => host.landings.undo());
    case "raw":
      return void after(host, () => host.landings.raw());
    case "paste-last":
      return void after(host, () => host.landings.pasteLast());
    case "profile":
      return void chooseProfile(host);
  }
}
