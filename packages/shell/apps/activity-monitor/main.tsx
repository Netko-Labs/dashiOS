/**
 * Activity Monitor (dev.dashi.activity-monitor):
 * `bun apps/activity-monitor/main.tsx [host] [--tab energy] [--app <key> [--app-name <name>]]`.
 * /proc is read on a worker thread (sampler.ts, through sampling.ts) by read.ts with
 * proc.ts's parsers; sample.ts turns the looks into rows, lines.ts into apps. It
 * stops looking while its window is out of sight (the kit's onWindowVisibility). A
 * second start while it runs (the battery menu's apps) arrives through the kit's
 * `onOpen` (args.ts).
 */

import { protectedPids, readProcStat, sendSignal } from "../../src/shared/processes/kernel.ts";
import { parseStat } from "../../src/shared/processes/proc.ts";
import { readUsers, sysconf } from "../../src/shared/processes/read.ts";
import { menusClient, onWindowVisibility, runApp, systemClipboard } from "../kit/index.ts";
import { parseOpenArgs } from "./lib/args.ts";
import { Monitor } from "./lib/monitor.ts";
import type { Target } from "./lib/policy.ts";
import { Sampler } from "./lib/sampling.ts";
import { MONITOR_MIN_SIZE, MONITOR_SIZE } from "./lib/sizes.ts";
import { MonitorWindow } from "./lib/views/view.tsx";

/** The process `target` named, if it is still that one (a pid is reused once its process ends): its state letter, else null. */
function stateOf(target: Target): string | null {
  const stat = parseStat(readProcStat(target.pid) ?? "");
  return stat && stat.starttime === target.starttime ? stat.state : null;
}

const ownUid = process.getuid?.() ?? -1;
const sampler = new Sampler();
const monitor = new Monitor({ users: readUsers(), ownUid, clockTicks: sysconf("CLK_TCK", 100) }, sampler.look);
monitor.start();
const clipboard = systemClipboard();

const app = runApp(
  { id: "dev.dashi.activity-monitor", title: "Activity Monitor", size: MONITOR_SIZE, minSize: MONITOR_MIN_SIZE },
  <MonitorWindow
    monitor={monitor}
    initial={parseOpenArgs(Bun.argv.slice(2))}
    actions={{
      signal: (target, signal) => (stateOf(target) === null ? "gone" : sendSignal(target.pid, signal)),
      alive: (target) => {
        const state = stateOf(target);
        return state !== null && state !== "Z" && state !== "X";
      },
      guard: { protectedPids: protectedPids(process.pid, readProcStat), self: process.pid },
      copy: (text) => void clipboard.writeText(text),
      onOpen: (listener) => menusClient().onOpen((args) => listener(parseOpenArgs(args))),
    }}
  />,
);
// No looks while no one can see the window (PA-15); a fresh one the moment it is seen again.
onWindowVisibility(app.host, (visible) => (visible ? monitor.resume() : monitor.pause()));
