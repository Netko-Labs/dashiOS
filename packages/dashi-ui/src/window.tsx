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

import { Svg, Text, useWindowChrome, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { useColors, useSurface } from "./theme/index.ts";
import { TooltipLayer, useTooltip } from "./tooltip.tsx";

/** The toolbar's height when the compositor reports no window controls to line up with. */
const TOOLBAR_HEIGHT = 38;
export const SIDEBAR_WIDTH = 200;

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

/** The widest a window's title gets in its toolbar before it is cut. */
const TITLE_MAX = 320;

export interface AppWindowProps {
  /** The window's name, on one line. */
  title: string;
  /**
   * A short word about it, after the title on the same line, muted ("All Notes — 3 notes").
   * Never a second line: short of room, both are cut with an ellipsis.
   */
  detail?: string;
  /** Controls at the toolbar's start, before the title (back and forward). */
  leading?: ReactNode;
  /** The toolbar's controls, at its end. */
  toolbar?: ReactNode;
  /** In place of the title, filling the toolbar between `leading` and `toolbar` (Files' omnibox). `title` stays the window's name. */
  center?: ReactNode;
  /** The sidebar's rows (`SidebarSection`s and `SidebarItem`s). */
  sidebar?: ReactNode;
  sidebarWidth?: number;
  /**
   * Something happening, floating over the foot of the content (a `Notice`):
   * a job's progress, an error with its action. Only while it lasts.
   */
  notice?: ReactNode;
  /** Above everything: a sheet or a popup menu. */
  overlay?: ReactNode;
  children: ReactNode;
}

export function AppWindow({ title, detail, leading, toolbar, center, sidebar, sidebarWidth = SIDEBAR_WIDTH, notice, overlay, children }: AppWindowProps) {
  const colors = useColors();
  const surface = useSurface();
  const inset = useTitleBarInset();
  const height = Math.max(inset.top, TOOLBAR_HEIGHT);
  return (
    // The focus ring is kombu in every control inside (KB-2).
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: surface.window, position: "relative", focusRingColor: colors.focusRing }}>
      <TooltipLayer>
        {sidebar !== undefined && (
          <View
            testID="window-sidebar"
            style={{
              width: sidebarWidth,
              flexShrink: 0,
              flexDirection: "column",
              gap: 2,
              paddingHorizontal: 10,
              paddingBottom: 10,
              backgroundColor: surface.sidebar,
              borderRightWidth: 1,
              borderColor: colors.separator,
            }}
          >
            <View dragRegion style={{ height: inset.unified ? height : 10, flexShrink: 0, marginLeft: -10, marginRight: -10 }} />
            {sidebar}
          </View>
        )}
        <View style={{ flex: 1, flexDirection: "column", minWidth: 0 }}>
          {(inset.unified || toolbar !== undefined) && (
            <View
              testID="window-toolbar"
              dragRegion
              style={{
                height,
                flexShrink: 0,
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                paddingLeft: sidebar === undefined && inset.leading > 0 ? inset.leading + 14 : 18,
                paddingRight: 12,
                borderBottomWidth: 1,
                borderColor: colors.separator,
              }}
            >
              {leading}
              {center}
              {center === undefined && inset.unified && (
                // The title keeps its width (up to TITLE_MAX, then an ellipsis): the detail and the
                // toolbar's own words give way first.
                <View style={{ flexShrink: 1, flexDirection: "row", alignItems: "center" }}>
                  <View style={{ flexShrink: 0, maxWidth: TITLE_MAX }}>
                    <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "bold", color: colors.text }}>
                      {title}
                    </Text>
                  </View>
                  {detail ? (
                    <View testID="window-title-detail" style={{ flexShrink: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ fontSize: 13, color: colors.textMuted }}>
                        {` — ${detail}`}
                      </Text>
                    </View>
                  ) : null}
                </View>
              )}
              {center === undefined && <View style={{ flex: 1 }} />}
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
    <View focusGroup selectsOnFocus style={{ flexDirection: "column", gap: 2, flexShrink: 0, marginBottom: 10 }}>
      {title !== undefined && (
        <View style={{ paddingHorizontal: 8, paddingBottom: 2 }}>
          <Text style={{ fontSize: 11, fontWeight: "semibold", color: colors.textMuted }}>{title}</Text>
        </View>
      )}
      {children}
    </View>
  );
}

/**
 * A glyph button in a toolbar: square, quiet until hovered. A glyph-only
 * button names itself with `tooltip`, shown under it when the pointer rests
 * on it (UI-3); one with a `label` shows its words instead.
 */
export function ToolbarButton({
  glyph,
  onPress,
  testID,
  disabled,
  label,
  tooltip,
}: {
  glyph: string;
  onPress: () => void;
  testID: string;
  disabled?: boolean;
  label?: string;
  /** The button's name, in sentence case ("New note"); shown after a rest. */
  tooltip?: string;
}) {
  const colors = useColors();
  const tip = useTooltip(tooltip);
  return (
    <View
      testID={testID}
      focusable={!disabled}
      accessibilityRole="button"
      {...(tooltip !== undefined || label !== undefined ? { accessibilityLabel: tooltip ?? label } : {})}
      onPress={
        disabled
          ? undefined
          : () => {
              tip.hide();
              onPress();
            }
      }
      onHoverChange={tip.onHoverChange}
      style={{
        height: 28,
        minWidth: 32,
        paddingHorizontal: label ? 10 : 0,
        flexDirection: "row",
        gap: 6,
        borderRadius: 7,
        alignItems: "center",
        justifyContent: "center",
        hoverBackgroundColor: disabled ? "#00000000" : colors.button,
      }}
    >
      <Svg markup={glyph} size={16} color={disabled ? colors.textDisabled : colors.textMuted} />
      {label !== undefined && <Text style={{ fontSize: 12, color: disabled ? colors.textDisabled : colors.text }}>{label}</Text>}
      {tip.node}
    </View>
  );
}
