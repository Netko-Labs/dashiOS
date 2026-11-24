/** Settings › Agents, Work alone's smaller parts (agents-alone.tsx): several choices as the kit's checkboxes, and the field that adds a site. */

import { Checkbox, SPACE, TextField, TYPE } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { useColors } from "../../colors.ts";
import { siteToAdd } from "./agents-sites.tsx";
import { MiniButton } from "./parts.tsx";

/** A tick's measures: at least 210 wide so they stand in columns, 16 between columns (the box and its words are the kit's Checkbox). */
export const TICK = { width: 210, columns: SPACE.page } as const;

/** Several of many (UI-10): the kit's checkboxes in the panel look, side by side, wrapping into columns. */
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
    <View testID={testID} style={{ flexDirection: "row", flexWrap: "wrap", columnGap: TICK.columns, alignSelf: "stretch" }}>
      {options.map(({ value, label }) => (
        <View key={value} style={{ minWidth: TICK.width }}>
          <Checkbox look="panel" testID={`${testID}:${value}`} label={label} checked={chosen.has(value)} onChange={(on) => onChange(value, on)} />
        </View>
      ))}
    </View>
  );
}

/** "Add…", then a field for an address or a host; a site already offered says so. */
export function AddSite({ listed, onAdd }: { listed: readonly string[]; onAdd: (site: string) => void }) {
  const colors = useColors();
  const [adding, setAdding] = useState<string | null>(null);
  if (adding === null) {
    return (
      <View style={{ flexDirection: "row" }}>
        <MiniButton testID="alone-site-add" label="Add…" onPress={() => setAdding("")} />
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
    <View style={{ flexDirection: "column", gap: SPACE.xs, alignSelf: "stretch" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.m }}>
        <TextField
          look="panel"
          testID="alone-site-field"
          value={adding}
          autoFocus
          placeholder="A site, like bodytech.com.co"
          onChangeText={setAdding}
          onSubmit={add}
        />
        <MiniButton testID="alone-site-add-button" label="Add" tone="primary" disabled={!("site" in wanted)} onPress={add} />
        <MiniButton testID="alone-site-cancel" label="Cancel" onPress={() => setAdding(null)} />
      </View>
      {"problem" in wanted && wanted.problem !== null && <Text style={{ fontSize: TYPE.panel.detail.size, color: colors.textMuted }}>{wanted.problem}</Text>}
    </View>
  );
}
