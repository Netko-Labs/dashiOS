/**
 * A new event named where it was drawn: a block (or a chip in the month and
 * the all-day strip) in its calendar's color with the title field focused.
 * Return saves it, with what quick add reads in the words ("Lunch 12:30",
 * "Dentist Tue 3pm every 6 months": quickadd.ts); Esc drops it. A press
 * elsewhere on the grid saves it as it is.
 */

import { InlineField, RADIUS, SPACE, TYPE, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { tint } from "../colors.ts";
import { EVENT_EDGE } from "./event-block.tsx";

/** The field's line in a chip and in a block, and its colour's wash under it. */
const LINE = { chip: 15, block: 18 } as const;
const WASH = { chip: 0.32, block: 0.4 } as const;

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
        gap: SPACE.px,
        width: "100%",
        height: "100%",
        paddingHorizontal: SPACE.xs,
        paddingVertical: chip ? 0 : SPACE.xxs,
        borderRadius: chip ? RADIUS.check : RADIUS.row,
        borderLeftWidth: chip ? 0 : EVENT_EDGE,
        borderColor: color,
        backgroundColor: tint(color, chip ? WASH.chip : WASH.block),
        justifyContent: chip ? "center" : "flex-start",
      }}
    >
      <InlineField
        testID="pending-title"
        value={pending.title}
        placeholder="New event"
        autoFocus
        size="caption"
        height={chip ? LINE.chip : LINE.block}
        onChangeText={onChange}
        onSubmit={onDone}
        onKeyPress={(key) => key === "Escape" && onCancel()}
      />
      {label !== undefined && !chip && (
        <Text numberOfLines={1} style={{ fontSize: TYPE.caption.size, color: colors.textMuted }}>
          {label}
        </Text>
      )}
    </View>
  );
}
