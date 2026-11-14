/** Dictation with a scripted voice service, a window in front and timers a test moves (dictation/). */

import { Dictation } from "../../src/dictation/dictation.ts";
import type { DictationDeps, Front } from "../../src/dictation/types.ts";
import { createPillHub, type DictationState, type DictationTrouble, type KeyGestureKind } from "../../src/shared/pill/index.ts";
import { settle } from "./time.ts";
import { fakeVoice, handTimers } from "./voice.ts";

export function dictating(options: { heard?: string; taught?: boolean } = {}) {
  const voice = fakeVoice({ "listen.stop": { text: options.heard ?? "Um, hello there.", speech_ms: 900 } });
  const timers = handTimers();
  const hub = createPillHub();
  const typed: string[] = [];
  const world = {
    on: true,
    tidy: true,
    handsFree: true,
    trouble: null as DictationTrouble | null,
    busy: false,
    muted: false,
    front: { window: 7, pid: 70 } as Front | null,
    secret: false as boolean | null,
    /** How long ago the person pressed something in the window in front. */
    pressed: null as number | null,
    refuse: null as string | null,
    pastes: true,
    taught: options.taught ?? true,
    chimes: 0,
    copied: [] as string[],
    now: 1000,
  };
  const deps: DictationDeps = {
    hub,
    service: voice.service,
    prefs: () => ({ on: world.on, tidy: world.tidy, handsFree: world.handsFree, name: "Dashi" }),
    trouble: () => world.trouble,
    busy: () => world.busy,
    muted: async () => world.muted,
    front: async () => world.front,
    secret: async () => world.secret,
    pressed: async () => world.pressed,
    typeText: async (window, text) => {
      if (world.refuse) throw new Error(world.refuse);
      typed.push(`${window}:${text}`);
    },
    paste: async (window, text) => {
      if (world.pastes) typed.push(`paste ${window}:${text}`);
      return world.pastes;
    },
    copy: async (text) => {
      world.copied.push(text);
      return true;
    },
    chime: () => void world.chimes++,
    taught: () => world.taught,
    teach: () => {
      world.taught = true;
    },
    timers,
    now: () => world.now,
  };
  const dictation = new Dictation(deps);
  const states: DictationState[] = [];
  hub.dictation.subscribe(() => states.push(hub.dictation.getSnapshot()));
  const key = async (gesture: KeyGestureKind): Promise<void> => {
    dictation.gesture({ key: "dictation", gesture, at: world.now });
    await settle();
  };
  const hold = async (): Promise<void> => {
    await key("down");
    await key("hold");
  };
  const state = (): DictationState => hub.dictation.getSnapshot();
  const phases = (): string[] => states.map((each) => each.phase);
  return { voice, timers, hub, typed, world, dictation, states, key, hold, state, phases };
}
