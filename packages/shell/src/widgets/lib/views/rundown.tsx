/**
 * The Rundown: a striped receipt (round five, #17). The hero is what is
 * next and how long until it; each row under it is a pale wash of its
 * source's ink with a 3-point strip and the source's glyph, the time and the
 * words in plain ink. It leaves out what a placed widget already shows (#24).
 */

import { RADIUS, SPACE } from "@dashi/ui";
import { Svg, View } from "@mirinjs/metal";
import { glyph } from "../../../shared/inks/index.ts";
import { useWidgetEnv } from "../../env.tsx";
import { alpha } from "../../look.tsx";
import { Grow, Head, Lab, Meta, Num, Private, Title, Words } from "../../parts.tsx";
import type { WidgetSize } from "../../types.ts";
import { clockText } from "../data.ts";
import { type RundownRow, rundownHero, rundownRows } from "../rundown.ts";

function ReceiptRow({ row, hour24 }: { row: RundownRow; hour24: boolean }) {
  const { inks, tally } = useWidgetEnv();
  const ink = tally.houseDown ? inks.dimmed[row.ink] : inks.ink[row.ink];
  return (
    <View
      testID={`rundown-row:${row.source}`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE.gap,
        height: 30,
        paddingLeft: SPACE.inset,
        paddingRight: SPACE.gap,
        borderRadius: RADIUS.row,
        backgroundColor: alpha(ink, tally.houseDown ? 0.08 : 0.12),
      }}
    >
      <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, borderRadius: RADIUS.thumb, backgroundColor: ink }} />
      <Svg markup={glyph(row.glyph)} size={13} color={ink} />
      <View style={{ width: 40 }}>
        <Title size={12.5}>{clockText(row.at, hour24)}</Title>
      </View>
      {row.private ? (
        <Private what="Event" width={100}>
          <Title weight="500" max={24}>
            {row.title}
          </Title>
        </Private>
      ) : (
        <Title weight="500" max={24}>
          {row.title}
        </Title>
      )}
      <Grow />
      <Meta max={16}>{row.detail}</Meta>
    </View>
  );
}

export function RundownWidget({ size }: { size: WidgetSize }) {
  const { hub, now, hour24, placedKinds, inks, tally } = useWidgetEnv();
  const all = hub?.rundown(now) ?? [];
  const hero = rundownHero(all, now, (at) => clockText(at, hour24));
  const rows = rundownRows(all, placedKinds, hero, now, size === "large" ? 4 : 2);
  const date = new Date(now);
  const day = `${date.toLocaleDateString(undefined, { weekday: "long" })} ${date.getDate()}`;
  const heroInk = hero.ink ? (tally.houseDown ? inks.dimmed[hero.ink] : inks.ink[hero.ink]) : undefined;
  return (
    <>
      <Head left={<Lab>{`Rundown · ${day}`}</Lab>} right={<Meta>today</Meta>} />
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: SPACE.inset, marginTop: SPACE.inset }}>
        <Num value={hero.value} unit={hero.unit} size={58} weight={hero.near} {...(heroInk ? { ink: heroInk } : { plain: true })} />
        <View style={{ flex: 1, flexDirection: "column", marginBottom: SPACE.xxs }}>
          {hero.private ? (
            <Private what="Event" width={110}>
              <Title>{hero.title}</Title>
            </Private>
          ) : (
            <Title>{hero.title}</Title>
          )}
          <Words>{hero.detail}</Words>
        </View>
      </View>
      <Grow />
      <View style={{ flexDirection: "column", gap: SPACE.xs }}>
        {rows.length === 0 ? (
          <Words>Nothing else today</Words>
        ) : (
          rows.map((row) => <ReceiptRow key={`${row.source}${row.at}${row.title}`} row={row} hour24={hour24} />)
        )}
      </View>
    </>
  );
}
