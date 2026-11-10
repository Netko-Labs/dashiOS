/** Sound as agents reach it: the outputs and inputs, volumes, and each app's level, mute and output. */

import { type AppSound, playOnLabel } from "../../sound/apps/index.ts";
import { type AppReading, type MachineDesktop, pickByName } from "../machine-reading.ts";
import type { PaneServices } from "../services.ts";
import type { SettingsStore } from "../store.ts";

/** An app as agents read it: "default" for an app that follows the default output, else the output's name. */
function appReading(app: AppSound, outputs: Parameters<typeof playOnLabel>[1]): AppReading {
  const output = app.target === null ? "default" : playOnLabel(app.target, outputs);
  return { name: app.name, playing: app.playing, level: Math.round(app.level * 100) / 100, muted: app.muted, output };
}

export function soundMethods(
  services: () => PaneServices,
  settings: SettingsStore,
): Pick<MachineDesktop, "sound" | "setAppVolume" | "setSoundOutput" | "setVolume"> {
  return {
    async sound() {
      const { sound, inputs, levels, mixer } = services();
      await Promise.all([sound.refresh(), inputs.refresh(), levels.refresh()]);
      const volumes = levels.getSnapshot();
      const apps = mixer?.getSnapshot() ?? { apps: [], recording: [], outputs: [] };
      const names = (list: ReturnType<typeof sound.getSnapshot>["outputs"]) => list.map((device) => ({ name: device.label, current: device.current }));
      return {
        outputs: names(sound.getSnapshot().outputs),
        inputs: names(inputs.getSnapshot().outputs),
        outputVolume: volumes.output,
        inputVolume: volumes.input,
        showInMenuBar: settings.getSnapshot().data.menuBar.sound ?? true,
        apps: apps.apps.map((app) => appReading(app, apps.outputs)),
        recording: apps.recording.map((each) => ({ name: each.name, input: each.monitor ? "this computer's sound" : each.input })),
      };
    },

    async setAppVolume(name, change) {
      const { mixer } = services();
      if (!mixer?.getSnapshot().available) return { ok: false, reason: "unavailable" };
      const found = pickByName(mixer.getSnapshot().apps, name, (app) => app.name);
      if (found.kind !== "one") return { ok: false, reason: found.kind };
      const key = found.item.key;
      let target: string | null | undefined;
      if (change.output !== undefined) {
        if (change.output.trim().toLowerCase() === "default") target = null;
        else {
          const output = pickByName(mixer.getSnapshot().outputs, change.output, (each) => each.label);
          if (output.kind !== "one") return { ok: false, reason: "no-output" };
          target = output.item.name;
        }
      }
      const results = await Promise.all([
        change.level === undefined ? true : mixer.setLevel(key, change.level),
        change.muted === undefined ? true : mixer.setMuted(key, change.muted),
        target === undefined ? true : mixer.setOutput(key, target),
      ]);
      const now = mixer.getSnapshot();
      const app = now.apps.find((each) => each.key === key);
      if (!results.every(Boolean) || !app) return { ok: false, reason: "failed" };
      return { ok: true, app: appReading(app, now.outputs) };
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
