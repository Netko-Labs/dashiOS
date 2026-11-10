/**
 * Settings › Agents, the consent dashboard: each agent that may do
 * something for good, or is connected now ("Connected now" in shiso), with
 * what it may do, riskiest first, each in one line of what it means
 * (privacy-words.ts), and what it did lately (the settings it changed, with
 * Undo, and its last connection). Revoke takes back one permission, Revoke
 * All every one, at once and from a live connection too; then "Revoked" says
 * what happened, with Undo, until the person leaves the pane or changes
 * something else. Meanwhile what was taken back stays in place, marked
 * Revoked, and so does the agent's card: nothing moves under the pointer.
 */

import { Text, View } from "@mirinjs/metal";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ago, type HistoryEntry } from "../../../agents/ask/history.ts";
import type { GrantEntry, Scope } from "../../../agents/consent.ts";
import type { AgentInfo } from "../../../agents/presence.ts";
import { isPaneId } from "../../../shared/settings/index.ts";
import { useClockPrefs } from "../../../shared/time/index.ts";
import { useColors } from "../../colors.ts";
import type { PaneContext } from "../../context.ts";
import { useGrantEntries, useSettings } from "../../hooks.ts";
import { Spot } from "../../spot.tsx";
import { Button, Caption, Group, Note } from "../../ui.tsx";
import type { ChangeEntry } from "../changes/log.ts";
import { type AgentCard, agentCards, CONSEQUENCES, sinceWords } from "../privacy-words.ts";
import { Row as Item, PAGE } from "../row.tsx";
import { ChangeRow } from "./change-row.tsx";
import { placeOf, useUndoEntry } from "./recent.tsx";

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

/** A permission as its row shows it: `revoked` while a Revoke's notice is up. */
export interface ShownScope {
  scope: Scope;
  label: string;
  since: number | null;
  revoked: boolean;
}

export interface ShownCard extends Omit<AgentCard, "scopes"> {
  scopes: ShownScope[];
}

/**
 * The cards as drawn. An agent whose permissions were revoked since the
 * notice went up (`held`: its card as it was then) keeps its card and its
 * rows where they were, the ones taken back marked revoked, even when
 * nothing else would list it now (Revoke All on an agent that isn't
 * connected).
 */
export function shownCards(cards: readonly AgentCard[], held: ReadonlyMap<string, AgentCard>): ShownCard[] {
  const current = new Set(cards.map((card) => card.key));
  const shown = cards.map((card): ShownCard => {
    const before = held.get(card.key);
    const live = card.scopes.map((scope) => ({ ...scope, revoked: false }));
    if (!before) return { ...card, scopes: live };
    const kept = before.scopes.map((scope) => live.find((each) => each.scope === scope.scope) ?? { ...scope, revoked: true });
    const added = live.filter((scope) => !before.scopes.some((each) => each.scope === scope.scope));
    return { ...card, scopes: [...kept, ...added] };
  });
  for (const [key, before] of held) {
    if (!current.has(key)) shown.push({ ...before, connected: false, scopes: before.scopes.map((scope) => ({ ...scope, revoked: true })) });
  }
  return shown.sort((a, b) => Number(b.connected) - Number(a.connected) || a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
}

/** When a permission was given: "Since Nov 3", or "Allowed earlier" when Dashi didn't write the date down then. */
export function givenWords(since: number | null, now: Date, locale?: string): string {
  return sinceWords(since, now, locale) ?? "Allowed earlier";
}

/** "Connected now" on shiso's wash, beside an agent's name. */
function ConnectedChip() {
  const colors = useColors();
  return (
    // Never squeezed: the name beside it gives way (and is cut) first.
    <View
      testID="agent-connected"
      style={{ height: 18, flexShrink: 0, paddingHorizontal: 7, borderRadius: 9, justifyContent: "center", backgroundColor: colors.agentWash }}
    >
      <Text numberOfLines={1} style={{ fontSize: 11, color: colors.agentInk }}>
        Connected now
      </Text>
    </View>
  );
}

/** The agent's name, where it runs, whether it is connected, and Revoke All (kept in place, off, once all are revoked). */
function AgentHead({ agent, onRevokeAll }: { agent: ShownCard; onRevokeAll: (() => void) | null }) {
  const colors = useColors();
  const asksFirst = agent.scopes.every((scope) => scope.revoked);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48, paddingHorizontal: PAGE.inset, paddingVertical: 8 }}>
      <View style={{ flex: 1, flexDirection: "column", gap: 2, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flexShrink: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>
              {agent.title}
            </Text>
          </View>
          {agent.connected && <ConnectedChip />}
        </View>
        <Text numberOfLines={1} style={{ fontSize: 11, color: colors.textMuted }}>
          {asksFirst ? `${agent.detail} · asks before anything` : agent.detail}
        </Text>
      </View>
      {agent.scopes.length > 0 && (
        <Button testID={`agent-revoke-all:${agent.key}`} label="Revoke all" disabled={onRevokeAll === null} onPress={onRevokeAll ?? (() => {})} />
      )}
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
  agent: ShownCard;
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
  const live = agent.scopes.filter((scope) => !scope.revoked);
  const revokeAll = () => {
    const entry: GrantEntry = {
      key: agent.key,
      scopes: live.map(({ scope }) => scope),
      since: Object.fromEntries(live.map(({ scope, since }) => [scope, since])),
    };
    if (!ctx.grants.remove(agent.key)) return;
    onRevoked({ key: agent.key, words: `Revoked. ${agent.title} asks again before it does anything.`, undo: () => ctx.grants.restore(entry) });
  };
  return (
    <>
      <Group testID={`agent:${agent.key}`}>
        <AgentHead agent={agent} onRevokeAll={live.length > 0 ? revokeAll : null} />
        {agent.scopes.map(({ scope, label, since, revoked: gone }) => (
          <Item
            key={scope}
            testID={`agent-scope:${agent.key}:${scope}`}
            label={label}
            detail={`${CONSEQUENCES[scope]} ${givenWords(since, now, prefs.locale)}`}
          >
            {gone ? (
              <Button testID={`agent-revoke:${agent.key}:${scope}`} label="Revoked" disabled onPress={() => {}} />
            ) : (
              <Button testID={`agent-revoke:${agent.key}:${scope}`} label="Revoke" onPress={() => revokeOne(scope, label, since)} />
            )}
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
  const [held, setHeld] = useState<ReadonlyMap<string, AgentCard>>(() => new Map());
  // The notice goes when the person does something else here: changes or undoes a setting. Leaving the pane takes it too.
  const shownWith = useRef(changes);
  useEffect(() => {
    if (shownWith.current === changes) return;
    shownWith.current = changes;
    setRevoked(null);
    setHeld(new Map());
  }, [changes]);
  const active = changes.flatMap((entry) => (entry.by?.key ? [entry.by.key] : []));
  const cards = agentCards(entries, connected, ctx.home, active);
  const agents = shownCards(cards, held);
  const hold = (key: string) => {
    const card = cards.find((each) => each.key === key);
    if (card) setHeld((now) => (now.has(key) ? now : new Map(now).set(key, card)));
  };
  // An agent's session in the history: one has connected, though none may do anything now.
  const seenOne = history.some((entry) => entry.request === undefined);
  return (
    <Spot id="agents/permissions" cards>
      <Caption above>What agents may do</Caption>
      {agents.length === 0 ? (
        <Group testID="agents-none">
          <Note>
            {seenOne
              ? "Every agent asks before it does anything. When one asks and you choose Always Allow, it's listed here with what it may do."
              : "No agent has connected yet. When one asks and you choose Always Allow, it's listed here with what it may do."}
          </Note>
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
            onRevoked={(next) => {
              hold(next.key);
              setRevoked({
                ...next,
                undo: () => {
                  next.undo();
                  setRevoked(null);
                  setHeld(new Map());
                },
              });
            }}
          />
        ))
      )}
    </Spot>
  );
}
