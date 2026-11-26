/**
 * What the person sees of agents: the consent sheet (who is asking, what it
 * may do) and the note after a stop. Who is connected and what each does is
 * the menu bar's agent mark and its panel (agent-mark.tsx, agents-panel/agents-panel.tsx). Agents get their own color, shiso;
 * kombu stays the person's (docs/agents.html, Experience).
 *
 * The sheet never takes the keyboard on its own: a stray Enter while the
 * person types elsewhere must not answer it.
 */

import { Alert, type AlertButton, MoreButton, Notice, SheetCard, Shortcut, SPACE, TYPE, useColors, WEIGHT } from "@dashi/ui";
import { ScrollView, Text, View } from "@mirinjs/metal";
import { useState } from "react";
import type { Allow, Ask } from "./agents/index.ts";
import { NeededScopes, ScopeGrid } from "./consent-scopes.tsx";

/** Short enough for a 1280×720-point screen, with room for its shadow; the card sits `below` above its foot, on its bottom edge, so opening the other permissions grows it upward and the buttons stay put. */
export const CONSENT = { width: 500, height: 640, below: 80 } as const;
export const STOPPED = { width: 380, height: 130 } as const;

/** A surface's ground made solid, so the page under a question can't be read through it. */
export function opaque(color: string): string {
  return /^#[0-9a-f]{8}$/i.test(color) ? color.slice(0, 7) : color;
}

/** The agents' mark, the glyph on an agent's sheet's shiso tile (UI-5: `tone="agent"`). */
export const AGENT_GLYPH = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z" fill="#000"/></svg>`;

/** The kind of a sheet's go-ahead button: ume only for what loses work or can't be undone, else the ink primary. */
export function goAheadKind(danger: boolean | undefined): "danger" | "primary" {
  return danger === true ? "danger" : "primary";
}

/** Who asks, as a sheet names it: the agent's name, or "an agent on another machine" (`lead`: at a sentence's start). */
export function agentSubject(who: Ask["who"], lead = false): string {
  if (!who.remote) return who.name;
  return lead ? "An agent on another machine" : "an agent on another machine";
}

/** Where it connects from, and what it says it is: the line under an agent's question. */
export function agentOrigin(who: Ask["who"]): string {
  return [who.detail, who.claims ? `says it is “${who.claims}”` : null].filter(Boolean).join(" · ");
}

/** "Stop every agent at any time with ⌃❖Esc": the line under an agent's question. */
export function StopLine({ words }: { words: string }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xs }}>
      <Text style={{ fontSize: TYPE.caption.size, color: colors.textMuted }}>{words}</Text>
      <Shortcut keys="⌃❖Esc" color={colors.textMuted} size={TYPE.caption.size} />
    </View>
  );
}

/** The card's width on its surface, and the most its permissions take before they scroll. */
const CARD_WIDTH = CONSENT.width - 60;
const SCOPES_MAX = 300;
/** The line under the grid that says what the pointed-at permission allows: always this tall, so nothing moves. */
const ABOUT_LINES = 2;
const ABOUT_CHARS = 150;

/** `text` cut at a word to `max` characters, with an ellipsis. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max - 1);
  const space = head.lastIndexOf(" ");
  return `${(space > max / 2 ? head.slice(0, space) : head).replace(/[\s,;:]+$/, "")}…`;
}

/** The three answers. A grant: Enter never says yes (UI-6), and the sheet never takes the keyboard by itself. */
function answers(onAnswer: (allow: Allow) => void): AlertButton[] {
  return [
    { label: "Don’t allow", testID: "consent-deny", onPress: () => onAnswer("deny"), cancel: true },
    { label: "Always allow", testID: "consent-always", onPress: () => onAnswer("always") },
    { label: "Allow once", testID: "consent-once", onPress: () => onAnswer("once"), kind: "primary", isDefault: false },
  ];
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
  const question = ask.title ?? `Allow ${agentSubject(who)} to use Dashi?`;
  const origin = agentOrigin(who);
  const point = (id: string, hovered: boolean): void => setPointed((now) => (hovered ? id : now === id ? null : now));

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "flex-end", paddingTop: SPACE.inset, paddingBottom: CONSENT.below }}>
      <SheetCard testID="consent-sheet" width={CARD_WIDTH} frosted>
        <Alert question={question} message={origin} glyph={AGENT_GLYPH} tone="agent" buttons={answers(answer)}>
          {/* Scrolls only when even this can't fit (a long need on a small sheet); it gives way before anything else. */}
          <ScrollView style={{ maxHeight: SCOPES_MAX, flexShrink: 1, minHeight: 0 }}>
            <View style={{ flexDirection: "column", flexShrink: 0 }}>
              <NeededScopes scopes={needed} checked={checked} onToggle={toggle} />
              {lined.length > 0 && (
                <View
                  style={{
                    flexDirection: "column",
                    flexShrink: 0,
                    borderTopWidth: needed.length > 0 ? 1 : 0,
                    borderColor: colors.separator,
                    paddingTop: SPACE.s,
                  }}
                >
                  {allowed.length > 0 && (
                    <Text style={{ fontSize: TYPE.caption.size, lineHeight: TYPE.caption.line, fontWeight: WEIGHT.semibold, color: colors.textMuted }}>
                      Already allowed
                    </Text>
                  )}
                  {allowed.length > 0 && <ScopeGrid scopes={allowed} testID="consent-allowed" checked={checked} onToggle={toggle} onPoint={point} />}
                  {more && others.length > 0 && <ScopeGrid scopes={others} testID="consent-others" checked={checked} onToggle={toggle} onPoint={point} />}
                  <View testID="consent-about" style={{ height: ABOUT_LINES * TYPE.secondary.line, marginTop: SPACE.xs, overflow: "hidden" }}>
                    <Text style={{ fontSize: TYPE.secondary.size, lineHeight: TYPE.secondary.line, color: colors.textMuted }}>
                      {about ? cut(about.detail, ABOUT_CHARS) : "Point at one to see what it allows."}
                    </Text>
                  </View>
                </View>
              )}
            </View>
          </ScrollView>
          {others.length > 0 && (
            <MoreButton
              testID="consent-more"
              open={more}
              more={`Other permissions (${others.length})`}
              less="Fewer permissions"
              onPress={() => setMore((open) => !open)}
            />
          )}
          <StopLine words="Stop every agent at any time with" />
        </Alert>
      </SheetCard>
    </View>
  );
}

/** After a stop: a notice that only informs (UI-5), centred on its surface, gone by itself. */
export function StoppedNote({ names }: { names: readonly string[] }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Notice testID="stopped" text={`Stopped ${names.join(", ")}. It can connect again later.`} />
    </View>
  );
}
