/** The gallery's 0.10 kit pages: checks and chips, the panel look, states, and picking (UI-8 to UI-15, TK-2). */

import {
  BatteryTile,
  Button,
  Checkbox,
  Chip,
  EmptyState,
  ErrorState,
  FoldedChoices,
  FormSheet,
  GlyphDisc,
  glyphs,
  InkSlider,
  Knob,
  KnobButton,
  LimitBar,
  Loading,
  MonthGrid,
  NoResults,
  PickList,
  PickRow,
  PictureChoice,
  RADIUS,
  RoundTile,
  Segmented,
  SliderTile,
  SPACE,
  Switch,
  TextLink,
  useColors,
  WideTile,
} from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { useState } from "react";
import { Exhibit, PageBody, States, useOverlay } from "../specimen.tsx";

const noop = (): void => {};

/** The picture choice's stand-in pictures. */
const PICTURE = { width: 96, height: 54, dot: 34 } as const;

const SIZES = [
  { value: "s", label: "Small" },
  { value: "m", label: "Medium" },
  { value: "l", label: "Large" },
];
const TIMERS = ["1 min", "2 min", "5 min", "10 min", "15 min", "30 min", "Never"].map((label) => ({ value: label, label }));

export function ChecksPage() {
  const [checked, setChecked] = useState(true);
  return (
    <PageBody>
      <Exhibit title="Checkbox" note="A yes or no that goes with an answer (UI-10). Off: an edge on the field; on: the one on with its tick. Space toggles it.">
        <States>
          {({ state, disabled }) => (
            <>
              <Checkbox testID={`check:${state}:on`} label="Remember this" checked={checked} onChange={setChecked} disabled={disabled} />
              <Checkbox testID={`check:${state}:off`} label="Ask every time" checked={!checked} onChange={(on) => setChecked(!on)} disabled={disabled} />
            </>
          )}
        </States>
      </Exhibit>
      <Exhibit title="Checkbox, the panel look" note="Settings' ticks: the same box, 12.5 words.">
        <States states={["enabled", "pressed", "disabled"]}>
          {({ state, disabled }) => <Checkbox testID={`check:panel:${state}`} look="panel" label="Websites" checked onChange={noop} disabled={disabled} />}
        </States>
      </Exhibit>
      <Exhibit title="Status chip" note="A state in a few words, never a control (UI-12): 18 tall on its tone's wash; a toolbar's is 24.">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <Chip testID="chip:neutral" label="Not connected" />
          <Chip testID="chip:agent" label="Connected" tone="agent" />
          <Chip testID="chip:danger" label="Failed" tone="danger" />
          <Chip testID="chip:warning" label="Offline" tone="warning" glyph={glyphs.WARNING} />
          <Chip testID="chip:success" label="Installed" tone="success" />
          <Chip testID="chip:toolbar" label="Read only" size="toolbar" glyph={glyphs.LOCK} />
        </View>
      </Exhibit>
    </PageBody>
  );
}

export function PanelPage() {
  const [on, setOn] = useState(true);
  const [size, setSize] = useState("m");
  const [timer, setTimer] = useState("5 min");
  const [level, setLevel] = useState(0.6);
  return (
    <PageBody>
      <Exhibit
        title="Button, the panel look"
        note="Settings' and Control Center's pills: ink goes ahead, an outline otherwise, ume words for what can't be undone; 36, or 28 small."
      >
        <States>
          {({ state, disabled }) => (
            <>
              <Button testID={`pbutton:${state}:plain`} look="panel" label="Cancel" disabled={disabled} onPress={noop} />
              <Button testID={`pbutton:${state}:ink`} look="panel" label="Done" primary disabled={disabled} onPress={noop} />
              <Button testID={`pbutton:${state}:danger`} look="panel" label="Forget" danger size="small" disabled={disabled} onPress={noop} />
            </>
          )}
        </States>
      </Exhibit>
      <Exhibit title="Switch, the panel look" note="46 × 28; off shows its track as an outline, on is the one on.">
        <States>
          {({ state, disabled }) => (
            <>
              <Switch testID={`pswitch:${state}:a`} look="panel" label="Wi-Fi" on={on} onChange={setOn} disabled={disabled} />
              <Switch testID={`pswitch:${state}:b`} look="panel" label="Bluetooth" on={!on} onChange={(next) => setOn(!next)} disabled={disabled} />
            </>
          )}
        </States>
      </Exhibit>
      <Exhibit title="Pills" note="One of a few; past five they fold into More, the value in use always shown.">
        <States>
          {({ state, disabled }) => <Segmented testID={`pills:${state}`} look="panel" options={SIZES} value={size} onChange={setSize} disabled={disabled} />}
        </States>
        <FoldedChoices testID="pills:folded" options={TIMERS} value={timer} onChange={setTimer} />
      </Exhibit>
      <Exhibit title="Ink slider, knobs and a reading" note="The flat slider fills with ink; a reading's bar is ink too, ume under 10% (CO-13).">
        <InkSlider testID="ink-slider" value={level} glyph={glyphs.SEARCH} format={(value) => `${Math.round(value * 100)}%`} onChange={setLevel} />
        <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
          <Knob glyph={glyphs.LOCK} />
          <Knob glyph={glyphs.LOCK} on />
          <GlyphDisc glyph={glyphs.SEARCH} />
          <View style={{ width: 160, flexDirection: "row" }}>
            <LimitBar percent={64} limit={80} height={8} />
          </View>
          <View style={{ width: 80, flexDirection: "row" }}>
            <LimitBar percent={7} limit={null} height={8} />
          </View>
        </View>
        <TextLink testID="link:panel" look="panel" label="Other…" onPress={noop} />
      </Exhibit>
      <Exhibit
        title="Control Center's tiles"
        note="A wide tile's knob toggles and its label opens; a round one toggles; on is the one on. The battery is a reading, its bar ink (CC-1)."
      >
        <View style={{ flexDirection: "row", gap: 8, height: 56, width: 344 }}>
          <WideTile look={{ testID: "tile:wide", title: "Wi-Fi", detail: "Home", glyph: glyphs.SEARCH, on }} onToggle={() => setOn(!on)} onOpen={noop} />
          <RoundTile look={{ testID: "tile:round", title: "Focus", detail: null, glyph: glyphs.LOCK, on: !on }} onToggle={() => setOn(!on)} />
          <RoundTile look={{ testID: "tile:dim", title: "Applet", detail: null, glyph: glyphs.INFO, on: false, dim: true }} onToggle={noop} />
        </View>
        <View style={{ flexDirection: "row", gap: 8, height: 56, width: 344 }}>
          <SliderTile
            look={{ testID: "tile:slider", title: "Display", glyph: glyphs.SEARCH, level, value: `${Math.round(level * 100)}%`, width: 344, height: 56 }}
            standing={false}
            onLevel={setLevel}
          />
        </View>
        <View style={{ flexDirection: "row", height: 56, width: 344 }}>
          <BatteryTile look={{ percent: 64, charging: false, limit: 80, time: "5 h 10 min", glyph: glyphs.INFO }} onOpen={noop} />
        </View>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <KnobButton testID="knob:back" glyph={glyphs.CHEVRON_LEFT} label="Back" onPress={noop} />
          <KnobButton testID="knob:mute" glyph={glyphs.STOP} label="Mute" checked={!on} onPress={() => setOn(!on)} />
          <KnobButton testID="knob:add" glyph={glyphs.CLOSE} label="Add" inked size={22} glyphSize={12} onPress={noop} />
          <Switch testID="pswitch:lit" look="panel" lit label="Wi-Fi" on={on} onChange={setOn} />
        </View>
      </Exhibit>
    </PageBody>
  );
}

export function StatesPage() {
  return (
    <PageBody>
      <Exhibit title="Error state" note="A page that couldn't load (PA-6): its glyph in its job colour, a sentence naming the thing, what to do, its ways on.">
        <View style={{ height: 190, flexDirection: "column" }}>
          <ErrorState
            testID="error:failed"
            title="Couldn’t open “Report.pdf”."
            message="It may have moved, or it isn’t a PDF."
            actions={<Button testID="error:retry" label="Try Again" onPress={noop} />}
          />
        </View>
        <View style={{ height: 150, flexDirection: "column" }}>
          <ErrorState testID="error:offline" kind="offline" title="You’re offline." message="The Store comes back when you’re connected." />
        </View>
      </Exhibit>
      <Exhibit title="Empty state" note="A pane's (PA-7): a glyph, a 15 title, how to add, the one action. A panel's is one 12 line.">
        <View style={{ height: 190, flexDirection: "column" }}>
          <EmptyState
            testID="empty:pane"
            glyph={glyphs.INFO}
            title="No notes yet"
            message="Press ❖N to add one."
            action={<Button testID="empty:add" label="New Note" onPress={noop} />}
          />
        </View>
        <EmptyState testID="empty:panel" variant="panel" title="No notifications" />
      </Exhibit>
      <Exhibit title="No results" note="A search that found nothing (PA-17).">
        <View style={{ height: 150, flexDirection: "column" }}>
          <NoResults testID="no-results" query="milk" hint="Check the spelling." />
        </View>
      </Exhibit>
      <Exhibit title="Loading, in a row" note="After 200 ms, the spinner and the word for what it looks for (PA-5).">
        <Loading testID="loading:inline" inline label="Searching…" />
      </Exhibit>
    </PageBody>
  );
}

export function PicksPage() {
  const [app, setApp] = useState("preview");
  const [picture, setPicture] = useState("dusk");
  const colors = useColors();
  const [day, setDay] = useState({ year: 2026, month: 10, date: 26 });
  const [month, setMonth] = useState({ year: 2026, month: 10 });
  const show = useOverlay();
  const close = (): void => show(null);
  const sheet = (
    <FormSheet
      testID="form"
      title="Go to line"
      buttons={[
        { label: "Cancel", testID: "form:cancel", cancel: true, onPress: close },
        { label: "Go", testID: "form:go", kind: "primary", onPress: close },
      ]}
    >
      <Checkbox testID="form:select" label="Select the line" checked onChange={noop} />
    </FormSheet>
  );
  return (
    <PageBody>
      <Exhibit title="Pick rows" note="One of a list in a sheet or a popover (UI-13): ↑ ↓ choose, Return presses; the default is tagged.">
        <PickList testID="picks">
          <PickRow testID="pick:preview" label="Preview" detail="Default" glyph={glyphs.INFO} chosen={app === "preview"} onPress={() => setApp("preview")} />
          <PickRow testID="pick:editor" label="Text Editor" glyph={glyphs.INFO} chosen={app === "editor"} onPress={() => setApp("editor")} />
          <PickRow testID="pick:off" label="Terminal" glyph={glyphs.INFO} chosen={false} disabled onPress={noop} />
        </PickList>
      </Exhibit>
      <Exhibit
        title="Picture choice"
        note="A picture to pick (CO-9): the chosen one ringed 2.5 in the on colour, concentric with it; ink where the choices are colours."
      >
        <View testID="pictures" focusGroup accessibilityRole="listbox" style={{ flexDirection: "row", gap: SPACE.inset, alignItems: "flex-start" }}>
          {["dawn", "dusk"].map((name) => (
            <PictureChoice
              key={name}
              testID={`picture:${name}`}
              label={name}
              caption={name}
              chosen={picture === name}
              radius={RADIUS.row}
              onPress={() => setPicture(name)}
            >
              <View style={{ width: PICTURE.width, height: PICTURE.height, borderRadius: RADIUS.row, backgroundColor: colors.separator }} />
            </PictureChoice>
          ))}
          <PictureChoice testID="picture:ink" label="Ume" caption="Ume" small ring="ink" chosen radius={PICTURE.dot / 2} onPress={noop}>
            <View style={{ width: PICTURE.dot, height: PICTURE.dot, borderRadius: PICTURE.dot / 2, backgroundColor: colors.separator }} />
          </PictureChoice>
        </View>
      </Exhibit>
      <Exhibit title="Month grid" note="The one month (UI-14): today an ink disc, the chosen day the selection wash, a day with something on it an ink dot.">
        <MonthGrid
          testID="month"
          year={month.year}
          month={month.month}
          today={{ year: 2026, month: 10, date: 24 }}
          chosen={day}
          marked={new Set(["2026-11-25", "2026-11-30"])}
          firstWeekday={1}
          onChoose={setDay}
          onMonth={(by) =>
            setMonth((now) => ({ year: new Date(now.year, now.month + by, 1).getFullYear(), month: new Date(now.year, now.month + by, 1).getMonth() }))
          }
        />
      </Exhibit>
      <Exhibit title="Form sheet" note="A sheet that asks for input (UI-15): a 13 Bold heading, its body, buttons at the end, the safe one first.">
        <Button testID="form:open" label="Show Form Sheet" onPress={() => show(sheet)} />
      </Exhibit>
    </PageBody>
  );
}
