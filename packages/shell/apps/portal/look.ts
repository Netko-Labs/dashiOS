/**
 * Where the Settings interface's values come from in this process: Control
 * Center's Dark Mode, followed from the shell's file (apps/kit/appearance.ts),
 * settings.json's appearance (followed the way the shell follows it), and
 * what this machine has to dress GTK apps with (src/shared/appearance/look.ts).
 * `onChange` hears every change, for SettingChanged. The dialogs' palette
 * follows the same store.
 */

import { homedir } from "node:os";
import { loadSettings, watchSettings } from "../../src/settings.ts";
import { detectLook, realProbes } from "../../src/shared/appearance/index.ts";
import { controlFlags } from "../../src/shared/control-center/index.ts";
import { settingsPath } from "../../src/shared/settings/index.ts";
import { followDarkMode } from "../kit/appearance.ts";
import type { LookState } from "./settings.ts";

export interface LookSource {
  current(): LookState;
  stop(): void;
}

export function followLook(onChange: () => void): LookSource {
  // The process's one store, which the dialogs paint by too (connectDarkMode); it only adopts the shell's file.
  const flags = controlFlags();
  const stopFlags = followDarkMode();
  const look = detectLook(realProbes(process.env, homedir()));
  const path = settingsPath();
  let appearance = loadSettings(path).settings.appearance;
  const stopSettings = watchSettings(path, () => {
    appearance = loadSettings(path).settings.appearance;
    onChange();
  });
  const unsubscribe = flags.subscribe(onChange);
  return {
    current: () => ({ dark: flags.getSnapshot().dark, reduceMotion: appearance.reduceMotion, pointerSize: appearance.pointerSize, look }),
    stop() {
      unsubscribe();
      stopFlags();
      stopSettings();
    },
  };
}
