/**
 * The one alert frame (docs/design.html, UI-5), for sheets, portal dialogs,
 * and `dashi-dialog`: the glyph on its tile, the question as the first line
 * (no title row), what it means under it, anything the answer needs (a check
 * box, a card), and the buttons at the bottom right. Esc presses the cancel
 * button and Enter the default one, the same everywhere (`alertKeyTarget`).
 * A message that only informs has one button, and Esc and Enter both press it.
 *
 * `AlertSheet` hangs it from the top of a window (`ConfirmSheet` is one);
 * `AlertWindow` is a whole window of it (a portal's question, a dialog's
 * message), with nothing above the question but room for the window controls.
 */

import { ScrollView, Svg, Text, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import type { ButtonKind } from "./button-look.ts";
import { Button } from "./controls.tsx";
import { KeySink } from "./key-sink.tsx";
import type { KeyInput } from "./keys.ts";
import { Sheet } from "./sheet.tsx";
import { useColors, useSurface } from "./theme/index.ts";
import type { Palette } from "./theme/palette.ts";
import { TooltipLayer } from "./tooltip.tsx";
import { useTitleBarInset } from "./window.tsx";

export interface AlertButton {
  label: string;
  testID: string;
  onPress: () => void;
  /** `primary` (kombu) goes ahead, `danger` (ume) destroys; secondary by default. */
  kind?: ButtonKind;
  /**
   * What Enter presses (a secondary one wears the kombu ring). By default
   * the enabled primary button; `false` on it means Enter never presses it
   * (a grant: only a click gives access).
   */
  isDefault?: boolean;
  /** What Esc presses: Cancel, Don't Allow. */
  cancel?: boolean;
  disabled?: boolean;
}

/** What the glyph's tile says: kombu for a question or a permission, ume before destroying, broth for a warning. */
export type AlertTone = "neutral" | "accent" | "danger" | "warning";

/** The button a key presses: Esc the cancel one (or the only one), Enter the default one. */
export function alertKeyTarget(key: KeyInput, buttons: readonly AlertButton[]): AlertButton | null {
  const usable = buttons.filter((button) => !button.disabled);
  if (key.kind === "escape") return usable.find((button) => button.cancel) ?? (buttons.length === 1 ? (usable[0] ?? null) : null);
  if (key.kind === "enter") {
    const named = usable.find((button) => button.isDefault === true);
    if (named) return named;
    return usable.find((button) => button.kind === "primary" && button.isDefault !== false) ?? (buttons.length === 1 ? (usable[0] ?? null) : null);
  }
  return null;
}

/** Press what `key` presses on these buttons; true when it pressed one. */
export function pressForKey(key: KeyInput, buttons: readonly AlertButton[]): boolean {
  const target = alertKeyTarget(key, buttons);
  target?.onPress();
  return target !== null;
}

export function toneColors(tone: AlertTone, colors: Palette): { wash: string; ink: string } {
  switch (tone) {
    case "accent":
      return { wash: colors.selectionWash, ink: colors.selection };
    case "danger":
      return { wash: colors.umeWash, ink: colors.ume };
    case "warning":
      return { wash: colors.brothWash, ink: colors.broth };
    case "neutral":
      return { wash: colors.button, ink: colors.textMuted };
  }
}

export interface AlertProps {
  /** The question, naming the thing: "Delete “Groceries”?" Empty only for a message that has none (a dialog's long text). */
  question: string;
  /** What it means, or what happens next: "You can't undo this." */
  message?: string;
  glyph: string;
  tone?: AlertTone;
  buttons: readonly AlertButton[];
  /** What the answer needs under the message: a check box, a card. */
  children?: ReactNode;
}

/** The tile, the words, and anything the answer needs, side by side. */
function AlertBody({ question, message, glyph, tone = "neutral", children, scroll }: Omit<AlertProps, "buttons"> & { scroll?: boolean }) {
  const colors = useColors();
  const { wash, ink } = toneColors(tone, colors);
  const words = (
    <>
      {question !== "" && <Text style={{ fontSize: 13, fontWeight: "bold", color: colors.text, lineHeight: 17 }}>{question}</Text>}
      {message !== undefined && message !== "" && <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 16 }}>{message}</Text>}
      {children !== undefined && <View style={{ flexDirection: "column", gap: 8, marginTop: 6, flexShrink: 0 }}>{children}</View>}
    </>
  );
  return (
    <View style={{ flexDirection: "row", gap: 14, alignItems: "flex-start", ...(scroll ? { flex: 1, minHeight: 0 } : {}) }}>
      <View style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: wash }}>
        <Svg markup={glyph} size={22} color={ink} />
      </View>
      {scroll ? (
        <ScrollView style={{ flex: 1, flexDirection: "column", gap: 4, minWidth: 0 }}>{words}</ScrollView>
      ) : (
        <View style={{ flex: 1, flexDirection: "column", gap: 4, minWidth: 0 }}>{words}</View>
      )}
    </View>
  );
}

/** The buttons, at the end of the row; a wide set wraps. */
export function AlertButtons({ buttons }: { buttons: readonly AlertButton[] }) {
  const enter = alertKeyTarget({ kind: "enter" }, buttons);
  return (
    <View style={{ flexDirection: "row", justifyContent: "flex-end", flexWrap: "wrap", gap: 8, marginTop: 6, flexShrink: 0 }}>
      {buttons.map((button) => (
        <Button
          key={button.testID}
          label={button.label}
          testID={button.testID}
          onPress={button.onPress}
          primary={button.kind === "primary"}
          danger={button.kind === "danger"}
          disabled={button.disabled === true}
          isDefault={enter === button && button.kind !== "primary" && button.kind !== "danger"}
        />
      ))}
    </View>
  );
}

/** The alert as it is, for laying out anywhere (the gallery shows one). */
export function Alert(props: AlertProps) {
  return (
    <View style={{ flexDirection: "column", gap: 10 }}>
      <AlertBody {...props} />
      <AlertButtons buttons={props.buttons} />
    </View>
  );
}

/** The alert as a sheet over a window's content (pass it as `AppWindow`'s `overlay`). */
export function AlertSheet({ testID = "alert", width, ...props }: AlertProps & { testID?: string; width?: number }) {
  return (
    <Sheet
      testID={testID}
      width={width}
      onCancel={() => pressForKey({ kind: "escape" }, props.buttons)}
      onConfirm={() => pressForKey({ kind: "enter" }, props.buttons)}
    >
      <AlertBody {...props} />
      <AlertButtons buttons={props.buttons} />
    </Sheet>
  );
}

export interface AlertWindowProps extends AlertProps {
  /** Keys when nothing in the window takes them; false while a field of its own is focused. */
  keys?: boolean;
  /** Esc, when it means more than a button does (`dashi-dialog`'s exit status 1); by default it presses the cancel button. */
  onCancel?: () => void;
  testID?: string;
}

/**
 * The alert as a whole window: a portal's question on the asking app, a
 * `dashi-dialog` message. Its title is the window's (the Dock, the switcher)
 * and is not drawn again; the question is the first line, beside the tile,
 * clear of the window controls. The words scroll when they are long.
 */
export function AlertWindow({ keys = true, testID = "alert", onCancel, ...props }: AlertWindowProps) {
  const surface = useSurface();
  const inset = useTitleBarInset();
  return (
    <View testID={testID} style={{ flex: 1, flexDirection: "column", backgroundColor: surface.window, position: "relative" }}>
      <TooltipLayer>
        {keys && (
          <KeySink
            testID={`${testID}:keys`}
            onKey={(key) => {
              if (key.kind === "escape" && onCancel) onCancel();
              else pressForKey(key, props.buttons);
            }}
          />
        )}
        {/* The strip the window controls sit in, where the window is grabbed. */}
        <View dragRegion style={{ height: Math.max(inset.top, 0), flexShrink: 0 }} />
        <View dragRegion style={{ flex: 1, flexDirection: "column", gap: 10, padding: 18, paddingTop: inset.top > 0 ? 6 : 18, minHeight: 0 }}>
          <AlertBody {...props} scroll />
          <AlertButtons buttons={props.buttons} />
        </View>
      </TooltipLayer>
    </View>
  );
}
