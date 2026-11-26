/**
 * Glance on any screen (LK-3, lock-v3 C and #narrow, decisions.md D803, D806): the split lock's left half on
 * black, in Dark's inks whatever the mode (the clock `#A3A3A1`, the words their secondary): the day and
 * the clock where the lock draws them, and Today folded into words where Today is: what is on air as one
 * line, then the counts (notifications, the song) with their glyphs. Everything moves a few points each
 * minute so no pixel burns in (`glanceNudge`); any key or press wakes the lock as it was.
 */

import { inkTokens, LockClock, type LockLayout, SPACE, TYPE } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { glyph } from "../../shared/inks/index.ts";
import { onAirWords, useSecondTick } from "../../tally/index.ts";
import { useWidgetEnv } from "../env.tsx";
import { lockTime, useClockDisplay } from "../lock.tsx";
import { useSource } from "./data.ts";
import { lockNotes, noteWords } from "./today-cards.tsx";

export interface SplitGlanceProps {
  day: string;
  /** Where the lock puts things on this screen (@dashi/ui `lockLayout`). */
  layout: LockLayout;
  /** Where the content sits this minute (glance.tsx `glanceNudge`). */
  nudge: { x: number; y: number };
}

export function SplitGlance({ day, layout, nudge }: SplitGlanceProps) {
  const { now, hour24, tally, hub } = useWidgetEnv();
  const inks = inkTokens("dark");
  const item = tally.item;
  const tick = useSecondTick(item?.countdown !== undefined);
  const display = useClockDisplay();
  const notes = lockNotes(useSource(hub?.notices, []));
  const count = notes.reduce((sum, note) => sum + note.count, 0);
  const playing = useSource(hub?.media, null);
  const words = { fontSize: TYPE.body.size, color: inks.text.secondary } as const;
  // Where Today is: the pane's middle at the right, or under the left half where the sheet would be.
  const place = layout.glance.top === null ? ({ top: nudge.y, bottom: 0, justifyContent: "center" } as const) : { top: layout.glance.top + nudge.y };
  return (
    <>
      <View style={{ position: "absolute", left: layout.inset + nudge.x, top: layout.top + nudge.y }}>
        <LockClock day={day} time={lockTime(now, hour24)} ink={inks.text.tertiary} display={display} clock={layout.clock} testID="glance-clock" />
      </View>
      <View testID="glance-today" style={{ position: "absolute", left: layout.glance.left + nudge.x, ...place, gap: SPACE.inset }}>
        {item ? <Text style={{ fontSize: TYPE.title.size, color: inks.text.tertiary }}>{onAirWords(item, tick)}</Text> : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.page }}>
          {count > 0 ? <Fact glyphName="msg" words={noteWords(count)} style={words} /> : null}
          {playing ? <Fact glyphName="music" words={playing.title} style={words} /> : null}
        </View>
      </View>
    </>
  );
}

function Fact({ glyphName, words, style }: { glyphName: "msg" | "music"; words: string; style: { fontSize: number; color: string } }) {
  return (
    <View testID={`glance-${glyphName}`} style={{ flexDirection: "row", alignItems: "center", gap: SPACE.s }}>
      <Svg markup={glyph(glyphName)} size={style.fontSize} color={style.color} />
      <Text numberOfLines={1} style={style}>
        {words}
      </Text>
    </View>
  );
}
