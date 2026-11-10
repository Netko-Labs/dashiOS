/**
 * What the person sees of agents: the consent sheet (who is asking, what it
 * may do) and the note after a stop. Who is connected and what each does is
 * the menu bar's agent mark and its panel (agent-mark.tsx, agents-panel/agents-panel.tsx). Agents get their own color, shiso;
 * kombu stays the person's (docs/agents.html, Experience).
 *
 * The sheet never takes the keyboard on its own: a stray Enter while the
 * person types elsewhere must not answer it.
 */

import { Shortcut, useColors } from "@dashi/ui";
import { ScrollView, Svg, Text, View } from "@mirinjs/metal";
import { useState } from "react";
import type { Allow, Ask } from "./agents/index.ts";

/** Short enough for a 1280×720-point screen, with room for its shadow; the card sits `BELOW` above its foot. */
export const CONSENT = { width: 500, height: 640 } as const;
export const STOPPED = { width: 380, height: 130 } as const;

/** A sheet's card: the launcher's glass made solid, so the page under a question can't be read through it. */
export function opaque(color: string): string {
  return /^#[0-9a-f]{8}$/i.test(color) ? color.slice(0, 7) : color;
}

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

/** The look of a sheet's go-ahead button: red only for what loses work or can't be taken back, else the primary one. */
export function goAheadLook(danger: boolean | undefined): { danger: true } | { primary: true } {
  return danger === true ? { danger: true } : { primary: true };
}

/** A sheet's button: `primary` is the green one, `danger` the red one for what can't be undone. */
export function Button({
  label,
  primary,
  danger,
  testID,
  onPress,
}: {
  label: string;
  primary?: boolean;
  danger?: boolean;
  testID?: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <View
      {...(testID ? { testID } : {})}
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

/** Room under the card: it sits on its bottom edge, so opening the other permissions grows it upward and the buttons stay put. */
const BELOW = 80;
/** A permission in the grid of the others: one line. */
const CELL = 24;
/** The line under the grid that says what the pointed-at permission allows: always this tall, so nothing moves. */
const ABOUT_LINES = 2;
const ABOUT_CHARS = 150;

function CheckBox({ on }: { on: boolean }) {
  const colors = useColors();
  return (
    <View
      style={{
        width: 16,
        height: 16,
        flexShrink: 0,
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
  );
}

/** `text` cut at a word to `max` characters, with an ellipsis. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max - 1);
  const space = head.lastIndexOf(" ");
  return `${(space > max / 2 ? head.slice(0, space) : head).replace(/[\s,;:]+$/, "")}…`;
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
  // What this call needs shows in full, first, so it is never out of sight. What is already
  // allowed (ticked: Always Allow keeps it) is one line each, always in view; the rest waits
  // behind one row and opens as a grid of the same lines. Pointing at a line says what it allows.
  const [more, setMore] = useState(false);
  const [pointed, setPointed] = useState<string | null>(null);
  const needed = ask.scopes.filter((scope) => scope.needed);
  const allowed = ask.scopes.filter((scope) => !scope.needed && scope.checked);
  const others = ask.scopes.filter((scope) => !(scope.needed || scope.checked));
  const lined = more ? [...allowed, ...others] : allowed;
  const about = lined.find((scope) => scope.id === pointed);
  const { who } = ask;
  const title = who.remote ? "An agent on another machine wants to use Dashi" : `${who.name} wants to use Dashi`;
  const origin = [who.detail, who.claims ? `says it is “${who.claims}”` : null].filter(Boolean).join(" · ");
  const grid = (scopes: Ask["scopes"], testID: string) => (
    <View testID={testID} style={{ display: "grid", gridTemplateColumns: ["1fr", "1fr"], columnGap: 12, flexShrink: 0 }}>
      {scopes.map((scope) => (
        <View
          key={scope.id}
          testID={`consent-scope:${scope.id}`}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            height: CELL,
            minWidth: 0,
            borderRadius: 6,
            hoverBackgroundColor: colors.button,
          }}
          onHoverChange={(hovered) => setPointed((now) => (hovered ? scope.id : now === scope.id ? null : now))}
          onPress={() => toggle(scope.id)}
        >
          <CheckBox on={checked.has(scope.id)} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: 13, color: colors.text }}>
              {scope.label}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "flex-end", paddingTop: 12, paddingBottom: BELOW }}>
      <View
        occlude
        testID="consent-sheet"
        style={{
          width: CONSENT.width - 60,
          maxHeight: CONSENT.height - 12 - BELOW,
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
          padding: 22,
          borderRadius: 18,
          backgroundColor: opaque(colors.launcher),
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
        {/* Scrolls only when even this can't fit (a long need on a small sheet); it gives way before anything else. */}
        <ScrollView style={{ alignSelf: "stretch", marginTop: 12, flexShrink: 1, minHeight: 0 }}>
          <View style={{ flexDirection: "column", flexShrink: 0 }}>
            {needed.map((scope, index) => (
              <View
                key={scope.id}
                testID={`consent-scope:${scope.id}`}
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
                <View style={{ marginTop: 1 }}>
                  <CheckBox on={checked.has(scope.id)} />
                </View>
                <View style={{ flex: 1, flexDirection: "column", gap: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>{scope.label}</Text>
                    <Text style={{ fontSize: 11, color: colors.agentInk }}>needed now</Text>
                  </View>
                  <Text style={{ fontSize: 12, color: colors.textMuted }}>{scope.detail}</Text>
                </View>
              </View>
            ))}
            {lined.length > 0 && (
              <View style={{ flexDirection: "column", flexShrink: 0, borderTopWidth: needed.length > 0 ? 1 : 0, borderColor: colors.separator, paddingTop: 6 }}>
                {allowed.length > 0 && (
                  <View style={{ height: 18, justifyContent: "center" }}>
                    <Text style={{ fontSize: 11, color: colors.textMuted }}>Already allowed</Text>
                  </View>
                )}
                {allowed.length > 0 && grid(allowed, "consent-allowed")}
                {more && others.length > 0 && grid(others, "consent-others")}
                <View testID="consent-about" style={{ height: ABOUT_LINES * 16, marginTop: 4, overflow: "hidden" }}>
                  <Text style={{ fontSize: 12, lineHeight: 16, color: colors.textMuted }}>
                    {about ? cut(about.detail, ABOUT_CHARS) : "Point at one to see what it allows."}
                  </Text>
                </View>
              </View>
            )}
          </View>
        </ScrollView>
        {others.length > 0 && (
          <View testID="consent-more" style={{ alignSelf: "stretch", paddingTop: 6 }} onPress={() => setMore((open) => !open)}>
            <Text style={{ fontSize: 12, color: colors.selection }}>{more ? "Fewer permissions" : `Other permissions (${others.length})…`}</Text>
          </View>
        )}
        <View style={{ alignSelf: "stretch", flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <Button label="Don't Allow" testID="consent-deny" onPress={() => answer("deny")} />
          <Button label="Always Allow" testID="consent-always" onPress={() => answer("always")} />
          <Button label="Allow Once" testID="consent-once" primary onPress={() => answer("once")} />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 12 }}>
          <Text style={{ fontSize: 11.5, color: colors.textMuted }}>Stop every agent at any time with</Text>
          <Shortcut keys="⌃❖Esc" color={colors.textMuted} size={11.5} />
        </View>
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
          backgroundColor: opaque(colors.launcher),
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
