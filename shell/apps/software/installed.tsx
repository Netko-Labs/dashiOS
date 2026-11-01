/** Installed: every Flatpak app on the machine, the person's own and the system's, with Open, Update, and Remove. */

import { ScrollView, Text, View } from "@mirinjs/metal";
import { useMemo, useSyncExternalStore } from "react";
import type { InstalledApp } from "../../src/software/flatpak-parse.ts";
import { formatBytes } from "../../src/software/text.ts";
import { Button, EmptyState, Group, glyphs, useColors } from "../kit/index.ts";
import { localIcon } from "./format.ts";
import { INSTALLED } from "./glyphs.ts";
import { useCatalogIcon } from "./hooks.ts";
import { appState, busyLabel, whereInstalled } from "./model.ts";
import { AppIcon, ProgressBar, useActions } from "./parts.tsx";
import { useServices } from "./services.ts";
import { Loading } from "./states.tsx";

export function InstalledRow({ app }: { app: InstalledApp }) {
  const colors = useColors();
  const actions = useActions();
  const { store } = useServices();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const status = appState(app.id, state.installed ?? [], state.appUpdates ?? [], state.operations);
  const file = useMemo(() => localIcon(app), [app]);
  const remote = useCatalogIcon(app.id, file === null);
  const detail = [app.version, app.size === null ? null : formatBytes(app.size), whereInstalled(app)].filter((part): part is string => !!part).join(" · ");
  return (
    <View testID={`installed:${app.id}`} style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 60, paddingHorizontal: 12, paddingVertical: 8 }}>
      <View testID={`installed:${app.id}:open-page`} onPress={() => actions.openApp(app.id)} style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 12 }}>
        <AppIcon file={file} url={remote} name={app.name} size={44} />
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
        <View style={{ width: 130, flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <Text style={{ fontSize: 11, color: colors.textMuted }}>{busyLabel(status.operation)}</Text>
          <ProgressBar fraction={status.operation.status === "running" ? (status.operation.progress?.fraction ?? null) : null} width={130} />
        </View>
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {status.kind === "update" && <Button label="Update" testID={`update:${app.id}`} primary onPress={() => actions.update(app, app.name)} />}
          <Button label="Open" testID={`open:${app.id}`} onPress={() => actions.launch(app.id)} />
          <Button label="Remove" testID={`remove:${app.id}`} onPress={() => actions.remove(app)} />
        </View>
      )}
    </View>
  );
}

export function Installed({ query }: { query: string }) {
  const { store } = useServices();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  if (!state.hasFlatpak) {
    return <EmptyState title="Flatpak isn't installed" message="Software installs apps with Flatpak. Install the flatpak package, then open Software again." glyph={glyphs.WARNING} />;
  }
  if (state.installed === null) return <Loading what="Looking at your apps…" />;
  const needle = query.trim().toLowerCase();
  const apps = [...state.installed]
    .filter((app) => needle === "" || app.name.toLowerCase().includes(needle) || app.id.toLowerCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (apps.length === 0) {
    return (
      <EmptyState
        testID="installed-empty"
        glyph={INSTALLED}
        title={needle === "" ? "No apps installed yet" : "No Results"}
        message={needle === "" ? (state.installedError ?? "Apps you install from Discover show up here.") : `None of your apps match “${query.trim()}”.`}
      />
    );
  }
  return (
    <ScrollView testID="installed" style={{ flex: 1, flexDirection: "column", gap: 12, padding: 22 }}>
      <Group testID="installed-list">
        {apps.map((app) => (
          <InstalledRow key={`${app.installation}:${app.id}`} app={app} />
        ))}
      </Group>
    </ScrollView>
  );
}
