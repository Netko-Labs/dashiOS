/**
 * Today (LK-1, lock-v3 C and #narrow, decisions.md D803, D806), where the split lock puts it
 * (`TodayPlace`, @dashi/ui's lock-layout.ts): a full-height pane of regular glass at the right (744 on a
 * wide screen, narrower on a smaller landscape one), or on a screen taller than wide a bottom sheet of
 * regular glass, 12 in from the sides, rounded at the top, open when there is room and else its peek, a
 * row that a chevron opens with no password (Today already shows on the lock). What it holds is
 * lib/today-cards.tsx's: Up next, Notifications hidden (NO-7), Playing. A press on a card asks for the
 * password first and opens it after (LK-5, D486). Its words keep the glass's own floor.
 */

import { CHEVRON_DOWN, CHEVRON_UP, Frosted, GLASS, pill, SPACE, type TodayPlace, TYPE, useColors, WEIGHT } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { type ReactNode, useState } from "react";
import { widgetInfo } from "./catalog.ts";
import { useWidgetEnv } from "./env.tsx";
import { useSource } from "./lib/data.ts";
import { lockNotes, PeekRow, TodayBody, type TodaySong } from "./lib/today-cards.tsx";
import type { Placement, WidgetKind } from "./types.ts";

/** Today's row of compacts: the weather and the battery, then the person's first widget that comes compact (a timer, a clock); `count` of them. */
export function todayRow(placements: readonly Placement[], count: 2 | 3 = 3): WidgetKind[] {
  const first: WidgetKind[] = ["weather", "battery"];
  const theirs = placements.find((each) => !first.includes(each.kind) && each.kind !== "calendar" && widgetInfo(each.kind)?.sizes.includes("compact"));
  return [...first, theirs?.kind ?? "clock"].slice(0, count);
}

interface LockTodayProps {
  place: TodayPlace;
  placements: readonly Placement[];
  onPress: (placement: Pick<Placement, "kind">) => void;
}

/** What Today shows now: up to three apps' hidden notes, and the song. */
function useTodayData(): { notes: ReturnType<typeof lockNotes>; song: TodaySong | null } {
  const { hub } = useWidgetEnv();
  const notes = lockNotes(useSource(hub?.notices, [])).slice(0, 3);
  const playing = useSource(hub?.media, null);
  return { notes, song: playing ? { title: playing.title, artist: playing.artist, playing: playing.playing } : null };
}

export function LockToday({ place, placements, onPress }: LockTodayProps) {
  const data = useTodayData();
  if (place.kind === "pane") {
    const inside = place.width - 2 * place.padding;
    return (
      <Frosted level="regular" testID="lock-today" style={{ flex: 1, paddingTop: place.top, paddingHorizontal: place.padding }}>
        <Title />
        <TodayBody width={inside} row={todayRow(placements, place.smalls)} {...data} onPress={onPress} />
      </Frosted>
    );
  }
  return <TodayAtFoot open={place.open} width={place.width} placements={placements} onPress={onPress} {...data} />;
}

function Title({ size = GLASS.lock.todayTitle }: { size?: number }) {
  const colors = useColors();
  return <Text style={{ fontSize: size, fontWeight: WEIGHT.semibold, color: colors.text, fontFamily: "display" }}>Today</Text>;
}

interface AtFootProps extends ReturnType<typeof useTodayData> {
  open: boolean;
  width: number;
  placements: readonly Placement[];
  onPress: LockTodayProps["onPress"];
}

/**
 * The sheet (lock-v3 #narrow): regular glass, rounded at the top (it runs its radius past the screen's foot,
 * so only the top corners show), open when the screen has room; else its peek, the title and a row of
 * cards, with a thin-glass chevron that opens it and closes it again.
 */
function TodayAtFoot({ open: roomy, width, placements, onPress, notes, song }: AtFootProps) {
  const [opened, setOpened] = useState(false);
  const open = roomy || opened;
  const { sheet } = GLASS.lock;
  const inside = width - 2 * sheet.padding;
  return (
    <Frosted
      level="regular"
      testID="lock-today"
      style={{
        marginLeft: sheet.inset,
        marginRight: sheet.inset,
        marginBottom: -sheet.radius,
        paddingTop: open ? sheet.top : SPACE.gap,
        paddingHorizontal: sheet.padding,
        paddingBottom: sheet.radius + sheet.padding,
        borderRadius: sheet.radius,
      }}
    >
      {roomy ? null : <Grabber />}
      {open ? (
        <>
          <SheetHead title={<Title />} chevron={roomy ? null : <Chevron up={false} onPress={() => setOpened(false)} />} />
          <TodayBody width={inside} row={todayRow(placements)} notes={notes} song={song} onPress={onPress} />
        </>
      ) : (
        <View style={{ height: sheet.peek - SPACE.gap - sheet.padding, flexDirection: "row", alignItems: "center", gap: SPACE.page }}>
          <Title size={TYPE.title.size} />
          <PeekRow width={inside - PEEK_ROOM} notes={notes} song={song} onPress={onPress} />
          <Chevron up onPress={() => setOpened(true)} />
        </View>
      )}
    </Frosted>
  );
}

/** Room the peek's title and chevron take from its row of cards. */
const PEEK_ROOM = 160;

function SheetHead({ title, chevron }: { title: ReactNode; chevron: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      {title}
      {chevron}
    </View>
  );
}

/** The grabber: a short bar at the sheet's top, in the secondary ink (lock-v3 #narrow). */
function Grabber() {
  const colors = useColors();
  const width = GLASS.lock.sheet.grabber;
  return <View style={{ alignSelf: "center", width, height: SPACE.s, borderRadius: pill(SPACE.s), backgroundColor: colors.textMuted }} />;
}

/** The chevron that opens Today (up) or closes it (down): thin glass, a circle; Space opens it from the keyboard (LK-5). */
function Chevron({ up, onPress }: { up: boolean; onPress: () => void }) {
  const colors = useColors();
  const size = GLASS.lock.sheet.chevron;
  return (
    <Frosted
      level="thin"
      testID={up ? "lock-today-open" : "lock-today-close"}
      focusable
      accessibilityRole="button"
      accessibilityLabel={up ? "Show all of Today" : "Show less of Today"}
      onPress={onPress}
      style={{ width: size, height: size, borderRadius: pill(size), alignItems: "center", justifyContent: "center" }}
    >
      <Svg markup={up ? CHEVRON_UP : CHEVRON_DOWN} size={SPACE.button} color={colors.text} />
    </Frosted>
  );
}
