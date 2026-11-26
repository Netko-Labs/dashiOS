/**
 * What Today holds, at any width (lock-today.tsx frames it as a pane or a sheet): Up next, the Calendar
 * widget wide and a row of two or three compacts; Notifications, each app's as one hidden card (NO-7);
 * Playing, the song with its buttons (they work while locked, LK-5). And the sheet's peek row: the
 * notifications in one card and the song, each pressed as a card (D486).
 */

import { GLASS, pill, SPACE, TYPE, useColors, WEIGHT } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { glyph } from "../../shared/inks/index.ts";
import { Card } from "../card.tsx";
import { useWidgetEnv } from "../env.tsx";
import { SPANS, span } from "../layout.ts";
import { useCard } from "../look.tsx";
import { Btn, NowTag } from "../parts.tsx";
import type { Placement, WidgetKind } from "../types.ts";
import { ago } from "./data.ts";
import { kindOfKey, WidgetTile } from "./views/widget.tsx";

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

/** The song as Today shows it. */
export interface TodaySong {
  title: string;
  artist: string;
  playing: boolean;
}

type Press = (placement: Pick<Placement, "kind">) => void;

export interface TodayBodyProps {
  width: number;
  row: readonly WidgetKind[];
  notes: readonly LockNote[];
  song: TodaySong | null;
  onPress: Press;
}

/** Up next, Notifications and Playing, one under the other, `width` wide. */
export function TodayBody({ width, row, notes, song, onPress }: TodayBodyProps) {
  const each = (width - (row.length - 1) * SPACE.inset) / row.length;
  // The card on air glows in its ink with the Now dot (CO-12, D792, D807); the lock has no live cards, so any of Today's may hold it.
  const { tally } = useWidgetEnv();
  const holder = tally.holder ? kindOfKey(tally.holder) : null;
  return (
    <>
      <Section title="Up next">
        <WidgetTile
          kind="calendar"
          size="wide"
          width={width}
          height={span(SPANS.wide.rows)}
          air={holder === "calendar"}
          testID="lock-widget:calendar"
          onPress={() => onPress({ kind: "calendar" })}
        />
        <View testID="lock-row" style={{ flexDirection: "row", gap: SPACE.inset }}>
          {row.map((kind) => (
            <WidgetTile
              key={kind}
              kind={kind}
              size="compact"
              width={each}
              height={span(SPANS.compact.rows)}
              air={holder === kind}
              testID={`lock-widget:${kind}`}
              onPress={() => onPress({ kind })}
            />
          ))}
        </View>
      </Section>
      {notes.length > 0 ? (
        <Section title="Notifications">
          {notes.map((note) => (
            <NoteCard key={note.app} note={note} width={width} />
          ))}
        </Section>
      ) : null}
      {song ? (
        <Section title="Playing">
          <PlayingCard song={song} width={width} air={holder === "media"} onPress={() => onPress({ kind: "media" })} />
        </Section>
      ) : null}
    </>
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

/** The look every card on Today wears: paper glass, as every widget's (D791, D807). */
function useTodayLook(air = false) {
  const { inks } = useWidgetEnv();
  return { inks, ink: air ? ("album" as const) : null, air, houseDown: false, redact: false } as const;
}

/** One app's notifications, hidden (NO-7): "Messages", "2 new notifications", the lock and when. */
export function NoteCard({ note, width }: { note: LockNote; width: number }) {
  const { now } = useWidgetEnv();
  return (
    <Card look={useTodayLook()} width={width} height={GLASS.lock.note} compact testID={`lock-note:${note.app}`}>
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: SPACE.gap }}>
        <NoteWords app={note.app} words={noteWords(note.count)} />
        <NoteWhen time={note.time} now={now} />
      </View>
    </Card>
  );
}

/** The app (11 SemiBold, secondary) over the count (13 SemiBold, the card's ink), in sentence case as lock-v3 draws them. */
function NoteWords({ app, words }: { app: string; words: string }) {
  const card = useCard();
  return (
    <View style={{ flex: 1, flexDirection: "column", gap: SPACE.xxs }}>
      <Text numberOfLines={1} style={{ fontSize: TYPE.caption.size, fontWeight: WEIGHT.semibold, color: card.secondary }}>
        {app}
      </Text>
      <Text numberOfLines={1} style={{ fontSize: TYPE.body.size, fontWeight: WEIGHT.semibold, color: card.ink }}>
        {words}
      </Text>
    </View>
  );
}

function NoteWhen({ time, now }: { time: number | null; now: number }) {
  const card = useCard();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xs }}>
      <Svg markup={glyph("lock")} size={TYPE.caption.size} color={card.secondary} />
      {time !== null ? <Text style={{ fontSize: TYPE.caption.size, color: card.secondary }}>{ago(time, now)}</Text> : null}
    </View>
  );
}

/** The song (LK-5: its buttons work while locked; the card opens Music once unlocked). */
export function PlayingCard({
  song,
  width,
  onPress,
  compact = false,
  air = false,
}: {
  song: TodaySong;
  width: number;
  onPress: () => void;
  compact?: boolean;
  air?: boolean;
}) {
  const { hub } = useWidgetEnv();
  const look = useTodayLook(air);
  return (
    <Card look={look} width={width} height={compact ? GLASS.lock.note : GLASS.lock.playing} compact onPress={onPress} testID="lock-playing">
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: SPACE.inset }}>
        <Sleeve size={compact ? GLASS.lock.pill.height : GLASS.lock.sleeve} />
        <SongWords song={song} />
        {air ? <NowTag tally={look.inks.tally} /> : null}
        {compact ? null : <Btn icon="prev" round onPress={() => void hub?.media.command("Previous")} testID="lock-previous" />}
        <Btn icon={song.playing ? "pause" : "play"} round onPress={() => void hub?.media.command("PlayPause")} testID="lock-play" />
        {compact ? null : <Btn icon="next" round onPress={() => void hub?.media.command("Next")} testID="lock-next" />}
      </View>
    </Card>
  );
}

function Sleeve({ size }: { size: number }) {
  const card = useCard();
  return (
    <View style={{ width: size, height: size, borderRadius: pill(size), backgroundColor: card.tertiary, alignItems: "center", justifyContent: "center" }}>
      <Svg markup={glyph("music")} size={size / 2} color={card.paper} />
    </View>
  );
}

function SongWords({ song }: { song: TodaySong }) {
  const card = useCard();
  return (
    <View style={{ flex: 1, flexDirection: "column", gap: SPACE.xxs }}>
      <Text numberOfLines={1} style={{ fontSize: TYPE.body.size, fontWeight: WEIGHT.semibold, color: card.ink }}>
        {song.title}
      </Text>
      <Text numberOfLines={1} style={{ fontSize: TYPE.secondary.size, color: card.secondary }}>
        {song.artist}
      </Text>
    </View>
  );
}

/** The sheet's peek row (lock-v3 #narrow): the notifications in one card (named by its app, or "Notifications" for several), the song. */
export function PeekRow({ width, notes, song, onPress }: { width: number; notes: readonly LockNote[]; song: TodaySong | null; onPress: Press }) {
  const total = notes.reduce((sum, note) => sum + note.count, 0);
  const first = notes[0];
  const cards = (first ? 1 : 0) + (song ? 1 : 0);
  const each = cards > 0 ? (width - (cards - 1) * SPACE.gap) / cards : width;
  return (
    <View testID="lock-peek-row" style={{ flex: 1, flexDirection: "row", gap: SPACE.gap }}>
      {first ? <NoteCard note={{ app: notes.length > 1 ? "Notifications" : first.app, count: total, time: first.time }} width={each} /> : null}
      {song ? <PlayingCard song={song} width={each} compact onPress={() => onPress({ kind: "media" })} /> : null}
    </View>
  );
}
