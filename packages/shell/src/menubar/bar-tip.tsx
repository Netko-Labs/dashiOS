/**
 * The menu bar's tooltip: words under a point of the bar (the agent mark's
 * "Claude Code · Cutting the demo video") after the pointer rests there.
 * The bar is one 28 px row and can't draw below itself, so the tip is a
 * small surface of its own under it, which never takes the keyboard. It
 * looks like @dashi/ui's tooltips (tooltip.tsx).
 */

import { TOOLTIP_DELAY_MS, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import type { OpenOverlay, OverlayHandle } from "../overlay.tsx";
import { MENU_BAR_HEIGHT } from "../theme.ts";
import type { BarTip } from "./lib/menubar-program-slots.tsx";

/** The surface's height: the tip (22) and room for its shadow. */
const HEIGHT = 34;
const MARGIN = 6;
const MOST = 460;

/** The surface's width for `text`: wide enough for its words at 12 px, with room to spare; the tip is centered in it. */
export function tipWidth(text: string): number {
  return Math.min(MOST, Math.ceil([...text].length * 7.2) + 40);
}

/** Where the surface's left edge goes: centered on `x`, kept inside a bar `barWidth` wide. */
export function tipLeft(x: number, width: number, barWidth: number | undefined): number {
  const centered = Math.round(x - width / 2);
  const right = barWidth === undefined ? Number.POSITIVE_INFINITY : barWidth - width - MARGIN;
  return Math.max(MARGIN, Math.min(centered, right));
}

function Tip({ text }: { text: string }) {
  const colors = useColors();
  return (
    <View style={{ flex: 1, alignItems: "center", paddingTop: 4 }}>
      <View
        testID="bar-tip"
        style={{
          height: 22,
          paddingLeft: 8,
          paddingRight: 8,
          borderRadius: 5,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.menu,
          borderWidth: 1,
          borderColor: colors.separator,
          shadow: "sm",
        }}
      >
        <Text numberOfLines={1} style={{ fontSize: 12, color: colors.text }}>
          {text}
        </Text>
      </View>
    </View>
  );
}

export interface BarTips {
  /** The pointer rests on something with words (shown after a moment), or left it (taken down at once). */
  show(tip: BarTip): void;
  close(): void;
}

export function startBarTips(open: OpenOverlay, delayMs = TOOLTIP_DELAY_MS): BarTips {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let shown: { handle: OverlayHandle; key: string } | null = null;
  const takeDown = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    shown?.handle.close();
    shown = null;
  };
  return {
    show(tip) {
      if (tip === null) return takeDown();
      const width = tipWidth(tip.text);
      const left = tipLeft(tip.x, width, tip.barWidth);
      const key = `${tip.output ?? ""}\n${left}\n${tip.text}`;
      if (shown?.key === key) return;
      const put = () => {
        timer = null;
        shown?.handle.close();
        const handle = open(
          {
            title: "Menu bar tip",
            width,
            height: HEIGHT,
            surface: {
              layer: "overlay",
              anchor: ["top", "left"],
              // Not pushed down by the bar's own zone: just under it.
              exclusiveZone: -1,
              margin: { top: MENU_BAR_HEIGHT, left },
              keyboard: "none",
              namespace: "dashi.bar-tip",
              ...(tip.output === undefined ? {} : { output: tip.output }),
            },
          },
          <Tip text={tip.text} />,
        );
        shown = { handle, key };
      };
      if (timer) clearTimeout(timer);
      // One already up moves at once (its words changed); a new one waits for the pointer to rest.
      if (shown) put();
      else timer = setTimeout(put, delayMs);
    },
    close: takeDown,
  };
}
