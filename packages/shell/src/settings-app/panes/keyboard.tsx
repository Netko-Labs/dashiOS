/**
 * Keyboard: how fast keys repeat, and the layout. The layout list is every
 * layout xkb knows (searchable), with the chosen layout's variants beside it,
 * each name whole (a long one wraps), and the layout has one name in the
 * row and the picker (layouts.ts `layoutName`).
 * Choices go to settings.json `keyboard`, which the shell sends to dashi-comp.
 * The input method (settings.json `inputMethod.engine`) is what the session
 * runs to type other scripts (input-method.ts).
 * Clipboard history and snippets are here too (clipboard-parts.tsx).
 */

import { rowLook, SEARCH, SelectionBar } from "@dashi/ui";
import { ScrollView, Svg, Text, TextInput, View } from "@mirinjs/metal";
import { type ReactNode, useState } from "react";
import type { Laptop } from "../../laptop/start.ts";
import { KEYBOARD as KEYBOARD_KNOB, REPEAT } from "../../shared/settings/knob-glyphs.ts";
import { useColors } from "../colors.ts";
import { DEFAULTS, describeDelay, describeRate, REPEAT_DELAY, REPEAT_RATE } from "../controls.ts";
import { useSettings } from "../hooks.ts";
import { layoutName, primaryLayout, searchLayouts, variantsOf, type XkbLayouts } from "../layouts.ts";
import type { SettingsStore } from "../store.ts";
import { Caption, Group, Note, Page, Setting, Slider, Spot, useSurface } from "../ui.tsx";
import { ClipboardSection, type HistoryControl, type InstalledApp } from "./clipboard-parts.tsx";
import { KeyboardLightSection } from "./laptop-parts.tsx";

const LIST_HEIGHT = 196;

/** A layout or a variant: its whole name, wrapping onto a second line rather than cut. */
function ListRow({ label, chosen, testID, onPress }: { label: string; chosen: boolean; testID: string; onPress: () => void }) {
  const look = rowLook(useColors(), chosen);
  return (
    <View
      testID={testID}
      onPress={onPress}
      style={{
        minHeight: 28,
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 8,
        paddingVertical: 5,
        borderRadius: 6,
        backgroundColor: look.ground,
        hoverBackgroundColor: look.hover,
      }}
    >
      {chosen && <SelectionBar />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 12, color: look.ink }}>{label}</Text>
      </View>
    </View>
  );
}

function List({ children, testID }: { children: ReactNode; testID: string }) {
  const surface = useSurface();
  return (
    <ScrollView testID={testID} style={{ flex: 1, height: LIST_HEIGHT, flexDirection: "column", padding: 4, borderRadius: 8, backgroundColor: surface.field }}>
      {children}
    </ScrollView>
  );
}

export function LayoutPicker({ layouts, settings }: { layouts: XkbLayouts; settings: SettingsStore }) {
  const colors = useColors();
  const surface = useSurface();
  const [query, setQuery] = useState("");
  const { keyboard } = useSettings(settings).data;
  const current = primaryLayout(keyboard.layout);
  // A value with several layouts ("us,de") was set by hand; picking one here replaces it.
  const several = (keyboard.layout ?? "").includes(",");
  const shown = searchLayouts(layouts.layouts, query);
  const variants = variantsOf(layouts.variants, current);
  // One name everywhere: the row says it, the variants' first row is the layout's own name, and the chosen one is lit.
  const name = layoutName(layouts, keyboard.layout, keyboard.variant);
  const plain = layouts.layouts.find((layout) => layout.id === current)?.name ?? current;
  return (
    <Setting id="keyboard/layout" detail={`${name}${several ? " (several layouts set in settings.json)" : ""}`}>
      <View
        style={{
          alignSelf: "stretch",
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          height: 28,
          paddingHorizontal: 8,
          borderRadius: 8,
          backgroundColor: surface.field,
        }}
      >
        <Svg markup={SEARCH} size={13} color={colors.textMuted} />
        <TextInput
          testID="keyboard-search"
          value={query}
          placeholder="Search layouts"
          onChangeText={setQuery}
          style={{ flex: 1, fontSize: 12, color: colors.text, placeholderColor: colors.textMuted, backgroundColor: "#00000000" }}
        />
      </View>
      <View style={{ alignSelf: "stretch", flexDirection: "row", gap: 10 }}>
        <List testID="keyboard-layouts">
          {shown.length === 0 && <Note>No layout matches.</Note>}
          {shown.map((layout) => (
            <ListRow
              key={layout.id}
              testID={`keyboard-layout:${layout.id}`}
              label={layout.name}
              chosen={layout.id === current && !several}
              // A new layout drops the old one's variant, which belonged to it.
              onPress={() => settings.patch("keyboard", { layout: layout.id, variant: undefined })}
            />
          ))}
        </List>
        <List testID="keyboard-variants">
          {variants.length === 0 ? (
            <Note>No variants</Note>
          ) : (
            <>
              <ListRow
                testID="keyboard-variant:default"
                label={plain}
                chosen={!keyboard.variant}
                onPress={() => settings.patch("keyboard", { variant: undefined })}
              />
              {variants.map((variant) => (
                <ListRow
                  key={variant.id}
                  testID={`keyboard-variant:${variant.id}`}
                  label={variant.name}
                  chosen={keyboard.variant === variant.id}
                  onPress={() => settings.patch("keyboard", { layout: current, variant: variant.id })}
                />
              ))}
            </>
          )}
        </List>
      </View>
    </Setting>
  );
}

/** Fcitx 5 is installed (the only input method offered: input-method.ts). */
const HAS_FCITX = Bun.which("fcitx5") !== null;

/** The input method the session runs, or how to get one. */
function InputMethodRow({ installed }: { installed: boolean }) {
  if (!installed)
    return (
      <Spot id="keyboard/input-method">
        <Note testID="keyboard-no-input-method">To type Chinese, Japanese, Korean and other scripts, install Fcitx 5 (fcitx5) and its input methods.</Note>
      </Spot>
    );
  return <Setting id="keyboard/input-method" control="keyboard-input-method" />;
}

export function KeyboardPane({
  settings,
  layouts,
  laptop,
  clipboard,
  installed,
}: {
  settings: SettingsStore;
  layouts: XkbLayouts;
  laptop?: Laptop | null;
  clipboard?: HistoryControl | null;
  /** The installed app an id stands for: the clipboard's left-out list draws its name and icon. */
  installed?: InstalledApp;
}) {
  const { keyboard } = useSettings(settings).data;
  const rate = keyboard.repeatRate ?? DEFAULTS.repeatRate;
  const delay = keyboard.repeatDelay ?? DEFAULTS.repeatDelay;
  return (
    <Page title="Keyboard">
      <Group>
        <Setting id="keyboard/key-repeat" detail="Off at the left, fast at the right.">
          <Slider
            testID="keyboard-rate"
            value={rate}
            range={REPEAT_RATE}
            glyph={REPEAT}
            format={describeRate}
            onCommit={(value) => settings.patch("keyboard", { repeatRate: value })}
          />
        </Setting>
        <Setting id="keyboard/repeat-delay" detail="Short at the left, long at the right.">
          <Slider
            testID="keyboard-delay"
            value={delay}
            range={REPEAT_DELAY}
            glyph={KEYBOARD_KNOB}
            format={describeDelay}
            onCommit={(value) => settings.patch("keyboard", { repeatDelay: value })}
          />
        </Setting>
      </Group>
      <Group>
        {layouts.layouts.length === 0 ? (
          <Note testID="keyboard-no-layouts">The list of layouts is not installed on this system.</Note>
        ) : (
          <LayoutPicker layouts={layouts} settings={settings} />
        )}
      </Group>
      <Caption>A new layout applies in a moment, to every app.</Caption>
      <Group>
        <InputMethodRow installed={HAS_FCITX} />
      </Group>
      <KeyboardLightSection laptop={laptop ?? null} />
      <ClipboardSection settings={settings} history={clipboard ?? null} {...(installed ? { installed } : {})} />
    </Page>
  );
}
