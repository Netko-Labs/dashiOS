/**
 * "Your turn": an agent handed a window to the person (hand_over). One pill
 * at the top of the screen, over the windows (no second bar): what the agent
 * asks, and Done. The agent is paused and its pictures blank that window
 * until Done is pressed by the person.
 */

import { useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import type { Turn } from "./agents/presence.ts";
import { Button, opaque } from "./consent.tsx";

export const TURN = { width: 560, height: 96 } as const;

export function TurnBanner({ turn, onDone }: { turn: Turn; onDone: () => void }) {
  const colors = useColors();
  const subject = turn.who.remote ? "The agent" : turn.who.name;
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <View
        occlude
        style={{
          width: TURN.width - 40,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingTop: 10,
          paddingBottom: 10,
          paddingLeft: 16,
          paddingRight: 10,
          borderRadius: 14,
          backgroundColor: opaque(colors.launcher),
          borderWidth: 1,
          borderColor: colors.agent,
          shadow: "xl",
        }}
      >
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.agent }} />
        <View style={{ flex: 1, flexDirection: "column", gap: 1 }}>
          <Text style={{ fontSize: 13.5, fontWeight: "bold", color: colors.text }}>{`Your turn: ${turn.reason}`}</Text>
          <Text style={{ fontSize: 11.5, color: colors.textMuted }}>{`${subject} is paused and can't see this window until you press Done.`}</Text>
        </View>
        <Button label="Done" primary onPress={onDone} />
      </View>
    </View>
  );
}
