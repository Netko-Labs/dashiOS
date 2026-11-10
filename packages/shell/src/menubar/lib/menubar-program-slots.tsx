/**
 * What the menu bar's status side holds, from live state: the programs'
 * own items (tray icons and applets, extras/), someone sharing the screen,
 * the agents' mark, the person's own recording, the microphone while an app
 * records from it, then the system's own (menubar-slots.tsx). The status
 * side (menubar-status.tsx) lays them out.
 */

import { useColors } from "@dashi/ui";
import type { Bounds } from "@mirinjs/metal";
import { useSyncExternalStore } from "react";
import { AgentMark } from "../../agent-mark.tsx";
import type { AgentRuns } from "../../agents/handoff/store.ts";
import { type AgentStore, useAgents } from "../../agents/index.ts";
import { agentRecording, type MarkState, markState, mergeAgents, type Recording, recordingPill } from "../../agents/mark.ts";
import { useRuns } from "../../agents-panel.tsx";
import { type ExtrasStore, type MenuBarExtra, useExtras } from "../../extras/index.ts";
import { ExtraItem } from "../../extras/view.tsx";
import { extraEntries, type MenuController, type Popover } from "../../menus/index.ts";
import { RecordingButton, type ScreenRecorder } from "../../recorder/index.ts";
import { type ScreenCaptureStore, useScreenCapture } from "../../screen-capture.ts";
import { CapturePill } from "../../screen-capture.tsx";
import { useSettings } from "../../settings-app/hooks.ts";
import type { SettingsStore } from "../../settings-app/store.ts";
import { controlFlags, useFlags } from "../../shared/control-center/flags.ts";
import { formatClock, useClockPrefs, useMinuteClock } from "../../shared/time/clock.ts";
import { type AppMixer, useMicWords } from "../../sound/apps/index.ts";
import { MicPill } from "../../sound/mic-pill.tsx";
import { type SystemStore, useSystem } from "../../system/store.ts";
import { extraGoes } from "./menubar-fit.ts";
import { systemSlots } from "./menubar-slots.tsx";
import type { StatusSlot } from "./menubar-status.tsx";

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
  /** Agents from the launcher: with the connected ones, the mark and its panel (agents-panel.tsx). */
  runs?: Pick<AgentRuns, "subscribe" | "getSnapshot">;
  /** The apps' sound: the microphone indicator while one records (sound/apps/). */
  mixer?: AppMixer;
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

/** The recorder's state, or idle without one. */
function useRecording(recorder: ScreenRecorder | undefined): Recording {
  return useSyncExternalStore(recorder?.subscribe ?? NEVER, recorder ? recorder.getSnapshot : () => IDLE);
}

/** What the program slots need from the bar and its state. */
interface ProgramContext {
  sources: StatusSources;
  popover: Popover | null;
  appName: string;
  recording: Recording;
  mark: MarkState;
  micWords: string;
  capturing: boolean;
  extras: readonly MenuBarExtra[];
  tip: (shown: { text: string; bounds: Bounds } | null) => void;
  openSound: () => void;
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

function agentMarkSlot({ sources, popover, appName, mark, tip }: ProgramContext, accessible: boolean): StatusSlot[] {
  if (mark.kind === "none") return [];
  const { menus, output, reduceMotion = () => false } = sources;
  return [
    {
      key: "agent-mark",
      goes: null,
      label: mark.label,
      radius: 11,
      open: {
        kind: "panel" as const,
        run: (bounds: Bounds | null) => void menus.toggleAgents(appName, bounds ? bounds.x + bounds.width : 0, null, output),
      },
      node: (
        <AgentMark
          state={mark}
          open={popover?.kind === "agents"}
          onPress={(right) => void menus.toggleAgents(appName, right, null, output)}
          onTip={tip}
          reduceMotion={reduceMotion}
          accessible={accessible}
        />
      ),
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

/** The status side's slots, left to right, as the bar draws them. */
export function useStatusSlots(sources: StatusSources, popover: Popover | null, appName: string, barWidth: number | null): StatusSlot[] {
  const { agents, capture, recorder, system, menus, settings, output, runs, mixer, onTip, accessible = () => false } = sources;
  const colors = useColors();
  const recording = useRecording(recorder);
  const context: ProgramContext = {
    sources,
    popover,
    appName,
    recording,
    // Every agent, launched or connected, is one mark; an agent's recording is its red dot.
    mark: markState(mergeAgents(useAgents(agents), useRuns(runs ?? NO_RUNS)), agentRecording(recording)),
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
  };
  const { battery, network, volume } = useSystem(system);
  const { menuBar } = useSettings(settings).data;
  // Banners stop while Do Not Disturb is on; the moon says why, as on a Mac.
  const { dnd } = useFlags(controlFlags());
  const now = useMinuteClock();
  const clock = useClockPrefs();
  return [
    ...extraSlots({ ...context, accessible: accessible() }),
    // Never hidden: someone else sharing the screen, every agent, the person's own recording.
    ...(context.capturing ? [{ key: "capture", goes: null, node: <CapturePill store={capture} {...(recorder ? { recorder } : {})} /> }] : []),
    ...agentMarkSlot(context, accessible()),
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
          // The battery panel (battery/panel.tsx) under the item, its right edge at the item's.
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
