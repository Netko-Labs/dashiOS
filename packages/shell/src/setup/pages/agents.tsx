import { Shortcut, useColors } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { SCOPES } from "../../agents/consent.ts";
import { SPARKLE } from "../../settings-app/glyphs.ts";
import { Caption, Group } from "../../settings-app/ui.tsx";

/** What each promise is, in the words the consent sheet uses. */
const PROMISES = [
  "Agents start with nothing. The first time one needs something, a sheet asks you on screen.",
  "Allow Once lasts until it disconnects; Always Allow is kept for only the permissions you chose, and you can take it back in System Settings > Agents.",
  "The menu bar shows each agent and what it is doing. The stop square on its pill cuts it off.",
  "Dashi's own permission and password sheets and the lock screen are out of an agent's reach. Force quitting an app always asks you first.",
] as const;

/**
 * What agent-first means and how consent works, with the policy Dashi ships. Nothing is granted
 * here: this page has no switches, so there is no way to pre-allow an agent from the assistant.
 */
export function AgentsPage() {
  const colors = useColors();
  return (
    <>
      <Group testID="setup-agent-promises">
        {PROMISES.map((text) => (
          <View key={text} style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12 }}>
            <Svg markup={SPARKLE} size={14} color={colors.agent} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 12, color: colors.text }}>{text}</Text>
            </View>
          </View>
        ))}
        {/* ❖ is drawn, not typed: text fonts don't reliably carry it (shortcut.tsx). */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12 }}>
          <Svg markup={SPARKLE} size={14} color={colors.agent} />
          <Text style={{ fontSize: 12, color: colors.text }}>Stop every agent at once, any time, with</Text>
          <Shortcut keys="⌃❖Esc" color={colors.text} size={12} />
        </View>
      </Group>
      <Caption above>What an agent can ask to do</Caption>
      <Group testID="setup-agent-scopes">
        {SCOPES.map((scope) => (
          <View key={scope.id} testID={`setup-scope:${scope.id}`} style={{ flexDirection: "column", gap: 2, padding: 12 }}>
            <Text style={{ fontSize: 13, color: colors.text }}>{scope.label}</Text>
            <Text style={{ fontSize: 11, color: colors.textMuted }}>{scope.detail}</Text>
          </View>
        ))}
      </Group>
      <Caption>Nothing is allowed here. You can see and change what you allowed any time in System Settings.</Caption>
    </>
  );
}
