/**
 * How the gallery lays an exhibit out: its name and a line about it, then
 * the control drawn once per mode, side by side, each on its own window
 * ground (`Appearance`), and inside each, a row per state. The state rows
 * draw the control as if pressed or focused (`ShowStates`) or disabled,
 * without anyone touching it; the first row is live.
 */

import { Appearance, type Palette, ShowStates, useColors, useDark, useSurface } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { createContext, type ReactNode, useContext } from "react";
import { columnsFor, type Mode } from "./pages.ts";

export const ModeContext = createContext<Mode>("both");

/** Something to put over the window (a sheet, a menu), or null to take it away. */
export const OverlayContext = createContext<(node: ReactNode) => void>(() => {});

export const useOverlay = (): ((node: ReactNode) => void) => useContext(OverlayContext);

export type State = "enabled" | "pressed" | "focused" | "selected" | "disabled";

const STATE_LABELS: Readonly<Record<State, string>> = {
  enabled: "Enabled",
  pressed: "Pressed",
  focused: "Focused",
  selected: "Selected",
  disabled: "Disabled",
};

export const CONTROL_STATES: readonly State[] = ["enabled", "pressed", "focused", "disabled"];

/** What a state row tells the control it draws. */
export interface Shown {
  state: State;
  disabled: boolean;
  selected: boolean;
}

/**
 * The least a mode's panel is drawn: a state's name and one button. Two
 * panels that don't both fit side by side go one under the other, so a
 * control is never drawn wider than its panel (over the next one).
 */
const PANEL_LEAST = 260;

function Ground({ children }: { children: ReactNode }) {
  const colors = useColors();
  const surface = useSurface();
  const dark = useDark();
  return (
    <View
      testID={dark ? "exhibit:dark" : "exhibit:light"}
      style={{
        flex: 1,
        minWidth: PANEL_LEAST,
        flexDirection: "column",
        gap: 10,
        padding: 14,
        borderRadius: 10,
        backgroundColor: surface.window,
        borderWidth: 1,
        borderColor: colors.separator,
      }}
    >
      <Text style={{ fontSize: 11, fontWeight: "semibold", color: colors.textMuted }}>{dark ? "Dark" : "Light"}</Text>
      {children}
    </View>
  );
}

/** An exhibit: a name, a line about it, and `children` drawn in each mode the toolbar asks for. */
export function Exhibit({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  const colors = useColors();
  const mode = useContext(ModeContext);
  return (
    <View style={{ flexShrink: 0, flexDirection: "column", gap: 6 }}>
      <Text style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>{title}</Text>
      {note !== undefined && <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 16 }}>{note}</Text>}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 4, alignItems: "flex-start" }}>
        {columnsFor(mode).map((dark) => (
          <Appearance key={dark ? "dark" : "light"} dark={dark}>
            <Ground>{children}</Ground>
          </Appearance>
        ))}
      </View>
    </View>
  );
}

/** A row per state: its name, then the control as that state draws it. */
export function States({ states = CONTROL_STATES, children }: { states?: readonly State[]; children: (shown: Shown) => ReactNode }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "column", gap: 8 }}>
      {states.map((state) => (
        <View key={state} style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 28 }}>
          <View style={{ width: 62, flexShrink: 0 }}>
            <Text style={{ fontSize: 11, color: colors.textMuted }}>{STATE_LABELS[state]}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <ShowStates pressed={state === "pressed"} focused={state === "focused"}>
              {children({ state, disabled: state === "disabled", selected: state === "selected" })}
            </ShowStates>
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * Draws `children` with the colors of the panel it is in. An exhibit's
 * children are made by the page, outside the panels, so a page's own
 * `useColors()` gives the window's mode: a Dark panel would get Light ink.
 */
export function Inked({ children }: { children: (colors: Palette) => ReactNode }): ReactNode {
  return children(useColors());
}

/** A labeled line inside an exhibit (a token's name and value, a measure). */
export function Caption({ children }: { children: string }) {
  const colors = useColors();
  return <Text style={{ fontSize: 11, color: colors.textMuted }}>{children}</Text>;
}

/** A page: its exhibits, one under another. */
export function PageBody({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "column", gap: 22, padding: 20, paddingBottom: 32 }}>{children}</View>;
}
