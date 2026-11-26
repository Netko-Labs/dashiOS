/**
 * The agents' panel's other parts (../agents-panel.tsx): a connected agent's
 * row (an MCP client, a remote agent) with its harness glyph, its name, the
 * access it has now as a chip, where it connects from, and Stop; the access
 * chip a run's card wears while it watches; and the footer's "Stop all".
 * Stopping a connection is the same as ⌃❖Esc for one agent: it is cut off
 * and the StoppedNote says so (consent.tsx).
 */

import { Button, Chip, type ChipTone, ON_AGENT, pill, RADIUS, Shortcut, SPACE, TYPE, useColors, useSolidTwin, useSurface, WEIGHT } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { useEffect, useState } from "react";
import { type AgentEntry, accessWords, discGlyph, watchTime } from "../../agents/index.ts";
import { spaceLabel } from "../../spaces/index.ts";

/** A small button of a card: Show, Stop, Undo; the kit's small Button (Stop in ume: it ends the agent's work). */
export function Small({ label, primary, danger, testID, onPress }: { label: string; primary?: true; danger?: true; testID: string; onPress: () => void }) {
  return <Button testID={testID} label={label} size="small" {...(primary ? { primary } : {})} {...(danger ? { danger } : {})} onPress={onPress} />;
}

/** A connected agent's row: its glyph on a round shiso tile. */
const TILE = 32;

/** Where a connection is from, in a few words: "from ~/.local/bin/claude", "“claude-ai”, connected over SSH". */
export function originWords(entry: Pick<AgentEntry, "agent">): string {
  const agent = entry.agent;
  if (!agent) return "";
  if (agent.remote) return agent.claims ? `“${agent.claims}”, ${agent.detail ?? "connected over SSH"}` : (agent.detail ?? "connected over SSH");
  return agent.detail ? `from ${agent.detail}` : "";
}

/** The time now, again every second while `ticking` (and the component is on screen); else it holds still. */
function useSeconds(ticking: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  return now;
}

/**
 * The access chip: red while it watches, amber while it waits on the
 * person, shiso otherwise. While it records or sees the screen, how long
 * it has: "Recording the screen · 2:14", once a second while the panel is open.
 */
export function AccessChip({ entry }: { entry: Pick<AgentEntry, "watching" | "watchingSince" | "phase" | "kind"> }) {
  const timed = watchTime(entry, 0) !== null;
  const time = watchTime(entry, useSeconds(timed));
  const tone: ChipTone = entry.watching ? "danger" : entry.phase === "waiting" ? "warning" : "agent";
  return <Chip testID="agents-access" tone={tone} label={time ? `${accessWords(entry)} · ${time}` : accessWords(entry)} />;
}

/** The red dot's size. */
const TILE_DOT = 11;

/** The red dot on a tile: this agent sees or records the screen, or uses its pointer. */
export function TileDot({ ring }: { ring: string }) {
  const colors = useColors();
  return (
    <View
      testID="agents-dot"
      style={{
        position: "absolute",
        top: -2,
        right: -2,
        width: TILE_DOT,
        height: TILE_DOT,
        borderRadius: pill(TILE_DOT),
        borderWidth: 2,
        borderColor: ring,
        backgroundColor: colors.critical,
      }}
    />
  );
}

/** What a connection's row does: cut the agent off, and go to the Desktop it works on. */
interface RowActions {
  stopAgent(id: number): void;
  showSpace?(space: number): void;
}

/**
 * A connection's second line: the chip of its access, then what it does and where it is from.
 * The row's buttons (Stop, and Show at work on another Desktop) sit beside the title, and
 * this line has the row's whole width and is one line, never two (D114, D126). It says the Desktop and
 * who the agent says it is, whole: "On Desktop 4 · “claude-ai”". To make the room, the chip is
 * left out when all it would say is "Connected" (the row being there says that), and a remote
 * agent's "connected over SSH" too (its title is "Remote agent"). While it sees or records the
 * screen the chip says so and the name follows it, whole, on this Desktop or another; the Desktop
 * and "connected over SSH" give way.
 * The bar's line for it at rest is "Working on Desktop 3" (session-status.ts); here, "On Desktop 3".
 */
export function rowLine(entry: Pick<AgentEntry, "agent" | "doing" | "watching" | "phase" | "kind">): { chip: boolean; words: string } {
  const agent = entry.agent;
  const space = agent?.space;
  const join = (...parts: (string | null)[]): string => parts.filter(Boolean).join(" · ");
  // Who it is, in the fewest words, for a row that also holds Show.
  const who = agent?.remote ? (agent.claims ? `“${agent.claims}”` : "") : originWords(entry);
  // The chip is at its longest then ("Recording the screen · 12:14"): beside it, only who it is.
  if (entry.watching) return { chip: true, words: who };
  if (space === undefined || entry.doing !== `Working on ${spaceLabel(space)}`) {
    return { chip: true, words: join(entry.phase === "working" ? entry.doing : null, originWords(entry)) };
  }
  return { chip: accessWords(entry) !== "Connected", words: join(`On ${spaceLabel(space)}`, who) };
}

/** "Claude Code · 3 sessions" from two sessions of one agent; its name alone for one. */
export const rowTitle = (entry: Pick<AgentEntry, "name" | "sessions">): string =>
  entry.sessions > 1 ? `${entry.name} · ${entry.sessions} sessions` : entry.name;

/**
 * A connected agent: who (and how many sessions), the access it has now, where it's from, Stop, and Show
 * when it works on another Desktop. Stop cuts off every session of it in sight (decisions.md D137).
 */
export function ConnectionRow({ entry, first, actions }: { entry: AgentEntry; first: boolean; actions: RowActions }) {
  const space = entry.agent?.space;
  const onShow = actions.showSpace;
  const onStop = () => {
    for (const agent of entry.agents ?? (entry.agent ? [entry.agent] : [])) actions.stopAgent(agent.id);
  };
  const colors = useColors();
  const surface = useSurface();
  const ground = useSolidTwin("regular");
  const line = rowLine(entry);
  const id = entry.agent?.id ?? entry.key;
  // "Show": go to the Desktop an agent works on (the screen slides there; the person asked to look).
  const show = space !== undefined && onShow ? <Small testID={`agents-show-agent:${id}`} label="Show" onPress={() => onShow(space)} /> : null;
  const stop = <Small testID={`agents-stop-agent:${id}`} label="Stop" danger onPress={onStop} />;
  const title = (
    <Text numberOfLines={1} style={{ fontSize: TYPE.body.size, fontWeight: WEIGHT.semibold, color: colors.text }}>
      {rowTitle(entry)}
    </Text>
  );
  const words = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.s, minWidth: 0 }}>
      {line.chip && <AccessChip entry={entry} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: TYPE.secondary.size, color: colors.textMuted }}>
          {line.words}
        </Text>
      </View>
    </View>
  );
  return (
    <View
      testID={`agents-row:${id}`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE.gap,
        padding: SPACE.gap,
        borderRadius: RADIUS.card,
        // A row is a fill on the panel's glass, as a run's card is (frost-objects board 03).
        ...(first ? {} : { marginTop: SPACE.s }),
        backgroundColor: surface.card,
      }}
    >
      <View
        style={{
          width: TILE,
          height: TILE,
          borderRadius: TILE / 2,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.agent,
          position: "relative",
        }}
      >
        <Svg markup={discGlyph(entry.harness)} size={18} color={ON_AGENT} />
        {entry.watching && <TileDot ring={ground} />}
      </View>
      {/* The buttons sit beside the title only, and the line under it has the row's whole width: nothing in it is cut. */}
      <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: SPACE.xxs }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.gap, minWidth: 0 }}>
          <View style={{ flex: 1, minWidth: 0 }}>{title}</View>
          {show}
          {stop}
        </View>
        {words}
      </View>
    </View>
  );
}

/** "5 more connected, idle": the connections that have called nothing, or nothing for a while; Settings › Agents lists them. */
export const idleWords = (idle: number, rows: number): string => (rows > 0 ? `${idle} more connected, idle` : `${idle} connected, idle`);

export function IdleLine({ idle, rows }: { idle: number; rows: number }) {
  const colors = useColors();
  return (
    <View testID="agents-idle" style={{ paddingTop: SPACE.s, paddingBottom: SPACE.s, paddingLeft: SPACE.gap, paddingRight: SPACE.gap }}>
      <Text numberOfLines={1} style={{ fontSize: TYPE.secondary.size, color: colors.textMuted }}>
        {idleWords(idle, rows)}
      </Text>
    </View>
  );
}

/** The panel's foot: how to stop every agent from anywhere, and Stop all. */
export function StopAllFooter({ onStopAll }: { onStopAll: () => void }) {
  const colors = useColors();
  return (
    <View
      testID="agents-footer"
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingTop: SPACE.m,
        paddingBottom: SPACE.xs,
        paddingLeft: SPACE.gap,
        paddingRight: SPACE.gap,
        borderTopWidth: 1,
        borderColor: colors.separator,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xs }}>
        <Text style={{ fontSize: TYPE.secondary.size, color: colors.textMuted }}>From anywhere:</Text>
        <Shortcut keys="⌃❖Esc" color={colors.textMuted} size={12} />
      </View>
      <Small testID="agents-stop-all" label="Stop all" danger onPress={onStopAll} />
    </View>
  );
}

/** A panel's empty state: one line, 12 muted, what lands here and how (SH-31). */
export function NoAgents() {
  const colors = useColors();
  return (
    <View testID="agents-empty" style={{ padding: SPACE.inset }}>
      <Text style={{ fontSize: TYPE.secondary.size, color: colors.textMuted }}>
        No agents in the last hour. Click Dashi’s mark in the menu bar to give it a job.
      </Text>
    </View>
  );
}
