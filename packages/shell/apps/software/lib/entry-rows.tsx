/**
 * A row of the catalog on this computer in a list: an app as a card (its
 * icon, name, summary, and the line that says where it comes from: "Fedora
 * package · also in Flathub"), a command-line tool as a short row ("In
 * Terminal"). The chip acts on the row's default source; its page shows the
 * others.
 */

import { Group, useColors, useSurface } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { useState } from "react";
import type { CatalogEntry, Source } from "../../../src/shared/software/index.ts";
import { columnsFor } from "./cards.tsx";
import { useOfferState } from "./catalog-hooks.ts";
import { StateChip } from "./chip.tsx";
import { TERMINAL } from "./glyphs.ts";
import { VerifiedBadge } from "./marks.tsx";
import { appChip, type Chip } from "./model.ts";
import { AppIcon, ROW, useActions } from "./parts.tsx";
import { sourceLine } from "./source-words.ts";

/** The chip for a row's default source, and what pressing it does. */
function useEntryChip(entry: CatalogEntry): { chip: Chip | null; press: () => void; cancel?: () => void } {
  const actions = useActions();
  const offer = entry.offers[0];
  const { flatpak, rpm } = useOfferState(offer);
  if (!offer) return { chip: null, press: () => {} };
  if (flatpak) {
    const press = (): void => {
      if (flatpak.kind === "get") actions.install(offer.ref, entry.name);
      else if (flatpak.kind === "open") actions.launch(offer.ref);
      else if (flatpak.kind === "update") actions.update(flatpak.installed, entry.name);
    };
    return { chip: appChip(flatpak), press, ...(flatpak.kind === "busy" ? { cancel: () => actions.cancel(flatpak.operation.key) } : {}) };
  }
  if (rpm?.kind === "busy") return { chip: { kind: "busy", operation: rpm.operation }, press: () => {}, cancel: () => actions.cancel(rpm.operation.key) };
  if (rpm?.kind === "installed") {
    return entry.kind === "app" && entry.desktopId !== null
      ? { chip: { kind: "open" }, press: () => actions.openPackage(entry) }
      : { chip: { kind: "installed" }, press: () => {} };
  }
  return { chip: { kind: "get", asks: true }, press: () => actions.getPackage(entry, offer) };
}

export function EntryCard({ entry, sources }: { entry: CatalogEntry; sources: readonly Source[] }) {
  const colors = useColors();
  const surface = useSurface();
  const actions = useActions();
  const { chip, press, cancel } = useEntryChip(entry);
  const icon = entry.icon?.startsWith("/") ? { file: entry.icon } : { url: entry.icon };
  return (
    <View
      testID={`entry:${entry.key}`}
      focusable
      accessibilityRole="button"
      accessibilityLabel={entry.name}
      onPress={() => actions.openEntry(entry.key)}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: 12,
        minWidth: 0,
        borderRadius: 10,
        backgroundColor: surface.card,
        borderWidth: 1,
        borderColor: colors.separator,
        hoverBackgroundColor: colors.tileHover,
      }}
    >
      <AppIcon {...icon} name={entry.name} size={48} />
      <View style={{ flex: 1, flexDirection: "column", gap: 2, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5, minWidth: 0 }}>
          <View style={{ flexShrink: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>
              {entry.name}
            </Text>
          </View>
          {entry.offers[0]?.verified && <VerifiedBadge size={12} />}
        </View>
        <Text numberOfLines={1} style={{ fontSize: 12, color: colors.textMuted }}>
          {entry.summary}
        </Text>
        <View testID={`entry-source:${entry.key}`} style={{ minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 11, color: colors.textMuted }}>
            {sourceLine(sources, entry)}
          </Text>
        </View>
      </View>
      {chip && <StateChip chip={chip} testID={`entry-pill:${entry.key}`} onPress={press} {...(cancel ? { onCancel: cancel } : {})} />}
    </View>
  );
}

export function EntryGrid({ entries, sources }: { entries: readonly CatalogEntry[]; sources: readonly Source[] }) {
  const [width, setWidth] = useState(800);
  const count = columnsFor(width);
  return (
    <View
      testID="entry-grid"
      focusGroup
      onLayout={(bounds) => setWidth(bounds.width)}
      style={{ display: "grid", gridTemplateColumns: Array.from({ length: count }, () => "1fr" as const), gap: 12, flexShrink: 0 }}
    >
      {entries.map((entry) => (
        <EntryCard key={entry.key} entry={entry} sources={sources} />
      ))}
    </View>
  );
}

function ToolRow({ entry, sources }: { entry: CatalogEntry; sources: readonly Source[] }) {
  const colors = useColors();
  const actions = useActions();
  const { chip, press, cancel } = useEntryChip(entry);
  return (
    <View
      testID={`tool:${entry.name}`}
      style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: ROW.minHeight - 8, paddingHorizontal: 12, paddingVertical: 6 }}
    >
      <View
        testID={`tool-open:${entry.name}`}
        focusable
        accessibilityRole="button"
        accessibilityLabel={entry.name}
        onPress={() => actions.openEntry(entry.key)}
        style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 12 }}
      >
        <View style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: "#1f1f1f", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Svg markup={TERMINAL} size={18} color="#ffffff" />
        </View>
        <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: 1 }}>
          <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>
            {entry.name}
          </Text>
          <Text numberOfLines={1} style={{ fontSize: 11, color: colors.textMuted }}>
            {[entry.summary, sourceLine(sources, entry)].filter(Boolean).join(" · ")}
          </Text>
        </View>
      </View>
      {chip && <StateChip chip={chip} testID={`entry-pill:${entry.key}`} onPress={press} {...(cancel ? { onCancel: cancel } : {})} />}
    </View>
  );
}

/** Command-line tools, one short row each, in one card. */
export function ToolRows({ entries, sources }: { entries: readonly CatalogEntry[]; sources: readonly Source[] }) {
  return (
    <Group testID="tool-rows">
      {entries.map((entry) => (
        <ToolRow key={entry.key} entry={entry} sources={sources} />
      ))}
    </Group>
  );
}
