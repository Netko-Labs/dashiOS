/**
 * "Your turn": an agent handed a window to the person (hand_over). One pill
 * at the top of the screen, over the windows (no second bar): what the agent
 * asks, and Done. The agent is paused and its pictures blank that window
 * until Done is pressed by the person.
 */

import { Button, pill, RADIUS, SHADOW, SPACE, TYPE, useColors, WEIGHT } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import type { Turn } from "../../agents/index.ts";
import { opaque } from "../../consent.tsx";

export const TURN = { width: 560, height: 96 } as const;
/** The agents' dot beside the words: an indicator, in shiso. */
const DOT = 10;

export function TurnBanner({ turn, onDone }: { turn: Turn; onDone: () => void }) {
  const colors = useColors();
  const subject = turn.who.remote ? "The agent" : turn.who.name;
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <View
        occlude
        style={{
          width: TURN.width - 2 * SPACE.sheet,
          flexDirection: "row",
          alignItems: "center",
          gap: SPACE.inset,
          paddingTop: SPACE.gap,
          paddingBottom: SPACE.gap,
          paddingLeft: SPACE.page,
          paddingRight: SPACE.gap,
          borderRadius: RADIUS.sheet,
          backgroundColor: opaque(colors.launcher),
          borderWidth: 1,
          borderColor: colors.agent,
          shadow: SHADOW.lg,
        }}
      >
        <View style={{ width: DOT, height: DOT, borderRadius: pill(DOT), backgroundColor: colors.agent }} />
        <View style={{ flex: 1, flexDirection: "column", gap: SPACE.px }}>
          <Text
            style={{ fontSize: TYPE.body.size, lineHeight: TYPE.body.line, fontWeight: WEIGHT.bold, color: colors.text }}
          >{`Your turn: ${turn.reason}`}</Text>
          <Text style={{ fontSize: TYPE.secondary.size, lineHeight: TYPE.secondary.line, color: colors.textMuted }}>
            {`${subject} is paused and can’t see this window until you press Done.`}
          </Text>
        </View>
        <Button testID="turn-done" label="Done" primary onPress={onDone} />
      </View>
    </View>
  );
}
