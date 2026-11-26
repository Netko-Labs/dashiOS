/**
 * A first-party window's frame, laid out the way System Settings is: an
 * optional sidebar on the left that runs to the top edge, and over the
 * content a toolbar with the window's title and its controls (search, a
 * segmented control, buttons). With the unified title bar the compositor
 * draws its window controls over the top-left corner (over the sidebar when
 * there is one); the toolbar and the sidebar's top strip are where the window
 * is grabbed. With the standard title bar the compositor shows the title, and
 * the toolbar only holds the controls.
 *
 * The toolbar is the window's one chrome row (docs/design.html, VS-1): the
 * title is one line, and there is no footer. A count goes in the sidebar or
 * the content; something happening (a job's progress, an error) is a
 * `notice` that floats over the content's foot and takes no room from it.
 */

import { type PressInfo, Svg, Text, useWindowActive, useWindowChrome, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { SIDEBAR } from "./sidebar.tsx";
import { CLEAR, RADIUS, SPACE, TYPE, useColors, useSurface, WEIGHT, WindowFocusContext } from "./theme/index.ts";
import { TooltipLayer, useTooltip } from "./tooltip.tsx";
import { WindowTitle } from "./window-title.tsx";

/** The toolbar's height when the compositor reports no window controls to line up with. */
const TOOLBAR_HEIGHT = 38;
export const SIDEBAR_WIDTH = 200;
/** A wizard's page (VS-3: Setup, the Installer): its words this far in from the window's sides. */
export const WIZARD_PAGE = { inset: 56 } as const;

export interface TitleBarInset {
  /** The window has the unified title bar, with the controls over the content. */
  unified: boolean;
  /** Height of the strip the window controls sit in; 0 with the standard title bar. */
  top: number;
  /** Where content may start beside the controls; 0 with the standard title bar. */
  leading: number;
}

/** What a custom layout (a calculator's display) must keep clear for the window controls. */
export function useTitleBarInset(): TitleBarInset {
  const { titleBar, controls } = useWindowChrome();
  if (!controls) return { unified: titleBar === "unified", top: 0, leading: 0 };
  return { unified: true, top: Math.ceil(controls.y + controls.height), leading: Math.ceil(controls.x + controls.width) };
}

/**
 * The toolbar's left inset: 18 after a sidebar, else clear of the window
 * controls by 14. A sidebar narrower than the controls (a rail) leaves the
 * toolbar to clear what they still cover.
 */
export function toolbarInset(leading: number, sidebarWidth: number): number {
  if (leading <= 0) return 18;
  return Math.max(18, leading + 14 - sidebarWidth);
}

export interface AppWindowProps {
  /** The window's name, on one line. */
  title: string;
  /**
   * A short word about it, after the title on the same line, muted ("All Notes — 3 notes").
   * Never a second line: short of room it gives way first, then the title. A long one is cut
   * with an ellipsis down to `DETAIL_KEEP`; with less room than that (or than a short one
   * needs whole) it is not shown, never a bare "…".
   */
  detail?: string;
  /** Controls at the toolbar's start, before the title (back and forward). */
  leading?: ReactNode;
  /** The toolbar's controls, at its end. */
  toolbar?: ReactNode;
  /**
   * VS-8: the title's room given away. What takes its place (Find, Files'
   * omnibox) goes in `titleSlot`, filling the toolbar between `leading` and
   * `toolbar`; `title` stays the window's name (the Dock, the switcher,
   * screen readers). With neither, the title shows.
   */
  hideTitle?: boolean;
  titleSlot?: ReactNode;
  /** Tools after the title, in its row (Preview's): the title's detail gives way before them (WindowTitle). */
  afterTitle?: ReactNode;
  /** The sidebar's rows (`SidebarSection`s and `SidebarItem`s). */
  sidebar?: ReactNode;
  sidebarWidth?: number;
  /** The sidebar folded to its 56 rail (LA-5): its rows draw `rail` too. */
  rail?: boolean;
  /**
   * Something happening, floating over the foot of the content (a `Notice`):
   * a job's progress, an error with its action. Only while it lasts.
   */
  notice?: ReactNode;
  /** Above everything: a sheet or a popup menu. */
  overlay?: ReactNode;
  /** The content paints no ground, so glass shown in it frosts what is behind the window: the gallery's Glass page only (GL-6). */
  seeThrough?: boolean;
  children: ReactNode;
}

export function AppWindow({
  title,
  detail,
  leading,
  toolbar,
  hideTitle,
  titleSlot,
  afterTitle,
  sidebar,
  sidebarWidth: wide = SIDEBAR_WIDTH,
  rail,
  notice,
  overlay,
  seeThrough = false,
  children,
}: AppWindowProps) {
  const colors = useColors();
  const surface = useSurface();
  const inset = useTitleBarInset();
  const height = Math.max(inset.top, TOOLBAR_HEIGHT);
  const sidebarWidth = rail ? SIDEBAR.rail : wide;
  const titleGone = hideTitle === true || titleSlot !== undefined;
  // Without focus every selection in it turns neutral (CO-9).
  const focused = useWindowActive();
  return (
    // The focus ring is kombu in every control inside (KB-2).
    <View
      style={{ flex: 1, flexDirection: "row", backgroundColor: seeThrough ? CLEAR : surface.window, position: "relative", focusRingColor: colors.focusRing }}
    >
      <WindowFocusContext.Provider value={focused}>
        <TooltipLayer>
          {sidebar !== undefined && (
            <WindowSidebar width={sidebarWidth} top={inset.unified ? height : WINDOW_SIDEBAR_TOP}>
              {sidebar}
            </WindowSidebar>
          )}
          <View style={{ flex: 1, flexDirection: "column", minWidth: 0 }}>
            {(inset.unified || toolbar !== undefined || titleSlot !== undefined) && (
              <View
                testID="window-toolbar"
                dragRegion
                style={{
                  height,
                  flexShrink: 0,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: SPACE.gap,
                  paddingLeft: toolbarInset(inset.leading, sidebar === undefined ? 0 : sidebarWidth),
                  paddingRight: SPACE.inset,
                  borderBottomWidth: 1,
                  borderColor: colors.separator,
                  ...(seeThrough ? { backgroundColor: surface.window } : {}),
                }}
              >
                {leading}
                {titleSlot}
                {!titleGone && inset.unified ? (
                  <WindowTitle title={title} {...(detail ? { detail } : {})} {...(afterTitle !== undefined ? { after: afterTitle } : {})} />
                ) : (
                  titleSlot === undefined && <View style={{ flex: 1 }} />
                )}
                {toolbar}
              </View>
            )}
            <View style={{ flex: 1, flexDirection: "column", minHeight: 0, position: "relative" }}>
              {children}
              {notice !== undefined && notice !== null && notice !== false && (
                <View testID="window-notice" style={{ position: "absolute", left: 16, right: 16, bottom: 14, alignItems: "center" }}>
                  {notice}
                </View>
              )}
            </View>
          </View>
          {overlay}
        </TooltipLayer>
      </WindowFocusContext.Provider>
    </View>
  );
}

/**
 * A heading over a run of sidebar rows: one Tab stop, where ↑ and ↓ move the
 * selection, as on the Mac (KB-1).
 */
export function SidebarSection({ title, children }: { title?: string; children: ReactNode }) {
  const colors = useColors();
  return (
    <View focusGroup selectsOnFocus style={{ flexDirection: "column", gap: SPACE.xxs, flexShrink: 0, marginBottom: SPACE.gap }}>
      {title !== undefined && (
        <View style={{ paddingHorizontal: SPACE.m, paddingBottom: SPACE.xxs }}>
          <Text style={{ fontSize: TYPE.caption.size, fontWeight: WEIGHT.semibold, color: colors.textMuted }}>{title}</Text>
        </View>
      )}
      {children}
    </View>
  );
}

/**
 * What names a toolbar button, one or both: a glyph-only button is named by
 * its tooltip, a worded one by its label. Without either a screen reader and
 * an agent's read_window could not say what it is, so the type asks for one.
 */
export type ToolbarButtonName = { label: string; tooltip?: string } | { tooltip: string; label?: string };

/**
 * A glyph button in a toolbar: square, quiet until hovered. A glyph-only
 * button names itself with `tooltip`, shown under it when the pointer rests
 * on it (UI-3); one with a `label` shows its words instead. A toolbar's
 * "More" is one of these: the `MORE` glyph, the tooltip "More", `active`
 * while its menu is open, the menu hung by its right edge under the
 * button's (`PopupMenu`'s `anchor` "end").
 */
export function ToolbarButton({
  glyph,
  onPress,
  testID,
  disabled,
  label,
  tooltip,
  active = false,
}: {
  glyph: string;
  /** With the press: the button's bounds, for a menu that opens under it (PA-9). */
  onPress: (event: PressInfo) => void;
  testID: string;
  disabled?: boolean;
  /** Held lit, as under the pointer: the menu it opened is open ("…"'s). */
  active?: boolean;
} & ToolbarButtonName) {
  const colors = useColors();
  const tip = useTooltip(tooltip);
  return (
    <View
      testID={testID}
      focusable={!disabled}
      accessibilityRole="button"
      accessibilityLabel={tooltip ?? label}
      accessibilityState={{ disabled: disabled === true }}
      onPress={
        disabled
          ? undefined
          : (event) => {
              tip.hide();
              onPress(event);
            }
      }
      onHoverChange={tip.onHoverChange}
      style={{
        height: 28,
        minWidth: 32,
        // Its words never wrap and it never shrinks: a toolbar's one row gives way elsewhere.
        flexShrink: 0,
        paddingHorizontal: label ? SPACE.gap : 0,
        flexDirection: "row",
        gap: SPACE.s,
        borderRadius: RADIUS.control,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: active && !disabled ? colors.button : CLEAR,
        hoverBackgroundColor: disabled ? CLEAR : colors.button,
        focusRingColor: colors.focusRing,
      }}
    >
      <Svg markup={glyph} size={16} color={disabled ? colors.textDisabled : colors.textMuted} />
      {label !== undefined && (
        <Text numberOfLines={1} style={{ fontSize: TYPE.secondary.size, color: disabled ? colors.textDisabled : colors.text }}>
          {label}
        </Text>
      )}
      {tip.node}
    </View>
  );
}

/** The sidebar's strip under the window controls when the title bar is the compositor's. */
const WINDOW_SIDEBAR_TOP = 10;

/** The sidebar: its own ground and edge, its top strip a grab handle. */
function WindowSidebar({ width, top, children }: { width: number; top: number; children: ReactNode }) {
  const colors = useColors();
  const surface = useSurface();
  return (
    <View
      testID="window-sidebar"
      style={{
        width,
        flexShrink: 0,
        flexDirection: "column",
        gap: SPACE.xxs,
        paddingHorizontal: SPACE.gap,
        paddingBottom: SPACE.gap,
        backgroundColor: surface.sidebar,
        borderRightWidth: 1,
        borderColor: colors.separator,
      }}
    >
      <View dragRegion style={{ height: top, flexShrink: 0, marginLeft: -SPACE.gap, marginRight: -SPACE.gap }} />
      {children}
    </View>
  );
}
