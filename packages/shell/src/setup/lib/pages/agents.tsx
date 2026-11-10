import { Caption, Group, Row, Shortcut, useColors } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { SCOPES } from "../../../agents/index.ts";
import { AnswererList, useHarnesses } from "../../../settings-app/answerer-list.tsx";
import { SPARKLE } from "../../../settings-app/glyphs.ts";
import { useSettings } from "../../../settings-app/hooks.ts";
import type { SetupContext } from "../context.ts";

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
 * It does ask who answers the launcher's requests, the harnesses installed first; nothing is picked
 * for the person, and choosing allows nothing (agents/ask/answerer.ts).
 */
export function AgentsPage({ ctx }: { ctx: Pick<SetupContext, "settings" | "answers"> }) {
  const colors = useColors();
  const { data } = useSettings(ctx.settings);
  const harnesses = useHarnesses(ctx.answers?.harnesses);
  return (
    <>
      <Group testID="setup-answerer">
        <Row label="Answer your requests with" detail="Type what to do in the launcher, press Tab, and see the plan before anything runs." />
        <AnswererList
          testID="setup-answerer-choice"
          chosen={data.agents.answerer}
          harnesses={harnesses}
          onChoose={(value) => ctx.settings.patch("agents", { answerer: value })}
        />
      </Group>
      <Caption>
        Claude Code, Codex and OpenCode answer with your own subscription. A local model keeps your words on this computer. Claude and GPT use your key. You can
        change this in System Settings › Agents.
      </Caption>
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
