/**
 * What the person sees of agents: the consent sheet (who is asking, what it
 * may do), the menu bar pill (who is connected and what it is doing, with
 * Stop), and the note after a stop. Agents get their own color, shiso;
 * kombu stays the person's (docs/agents.html, Experience).
 *
 * The sheet never takes the keyboard on its own: a stray Enter while the
 * person types elsewhere must not answer it.
 */

import { ScrollView, Svg, Text, View } from "@mirinjs/metal";
import { useState } from "react";
import type { AgentInfo, Allow, Ask } from "./agents/index.ts";
import { Shortcut, useColors } from "@dashi/ui";

/** The sheet's surface, with room for its shadow and for every scope's row (SCOPES). */
export const CONSENT = { width: 500, height: 740 } as const;
export const STOPPED = { width: 380, height: 130 } as const;
/** The permissions list, opened up: it scrolls rather than grow the sheet past a small screen. */
const MORE_HEIGHT = 330;

const SPARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z" fill="#000"/></svg>`;
const CHECK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" stroke="#000" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export function AgentMark({ size }: { size: number }) {
  const colors = useColors();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        backgroundColor: colors.agent,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Svg markup={SPARK} size={size * 0.55} color="#ffffff" />
    </View>
  );
}

/** A sheet's button: `primary` is the green one, `danger` the red one for what can't be undone. */
export function Button({ label, primary, danger, onPress }: { label: string; primary?: boolean; danger?: boolean; onPress: () => void }) {
  const colors = useColors();
  return (
    <View
      style={{
        paddingLeft: 14,
        paddingRight: 14,
        height: 30,
        borderRadius: 8,
        justifyContent: "center",
        backgroundColor: danger ? colors.critical : primary ? colors.selection : colors.button,
      }}
      onPress={onPress}
    >
      <Text style={{ fontSize: 13, fontWeight: "semibold", color: primary || danger ? "#ffffff" : colors.text }}>{label}</Text>
    </View>
  );
}

export function ConsentSheet({ ask, onAnswer }: { ask: Ask; onAnswer: (allow: Allow, scopes: string[]) => void }) {
  const colors = useColors();
  const [checked, setChecked] = useState(() => new Set(ask.scopes.filter((scope) => scope.checked).map((scope) => scope.id)));
  const toggle = (id: string) =>
    setChecked((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const answer = (allow: Allow) => onAnswer(allow, [...checked]);
  // What this call needs (and anything already ticked) shows; the rest waits
  // behind one row, so the sheet stays on a small screen however many
  // permissions there are.
  const [more, setMore] = useState(false);
  const first = ask.scopes.filter((scope) => scope.needed || scope.checked);
  const others = ask.scopes.filter((scope) => !(scope.needed || scope.checked));
  const shown = more ? [...first, ...others] : first;
  const { who } = ask;
  const title = who.remote ? "An agent on another machine wants to use Dashi" : `${who.name} wants to use Dashi`;
  const origin = [who.detail, who.claims ? `says it is “${who.claims}”` : null].filter(Boolean).join(" · ");

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <View
        occlude
        style={{
          width: CONSENT.width - 60,
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
          padding: 22,
          borderRadius: 18,
          backgroundColor: colors.launcher,
          borderWidth: 1,
          borderColor: colors.dockBorder,
          shadow: "xl",
        }}
      >
        <AgentMark size={46} />
        <View style={{ marginTop: 8 }}>
          <Text style={{ fontSize: 16, fontWeight: "bold", color: colors.text }}>{title}</Text>
        </View>
        <Text style={{ fontSize: 12, color: colors.textMuted }}>{origin}</Text>
        <ScrollView style={{ alignSelf: "stretch", marginTop: 12, ...(more ? { height: MORE_HEIGHT } : {}) }}>
          <View style={{ flexDirection: "column", flexShrink: 0 }}>
          {shown.map((scope, index) => {
            const on = checked.has(scope.id);
            return (
              <View
                key={scope.id}
                style={{
                  flexDirection: "row",
                  alignItems: "flex-start",
                  gap: 10,
                  paddingTop: 6,
                  paddingBottom: 6,
                  borderTopWidth: index === 0 ? 0 : 1,
                  borderColor: colors.separator,
                }}
                onPress={() => toggle(scope.id)}
              >
                <View
                  style={{
                    width: 16,
                    height: 16,
                    marginTop: 1,
                    borderRadius: 4,
                    borderWidth: on ? 0 : 1.5,
                    borderColor: colors.checkbox,
                    backgroundColor: on ? colors.selection : "#00000000",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {on && <Svg markup={CHECK} size={12} color="#ffffff" />}
                </View>
                <View style={{ flex: 1, flexDirection: "column", gap: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>{scope.label}</Text>
                    {scope.needed && <Text style={{ fontSize: 11, color: colors.agentInk }}>needed now</Text>}
                  </View>
                  <Text style={{ fontSize: 12, color: colors.textMuted }}>{scope.detail}</Text>
                </View>
              </View>
            );
          })}
          </View>
        </ScrollView>
        {others.length > 0 && (
          <View testID="consent-more" style={{ alignSelf: "stretch", paddingTop: 6 }} onPress={() => setMore((open) => !open)}>
            <Text style={{ fontSize: 12, color: colors.selection }}>{more ? "Fewer permissions" : `Other permissions (${others.length})…`}</Text>
          </View>
        )}
        <View style={{ alignSelf: "stretch", flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <Button label="Don't Allow" onPress={() => answer("deny")} />
          <Button label="Always Allow" onPress={() => answer("always")} />
          <Button label="Allow Once" primary onPress={() => answer("once")} />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 12 }}>
          <Text style={{ fontSize: 11.5, color: colors.textMuted }}>Stop every agent at any time with</Text>
          <Shortcut keys="⌃❖Esc" color={colors.textMuted} size={11.5} />
        </View>
      </View>
    </View>
  );
}

/** In the menu bar while an agent is connected: who, what it's doing, Stop. */
export function AgentPill({ agent, onStop }: { agent: AgentInfo; onStop: () => void }) {
  const colors = useColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 20,
        paddingLeft: 7,
        paddingRight: 3,
        borderRadius: 10,
        backgroundColor: colors.agentWash,
      }}
    >
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.agent }} />
      <Text style={{ fontSize: 12, fontWeight: "semibold", color: colors.agentInk }}>
        {agent.name} · {agent.status}
      </Text>
      <View style={{ width: 18, height: 18, alignItems: "center", justifyContent: "center" }} onPress={onStop}>
        <View style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: colors.agentInk }} />
      </View>
    </View>
  );
}

export function StoppedNote({ names }: { names: readonly string[] }) {
  const colors = useColors();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          flexDirection: "column",
          alignItems: "center",
          gap: 3,
          paddingTop: 14,
          paddingBottom: 14,
          paddingLeft: 24,
          paddingRight: 24,
          borderRadius: 16,
          backgroundColor: colors.launcher,
          borderWidth: 1,
          borderColor: colors.dockBorder,
          shadow: "xl",
        }}
      >
        <Text style={{ fontSize: 15, fontWeight: "bold", color: colors.text }}>Stopped {names.join(", ")}</Text>
        <Text style={{ fontSize: 12, color: colors.textMuted }}>It can connect again later.</Text>
      </View>
    </View>
  );
}
