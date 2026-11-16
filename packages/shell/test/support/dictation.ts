/** Dictation with a scripted voice service, a window in front and timers a test moves (dictation/). */

import { Dictation } from "../../src/dictation/dictation.ts";
import type { DictationDeps, Front } from "../../src/dictation/types.ts";
import { createPillHub, type DictationState, type DictationTrouble, type KeyGestureKind } from "../../src/shared/pill/index.ts";
import { settle } from "./time.ts";
import { fakeVoice, handTimers } from "./voice.ts";

interface DictatingOptions {
  heard?: string;
  taught?: boolean;
  history?: DictationDeps["history"];
  rewriter?: DictationDeps["rewriter"];
  words?: DictationDeps["words"];
  lexicon?: DictationDeps["lexicon"];
}

export function dictating(options: DictatingOptions = {}) {
  const voice = fakeVoice({ "listen.stop": { text: options.heard ?? "Um, hello there.", speech_ms: 900 } });
  const timers = handTimers();
  const hub = createPillHub();
  const typed: string[] = [];
  const keys: string[] = [];
  const world = {
    on: true,
    tidy: true,
    handsFree: true,
    trouble: null as DictationTrouble | null,
    busy: false,
    muted: false,
    front: { window: 7, pid: 70 } as Front | null,
    secret: false as boolean | null,
    /** The field check never answers, as an accessibility bus that is still starting. */
    secretHangs: false,
    /** The text around the caret; null where the field can't be read. */
    before: null as string | null,
    after: null as string | null,
    role: "text" as "terminal" | "entry" | "text" | "other",
    site: null as string | null,
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
    secret: () => (world.secretHangs ? new Promise<boolean | null>(() => {}) : Promise.resolve(world.secret)),
    field: () => {
      if (world.secretHangs) return new Promise<null>(() => {});
      if (world.secret === null) return Promise.resolve(null);
      const kind = world.secret ? "password" : "text";
      return Promise.resolve({ kind, role: world.role, site: world.site, before: world.before, after: world.after });
    },
    sendKeys: async (window, chord) => {
      if (world.refuse) throw new Error(world.refuse);
      keys.push(`${window}:${chord}`);
      // A BackSpace takes the last character of what the field holds, as an app does.
      if (chord === "BackSpace" && world.before !== null) world.before = [...world.before].slice(0, -1).join("");
    },
    pressed: async () => world.pressed,
    typeText: async (window, text, how = {}) => {
      if (world.refuse) throw new Error(world.refuse);
      // BackSpaces first, as the compositor types them: each takes the last character the field holds.
      for (let sent = 0; sent < (how.erase ?? 0); sent++) {
        keys.push(`${window}:BackSpace`);
        if (world.before !== null) world.before = [...world.before].slice(0, -1).join("");
      }
      if (text === "") return;
      // A line break typed as a chord is shown as the chord, between the lines.
      typed.push(`${window}:${how.breaks ? text.replaceAll("\n", `<${how.breaks}>`) : text}`);
      if (world.before !== null) world.before += text;
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
    history: options.history,
    rewriter: options.rewriter,
    words: options.words,
    lexicon: options.lexicon,
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
  return { voice, timers, hub, typed, keys, world, deps, dictation, states, key, hold, state, phases };
}
