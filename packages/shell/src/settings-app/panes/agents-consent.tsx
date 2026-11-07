/**
 * Settings › Agents, the consent dashboard: each agent that may do
 * something for good, or is connected now ("Connected now" in shiso), with
 * what it may do, riskiest first, each in one line of what it means
 * (privacy-words.ts), and what it did lately (the settings it changed, with
 * Undo, and its last connection). Revoke takes back one permission, Revoke
 * All every one, at once and from a live connection too; then "Revoked" says
 * what happened, with Undo for a few seconds (`UNDO_REVOKE_MS`).
 */

import { useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ago, type HistoryEntry } from "../../agents/ask/history.ts";
import type { GrantEntry, Scope } from "../../agents/consent.ts";
import type { AgentInfo } from "../../agents/presence.ts";
import { useClockPrefs } from "../../clock.ts";
import type { ChangeEntry } from "../changes/index.ts";
import type { PaneContext } from "../context.ts";
import { useGrantEntries, useSettings } from "../hooks.ts";
import { isPaneId } from "../panes.ts";
import { type AgentCard, agentCards, CONSEQUENCES, sinceWords } from "../privacy-words.ts";
import { Button, Caption, Group, Item, Note, Spot } from "../ui.tsx";
import { ChangeRow } from "./change-row.tsx";
import { placeOf, useUndoEntry } from "./recent.tsx";

/** How long "Revoked" offers Undo. */
export const UNDO_REVOKE_MS = 5_000;
/** How many of an agent's changes it lists. */
const LATELY = 3;

const NO_AGENTS = { subscribe: () => () => {}, getSnapshot: (): readonly AgentInfo[] => [] };

/** The settings changes `agent` made, newest first. */
export function changesBy(entries: readonly ChangeEntry[], agent: Pick<AgentCard, "key">): ChangeEntry[] {
  return entries.filter((entry) => entry.by?.key === agent.key);
}

interface Revoked {
  key: string;
  words: string;
  undo: () => void;
}

/** "Connected now" on shiso's wash, beside an agent's name. */
function ConnectedChip() {
  const colors = useColors();
  return (
    <View testID="agent-connected" style={{ height: 18, paddingHorizontal: 7, borderRadius: 9, justifyContent: "center", backgroundColor: colors.agentWash }}>
      <Text style={{ fontSize: 11, color: colors.agentInk }}>Connected now</Text>
    </View>
  );
}

/** The agent's name, where it runs, whether it is connected, and Revoke All. */
function AgentHead({ agent, onRevokeAll }: { agent: AgentCard; onRevokeAll: (() => void) | null }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48, paddingHorizontal: 12, paddingVertical: 8 }}>
      <View style={{ flex: 1, flexDirection: "column", gap: 2, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>
            {agent.title}
          </Text>
          {agent.connected && <ConnectedChip />}
        </View>
        <Text numberOfLines={1} style={{ fontSize: 11, color: colors.textMuted }}>
          {agent.scopes.length === 0 ? `${agent.detail} · asks before anything` : agent.detail}
        </Text>
      </View>
      {onRevokeAll && <Button testID={`agent-revoke-all:${agent.key}`} label="Revoke all" onPress={onRevokeAll} />}
    </View>
  );
}

function AgentGroup({
  agent,
  ctx,
  changes,
  history,
  revoked,
  onRevoked,
}: {
  agent: AgentCard;
  ctx: Pick<PaneContext, "grants" | "settings" | "show">;
  changes: readonly ChangeEntry[];
  history: readonly HistoryEntry[];
  revoked: Revoked | null;
  onRevoked: (revoked: Revoked) => void;
}) {
  const prefs = useClockPrefs();
  const now = new Date();
  const log = ctx.settings.changes;
  const { notice, undo } = useUndoEntry(log);
  const lately = changesBy(changes, agent).slice(0, LATELY);
  const last = history.find((entry) => entry.who === agent.title && !entry.request);
  const revokeOne = (scope: Scope, label: string, since: number | null) => {
    if (!ctx.grants.revoke(agent.key, scope)) return;
    onRevoked({
      key: agent.key,
      words: `Revoked. ${agent.title} can no longer ${label.toLowerCase()} without asking.`,
      undo: () => ctx.grants.restore({ key: agent.key, scopes: [scope], since: { [scope]: since } }),
    });
  };
  const revokeAll = () => {
    const entry: GrantEntry = {
      key: agent.key,
      scopes: agent.scopes.map(({ scope }) => scope),
      since: Object.fromEntries(agent.scopes.map(({ scope, since }) => [scope, since])),
    };
    if (!ctx.grants.remove(agent.key)) return;
    onRevoked({ key: agent.key, words: `Revoked. ${agent.title} asks again before it does anything.`, undo: () => ctx.grants.restore(entry) });
  };
  return (
    <>
      <Group testID={`agent:${agent.key}`}>
        <AgentHead agent={agent} onRevokeAll={agent.scopes.length > 0 ? revokeAll : null} />
        {agent.scopes.map(({ scope, label, since }) => (
          <Item
            key={scope}
            testID={`agent-scope:${agent.key}:${scope}`}
            label={label}
            detail={[CONSEQUENCES[scope], sinceWords(since, now, prefs.locale)].filter(Boolean).join(" ")}
          >
            <Button testID={`agent-revoke:${agent.key}:${scope}`} label="Revoke" onPress={() => revokeOne(scope, label, since)} />
          </Item>
        ))}
        {lately.map((entry) => {
          const place = placeOf(entry);
          const pane = place?.pane;
          return (
            <ChangeRow
              key={entry.id}
              testID={`agent-change:${entry.id}`}
              entry={entry}
              canUndo={log.canUndo(entry)}
              onUndo={() => undo(entry)}
              onOpen={place && isPaneId(pane) ? () => ctx.show(pane, place.row) : undefined}
            />
          );
        })}
        {last && <Item testID={`agent-last:${agent.key}`} label={last.summary} detail={`Last connected ${ago(last.time, Math.floor(Date.now() / 1000))}`} />}
      </Group>
      {revoked?.key === agent.key ? (
        <View testID={`agent-revoked:${agent.key}`} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4, marginTop: -8 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Caption>{revoked.words}</Caption>
          </View>
          <Button testID={`agent-revoked-undo:${agent.key}`} label="Undo" onPress={revoked.undo} />
        </View>
      ) : (
        notice !== null && <Caption>{notice}</Caption>
      )}
    </>
  );
}

export function ConsentDashboard({ ctx }: { ctx: Pick<PaneContext, "grants" | "settings" | "flags" | "agents" | "answers" | "home" | "show"> }) {
  const entries = useGrantEntries(ctx.grants);
  const connected = useSyncExternalStore(ctx.agents?.subscribe ?? NO_AGENTS.subscribe, ctx.agents?.getSnapshot ?? NO_AGENTS.getSnapshot);
  const changes = useSyncExternalStore(ctx.settings.changes.subscribe, ctx.settings.changes.getSnapshot);
  // An agent's change can be undone while the value is still its: follow the values.
  useSettings(ctx.settings);
  const [history, setHistory] = useState<readonly HistoryEntry[]>(() => ctx.answers?.history() ?? []);
  useEffect(() => ctx.answers?.onHistory(() => setHistory(ctx.answers?.history() ?? [])), [ctx.answers]);
  const [revoked, setRevoked] = useState<Revoked | null>(null);
  useEffect(() => {
    if (!revoked) return;
    const timer = setTimeout(() => setRevoked(null), UNDO_REVOKE_MS);
    return () => clearTimeout(timer);
  }, [revoked]);
  const agents = agentCards(entries, connected, ctx.home);
  return (
    <Spot id="agents/permissions" cards>
      <Caption above>What agents may do</Caption>
      {agents.length === 0 ? (
        <Group testID="agents-none">
          <Note>No agent has connected yet. When one asks and you choose Always Allow, it's listed here with what it may do.</Note>
        </Group>
      ) : (
        agents.map((agent) => (
          <AgentGroup
            key={agent.key}
            agent={agent}
            ctx={ctx}
            changes={changes}
            history={history}
            revoked={revoked}
            onRevoked={(next) =>
              setRevoked({
                ...next,
                undo: () => {
                  next.undo();
                  setRevoked(null);
                },
              })
            }
          />
        ))
      )}
    </Spot>
  );
}
