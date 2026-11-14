/**
 * What the menu bar's status side holds, from live state: the programs'
 * own items (tray icons and applets, extras/), someone sharing the screen,
 * the agents' mark, the person's own recording, the microphone while an app
 * records from it, then the system's own (menubar-slots.tsx). The status
 * side (menubar-status.tsx) lays them out.
 */

import { useColors } from "@dashi/ui";
import type { Bounds } from "@mirinjs/metal";
import { useState, useSyncExternalStore } from "react";
import {
  type AgentRuns,
  type AgentStore,
  type AloneState,
  agentRecording,
  type MarkState,
  markState,
  mergeAgents,
  type Recording,
  recordingPill,
  useAgents,
  type WorkAlone,
} from "../../agents/index.ts";
import { useRuns } from "../../agents-panel/index.ts";
import { AloneChip } from "../../alone-chip.tsx";
import { ExtraItem, type ExtrasStore, type MenuBarExtra, useExtras } from "../../extras/index.ts";
import { extraEntries, type MenuController, type Popover } from "../../menus/index.ts";
import { RecordingButton, type ScreenRecorder } from "../../recorder/index.ts";
import { CapturePill, type ScreenCaptureStore, useScreenCapture } from "../../screen-capture/index.ts";
import { useSettings } from "../../settings-app/hooks.ts";
import type { SettingsStore } from "../../settings-app/store.ts";
import { controlFlags, useFlags } from "../../shared/control-center/index.ts";
import { formatClock, useClockPrefs, useMinuteClock } from "../../shared/time/index.ts";
import { type AppMixer, MicPill, useMicWords } from "../../sound/index.ts";
import { type SystemStore, useSystem } from "../../system/store.ts";
import type { BarPill } from "../pill.ts";
import { extraGoes, MENU_GAP } from "./menubar-fit.ts";
import { agentMarkSlot, jobsSlot, type PillNow, usePill } from "./menubar-pill-slots.tsx";
import { systemSlots } from "./menubar-slots.tsx";
import type { StatusSlot } from "./menubar-status.tsx";

/** The least room kept between the app's menus and the jobs. */
const JOBS_GAP = 12;

/** The bar's tooltip (bar-tip.tsx): words under a point of this bar (as wide as `barWidth`), or none. */
export type BarTip = { text: string; x: number; barWidth?: number; output?: string } | null;

/** What the status side is built from. */
export interface StatusSources {
  agents: AgentStore;
  capture: ScreenCaptureStore;
  /** The screen recorder: the person's recording's stop button (recorder/), an agent's red dot. */
  recorder?: ScreenRecorder;
  system: SystemStore;
  menus: MenuController;
  /** Tray icons and applets (extras/). */
  extras: ExtrasStore;
  /** settings.json: what the status area shows (`menuBar`, set in System Settings). */
  settings: SettingsStore;
  /** The screen this bar is on (an output name); its popovers open there. Absent when the screen is unknown. */
  output?: string;
  /** Agents from the launcher: with the connected ones, the mark and its panel (agents-panel/agents-panel.tsx). */
  runs?: Pick<AgentRuns, "subscribe" | "getSnapshot">;
  /** Work alone (agents/alone/): its chip while it runs, with the time left and the stop. */
  alone?: Pick<WorkAlone, "subscribe" | "getSnapshot" | "stop">;
  /** The apps' sound: the microphone indicator while one records (sound/apps/). */
  mixer?: AppMixer;
  /** Dashi's mark, the jobs beside it and the field (pill.ts); without it the mark only shows who watches. */
  pill?: BarPill;
  /** Show or take down the bar's tooltip (the agent mark's words). */
  onTip?: (tip: BarTip) => void;
  /** Reduce Motion: the mark's ring stands still. */
  reduceMotion?: () => boolean;
  /** The Metal host takes accessibility props (launcher/access.ts). */
  accessible?: () => boolean;
}

const IDLE: Recording = { kind: "idle" };
const NEVER = () => () => {};
const NO_RUNS = { subscribe: NEVER, getSnapshot: () => [] } as const;
const NOT_ALONE: AloneState = { on: false };

/** The recorder's state, or idle without one. */
function useRecording(recorder: ScreenRecorder | undefined): Recording {
  return useSyncExternalStore(recorder?.subscribe ?? NEVER, recorder ? recorder.getSnapshot : () => IDLE);
}

/** What the program slots need from the bar and its state. */
export interface ProgramContext {
  sources: StatusSources;
  popover: Popover | null;
  appName: string;
  recording: Recording;
  mark: MarkState;
  alone: AloneState;
  micWords: string;
  capturing: boolean;
  extras: readonly MenuBarExtra[];
  tip: (shown: { text: string; bounds: Bounds } | null) => void;
  openSound: () => void;
  /** The jobs, who speaks, the asks and the persona, as read now. */
  pill: PillNow | null;
}

function extraSlots({ sources, popover, appName, extras, accessible }: ProgramContext & { accessible: boolean }): StatusSlot[] {
  const { menus, output } = sources;
  const statusMenuKey = popover?.kind === "status-menu" ? popover.key : null;
  const openExtraMenu = (extra: MenuBarExtra, right: number) => {
    if (statusMenuKey === extra.key) {
      menus.close();
      return;
    }
    void sources.extras.menu(extra.key).then((rows) => {
      if (rows.length > 0) void menus.toggleStatusMenu(extra.key, right, extraEntries(extra.key, rows), appName, output);
    });
  };
  return extras.map((extra, index) => ({
    key: `extra:${extra.key}`,
    goes: extraGoes(index),
    extra: true,
    attention: extra.attention,
    label: extra.title,
    // As a click does: its menu under it, or the app's own answer (it leaves the bar).
    open: extra.menuOnClick
      ? { kind: "panel" as const, run: (bounds: Bounds | null) => openExtraMenu(extra, bounds ? bounds.x + bounds.width : 0) }
      : {
          kind: "action" as const,
          run: (bounds: Bounds | null) =>
            sources.extras.activate(extra.key, bounds ? bounds.x + bounds.width / 2 : 0, bounds ? bounds.y + bounds.height : 0, output),
        },
    node: (
      <ExtraItem
        extra={extra}
        open={statusMenuKey === extra.key}
        onMenu={openExtraMenu}
        onActivate={(each, x, y) => sources.extras.activate(each.key, x, y, output)}
        accessible={accessible}
      />
    ),
  }));
}

/** Agents work alone: the chip, beside the mark, never hidden. A click (or the keyboard) stops it. */
function aloneSlot({ sources, alone, tip }: ProgramContext): StatusSlot[] {
  if (!alone.on) return [];
  const stop = () => void sources.alone?.stop();
  return [
    {
      key: "work-alone",
      goes: null,
      label: "Agents work alone. Stop",
      radius: 11,
      open: { kind: "action" as const, run: stop },
      node: <AloneChip state={alone} onStop={stop} onTip={tip} />,
    },
  ];
}

function recordingSlot({ sources, recording, mark }: ProgramContext): StatusSlot[] {
  const { recorder } = sources;
  if (!(recorder && recordingPill(recording, mark.kind !== "none"))) return [];
  return [
    {
      key: "recording",
      goes: null,
      label: "Stop recording",
      radius: 10,
      open: { kind: "action" as const, run: () => void recorder.stop() },
      node: <RecordingButton recorder={recorder} />,
    },
  ];
}

function micSlot({ micWords, openSound, tip }: ProgramContext): StatusSlot[] {
  if (micWords === "") return [];
  return [
    {
      key: "microphone",
      goes: null,
      label: micWords,
      radius: 10,
      open: { kind: "action" as const, run: openSound },
      node: <MicPill words={micWords} onPress={openSound} onTip={tip} />,
    },
  ];
}

/** The room the jobs have: what the menus leave the status side, less everything else in it (the jobs' own width as drawn is told back). */
function useJobsRoom(fit: { room: number | null; statusWidth: number | null }): [number | null, (width: number) => void] {
  const [jobsWidth, setJobsWidth] = useState(0);
  const others = fit.statusWidth === null ? null : Math.max(0, fit.statusWidth - jobsWidth);
  const room = fit.room === null || others === null ? null : Math.max(0, fit.room + MENU_GAP - JOBS_GAP - others);
  return [room, (width) => setJobsWidth((was) => (Math.abs(was - width) < 0.5 ? was : width))];
}

/** The status side's slots, left to right, as the bar draws them. */
export function useStatusSlots(
  sources: StatusSources,
  popover: Popover | null,
  appName: string,
  barWidth: number | null,
  /** The room the menus leave the whole status side, and its width as drawn: what is left over is the jobs'. */
  fit: { room: number | null; statusWidth: number | null } = { room: null, statusWidth: null },
): StatusSlot[] {
  const { agents, capture, recorder, system, menus, settings, output, runs, mixer, onTip, accessible = () => false } = sources;
  const colors = useColors();
  const recording = useRecording(recorder);
  const [jobsRoom, setJobsWidth] = useJobsRoom(fit);
  const context: ProgramContext = {
    sources,
    popover,
    appName,
    recording,
    // Every agent, launched or connected, is one mark; an agent's recording is its red dot.
    mark: markState(mergeAgents(useAgents(agents), useRuns(runs ?? NO_RUNS)), agentRecording(recording)),
    alone: useSyncExternalStore(sources.alone?.subscribe ?? NEVER, sources.alone ? sources.alone.getSnapshot : () => NOT_ALONE),
    micWords: useMicWords(mixer),
    // Someone shares the screen, and it isn't Dashi's own recorder (the pill decides that itself).
    capturing: useScreenCapture(capture) && recording.kind === "idle",
    extras: useExtras(sources.extras),
    tip: (shown) =>
      onTip?.(
        shown
          ? {
              text: shown.text,
              x: shown.bounds.x + shown.bounds.width / 2,
              ...(barWidth === null ? {} : { barWidth }),
              ...(output === undefined ? {} : { output }),
            }
          : null,
      ),
    openSound: () => void menus.toggleControlCenter(appName, "sound", output),
    pill: usePill(sources.pill, output, colors.agent),
  };
  const { battery, network, volume } = useSystem(system);
  const { menuBar } = useSettings(settings).data;
  // Banners stop while Do Not Disturb is on; the moon says why, as on a Mac.
  const { dnd } = useFlags(controlFlags());
  const now = useMinuteClock();
  const clock = useClockPrefs();
  return [
    // The jobs, then Dashi's mark, lead the status items (never hidden); "work alone" says so beside them.
    ...jobsSlot(context, jobsRoom, setJobsWidth, accessible()),
    ...agentMarkSlot(context, accessible()),
    ...aloneSlot(context),
    ...extraSlots({ ...context, accessible: accessible() }),
    // Never hidden: someone else sharing the screen, the person's own recording.
    ...(context.capturing ? [{ key: "capture", goes: null, node: <CapturePill store={capture} {...(recorder ? { recorder } : {})} /> }] : []),
    ...recordingSlot(context),
    // Never hidden either: an app using the microphone.
    ...micSlot(context),
    ...systemSlots({
      ...{ battery, network, volume },
      batteryPercent: menuBar.batteryPercent === true,
      sound: menuBar.sound !== false,
      dnd,
      popover,
      clock: formatClock(now, clock),
      colors,
      accessible: accessible(),
      on: {
        battery: (bounds?: Bounds) => {
          if (!battery || !bounds) return;
          // The battery panel (battery/lib/panel.tsx) under the item, its right edge at the item's.
          void menus.toggleBattery(bounds.x + bounds.width, appName, output);
        },
        controlCenter: () => void menus.toggleControlCenter(appName, "main", output),
        wifi: () => void menus.toggleControlCenter(appName, "wifi", output),
        sound: context.openSound,
        clock: () => void menus.toggleNotificationCenter(appName, output),
      },
    }),
  ];
}
