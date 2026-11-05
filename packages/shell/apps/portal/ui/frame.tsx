/**
 * Every portal dialog's frame: the one toolbar row (the title, and what the
 * dialog puts beside it: Back, Up, the folder pop-up and the search field
 * for the file chooser), the content, and the buttons at the bottom right,
 * the default one in the accent. Esc is Cancel and Enter the default button,
 * through the KeySink, when nothing in the dialog takes the keyboard; a
 * button that grants something (Allow, Share) is never pressed by Enter, so
 * a Return meant for the app can't give away the camera. As a sheet the
 * window has no title bar of its own: the toolbar is its top edge, hung
 * under the app's title bar.
 */

import { AppWindow, Button, type KeyInput, KeySink, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import type { ReactNode } from "react";

export interface FrameButton {
  label: string;
  testID: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
  /** It grants access or shares something: only a click presses it, never Enter. */
  grants?: boolean;
}

export interface PortalFrameProps {
  title: string;
  /** Controls at the toolbar's start, before the title (Back and Up). */
  leading?: ReactNode;
  /** Controls at the toolbar's end. */
  toolbar?: ReactNode;
  buttons: readonly FrameButton[];
  onCancel: () => void;
  /** Keys when nothing else takes them; false when the dialog has its own field focused. */
  keys?: boolean;
  onKey?: (key: KeyInput) => void;
  /** What goes at the bottom left, beside the buttons (a filter menu, an "Always" box). */
  footer?: ReactNode;
  /** Above everything: a popup menu. */
  overlay?: ReactNode;
  children: ReactNode;
}

/** The button Enter presses: the default one, unless it is disabled or grants something (then none). */
export function enterButton(buttons: readonly FrameButton[]): FrameButton | undefined {
  return buttons.find((button) => button.primary && !button.disabled && !button.grants);
}

export function PortalFrame({ title, leading, toolbar, buttons, onCancel, keys = true, onKey, footer, overlay, children }: PortalFrameProps) {
  const primary = enterButton(buttons);
  return (
    <AppWindow title={title} leading={leading} toolbar={toolbar} overlay={overlay}>
      {keys && (
        <KeySink
          testID="portal:keys"
          onKey={(key) => {
            if (key.kind === "escape") onCancel();
            else if (key.kind === "enter") primary?.onPress();
            else onKey?.(key);
          }}
        />
      )}
      <View style={{ flex: 1, flexDirection: "column", gap: 14, padding: 18, paddingTop: 14, minHeight: 0 }}>
        <View style={{ flex: 1, flexDirection: "column", gap: 10, minHeight: 0 }}>{children}</View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 }}>{footer}</View>
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
      </View>
    </AppWindow>
  );
}

/** A question with a short line under it: the permission and account sheets' heading. */
export function Question({ text, detail, glyph }: { text: string; detail?: string; glyph?: ReactNode }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", gap: 14, alignItems: "flex-start" }}>
      {glyph}
      <View style={{ flex: 1, flexDirection: "column", gap: 4, minWidth: 0 }}>
        <Text style={{ fontSize: 13, fontWeight: "bold", color: colors.text }}>{text}</Text>
        {detail !== undefined && detail !== "" && <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 16 }}>{detail}</Text>}
      </View>
    </View>
  );
}

/** A check box with its label: "Always use for PDFs", "Two-sided". */
export function CheckBox({ label, checked, onChange, testID }: { label: string; checked: boolean; onChange: (checked: boolean) => void; testID: string }) {
  const colors = useColors();
  return (
    <View testID={testID} onPress={() => onChange(!checked)} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View
        style={{
          width: 14,
          height: 14,
          borderRadius: 4,
          borderWidth: 1,
          borderColor: checked ? colors.selection : colors.separator,
          backgroundColor: checked ? colors.selection : colors.button,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked && <Text style={{ fontSize: 10, color: "#ffffff", fontWeight: "bold" }}>✓</Text>}
      </View>
      <Text style={{ fontSize: 12, color: colors.text }}>{label}</Text>
    </View>
  );
}
