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
  services.add("capsule", () => capsule.close());
}
