/**
 * A sheet: a card hung from the top of the window that holds the window until
 * it is answered (the confirm sheet in confirm.tsx is built on it). Metal has
 * no child windows, so it is drawn inside the window, over everything (pass it
 * as `AppWindow`'s `overlay`; popup-menu.tsx's menus are drawn the same way).
 */

import { View } from "@mirinjs/metal";
import { type ReactNode, useState } from "react";
import { KeySink } from "./key-sink.tsx";
import { useColors, useDark, useSurface } from "./theme/index.ts";
import { useTitleBarInset } from "./window.tsx";

export interface SheetProps {
  children: ReactNode;
  testID: string;
  width?: number;
  /** Esc. */
  onCancel?: () => void;
  /** Enter, when the sheet has no field of its own to type into. */
  onConfirm?: () => void;
}

/**
 * What a sheet's scrim lays over the window: black, deeper in Dark, where the
 * ground is near black or black and a light wash would show nothing.
 */
export const SCRIM = { light: "#00000026", dark: "#0000008c" } as const;
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

/**
 * A sheet's card alone (radius 12, padding 20, the card ground, the `xl`
 * shadow): `Sheet` hangs one from a window; a surface of its own (the
 * shell's applet consent) shows one with no window to hang from.
 */
export function SheetCard({ children, testID, width = 380, marginTop = 0 }: { children: ReactNode; testID: string; width?: number; marginTop?: number }) {
  const colors = useColors();
  const surface = useSurface();
  return (
    <View
      testID={testID}
      occlude
      // Tab stays in the sheet while it is open; the window behind can't take the keyboard.
      focusTrap
      accessibilityRole="dialog"
      style={{
        width,
        marginTop,
        flexDirection: "column",
        gap: 10,
        padding: 20,
        borderRadius: 12,
        backgroundColor: surface.card,
        borderWidth: 1,
        borderColor: colors.separator,
        shadow: "xl",
      }}
    >
      {children}
    </View>
  );
}

/** A sheet's width in a window `room` wide (0: not laid out yet): its own, or the window's less SHEET_MARGIN a side. */
export function sheetWidth(width: number, room: number): number {
  return room > 0 ? Math.max(0, Math.min(width, room - 2 * SHEET_MARGIN)) : width;
}

export function Sheet({ children, testID, width = 380, onCancel, onConfirm }: SheetProps) {
  const colors = useColors();
  const dark = useDark();
  const inset = useTitleBarInset();
  // The window's width, so a narrow one gets a narrower card: a number, so its content is measured at it.
  const [room, setRoom] = useState(0);
  return (
    // The card hangs under the toolbar, SHEET_MARGIN in from a narrow window's sides. A sheet that can
    // outgrow a short window caps its scrolling body (`sheetBodyRoom`), so its buttons stay in reach.
    <View
      occlude
      testID={`${testID}:scrim`}
      onLayout={(bounds) => {
        if (Math.round(bounds.width) !== room) setRoom(Math.round(bounds.width));
      }}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        flexDirection: "column",
        alignItems: "center",
        backgroundColor: dark ? SCRIM.dark : SCRIM.light,
        focusRingColor: colors.focusRing,
      }}
    >
      {(onCancel || onConfirm) && (
        <KeySink
          testID={`${testID}:keys`}
          onKey={(key) => {
            if (key.kind === "escape") onCancel?.();
            else if (key.kind === "enter") onConfirm?.();
          }}
        />
      )}
      <SheetCard testID={testID} width={sheetWidth(width, room)} marginTop={Math.max(inset.top, 0) + 8}>
        {children}
      </SheetCard>
    </View>
  );
}
