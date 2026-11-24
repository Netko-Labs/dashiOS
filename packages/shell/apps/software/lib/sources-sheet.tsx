/**
 * Sources… (flows/store row 13, with the owner's decisions of 16 Nov): where
 * the Store looks, in the order it prefers them when two have the same app:
 * Flathub, Fedora, Dashi, Terra, RPM Fusion when it is there, and each COPR
 * the person enabled by hand, labelled with its owner/project and "Community
 * build, not reviewed by Fedora". Fedora and Dashi are always on; the others
 * have a switch, and turning a package source on or off asks for the
 * password (PackageKit's rule). There is no "Add a COPR": a COPR enabled
 * with `dnf copr enable` shows up here by itself.
 */

import { FormSheet, RADIUS, SPACE, Switch, TYPE, useColors, WEIGHT } from "@dashi/ui";
import { ScrollView, Svg, Text, View } from "@mirinjs/metal";
import { useSyncExternalStore } from "react";
import type { Source } from "../../../src/shared/software/index.ts";
import { useCatalog } from "./catalog-hooks.ts";
import { SOURCES } from "./glyphs.ts";
import { sourceJob } from "./package-actions.ts";
import { useServices } from "./services.ts";

/** A source's row: its height, its glyph's tile and the glyph; the list's most before it scrolls. */
const SOURCE_ROW = { height: 50, tile: 30, glyph: 16 } as const;
const LIST_MOST = 360;

function SourceRow({ source, busy, onToggle }: { source: Source; busy: boolean; onToggle: (on: boolean) => void }) {
  const colors = useColors();
  const always = !source.switchable;
  const note = always ? `${source.note} · always on` : source.note;
  return (
    <View
      testID={`source:${source.id}`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE.inset,
        minHeight: SOURCE_ROW.height,
        paddingHorizontal: SPACE.inset,
        paddingVertical: SPACE.s,
      }}
    >
      <View
        style={{
          width: SOURCE_ROW.tile,
          height: SOURCE_ROW.tile,
          borderRadius: RADIUS.control,
          backgroundColor: colors.button,
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Svg markup={SOURCES} size={SOURCE_ROW.glyph} color={colors.text} />
      </View>
      <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: SPACE.px }}>
        <Text numberOfLines={1} style={{ fontSize: TYPE.body.size, fontWeight: WEIGHT.semibold, color: colors.text }}>
          {source.label}
        </Text>
        <Text numberOfLines={1} style={{ fontSize: TYPE.caption.size, color: colors.textMuted }}>
          {busy ? "Changing…" : note}
        </Text>
      </View>
      <Switch testID={`source-switch:${source.id}`} label={source.label} on={source.enabled} disabled={always || busy} onChange={onToggle} />
    </View>
  );
}

export function SourcesSheet({ onClose }: { onClose: () => void }) {
  const colors = useColors();
  const services = useServices();
  const { store } = services;
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const sources = useCatalog()?.sources ?? [];
  const busy = (id: string): boolean => state.operations.some((operation) => operation.key === `source:${id}`);
  return (
    <FormSheet
      testID="sources-sheet"
      width={560}
      title="Sources"
      buttons={[{ label: "Done", testID: "sources-sheet:done", kind: "primary", cancel: true, onPress: onClose }]}
    >
      <Text style={{ fontSize: TYPE.secondary.size, color: colors.textMuted }}>
        Where the Store looks, in the order it prefers them when two have the same app.
      </Text>
      <ScrollView style={{ maxHeight: LIST_MOST, flexDirection: "column", borderRadius: RADIUS.card, borderWidth: 1, borderColor: colors.separator }}>
        {sources.map((source) => (
          <SourceRow key={source.id} source={source} busy={busy(source.id)} onToggle={(on) => store.enqueue(sourceJob(services, source, on))} />
        ))}
      </ScrollView>
      <Text style={{ fontSize: TYPE.caption.size, color: colors.textMuted }}>
        Turning a source off keeps what you got from it; it just stops updating. A COPR you enable in Terminal shows up here by itself.
      </Text>
    </FormSheet>
  );
}
