/**
 * Pass 53 and 54's small things (D500): Music at Small names its player and
 * wears "Now" on air; music on air has words in the bar, not a bare dot; the
 * chosen card's tag sits across its bottom edge at every size and is never
 * cut; the lock's compact "Next" blank keeps inside its card.
 */

import { describe, expect, test } from "bun:test";
import { inkTokens } from "@dashi/ui";
import { type NativeTransport, render } from "@mirinjs/metal";
import { tallySlots } from "../src/menubar/lib/menubar-tally-slots.tsx";
import { textWidth } from "../src/shared/file-browser/tile-name.ts";
import type { TallyView } from "../src/tally/index.ts";
import { fittedTag, TAG } from "../src/widgets/edit.tsx";
import { Blank, Card, DASHI_WIDGETS, WidgetEnvProvider, type WidgetHub } from "../src/widgets/index.ts";
import { MEDIA_LABEL_MAX, mediaOnAir } from "../src/widgets/lib/on-air.ts";
import type { Playing } from "../src/widgets/lib/sources/media.ts";
import { MediaWidget } from "../src/widgets/lib/views/media.tsx";
import { settle } from "./support/time.ts";

const song: Playing = {
  player: "org.mpris.MediaPlayer2.chromium.instance425968",
  name: "Helium",
  title: "Slow Tide",
  artist: "Harbour Lights",
  playing: false,
  length: 0,
  position: 0,
  positionAt: 0,
  art: "",
  since: 0,
};

const QUIET: TallyView = { holder: null, item: null, standby: [], houseDown: false, pinned: null };

async function print(node: React.ReactNode): Promise<string> {
  const trees: string[] = [];
  const transport: NativeTransport = { send: (tree) => trees.push(tree), onEvent() {}, onClose() {}, simulate() {}, close() {} };
  const root = render(node, transport);
  await settle();
  root.unmount();
  return trees.at(-1) ?? "";
}

function music(size: "small" | "wide", air: boolean): React.ReactNode {
  const media = { subscribe: () => () => {}, getSnapshot: () => song, command: async () => {} };
  const inks = inkTokens("light");
  const env = { hub: { media } as unknown as WidgetHub, now: 0, hour24: true, tally: QUIET, inks, locked: false, placedKinds: [], open() {} };
  return (
    <WidgetEnvProvider value={env}>
      <Card look={{ inks, ink: "album", air, houseDown: false, redact: false }} width={size === "small" ? 172 : 356} height={172}>
        <MediaWidget size={size} air={air} />
      </Card>
    </WidgetEnvProvider>
  );
}

describe("Music on air", () => {
  test("at Small, the player's name and the Now tag; off air, the card as drawn (no header)", async () => {
    const onAir = await print(music("small", true));
    expect(onAir).toContain('"HELIUM"');
    expect(onAir).toContain(`"Now"`);
    const quiet = await print(music("small", false));
    expect(quiet).not.toContain(`"Now"`);
    expect(quiet).not.toContain('"HELIUM"');
  });

  test("at Wide, the player's name stays beside the Now tag", async () => {
    const onAir = await print(music("wide", true));
    expect(onAir).toContain('"MUSIC · HELIUM"');
    expect(onAir).toContain(`"Now"`);
  });

  test("the bar has a capsule with the track's words, never a bare dot by the clock", () => {
    const item = mediaOnAir({ ...song, playing: true })[0] ?? null;
    const slots = tallySlots({ ...QUIET, holder: item?.key ?? null, item }, "#D9471B", () => {});
    expect(slots.map((slot) => slot.key)).toEqual(["tally-holder"]);
    expect(slots[0]?.label).toBe("On air: Slow Tide");
  });

  test("a long title is cut so the capsule never pushes the bar's items off", () => {
    const [item] = mediaOnAir({ ...song, playing: true, title: "A Very Long Song Title That Goes On and On" });
    expect(item?.label.length).toBeLessThanOrEqual(MEDIA_LABEL_MAX);
    expect(item?.label.endsWith("…")).toBe(true);
    expect(mediaOnAir({ ...song, playing: true, title: " " })[0]?.label).toBe("Helium");
  });
});

describe("the chosen card's tag", () => {
  const weather = DASHI_WIDGETS.find((info) => info.kind === "weather") ?? null;
  const rundown = DASHI_WIDGETS.find((info) => info.kind === "rundown") ?? null;
  const fits = (words: string, width: number) => textWidth(words) * TAG.fontSize * 1.1 <= width - TAG.left - TAG.right - 2 * TAG.padding;

  test("sits across the bottom edge at every size, so a Large card's last line stays clear", () => {
    expect(TAG.below).toBeLessThan(0);
    expect(TAG.height / 2 + TAG.below).toBeLessThanOrEqual(0);
  });

  test("is never cut: the fullest words that fit the card, whole", () => {
    expect(fittedTag(rundown, null, "large", 356)).toBe("Rundown · Large");
    expect(fittedTag(weather, null, "wide", 356)).toBe("Weather · mizu · Wide");
    for (const [from, to] of [
      [null, "compact"],
      ["small", "compact"],
      ["compact", "small"],
      [null, "small"],
    ] as const) {
      const width = to === "compact" || to === "small" ? 172 : 356;
      const words = fittedTag(weather, from, to, width);
      expect(fits(words, width)).toBe(true);
      expect(words).toContain(to.charAt(0).toUpperCase() + to.slice(1));
    }
    expect(fittedTag(weather, null, "compact", 172)).toBe("Weather · Compact");
  });
});

describe("a blank that fills its row", () => {
  test("its line takes what is left of the row, not a fixed width, and stops short of the lock", async () => {
    const inks = inkTokens("dark");
    const tree = await print(
      <Card look={{ inks, ink: "miso", air: false, houseDown: false, redact: true }} width={172} height={80}>
        <Blank what="Event" width="fill" />
      </Card>,
    );
    expect(tree).toContain('"EVENT"');
    expect(tree).toContain('"height":1,"minWidth":12,"flex":1');
    expect(tree).not.toContain('"width":48');
    // It ends before the corner lock: 12 in + 11 wide + 4 apart, less the card's 14 of padding.
    expect(tree).toContain('"marginRight":13');
  });
});
