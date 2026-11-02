/**
 * Keyboard: how fast keys repeat, and the layout. The layout list is every
 * layout xkb knows (searchable), with the chosen layout's variants beside it.
 * Choices go to settings.json `keyboard`, which the shell sends to dashi-comp.
 */

import { ScrollView, Svg, Text, TextInput, View } from "@mirinjs/metal";
import { type ReactNode, useState } from "react";
import { SEARCH, useColors } from "@dashi/ui";
import { DEFAULTS, describeDelay, describeRate, REPEAT_DELAY, REPEAT_RATE } from "../controls.ts";
import { useSettings } from "../hooks.ts";
import { describeLayout, primaryLayout, searchLayouts, variantsOf, type XkbLayouts } from "../layouts.ts";
import type { SettingsStore } from "../store.ts";
import { Caption, Group, Note, Page, Row, Slider, useSurface } from "../ui.tsx";

const LIST_HEIGHT = 196;

function ListRow({ label, chosen, testID, onPress }: { label: string; chosen: boolean; testID: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      onPress={onPress}
      style={{
        height: 28,
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 8,
        borderRadius: 6,
        backgroundColor: chosen ? colors.selection : "#00000000",
        hoverBackgroundColor: chosen ? colors.selection : colors.button,
      }}
    >
      <Text numberOfLines={1} style={{ fontSize: 12, color: chosen ? "#ffffff" : colors.text }}>
        {label}
      </Text>
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
  return (
    <Row stack label="Layout" detail={`${describeLayout(layouts.layouts, keyboard.layout)}${several ? " (several layouts set in settings.json)" : ""}`}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 28, paddingHorizontal: 8, borderRadius: 8, backgroundColor: surface.field }}>
        <Svg markup={SEARCH} size={13} color={colors.textMuted} />
        <TextInput
          testID="keyboard-search"
          value={query}
          placeholder="Search layouts"
          onChangeText={setQuery}
          style={{ flex: 1, fontSize: 12, color: colors.text, placeholderColor: colors.textMuted, backgroundColor: "#00000000" }}
        />
      </View>
      <View style={{ flexDirection: "row", gap: 10 }}>
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
                label="Default"
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
    </Row>
  );
}

function RangeLabels({ low, high }: { low: string; high: string }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", width: 220 }}>
      <Text style={{ fontSize: 10, color: colors.textMuted }}>{low}</Text>
      <Text style={{ fontSize: 10, color: colors.textMuted }}>{high}</Text>
    </View>
  );
}

export function KeyboardPane({ settings, layouts }: { settings: SettingsStore; layouts: XkbLayouts }) {
  const { keyboard } = useSettings(settings).data;
  const rate = keyboard.repeatRate ?? DEFAULTS.repeatRate;
  const delay = keyboard.repeatDelay ?? DEFAULTS.repeatDelay;
  return (
    <Page title="Keyboard">
      <Group>
        <Row label="Key repeat rate" detail={describeRate(rate)}>
          <View style={{ flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
            <Slider testID="keyboard-rate" value={rate} range={REPEAT_RATE} onCommit={(value) => settings.patch("keyboard", { repeatRate: value })} />
            <RangeLabels low="Off" high="Fast" />
          </View>
        </Row>
        <Row label="Delay until repeat" detail={describeDelay(delay)}>
          <View style={{ flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
            <Slider testID="keyboard-delay" value={delay} range={REPEAT_DELAY} onCommit={(value) => settings.patch("keyboard", { repeatDelay: value })} />
            <RangeLabels low="Short" high="Long" />
          </View>
        </Row>
      </Group>
      <Group>
        {layouts.layouts.length === 0 ? (
          <Note testID="keyboard-no-layouts">The list of layouts is not installed on this system.</Note>
        ) : (
          <LayoutPicker layouts={layouts} settings={settings} />
        )}
      </Group>
      <Caption>A new layout applies in a moment, to every app.</Caption>
    </Page>
  );
}
