/**
 * Wearing a level of glass (design.html DE-4, GL-1 to GL-3; decisions.md D770, D771). `Frosted` is a
 * view the compositor fills with one of Frost's materials (mirin's `material`), its solid twin as the
 * fill it paints wherever the compositor draws no glass: a host that doesn't take `material`, an app
 * whose glass the person turned off, the first frame. Only a host that announces `glass` is sent the
 * material (an older one refuses the tree). Everything under it paints on glass (`OnGlassContext`):
 * the vibrant inks leaning to the backdrop's tone (`useGlassTone`), the glass edge, fills, the stepped
 * inks (theme/on-glass.ts). A third layer of glass is its solid twin with neutral inks (GL-2), and
 * `solid` turns glass off for one surface (the gallery's "glass off", GL-3's twin). The compositor draws
 * glass in the session's mode, so a subtree an `Appearance` paints in the other mode gets the twin.
 *
 * What is never glass (GL-6) leaves it with `OffGlass`: a tooltip, a capture's chips, a window's content.
 */

import { useHostProtocol, useWindowGlass, View, type ViewProps } from "@mirinjs/metal";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { GLASS, type GlassLevel, type OnGlass, OnGlassContext, useDark, useSessionDark } from "./theme/index.ts";

/** How many glass layers are above this one in the tree (GL-2). */
const Depth = createContext(0);

export interface FrostedProps extends Omit<ViewProps, "material"> {
  /** The material: thin (the bar, the Dock), regular (menus, panels, sheets), thick (a focused sidebar), paper (widgets). */
  level: GlassLevel;
  /** Glass off: its solid twin, with neutral inks (Reduce Transparency shown in place, the gallery). */
  solid?: boolean;
}

/** The solid twin of `level` in the mode in use (GL-3). */
export function useSolidTwin(level: GlassLevel): string {
  return GLASS.levels[level][useDark() ? "dark" : "light"].solid;
}

export function Frosted({ level, solid = false, style, children, ...rest }: FrostedProps) {
  const window = useWindowGlass();
  const depth = useContext(Depth);
  const twin = useSolidTwin(level);
  // The compositor draws glass in the session's mode: a subtree painted in the other (`Appearance`) gets its twin.
  const inMode = useDark() === useSessionDark();
  // A third layer is drawn solid (GL-2), as is glass turned off; neither leans to a backdrop it can't see.
  const glass = !solid && inMode && depth < GLASS.depth.layers && window.available;
  const tone = glass && window.drawing ? window.tone : null;
  const onGlass = useMemo<OnGlass>(() => ({ level, tone }), [level, tone]);
  return (
    <View {...rest} {...(glass ? { material: level } : {})} style={{ ...style, backgroundColor: twin }}>
      <Depth.Provider value={depth + 1}>
        <OnGlassContext.Provider value={onGlass}>{children}</OnGlassContext.Provider>
      </Depth.Provider>
    </View>
  );
}

/** Everything under it is on a window's ground again, whatever glass is above (GL-6: tooltips, a capture's chips). */
export function OffGlass({ children }: { children?: ReactNode }) {
  return (
    <Depth.Provider value={0}>
      <OnGlassContext.Provider value={null}>{children}</OnGlassContext.Provider>
    </Depth.Provider>
  );
}

/** The glass the caller sits on (its level and the backdrop's tone), or null on a window's ground. */
export function useOnGlass(): OnGlass | null {
  return useContext(OnGlassContext);
}

/**
 * The backdrop's tone under the caller's glass (`#rrggbb`), so its words lean to it (GL-1): the colour the
 * compositor says is behind the window's first pane, or null until it says, on a window's ground, and on a
 * third layer or glass turned off.
 */
export function useGlassTone(): string | null {
  return useContext(OnGlassContext)?.tone ?? null;
}

/**
 * The style a control lit in the accent gives itself and the controls on it (a lit tile, a lit page
 * header, a chosen pill, an on switch): a `gap` of onAccent between the focus ring and the fill, so the
 * purple never sits unseen on the accent (KB-2, `GLASS.focusGap`, D763). Nothing on a host that can't
 * draw it, nor when the control isn't lit.
 */
export function useFocusGap(lit: boolean, gap: string): { focusRingGapColor?: string } {
  const host = useHostProtocol();
  return lit && host?.focusGap === true ? { focusRingGapColor: gap } : {};
}
