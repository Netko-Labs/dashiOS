/**
 * How a card is printed (round five): private nodes are blanks while
 * locked; the card on air floods with its ink inside a ring of the tally's
 * colour; house lights dim every ink but the holder's; an extension's widget
 * prints in plain ink whatever its tree says.
 */

import { describe, expect, test } from "bun:test";
import type { ViewNode } from "@dashi/applet";
import { inkTokens } from "@dashi/ui";
import { type NativeTransport, render } from "@mirinjs/metal";
import { Card, type CardLook, Num, Private, Title } from "../src/widgets/index.ts";
import { ExtensionView } from "../src/widgets/lib/views/extension.tsx";
import { settle } from "./support/time.ts";

function host() {
  const trees: string[] = [];
  const transport: NativeTransport = { send: (tree) => trees.push(tree), onEvent() {}, onClose() {}, simulate() {}, close() {} };
  return { trees, transport };
}

const inks = inkTokens("light");
const look = (extra: Partial<CardLook> = {}): CardLook => ({ inks, ink: "miso", air: false, houseDown: false, redact: false, ...extra });

async function print(node: React.ReactNode): Promise<string> {
  const { trees, transport } = host();
  const root = render(node, transport);
  await settle();
  root.unmount();
  return trees.at(-1) ?? "";
}

describe("a widget's print", () => {
  const event = (redact: boolean) => (
    <Card look={look({ redact })} width={172} height={172}>
      <Private what="Event" width={110}>
        <Title>Design review</Title>
      </Private>
      <Num value="15" size={76} />
    </Card>
  );

  test("private words are drawn unlocked, and a labelled blank on the lock screen", async () => {
    expect(await print(event(false))).toContain("Design review");
    const locked = await print(event(true));
    expect(locked).not.toContain("Design review");
    expect(locked).toContain("EVENT");
    // The number is not private: it stays.
    expect(locked).toContain('"15"');
  });

  test("at rest the number is printed in its ink on paper", async () => {
    const tree = (await print(event(false))).toLowerCase();
    expect(tree).toContain(inks.ink.miso.toLowerCase());
    expect(tree).toContain(inks.paper.toLowerCase());
    expect(tree).not.toContain(inks.tally.toLowerCase());
  });

  test("on air it floods: the ink is the paper, a ring of the tally's colour goes round it", async () => {
    const tree = (
      await print(
        <Card look={look({ air: true })} width={172} height={172}>
          <Num value="3" size={64} />
        </Card>,
      )
    ).toLowerCase();
    expect(tree).toContain(inks.tally.toLowerCase());
    expect(tree).toContain(`"background":"${inks.ink.miso.toLowerCase()}`);
    expect(tree).toContain(inks.onInk.toLowerCase());
  });

  test("house lights dim the inks of every card but the holder's", async () => {
    const tree = (
      await print(
        <Card look={look({ houseDown: true })} width={172} height={172}>
          <Num value="19" size={76} />
        </Card>,
      )
    ).toLowerCase();
    expect(tree).toContain(inks.dimmed.miso.toLowerCase());
    expect(tree).not.toContain(inks.ink.miso.toLowerCase());
  });

  test("an extension prints in plain ink, and its private text is a blank while locked", async () => {
    const tree: ViewNode = {
      t: "Widget",
      i: "w",
      p: { title: "Lights" },
      c: [
        { t: "Value", i: "v", p: { text: "2", unit: "/3" }, c: [] },
        { t: "Text", i: "t", p: { text: "Kitchen is on", private: true }, c: [] },
      ],
    };
    const widget = {
      info: { kind: "ext:x/y" as const, name: "Lights", ink: null, glyph: "puzzle" as const, sizes: ["small" as const], holdsPrivate: true, blurb: "" },
      appletId: "x",
      widgetId: "y",
      tree,
    };
    const open = (
      await print(
        <Card look={look({ ink: null })} width={172} height={172}>
          <ExtensionView widget={widget} />
        </Card>,
      )
    ).toLowerCase();
    expect(open).toContain("kitchen is on");
    expect(open).not.toContain(inks.ink.miso.toLowerCase());
    const locked = await print(
      <Card look={look({ ink: null, redact: true })} width={172} height={172}>
        <ExtensionView widget={widget} />
      </Card>,
    );
    expect(locked).not.toContain("Kitchen is on");
  });
});
