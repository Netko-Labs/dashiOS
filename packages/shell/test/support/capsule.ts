/** Voice mode on a stage a test moves (capsule/lib/voice-mode.ts): the fake voice controller and tasks, hand timers, and the card it opens. */

import { FakeTasks, FakeVoice } from "../../src/capsule/lib/fake.ts";
import { VoiceMode } from "../../src/capsule/lib/voice-mode.ts";
import type { OpenCard } from "../../src/capsule/types.ts";
import { createPillHub } from "../../src/shared/pill/index.ts";
import { handTimers } from "./voice.ts";

export function stage(options: { pressed?: () => boolean } = {}) {
  const hub = createPillHub();
  const hand = handTimers();
  let clock = 1000;
  const advance = (ms: number): void => {
    clock += ms;
    hand.advance(ms);
  };
  const voice = new FakeVoice();
  const state: { card: OpenCard | null; mode: VoiceMode | null } = { card: null, mode: null };
  const tasks = new FakeTasks(hand, async (task) => (state.mode?.saidYes(task) ?? false) || (options.pressed?.() ?? false), 1000);
  const mode = new VoiceMode({
    hub,
    voice,
    tasks: () => tasks,
    onCard: (card) => void (state.card = card),
    timers: hand,
    now: () => clock,
  });
  state.mode = mode;
  /** A spoken ask, as 0.8 tells it: the words heard, then the task. */
  const say = (request: string): string => {
    voice.show({ kind: "thinking", text: request });
    return tasks.ask(request);
  };
  return { hub, voice, tasks, mode, state, advance, say, phase: () => hub.voiceMode.getSnapshot().phase };
}
