/**
 * The This Computer widget on a machine with no battery: its one line whole,
 * never "No battery: it runs on t…" (the installed pass, 22-fix-installed).
 */

import { expect, test } from "bun:test";
import { inkTokens } from "@dashi/ui";
import { type NativeTransport, render } from "@mirinjs/metal";
import { Card, WidgetEnvProvider, type WidgetHub } from "../src/widgets/index.ts";
import { BatteryWidget } from "../src/widgets/lib/views/simple.tsx";
import { settle } from "./support/time.ts";

const NO_BATTERY = { battery: null };
const QUIET = { holder: null, item: null, standby: [], houseDown: false, pinned: null };

async function tree(size: "compact" | "small"): Promise<string> {
  const trees: string[] = [];
  const transport: NativeTransport = { send: (sent) => trees.push(sent), onEvent() {}, onClose() {}, simulate() {}, close() {} };
  const system = { subscribe: () => () => {}, getSnapshot: () => NO_BATTERY };
  const inks = inkTokens("light");
  const env = { hub: { system } as unknown as WidgetHub, now: 0, hour24: true, tally: QUIET, inks, locked: false, placedKinds: [], open() {} };
  const root = render(
    <WidgetEnvProvider value={env}>
      <Card
        look={{ inks, ink: "matcha", air: false, houseDown: false, redact: false }}
        width={172}
        height={size === "compact" ? 80 : 172}
        compact={size === "compact"}
      >
        <BatteryWidget size={size} />
      </Card>
    </WidgetEnvProvider>,
    transport,
  );
  await settle();
  root.unmount();
  return trees.at(-1) ?? "";
}

/** The text node that says `words`, as sent. */
const textOf = (shown: string, words: string): string => {
  const at = shown.indexOf(`[${JSON.stringify(words)}]`);
  return shown.slice(shown.lastIndexOf('{"type":"text"', at), at);
};

test("at Small the line is whole: it wraps (two lines) instead of being cut on one", async () => {
  const shown = await tree("small");
  const node = textOf(shown, "No battery: it runs on the wall.");
  expect(node).toContain('"type":"text"');
  expect(node).not.toContain('"truncate":true');
});

test("at Compact it says the short form on one line", async () => {
  const shown = await tree("compact");
  expect(shown).toContain('"No battery"');
  expect(shown).not.toContain("…");
});
