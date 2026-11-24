/**
 * Installed: every Flatpak app on the machine (the person's own and the
 * system's) with Open, Update and Remove…, and the add-ons below them under
 * what they are (launcher extensions, then menu bar applets), from the catalog or added by hand. A change in progress is the
 * state chip, with its ×.
 */

import { Button, EmptyState, ErrorState, Group, Loading, NoResults, SPACE, TYPE, useColors, WEIGHT } from "@dashi/ui";
import { ScrollView, Text, View } from "@mirinjs/metal";
import { useSyncExternalStore } from "react";
import { formatBytes, type InstalledApp } from "../../../src/shared/software/index.ts";
import { ADD_ON_HEADINGS, ADD_ON_KINDS, type AddOnKind, InstalledApplets, kindOfInstalled } from "./applets/pages.tsx";
import { useAppletState } from "./applets/rows.tsx";
import { useCatalog } from "./catalog-hooks.ts";
import { StateChip } from "./chip.tsx";
import { INSTALLED } from "./glyphs.ts";
import { SectionHeader } from "./heading.tsx";
import { useAppState, useInstalledIcon } from "./hooks.ts";
import { InstalledPackages } from "./installed-packages.tsx";
import { whereInstalled } from "./model.ts";
import { AppIcon, ROW, useActions } from "./parts.tsx";
import { useServices } from "./services.ts";

export function InstalledRow({ app }: { app: InstalledApp }) {
  const colors = useColors();
  const actions = useActions();
  const status = useAppState(app.id);
  const icon = useInstalledIcon(app);
  const detail = [app.version, app.size === null ? null : formatBytes(app.size), whereInstalled(app)].filter((part): part is string => !!part).join(" · ");
  return (
    <View
      testID={`installed:${app.id}`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE.inset,
        minHeight: ROW.minHeight,
        paddingHorizontal: SPACE.inset,
        paddingVertical: SPACE.m,
      }}
    >
      <View
        testID={`installed:${app.id}:open-page`}
        focusable
        accessibilityRole="button"
        accessibilityLabel={app.name}
        onPress={() => actions.openApp(app.id)}
        style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: SPACE.inset }}
      >
        <AppIcon file={icon.file} url={icon.url} name={app.name} size={ROW.icon} />
        <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: SPACE.px }}>
          <Text numberOfLines={1} style={{ fontSize: TYPE.body.size, fontWeight: WEIGHT.semibold, color: colors.text }}>
            {app.name}
          </Text>
          <Text numberOfLines={1} style={{ fontSize: TYPE.caption.size, color: colors.textMuted }}>
            {detail}
          </Text>
        </View>
      </View>
      {status.kind === "busy" ? (
        <StateChip
          chip={{ kind: "busy", operation: status.operation }}
          testID={`installed:${app.id}:chip`}
          onCancel={() => actions.cancel(status.operation.key)}
        />
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.m, flexShrink: 0 }}>
          {status.kind === "update" && <Button label="Update" testID={`update:${app.id}`} primary onPress={() => actions.update(app, app.name)} />}
          <Button label="Open" testID={`open:${app.id}`} onPress={() => actions.launch(app.id)} />
          <Button label="Remove…" testID={`remove:${app.id}`} onPress={() => actions.remove(app)} />
        </View>
      )}
    </View>
  );
}

/** How many add-ons of each kind match `needle`. */
function addOnCounts(applets: ReturnType<typeof useAppletState>, needle: string): Record<AddOnKind, number> {
  const hit = (words: string) => needle === "" || words.toLowerCase().includes(needle);
  const counts: Record<AddOnKind, number> = { extensions: 0, applets: 0, widgets: 0 };
  for (const applet of applets.installed) if (hit(`${applet.manifest.name} ${applet.manifest.id}`)) counts[kindOfInstalled(applet)]++;
  counts.applets += applets.unreadable.filter((applet) => hit(`${applet.name ?? ""} ${applet.id}`)).length;
  return counts;
}

export function Installed({ query }: { query: string }) {
  const { store } = useServices();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const applets = useAppletState();
  const needle = query.trim().toLowerCase();
  const catalog = useCatalog();
  const hasPackages =
    catalog?.entries.some(
      (entry) =>
        entry.kind === "app" &&
        (needle === "" || entry.name.toLowerCase().includes(needle)) &&
        entry.offers.some((offer) => offer.kind === "rpm" && offer.installed && !offer.cameWithSystem && !offer.dependency),
    ) ?? false;
  if (state.installed === null && state.hasFlatpak) return <Loading label="Looking at your apps…" />;
  const apps = [...(state.installed ?? [])]
    .filter((app) => needle === "" || app.name.toLowerCase().includes(needle) || app.id.toLowerCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name));
  const counts = addOnCounts(applets, needle);
  const appletCount = counts.extensions + counts.applets + counts.widgets;
  if (apps.length === 0 && appletCount === 0 && !hasPackages) {
    if (needle !== "") return <NoResults query={query} />;
    if (!state.hasFlatpak || state.installedError) {
      return (
        <ErrorState
          testID="installed-empty"
          title={state.hasFlatpak ? "Your apps couldn’t be listed" : "Flatpak isn’t installed"}
          message={state.installedError ?? "The Store installs Flathub’s apps with Flatpak. Install the flatpak package, then open the Store again."}
        />
      );
    }
    return (
      <EmptyState testID="installed-empty" glyph={INSTALLED} title="No apps installed yet" message="Apps and applets you get from Discover show up here." />
    );
  }
  return (
    <ScrollView testID="installed" style={{ flex: 1, flexDirection: "column", gap: SPACE.inset, padding: SPACE.sheet }}>
      {apps.length > 0 && appletCount > 0 && <SectionHeader title="Apps" />}
      {apps.length > 0 && (
        <Group testID="installed-list">
          {apps.map((app) => (
            <InstalledRow key={`${app.installation}:${app.id}`} app={app} />
          ))}
        </Group>
      )}
      <InstalledPackages needle={needle} />
      {ADD_ON_KINDS.map((kind) =>
        counts[kind] > 0 ? (
          <View key={kind} style={{ flexDirection: "column", gap: SPACE.inset }}>
            <SectionHeader title={ADD_ON_HEADINGS[kind]} />
            <InstalledApplets needle={needle} kind={kind} />
          </View>
        ) : null,
      )}
    </ScrollView>
  );
}
