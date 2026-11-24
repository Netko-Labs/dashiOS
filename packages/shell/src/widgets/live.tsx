/**
 * Live cards at the top of the area: a running timer, an agent's run, a
 * question that waits. The holder floods; one standby card shows with a
 * hollow ring; more than two fold into one row of glyphs and numbers (#23).
 * A right-click pins a card (the design's long press, D403).
 */

import { SPACE, TYPE } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { glyph, isGlyphName } from "../shared/inks/index.ts";
import { type OnAirItem, onAirWords, systemTally, useSecondTick } from "../tally/index.ts";
import { Card } from "./card.tsx";
import { useWidgetEnv } from "./env.tsx";
import { COLUMN_WIDTH } from "./layout.ts";
import { useSource } from "./lib/data.ts";
import { foldLive, liveItems } from "./lib/live-fold.ts";
import { TimerFace } from "./lib/views/timer.tsx";
import { useCard } from "./look.tsx";
import { Btn, Grow, Head, Lab, Meta, NowTag, Num, Standby, Title, Words } from "./parts.tsx";
import type { HubRun } from "./types.ts";

const NO_RUNS: readonly HubRun[] = [];

function RunCard({ item, air }: { item: OnAirItem; air: boolean }) {
  const { hub, inks, now } = useWidgetEnv();
  const runs = useSource(hub?.runs, NO_RUNS);
  const run = runs.find((each) => `run:${each.id}` === item.key);
  const asking = item.reason === "asks" || item.key.startsWith("ask:");
  const minutes = run ? Math.max(0, Math.round((now - run.started) / 60_000)) : 0;
  const step = run?.steps.length ?? 0;
  const about = Math.max(step, run?.about ?? step + 1);
  return (
    <>
      <Head
        left={
          <View style={{ flexDirection: "row", gap: SPACE.m, alignItems: "center" }}>
            <Lab>{run?.harnessName ?? "Dashi"}</Lab>
            <Meta>{asking ? "asks you" : `running · ${minutes} min`}</Meta>
          </View>
        }
        right={air ? <NowTag tally={inks.tally} /> : <Standby />}
      />
      <View style={{ flexDirection: "row", gap: SPACE.button, marginTop: SPACE.m, alignItems: "center" }}>
        <Num value={asking ? "1" : String(step)} unit={asking ? "ask" : `/${about}`} size={34} />
        <View style={{ flex: 1, flexDirection: "column" }}>
          <Title>{asking ? item.label : run?.request.split("\n")[0] || item.label}</Title>
          <Words>{asking ? "It needs you before it goes on" : run?.said || "Working"}</Words>
        </View>
        {asking ? (
          <Btn label="Open" fill onPress={() => hub?.openAsk(item.key.slice(item.key.indexOf(":") + 1))} testID="live-open" />
        ) : (
          <Btn label="Stop" onPress={() => run && hub?.stopRun(run.id)} testID="live-stop" />
        )}
      </View>
    </>
  );
}

function PlainLive({ item, air }: { item: OnAirItem; air: boolean }) {
  const { inks } = useWidgetEnv();
  const now = useSecondTick(item.countdown !== undefined);
  return (
    <>
      <Head left={<Lab>{item.label}</Lab>} right={air ? <NowTag tally={inks.tally} /> : <Standby />} />
      <View style={{ height: 6 }} />
      <Title>{onAirWords(item, now)}</Title>
    </>
  );
}

function LiveCard({ item, air }: { item: OnAirItem; air: boolean }) {
  const { hub, inks, tally } = useWidgetEnv();
  const timers = useSource(hub?.timers, []);
  const timer = timers.find((each) => `timer:${each.id}` === item.key);
  const pin = () => systemTally().pin(tally.pinned === item.key ? null : item.key);
  return (
    <Card
      look={{ inks, ink: item.ink, air, houseDown: tally.houseDown && !air, redact: false }}
      width={COLUMN_WIDTH}
      compact
      padding={SPACE.inset}
      testID={`live:${item.key}`}
      onContext={pin}
    >
      {timer ? (
        <TimerFace timer={timer} size="wide" air={air} live />
      ) : item.key.startsWith("run:") || item.key.startsWith("ask:") ? (
        <RunCard item={item} air={air} />
      ) : (
        <PlainLive item={item} air={air} />
      )}
    </Card>
  );
}

function FoldRow({ items }: { items: readonly OnAirItem[] }) {
  const { inks, tally } = useWidgetEnv();
  return (
    <Card
      look={{ inks, ink: null, air: false, houseDown: tally.houseDown, redact: false }}
      width={COLUMN_WIDTH}
      height={44}
      compact
      padding={SPACE.inset}
      testID="live-fold"
    >
      <FoldInside items={items} />
    </Card>
  );
}

function FoldInside({ items }: { items: readonly OnAirItem[] }) {
  const c = useCard();
  const { inks, tally } = useWidgetEnv();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.m, flex: 1 }}>
      <Lab>{`${items.length} more live`}</Lab>
      <Grow />
      {items.map((item) => (
        <View key={item.key} style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xs }}>
          <Svg
            markup={glyph(isGlyphName(item.glyph) ? item.glyph : "spark")}
            size={12}
            color={item.ink ? (tally.houseDown ? inks.dimmed[item.ink] : inks.ink[item.ink]) : c.ink}
          />
          <Text numberOfLines={1} style={{ fontSize: TYPE.inks.body.size, color: c.ink }}>
            {item.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** The live cards, as many as the ceiling allows, and the fold. */
export function LiveCards() {
  const { tally, placedKinds } = useWidgetEnv();
  const { cards, folded } = foldLive(liveItems(tally, placedKinds));
  if (cards.length === 0) return null;
  return (
    <View style={{ flexDirection: "column", gap: SPACE.gap }}>
      {cards.map((item) => (
        <LiveCard key={item.key} item={item} air={tally.holder === item.key} />
      ))}
      {folded.length > 0 ? <FoldRow items={folded} /> : null}
    </View>
  );
}
