/**
 * A row of the catalog on this computer in a list: an app as a card (its
 * icon, name, summary, and the line that says where it comes from: "Fedora
 * package · also in Flathub"), a command-line tool as a short row ("In
 * Terminal"). The chip acts on the row's default source; its page shows the
 * others.
 */

import { Group, INK_TILE, ON_TINT, RADIUS, SPACE, TYPE, useColors, useSurface, WEIGHT } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { useState } from "react";
import type { CatalogEntry, Source } from "../../../src/shared/software/index.ts";
import { columnsFor } from "./cards.tsx";
import { useOfferState } from "./catalog-hooks.ts";
import { StateChip } from "./chip.tsx";
import { TERMINAL } from "./glyphs.ts";
import { VerifiedMark } from "./marks.tsx";
import { appChip, type Chip } from "./model.ts";
import { AppIcon, iconRadius, ROW, useActions } from "./parts.tsx";
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

/** A card's icon; a tool's graphite tile and its glyph (the terminal tools' tile, INK_TILE). */
const ENTRY_ICON = 48;
const TOOL_TILE = 36;
const TOOL_GLYPH = 18;

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
      accessibilityRole="listitem"
      accessibilityLabel={entry.name}
      onPress={() => actions.openEntry(entry.key)}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE.inset,
        padding: SPACE.inset,
        minWidth: 0,
        borderRadius: RADIUS.card,
        backgroundColor: surface.card,
        borderWidth: 1,
        borderColor: colors.separator,
        hoverBackgroundColor: colors.tileHover,
      }}
    >
      <AppIcon {...icon} name={entry.name} size={ENTRY_ICON} />
      <View style={{ flex: 1, flexDirection: "column", gap: SPACE.xxs, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xs, minWidth: 0 }}>
          <View style={{ flexShrink: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: TYPE.body.size, fontWeight: WEIGHT.semibold, color: colors.text }}>
              {entry.name}
            </Text>
          </View>
          {entry.offers[0]?.verified && <VerifiedMark size={TYPE.secondary.size} />}
        </View>
        <Text numberOfLines={1} style={{ fontSize: TYPE.secondary.size, color: colors.textMuted }}>
          {entry.summary}
        </Text>
        <View testID={`entry-source:${entry.key}`} style={{ minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: TYPE.caption.size, color: colors.textMuted }}>
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
      accessibilityRole="list"
      onLayout={(bounds) => setWidth(bounds.width)}
      style={{ display: "grid", gridTemplateColumns: Array.from({ length: count }, () => "1fr" as const), gap: SPACE.inset, flexShrink: 0 }}
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
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE.inset,
        minHeight: ROW.minHeight - SPACE.m,
        paddingHorizontal: SPACE.inset,
        paddingVertical: SPACE.s,
      }}
    >
      <View
        testID={`tool-open:${entry.name}`}
        focusable
        accessibilityRole="button"
        accessibilityLabel={entry.name}
        onPress={() => actions.openEntry(entry.key)}
        style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: SPACE.inset }}
      >
        <View
          style={{
            width: TOOL_TILE,
            height: TOOL_TILE,
            borderRadius: iconRadius(TOOL_TILE),
            backgroundColor: INK_TILE,
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Svg markup={TERMINAL} size={TOOL_GLYPH} color={ON_TINT} />
        </View>
        <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: SPACE.px }}>
          <Text numberOfLines={1} style={{ fontSize: TYPE.body.size, fontWeight: WEIGHT.semibold, color: colors.text }}>
            {entry.name}
          </Text>
          <Text numberOfLines={1} style={{ fontSize: TYPE.caption.size, color: colors.textMuted }}>
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
