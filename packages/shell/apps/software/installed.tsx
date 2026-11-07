/**
 * Installed: every Flatpak app on the machine (the person's own and the
 * system's) with Open, Update and Remove…, and the menu bar applets below
 * them, from the catalog or added by hand. A change in progress is the
 * state chip, with its ×.
 */

import { Button, EmptyState, Group, glyphs, Loading, useColors } from "@dashi/ui";
import { ScrollView, Text, View } from "@mirinjs/metal";
import { useSyncExternalStore } from "react";
import type { InstalledApp } from "../../src/software/flatpak-parse.ts";
import { formatBytes } from "../../src/software/text.ts";
import { InstalledApplets } from "./applets/pages.tsx";
import { useAppletState } from "./applets/rows.tsx";
import { StateChip } from "./chip.tsx";
import { INSTALLED } from "./glyphs.ts";
import { SectionHeader } from "./heading.tsx";
import { useAppState, useInstalledIcon } from "./hooks.ts";
import { whereInstalled } from "./model.ts";
import { AppIcon, useActions } from "./parts.tsx";
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
      style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 60, paddingHorizontal: 12, paddingVertical: 8 }}
    >
      <View
        testID={`installed:${app.id}:open-page`}
        focusable
        accessibilityRole="button"
        accessibilityLabel={app.name}
        onPress={() => actions.openApp(app.id)}
        style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 12 }}
      >
        <AppIcon file={icon.file} url={icon.url} name={app.name} size={44} />
        <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: 1 }}>
          <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>
            {app.name}
          </Text>
          <Text numberOfLines={1} style={{ fontSize: 11, color: colors.textMuted }}>
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
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {status.kind === "update" && <Button label="Update" testID={`update:${app.id}`} primary onPress={() => actions.update(app, app.name)} />}
          <Button label="Open" testID={`open:${app.id}`} onPress={() => actions.launch(app.id)} />
          <Button label="Remove…" testID={`remove:${app.id}`} onPress={() => actions.remove(app)} />
        </View>
      )}
    </View>
  );
}

export function Installed({ query }: { query: string }) {
  const { store } = useServices();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const applets = useAppletState();
  const needle = query.trim().toLowerCase();
  if (state.installed === null && state.hasFlatpak) return <Loading label="Looking at your apps…" />;
  const apps = [...(state.installed ?? [])]
    .filter((app) => needle === "" || app.name.toLowerCase().includes(needle) || app.id.toLowerCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name));
  const appletCount = applets.installed.filter(
    (applet) => needle === "" || `${applet.manifest.name} ${applet.manifest.id}`.toLowerCase().includes(needle),
  ).length;
  if (apps.length === 0 && appletCount === 0) {
    return (
      <EmptyState
        testID="installed-empty"
        glyph={state.hasFlatpak ? INSTALLED : glyphs.WARNING}
        title={needle !== "" ? "No results" : state.hasFlatpak ? "No apps installed yet" : "Flatpak isn’t installed"}
        message={
          needle !== ""
            ? `Nothing you have matches “${query.trim()}”.`
            : state.hasFlatpak
              ? (state.installedError ?? "Apps and applets you get from Discover show up here.")
              : "Software installs apps with Flatpak. Install the flatpak package, then open Software again."
        }
      />
    );
  }
  return (
    <ScrollView testID="installed" style={{ flex: 1, flexDirection: "column", gap: 12, padding: 22 }}>
      {apps.length > 0 && appletCount > 0 && <SectionHeader title="Apps" />}
      {apps.length > 0 && (
        <Group testID="installed-list">
          {apps.map((app) => (
            <InstalledRow key={`${app.installation}:${app.id}`} app={app} />
          ))}
        </Group>
      )}
      {appletCount > 0 && <SectionHeader title="Menu bar applets" />}
      <InstalledApplets needle={needle} />
    </ScrollView>
  );
}
