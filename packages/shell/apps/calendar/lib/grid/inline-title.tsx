/**
 * A new event named where it was drawn: a block (or a chip in the month and
 * the all-day strip) in its calendar's color with the title field focused.
 * Return saves it, with what quick add reads in the words ("Lunch 12:30",
 * "Dentist Tue 3pm every 6 months": quickadd.ts); Esc drops it. A press
 * elsewhere on the grid saves it as it is.
 */

import { useColors } from "@dashi/ui";
import { Text, TextInput, View } from "@mirinjs/metal";
import { tint } from "../colors.ts";

export interface Pending {
  calendarId: string;
  /** On this computer's clock. */
  start: string;
  end: string;
  allDay: boolean;
  title: string;
}

export function InlineTitle({
  pending,
  color,
  label,
  onChange,
  onDone,
  onCancel,
  chip,
}: {
  pending: Pending;
  color: string;
  /** The times, under the field in a block. */
  label?: string;
  onChange: (title: string) => void;
  onDone: () => void;
  onCancel: () => void;
  /** A one-line chip (the month, the all-day strip) rather than a block. */
  chip?: boolean;
}) {
  const colors = useColors();
  return (
    <View
      testID="pending"
      occlude
      // Its own press and drag: a click in the field moves the caret, it doesn't pick the day or draw under it.
      onPress={() => {}}
      onPointer={() => {}}
      style={{
        flexDirection: "column",
        gap: 1,
        width: "100%",
        height: "100%",
        paddingHorizontal: 4,
        paddingVertical: chip ? 0 : 2,
        borderRadius: chip ? 4 : 5,
        borderLeftWidth: chip ? 0 : 3,
        borderColor: color,
        backgroundColor: tint(color, chip ? 0.32 : 0.4),
        justifyContent: chip ? "center" : "flex-start",
      }}
    >
      <TextInput
        testID="pending-title"
        value={pending.title}
        placeholder="New Event"
        autoFocus
        onChangeText={onChange}
        onSubmitEditing={onDone}
        onKeyPress={(key) => key === "Escape" && onCancel()}
        style={{
          width: "100%",
          height: chip ? 15 : 18,
          fontSize: 11,
          padding: 0,
          color: colors.text,
          placeholderColor: colors.textMuted,
          backgroundColor: "#00000000",
          borderColor: "#00000000",
          focusBorderColor: "#00000000",
        }}
      />
      {label !== undefined && !chip && (
        <Text numberOfLines={1} style={{ fontSize: 10, color: colors.textMuted }}>
          {label}
        </Text>
      )}
    </View>
  );
}
