/**
 * The kit on glass (design.html GL-1 to GL-6, CO-6, CO-9, KB-2; decisions.md D770 to D775): each exhibit
 * on regular glass beside the same on glass turned off (regular's solid twin), in each mode the toolbar
 * asks for. The page paints no ground (AppWindow `seeThrough`), so the glass frosts what is behind the
 * window: put a photo on the wallpaper to see the words lean to it.
 */

import {
  Appearance,
  Button,
  Checkbox,
  Chip,
  Frosted,
  GLASS,
  type GlassLevel,
  GlyphButton,
  glassInkTokens,
  glyphs,
  inkTokens,
  KnobButton,
  OffGlass,
  ProgressBar,
  RADIUS,
  RoundTile,
  SearchField,
  Segmented,
  SidebarItem,
  SPACE,
  Switch,
  TextField,
  TextLink,
  TILE,
  TYPE,
  useColors,
  useControlColors,
  useDark,
  useFocusGap,
  useGlassTone,
  useOnGlass,
  useSessionDark,
  useSolidTwin,
  WEIGHT,
  WideTile,
  WindowFocusContext,
} from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { type ReactNode, useContext, useState } from "react";
import { columnsFor } from "../pages.ts";
import { ModeContext, PageBody } from "../specimen.tsx";

const noop = (): void => {};
const SIZES = [
  { value: "s", label: "Small" },
  { value: "m", label: "Medium" },
  { value: "l", label: "Large" },
];

/** One panel of an exhibit: on regular glass, or glass off. */
function Panel({ solid, children }: { solid: boolean; children: ReactNode }) {
  return (
    <Frosted
      level="regular"
      solid={solid}
      testID={`glass:${useDark() ? "dark" : "light"}:${solid ? "off" : "on"}`}
      style={{ flex: 1, flexDirection: "column", gap: SPACE.m, padding: SPACE.button, borderRadius: RADIUS.sheet }}
    >
      <Label solid={solid} />
      <View style={{ flexDirection: "column", gap: SPACE.m }}>{children}</View>
    </Frosted>
  );
}

/** The panel's name, and the backdrop's tone it leans to. */
function Label({ solid }: { solid: boolean }) {
  const colors = useColors();
  const tone = useGlassTone();
  const dark = useDark();
  const other = dark !== useSessionDark();
  const glass = tone === null ? "Regular glass, neutral" : `Regular glass, leaning to ${tone}`;
  // Glass is drawn in the session's mode: the other mode's column shows its twin.
  const said = solid ? "Glass off" : other ? `Its twin: glass is drawn in ${dark ? "Light" : "Dark"} Mode now` : glass;
  return <Text style={{ fontSize: TYPE.caption.size, fontWeight: WEIGHT.semibold, color: colors.textMuted }}>{said}</Text>;
}

/** A mode's column: its name ("Light", "Dark"), then what it holds, on no ground of its own. */
function Column({ children }: { children: ReactNode }) {
  const colors = useColors();
  const dark = useDark();
  return (
    <View testID={dark ? "exhibit:dark" : "exhibit:light"} style={{ flexDirection: "column", gap: SPACE.s }}>
      <Text style={{ fontSize: TYPE.caption.size, fontWeight: WEIGHT.semibold, color: colors.text }}>{dark ? "Dark" : "Light"}</Text>
      {children}
    </View>
  );
}

/** An exhibit on glass: a name, a line, then glass and glass off for each mode. */
function OnGlass({ title, note, children }: { title: string; note: string; children: () => ReactNode }) {
  const colors = useColors();
  const mode = useContext(ModeContext);
  return (
    <View style={{ flexShrink: 0, flexDirection: "column", gap: SPACE.s }}>
      <View
        style={{
          alignSelf: "flex-start",
          flexDirection: "column",
          gap: SPACE.xxs,
          padding: SPACE.s,
          borderRadius: RADIUS.row,
          backgroundColor: useSolidTwin("regular"),
        }}
      >
        <Text style={{ fontSize: TYPE.body.size, fontWeight: WEIGHT.semibold, color: colors.text }}>{title}</Text>
        <Text style={{ fontSize: TYPE.secondary.size, color: colors.textMuted }}>{note}</Text>
      </View>
      {columnsFor(mode).map((dark) => (
        <Appearance key={dark ? "dark" : "light"} dark={dark}>
          <Column>
            <View style={{ flexDirection: "row", gap: SPACE.inset }}>
              <Panel solid={false}>{children()}</Panel>
              <Panel solid>{children()}</Panel>
            </View>
          </Column>
        </Appearance>
      ))}
    </View>
  );
}

function Words() {
  const colors = useColors();
  return (
    <>
      <Text style={{ fontSize: TYPE.body.size, color: colors.text }}>Primary words lean to the backdrop.</Text>
      <Text style={{ fontSize: TYPE.secondary.size, color: colors.textMuted }}>Secondary words, the floor's weakest.</Text>
      <Text style={{ fontSize: TYPE.secondary.size, color: colors.textDisabled }}>Disabled words stay at 40%.</Text>
      <View style={{ flexDirection: "row", gap: SPACE.m, alignItems: "center" }}>
        <TextLink testID="glass:link" label="A link is ink, underlined" onPress={noop} />
        <Chip label="On a fill" />
      </View>
    </>
  );
}

function Controls() {
  const [on, setOn] = useState(true);
  const [size, setSize] = useState("m");
  return (
    <>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACE.m, alignItems: "center" }}>
        <Button testID="glass:primary" label="Save" primary onPress={noop} />
        <Button testID="glass:secondary" label="Cancel" onPress={noop} />
        <Button testID="glass:default" label="Keep" isDefault onPress={noop} />
        <Button testID="glass:danger" label="Delete" danger onPress={noop} />
        <GlyphButton testID="glass:glyph" glyph={glyphs.ADD} label="Add" onPress={noop} />
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACE.m, alignItems: "center" }}>
        <Switch testID="glass:switch-off" on={!on} onChange={(next) => setOn(!next)} />
        <Switch testID="glass:switch-on" on={on} onChange={setOn} />
        <Switch testID="glass:panel-off" look="panel" on={!on} onChange={(next) => setOn(!next)} />
        <Switch testID="glass:panel-on" look="panel" on={on} onChange={setOn} />
        <Checkbox testID="glass:box-off" label="Off" checked={!on} onChange={(next) => setOn(!next)} />
        <Checkbox testID="glass:box-on" label="On" checked={on} onChange={setOn} />
      </View>
      <Segmented testID="glass:segmented" options={SIZES} value={size} onChange={setSize} />
      <TextField testID="glass:field" value="Alex Kim" onChangeText={noop} width={220} />
      <SearchField testID="glass:search" value="" onChangeText={noop} placeholder="Search" />
      <ProgressBar testID="glass:progress" value={0.6} width={220} />
    </>
  );
}

function Selection() {
  return (
    <>
      <SidebarItem testID="glass:row" label="Selected, window with focus" selected compact onPress={noop} />
      <WindowFocusContext.Provider value={false}>
        <SidebarItem testID="glass:row-unfocused" label="Selected, window without focus" selected compact onPress={noop} />
      </WindowFocusContext.Provider>
      <SidebarItem testID="glass:row-rest" label="At rest" selected={false} compact onPress={noop} />
    </>
  );
}

/** The coloured inks a surface shows, as they are on glass (GL-5). */
function Inks() {
  const colors = useColors();
  const dark = useDark();
  const inks = glassInkTokens(inkTokens(dark ? "dark" : "light"));
  const words = (text: string, color: string) => <Text style={{ fontSize: TYPE.secondary.size, fontWeight: WEIGHT.semibold, color }}>{text}</Text>;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACE.gap, alignItems: "center" }}>
      {words("Couldn't save", colors.ume)}
      {words("86%", inks.ink.matcha)}
      {words("3:12", inks.ink.wakame)}
      <View style={{ paddingHorizontal: SPACE.s, borderRadius: RADIUS.row, backgroundColor: colors.microphoneWash }}>{words("Mic", colors.microphone)}</View>
      <View style={{ paddingHorizontal: SPACE.s, borderRadius: RADIUS.row, backgroundColor: colors.button }}>{words("Stop", colors.ume)}</View>
    </View>
  );
}

/** The panel look: tiles and knobs (the glass edge on an off knob), and the ring's white gap on a lit tile (KB-2). */
function PanelLook() {
  const [on, setOn] = useState(true);
  const panel = useControlColors();
  const gap = useFocusGap(true, panel.onInk);
  return (
    <>
      <View style={{ flexDirection: "row", gap: SPACE.m, height: TILE.knob + 2 * SPACE.s }}>
        <WideTile look={{ testID: "glass:tile", title: "Wi-Fi", detail: "Home", glyph: glyphs.SEARCH, on }} onToggle={() => setOn(!on)} />
        <RoundTile look={{ testID: "glass:round", title: "Focus", detail: null, glyph: glyphs.LOCK, on: !on }} onToggle={() => setOn(!on)} />
      </View>
      <View style={{ flexDirection: "row", gap: SPACE.m, alignItems: "center" }}>
        <KnobButton testID="glass:knob" glyph={glyphs.CHEVRON_LEFT} label="Back" onPress={noop} />
        <Button testID="glass:pill" look="panel" label="Outline" onPress={noop} />
        <View style={{ padding: SPACE.s, borderRadius: RADIUS.card, backgroundColor: panel.on, focusRingColor: panel.focus, ...gap }}>
          <KnobButton testID="glass:knob-lit" glyph={glyphs.CHEVRON_LEFT} label="Back, on a lit header" lit onPress={noop} />
        </View>
      </View>
    </>
  );
}

/** A tooltip's ground: regular's solid twin, never glass (GL-6). */
function Tip() {
  const ground = useSolidTwin("regular");
  return <OffGlass>{<TipWords ground={ground} />}</OffGlass>;
}

function TipWords({ ground }: { ground: string }) {
  const colors = useColors();
  const words = useOnGlass() === null ? "A tooltip is never glass" : "on glass";
  return (
    <View style={{ alignSelf: "flex-start", paddingHorizontal: SPACE.m, paddingVertical: SPACE.xxs, borderRadius: RADIUS.row, backgroundColor: ground }}>
      <Text style={{ fontSize: TYPE.secondary.size, color: colors.text }}>{words}</Text>
    </View>
  );
}

const LEVELS: readonly GlassLevel[] = ["thin", "regular", "thick", "paper"];

/** Frost's four levels side by side. */
function Levels() {
  const dark = useDark();
  return (
    <View style={{ flexDirection: "row", gap: SPACE.m }}>
      {LEVELS.map((level) => (
        <Frosted key={level} level={level} testID={`glass:level:${level}`} style={{ flex: 1, padding: SPACE.m, borderRadius: GLASS.banner.radius }}>
          <LevelWords level={level} dark={dark} />
        </Frosted>
      ))}
    </View>
  );
}

function LevelWords({ level, dark }: { level: GlassLevel; dark: boolean }) {
  const colors = useColors();
  const look = GLASS.levels[level];
  return (
    <>
      <Text style={{ fontSize: TYPE.secondary.size, fontWeight: WEIGHT.semibold, color: colors.text }}>{level}</Text>
      <Text style={{ fontSize: TYPE.caption.size, color: colors.textMuted }}>{`blur ${look.blur} · α ${look[dark ? "dark" : "light"].least}`}</Text>
    </>
  );
}

export function GlassPage() {
  const mode = useContext(ModeContext);
  return (
    <PageBody>
      {columnsFor(mode).map((dark) => (
        <Appearance key={dark ? "dark" : "light"} dark={dark}>
          <Column>
            <Levels />
          </Column>
        </Appearance>
      ))}
      <OnGlass title="Words" note="The vibrant inks, a link in ink, words on a fill in primary (GL-1).">
        {() => <Words />}
      </OnGlass>
      <OnGlass title="Controls" note="Edges are the glass edge, quiet fills white on the glass, a chosen segment raised on paper (CO-6).">
        {() => <Controls />}
      </OnGlass>
      <OnGlass title="Selection" note="The accent at 22% under primary words; neutral in a window without focus (CO-9).">
        {() => <Selection />}
      </OnGlass>
      <OnGlass title="Coloured inks" note="Ume, matcha, wakame and the microphone one step darker in Light, ume on a fill lighter in Dark (GL-5).">
        {() => <Inks />}
      </OnGlass>
      <OnGlass title="The panel look" note="An off knob wears the glass edge; the ring keeps a white gap on a lit tile (CC-1, KB-2).">
        {() => <PanelLook />}
      </OnGlass>
      <OnGlass title="Tooltips" note="Regular's solid twin, whatever is under them (GL-6).">
        {() => <Tip />}
      </OnGlass>
    </PageBody>
  );
}
