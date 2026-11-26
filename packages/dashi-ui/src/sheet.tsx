/**
 * A sheet: a card hung from the top of the window that holds the window until
 * it is answered (the confirm sheet in confirm.tsx is built on it). Metal has
 * no child windows, so it is drawn inside the window, over everything (pass it
 * as `AppWindow`'s `overlay`; popup-menu.tsx's menus are drawn the same way).
 *
 * The card is regular glass, radius 14 (UI-5, RA-1; decisions.md D810) where
 * the compositor can frost what is behind it: a shell sheet on a surface of
 * its own (`place="screen"`), or one hung over a window from such a surface
 * (`hang`). The compositor draws glass behind the surface, so a card inside an
 * app's own window would only show that window's content again: there it is
 * regular's solid twin (GL-3's glass off, D811).
 */

import { type Bounds, useWindowGlass, View } from "@mirinjs/metal";
import { type ReactNode, useState } from "react";
import { Frosted } from "./frosted.tsx";
import { KeySink } from "./key-sink.tsx";
import { ScrimAround } from "./sheet-scrim.tsx";
import { SCRIM, SHADOW, SPACE, useColors, useDark, useSessionDark, useSurface } from "./theme/index.ts";
import { useTitleBarInset } from "./window.tsx";

/** A sheet's radius (RA-1: 14, room for glass, D720); `RADIUS.sheet` stays 12 for what isn't a sheet yet. */
export const SHEET_RADIUS = 14;

export interface SheetProps {
  children: ReactNode;
  testID: string;
  width?: number;
  /** Esc. */
  onCancel?: () => void;
  /** Enter, when the sheet has no field of its own to type into. */
  onConfirm?: () => void;
  /** A tall sheet's height (the file chooser's): shorter when the window is, SHEET_MARGIN from its foot. */
  height?: number;
  /** The card as the window's ground with no padding: a sheet laid out like a window inside (the file chooser). */
  bare?: boolean;
  /** What screen readers call it when no heading in it does (the chooser, whose title's place is the path). */
  label?: string;
  /**
   * `window` (the default): hung from the top of its window over the scrim.
   * `screen`: a shell sheet with no window to hang from (polkit, the power
   * sheets, an agent's question), centred on its own surface, no scrim (UI-5).
   */
  place?: SheetPlace;
  /**
   * The window's title strip the card hangs under, when the sheet is drawn
   * over a window from a surface of its own (the shell's Change Password over
   * Settings): the window's controls are not this surface's to report. By
   * default the window's own (`useTitleBarInset`).
   */
  hang?: number;
}

export type SheetPlace = "window" | "screen";

/** The least room a sheet keeps from the window's sides and foot. */
export const SHEET_MARGIN = 16;

/**
 * The most a sheet's scrolling body may take in a window `windowHeight`
 * tall, besides `rest` (its buttons, gaps and other rows): the sheet hangs 8
 * under the toolbar (`top`, the title bar's inset), keeps SHEET_MARGIN from
 * the foot, and has 20 of padding and 1 of edge above and below. Taffy can't
 * size a scroll view by shrinking it, so a sheet caps its body with this.
 */
export function sheetBodyRoom(windowHeight: number, top: number, rest: number): number {
  return Math.max(96, Math.floor(windowHeight - (top + 8) - SHEET_MARGIN - 2 * 21 - rest));
}

/** Whether a card that asks for glass gets it: the host draws glass here, in the session's mode (Frosted's own test, less its depth). */
function useGlassDrawn(frosted: boolean): boolean {
  const available = useWindowGlass().available;
  const inMode = useDark() === useSessionDark();
  return frosted && available && inMode;
}

/**
 * A sheet's card alone (radius 14, padding 20, the `xl` shadow), on regular
 * glass when `frosted`, else regular's solid twin: `Sheet` hangs one from a
 * window; a surface of its own (the shell's applet consent) shows one with
 * no window to hang from. A `bare` card is a window's ground inside (the file
 * chooser), never glass.
 */
export function SheetCard({
  children,
  testID,
  width = 380,
  marginTop = 0,
  height,
  bare = false,
  label,
  frosted = false,
  onLayout,
}: {
  children: ReactNode;
  testID: string;
  width?: number;
  marginTop?: number;
  height?: number;
  bare?: boolean;
  label?: string;
  /** On glass: the compositor can frost what is behind it (a surface of the shell's own). */
  frosted?: boolean;
  onLayout?: (bounds: Bounds) => void;
}) {
  const colors = useColors();
  const surface = useSurface();
  // The compositor draws a pane's rim and hairline; the twin keeps the hairline of its own.
  const drawn = useGlassDrawn(frosted && !bare);
  const tall = height !== undefined ? { height, flexShrink: 1 as const, minHeight: 0 } : {};
  const style = {
    width,
    marginTop,
    ...tall,
    flexDirection: "column" as const,
    ...(bare ? { overflow: "hidden" as const } : { gap: SPACE.gap, padding: SPACE.sheet }),
    borderRadius: SHEET_RADIUS,
    ...(drawn ? {} : { borderWidth: 1, borderColor: colors.separator }),
    shadow: SHADOW.xl,
  };
  const props = {
    testID,
    occlude: true,
    // Tab stays in the sheet while it is open; the window behind can't take the keyboard.
    focusTrap: true,
    accessibilityRole: "dialog" as const,
    ...(label !== undefined ? { accessibilityLabel: label } : {}),
    ...(onLayout ? { onLayout } : {}),
  };
  if (bare) {
    return (
      <View {...props} style={{ ...style, backgroundColor: surface.window }}>
        {children}
      </View>
    );
  }
  return (
    <Frosted {...props} level="regular" solid={!frosted} style={style}>
      {children}
    </Frosted>
  );
}

/** A sheet's width in a window `room` wide (0: not laid out yet): its own, or the window's less SHEET_MARGIN a side. */
export function sheetWidth(width: number, room: number): number {
  return room > 0 ? Math.max(0, Math.min(width, room - 2 * SHEET_MARGIN)) : width;
}

/** The keys a sheet answers: Esc and Enter, while nothing in it that takes them (a field) has the keyboard. */
function SheetKeys({ testID, onCancel, onConfirm }: Pick<SheetProps, "testID" | "onCancel" | "onConfirm">) {
  if (!onCancel && !onConfirm) return null;
  return (
    <KeySink
      testID={`${testID}:keys`}
      onKey={(key) => {
        if (key.kind === "escape") onCancel?.();
        else if (key.kind === "enter") onConfirm?.();
      }}
    />
  );
}

/** A sheet on a surface of its own, with no window: the card centred on it (its shadow falls in the rest). */
function ScreenSheet({ children, testID, width = 380, onCancel, onConfirm }: SheetProps) {
  const colors = useColors();
  return (
    <View testID={`${testID}:place`} style={{ flex: 1, alignItems: "center", justifyContent: "center", focusRingColor: colors.focusRing }}>
      <SheetKeys testID={testID} onCancel={onCancel} onConfirm={onConfirm} />
      <SheetCard testID={testID} width={width} frosted>
        {children}
      </SheetCard>
    </View>
  );
}

export function Sheet(props: SheetProps) {
  return props.place === "screen" ? <ScreenSheet {...props} /> : <WindowSheet {...props} />;
}

function WindowSheet({ children, testID, width = 380, onCancel, onConfirm, hang, height, bare, label }: SheetProps) {
  const colors = useColors();
  const dark = useDark();
  const inset = useTitleBarInset();
  // The window's width, so a narrow one gets a narrower card: a number, so its content is measured at it.
  const [room, setRoom] = useState(0);
  // Hung over a window from a surface of its own (`hang`), the card is glass, and the scrim goes round it (sheet-scrim.tsx).
  const frosted = hang !== undefined;
  const drawn = useGlassDrawn(frosted);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const [card, setCard] = useState<Bounds | null>(null);
  const scrim = dark ? SCRIM.dark : SCRIM.light;
  return (
    // The card hangs under the toolbar, SHEET_MARGIN in from a narrow window's sides. A sheet that can
    // outgrow a short window caps its scrolling body (`sheetBodyRoom`), so its buttons stay in reach.
    <View
      occlude
      testID={`${testID}:scrim`}
      onLayout={(bounds) => {
        if (Math.round(bounds.width) !== room) setRoom(Math.round(bounds.width));
        if (bounds.x !== origin.x || bounds.y !== origin.y) setOrigin({ x: bounds.x, y: bounds.y });
      }}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        flexDirection: "column",
        alignItems: "center",
        ...(height !== undefined ? { paddingBottom: SHEET_MARGIN } : {}),
        // On glass the scrim is painted round the card, never under it: the compositor draws glass behind the surface.
        ...(drawn ? {} : { backgroundColor: scrim }),
        focusRingColor: colors.focusRing,
      }}
    >
      {drawn && <ScrimAround color={scrim} card={card && { ...card, x: card.x - origin.x, y: card.y - origin.y }} radius={SHEET_RADIUS} />}
      <SheetKeys testID={testID} onCancel={onCancel} onConfirm={onConfirm} />
      <SheetCard
        frosted={frosted}
        onLayout={(bounds) => {
          if (card === null || bounds.x !== card.x || bounds.y !== card.y || bounds.width !== card.width || bounds.height !== card.height) setCard(bounds);
        }}
        testID={testID}
        width={sheetWidth(width, room)}
        marginTop={Math.max(hang ?? inset.top, 0) + SPACE.m}
        {...(height !== undefined ? { height } : {})}
        bare={bare === true}
        {...(label !== undefined ? { label } : {})}
      >
        {children}
      </SheetCard>
    </View>
  );
}
