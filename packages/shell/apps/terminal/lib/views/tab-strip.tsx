/**
 * The Terminal's tabs, in the title bar's own row once a window has two or
 * more (VS-1, VS-4: no second bar under it): the kit's `TitleTab`s, which
 * share the row's width, the one in front washed and in semibold, the ×
 * on the left and the attention dot on the right when the bell rang in a
 * tab behind. The group sits centred in the row; each tab keeps a least
 * width, and the ones that don't fit fold into a count after the last shown
 * ("+3", strip-fit.ts, `TitleTabMore`) whose menu lists every tab. The one
 * in front always shows, so a narrow window keeps its name.
 */

import { TitleTab, TitleTabMore } from "@dashi/ui";
import { type Bounds, View } from "@mirinjs/metal";
import { useState } from "react";
import { fitTabs, MORE_WIDTH, TAB_GAP, TAB_MAX } from "../strip-fit.ts";

/** A tab as the strip draws it. */
export interface StripTab {
  id: number;
  name: string;
  rang: boolean;
}

export interface TabStripProps {
  tabs: readonly StripTab[];
  active: number;
  onSelect(id: number): void;
  onClose(id: number): void;
  /** The count was pressed: the menu of every tab, under it (`at`, its bounds in the window). */
  onMore(at: Bounds): void;
}

export function TabStrip({ tabs, active, onSelect, onClose, onMore }: TabStripProps) {
  const [strip, setStrip] = useState<Bounds | null>(null);
  const fit = fitTabs(
    tabs.length,
    tabs.findIndex((tab) => tab.id === active),
    strip?.width ?? null,
  );
  const shown = tabs.slice(fit.start, fit.end);
  const folded = [...tabs.slice(0, fit.start), ...tabs.slice(fit.end)];
  return (
    <View
      testID="terminal-tabs"
      onLayout={(bounds) =>
        setStrip((now) => (now && now.x === bounds.x && now.y === bounds.y && now.width === bounds.width && now.height === bounds.height ? now : bounds))
      }
      style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: TAB_GAP }}
    >
      {shown.map((tab, at) => (
        <TitleTab
          key={tab.id}
          testID={`terminal-tab-${fit.start + at}`}
          label={tab.name}
          front={tab.id === active}
          rang={tab.rang}
          maxWidth={TAB_MAX}
          onPress={() => onSelect(tab.id)}
          onClose={() => onClose(tab.id)}
        />
      ))}
      {fit.hidden > 0 && (
        <TitleTabMore
          testID="terminal-tabs-more"
          hidden={fit.hidden}
          // A tab out of sight rang: its dot is on the count.
          rang={folded.some((tab) => tab.rang)}
          width={MORE_WIDTH}
          // From the keyboard there are no bounds: the strip's end stands in for the count's.
          onPress={(event) => {
            const at = event.bounds ?? (strip && { x: strip.x + strip.width - MORE_WIDTH, y: strip.y, width: MORE_WIDTH, height: strip.height });
            if (at) onMore(at);
          }}
        />
      )}
    </View>
  );
}
