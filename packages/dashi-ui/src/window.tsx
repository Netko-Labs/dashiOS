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

import { type PressInfo, Svg, Text, useWindowChrome, View } from "@mirinjs/metal";
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

/**
 * The toolbar's left inset: 18 after a sidebar, else clear of the window
 * controls by 14. A sidebar narrower than the controls (a rail) leaves the
 * toolbar to clear what they still cover.
 */
export function toolbarInset(leading: number, sidebarWidth: number): number {
  if (leading <= 0) return 18;
  return Math.max(18, leading + 14 - sidebarWidth);
}

/** The widest a window's title gets in its toolbar before it is cut. */
const TITLE_MAX = 320;
/** The title's line: its height, and the height of the row that holds it and its detail. */
const TITLE_LINE = 18;
/** The least of a detail worth showing: a shorter one shows whole or not at all, a longer one is cut no shorter. */
const DETAIL_KEEP = 120;
/** The room the title keeps before the toolbar's controls give any of theirs (a field that shrinks). */
const TITLE_MIN = 96;

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
                paddingLeft: toolbarInset(inset.leading, sidebar === undefined ? 0 : sidebarWidth),
                paddingRight: 12,
                borderBottomWidth: 1,
                borderColor: colors.separator,
              }}
            >
              {leading}
              {center}
              {center === undefined && inset.unified ? (
                // The title takes the room the controls leave, and the controls never move. The detail has
                // only what the title leaves, so it gives way first; then the title is cut with an ellipsis.
                // Below TITLE_MIN a field that shrinks gives up its room instead.
                <View testID="window-title" style={{ flex: 1, minWidth: TITLE_MIN, flexDirection: "row", alignItems: "center" }}>
                  {/* One line that wraps, a line tall: a detail with no room goes to a second line nobody sees. */}
                  <View style={{ flex: 1, minWidth: 0, height: TITLE_LINE, flexDirection: "row", flexWrap: "wrap", overflow: "hidden" }}>
                    <View style={{ flexShrink: 1, minWidth: 0, maxWidth: TITLE_MAX }}>
                      <Text numberOfLines={1} style={{ fontSize: 13, lineHeight: TITLE_LINE, fontWeight: "bold", color: colors.text }}>
                        {title}
                      </Text>
                    </View>
                    {detail ? <TitleDetail text={` — ${detail}`} color={colors.textMuted} /> : null}
                  </View>
                </View>
              ) : (
                center === undefined && <View style={{ flex: 1 }} />
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
    </View>
  );
}

/**
 * The title's detail. Its place in the row is as wide as its words, up to `DETAIL_KEEP` (the
 * unseen copy measures them); it grows into what the title leaves, and the words are cut to
 * that. When the row has less than its place, the row wraps it out of sight (review 0.8: Notes'
 * "— 1 note" was cut to a bare "…" in a narrow window).
 */
function TitleDetail({ text, color }: { text: string; color: string }) {
  const style = { fontSize: 13, lineHeight: TITLE_LINE, color };
  return (
    <View testID="window-title-detail" style={{ flexGrow: 1, flexShrink: 0, minWidth: 0, height: TITLE_LINE, position: "relative" }}>
      <View testID="window-title-detail-room" style={{ maxWidth: DETAIL_KEEP, height: 0, overflow: "hidden", opacity: 0 }}>
        <Text numberOfLines={1} style={style}>
          {text}
        </Text>
      </View>
      <View style={{ position: "absolute", left: 0, right: 0, top: 0 }}>
        <Text numberOfLines={1} style={style}>
          {text}
        </Text>
      </View>
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
  label?: string;
  /** The button's name, in sentence case ("New note"); shown after a rest. */
  tooltip?: string;
  /** Held lit, as under the pointer: the menu it opened is open ("…"'s). */
  active?: boolean;
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
        paddingHorizontal: label ? 10 : 0,
        flexDirection: "row",
        gap: 6,
        borderRadius: 7,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: active && !disabled ? colors.button : "#00000000",
        hoverBackgroundColor: disabled ? "#00000000" : colors.button,
        focusRingColor: colors.focusRing,
      }}
    >
      <Svg markup={glyph} size={16} color={disabled ? colors.textDisabled : colors.textMuted} />
      {label !== undefined && (
        <Text numberOfLines={1} style={{ fontSize: 12, color: disabled ? colors.textDisabled : colors.text }}>
          {label}
        </Text>
      )}
      {tip.node}
    </View>
  );
}
