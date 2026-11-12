/** Settings › Agents, Work alone's smaller parts (agents-alone.tsx): a ticked choice, the list of them, and the field that adds a site. */

import { Svg, Text, TextInput, View } from "@mirinjs/metal";
import { useState } from "react";
import { Button, useSurface } from "../../../shared/cards/index.ts";
import { useColors } from "../../colors.ts";
import { siteToAdd } from "./agents-sites.tsx";

const CHECK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" stroke="#000" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** A tick's measures: a 16 box, its words, 26 tall, at least 210 wide so they stand in columns. */
export const TICK = { box: 16, height: 26, width: 210, gap: 8 } as const;

/** One choice of several: a box, green with a tick when chosen (it is on), and its words. */
export function Tick({ label, on, testID, onChange }: { label: string; on: boolean; testID: string; onChange: (on: boolean) => void }) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      focusable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: on }}
      onPress={() => onChange(!on)}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: TICK.gap,
        height: TICK.height,
        minWidth: TICK.width,
        borderRadius: 6,
        focusRingColor: colors.focusRing,
      }}
    >
      <View
        style={{
          width: TICK.box,
          height: TICK.box,
          flexShrink: 0,
          borderRadius: 4,
          borderWidth: on ? 0 : 1.5,
          borderColor: colors.checkbox,
          backgroundColor: on ? colors.selection : "#00000000",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {on && <Svg markup={CHECK} size={12} color="#ffffff" />}
      </View>
      <Text numberOfLines={1} style={{ fontSize: 12.5, color: colors.text }}>
        {label}
      </Text>
    </View>
  );
}

/** Ticks side by side, wrapping into columns. */
export function Ticks<T extends string>({
  testID,
  options,
  chosen,
  onChange,
}: {
  testID: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  chosen: ReadonlySet<T>;
  onChange: (value: T, on: boolean) => void;
}) {
  return (
    <View testID={testID} style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 16, alignSelf: "stretch" }}>
      {options.map(({ value, label }) => (
        <Tick key={value} testID={`${testID}:${value}`} label={label} on={chosen.has(value)} onChange={(on) => onChange(value, on)} />
      ))}
    </View>
  );
}

/** "Add…", then a field for an address or a host; a site already offered says so. */
export function AddSite({ listed, onAdd }: { listed: readonly string[]; onAdd: (site: string) => void }) {
  const colors = useColors();
  const surface = useSurface();
  const [adding, setAdding] = useState<string | null>(null);
  if (adding === null) {
    return (
      <View style={{ flexDirection: "row" }}>
        <Button testID="alone-site-add" label="Add…" onPress={() => setAdding("")} />
      </View>
    );
  }
  const wanted = siteToAdd(adding, listed);
  const add = () => {
    if (!("site" in wanted)) return;
    onAdd(wanted.site);
    setAdding(null);
  };
  return (
    <View style={{ flexDirection: "column", gap: 4, alignSelf: "stretch" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ flex: 1, height: 28, justifyContent: "center", paddingHorizontal: 8, borderRadius: 8, backgroundColor: surface.field }}>
          <TextInput
            testID="alone-site-field"
            value={adding}
            autoFocus
            placeholder="A site, like bodytech.com.co"
            onChangeText={setAdding}
            onSubmitEditing={add}
            style={{ flex: 1, fontSize: 12, color: colors.text, placeholderColor: colors.textMuted, backgroundColor: "#00000000" }}
          />
        </View>
        <Button testID="alone-site-add-button" label="Add" primary disabled={!("site" in wanted)} onPress={add} />
        <Button testID="alone-site-cancel" label="Cancel" onPress={() => setAdding(null)} />
      </View>
      {"problem" in wanted && wanted.problem !== null && <Text style={{ fontSize: 11.5, color: colors.textMuted }}>{wanted.problem}</Text>}
    </View>
  );
}
