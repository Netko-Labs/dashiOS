/**
 * Updates: the apps (Flatpak) and the system's own packages (PackageKit) that
 * have newer versions. Nothing updates by itself: each button is the person's
 * say-so, and the system update asks for their password through polkit. After
 * an update that touched the kernel or the core libraries, a note says to
 * restart.
 */

import { ScrollView, Text, View } from "@mirinjs/metal";
import { type ReactNode, useSyncExternalStore } from "react";
import type { FlatpakUpdate } from "../../src/software/flatpak-parse.ts";
import { formatBytes } from "../../src/software/text.ts";
import { Button, EmptyState, glyphs, Group, useColors } from "@dashi/ui";
import { ago } from "./format.ts";
import { UPDATES } from "./glyphs.ts";
import { busyLabel, type Operation } from "./model.ts";
import { AppIcon, ProgressBar, useActions } from "./parts.tsx";
import { useServices } from "./services.ts";
import { Loading } from "./states.tsx";
import { useCatalogIcon } from "./hooks.ts";

const SHOWN_PACKAGES = 8;

function Heading({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  const colors = useColors();
  return (
    <View style={{ flexShrink: 0, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginTop: 6 }}>
      <View style={{ flexDirection: "column", gap: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 17, fontWeight: "bold", color: colors.text }}>{title}</Text>
        {detail !== undefined && <Text style={{ fontSize: 12, color: colors.textMuted }}>{detail}</Text>}
      </View>
      {action}
    </View>
  );
}

function Busy({ operation, width = 150 }: { operation: Operation; width?: number }) {
  const colors = useColors();
  return (
    <View testID={`busy:${operation.key}`} style={{ width, flexShrink: 0, flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <Text style={{ fontSize: 11, color: colors.textMuted }}>{busyLabel(operation)}</Text>
      <ProgressBar fraction={operation.status === "running" ? (operation.progress?.fraction ?? null) : null} width={width} />
    </View>
  );
}

function AppUpdateRow({ update, operation }: { update: FlatpakUpdate; operation: Operation | undefined }) {
  const colors = useColors();
  const actions = useActions();
  const { store } = useServices();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const icon = useCatalogIcon(update.id, true);
  const have = state.installed?.find((app) => app.id === update.id && app.installation === update.installation);
  const detail = [
    have?.version && update.version ? `${have.version} → ${update.version}` : update.version,
    update.downloadSize === null ? null : formatBytes(update.downloadSize),
    update.installation === "system" ? "for everyone" : null,
  ]
    .filter((part): part is string => !!part)
    .join(" · ");
  return (
    <View
      testID={`app-update:${update.id}`}
      style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingHorizontal: 12, paddingVertical: 8 }}
    >
      <View onPress={() => actions.openApp(update.id)} style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 12 }}>
        <AppIcon url={icon} name={update.name} size={40} />
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
        <Busy operation={operation} width={120} />
      ) : (
        <Button
          label="Update"
          testID={`update:${update.id}`}
          primary
          onPress={() => {
            const app = state.installed?.find((each) => each.id === update.id && each.installation === update.installation);
            if (app) actions.update(app, update.name);
          }}
        />
      )}
    </View>
  );
}

export function Updates({ onRestart, onUpdateSystem }: { onRestart: () => void; onUpdateSystem: () => void }) {
  const colors = useColors();
  const { store } = useServices();
  const actions = useActions();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const appUpdates = state.appUpdates ?? [];
  const system = state.system?.updates ?? [];
  const systemOp = state.operations.find((operation) => operation.kind === "system-update");
  const restartLikely = (state.system?.restartCauses.length ?? 0) > 0;

  if (state.checkedAt === null && state.checking) return <Loading what="Checking for updates…" />;
  const errors = [state.appUpdatesError && `Apps: ${state.appUpdatesError}`, state.systemError && `System: ${state.systemError}`].filter(
    (line): line is string => !!line,
  );
  const appsOp = (installation: string): Operation | undefined =>
    state.operations.find((operation) => operation.kind === "update" && operation.id === undefined && operation.key === `update:${installation}:*`);
  const nothing = appUpdates.length === 0 && system.length === 0;
  const installations = [...new Set(appUpdates.map((update) => update.installation))];

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
        <View testID="updates-errors" style={{ flexShrink: 0, padding: 10, borderRadius: 8, backgroundColor: colors.button }}>
          <Text style={{ fontSize: 12, color: colors.textMuted }}>{`Couldn't check everything. ${errors.join(" ")}`}</Text>
        </View>
      )}
      {nothing && (
        <View style={{ height: 300, flexShrink: 0 }}>
          <EmptyState
            testID="up-to-date"
            glyph={errors.length > 0 ? glyphs.WARNING : UPDATES}
            title={errors.length > 0 ? "Updates couldn't be checked" : "Everything is up to date"}
            message={
              errors.length > 0
                ? undefined
                : `Checked ${ago(state.checkedAt, Date.now())}. Updates never install on their own: they wait here until you choose them.`
            }
          />
        </View>
      )}
      {system.length > 0 && (
        <>
          <Heading
            title="System"
            detail={`${system.length} ${system.length === 1 ? "update" : "updates"} to the system's own software${restartLikely ? ", including the kernel or core libraries" : ""}`}
          />
          <Group testID="system-updates">
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingHorizontal: 12, paddingVertical: 8 }}>
              <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>System Software</Text>
                <Text style={{ fontSize: 11, color: colors.textMuted }}>
                  You'll be asked for your password. {restartLikely ? "A restart finishes the update." : ""}
                </Text>
              </View>
              {systemOp ? <Busy operation={systemOp} /> : <Button label="Update All" testID="update-system" primary onPress={onUpdateSystem} />}
            </View>
            {system.slice(0, SHOWN_PACKAGES).map((update) => (
              <View key={`${update.name}.${update.arch}`} style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 28, paddingHorizontal: 12 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontSize: 12, color: colors.text }}>
                    {update.name}
                  </Text>
                </View>
                <View style={{ width: 180, flexShrink: 1 }}>
                  <Text numberOfLines={1} style={{ fontSize: 11, color: colors.textMuted }}>
                    {update.version}
                  </Text>
                </View>
                <View style={{ width: 84 }}>
                  <Text numberOfLines={1} style={{ fontSize: 11, color: update.kind === "Security" ? colors.critical : colors.textMuted }}>
                    {update.kind === "Available" ? "" : update.kind}
                  </Text>
                </View>
              </View>
            ))}
            {system.length > SHOWN_PACKAGES && (
              <View style={{ minHeight: 28, justifyContent: "center", paddingHorizontal: 12 }}>
                <Text style={{ fontSize: 11, color: colors.textMuted }}>{`and ${system.length - SHOWN_PACKAGES} more`}</Text>
              </View>
            )}
          </Group>
        </>
      )}
      {appUpdates.length > 0 && (
        <>
          <Heading
            title="Apps"
            detail={`${appUpdates.length} ${appUpdates.length === 1 ? "update" : "updates"}`}
            action={
              installations.some((installation) => appsOp(installation)) ? undefined : (
                <Button
                  label="Update All"
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
              const operation = state.operations.find((each) => each.id === update.id) ?? appsOp(update.installation);
              return <AppUpdateRow key={`${update.installation}:${update.id}`} update={update} operation={operation} />;
            })}
          </Group>
        </>
      )}
    </ScrollView>
  );
}
