/**
 * The Timer's quick start at Compact (one row of cells): "Start one" sits in
 * the head, beside "Timer", not on a line of its own that the buttons cover.
 */

import { expect, test } from "bun:test";
import { inkTokens } from "@dashi/ui";
import { type NativeTransport, render } from "@mirinjs/metal";
import { Card, WidgetEnvProvider, type WidgetHub } from "../src/widgets/index.ts";
import { TimerWidget } from "../src/widgets/lib/views/timer.tsx";
import { settle } from "./support/time.ts";

const NONE: never[] = [];
const QUIET = { holder: null, item: null, standby: [], houseDown: false, pinned: null };

async function tree(size: "compact" | "small"): Promise<string> {
  const trees: string[] = [];
  const transport: NativeTransport = { send: (sent) => trees.push(sent), onEvent() {}, onClose() {}, simulate() {}, close() {} };
  const timers = { subscribe: () => () => {}, getSnapshot: () => NONE, start() {} };
  const inks = inkTokens("light");
  const env = { hub: { timers } as unknown as WidgetHub, now: 0, hour24: true, tally: QUIET, inks, locked: false, placedKinds: [], open() {} };
  const root = render(
    <WidgetEnvProvider value={env}>
      <Card
        look={{ inks, ink: "wakame", air: false, houseDown: false, redact: false }}
        width={172}
        height={size === "compact" ? 80 : 172}
        compact={size === "compact"}
      >
        <TimerWidget size={size} />
      </Card>
    </WidgetEnvProvider>,
    transport,
  );
  await settle();
  root.unmount();
  return trees.at(-1) ?? "";
}

/** The head row: the one 14 tall, up to the room that grows under it. */
function headOf(tree: string): string {
  const start = tree.indexOf('"height":14');
  return tree.slice(start, tree.indexOf('"flex":1', start));
}

test('at Compact, "Start one" is in the head with "Timer", and two quick starts under it', async () => {
  const shown = await tree("compact");
  expect(shown.split('"Start one"')).toHaveLength(2);
  const head = headOf(shown);
  expect(head).toContain('"TIMER"');
  expect(head).toContain('"Start one"');
  expect(shown).toContain('"3 min"');
  expect(shown).toContain('"5 min"');
  expect(shown).not.toContain('"10 min"');
});

test('at Small, "Start one" keeps its own line over four quick starts', async () => {
  const shown = await tree("small");
  expect(headOf(shown)).not.toContain('"Start one"');
  expect(shown).toContain('"Start one"');
  for (const minutes of [3, 5, 10, 25]) expect(shown).toContain(`"${minutes} min"`);
});
