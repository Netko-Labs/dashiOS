/** Sound as agents reach it: the outputs and inputs, volumes, and the mixer (each app's level, mute, streams and output; each recording app's level, mute and input). */

import { type AppMixer, type AppRecording, type AppSound, type MixerOutput, playOnLabel } from "../../sound/index.ts";
import { type AppReading, type MachineDesktop, pickByName, type RecordingReading } from "../machine-reading.ts";
import type { PaneServices } from "../services.ts";
import type { SettingsStore } from "../store.ts";

const hundredths = (level: number): number => Math.round(level * 100) / 100;

/** "default" for a row that follows the default device, else the device's name. */
const chosen = (target: string | null, devices: readonly MixerOutput[]): string => (target === null ? "default" : playOnLabel(target, devices));

/** An app as agents read it; its streams only when it has several. */
function appReading(app: AppSound, outputs: readonly MixerOutput[]): AppReading {
  const streams = app.parts.length > 1 ? app.parts : [];
  return {
    name: app.name,
    playing: app.playing,
    level: hundredths(app.level),
    muted: app.muted,
    output: chosen(app.target, outputs),
    streams: streams.map((part) => ({ title: part.title, playing: part.playing, level: hundredths(part.level), muted: part.muted })),
  };
}

function recordingReading(app: AppRecording, inputs: readonly MixerOutput[]): RecordingReading {
  return {
    name: app.name,
    input: app.monitor ? "this computer's sound" : app.input,
    level: hundredths(app.level),
    muted: app.muted,
    recordsFrom: chosen(app.target, inputs),
  };
}

/** The device a change names: null for "default", undefined when no device is called that. */
function deviceNamed(devices: readonly MixerOutput[], name: string): string | null | undefined {
  if (name.trim().toLowerCase() === "default") return null;
  const found = pickByName(devices, name, (each) => each.label);
  return found.kind === "one" ? found.item.name : undefined;
}

type SoundMethods = Pick<MachineDesktop, "sound" | "setAppVolume" | "setAppInput" | "setSoundOutput" | "setVolume">;

/** The mixer's changes: one playing app's, and one recording app's. */
export function mixerMethods(mixer: () => AppMixer | undefined): Pick<SoundMethods, "setAppVolume" | "setAppInput"> {
  return {
    async setAppVolume(name, change) {
      const store = mixer();
      if (!store?.getSnapshot().available) return { ok: false, reason: "unavailable" };
      const found = pickByName(store.getSnapshot().apps, name, (app) => app.name);
      if (found.kind !== "one") return { ok: false, reason: found.kind };
      const key = found.item.key;
      const target = change.output === undefined ? undefined : deviceNamed(store.getSnapshot().outputs, change.output);
      if (change.output !== undefined && target === undefined) return { ok: false, reason: "no-output" };
      const results = await Promise.all([
        change.level === undefined ? true : store.setLevel(key, change.level),
        change.muted === undefined ? true : store.setMuted(key, change.muted),
        target === undefined ? true : store.setOutput(key, target),
      ]);
      const now = store.getSnapshot();
      const app = now.apps.find((each) => each.key === key);
      if (!results.every(Boolean) || !app) return { ok: false, reason: "failed" };
      return { ok: true, app: appReading(app, now.outputs) };
    },

    async setAppInput(name, change) {
      const store = mixer();
      if (!store?.getSnapshot().available) return { ok: false, reason: "unavailable" };
      const found = pickByName(store.getSnapshot().recording, name, (app) => app.name);
      if (found.kind !== "one") return { ok: false, reason: found.kind };
      const key = found.item.key;
      const target = change.input === undefined ? undefined : deviceNamed(store.getSnapshot().inputs, change.input);
      if (change.input !== undefined && target === undefined) return { ok: false, reason: "no-input" };
      // What records this computer's own sound has no microphone to change.
      if (target !== undefined && found.item.monitor) return { ok: false, reason: "own-sound" };
      const results = await Promise.all([
        change.level === undefined ? true : store.setRecordingLevel(key, change.level),
        change.muted === undefined ? true : store.setRecordingMuted(key, change.muted),
        target === undefined ? true : store.setInput(key, target),
      ]);
      const now = store.getSnapshot();
      const app = now.recording.find((each) => each.key === key);
      if (!results.every(Boolean) || !app) return { ok: false, reason: "failed" };
      return { ok: true, app: recordingReading(app, now.inputs) };
    },
  };
}

export function soundMethods(services: () => PaneServices, settings: SettingsStore): SoundMethods {
  return {
    ...mixerMethods(() => services().mixer),

    async sound() {
      const { sound, inputs, levels, mixer } = services();
      await Promise.all([sound.refresh(), inputs.refresh(), levels.refresh()]);
      const volumes = levels.getSnapshot();
      const apps = mixer?.getSnapshot() ?? { apps: [], recording: [], outputs: [], inputs: [] };
      const names = (list: ReturnType<typeof sound.getSnapshot>["outputs"]) => list.map((device) => ({ name: device.label, current: device.current }));
      return {
        outputs: names(sound.getSnapshot().outputs),
        inputs: names(inputs.getSnapshot().outputs),
        outputVolume: volumes.output,
        inputVolume: volumes.input,
        showInMenuBar: settings.getSnapshot().data.menuBar.sound ?? true,
        apps: apps.apps.map((app) => appReading(app, apps.outputs)),
        recording: apps.recording.map((each) => recordingReading(each, apps.inputs)),
      };
    },

    async setSoundOutput(name) {
      const { sound } = services();
      await sound.refresh();
      const found = pickByName(sound.getSnapshot().outputs, name, (device) => device.label);
      if (found.kind !== "one") return { ok: false, reason: found.kind };
      if (found.item.current) return { ok: true, name: found.item.label, changed: false };
      await sound.choose(found.item.id);
      const state = sound.getSnapshot();
      if (state.failed !== null) return { ok: false, reason: "failed" };
      return { ok: true, name: found.item.label, changed: true };
    },

    async setVolume(target, change) {
      const { levels } = services();
      await levels.refresh();
      if (levels.getSnapshot()[target] === null) return null;
      if (change.level !== undefined) await levels.setLevel(target, change.level);
      if (change.muted !== undefined) await levels.setMuted(target, change.muted);
      return levels.getSnapshot()[target];
    },
  };
}
