/**
 * Every dialog's frame but a message's (a message is @dashi/ui's
 * `AlertWindow`, message.tsx): the title in the window's one toolbar row,
 * then the content, and the buttons at the bottom right, the default one in
 * the accent. There is no footer bar: the buttons sit on the window's ground. Esc is Cancel
 * and Enter the default button, through the kit's KeySink when nothing in
 * the dialog takes the keyboard (a text field does that itself).
 */

import { AppWindow, Button, type KeyInput, KeySink } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { LAYOUT } from "./size.ts";

/** How a dialog ends: its exit status, and what goes to stdout first (with its newline). */
export type Answer = (code: number, output?: string) => void;

export interface DialogButton {
  label: string;
  testID: string;
  onPress: () => void;
  /** The accent button, which Enter presses. */
  primary?: boolean;
  disabled?: boolean;
}

export interface DialogFrameProps {
  title: string;
  buttons: readonly DialogButton[];
  /** Esc, through the KeySink; also for keys the dialog's own field reports. */
  onCancel: () => void;
  /** Keys when nothing else takes them: Enter presses the primary button, Esc cancels; `onKey` sees every other key. */
  keys?: boolean;
  onKey?: (key: KeyInput) => void;
  children: ReactNode;
}

/** The buttons a dialog with OK, Cancel, and Zenity's `--extra-button`s has, extra ones first; pressing one prints its label and exits 1. */
export function standardButtons({
  okLabel,
  cancelLabel,
  extraButtons,
  answer,
  onOk,
  okDisabled,
  noCancel,
  noOk,
  defaultCancel,
}: {
  okLabel: string;
  cancelLabel: string;
  extraButtons: readonly string[];
  answer: Answer;
  onOk: () => void;
  okDisabled?: boolean;
  noCancel?: boolean;
  noOk?: boolean;
  defaultCancel?: boolean;
}): DialogButton[] {
  const extras = extraButtons.map((label, index) => ({ label, testID: `dialog:extra:${index}`, onPress: () => answer(1, `${label}\n`) }));
  const cancel: DialogButton[] = noCancel ? [] : [{ label: cancelLabel, testID: "dialog:cancel", onPress: () => answer(1), primary: defaultCancel === true }];
  const ok: DialogButton[] = noOk
    ? []
    : [{ label: okLabel, testID: "dialog:ok", onPress: onOk, primary: defaultCancel !== true, disabled: okDisabled === true }];
  return [...extras, ...cancel, ...ok];
}

export function DialogFrame({ title, buttons, onCancel, keys = true, onKey, children }: DialogFrameProps) {
  const primary = buttons.find((button) => button.primary && !button.disabled);
  const { padding, gap } = LAYOUT;
  return (
    <AppWindow title={title}>
      {keys && (
        <KeySink
          testID="dialog:keys"
          onKey={(key) => {
            if (key.kind === "escape") onCancel();
            else if (key.kind === "enter") primary?.onPress();
            else onKey?.(key);
          }}
        />
      )}
      <View style={{ flex: 1, flexDirection: "column", gap, padding, paddingTop: padding - 4, minHeight: 0 }}>
        <View style={{ flex: 1, flexDirection: "column", gap: 10, minWidth: 0, minHeight: 0 }}>{children}</View>
        {buttons.length > 0 && (
          <View style={{ flexDirection: "row", justifyContent: "flex-end", flexWrap: "wrap", gap: 8, flexShrink: 0 }}>
            {buttons.map((button) => (
              <Button
                key={button.testID}
                label={button.label}
                testID={button.testID}
                onPress={button.onPress}
                primary={button.primary === true}
                disabled={button.disabled === true}
              />
            ))}
          </View>
        )}
      </View>
    </AppWindow>
  );
}
