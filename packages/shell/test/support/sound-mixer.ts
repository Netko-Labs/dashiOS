/**
 * Shared set-up for the volume mixer tests: the apps' catalog and processes, the owner of a stream,
 * a graph the test pushes by hand, and a control that records what it was asked.
 */

import { catalogFrom } from "../../src/shared/processes/index.ts";
import { type GraphWatch, parseGraph, type Stream } from "../../src/sound/apps/index.ts";
import type { MixerControl } from "../../src/sound/apps/lib/commands.ts";
import { type ProcessLook, streamApp } from "../../src/sound/apps/lib/identity.ts";

const HELIUM = { id: "helium", name: "Helium", icon: "/icons/helium.png", exec: ["/opt/helium/helium", "%U"] };
const LOLLYPOP = { id: "org.gnome.Lollypop", name: "Lollypop", icon: "/icons/lollypop.png", exec: ["flatpak", "run", "org.gnome.Lollypop"] };
export const catalog = catalogFrom([HELIUM, LOLLYPOP, { id: "signal", name: "Signal", icon: "/icons/signal.png", exec: ["/usr/bin/signal-desktop"] }], []);

/** The processes of the proof: Helium's audio service under its browser, Signal, a sandboxed pid that must not be read. */
const PROCESSES = new Map<number, ProcessLook>([
  [231610, { comm: "helium", ppid: 229974, argv: ["/opt/helium/helium", "--type=utility", "--utility-sub-type=audio.mojom.AudioService"], cgroup: "" }],
  [229974, { comm: "helium", ppid: 1500, argv: ["/opt/helium/helium"], cgroup: "" }],
  [5000, { comm: "signal-desktop", ppid: 1500, argv: ["/usr/bin/signal-desktop"], cgroup: "" }],
  [228856, { comm: "pw-play", ppid: 1400, argv: ["pw-play", "--media-role=Music", "tone-a.wav"], cgroup: "" }],
  [1400, { comm: "bash", ppid: 1, argv: ["-bash"], cgroup: "" }],
  [2, { comm: "kthreadd", ppid: 0, argv: [], cgroup: "" }],
  [4242, { comm: "lollypop", ppid: 1, argv: ["/app/bin/lollypop"], cgroup: "0::/user.slice/app-flatpak-org.gnome.Lollypop-4242.scope\n" }],
]);
export const owner = (stream: Stream): ReturnType<typeof streamApp> => streamApp(stream, { catalog, read: (pid: number) => PROCESSES.get(pid) ?? null });

/** A graph the test pushes by hand. */
export function pushedGraph(): GraphWatch & { push(objects: Record<string, unknown>[]): void } {
  let listener: ((graph: ReturnType<typeof parseGraph>) => void) | null = null;
  return {
    available: true,
    start(onGraph) {
      listener = onGraph;
      return () => {
        listener = null;
      };
    },
    push(objects) {
      listener?.(parseGraph(objects));
    },
  };
}

export function recordingControl(): MixerControl & { calls: string[] } {
  const calls: string[] = [];
  return {
    held: false,
    calls,
    setLevel: async (ids, level) => calls.push(`level ${ids.join(",")} ${level}`) > 0,
    setMuted: async (ids, muted) => calls.push(`mute ${ids.join(",")} ${muted}`) > 0,
    setOutput: async (ids, output) => calls.push(`output ${ids.join(",")} ${output}`) > 0,
  };
}
