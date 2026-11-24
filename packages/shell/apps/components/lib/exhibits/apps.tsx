/** The gallery's page for the pieces the apps edit and type with: words edited in place, title tabs, keypad keys (0.10). */

import { EditableText, KeypadKey, SPACE, TitleTab, TitleTabMore, TYPE, useColors } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { useState } from "react";
import { Exhibit, PageBody } from "../specimen.tsx";

const noop = (): void => {};
const KEY_SIDE = 54;
const KEY_FONT = TYPE.title.size;
const TABS_WIDTH = 420;
const MORE_WIDTH = 44;
const PAGE_HEIGHT = 72;

export function AppsPage() {
  const colors = useColors();
  const [page, setPage] = useState("Dear Alex,\nThe report is attached.");
  const [name, setName] = useState("Report.pdf");
  const [front, setFront] = useState(0);
  const tabs = ["~/Developer", "htop", "ssh build"];
  return (
    <PageBody>
      <Exhibit
        title="Words edited in place"
        note="A document's text, a note's title, Calculator's line: no ground, no edge. A rename in place: the card's ground inside the ring's edge."
      >
        <View style={{ flexDirection: "column", gap: SPACE.m }}>
          <EditableText
            testID="editable:plain"
            value={page}
            onChangeText={setPage}
            multiline
            style={{ height: PAGE_HEIGHT, fontSize: TYPE.body.size, color: colors.text }}
          />
          <EditableText testID="editable:inline" look="inline" value={name} onChangeText={setName} style={{ width: 160 }} />
        </View>
      </Exhibit>
      <Exhibit
        title="Title tabs"
        note="Tabs in the title row (VS-4): the front one washed in semibold, × on the left, the attention dot on the right; the rest fold into a count."
      >
        <View style={{ width: TABS_WIDTH, flexDirection: "row", gap: SPACE.xs }}>
          {tabs.map((label, index) => (
            <TitleTab
              key={label}
              testID={`tab:${index}`}
              label={label}
              front={index === front}
              rang={index === 2}
              onPress={() => setFront(index)}
              onClose={noop}
            />
          ))}
          <TitleTabMore testID="tab:more" hidden={2} rang={false} width={MORE_WIDTH} onPress={noop} />
        </View>
      </Exhibit>
      <Exhibit
        title="Keypad keys"
        note="Calculator's keys: a digit on the card, a function on the quiet wash, = in ink; held or typed, they deepen. Labels are 400."
      >
        <View style={{ flexDirection: "row", gap: SPACE.gap }}>
          {(
            [
              ["7", "digit"],
              ["%", "quiet"],
              ["÷", "quiet"],
              ["=", "strong"],
            ] as const
          ).map(([label, tone]) => (
            <View key={label} style={{ width: KEY_SIDE, height: KEY_SIDE, display: "grid", gridTemplateColumns: [KEY_SIDE], gridTemplateRows: [KEY_SIDE] }}>
              <KeypadKey testID={`key:${label}`} label={label} tone={tone} fontSize={KEY_FONT} onPress={noop} />
            </View>
          ))}
        </View>
      </Exhibit>
    </PageBody>
  );
}
