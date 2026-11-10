/**
 * The agents' panel's other parts (agents-panel.tsx): a connected agent's
 * row (an MCP client, a remote agent) with its harness glyph, its name, the
 * access it has now as a chip, where it connects from, and Stop; the access
 * chip a run's card wears while it watches; and the footer's "Stop all".
 * Stopping a connection is the same as ⌃❖Esc for one agent: it is cut off
 * and the StoppedNote says so (consent.tsx).
 */

import { Shortcut, useColors } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { useEffect, useState } from "react";
import { type AgentEntry, accessWords, discGlyph, watchTime } from "./agents/index.ts";

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
  const colors = useColors();
  const timed = watchTime(entry, 0) !== null;
  const time = watchTime(entry, useSeconds(timed));
  const [wash, ink] = entry.watching
    ? [colors.captureWash, colors.criticalInk]
    : entry.phase === "waiting"
      ? [colors.brothWash, colors.broth]
      : [colors.agentWash, colors.agentInk];
  return (
    <View
      testID="agents-access"
      style={{ flexShrink: 0, height: 16, paddingLeft: 6, paddingRight: 6, borderRadius: 6, justifyContent: "center", backgroundColor: wash }}
    >
      <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: "semibold", color: ink }}>
        {time ? `${accessWords(entry)} · ${time}` : accessWords(entry)}
      </Text>
    </View>
  );
}

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
        width: 11,
        height: 11,
        borderRadius: 6,
        borderWidth: 2,
        borderColor: ring,
        backgroundColor: colors.critical,
      }}
    />
  );
}

function StopButton({ testID, onPress }: { testID: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      onPress={onPress}
      style={{ flexShrink: 0, height: 24, paddingLeft: 10, paddingRight: 10, borderRadius: 6, justifyContent: "center", backgroundColor: colors.button }}
    >
      <Text style={{ fontSize: 12, fontWeight: "semibold", color: colors.criticalInk }}>Stop</Text>
    </View>
  );
}

/** A connected agent: who, the access it has now, where it's from, and Stop. */
export function ConnectionRow({ entry, first, onStop }: { entry: AgentEntry; first: boolean; onStop: () => void }) {
  const colors = useColors();
  const doing = entry.phase === "working" && !entry.watching ? entry.doing : null;
  const origin = originWords(entry);
  return (
    <View
      testID={`agents-row:${entry.agent?.id ?? entry.key}`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        padding: 10,
        borderRadius: 9,
        ...(first ? {} : { borderTopWidth: 1, borderColor: colors.separator }),
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
        <Svg markup={discGlyph(entry.harness)} size={18} color="#ffffff" />
        {entry.watching && <TileDot ring={colors.launcher} />}
      </View>
      <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: 3 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>
          {entry.name}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
          <AccessChip entry={entry} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: 12, color: colors.textMuted }}>
              {[doing, origin].filter(Boolean).join(" · ")}
            </Text>
          </View>
        </View>
      </View>
      <StopButton testID={`agents-stop-agent:${entry.agent?.id ?? entry.key}`} onPress={onStop} />
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
        paddingTop: 8,
        paddingBottom: 4,
        paddingLeft: 10,
        paddingRight: 10,
        borderTopWidth: 1,
        borderColor: colors.separator,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Text style={{ fontSize: 12, color: colors.textMuted }}>From anywhere:</Text>
        <Shortcut keys="⌃❖Esc" color={colors.textMuted} size={12} />
      </View>
      <View testID="agents-stop-all" onPress={onStopAll} style={{ height: 24, paddingLeft: 8, paddingRight: 8, borderRadius: 6, justifyContent: "center" }}>
        <Text style={{ fontSize: 12, fontWeight: "semibold", color: colors.criticalInk }}>Stop all</Text>
      </View>
    </View>
  );
}
