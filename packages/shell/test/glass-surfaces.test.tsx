/**
 * The launcher's family on Frost (y4c; design.html CO-11, CO-12, CP-11, NO-5, NO-6, GL-2; decisions.md D790 to
 * D799), on a host that says it takes glass: widgets and the area's cards are paper glass, a gallery preview is
 * paper's solid twin, banners and the capsule's card are regular glass, banners take their lane, newest on top.
 */

import { describe, expect, test } from "bun:test";
import { darkColors, Frosted, GLASS, inkTokens, lightColors } from "@dashi/ui";
import { type NativeEvent, render, View } from "@mirinjs/metal";
import type { ReactElement } from "react";
import { Card as CapsuleCard, cardRim, glassCardColours } from "../src/capsule/lib/card.tsx";
import { dashiColours } from "../src/capsule/lib/measures.ts";
import { BANNER, Banner } from "../src/notifications/lib/banner.tsx";
import { bannerLane } from "../src/notifications/lib/place.ts";
import { place } from "../src/notifications/stack.tsx";
import { NotificationStore } from "../src/notifications/store.ts";
import { DEFAULT_PERSONA, type PillAsk } from "../src/shared/pill/index.ts";
import { Card, COLUMN_WIDTH, Num } from "../src/widgets/index.ts";
import { EDIT_RING } from "../src/widgets/lib/edit-ring.ts";
import { fakeHost } from "./support/editor-view.ts";
import { settle } from "./support/time.ts";

/** The host says it takes glass (patches 0: the fake host keeps getting whole trees). */
const SAYS_GLASS = { type: "protocol", nodeId: "root", patches: 0, glass: true } as unknown as NativeEvent;

interface Node {
  props?: Record<string, unknown>;
  children?: Array<Node | string>;
}

function find(node: Node, id: string): Node | null {
  if (node.props?.id === id) return node;
  for (const child of node.children ?? []) {
    if (typeof child === "string") continue;
    const hit = find(child, id);
    if (hit) return hit;
  }
  return null;
}

/** Render on a host that takes glass; a node's props by testID. */
async function onGlass(element: ReactElement): Promise<(testID: string) => Record<string, unknown>> {
  const host = fakeHost();
  const root = render(element, host.transport);
  await settle();
  host.emit(SAYS_GLASS);
  await settle();
  const tree = JSON.parse(host.trees.at(-1) ?? "{}") as Node;
  return (testID) => find(tree, root.nodeId(testID) ?? "\u0000")?.props ?? {};
}

const inks = inkTokens("light");
const look = { inks, ink: "matcha" as const, air: false, houseDown: false, redact: false };

describe("widgets and the area's cards (CO-11, NO-5)", () => {
  test("a card is paper glass; inside the gallery's glass a preview is paper's solid twin (GL-2)", async () => {
    const props = await onGlass(
      <View>
        <Card look={look} width={172} height={172} testID="card">
          <Num value="86" size={64} />
        </Card>
        <Frosted level="regular" testID="gallery">
          <Card look={look} width={172} height={172} solid testID="preview">
            <Num value="86" size={64} />
          </Card>
        </Frosted>
      </View>,
    );
    expect(props("card")).toMatchObject({ material: "paper", cornerRadius: 18, background: GLASS.levels.paper.light.solid });
    expect(props("gallery").material).toBe("regular");
    expect(props("preview").material).toBeUndefined();
    expect(props("preview").background).toBe(GLASS.levels.paper.light.solid);
  });

  test("the lock's wash is not glass: its cards stay opaque paper with a hairline", async () => {
    const props = await onGlass(
      <Card look={{ ...look, glass: true }} width={172} height={172} testID="card">
        <Num value="86" size={64} />
      </Card>,
    );
    expect(props("card").material).toBeUndefined();
    expect(props("card").borderWidth).toBe(1);
  });

  test("the edit ring stands 3 out in 2 of ink, its corner the card's plus that", () => {
    expect(EDIT_RING).toMatchObject({ width: 2, out: 3 });
    expect(EDIT_RING.radius(false)).toBe(21);
    expect(EDIT_RING.radius(true)).toBe(17);
  });
});

describe("banners (NO-5, NO-6)", () => {
  test("a banner is regular glass, 356 wide, radius 18, shadow xl", async () => {
    const store = new NotificationStore({ schedule: () => () => {} });
    const id = store.notify({
      ...{ appName: "Mail", appIcon: "", summary: "Alex Kim", body: "Lunch at one?", actions: [], urgency: "normal" as const },
      ...{ expireTimeout: -1, imagePath: "", desktopEntry: "", category: "", transient: false, resident: false },
    });
    const props = await onGlass(<Banner store={store} id={id} />);
    expect(props("banner")).toMatchObject({ material: "regular", width: 356, cornerRadius: 18, shadow: "xl" });
  });

  test("under the pointer a solid ✕ shows at its corner, and a press on it dismisses it, never opens it", async () => {
    const store = new NotificationStore({ schedule: () => () => {} });
    const invoked: string[] = [];
    store.onEvent((event) => invoked.push(JSON.stringify(event)));
    const id = store.notify({
      ...{ appName: "Mail", appIcon: "", summary: "Alex Kim", body: "", actions: [{ key: "default", label: "" }], urgency: "normal" as const },
      ...{ expireTimeout: -1, imagePath: "", desktopEntry: "", category: "", transient: false, resident: false },
    });
    const host = fakeHost();
    const root = render(<Banner store={store} id={id} />, host.transport);
    await settle();
    expect(root.nodeId("banner-dismiss")).toBeUndefined();
    host.emit({ type: "hover", nodeId: root.nodeId("banner") ?? "", hovered: true });
    await settle();
    const dismiss = root.nodeId("banner-dismiss");
    expect(dismiss).toBeDefined();
    host.emit({ type: "press", nodeId: dismiss ?? "" });
    await settle();
    expect(store.getSnapshot().live.some((each) => each.id === id)).toBe(false);
    expect(invoked.some((event) => event.includes(`"type":"action"`))).toBe(false);
    root.unmount();
  });

  test("the lane: the column's own place at the edge, or left of the widget column, never over it", () => {
    const edge = bannerLane(false);
    const beside = bannerLane(true);
    expect(edge).toBe(16);
    // Its right edge clears the column's left edge by the lane's gap.
    expect(beside - (edge + COLUMN_WIDTH)).toBe(12);
    expect(BANNER.width).toBe(GLASS.banner.width);
  });

  test("newest on top, 8 apart", () => {
    const banners = [1, 2, 3].map((id) => ({ id, body: "", actions: [] }));
    const placed = new Map(place(banners).map((each) => [each.id, each]));
    expect(placed.get(3)?.top).toBe(0);
    const newest = placed.get(3);
    const next = placed.get(2);
    expect(next?.top).toBe((newest?.top ?? 0) + (newest?.height ?? 0) + GLASS.banner.gap);
    expect(placed.get(1)?.top).toBeGreaterThan(next?.top ?? 0);
  });
});

describe("the capsule's card (CP-11)", () => {
  const ask: PillAsk = { kind: "permission", id: "t", task: "t", request: "Send this reply to Alex Kim as you?", steps: [], spoken: true, since: 0 };
  const card = (keyboard: boolean) => (
    <CapsuleCard
      card={{ what: { ask }, keyboard, armsAt: 0, from: 0, hears: false }}
      colours={dashiColours(DEFAULT_PERSONA.colour)}
      personaColour={DEFAULT_PERSONA.colour}
      name="Dashi"
      talkKey={null}
      listening={null}
      level={{ subscribe: () => () => {}, getSnapshot: () => 0 }}
      still
      now={() => 0}
      onAnswer={() => {}}
    />
  );

  test("regular glass at 17.5, the persona's colour as its 1.5 rim; under the keyboard the 3-point purple rim", async () => {
    const rest = await onGlass(card(false));
    expect(rest("card-glass")).toMatchObject({ material: "regular", cornerRadius: 17.5, borderWidth: 1.5, borderColor: DEFAULT_PERSONA.colour });
    const keys = await onGlass(card(true));
    expect(keys("card-glass")).toMatchObject({ borderWidth: 3, borderColor: lightColors.focusRing });
    expect(cardRim(true, DEFAULT_PERSONA.colour, darkColors.focusRing).borderColor).toBe(darkColors.focusRing);
  });

  test("its words are the glass's inks, its yes filled in ink, its choices on a fill", () => {
    const glass = glassCardColours(lightColors, dashiColours(DEFAULT_PERSONA.colour));
    expect(glass).toMatchObject({ text: lightColors.text, soft: lightColors.textMuted, primary: lightColors.primary, fill: lightColors.tile });
  });
});
