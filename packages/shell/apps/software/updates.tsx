/**
 * Updates: the system's own packages (PackageKit), the apps (Flatpak), and
 * the menu bar applets that have newer versions, in one list under one
 * badge. Nothing updates by itself: each button is the person's say-so, the
 * system update asks for their password through polkit, and anything running
 * can be stopped from its row. After an update that touched the kernel or
 * the core libraries, a note says to restart.
 */

import { Button, EmptyState, Group, glyphs, Loading, useColors } from "@dashi/ui";
import { ScrollView, Text, View } from "@mirinjs/metal";
import { useState, useSyncExternalStore } from "react";
import { plainFailure } from "../../src/software/failure-words.ts";
import type { FlatpakUpdate } from "../../src/software/flatpak-parse.ts";
import { formatBytes } from "../../src/software/text.ts";
import { AppletGroup } from "./applets/rows.tsx";
import { StateChip } from "./chip.tsx";
import { ago } from "./format.ts";
import { UPDATES } from "./glyphs.ts";
import { SectionHeader } from "./heading.tsx";
import { useInstalledIcon } from "./hooks.ts";
import type { Operation } from "./model.ts";
import { AppIcon, ROW, useActions } from "./parts.tsx";
import { useServices } from "./services.ts";

const SHOWN_PACKAGES = 8;
/** A system package's name keeps at least this much of its row; its version gives way first. */
const SYSTEM_NAME_MIN = 110;

function Busy({ operation, testID }: { operation: Operation; testID: string }) {
  const actions = useActions();
  return <StateChip chip={{ kind: "busy", operation }} testID={testID} onCancel={() => actions.cancel(operation.key)} />;
}

function AppUpdateRow({ update, operation }: { update: FlatpakUpdate; operation: Operation | undefined }) {
  const colors = useColors();
  const actions = useActions();
  const { store } = useServices();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const icon = useInstalledIcon(update);
  const have = state.installed?.find((app) => app.id === update.id && app.installation === update.installation);
  const detail = [
    // "to" in words: the arrow fell back to a face that sets it small and low.
    have?.version && update.version ? `${have.version} to ${update.version}` : update.version,
    update.downloadSize === null ? null : formatBytes(update.downloadSize),
    update.installation === "system" ? "for everyone" : null,
  ]
    .filter((part): part is string => !!part)
    .join(" · ");
  return (
    <View
      testID={`app-update:${update.id}`}
      style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: ROW.minHeight, paddingHorizontal: 12, paddingVertical: 8 }}
    >
      <View
        focusable
        accessibilityRole="button"
        accessibilityLabel={update.name}
        onPress={() => actions.openApp(update.id)}
        style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 12 }}
      >
        <AppIcon file={icon.file} url={icon.url} name={update.name} size={ROW.icon} />
        <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: 1 }}>
          <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>
            {update.name}
          </Text>
          <Text numberOfLines={1} style={{ fontSize: 11, color: colors.textMuted }}>
            {detail}
          </Text>
        </View>
      </View>
      {operation ? (
        <Busy operation={operation} testID={`busy:${operation.key}`} />
      ) : (
        <Button label="Update" testID={`update:${update.id}`} primary onPress={() => have && actions.update(have, update.name)} />
      )}
    </View>
  );
}

/** "Security" in broth, as a chip: it says why to update, it isn't an error. */
function KindChip({ kind }: { kind: string }) {
  const colors = useColors();
  if (kind === "Available" || kind === "Normal" || kind === "") return null;
  const security = kind === "Security";
  return (
    <View style={{ paddingHorizontal: 6, height: 18, justifyContent: "center", borderRadius: 9, backgroundColor: security ? colors.brothWash : colors.button }}>
      <Text style={{ fontSize: 11, color: security ? colors.broth : colors.textMuted }}>{kind}</Text>
    </View>
  );
}

function SystemUpdates({ onUpdateSystem }: { onUpdateSystem: () => void }) {
  const colors = useColors();
  const { store } = useServices();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [all, setAll] = useState(false);
  const system = state.system?.updates ?? [];
  const systemOp = state.operations.find((operation) => operation.kind === "system-update");
  const restartLikely = (state.system?.restartCauses.length ?? 0) > 0;
  const security = system.filter((update) => update.kind === "Security").length;
  if (system.length === 0) return null;
  const shown = all ? system : system.slice(0, SHOWN_PACKAGES);
  return (
    <>
      <SectionHeader
        title="System"
        detail={`${system.length} ${system.length === 1 ? "package" : "packages"}${security > 0 ? `, ${security} for security` : ""}${restartLikely ? ", including the kernel or core libraries" : ""}`}
        action={systemOp ? <Busy operation={systemOp} testID="busy:system" /> : <Button label="Update all…" testID="update-system" onPress={onUpdateSystem} />}
      />
      <Group testID="system-updates">
        {shown.map((update) => (
          <View key={`${update.name}.${update.arch}`} style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 28, paddingHorizontal: 12 }}>
            {/* The name keeps room for itself; the version gives way first, with an ellipsis. */}
            <View style={{ flex: 1, minWidth: SYSTEM_NAME_MIN }}>
              <Text numberOfLines={1} style={{ fontSize: 12, color: colors.text }}>
                {update.name}
              </Text>
            </View>
            <View style={{ width: 180, flexShrink: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: 11, color: colors.textMuted }}>
                {update.version}
              </Text>
            </View>
            <View style={{ width: 84, alignItems: "flex-start" }}>
              <KindChip kind={update.kind} />
            </View>
          </View>
        ))}
        {system.length > SHOWN_PACKAGES && (
          <View
            testID="system-updates:more"
            focusable
            accessibilityRole="button"
            onPress={() => setAll((now) => !now)}
            style={{ minHeight: 28, justifyContent: "center", paddingHorizontal: 12, hoverBackgroundColor: colors.button }}
          >
            <Text style={{ fontSize: 12, color: colors.accentInk }}>{all ? "Show fewer" : `Show all ${system.length}`}</Text>
          </View>
        )}
      </Group>
    </>
  );
}

export function Updates({ onRestart, onUpdateSystem }: { onRestart: () => void; onUpdateSystem: () => void }) {
  const colors = useColors();
  const { store, applets } = useServices();
  const actions = useActions();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useSyncExternalStore(applets.subscribe, applets.getSnapshot);
  const appUpdates = state.appUpdates ?? [];
  const appletUpdates = applets.updates();
  const systemCount = state.system?.updates.length ?? 0;

  if (state.checkedAt === null && state.checking) return <Loading label="Checking for updates…" />;
  const errors = [
    state.appUpdatesError && `Apps: ${plainFailure(state.appUpdatesError).message}`,
    state.systemError && `System: ${plainFailure(state.systemError).message}`,
  ].filter((line): line is string => !!line);
  const appsOp = (installation: string): Operation | undefined =>
    state.operations.find((operation) => operation.kind === "update" && operation.id === undefined && operation.key === `update:${installation}:*`);
  const nothing = appUpdates.length === 0 && systemCount === 0 && appletUpdates.length === 0;
  const installations = [...new Set(appUpdates.map((update) => update.installation))];
  const allAppsOp = installations.map(appsOp).find((operation) => operation !== undefined);

  return (
    <ScrollView testID="updates" style={{ flex: 1, flexDirection: "column", gap: 14, padding: 22 }}>
      {state.restartNeeded === true && (
        <Group testID="restart-note">
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, paddingHorizontal: 12, paddingVertical: 8 }}>
            <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: 1 }}>
              <Text style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>Restart to finish updating</Text>
              <Text style={{ fontSize: 11, color: colors.textMuted }}>The kernel or core system libraries changed. Restart when it suits you.</Text>
            </View>
            <Button label="Restart…" testID="restart" primary onPress={onRestart} />
          </View>
        </Group>
      )}
      {errors.length > 0 && (
        <View testID="updates-errors" style={{ flexShrink: 0 }}>
          <Text style={{ fontSize: 12, color: colors.broth }}>{`Not everything could be checked. ${errors.join(" ")}`}</Text>
        </View>
      )}
      {nothing && (
        <View style={{ height: 300, flexShrink: 0 }}>
          <EmptyState
            testID="up-to-date"
            glyph={errors.length > 0 ? glyphs.WARNING : UPDATES}
            title={errors.length > 0 ? "Updates couldn’t be checked" : "Everything is up to date"}
            message={errors.length > 0 ? undefined : `Checked ${ago(state.checkedAt, Date.now())}. Dashi looks once a day. Updates never install on their own.`}
          />
        </View>
      )}
      <SystemUpdates onUpdateSystem={onUpdateSystem} />
      {appUpdates.length > 0 && (
        <>
          <SectionHeader
            title="Apps"
            detail={`${appUpdates.length} ${appUpdates.length === 1 ? "update" : "updates"}`}
            action={
              allAppsOp ? (
                <Busy operation={allAppsOp} testID="busy:apps" />
              ) : (
                <Button
                  label="Update all"
                  testID="update-apps"
                  onPress={() => {
                    for (const installation of installations) actions.updateAll(installation);
                  }}
                />
              )
            }
          />
          <Group testID="app-updates">
            {appUpdates.map((update) => {
              const operation = state.operations.find((each) => each.id === update.id && each.subject !== "applet") ?? appsOp(update.installation);
              return <AppUpdateRow key={`${update.installation}:${update.id}`} update={update} operation={operation} />;
            })}
          </Group>
        </>
      )}
      {appletUpdates.length > 0 && (
        <>
          <SectionHeader
            title="Menu bar applets"
            detail={`${appletUpdates.length} ${appletUpdates.length === 1 ? "update" : "updates"}`}
            action={
              <Button
                label={appletUpdates.some((entry) => applets.needsConsent(entry)) ? "Update all…" : "Update all"}
                testID="update-applets"
                onPress={() => {
                  for (const entry of appletUpdates) actions.getApplet(entry);
                }}
              />
            }
          />
          <AppletGroup entries={appletUpdates} testID="applet-updates" />
        </>
      )}
    </ScrollView>
  );
}
