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

import { Button, Sheet, Switch, useColors } from "@dashi/ui";
import { ScrollView, Svg, Text, View } from "@mirinjs/metal";
import { useSyncExternalStore } from "react";
import type { Source } from "../../../src/shared/software/index.ts";
import { useCatalog } from "./catalog-hooks.ts";
import { SOURCES } from "./glyphs.ts";
import { sourceJob } from "./package-actions.ts";
import { useServices } from "./services.ts";

function SourceRow({ source, busy, onToggle }: { source: Source; busy: boolean; onToggle: (on: boolean) => void }) {
  const colors = useColors();
  const always = !source.switchable;
  const note = always ? `${source.note} · always on` : source.note;
  return (
    <View
      testID={`source:${source.id}`}
      style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 50, paddingHorizontal: 12, paddingVertical: 6 }}
    >
      <View style={{ width: 30, height: 30, borderRadius: 7, backgroundColor: colors.button, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Svg markup={SOURCES} size={16} color={colors.text} />
      </View>
      <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: 1 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>
          {source.label}
        </Text>
        <Text numberOfLines={1} style={{ fontSize: 11, color: colors.textMuted }}>
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
    <Sheet testID="sources-sheet" width={560} onCancel={onClose}>
      <View style={{ flexDirection: "column", gap: 4 }}>
        <Text style={{ fontSize: 15, fontWeight: "bold", color: colors.text }}>Sources</Text>
        <Text style={{ fontSize: 12, color: colors.textMuted }}>Where the Store looks, in the order it prefers them when two have the same app.</Text>
      </View>
      <ScrollView style={{ maxHeight: 360, flexDirection: "column", marginTop: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.separator }}>
        {sources.map((source) => (
          <SourceRow key={source.id} source={source} busy={busy(source.id)} onToggle={(on) => store.enqueue(sourceJob(services, source, on))} />
        ))}
      </ScrollView>
      <View style={{ marginTop: 8 }}>
        <Text style={{ fontSize: 11, color: colors.textMuted }}>
          Turning a source off keeps what you got from it; it just stops updating. A COPR you enable in Terminal shows up here by itself.
        </Text>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 12 }}>
        <Button label="Done" testID="sources-sheet:done" primary onPress={onClose} />
      </View>
    </Sheet>
  );
}
