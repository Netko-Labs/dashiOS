/**
 * Today (LK-1, lock-v3 C, decisions.md D803): the right side of the split lock, a full-height pane of
 * regular glass with no radius, `GLASS.lock.today` wide. Its title in Inter Display SemiBold; Up next, the
 * Calendar widget wide with the next events; up to three compact widgets; Notifications, each app's as
 * one card with its count, the time and a lock glyph, never who or what (NO-7: hidden by default; no app
 * shows its words yet, the per-app setting isn't built); Playing, the song with buttons that work while
 * locked. A press on a card asks for the password first and opens it after (LK-5, D486). Its words keep
 * the pane's own floor: the glass palette under `Frosted`.
 */

import { Frosted, GLASS, pill, SPACE, TYPE, useColors, WEIGHT } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { glyph } from "../shared/inks/index.ts";
import { Card } from "./card.tsx";
import { widgetInfo } from "./catalog.ts";
import { useWidgetEnv } from "./env.tsx";
import { SPANS, span } from "./layout.ts";
import { ago, useSource } from "./lib/data.ts";
import { WidgetTile } from "./lib/views/widget.tsx";
import { Btn, Lab } from "./parts.tsx";
import type { Placement, WidgetKind } from "./types.ts";

/** The pane's inside width: Today less its padding at both sides. */
const INSIDE = GLASS.lock.today - 2 * GLASS.lock.pane.padding;

/** Today's row of compacts: the weather and the battery, then the person's first widget that comes compact (a timer, a clock). */
export function todayRow(placements: readonly Placement[]): WidgetKind[] {
  const first: WidgetKind[] = ["weather", "battery"];
  const theirs = placements.find((each) => !first.includes(each.kind) && each.kind !== "calendar" && widgetInfo(each.kind)?.sizes.includes("compact"));
  return [...first, theirs?.kind ?? "clock"];
}

/** One app's notifications on the lock (NO-7): its name, how many, and when the newest came. */
export interface LockNote {
  app: string;
  count: number;
  time: number | null;
}

/** The notifications as one note per app, newest app first; the words never show. */
export function lockNotes(history: readonly object[]): LockNote[] {
  const byApp = new Map<string, LockNote>();
  for (const entry of [...history].reverse()) {
    const name = "appName" in entry && typeof entry.appName === "string" ? entry.appName.trim() : "";
    const desktop = "desktopEntry" in entry && typeof entry.desktopEntry === "string" ? entry.desktopEntry : "";
    const app = name || desktop || "Notifications";
    const time = "time" in entry && typeof entry.time === "number" ? entry.time : null;
    const had = byApp.get(app);
    byApp.set(app, { app, count: (had?.count ?? 0) + 1, time: had ? had.time : time });
  }
  return [...byApp.values()];
}

/** "2 new notifications": the count, never what they say. */
export const noteWords = (count: number): string => `${count} new notification${count === 1 ? "" : "s"}`;

export function LockToday({ placements, onPress }: { placements: readonly Placement[]; onPress: (placement: Pick<Placement, "kind">) => void }) {
  const colors = useColors();
  const { hub } = useWidgetEnv();
  const notes = lockNotes(useSource(hub?.notices, [])).slice(0, 3);
  const playing = useSource(hub?.media, null);
  const third = (INSIDE - 2 * SPACE.inset) / 3;
  return (
    <Frosted level="regular" testID="lock-today" style={{ flex: 1, paddingTop: GLASS.lock.pane.top, paddingHorizontal: GLASS.lock.pane.padding }}>
      <Text style={{ fontSize: GLASS.lock.todayTitle, fontWeight: WEIGHT.semibold, color: colors.text, fontFamily: "display" }}>Today</Text>
      <Section title="Up next">
        <WidgetTile
          kind="calendar"
          size="wide"
          width={INSIDE}
          height={span(SPANS.wide.rows)}
          air={false}
          testID="lock-widget:calendar"
          onPress={() => onPress({ kind: "calendar" })}
        />
        <View testID="lock-row" style={{ flexDirection: "row", gap: SPACE.inset }}>
          {todayRow(placements).map((kind) => (
            <WidgetTile
              key={kind}
              kind={kind}
              size="compact"
              width={third}
              height={span(SPANS.compact.rows)}
              air={false}
              testID={`lock-widget:${kind}`}
              onPress={() => onPress({ kind })}
            />
          ))}
        </View>
      </Section>
      {notes.length > 0 ? (
        <Section title="Notifications">
          {notes.map((note) => (
            <NoteCard key={note.app} note={note} />
          ))}
        </Section>
      ) : null}
      {playing ? (
        <Section title="Playing">
          <PlayingCard title={playing.title} artist={playing.artist} playing={playing.playing} onPress={() => onPress({ kind: "media" })} />
        </Section>
      ) : null}
    </Frosted>
  );
}

/** A section of Today: its caption (11 SemiBold capitals, secondary), then its cards. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  const colors = useColors();
  return (
    <View style={{ marginTop: GLASS.lock.pane.section, flexDirection: "column", gap: SPACE.m }}>
      <Text style={{ fontSize: TYPE.caption.size, fontWeight: WEIGHT.semibold, color: colors.textMuted }}>{title.toUpperCase()}</Text>
      {children}
    </View>
  );
}

/** One app's notifications, hidden (NO-7): "Messages", "2 new notifications", the lock and when. */
function NoteCard({ note }: { note: LockNote }) {
  const { inks, now } = useWidgetEnv();
  return (
    <Card
      look={{ inks, ink: null, air: false, houseDown: false, redact: false, glass: true }}
      width={INSIDE}
      height={GLASS.lock.note}
      compact
      testID={`lock-note:${note.app}`}
    >
      <NoteBody note={note} now={now} />
    </Card>
  );
}

function NoteBody({ note, now }: { note: LockNote; now: number }) {
  return (
    <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: SPACE.gap }}>
      <View style={{ flex: 1, flexDirection: "column", gap: SPACE.xxs }}>
        <Lab>{note.app}</Lab>
        <Lab strong>{noteWords(note.count)}</Lab>
      </View>
      <NoteWhen time={note.time} now={now} />
    </View>
  );
}

function NoteWhen({ time, now }: { time: number | null; now: number }) {
  const { inks } = useWidgetEnv();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xs }}>
      <Svg markup={glyph("lock")} size={TYPE.caption.size} color={inks.text.secondary} />
      {time !== null ? <Text style={{ fontSize: TYPE.caption.size, color: inks.text.secondary }}>{ago(time, now)}</Text> : null}
    </View>
  );
}

/** The song (LK-5: its buttons work while locked; the card opens Music once unlocked). */
function PlayingCard({ title, artist, playing, onPress }: { title: string; artist: string; playing: boolean; onPress: () => void }) {
  const { inks, hub } = useWidgetEnv();
  const sleeve = GLASS.lock.sleeve;
  return (
    <Card
      look={{ inks, ink: null, air: false, houseDown: false, redact: false, glass: true }}
      width={INSIDE}
      height={GLASS.lock.playing}
      compact
      onPress={onPress}
      testID="lock-playing"
    >
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: SPACE.inset }}>
        <View
          style={{
            width: sleeve,
            height: sleeve,
            borderRadius: pill(sleeve),
            backgroundColor: inks.text.tertiary,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Svg markup={glyph("music")} size={TYPE.title.size} color={inks.paper} />
        </View>
        <View style={{ flex: 1, flexDirection: "column", gap: SPACE.xxs }}>
          <Text numberOfLines={1} style={{ fontSize: TYPE.body.size, fontWeight: WEIGHT.semibold, color: inks.text.ink }}>
            {title}
          </Text>
          <Text numberOfLines={1} style={{ fontSize: TYPE.secondary.size, color: inks.text.secondary }}>
            {artist}
          </Text>
        </View>
        <Btn icon="prev" round onPress={() => void hub?.media.command("Previous")} testID="lock-previous" />
        <Btn icon={playing ? "pause" : "play"} round onPress={() => void hub?.media.command("PlayPause")} testID="lock-play" />
        <Btn icon="next" round onPress={() => void hub?.media.command("Next")} testID="lock-next" />
      </View>
    </Card>
  );
}
