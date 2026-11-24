/** One placed widget: its card (floods when it holds the tally), and its kind's view inside. */

import { SPACE } from "@dashi/ui";
import { Card } from "../../card.tsx";
import { widgetInfo } from "../../catalog.ts";
import { useWidgetEnv } from "../../env.tsx";
import type { WidgetInfo, WidgetKind, WidgetSize } from "../../types.ts";
import { useSource } from "../data.ts";
import { AgentsWidget } from "./agents.tsx";
import { CalendarWidget } from "./calendar.tsx";
import { ExtensionView } from "./extension.tsx";
import { MediaWidget } from "./media.tsx";
import { NotesWidget } from "./notes.tsx";
import { RundownWidget } from "./rundown.tsx";
import { BatteryWidget, ClockWidget, SystemWidget, WorldWidget } from "./simple.tsx";
import { TimerWidget } from "./timer.tsx";
import { WeatherWidget } from "./weather.tsx";

/** The widget kind a tally key belongs to: "timer:t1" → timer. */
export function kindOfKey(key: string): WidgetKind | null {
  const prefix = key.slice(0, key.indexOf(":"));
  return ({ timer: "timer", media: "media", event: "calendar", run: "agents", ask: "agents", weather: "weather" } as const)[prefix as "timer"] ?? null;
}

function Body({ kind, size, air }: { kind: WidgetKind; size: WidgetSize; air: boolean }) {
  const { hub } = useWidgetEnv();
  const extensions = useSource(hub?.extensions, []);
  switch (kind) {
    case "rundown":
      return <RundownWidget size={size} />;
    case "clock":
      return <ClockWidget size={size} />;
    case "world":
      return <WorldWidget size={size} />;
    case "calendar":
      return <CalendarWidget size={size} />;
    case "weather":
      return <WeatherWidget size={size} />;
    case "battery":
      return <BatteryWidget size={size} />;
    case "system":
      return <SystemWidget size={size} />;
    case "media":
      return <MediaWidget size={size} air={air} />;
    case "timer":
      return <TimerWidget size={size} />;
    case "notes":
      return <NotesWidget size={size} />;
    case "agents":
      return <AgentsWidget size={size} />;
    default:
      return <ExtensionView widget={extensions.find((each) => each.info.kind === kind)} />;
  }
}

export interface WidgetTileProps {
  kind: WidgetKind;
  size: WidgetSize;
  width: number;
  height: number;
  /** Whether the person allowed this one's private details on the lock screen. */
  showPrivate?: boolean;
  /** The tally's holder is drawn here (and not as a live card above). */
  air: boolean;
  testID?: string;
  onPress?: () => void;
  onContext?: () => void;
  onHoverChange?: (hovered: boolean) => void;
}

export function WidgetTile({ kind, size, width, height, showPrivate, air, testID, onPress, onContext, onHoverChange }: WidgetTileProps) {
  const env = useWidgetEnv();
  const extensions = useSource(env.hub?.extensions, []);
  const info: WidgetInfo | null = widgetInfo(
    kind,
    extensions.map((each) => each.info),
  );
  const compact = size === "mini" || size === "compact" || size === "strip";
  return (
    <Card
      look={{
        inks: env.inks,
        ink: info?.ink ?? null,
        air,
        houseDown: env.tally.houseDown && !air,
        redact: env.locked && !showPrivate && info?.holdsPrivate === true,
        glass: env.locked,
      }}
      width={width}
      height={height}
      compact={compact}
      {...(compact && size === "mini" ? { padding: SPACE.gap } : {})}
      {...(testID ? { testID } : {})}
      {...(onPress ? { onPress } : {})}
      {...(onContext ? { onContext } : {})}
      {...(onHoverChange ? { onHoverChange } : {})}
    >
      <Body kind={kind} size={size} air={air} />
    </Card>
  );
}
