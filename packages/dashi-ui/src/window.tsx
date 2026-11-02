/**
 * A first-party window's frame, laid out the way System Settings is: an
 * optional sidebar on the left that runs to the top edge, and over the
 * content a toolbar with the window's title and its controls (search, a
 * segmented control, buttons). With the unified title bar the compositor
 * draws its window controls over the top-left corner (over the sidebar when
 * there is one); the toolbar and the sidebar's top strip are where the window
 * is grabbed. With the standard title bar the compositor shows the title, and
 * the toolbar only holds the controls.
 */

import { Svg, Text, useWindowChrome, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { useColors, useSurface } from "./theme/index.ts";

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

export interface AppWindowProps {
  title: string;
  /** A quieter line under the title ("All Processes"). */
  subtitle?: string;
  /** Controls at the toolbar's start, before the title (back and forward). */
  leading?: ReactNode;
  /** The toolbar's controls, at its end. */
  toolbar?: ReactNode;
  /** The sidebar's rows (`SidebarSection`s and `SidebarItem`s). */
  sidebar?: ReactNode;
  sidebarWidth?: number;
  /** A strip under the content (a status line, summary graphs). */
  footer?: ReactNode;
  /** Above everything: a sheet or a popup menu. */
  overlay?: ReactNode;
  children: ReactNode;
}

export function AppWindow({ title, subtitle, leading, toolbar, sidebar, sidebarWidth = SIDEBAR_WIDTH, footer, overlay, children }: AppWindowProps) {
  const colors = useColors();
  const surface = useSurface();
  const inset = useTitleBarInset();
  const height = Math.max(inset.top, TOOLBAR_HEIGHT);
  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: surface.window, position: "relative" }}>
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
            {inset.unified && (
              <View style={{ flexDirection: "column", flexShrink: 1, minWidth: 0, gap: 0 }}>
                <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "bold", color: colors.text }}>
                  {title}
                </Text>
                {subtitle !== undefined && (
                  <Text numberOfLines={1} style={{ fontSize: 11, color: colors.textMuted }}>
                    {subtitle}
                  </Text>
                )}
              </View>
            )}
            <View style={{ flex: 1 }} />
            {toolbar}
          </View>
        )}
        <View style={{ flex: 1, flexDirection: "column", minHeight: 0 }}>{children}</View>
        {footer}
      </View>
      {overlay}
    </View>
  );
}

/** A heading over a run of sidebar rows. */
export function SidebarSection({ title, children }: { title?: string; children: ReactNode }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "column", gap: 2, flexShrink: 0, marginBottom: 10 }}>
      {title !== undefined && (
        <View style={{ paddingHorizontal: 8, paddingBottom: 2 }}>
          <Text style={{ fontSize: 11, fontWeight: "semibold", color: colors.textMuted }}>{title}</Text>
        </View>
      )}
      {children}
    </View>
  );
}

/** A glyph button in a toolbar: square, quiet until hovered. */
export function ToolbarButton({
  glyph,
  onPress,
  testID,
  disabled,
  label,
}: {
  glyph: string;
  onPress: () => void;
  testID: string;
  disabled?: boolean;
  label?: string;
}) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      onPress={disabled ? undefined : onPress}
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
    </View>
  );
}
