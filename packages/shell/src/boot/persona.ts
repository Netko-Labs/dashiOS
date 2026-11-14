/**
 * Who Dashi is (main.tsx; persona/; docs/night-0.9-contract.md, "persona"): settings.json's
 * `persona` and the characters folder, kept current in the hub's `persona` cell, which the capsule,
 * the bar and the voice loop read, and in the assistant's prompt style (agents/ask). A change in
 * Settings › Your Dashi shows at once, with no logging out.
 */

import { promptStyle } from "../agents/index.ts";
import type { Compositor } from "../compositor/index.ts";
import { AT_EASE, afterFailure, type Circumstances, type PersonaSource, startPersona } from "../persona/index.ts";
import type { SettingsStore } from "../settings-app/index.ts";
import type { LateParts } from "./parts.ts";
import type { Late, Services } from "./services.ts";

export function startPersonaPiece({
  settingsStore,
  services,
  late,
}: {
  settingsStore: SettingsStore;
  services: Services;
  late: Late<LateParts>;
}): PersonaSource {
  const hub = late.get("pill");
  const source = startPersona({ settings: settingsStore, set: (persona) => hub.persona.set(persona), style: (style) => promptStyle.set(style) });
  services.add("persona", () => source.stop());
  return late.set("persona", source);
}

interface Around {
  compositor: Compositor | null;
  /** Another program captures the screen (screen-capture/). */
  sharing: { subscribe(listener: () => void): () => void; getSnapshot(): boolean };
  /** The screen recorder, where there is one (recorder/). */
  recorder: { subscribe(listener: () => void): () => void; getSnapshot(): { kind: string } } | null;
  services: Services;
  late: Late<LateParts>;
}

/**
 * Tells the persona what is going on around Dashi, so it knows when to drop the act
 * (persona/lib/act.ts has the rule): the screen shared or recorded, a window full screen, the last
 * ask failed. Called once the launcher's agents have started, whose tasks it reads. A call cannot
 * be known yet, so nothing sets it.
 */
export function followCircumstances({ compositor, sharing, recorder, services, late }: Around): void {
  const source = late.get("persona");
  const tasks = late.peek("askAgents")?.tasks ?? null;
  let fullScreen = false;
  const tell = (): void => {
    const now: Circumstances = {
      ...AT_EASE,
      shared: sharing.getSnapshot(),
      recording: recorder?.getSnapshot().kind === "recording",
      fullScreen,
      afterFailure: tasks ? afterFailure(tasks.getSnapshot()) : false,
    };
    source.circumstances(now);
  };
  const look = (): void =>
    void compositor
      ?.windows()
      .then((windows) => {
        fullScreen = windows.some((window) => window.fullscreen === true && window.state === "normal");
        tell();
      })
      .catch(() => {});
  const offs = [
    sharing.subscribe(tell),
    recorder?.subscribe(tell),
    tasks?.subscribe(tell),
    compositor?.on((event) => {
      if (event.event === "fullscreen" || event.event === "window-closed" || event.event === "window-state") look();
    }),
  ];
  look();
  tell();
  services.add("persona's circumstances", () => {
    for (const off of offs) off?.();
  });
}
