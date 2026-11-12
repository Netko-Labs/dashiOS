/**
 * Talking to Dashi (main.tsx; voice/): the compositor reports the talk key
 * going down and coming up (`held-key`, the keys the shell holds), the voice
 * service hears and speaks, and what was said goes to the launcher's agent.
 * The lock stops whatever is being heard or said.
 */

import type { Compositor } from "../compositor/index.ts";
import type { SettingsStore } from "../settings-app/index.ts";
import { launcherAsker, startVoice, type VoiceParts } from "../voice/index.ts";
import type { LateParts } from "./parts.ts";
import type { Late, Services } from "./services.ts";

interface TalkingNeeds {
  compositor: Compositor | null;
  settingsStore: SettingsStore;
  services: Services;
  late: Late<LateParts>;
}

export function startTalking({ compositor, settingsStore, services, late }: TalkingNeeds): VoiceParts {
  const openLauncher = (): void => {
    if (!late.peek("overlays")?.has("launcher")) late.peek("launcher")?.open();
  };
  const parts = startVoice({
    settings: settingsStore,
    hold: (keys) => void compositor?.heldKeys({ keys }).catch((error) => console.error("dashi-shell: dashi-comp refused the talk key:", error)),
    // The launcher's own tasks: a spoken ask is in its "Now" and its history like a typed one, and its plan waits there for Return.
    asker: launcherAsker(() => late.peek("askAgents")?.tasks ?? null, openLauncher),
    go: (where) => {
      if (where === "launcher") openLauncher();
      else late.peek("settingsApp")?.open(where);
    },
    locale: process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG,
  });
  const stopHearing = compositor
    ? compositor.on((event) => {
        if (event.event === "held-key") parts.voice.key(event.name, event.down);
        if (event.event === "lock" && event.locked) parts.voice.stop();
      })
    : () => {};
  services.add("voice", () => {
    stopHearing();
    parts.close();
  });
  return parts;
}
