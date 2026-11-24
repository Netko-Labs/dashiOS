// The kit's tinted looks (UI-8, UI-18, TK-2): the inks Button and GlyphButton in a card's own colours, the capsule's
// Button in the persona's, and the menu bar's item; each named for screen readers, a Tab stop where it is a control.
import { expect, test } from "bun:test";
import { View } from "@mirinjs/metal";
import { BAR_ITEM, BarItem } from "../src/bar-item.tsx";
import { Button } from "../src/button.tsx";
import { BUTTON, type ButtonInks } from "../src/button-measures.ts";
import { GLYPH_BUTTON, GlyphButton } from "../src/glyph-button.tsx";
import { SQUARE } from "../src/glyphs.ts";
import { lightColors } from "../src/theme/palette.ts";
import { noop } from "./support/controls-view.ts";
import { fakeClockEachTest } from "./support/time.ts";
import { sent } from "./support/tree.ts";

fakeClockEachTest();

const card: ButtonInks = { ink: "#112233", ground: "#fafafa", edge: "#11223333", fill: "#2266aa", onFill: "#ffffff", soft: "#11223399" };

test("the inks look takes the card's colours: a hairline pill at rest, the card's fill for the one that goes ahead", async () => {
  const { node, root } = await sent(
    <View>
      <Button testID="stop" label="Stop" look="inks" size="small" inks={card} onPress={noop} />
      <Button testID="open" label="Open" look="inks" size="small" primary inks={card} onPress={noop} />
      <GlyphButton testID="next" glyph={SQUARE} label="Next" look="inks" inks={card} onPress={noop} />
      <GlyphButton testID="play" glyph={SQUARE} label="Play" look="inks" inks={card} filled wide onPress={noop} />
    </View>,
  );
  expect(node("stop")?.props).toMatchObject({
    height: BUTTON.inks.smallHeight,
    background: card.ground,
    borderColor: card.edge,
    access: { role: "button", label: "Stop" },
  });
  expect(node("open")?.props).toMatchObject({ background: card.fill, focusable: true });
  expect(node("next")?.props).toMatchObject({ width: GLYPH_BUTTON.inks.target, borderColor: card.edge, access: { label: "Next" } });
  expect(node("play")?.props).toMatchObject({ width: 2 * GLYPH_BUTTON.inks.target, background: card.fill });
  root.unmount();
});

test("the capsule look is outlined in the persona's words, the yes filled, never the app's palette", async () => {
  const persona: ButtonInks = { ink: "#ffffff", ground: "#4a33b0", edge: "#ffffff40", fill: "#ffffff", onFill: "#4a33b0" };
  const { node, root } = await sent(
    <View>
      <Button testID="cancel" label="Cancel" look="capsule" size="small" inks={persona} onPress={noop} />
      <Button testID="always" label="Always" look="capsule" primary inks={persona} onPress={noop} />
      <Button testID="done" label="Done" look="capsule" size="small" glyph={SQUARE} inks={persona} disabled onPress={noop} />
    </View>,
  );
  expect(node("cancel")?.props).toMatchObject({ height: BUTTON.capsule.smallHeight, borderColor: persona.ink, access: { role: "button", label: "Cancel" } });
  expect(node("always")?.props).toMatchObject({ height: BUTTON.capsule.height, background: persona.fill });
  expect(node("always")?.props.background).not.toBe(lightColors.primary);
  expect(node("done")?.props).toMatchObject({ opacity: 0.4 });
  root.unmount();
});

test("a bar item is a named 22 pill in its tone's wash", async () => {
  const { node, root } = await sent(
    <View>
      <BarItem testID="alone" label="Agents work alone, 4:12 left. Stop" tone="agent" onPress={noop}>
        <View />
      </BarItem>
    </View>,
  );
  expect(node("alone")?.props).toMatchObject({ height: BAR_ITEM.height, cornerRadius: BAR_ITEM.height / 2, background: lightColors.agentWash });
  expect(node("alone")?.props).toMatchObject({ access: { role: "button", label: "Agents work alone, 4:12 left. Stop" } });
  root.unmount();
});
