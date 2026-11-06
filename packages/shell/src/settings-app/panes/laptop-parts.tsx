/**
 * The laptop's rows in the panes people already know (docs/0.4.0.html,
 * Laptop features C): the panel's overdrive in Displays, the keyboard light
 * in Keyboard. Each shows only when dashi-hardware reports the knob.
 */

import { Switch } from "@dashi/ui";
import type { Laptop } from "../../laptop/start.ts";
import { keyboardLight, lightLabel, useLaptop } from "../../laptop/store.ts";
import { Caption, Choices, Group, Setting } from "../ui.tsx";

/** Displays: the built-in panel's overdrive (faster pixels, for games). */
export function PanelOverdriveSection({ laptop }: { laptop: Laptop | null }) {
  const machine = useLaptop(laptop?.store ?? NO_STORE);
  const knob = machine.knobs.get("panel-overdrive");
  if (!laptop || !knob) return null;
  return (
    <>
      <Caption above>Built-in Display</Caption>
      <Group testID="displays-overdrive">
        <Setting id="displays/panel-overdrive">
          <Switch testID="displays-overdrive-switch" on={knob.value === true} onChange={(on) => void laptop.store.set("panel-overdrive", on)} />
        </Setting>
      </Group>
    </>
  );
}

/** Keyboard: the keyboard light's level (Fn F4 steps through the same levels). */
export function KeyboardLightSection({ laptop }: { laptop: Laptop | null }) {
  const light = keyboardLight(useLaptop(laptop?.store ?? NO_STORE));
  if (!laptop || !light) return null;
  return (
    <Group testID="keyboard-light">
      <Setting id="keyboard/keyboard-light">
        <Choices
          testID="keyboard-light-level"
          value={light.level}
          options={Array.from({ length: light.max + 1 }, (_, level) => ({ value: level, label: lightLabel(level, light.max) }))}
          onChange={(level) => laptop.setLight(level)}
        />
      </Setting>
    </Group>
  );
}

/** A store with nothing in it, so the hooks run the same way with no laptop. */
const NO_STORE = {
  subscribe: () => () => {},
  getSnapshot: (() => {
    const empty = { laptop: false, helper: false, model: null, knobs: new Map(), keyboardLevels: null };
    return () => empty;
  })(),
};
