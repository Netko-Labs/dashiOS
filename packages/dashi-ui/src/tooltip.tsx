/**
 * Tooltips: a control's name, shown in a small label under it after the
 * pointer rests on it. Metal has no tooltips of its own, but it reports
 * hover with the view's painted bounds, and it can render into another
 * view through a portal: `AppWindow` mounts a layer over everything
 * (`TooltipLayer`), and a control draws its tip there, so the tip is never
 * clipped or painted over by the content under the toolbar.
 */

import { type Bounds, createPortal, Text, View } from "@mirinjs/metal";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { useColors } from "./theme/index.ts";

/** How long the pointer rests before the tip shows. */
export const TOOLTIP_DELAY_MS = 600;
const GAP = 6;
const MARGIN = 6;

interface Layer {
  host: unknown;
  /** The window's width, 0 until the layer is laid out. */
  width: number;
}

const LayerContext = createContext<Layer | null>(null);

/** Where a tip of `size` goes: centered under `anchor`, kept `MARGIN` inside a window `windowWidth` wide. */
export function tooltipOrigin(anchor: Bounds, size: { width: number; height: number }, windowWidth: number): { x: number; y: number } {
  const centered = anchor.x + (anchor.width - size.width) / 2;
  const right = windowWidth > 0 ? windowWidth - size.width - MARGIN : Number.POSITIVE_INFINITY;
  return { x: Math.round(Math.max(MARGIN, Math.min(centered, right))), y: Math.round(anchor.y + anchor.height + GAP) };
}

/** The layer tips are drawn in: one per window, after everything else (AppWindow mounts it). */
export function TooltipLayer({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<unknown>(null);
  const [width, setWidth] = useState(0);
  return (
    <LayerContext.Provider value={host === null ? null : { host, width }}>
      {children}
      <View ref={setHost as never} onLayout={(bounds) => setWidth(bounds.width)} style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} />
    </LayerContext.Provider>
  );
}

function Tip({ text, anchor, layer }: { text: string; anchor: Bounds; layer: Layer }) {
  const colors = useColors();
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const at = tooltipOrigin(anchor, size ?? { width: 0, height: 0 }, layer.width);
  return createPortal(
    <View
      testID="tooltip"
      onLayout={(bounds) =>
        setSize((now) => (now?.width === bounds.width && now.height === bounds.height ? now : { width: bounds.width, height: bounds.height }))
      }
      style={{
        position: "absolute",
        left: at.x,
        top: at.y,
        // Laid out once unseen, to learn its width, then centered.
        opacity: size === null ? 0 : 1,
        height: 22,
        paddingHorizontal: 8,
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
    </View>,
    layer.host,
  );
}

export interface Tooltip {
  /** Pass to the control's `onHoverChange`. */
  onHoverChange: (hovered: boolean, bounds?: Bounds) => void;
  /** Hide it now (the control was pressed). */
  hide: () => void;
  /** Render it anywhere in the control: it draws in the window's layer. */
  node: ReactNode;
}

/** The window's top layer (`AppWindow` mounts it), for a portal: a pop-up button draws its menu there, over everything. Null outside one. */
export function useWindowLayer(): unknown {
  return useContext(LayerContext)?.host ?? null;
}

/** A tip for a control; `text` undefined, or no `TooltipLayer` above, shows nothing. */
export function useTooltip(text: string | undefined): Tooltip {
  const layer = useContext(LayerContext);
  const [anchor, setAnchor] = useState<Bounds | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = (): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  // A pending tip never fires after the control is gone.
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const hide = (): void => {
    clear();
    setAnchor(null);
  };
  return {
    onHoverChange: (hovered, bounds) => {
      hide();
      if (!hovered || bounds === undefined || text === undefined) return;
      timer.current = setTimeout(() => setAnchor(bounds), TOOLTIP_DELAY_MS);
    },
    hide,
    node: anchor !== null && layer !== null && text !== undefined ? <Tip text={text} anchor={anchor} layer={layer} /> : null,
  };
}
