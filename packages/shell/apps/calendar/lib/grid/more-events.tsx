/**
 * "3 more": the events a day's cell (the month, the all-day strip) has no
 * room for. It goes to that day, so it is a link (the kit's `TextLink`), in
 * the line the next event would take.
 */

import { TextLink } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { MONTH_CHIP_HEIGHT } from "../layout.ts";

export function MoreEvents({ count, onPress, testID }: { count: number; onPress: () => void; testID: string }) {
  return (
    <View style={{ height: MONTH_CHIP_HEIGHT - 1, flexShrink: 0, flexDirection: "row", alignItems: "center" }}>
      <TextLink testID={testID} label={`${count} more`} size="small" onPress={onPress} />
    </View>
  );
}
