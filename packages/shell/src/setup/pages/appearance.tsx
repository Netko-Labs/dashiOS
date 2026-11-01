import { Text, View } from "@mirinjs/metal";
import { AppearancePreviews, CornerChoices } from "../../settings-app/panes/appearance.tsx";
import { Group, Row } from "../../settings-app/ui.tsx";
import { useColors } from "@dashi/ui";
import type { SetupContext } from "../context.ts";

/** Light, Dark, and Auto as previews, and the window corners: the same controls as Settings > Appearance. */
export function AppearancePage({ ctx }: { ctx: SetupContext }) {
  const colors = useColors();
  return (
    <>
      <Group>
        <View style={{ alignItems: "center" }}>
          <AppearancePreviews flags={ctx.flags} settings={ctx.settings} />
        </View>
      </Group>
      <Group>
        <Row stack label="Window corners" detail="How round windows are, app content included.">
          <CornerChoices settings={ctx.settings} />
        </Row>
      </Group>
      <View style={{ flexShrink: 0 }}>
        <Text style={{ fontSize: 11, color: colors.textMuted }}>Auto turns Dark Mode on at 7 PM and off at 7 AM. Accent color is Kombu, a green from Japanese cooking.</Text>
      </View>
    </>
  );
}
