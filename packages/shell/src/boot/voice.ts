/**
 * Talking to Dashi (main.tsx; voice/): the compositor reports the talk key
 * going down and coming up (`held-key`, the keys the shell holds), the voice
 * service hears and speaks, and what was said goes to the launcher's agent.
 * The lock stops whatever is being heard or said.
 */

import type { Compositor } from "../compositor/index.ts";
import { spokenContext } from "../persona/index.ts";
import type { SettingsStore } from "../settings-app/index.ts";
import { launcherAsker, STOP, startVoice, talks, type VoiceParts } from "../voice/index.ts";
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
  const parts = startVoice({
    settings: settingsStore,
    hold: (keys) => heldKeys.set("voice", keys),
    // The launcher's own tasks: a spoken ask is in its "Now" and its history like a typed one, and its plan waits there for Return.
    // With the capsule up, a spoken plan asks in its card (capsule/), not in the launcher: the capsule handles `voiceCommands`.
    asker: launcherAsker(
      () => late.peek("askAgents")?.tasks ?? null,
      () => {
        if (late.peek("pill")?.voiceCommands.send({ do: "open-ask", id: "spoken" })) return true;
        openLauncher();
        return false;
      },
      // How much Dashi talks (Settings › Your Dashi) reaches spoken answers.
      () => spokenContext(late.peek("pill")?.persona.getSnapshot().talk ?? "normal"),
    ),
    go: (where) => {
      if (where === "launcher") openLauncher();
      else late.peek("settingsApp")?.open(where);
    },
    locale: process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG,
  });
  const stopHearing = compositor
    ? compositor.on((event) => {
        // The Dashi key and the dictation key are boot/dictation.ts's.
        if (event.event === "held-key" && (talks(event.name) || event.name === STOP)) parts.voice.key(event.name, event.down);
        if (event.event === "lock" && event.locked) parts.voice.stop();
      })
    : () => {};
  services.add("voice", () => {
    stopHearing();
    parts.close();
  });
  return { ...parts, heldKeys };
}
