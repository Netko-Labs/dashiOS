/**
 * The form sheet (UI-15): a sheet that asks for input or shows facts (Get
 * Info, Export, Go to Line, Find and Replace, New Calendar). The Sheet's
 * frame; its heading 13 Bold, one line, sentence case, leading; its body;
 * its buttons at the end, 8 apart, the safe one first. Esc presses the
 * cancel button and Enter the default one, as an alert's (UI-6). A question
 * is not a form: it stays on the alert frame (UI-5).
 */

import { Text, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { type AlertButton, AlertButtons, pressForKey } from "./alert.tsx";
import { Sheet, type SheetPlace } from "./sheet.tsx";
import { SPACE, TYPE, useColors, WEIGHT } from "./theme/index.ts";

export interface FormSheetProps {
  /** One line, sentence case: "New calendar", "Go to line". */
  title: string;
  children?: ReactNode;
  buttons: readonly AlertButton[];
  /** At the start of the button row: a way to more (a link, a checkbox). */
  footer?: ReactNode;
  testID?: string;
  width?: number;
  /** False while a field of its own handles Enter and Esc (its onSubmit does). */
  keys?: boolean;
  /** `screen`: a shell sheet on a surface of its own, centred, with no window to hang from (sheet.tsx). */
  place?: SheetPlace;
  /** The title strip it hangs under, drawn over a window from outside it (sheet.tsx). */
  hang?: number;
}

export function FormSheet({ title, children, buttons, footer, testID = "form", width, keys = true, place, hang }: FormSheetProps) {
  const colors = useColors();
  return (
    <Sheet
      testID={testID}
      width={width}
      place={place}
      hang={hang}
      {...(keys ? { onCancel: () => pressForKey({ kind: "escape" }, buttons), onConfirm: () => pressForKey({ kind: "enter" }, buttons) } : {})}
    >
      <View testID={`${testID}:title`}>
        <Text numberOfLines={1} style={{ fontSize: TYPE.body.size, lineHeight: TYPE.body.line, fontWeight: WEIGHT.bold, color: colors.text }}>
          {title}
        </Text>
      </View>
      {children !== undefined && <View style={{ flexDirection: "column", gap: SPACE.m, flexShrink: 0 }}>{children}</View>}
      <AlertButtons buttons={buttons} footer={footer} />
    </Sheet>
  );
}
