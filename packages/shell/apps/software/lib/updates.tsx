/**
 * Updates: the system's own packages (PackageKit), the apps (Flatpak), and
 * the menu bar applets that have newer versions, in one list under one
 * badge. Nothing updates by itself: each button is the person's say-so, the
 * system update asks for their password through polkit, and anything running
 * can be stopped from its row. After an update that touched the kernel or
 * the core libraries, a note says to restart.
 */

import { Button, Chip, type ChipTone, EmptyState, ErrorState, Group, Loading, MoreButton, Notice, SPACE, TYPE, useColors, WEIGHT } from "@dashi/ui";
import { ScrollView, Text, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { useState, useSyncExternalStore } from "react";
import { type FlatpakUpdate, formatBytes, isDashiRepo, plainFailure } from "../../../src/shared/software/index.ts";
import { AppletGroup } from "./applets/rows.tsx";
import { StateChip } from "./chip.tsx";
import { DashiUpdate } from "./dashi-update.tsx";
import { ago } from "./format.ts";
import { UPDATES } from "./glyphs.ts";
import { SectionHeader } from "./heading.tsx";
import { useInstalledIcon } from "./hooks.ts";
import type { Operation } from "./model.ts";
import { AppIcon, ROW, useActions } from "./parts.tsx";
import { useServices } from "./services.ts";
import type { SoftwareState } from "./store.ts";

const SHOWN_PACKAGES = 8;
/** The room an empty or failed page's state takes under Dashi's own row. */
const STATE_HEIGHT = 300;

/** What couldn't be checked, a sentence each. */
function checkErrors(state: SoftwareState): string[] {
  return [
    state.appUpdatesError && `Apps: ${plainFailure(state.appUpdatesError).message}`,
    state.systemError && `System: ${plainFailure(state.systemError).message}`,
  ].filter((line): line is string => !!line);
}

/**
 * The window's notice on Updates when part of the check failed but there are
 * updates to show (VS-3: a failure in the background floats, the page keeps
 * its content); with nothing to show, the page is the error state instead.
 */
export function updatesNotice(state: SoftwareState, updates: number, onCheck: () => void): ReactNode {
  const errors = checkErrors(state);
  if (errors.length === 0 || updates === 0) return null;
  return (
    <Notice
      testID="updates-errors"
      tone="error"
      text={`Not everything could be checked. ${errors.join(" ")}`}
      action={<Button label="Try again" testID="updates-errors:retry" size="small" onPress={onCheck} />}
    />
  );
}
/** A system package's name keeps at least this much of its row; its version gives way first. */
const SYSTEM_NAME_MIN = 110;
/** A system package's row, its version's column and its kind's. */
const SYSTEM_ROW = 28;
const VERSION_WIDTH = 180;
const KIND_WIDTH = 84;

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
        focusable
        accessibilityRole="button"
        accessibilityLabel={update.name}
        onPress={() => actions.openApp(update.id)}
        style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: SPACE.inset }}
      >
        <AppIcon file={icon.file} url={icon.url} name={update.name} size={ROW.icon} />
        <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: SPACE.px }}>
          <Text numberOfLines={1} style={{ fontSize: TYPE.body.size, fontWeight: WEIGHT.semibold, color: colors.text }}>
            {update.name}
          </Text>
          <Text numberOfLines={1} style={{ fontSize: TYPE.caption.size, color: colors.textMuted }}>
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

/** A package's kind as a status chip: "Security" in broth (it says why to update, it isn't an error); the plain kinds say nothing. */
const kindTone = (kind: string): ChipTone | null =>
  kind === "Available" || kind === "Normal" || kind === "" ? null : kind === "Security" ? "warning" : "neutral";

function SystemUpdates({ onUpdateSystem }: { onUpdateSystem: () => void }) {
  const colors = useColors();
  const { store } = useServices();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [all, setAll] = useState(false);
  // Dashi's own packages are their own row (dashi-update.tsx).
  const system = (state.system?.updates ?? []).filter((update) => !isDashiRepo(update.repo));
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
          <View
            key={`${update.name}.${update.arch}`}
            style={{ flexDirection: "row", alignItems: "center", gap: SPACE.inset, minHeight: SYSTEM_ROW, paddingHorizontal: SPACE.inset }}
          >
            {/* The name keeps room for itself; the version gives way first, with an ellipsis. */}
            <View style={{ flex: 1, minWidth: SYSTEM_NAME_MIN }}>
              <Text numberOfLines={1} style={{ fontSize: TYPE.secondary.size, color: colors.text }}>
                {update.name}
              </Text>
            </View>
            <View style={{ width: VERSION_WIDTH, flexShrink: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: TYPE.caption.size, color: colors.textMuted }}>
                {update.version}
              </Text>
            </View>
            <View style={{ width: KIND_WIDTH, flexShrink: 0, alignItems: "flex-start" }}>
              {kindTone(update.kind) !== null && <Chip label={update.kind} tone={kindTone(update.kind) ?? "neutral"} />}
            </View>
          </View>
        ))}
        {system.length > SHOWN_PACKAGES && (
          <View style={{ minHeight: SYSTEM_ROW, justifyContent: "center", paddingHorizontal: SPACE.inset }}>
            <MoreButton testID="system-updates:more" open={all} more={`Show all ${system.length}`} less="Show fewer" onPress={() => setAll((now) => !now)} />
          </View>
        )}
      </Group>
    </>
  );
}

function RestartNote({ onRestart }: { onRestart: () => void }) {
  const colors = useColors();
  return (
    <Group testID="restart-note">
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.inset, minHeight: 52, paddingHorizontal: SPACE.inset, paddingVertical: SPACE.m }}>
        <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: SPACE.px }}>
          <Text style={{ fontSize: TYPE.body.size, fontWeight: WEIGHT.semibold, color: colors.text }}>Restart to finish updating</Text>
          <Text style={{ fontSize: TYPE.caption.size, color: colors.textMuted }}>The kernel or core system libraries changed. Restart when it suits you.</Text>
        </View>
        <Button label="Restart…" testID="restart" primary onPress={onRestart} />
      </View>
    </Group>
  );
}

function AppletUpdates() {
  const { applets } = useServices();
  const actions = useActions();
  const appletUpdates = applets.updates();
  return (
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
  );
}

export interface UpdatesProps {
  onRestart: () => void;
  onUpdateSystem: () => void;
  onLogOut: () => void;
  /** Check again now (the toolbar's Check for updates). */
  onCheck: () => void;
}

export function Updates({ onRestart, onUpdateSystem, onLogOut, onCheck }: UpdatesProps) {
  const { store, applets } = useServices();
  const actions = useActions();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useSyncExternalStore(applets.subscribe, applets.getSnapshot);
  const appUpdates = state.appUpdates ?? [];
  const appletUpdates = applets.updates();
  const systemCount = state.system?.updates.length ?? 0;

  if (state.checkedAt === null && state.checking) return <Loading label="Checking for updates…" />;
  const errors = checkErrors(state);
  const appsOp = (installation: string): Operation | undefined =>
    state.operations.find((operation) => operation.kind === "update" && operation.id === undefined && operation.key === `update:${installation}:*`);
  const nothing = appUpdates.length === 0 && systemCount === 0 && appletUpdates.length === 0;
  const installations = [...new Set(appUpdates.map((update) => update.installation))];
  const allAppsOp = installations.map(appsOp).find((operation) => operation !== undefined);

  return (
    <ScrollView testID="updates" style={{ flex: 1, flexDirection: "column", gap: SPACE.button, padding: SPACE.sheet }}>
      {state.restartNeeded === true && <RestartNote onRestart={onRestart} />}
      {nothing && (
        <View style={{ height: STATE_HEIGHT, flexShrink: 0 }}>
          {errors.length > 0 ? (
            <ErrorState
              testID="up-to-date"
              title="Updates couldn’t be checked"
              message={errors.join(" ")}
              actions={<Button label="Try again" testID="retry" onPress={onCheck} />}
            />
          ) : (
            <EmptyState
              testID="up-to-date"
              glyph={UPDATES}
              title="Everything is up to date"
              message={`Checked ${ago(state.checkedAt, Date.now())}. Dashi looks once a day. Updates never install on their own.`}
            />
          )}
        </View>
      )}
      <DashiUpdate onLogOut={onLogOut} />
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
      {appletUpdates.length > 0 && <AppletUpdates />}
    </ScrollView>
  );
}
