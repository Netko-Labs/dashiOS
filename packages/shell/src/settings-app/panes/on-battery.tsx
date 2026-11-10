/**
 * Battery & Power's "On battery": what Dashi lowers when the laptop is
 * unplugged, in one row, with a link to the pane where each is chosen. The graphics
 * card (Graphics' Automatic: the built-in graphics on battery, so the card
 * sleeps) and the built-in screen's refresh rate (Displays' Automatic). A
 * row is there only where the machine has that choice: a card cardwire can
 * switch, a screen with a lower rate.
 */

import { Text, View } from "@mirinjs/metal";
import { useCallback, useSyncExternalStore } from "react";
import { type AutoRefresh, builtInScreen, type RefreshScreen } from "../../display-config/auto-refresh.ts";
import { refreshLabel } from "../../display-config/monitors.ts";
import type { GraphicsSnapshot } from "../../graphics/controller.ts";
import { GRAPHICS_LABEL } from "../../graphics/policy.ts";
import type { Laptop } from "../../laptop/start.ts";
import { TextLink } from "../../shared/controls/inputs.tsx";
import { useControlColors } from "../../shared/controls/palette.ts";
import { type PaneId, paneTitle } from "../../shared/settings/panes.ts";
import { Setting, Spot } from "../ui.tsx";

export type ShowPane = (pane: PaneId, row: string) => void;

/** The graphics card's line: what the Graphics choice does on battery. */
export function graphicsOnBattery(graphics: Pick<GraphicsSnapshot, "choice">): string {
  if (graphics.choice === "automatic") return "Built-in graphics on battery, so the card sleeps.";
  return `${GRAPHICS_LABEL[graphics.choice]}, chosen by you, on battery too.`;
}

/** The refresh rate's line: what Displays' choice does on battery. */
export function refreshOnBattery(screen: Pick<RefreshScreen, "choice" | "rates" | "decision">): string {
  if (screen.choice === "automatic" && screen.rates) {
    return `${refreshLabel(screen.rates.battery.refreshMhz)} on battery, ${refreshLabel(screen.rates.plugged.refreshMhz)} plugged in.`;
  }
  return `${screen.decision.why}, on battery too.`;
}

const NO_GRAPHICS = (): null => null;

function useBuiltInScreen(refresh: AutoRefresh | null): RefreshScreen | null {
  const subscribe = useCallback((listener: () => void) => refresh?.subscribe(listener) ?? (() => {}), [refresh]);
  return useSyncExternalStore(subscribe, () => (refresh ? builtInScreen(refresh.getSnapshot()) : null));
}

/** The laptop's graphics card where cardwire can switch it (the Graphics pane's mode row shows); else null. */
function useSwitchableCard(laptop: Laptop | null): GraphicsSnapshot | null {
  const subscribe = useCallback((listener: () => void) => laptop?.graphics.subscribe(listener) ?? (() => {}), [laptop]);
  const graphics = useSyncExternalStore(subscribe, laptop ? laptop.graphics.getSnapshot : NO_GRAPHICS);
  return graphics?.hasCard && graphics.switchable && graphics.lost === null ? graphics : null;
}

/** The row's line: what Dashi lowers on battery, in a few words ("The graphics card sleeps · 60 Hz"); null with neither. */
export function onBatteryLine(
  graphics: Pick<GraphicsSnapshot, "choice"> | null,
  screen: Pick<RefreshScreen, "choice" | "rates" | "decision"> | null,
): string | null {
  const parts = [
    ...(graphics ? [graphics.choice === "automatic" ? "The graphics card sleeps" : `${GRAPHICS_LABEL[graphics.choice]}, as you chose`] : []),
    ...(screen ? [screen.choice === "automatic" && screen.rates ? refreshLabel(screen.rates.battery.refreshMhz) : "The rate you chose"] : []),
  ];
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * One row, "On battery": what Dashi lowers, and links to the panes where
 * each is chosen (Graphics · Displays). Both rows of the registry land on it.
 */
/** Whether the row has anything to say, for its card to leave it out (and its hairline) when not. */
export function useOnBattery(laptop: Laptop | null, refresh: AutoRefresh | null): boolean {
  return onBatteryLine(useSwitchableCard(laptop), useBuiltInScreen(refresh)) !== null;
}

export function OnBatteryRow({ laptop, refresh, show }: { laptop: Laptop | null; refresh: AutoRefresh | null; show: ShowPane }) {
  const screen = useBuiltInScreen(refresh);
  const graphics = useSwitchableCard(laptop);
  const colors = useControlColors();
  const line = onBatteryLine(graphics, screen);
  if (line === null) return null;
  const links = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      {graphics && <TextLink testID="on-battery-graphics" label={paneTitle("graphics")} onPress={() => show("graphics", "mode")} />}
      {graphics && screen && <Text style={{ fontSize: 12.5, color: colors.muted }}>·</Text>}
      {screen && <TextLink testID="on-battery-refresh" label={paneTitle("displays")} onPress={() => show("displays", "refresh-rate")} />}
    </View>
  );
  return (
    <Spot id="battery/on-battery-refresh">
      <Setting id="battery/on-battery-graphics" testID="on-battery" title="On battery" detail={line}>
        {links}
      </Setting>
    </Spot>
  );
}
