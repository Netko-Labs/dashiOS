/** Agents (shiso): what Dashi and your agents do, the step it is on of about how many, and Stop. A critical question floods it. */

import { View } from "@mirinjs/metal";
import { DotRow } from "../../../shared/inks/index.ts";
import { useWidgetEnv } from "../../env.tsx";
import { useCard } from "../../look.tsx";
import { Grow, Head, Lab, Meta, NowTag, Num, Private, Title, Words } from "../../parts.tsx";
import type { HubRun, WidgetSize } from "../../types.ts";
import { useSource } from "../data.ts";

const NO_RUNS: readonly HubRun[] = [];

export function AgentsWidget({ size }: { size: WidgetSize }) {
  const { hub, tally, inks, now } = useWidgetEnv();
  const c = useCard();
  const runs = useSource(hub?.runs, NO_RUNS);
  const working = runs.filter((run) => run.ended === null);
  const run = working[0] ?? null;
  if (!run)
    return (
      <>
        <Head left={<Lab>Agents</Lab>} right={<Meta>{runs.length > 0 ? `${runs.length} today` : ""}</Meta>} />
        <Grow />
        <Num value="0" size={size === "wide" ? 64 : 76} />
        <Words>Nothing running</Words>
      </>
    );
  const step = run.steps.length;
  const about = Math.max(step, run.about ?? step + 1);
  const air = tally.holder === `run:${run.id}`;
  const minutes = Math.max(0, Math.round((now - run.started) / 60_000));
  return (
    <>
      <Head left={<Lab>{run.harnessName}</Lab>} right={air ? <NowTag tally={inks.tally} /> : <Meta>{`running · ${minutes} min`}</Meta>} />
      <View style={{ flexDirection: size === "wide" ? "row" : "column", gap: size === "wide" ? 14 : 4, marginTop: 12 }}>
        <Num value={run.question ? "1" : String(step)} unit={run.question ? "ask" : `/${about}`} size={64} />
        <View style={{ flex: 1, flexDirection: "column", marginTop: 4 }}>
          <Private what="Task" width={110}>
            <Title>{run.question ? run.question.title : run.request.split("\n")[0] || "A task"}</Title>
          </Private>
          {size === "wide" ? (
            <Private what="" width={140}>
              <Words>{run.said}</Words>
            </Private>
          ) : null}
        </View>
      </View>
      <Grow />
      <DotRow count={Math.min(12, about)} value={step / about} pitch={12} radius={0.3} lit={c.value} unlit={c.off} />
      {working.length > 1 ? <Meta>{`and ${working.length - 1} more`}</Meta> : null}
    </>
  );
}
