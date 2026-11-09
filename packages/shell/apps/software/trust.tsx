/**
 * The trust card: the first thing on an app's or an applet's page, above the
 * screenshots, and the body of the Get… sheet. Four facts in plain words:
 * who made it (and who vouches for that), what it can reach, what changed in
 * its newest version, and how many people use it (trust-words.ts says them).
 */

import { useColors, useSurface } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { type ReactNode, useState } from "react";
import { ReviewedSeal, VerifiedBadge } from "./marks.tsx";
import type { TrustFacts } from "./trust-words.ts";

const SHOWN_NOTES = 2;

function Fact({ label, children, testID, last }: { label: string; children: ReactNode; testID: string; last?: boolean }) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 12,
        paddingHorizontal: 14,
        paddingVertical: 10,
        ...(last ? {} : { borderBottomWidth: 1, borderColor: colors.separator }),
      }}
    >
      <View style={{ width: 108, flexShrink: 0 }}>
        <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 17 }}>{label}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: 3 }}>{children}</View>
    </View>
  );
}

/**
 * Bulleted lines; `strong` ones (broad access) in ink and bold. The one list
 * Software draws (the trust card, the Get sheet, an applet's Allowed): an
 * indented dot, 17 of leading, 4 between items, wherever it sits.
 */
export function ReachLines({ lines, strong = [] }: { lines: readonly string[]; strong?: readonly string[] }) {
  const colors = useColors();
  return (
    <View style={{ flexShrink: 0, flexDirection: "column", gap: 4 }}>
      {lines.map((line) => (
        <View key={line} style={{ flexDirection: "row", gap: 7, alignItems: "flex-start" }}>
          <Text style={{ fontSize: 13, color: colors.textMuted, lineHeight: 17 }}>•</Text>
          <View style={{ flexShrink: 1 }}>
            <Text style={{ fontSize: 13, color: colors.text, lineHeight: 17, ...(strong.includes(line) ? { fontWeight: "semibold" as const } : {}) }}>
              {line}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function Notes({ notes }: { notes: readonly string[] }) {
  const colors = useColors();
  const [all, setAll] = useState(false);
  const shown = all ? notes : notes.slice(0, SHOWN_NOTES);
  return (
    <>
      {shown.map((note, index) => (
        // Paragraphs never reorder.
        <Text key={index} style={{ fontSize: 13, color: colors.text, lineHeight: 18 }}>
          {note}
        </Text>
      ))}
      {notes.length > SHOWN_NOTES && (
        <View testID="trust:more-notes" focusable accessibilityRole="button" onPress={() => setAll((now) => !now)}>
          <Text style={{ fontSize: 12, color: colors.accentInk }}>{all ? "Less" : "More…"}</Text>
        </View>
      )}
    </>
  );
}

export function TrustCard({ facts, strong = [] }: { facts: TrustFacts; strong?: readonly string[] }) {
  const colors = useColors();
  const surface = useSurface();
  const rows: Array<{ key: string; label: string; body: ReactNode }> = [
    {
      key: "maker",
      label: "Made by",
      body: (
        <>
          <Text style={{ fontSize: 13, fontWeight: "semibold", color: colors.text, lineHeight: 17 }}>{facts.maker.name}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            {facts.maker.mark === "verified" && <VerifiedBadge size={12} />}
            {facts.maker.mark === "reviewed" && <ReviewedSeal size={12} />}
            <Text style={{ fontSize: 12, color: colors.textMuted }}>{facts.maker.line}</Text>
          </View>
          {facts.signed !== null && <Text style={{ fontSize: 12, color: colors.textMuted }}>{facts.signed}</Text>}
        </>
      ),
    },
    {
      key: "reach",
      label: "It can",
      body: !facts.reach.known ? (
        <Text style={{ fontSize: 13, color: colors.textMuted }}>Flathub doesn’t say what it can reach.</Text>
      ) : (
        <>
          {facts.reach.lines.length === 0 ? (
            <Text style={{ fontSize: 13, color: colors.text }}>Nothing beyond its own window</Text>
          ) : (
            <ReachLines lines={facts.reach.lines} strong={strong} />
          )}
          {facts.reach.cannot !== null && <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 16 }}>{facts.reach.cannot}</Text>}
        </>
      ),
    },
  ];
  if (facts.changed !== null) {
    const { heading, notes } = facts.changed;
    rows.push({
      key: "changed",
      label: "What’s new",
      body: (
        <>
          {heading !== "" && <Text style={{ fontSize: 12, color: colors.textMuted }}>{heading}</Text>}
          {notes.length === 0 ? <Text style={{ fontSize: 13, color: colors.textMuted }}>No notes for this version.</Text> : <Notes notes={notes} />}
        </>
      ),
    });
  }
  if (facts.users !== null) rows.push({ key: "users", label: "Used by", body: <Text style={{ fontSize: 13, color: colors.text }}>{facts.users}</Text> });
  return (
    <View
      testID="trust-card"
      style={{ flexShrink: 0, flexDirection: "column", borderRadius: 10, backgroundColor: surface.card, borderWidth: 1, borderColor: colors.separator }}
    >
      {rows.map((row, index) => (
        <Fact key={row.key} testID={`trust:${row.key}`} label={row.label} last={index === rows.length - 1}>
          {row.body}
        </Fact>
      ))}
    </View>
  );
}
