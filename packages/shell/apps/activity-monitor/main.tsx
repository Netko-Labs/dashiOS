/**
 * Activity Monitor (dev.dashi.activity-monitor): `bun apps/activity-monitor/main.tsx [host]`.
 * /proc is read on a worker thread (sampler.ts, through sampling.ts) by read.ts with
 * proc.ts's parsers; sample.ts turns the looks into rows.
 */

import { readProcStat, sendSignal } from "../../src/force-quit/kernel.ts";
import { protectedPids } from "../../src/force-quit/model.ts";
import { runApp } from "../kit/index.ts";
import { Monitor } from "./monitor.ts";
import { readUsers, sysconf } from "./read.ts";
import { Sampler } from "./sampling.ts";
import { MONITOR_SIZE, MonitorWindow } from "./view.tsx";

const ownUid = process.getuid?.() ?? -1;
const sampler = new Sampler();
const monitor = new Monitor({ users: readUsers(), ownUid, clockTicks: sysconf("CLK_TCK", 100) }, sampler.look);
monitor.start();

runApp(
  { id: "dev.dashi.activity-monitor", title: "Activity Monitor", size: MONITOR_SIZE },
  <MonitorWindow monitor={monitor} actions={{ signal: sendSignal, protectedPids: protectedPids(process.pid, readProcStat) }} />,
);
