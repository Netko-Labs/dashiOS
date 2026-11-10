/**
 * A pane's registered row: its title and detail come from the settings
 * registry (registry/), it has its address (it is a Spot: a link or the
 * launcher scrolls to it and lights it), and a row that is one switch or
 * one choice draws its control from the registry too, bound to the store
 * the registry names. A pane passes its own control as children where the
 * registry's would not do (a slider, a picker, a live reading).
 */

import { createContext, type ReactNode, useCallback, useContext, useSyncExternalStore } from "react";
import type { FlagsStore } from "../shared/control-center/flags.ts";
import { FoldedChoices } from "../shared/controls/folded.tsx";
import { ControlSwitch } from "../shared/controls/inputs.tsx";
import { type RowDef, type SettingId, type SettingValue, settingRow, valueOf } from "./registry/index.ts";
import { Row } from "./row.tsx";
import { Spot } from "./spot.tsx";
import type { SettingsStore } from "./store.ts";

/** The stores the registry's rows read and write while Settings is open (view.tsx provides them). */
export interface PaneStores {
  settings: SettingsStore;
  flags: FlagsStore;
}

export const PaneStoresContext = createContext<PaneStores | null>(null);

const NOTHING = (): (() => void) => () => {};

/** What a row holds now, following its stores; null where it holds no value (or nothing provides the stores). */
export function useRowValue(row: RowDef): SettingValue | null {
  const stores = useContext(PaneStoresContext);
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!stores) return () => {};
      const offSettings = stores.settings.subscribe(listener);
      const offFlags = stores.flags.subscribe(listener);
      return () => {
        offSettings();
        offFlags();
      };
    },
    [stores],
  );
  const read = (): SettingValue | null => (stores ? valueOf(row, stores) : null);
  return useSyncExternalStore(stores ? subscribe : NOTHING, read);
}

/** Change a row's value through the registry. */
export function useSetRow(row: RowDef): (value: SettingValue) => void {
  const stores = useContext(PaneStoresContext);
  return (value) => {
    if (stores) row.value?.set(stores, value);
  };
}

/** The registry's own control for a row: a switch, or a choice's pills (folded past five). */
function RegistryControl({ row, testID }: { row: RowDef; testID: string }) {
  const value = useRowValue(row);
  const set = useSetRow(row);
  if (value === null) return null;
  if (row.kind === "switch") return <ControlSwitch testID={testID} on={value === true} onChange={set} />;
  if (row.kind === "choice" && row.options && typeof value !== "boolean")
    return <FoldedChoices testID={testID} value={value} options={row.options} onChange={set} />;
  return null;
}

export interface SettingProps {
  id: SettingId;
  /** A live title in place of the registry's ("Stop charging at 80%"). */
  title?: string;
  /** A live line in place of the registry's detail; null shows none. */
  detail?: string | null;
  /** Stacked or not when that depends on what the row shows now. */
  stack?: boolean;
  /** The row's own test id. */
  testID?: string;
  /** The test id of the control the registry draws, when the pane passes none. */
  control?: string;
  /** The glyph on the row's knob, in place of the registry's (a card's main rows have one; the rest start with their words). */
  glyph?: string;
  /** A second part under the words while the control stays at the end (row.tsx). */
  below?: ReactNode;
  children?: ReactNode;
}

/** A row from the registry, in its pane. */
export function Setting({ id, title, detail, stack, testID, control, glyph, below, children }: SettingProps) {
  const row = settingRow(id);
  const shown = detail === null ? undefined : (detail ?? row.detail);
  const knob = glyph ?? row.glyph;
  const content = children ?? (control !== undefined && row.value ? <RegistryControl row={row} testID={control} /> : null);
  return (
    <Spot id={id}>
      <Row
        label={title ?? row.title}
        {...(knob !== undefined ? { glyph: knob } : {})}
        {...(shown !== undefined ? { detail: shown } : {})}
        {...((stack ?? row.stack === true) ? { stack: true } : {})}
        {...(testID !== undefined ? { testID } : {})}
        {...(below !== undefined ? { below } : {})}
      >
        {content}
      </Row>
    </Spot>
  );
}
