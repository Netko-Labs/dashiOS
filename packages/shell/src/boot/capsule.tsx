/**
 * The capsule at the bottom of the screen and the card on the Dock (main.tsx;
 * capsule/; docs/night-0.9-contract.md): what dictation and Dashi's voice
 * mode show, and where a spoken plan and an agent's question ask. It starts
 * once the launcher's agents have, whose tasks it reads.
 */

import { startCapsule as start } from "../capsule/index.ts";
import type { Compositor } from "../compositor/index.ts";
import { spawnShellHost } from "../shared/metal/index.ts";
import type { VoiceParts } from "../voice/index.ts";
import type { Look } from "./look.ts";
import type { LateParts } from "./parts.ts";
import type { Late, Services } from "./services.ts";

interface CapsuleBootNeeds {
  compositor: Compositor | null;
  talking: VoiceParts;
  look: Look;
  services: Services;
  late: Late<LateParts>;
}

export function startCapsule({ compositor, talking, look, services, late }: CapsuleBootNeeds): void {
  const capsule = start({
    hub: late.get("pill"),
    compositor,
    voice: talking.voice,
    tasks: () => late.peek("askAgents")?.tasks ?? null,
    reduceMotion: () => look.state.reduceMotion,
    openLauncher: () => {
      if (!late.peek("overlays")?.has("launcher")) late.peek("launcher")?.open();
    },
    openSettings: (pane) => late.peek("settingsApp")?.open(pane),
    spawn: (options) => spawnShellHost(options),
    // A file of scene names, for proof without a microphone or an agent (capsule/lib/fake.ts).
    fake: process.env.DASHI_CAPSULE_FAKE || undefined,
  });
  // DASHI_DICTATION_LOG=1: voice mode's states, the asks and the tasks' phases in the session's log, beside dictation's (boot/dictation.ts).
  if (process.env.DASHI_DICTATION_LOG === "1") {
    const hub = late.get("pill");
    hub.voiceMode.subscribe(() => console.error(`dashi-shell: voice-mode ${Date.now() % 100000} ${JSON.stringify(hub.voiceMode.getSnapshot())}`));
    hub.asks.subscribe(() => console.error(`dashi-shell: asks ${Date.now() % 100000} ${JSON.stringify(hub.asks.getSnapshot())}`));
    talking.voice.subscribe(() => console.error(`dashi-shell: chip ${Date.now() % 100000} ${JSON.stringify(talking.voice.getSnapshot())}`));
  }
  services.add("capsule", () => capsule.close());
}
