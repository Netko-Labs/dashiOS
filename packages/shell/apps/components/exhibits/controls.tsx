/** The gallery's control pages: buttons, pickers, switches and sliders, and fields. */

import { Button, Choices, glyphs, PopUpButton, type PopUpOption, SearchField, Segmented, Slider, Switch, TextField, ToolbarButton } from "@dashi/ui";
import { useState } from "react";
import { Exhibit, PageBody, States } from "../specimen.tsx";

const noop = (): void => {};

/** A sun, for the level slider (Control Center draws its own glyphs). */
const SUN =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="3" fill="#000"/>' +
  '<path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" stroke="#000" stroke-width="1.4" stroke-linecap="round"/></svg>';

export function ButtonsPage() {
  return (
    <PageBody>
      <Exhibit
        title="Button"
        note="Kombu goes ahead, ume destroys, the rest are secondary with a 3:1 edge. Each deepens under the pointer (point at one) and more while held; disabled is the whole button at 40%. Tab to one for its focus ring; the Focused row only marks the state."
      >
        <States>
          {({ state, disabled }) => (
            <>
              <Button testID={`button:${state}:cancel`} label="Cancel" disabled={disabled} onPress={noop} />
              <Button testID={`button:${state}:save`} label="Save" primary disabled={disabled} onPress={noop} />
              <Button testID={`button:${state}:delete`} label="Delete" danger disabled={disabled} onPress={noop} />
            </>
          )}
        </States>
      </Exhibit>
      <Exhibit title="Default button" note="A secondary button Enter presses wears the kombu ring: a destructive sheet's Cancel.">
        <States states={["enabled", "pressed", "disabled"]}>
          {({ state, disabled }) => <Button testID={`button:${state}:default`} label="Cancel" isDefault disabled={disabled} onPress={noop} />}
        </States>
      </Exhibit>
      <Exhibit title="Toolbar button" note="A glyph, quiet until hovered; a glyph alone names itself with a tooltip after a rest.">
        <States states={["enabled", "disabled"]}>
          {({ state, disabled }) => (
            <>
              <ToolbarButton testID={`toolbar:${state}:glyph`} glyph={glyphs.SEARCH} tooltip="Search" disabled={disabled} onPress={noop} />
              <ToolbarButton testID={`toolbar:${state}:label`} glyph={glyphs.RESTART} label="Refresh" disabled={disabled} onPress={noop} />
            </>
          )}
        </States>
      </Exhibit>
    </PageBody>
  );
}

const SIZES = [
  { value: "s", label: "Small" },
  { value: "m", label: "Medium" },
  { value: "l", label: "Large" },
];

const PAPER: ReadonlyArray<PopUpOption<string>> = [
  { value: "a4", label: "A4" },
  { value: "letter", label: "US Letter" },
  { value: "legal", label: "US Legal" },
  { type: "separator" },
  { value: "a5", label: "A5" },
  { value: "envelope", label: "Envelope #10" },
];

export function PickersPage() {
  const [segment, setSegment] = useState("m");
  const [pill, setPill] = useState("m");
  const [paper, setPaper] = useState("a4");
  return (
    <PageBody>
      <Exhibit title="Segmented control" note="Two to four short options.">
        <States states={["enabled", "pressed", "focused", "disabled"]}>
          {({ state, disabled }) => <Segmented testID={`segmented:${state}`} options={SIZES} value={segment} onChange={setSegment} disabled={disabled} />}
        </States>
      </Exhibit>
      <Exhibit title="Choice pills" note="Two to six options in a settings row; the chosen one is kombu.">
        <States states={["enabled", "pressed", "focused", "disabled"]}>
          {({ state, disabled }) => <Choices testID={`choices:${state}`} options={SIZES} value={pill} onChange={setPill} disabled={disabled} />}
        </States>
      </Exhibit>
      <Exhibit
        title="Pop-up button"
        note="Anything longer, or of unknown length: printers, paper sizes, apps, languages. Its menu opens over it with the chosen option ticked where the button is."
      >
        <States>
          {({ state, disabled }) => <PopUpButton testID={`popup:${state}`} options={PAPER} value={paper} onChange={setPaper} width={170} disabled={disabled} />}
        </States>
      </Exhibit>
    </PageBody>
  );
}

export function SwitchesPage() {
  const [on, setOn] = useState(true);
  const [level, setLevel] = useState(40);
  const [volume, setVolume] = useState(0.6);
  return (
    <PageBody>
      <Exhibit title="Switch" note="On is kombu with the knob at the end.">
        <States states={["enabled", "focused", "disabled"]}>
          {({ state, disabled }) => (
            <>
              <Switch testID={`switch:${state}:a`} on={on} onChange={setOn} disabled={disabled} />
              <Switch testID={`switch:${state}:b`} on={!on} onChange={(next) => setOn(!next)} disabled={disabled} />
            </>
          )}
        </States>
      </Exhibit>
      <Exhibit title="Slider" note="A setting's slider: press or drag; the value is committed once, when the button lifts.">
        <States states={["enabled", "focused", "disabled"]}>
          {({ state, disabled }) => (
            <Slider testID={`slider:${state}`} value={level} range={{ min: 0, max: 100, step: 5 }} width={200} onCommit={setLevel} disabled={disabled} />
          )}
        </States>
      </Exhibit>
      <Exhibit title="Level slider" note="Control Center's: a tall bar whose fill carries the glyph, following the drag as it goes.">
        <States states={["enabled", "disabled"]}>
          {({ state, disabled }) => <Slider testID={`level:${state}`} value={volume} glyph={SUN} width={220} onChange={setVolume} disabled={disabled} />}
        </States>
      </Exhibit>
    </PageBody>
  );
}

export function FieldsPage() {
  const [text, setText] = useState("Groceries");
  const [query, setQuery] = useState("");
  return (
    <PageBody>
      <Exhibit title="Text field" note="The ring is kombu while it has the keyboard.">
        <TextField testID="field:text" value={text} onChangeText={setText} width={220} />
        <TextField testID="field:empty" value="" placeholder="Name" onChangeText={noop} width={220} />
      </Exhibit>
      <Exhibit title="Search field" note="Esc empties it first; the clear button shows once something is typed.">
        <SearchField testID="field:search" value={query} onChangeText={setQuery} width={220} />
      </Exhibit>
    </PageBody>
  );
}
