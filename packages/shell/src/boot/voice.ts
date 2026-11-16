/**
 * Talking to Dashi (main.tsx; voice/): the compositor reports the talk key
 * going down and coming up (`held-key`, the keys the shell holds), the voice
 * service hears and speaks, and what was said goes to the launcher's agent.
 * The lock stops whatever is being heard or said.
 */

import type { Compositor } from "../compositor/index.ts";
import { spokenContext } from "../persona/index.ts";
import type { SettingsStore } from "../settings-app/index.ts";
import { endedLine, launcherAsker, STOP, startVoice, talks, type VoiceParts } from "../voice/index.ts";
import { startAssistantPiece } from "./assistant.ts";
import type { LateParts } from "./parts.ts";
import type { Late, Services } from "./services.ts";

interface TalkingNeeds {
  compositor: Compositor | null;
  settingsStore: SettingsStore;
  services: Services;
  late: Late<LateParts>;
}

/** A key the compositor is asked to hear (`held-keys`). */
type HeldKey = Parameters<Compositor["heldKeys"]>[0]["keys"][number];

/**
 * The keys the shell holds, from each who holds some (Voice's talk key; dictation's two keys,
 * boot/dictation.ts): `held-keys` takes the whole list each time. A code listed twice would
 * refuse the list, so the first to name a code keeps it.
 */
export class HeldKeyList {
  private readonly parts = new Map<string, readonly HeldKey[]>();

  constructor(private readonly compositor: Compositor | null) {}

  set(part: string, keys: readonly HeldKey[]): void {
    this.parts.set(part, keys);
    const codes = new Set<number>();
    const all = [...this.parts.values()].flat().filter((key) => !codes.has(key.code) && codes.add(key.code));
    void this.compositor?.heldKeys({ keys: all }).catch((error) => console.error("dashi-shell: dashi-comp refused the held keys:", error));
  }
}

export interface Talking extends VoiceParts {
  heldKeys: HeldKeyList;
}

export function startTalking({ compositor, settingsStore, services, late }: TalkingNeeds): Talking {
  const heldKeys = new HeldKeyList(compositor);
  const openLauncher = (): void => {
    if (!late.peek("overlays")?.has("launcher")) late.peek("launcher")?.open();
  };
  // Plan mode, as 0.8 asked: the launcher's own tasks, a plan that waits for a yes. It answers "Ask before every step" and an
  // answerer with no loop yet. With the capsule up, a spoken plan asks in its card (capsule/), not in the launcher.
  const planner = launcherAsker(
    () => late.peek("askAgents")?.tasks ?? null,
    () => {
      if (late.peek("pill")?.voiceCommands.send({ do: "open-ask", id: "spoken" })) return true;
      openLauncher();
      return false;
    },
    // How much Dashi talks (Settings › Your Dashi) reaches spoken answers.
    () => spokenContext(late.peek("pill")?.persona.getSnapshot().talk ?? "normal"),
  );
  // What is said goes to Dashi's assistant: one conversation, and the tools any agent has, in a loop (agents/assistant/).
  const assistant = startAssistantPiece({ compositor, settingsStore, services, late, planner });
  const parts = startVoice({
    settings: settingsStore,
    hold: (keys) => heldKeys.set("voice", keys),
    // Dashi hears the person's words as dictation writes them ("d tree code" → "T3 Code"; D198).
    asker: {
      ask: (words, signal, hears) => assistant.ask(late.peek("dictation")?.lexicon?.spell(words) ?? words, signal, hears),
      talk: assistant.talk,
      prepare: () => assistant.prepare(),
    },
    go: (where) => {
      if (where === "launcher") openLauncher();
      else late.peek("settingsApp")?.open(where);
    },
    locale: process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG,
  });
  // Every listen's end, the Dashi key's and dictation's: why, how much speech, and what heard it (D199).
  const offEnded = parts.service.on((event) => {
    if (event.event === "heard") console.error(`dashi-shell: voice ${endedLine(event)}`);
  });
  const stopHearing = compositor
    ? compositor.on((event) => {
        // The Dashi key and the dictation key are boot/dictation.ts's.
        if (event.event === "held-key" && (talks(event.name) || event.name === STOP)) parts.voice.key(event.name, event.down);
        // The lock ends the conversation too.
        if (event.event === "lock" && event.locked) parts.voice.stop(true);
      })
    : () => {};
  // A dictation opens the microphone, and that stops Dashi's sound (the service's rule): what it was saying waits and is said after.
  const hub = late.peek("pill");
  const open = (): boolean => ["opening", "listening", "tidying"].includes(hub?.dictation.getSnapshot().phase ?? "idle");
  let dictating = open();
  const offDictation = hub?.dictation.subscribe(() => {
    if (open() === dictating) return;
    dictating = !dictating;
    if (dictating) parts.voice.pauseSpeech();
    else parts.voice.resumeSpeech();
  });
  services.add("voice", () => {
    offEnded();
    stopHearing();
    offDictation?.();
    parts.close();
  });
  return { ...parts, heldKeys };
}
