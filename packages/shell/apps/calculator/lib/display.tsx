/**
 * The Calculator's display: the expression line (a field the keyboard types
 * into, sized to fit), the word under it (the result, a notice or an error),
 * and the right-click menu. The display is also where the window is grabbed,
 * under the window controls (`titleInset`).
 */

import { useColors } from "@dashi/ui";
import { Text, TextInput, View } from "@mirinjs/metal";
import type { Dispatch } from "react";
import { type copyNumber, fitFontSize } from "./format.ts";
import { DISPLAY, GAP, LINE_LARGEST, LINE_SMALLEST } from "./layout.ts";
import type { Line } from "./line.ts";
import type { NumberLocale } from "./locale.ts";
import type { CalcAction } from "./state.ts";
import type { MenuAt } from "./tape.tsx";
import type { ResultWords } from "./words.ts";

const CLEAR = "#00000000";
/** The words under the line: 17 px, down to 11 when they need the room. */
const WORDS_LARGEST = 17;
const WORDS_SMALLEST = 11;

export interface CalculatorDisplayProps {
  line: Line;
  /** Bumped by the state on every change the field must show (its `valueRevision`). */
  revision: number;
  /** Remounts the field to give it the keyboard after a menu. */
  fieldKey: number;
  locale: NumberLocale;
  dispatch: Dispatch<CalcAction>;
  /** The words under the line, as resultWords shaped them. */
  words: ResultWords;
  /** The line's room: the column less the keys' inset each side. */
  room: number;
  /** The keys' inset: the display's side padding, so the line ends where the keys do. */
  keysInset: number;
  /** The title bar's height: the display's top padding, under the window controls. */
  titleInset: number;
  resultValue: Parameters<typeof copyNumber>[0] | null;
  canWrite: boolean;
  copyResult(): void;
  paste(): void;
  onMenu(menu: MenuAt): void;
}

export function CalculatorDisplay({
  line,
  revision,
  fieldKey,
  locale,
  dispatch,
  words,
  room,
  keysInset,
  titleInset,
  resultValue,
  canWrite,
  copyResult,
  paste,
  onMenu,
}: CalculatorDisplayProps) {
  const colors = useColors();
  const fontSize = fitFontSize(line.text || "0", room, LINE_LARGEST, LINE_SMALLEST);
  // The words under the line fit the display on their one row: smaller when they are long, never cut.
  const wordsSize = fitFontSize(words.text, room, WORDS_LARGEST, WORDS_SMALLEST);
  return (
    <View
      testID="display"
      dragRegion
      onContextMenu={(point) =>
        onMenu({
          x: point.x,
          y: point.y,
          items: [
            { label: "Copy Result", keys: "⇧❖C", disabled: resultValue === null || !canWrite, onPress: copyResult },
            { label: "Paste", keys: "❖V", onPress: paste },
          ],
        })
      }
      style={{
        flex: 1,
        minHeight: DISPLAY,
        flexDirection: "column",
        justifyContent: "flex-end",
        alignItems: "flex-end",
        gap: 2,
        paddingLeft: keysInset,
        paddingRight: keysInset,
        paddingTop: titleInset,
        paddingBottom: GAP,
      }}
    >
      <TextInput
        key={fieldKey}
        testID="line"
        value={line.text}
        valueRevision={revision}
        selection={line.selection}
        placeholder="0"
        autoFocus
        accessibilityLabel="Sum"
        onChangeText={(text) => dispatch({ type: "field", text, locale })}
        onSelectionChange={(selection) => dispatch({ type: "select", selection })}
        onSubmitEditing={() => dispatch({ type: "equals", locale })}
        onKeyPress={(key) => dispatch(key === "Escape" ? { type: "clear" } : { type: "recall", step: key === "ArrowUp" ? 1 : -1, locale })}
        style={{
          // All the room, the text at its right edge: it ends where the result and the keys do, and a long line scrolls to the caret.
          width: "100%",
          textAlign: "right",
          height: Math.round(fontSize * 1.25),
          fontSize,
          padding: 0,
          color: colors.text,
          placeholderColor: colors.text,
          backgroundColor: CLEAR,
          borderColor: CLEAR,
          focusBorderColor: CLEAR,
        }}
      />
      <View
        testID="result"
        accessibilityLiveRegion="polite"
        accessibilityLabel={words.text}
        style={{ height: 22, flexDirection: "row", justifyContent: "flex-end" }}
      >
        <Text
          numberOfLines={1}
          style={{ fontSize: wordsSize, lineHeight: 22, color: words.tone === "error" ? colors.ume : colors.textMuted, textAlign: "right" }}
        >
          {words.text}
        </Text>
      </View>
    </View>
  );
}
