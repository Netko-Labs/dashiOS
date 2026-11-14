/**
 * What the menu bars are built from (../bars.tsx): a bar's status sources on
 * one screen, what Dashi's mark, the jobs and the field need of the session
 * (menubar/start-pill.tsx), and the voice chip's source.
 */

import type { BarPill, startBarPill } from "../../menubar/index.ts";
import { openOverlay } from "../../overlay.tsx";
import type { PillHub } from "../../shared/pill/index.ts";
import type { ChipSource, VoiceParts } from "../../voice/index.ts";
import type { BarsNeeds } from "../bars.tsx";

type PillNeeds = Parameters<typeof startBarPill>[0];

/** What the bars' chip reads of the voice: the one object for every bar. It stops showing once the capsule piece takes voice commands: the capsule says the same words. */
const chipSources = new WeakMap<VoiceParts, ChipSource>();
export function chipSource(talking: VoiceParts, hub: PillHub): ChipSource {
  const made = chipSources.get(talking);
  if (made) return made;
  const { voice } = talking;
  let capsule = false;
  // Asking for no ask's card changes nothing; it only says whether anyone handles the port.
  const capsuleShows = (): boolean => {
    capsule ||= hub.voiceCommands.send({ do: "open-ask", id: "" });
    return capsule;
  };
  const source: ChipSource = {
    subscribe: voice.subscribe,
    getSnapshot: () => (voice.getSnapshot() !== null && capsuleShows() ? null : voice.getSnapshot()),
    level: voice.level,
    stop: () => voice.stop(),
    go: talking.go,
  };
  chipSources.set(talking, source);
  return source;
}

/** What Dashi's mark, the jobs and the field need of the session (menubar/start-pill.tsx). */
export function pillNeeds(needs: BarsNeeds, bar: PillNeeds["bar"]): PillNeeds {
  const { late } = needs;
  return {
    hub: late.get("pill"),
    open: openOverlay,
    tasks: () => late.peek("askAgents")?.tasks ?? null,
    asker: () => {
      const ask = late.peek("askAgents");
      return ask ? { ready: () => ask.launcher.getSnapshot().answerer !== null, send: (text) => ask.tasks.ask(text), setUp: () => ask.launcher.setUp() } : null;
    },
    agents: needs.agents.agentStore,
    runs: needs.handoff.handoffShell.service.runs,
    menus: needs.menus.controller,
    primary: () => late.peek("menuBars")?.primaryName ?? needs.primaryScreen,
    showLauncher: () => {
      if (!late.peek("overlays")?.has("launcher")) late.peek("launcher")?.open();
    },
    bar,
  };
}

/** What a bar's status side is built from, on that screen. */
export function barSources(needs: BarsNeeds, output: string | undefined, pill: BarPill): ReturnType<PillNeeds["bar"]> {
  const { stores, programs, late } = needs;
  return {
    agents: needs.agents.agentStore,
    alone: needs.agents.alone,
    capture: needs.guards.screenCapture,
    ...(needs.screenshots.tools ? { recorder: needs.screenshots.tools.recorder } : {}),
    system: needs.system.system.store,
    menus: needs.menus.controller,
    extras: programs.extras,
    settings: stores.settingsStore,
    ...(output === undefined ? {} : { output }),
    runs: needs.handoff.handoffShell.service.runs,
    mixer: needs.mixer,
    pill,
    onTip: (tip) => needs.barTips.show(tip),
    reduceMotion: () => needs.look.state.reduceMotion,
    accessible: () => late.get("launcherAccess").accessible,
  };
}
