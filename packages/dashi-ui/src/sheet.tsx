/**
 * Things that come over a window's content: a sheet (a card hung from the
 * top of the window that holds the window until it is answered, as on the
 * Mac), the confirm sheet built on it, a popup menu, and an empty state.
 * Metal has no child windows, so all of them are drawn inside the window,
 * over everything (pass them as `AppWindow`'s `overlay`).
 */

import { Svg, Text, View } from "@mirinjs/metal";
import { type ReactNode, useState } from "react";
import { CHECK } from "./glyphs.ts";
import { Shortcut } from "./shortcut.tsx";
import { useColors } from "./theme/index.ts";
import { Button } from "./controls.tsx";
import { useSurface } from "./theme/index.ts";
import { WARNING } from "./glyphs.ts";
import { KeySink } from "./key-sink.tsx";
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

export function Sheet({ children, testID, width = 380, onCancel, onConfirm }: SheetProps) {
  const colors = useColors();
  const surface = useSurface();
  const inset = useTitleBarInset();
  return (
    <View occlude testID={`${testID}:scrim`} style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, alignItems: "center", backgroundColor: "#00000026" }}>
      {(onCancel || onConfirm) && (
        <KeySink
          testID={`${testID}:keys`}
          onKey={(key) => {
            if (key.kind === "escape") onCancel?.();
            else if (key.kind === "enter") onConfirm?.();
          }}
        />
      )}
      <View
        testID={testID}
        occlude
        style={{
          width,
          marginTop: Math.max(inset.top, 0) + 8,
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
    </View>
  );
}

export interface ConfirmSheetProps {
  title: string;
  message: string;
  /** The button that goes ahead ("Quit", "Force Quit"). */
  confirmLabel: string;
  /** It can't be taken back: the button is red. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testID?: string;
  /** A glyph beside the title; a warning sign by default. */
  glyph?: string;
}

/** A question with Cancel and one button that goes ahead (Enter); Esc cancels. */
export function ConfirmSheet({ title, message, confirmLabel, danger, onConfirm, onCancel, testID = "confirm", glyph = WARNING }: ConfirmSheetProps) {
  const colors = useColors();
  return (
    <Sheet testID={testID} onCancel={onCancel} onConfirm={onConfirm}>
      <View style={{ flexDirection: "row", gap: 14, alignItems: "flex-start" }}>
        <View style={{ width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: danger ? `${colors.critical}24` : colors.button }}>
          <Svg markup={glyph} size={22} color={danger ? colors.critical : colors.textMuted} />
        </View>
        <View style={{ flex: 1, flexDirection: "column", gap: 4, minWidth: 0 }}>
          <Text style={{ fontSize: 13, fontWeight: "bold", color: colors.text }}>{title}</Text>
          <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 16 }}>{message}</Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
        <Button label="Cancel" testID={`${testID}:cancel`} onPress={onCancel} />
        <Button label={confirmLabel} testID={`${testID}:ok`} onPress={onConfirm} primary={!danger} danger={danger} />
      </View>
    </Sheet>
  );
}

export interface MenuItem {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** The shortcut, only shown, drawn by the shell's Shortcut (never typed into text: fonts lack ❖): "⌃C". */
  keys?: string;
  /** A tick before it (a view option that is on); `false` keeps the room for one. */
  checked?: boolean;
}

/** A menu at a point (a right-click): a click on a row or anywhere else closes it. */
export function PopupMenu({ x, y, items, onClose, testID = "menu" }: { x: number; y: number; items: readonly MenuItem[]; onClose: () => void; testID?: string }) {
  const colors = useColors();
  const ticks = items.some((item) => item.checked !== undefined);
  const [hovered, setHovered] = useState<number | null>(null);
  return (
    <View occlude testID={`${testID}:away`} onPress={onClose} style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}>
      <KeySink testID={`${testID}:keys`} onKey={(key) => key.kind === "escape" && onClose()} />
      <View
        occlude
        testID={testID}
        style={{ position: "absolute", left: x, top: y, minWidth: 160, flexDirection: "column", padding: 5, borderRadius: 9, backgroundColor: colors.menu, borderWidth: 1, borderColor: colors.separator, shadow: "lg" }}
      >
        {items.map((item, index) => {
          const lit = !item.disabled && index === hovered;
          const ink = item.disabled ? colors.textDisabled : lit ? "#ffffff" : colors.text;
          return (
            <View
              key={item.label}
              testID={`${testID}:${item.label}`}
              onHoverChange={(over) => setHovered((now) => (over ? index : now === index ? null : now))}
              onPress={() => {
                onClose();
                if (!item.disabled) item.onPress();
              }}
              style={{ height: 24, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 18, paddingHorizontal: 8, borderRadius: 5, backgroundColor: lit ? colors.selection : "#00000000" }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                {ticks && <View style={{ width: 12 }}>{item.checked && <Svg markup={CHECK} size={12} color={ink} />}</View>}
                <Text style={{ fontSize: 13, color: ink }}>{item.label}</Text>
              </View>
              {item.keys !== undefined && <Shortcut keys={item.keys} size={12} color={item.disabled ? colors.textDisabled : lit ? "#ffffffcc" : colors.textMuted} />}
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** Nothing to show: a glyph, a line, a quieter line, maybe a way out. */
export function EmptyState({ title, message, glyph, action, testID = "empty" }: { title: string; message?: string; glyph?: string; action?: ReactNode; testID?: string }) {
  const colors = useColors();
  return (
    <View testID={testID} style={{ flex: 1, flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, padding: 24 }}>
      {glyph !== undefined && <Svg markup={glyph} size={36} color={colors.textDisabled} />}
      <Text style={{ fontSize: 15, fontWeight: "semibold", color: colors.textMuted, textAlign: "center" }}>{title}</Text>
      {message !== undefined && <Text style={{ fontSize: 12, color: colors.textMuted, textAlign: "center" }}>{message}</Text>}
      {action !== undefined && <View style={{ marginTop: 8 }}>{action}</View>}
    </View>
  );
}
