import { useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { describeFailure, TimezonePicker, useRegion } from "../../region/index.ts";
import type { SetupContext } from "../context.ts";

/** A searchable list of time zone names, starting from the one the system has now; a pick is applied at once. */
export function TimezonePage({ ctx }: { ctx: SetupContext }) {
  const colors = useColors();
  const state = useRegion(ctx.region);
  return (
    <>
      <TimezonePicker zones={state.zones} current={state.timezone} height={190} onPick={(id) => void ctx.region.setTimezone(id)} />
      <View testID="setup-timezone-note" style={{ flexShrink: 0 }}>
        <Text style={{ fontSize: 11, color: state.error ? colors.critical : colors.textMuted }}>
          {state.error ? describeFailure(state.error) : `Now: ${state.timezone.replaceAll("_", " ")}. Changing it asks for your password.`}
        </Text>
      </View>
    </>
  );
}
