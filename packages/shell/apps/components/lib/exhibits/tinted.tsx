/** The gallery's tinted looks (UI-8, UI-18, TK-2): the widget area's buttons in a card's colours, the capsule's in a persona's, and the menu bar's item. */

import { BarItem, Button, type ButtonInks, CAPSULE, GlyphButton, inksButtonColors, SPACE, SQUARE, TYPE, useColors, useDark, WEIGHT } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { Exhibit, PageBody } from "../specimen.tsx";

const noop = (): void => {};

/** Dashi's capsule's colours: white words on its fill (pill-v2). */
const DASHI: ButtonInks = {
  ink: CAPSULE.white,
  ground: CAPSULE.dashiFill,
  edge: CAPSULE.softOnFill,
  fill: CAPSULE.white,
  onFill: CAPSULE.dashiFill,
  soft: CAPSULE.softOnFill,
};

/** A card's paper under the inks buttons, in the column's mode. */
function InksRow() {
  const card = inksButtonColors(useDark());
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.m, padding: SPACE.inset, backgroundColor: card.ground }}>
      <Button testID="tinted:inks:stop" label="Stop" look="inks" size="small" onPress={noop} />
      <Button testID="tinted:inks:open" label="Open" look="inks" size="small" primary onPress={noop} />
      <Button testID="tinted:inks:edit" label="Edit widgets" look="inks" onPress={noop} />
      <GlyphButton testID="tinted:inks:next" glyph={SQUARE} label="Stop" look="inks" onPress={noop} />
      <GlyphButton testID="tinted:inks:play" glyph={SQUARE} label="Play" look="inks" filled wide onPress={noop} />
    </View>
  );
}

/** The menu bar's ground under two bar items, in the column's mode. */
function BarRow() {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.m, padding: SPACE.inset, backgroundColor: colors.menuBar }}>
      <BarItem testID="tinted:bar:alone" label="Agents work alone, 59:12 left. Stop" tone="agent" onPress={noop}>
        <Svg markup={SQUARE} size={SPACE.m} color={colors.agent} />
        <Text style={{ fontSize: TYPE.secondary.size, fontWeight: WEIGHT.semibold, color: colors.agentInk }}>59:12</Text>
      </BarItem>
      <BarItem testID="tinted:bar:recording" label="Recording, 0:42. Stop" tone="capture" onPress={noop}>
        <Svg markup={SQUARE} size={SPACE.m} color={colors.critical} />
        <Text style={{ fontSize: TYPE.secondary.size, fontWeight: WEIGHT.semibold, color: colors.text }}>0:42</Text>
      </BarItem>
    </View>
  );
}

export function TintedPage() {
  return (
    <PageBody>
      <Exhibit
        title="The inks look"
        note="A widget's buttons in its card's colours: a hairline pill, the one that goes ahead in the card's fill; round ones 30, a player's ▶ 60 wide. Never the accent."
      >
        <InksRow />
      </Exhibit>
      <Exhibit
        title="The capsule look"
        note="The capsule's and its card's buttons in the persona's colours: outlined in its words, the yes filled, keys after the words."
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.m, padding: SPACE.inset, backgroundColor: DASHI.ground }}>
          <Button testID="tinted:capsule:cancel" label="Cancel" look="capsule" size="small" inks={DASHI} onPress={noop} />
          <Button testID="tinted:capsule:done" label="Done" look="capsule" size="small" glyph={SQUARE} keys="⌃❖Space" inks={DASHI} onPress={noop} />
          <Button testID="tinted:capsule:always" label="Always" look="capsule" primary inks={DASHI} onPress={noop} />
        </View>
      </Exhibit>
      <Exhibit title="Bar item" note="A pill of the menu bar's own row that a press acts on: agents working alone, Dashi's voice, a recording's stop.">
        <BarRow />
      </Exhibit>
    </PageBody>
  );
}
