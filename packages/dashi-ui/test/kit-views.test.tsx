// The kit's views (PA-5 to PA-7, PA-17, UI-13 to UI-15, LA-5, VS-8): error, empty and no-results
// states, the form sheet, the pick row, the month grid, the sidebar's rail and the title's slot.
import { describe, expect, test } from "bun:test";
import { View } from "@mirinjs/metal";
import { EmptyState, NoResults, noResultsMessage } from "../src/empty-state.tsx";
import { ErrorState } from "../src/error-state.tsx";
import { FormSheet } from "../src/form-sheet.tsx";
import { SEARCH } from "../src/glyphs.ts";
import { MonthGrid } from "../src/month-grid.tsx";
import { addMonths, dayKey, monthWeeks, weekdayLetters } from "../src/month-math.ts";
import { PICK_ROW, PickList, PickRow } from "../src/pick-row.tsx";
import { PICTURE_CHOICE, PictureChoice, pictureRingRadius } from "../src/picture-choice.tsx";
import { railTip, SidebarItem } from "../src/sidebar.tsx";
import { controlPalette } from "../src/theme/controls.ts";
import { lightColors } from "../src/theme/palette.ts";
import { AppWindow } from "../src/window.tsx";
import { placeOf } from "../src/window-title.tsx";
import { noop, windowKey } from "./support/controls-view.ts";
import { fakeClockEachTest } from "./support/time.ts";
import { sent, words } from "./support/tree.ts";

fakeClockEachTest();

test("ErrorState: ume for what failed, broth for offline; a sentence, a message, its ways on", async () => {
  const { node, json, root } = await sent(
    <View>
      <ErrorState testID="failed" title="Couldn’t open “Report.pdf”." message="It may have moved." />
      <ErrorState testID="offline" kind="offline" title="You’re offline." />
    </View>,
  );
  expect(node("failed")?.props.access).toMatchObject({ role: "alert" });
  expect(words(node("failed"))).toEqual(["Couldn’t open “Report.pdf”.", "It may have moved."]);
  expect(json()).toContain(`"color":"${lightColors.ume}"`);
  expect(json()).toContain(`"color":"${lightColors.broth}"`);
  root.unmount();
});

test("EmptyState: a pane's in 15, a panel's one 12 line; no results says what didn't match", async () => {
  expect(noResultsMessage("  milk ")).toBe("Nothing matches “milk”.");
  const { node, root } = await sent(
    <View>
      <EmptyState testID="pane" glyph={SEARCH} title="No notes yet" message="Press ❖N to add one." />
      <EmptyState testID="panel" variant="panel" title="No notifications" />
      <NoResults testID="none" query="milk" hint="Try fewer words." />
    </View>,
  );
  expect(words(node("pane"))).toEqual(["No notes yet", "Press ❖N to add one."]);
  expect(words(node("panel"))).toEqual(["No notifications"]);
  expect(words(node("none"))).toEqual(["No results", "Nothing matches “milk”. Try fewer words."]);
  root.unmount();
});

test("FormSheet: a 13 Bold heading on one line, its buttons at the end; Esc cancels, Enter goes ahead", async () => {
  const pressed: string[] = [];
  const { node, host, root } = await sent(
    <FormSheet
      testID="go"
      title="Go to line"
      buttons={[
        { label: "Cancel", testID: "go:cancel", cancel: true, onPress: () => pressed.push("cancel") },
        { label: "Go", testID: "go:ok", kind: "primary", onPress: () => pressed.push("go") },
      ]}
    >
      <View />
    </FormSheet>,
  );
  expect(words(node("go:title"))).toEqual(["Go to line"]);
  expect(JSON.stringify(node("go:title"))).toContain('"bold"');
  host.emit(windowKey(root.nodeId("go:keys") ?? "", "escape"));
  host.emit(windowKey(root.nodeId("go:keys") ?? "", "enter"));
  expect(pressed).toEqual(["cancel", "go"]);
  root.unmount();
});

test("PickRow: 30 tall at radius 7, chosen in the selection look, its detail said with its name", async () => {
  const { node, root } = await sent(
    <PickList testID="apps">
      <PickRow testID="preview" label="Preview" detail="Default" chosen onPress={noop} />
      <PickRow testID="editor" label="Text Editor" chosen={false} onPress={noop} />
    </PickList>,
  );
  expect(node("apps")?.props).toMatchObject({ focusGroup: true, selectsOnFocus: true });
  expect(node("preview")?.props).toMatchObject({ height: PICK_ROW.height, cornerRadius: 7, background: lightColors.selectionWash });
  expect(node("preview")?.props.access).toMatchObject({ role: "option", label: "Preview, Default", selected: true });
  root.unmount();
});

test("PictureChoice: one concentric ring, the on colour or ink, an option named by its caption", async () => {
  expect(pictureRingRadius(14, 8)).toBe(14 + 8 + PICTURE_CHOICE.ring);
  const { node, root } = await sent(
    <View>
      <PictureChoice testID="dusk" label="Dusk" caption="Dusk" chosen radius={6} onPress={noop}>
        <View style={{ width: 40, height: 20 }} />
      </PictureChoice>
      <PictureChoice testID="ink" label="Ume" chosen ring="ink" radius={17} onPress={noop}>
        <View style={{ width: 34, height: 34 }} />
      </PictureChoice>
      <PictureChoice testID="dawn" label="Dawn" chosen={false} radius={6} onPress={noop}>
        <View style={{ width: 40, height: 20 }} />
      </PictureChoice>
    </View>,
  );
  expect(node("dusk")?.props.access).toMatchObject({ role: "option", label: "Dusk", selected: true });
  expect(node("dawn")?.props.access).toMatchObject({ selected: false });
  expect(node("dusk:ring")?.props).toMatchObject({ cornerRadius: pictureRingRadius(6), borderWidth: PICTURE_CHOICE.ring });
  expect(words(node("dusk"))).toEqual(["Dusk"]);
  expect(node("dusk:ring")?.props.borderColor).toBe(controlPalette(false).on);
  expect(node("ink:ring")?.props.borderColor).toBe(controlPalette(false).text);
  root.unmount();
});

describe("MonthGrid", () => {
  test("weeks from the region's first day, the days around the month sunk", () => {
    // November 2026 starts on a Sunday.
    const sunday = monthWeeks(2026, 10, 0);
    expect(sunday[0]?.[0]).toMatchObject({ month: 10, date: 1, inMonth: true });
    const monday = monthWeeks(2026, 10, 1);
    expect(monday[0]?.[0]).toMatchObject({ month: 9, date: 26, inMonth: false });
    expect(monday.flat().filter((day) => day.inMonth)).toHaveLength(30);
    expect(weekdayLetters(1, "en-US")).toEqual(["M", "T", "W", "T", "F", "S", "S"]);
    expect(addMonths(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(dayKey({ year: 2026, month: 10, date: 24 })).toBe("2026-11-24");
  });
  test("today is an ink disc, the chosen day the selection wash, a marked day an ink dot; ‹ › step the month", async () => {
    const steps: number[] = [];
    const today = { year: 2026, month: 10, date: 24 };
    const { node, host, root } = await sent(
      <MonthGrid
        testID="m"
        year={2026}
        month={10}
        today={today}
        chosen={{ year: 2026, month: 10, date: 26 }}
        marked={new Set(["2026-11-25"])}
        locale="en-US"
        onChoose={noop}
        onMonth={(by) => steps.push(by)}
      />,
    );
    expect(words(node("m:title"))).toEqual(["November 2026"]);
    expect(node("m:2026-11-24")?.props.background).toBe(lightColors.primary);
    expect(node("m:2026-11-26")?.props.background).toBe(lightColors.selectionWash);
    expect(JSON.stringify(node("m:2026-11-25"))).toContain(`"background":"${lightColors.text}"`);
    expect(node("m:2026-11-24")?.props.access).toMatchObject({ role: "button", label: "Tuesday, November 24, 2026" });
    host.emit({ type: "press", nodeId: root.nodeId("m:next") ?? "" });
    host.emit({ type: "press", nodeId: root.nodeId("m:previous") ?? "" });
    expect(steps).toEqual([1, -1]);
    expect(JSON.stringify(node("m:2026-11-24"))).not.toContain(lightColors.selection.toLowerCase());
    root.unmount();
  });
});

test("SidebarItem: the rail is the glyph alone, named “Name — count”; the accessory only in the full sidebar", async () => {
  expect(railTip("Inbox", "3")).toBe("Inbox — 3");
  const { node, root } = await sent(
    <View>
      <SidebarItem testID="full" label="Inbox" badge="3" glyph={SEARCH} selected onPress={noop} accessory={<View testID="eject" />} />
      <SidebarItem testID="rail" label="Inbox" badge="3" glyph={SEARCH} selected rail onPress={noop} accessory={<View testID="eject2" />} />
    </View>,
  );
  expect(node("full:accessory")).not.toBeNull();
  expect(node("rail:words")).toBeNull();
  expect(node("rail:accessory")).toBeNull();
  expect(node("rail")?.props.access).toMatchObject({ role: "tab", label: "Inbox — 3", selected: true });
  root.unmount();
});

test("AppWindow: hideTitle gives the title's room away, and titleSlot takes its place (VS-8)", async () => {
  expect(placeOf(1, 12)).toBe("2 of 12");
  const { node, root } = await sent(
    <View>
      <AppWindow title="Files" titleSlot={<View testID="omnibox" />}>
        <View />
      </AppWindow>
    </View>,
  );
  expect(node("omnibox")).not.toBeNull();
  expect(node("window-title")).toBeNull();
  root.unmount();
});
