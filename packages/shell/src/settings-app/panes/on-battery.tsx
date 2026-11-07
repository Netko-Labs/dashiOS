/**
 * Battery & Power's "On battery": what Dashi lowers when the laptop is
 * unplugged, one row each, and the pane where each is chosen. The graphics
 * card (Graphics' Automatic: the built-in graphics on battery, so the card
 * sleeps) and the built-in screen's refresh rate (Displays' Automatic). A
 * row is there only where the machine has that choice: a card cardwire can
 * switch, a screen with a lower rate.
 */

import { useCallback, useSyncExternalStore } from "react";
import { type AutoRefresh, builtInScreen, type RefreshScreen } from "../../display-config/auto-refresh.ts";
import { refreshLabel } from "../../display-config/monitors.ts";
import type { GraphicsSnapshot } from "../../graphics/controller.ts";
import { GRAPHICS_LABEL } from "../../graphics/policy.ts";
import type { Laptop } from "../../laptop/start.ts";
import { type PaneId, paneTitle } from "../panes.ts";
import { Button, Caption, Group, Setting } from "../ui.tsx";

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

export function OnBatteryGroup({ laptop, refresh, show }: { laptop: Laptop | null; refresh: AutoRefresh | null; show: ShowPane }) {
  const screen = useBuiltInScreen(refresh);
  const graphics = useSwitchableCard(laptop);
  if (!screen && !graphics) return null;
  return (
    <>
      <Caption above>On battery</Caption>
      <Group testID="on-battery">
        {graphics && (
          <Setting id="battery/on-battery-graphics" detail={graphicsOnBattery(graphics)}>
            <Button testID="on-battery-graphics" label={`${paneTitle("graphics")}…`} onPress={() => show("graphics", "mode")} />
          </Setting>
        )}
        {screen && (
          <Setting id="battery/on-battery-refresh" detail={refreshOnBattery(screen)}>
            <Button testID="on-battery-refresh" label={`${paneTitle("displays")}…`} onPress={() => show("displays", "refresh-rate")} />
          </Setting>
        )}
      </Group>
    </>
  );
}
