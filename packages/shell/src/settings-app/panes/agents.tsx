/**
 * Agents: who answers the launcher's Ask, and what agents did (agents-answer.tsx);
 * then the AI agents you chose "Always Allow" for, what each may do, and
 * Revoke. Revoking forgets the answers for good and cuts off a connection that
 * is up now; the agent is asked again the next time it needs something.
 */

import { useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import type { Scope } from "../../agents/consent.ts";
import { label } from "../../agents/consent.ts";
import { describeAgentKey } from "../agent-names.ts";
import type { PaneContext } from "../context.ts";
import { useGrantEntries } from "../hooks.ts";
import { Button, Caption, Group, Note, Page } from "../ui.tsx";
import { AnswerSettings } from "./agents-answer.tsx";

function ScopeChip({ scope }: { scope: Scope }) {
  const colors = useColors();
  return (
    <View style={{ height: 20, paddingHorizontal: 8, borderRadius: 10, justifyContent: "center", backgroundColor: colors.agentWash }}>
      <Text style={{ fontSize: 11, color: colors.agentInk }}>{label(scope)}</Text>
    </View>
  );
}

function AgentRow({ entry, home, onRevoke }: { entry: { key: string; scopes: Scope[] }; home: string; onRevoke: () => void }) {
  const colors = useColors();
  const name = describeAgentKey(entry.key, home);
  return (
    <View testID={`agent:${entry.key}`} style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12 }}>
      <View style={{ flex: 1, flexDirection: "column", gap: 4, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>
          {name.title}
        </Text>
        <Text numberOfLines={1} style={{ fontSize: 11, color: colors.textMuted }}>
          {name.detail}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
          {entry.scopes.length === 0 ? (
            <Text style={{ fontSize: 11, color: colors.textMuted }}>Nothing allowed</Text>
          ) : (
            entry.scopes.map((scope) => <ScopeChip key={scope} scope={scope} />)
          )}
        </View>
      </View>
      <Button testID={`agent-revoke:${entry.key}`} label="Revoke" onPress={onRevoke} />
    </View>
  );
}

export function AgentsPane({ grants, home, settings, answers }: Pick<PaneContext, "grants" | "home" | "settings" | "answers">) {
  const entries = useGrantEntries(grants);
  return (
    <Page title="Agents">
      {answers && <AnswerSettings settings={settings} answers={answers} />}
      <Caption above>Allowed for good</Caption>
      <Group testID="agents-list">
        {entries.length === 0 ? (
          <Note testID="agents-none">No agent has been allowed for good. When one asks and you choose Always Allow, it is listed here.</Note>
        ) : (
          entries.map((entry) => <AgentRow key={entry.key} entry={entry} home={home} onRevoke={() => grants.remove(entry.key)} />)
        )}
      </Group>
      <Caption>Revoke takes the permissions back at once; an agent that is connected is asked again the next time it needs them.</Caption>
    </Page>
  );
}
