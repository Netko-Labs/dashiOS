/**
 * An applet in a list: its icon, name, what it does and who made it (with
 * Dashi's reviewed seal), and the state chip. Grouped rows in an app's row
 * geometry (`ROW`), as Installed and Updates draw apps.
 */

import { Group, useColors } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { useSyncExternalStore } from "react";
import type { StoreApplet } from "../../../src/shared/applet-store/index.ts";
import { StateChip } from "../chip.tsx";
import { CHECK_MARK } from "../glyphs.ts";
import { SectionHeader } from "../heading.tsx";
import { useSelected } from "../hooks.ts";
import { ReviewedSeal } from "../marks.tsx";
import { appletOperation, type Operation } from "../model.ts";
import { AppIcon, ROW, useActions } from "../parts.tsx";
import { useServices } from "../services.ts";
import type { AppletState } from "./store.ts";
import { appletChip } from "./words.ts";

export function useAppletState(): AppletState {
  const { applets } = useServices();
  return useSyncExternalStore(applets.subscribe, applets.getSnapshot);
}

/** The change running or waiting for applet `id`, re-rendering only when it changes. */
export function useAppletOperation(id: string): Operation | undefined {
  const { store } = useServices();
  return useSelected(
    store,
    (state) => appletOperation(state.operations, id),
    (operation) => (operation ? `${operation.key}:${operation.status}:${operation.progress?.fraction ?? ""}` : ""),
  );
}

/** The chip for `entry`, with what pressing it does. */
export function AppletChip({ entry, testID, wide }: { entry: StoreApplet; testID: string; wide?: boolean }) {
  const { applets } = useServices();
  const actions = useActions();
  useAppletState();
  const operation = useAppletOperation(entry.manifest.id);
  const chip = appletChip(applets.status(entry), operation, applets.needsConsent(entry));
  return (
    <StateChip
      chip={chip}
      testID={testID}
      wide={wide}
      onPress={() => actions.getApplet(entry)}
      {...(operation ? { onCancel: () => actions.cancel(operation.key) } : {})}
    />
  );
}

/** "Made for this computer", with the check, in moss: it is good news, not a selection. */
export function ForHere() {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
      <Svg markup={CHECK_MARK} size={10} color={colors.moss} />
      <Text style={{ fontSize: 11, color: colors.moss }}>Made for this computer</Text>
    </View>
  );
}

export function AppletRow({ entry }: { entry: StoreApplet }) {
  const colors = useColors();
  const actions = useActions();
  const { applets } = useServices();
  useAppletState();
  const { manifest } = entry;
  const here = manifest.when !== undefined && applets.fitsHere(entry) === true;
  return (
    <View
      testID={`applet:${manifest.id}`}
      style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: ROW.minHeight, paddingHorizontal: 12, paddingVertical: 8 }}
    >
      <View
        testID={`applet:${manifest.id}:open`}
        focusable
        accessibilityRole="button"
        accessibilityLabel={manifest.name}
        onPress={() => actions.openApplet(manifest.id)}
        style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 12 }}
      >
        <AppIcon url={entry.icon ?? null} name={manifest.name} size={ROW.icon} source="applets" />
        <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>
              {manifest.name}
            </Text>
            {entry.reviewed && <ReviewedSeal size={12} />}
            {here && <ForHere />}
          </View>
          <Text numberOfLines={1} style={{ fontSize: 11, color: colors.textMuted }}>
            {/* An added catalog's applet says whose list it is on first, where a long summary can't cut it off (never Dashi's review mark). */}
            {`${entry.from.builtIn ? "" : `From ${entry.from.name} · `}${manifest.summary} · ${manifest.author.name}`}
          </Text>
        </View>
      </View>
      <AppletChip entry={entry} testID={`get:${manifest.id}`} />
    </View>
  );
}

/** A titled group of rows; nothing when there are none. */
export function AppletGroup({ title, detail, entries, testID }: { title?: string; detail?: string; entries: readonly StoreApplet[]; testID: string }) {
  if (entries.length === 0) return null;
  return (
    <View style={{ flexShrink: 0, flexDirection: "column", gap: 8 }}>
      {title !== undefined && <SectionHeader title={title} {...(detail === undefined ? {} : { detail })} />}
      <Group testID={testID}>
        {entries.map((entry) => (
          <AppletRow key={entry.manifest.id} entry={entry} />
        ))}
      </Group>
    </View>
  );
}
