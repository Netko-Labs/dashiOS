/**
 * The menu bar applets' place in Software: the ones made for this computer
 * first, then the rest by category (there are few); and the applets on
 * Installed, from the catalog or added by hand, each opening its page. The
 * sidebar shows this place only while there is a catalog to show.
 */

import type { InstalledApplet, UnreadableApplet } from "@dashi/applet";
import { Button, EmptyState, Group, glyphs, Loading, useColors } from "@dashi/ui";
import { ScrollView, Text, View } from "@mirinjs/metal";
import type { StoreApplet } from "../../../../src/shared/applet-store/index.ts";
import { APPLETS, OFFLINE } from "../glyphs.ts";
import { useReportStale } from "../hooks.ts";
import { AppIcon, ROW, useActions } from "../parts.tsx";
import { useServices } from "../services.ts";
import { AppletGroup, useAppletState } from "./rows.tsx";
import { CATEGORY_LABELS, skippedWords } from "./words.ts";

const byName = (a: StoreApplet, b: StoreApplet): number => a.manifest.name.localeCompare(b.manifest.name);

/** Why there is no catalog, said where the applets would be: offline, or the catalog didn't check. */
export function AppletsProblem() {
  const { applets } = useServices();
  const { problem } = useAppletState();
  if (!problem) return null;
  if (problem.kind === "no-key")
    return (
      <EmptyState
        testID="applets-coming"
        glyph={APPLETS}
        title="Applets are coming soon"
        message="Dashi’s catalog isn’t open yet. Applets you add by hand work today, and Catalogs… adds one you were given."
      />
    );
  return (
    <EmptyState
      testID="applets-problem"
      glyph={problem.kind === "offline" ? OFFLINE : glyphs.WARNING}
      title={problem.kind === "offline" ? "You’re offline" : "The applet catalogs didn’t check out"}
      message={
        problem.kind === "offline"
          ? "Applets need the internet to be found. The ones you have keep working."
          : "Dashi couldn’t confirm the catalogs are the real ones, so nothing from them is shown. Try again in a minute."
      }
      action={<Button label="Try again" testID="retry" onPress={() => void applets.refresh()} />}
    />
  );
}

/** Menu bar applets: for this computer first, then each category, and under them how many this Dashi can't read, if any. */
export function AppletsPage() {
  const colors = useColors();
  const { applets } = useServices();
  const state = useAppletState();
  useReportStale(state.stale);
  if (state.index === null) return state.loading ? <Loading label="Loading the applets…" /> : <AppletsProblem />;
  const entries = [...state.index.applets].sort(byName);
  const forHere = entries.filter((entry) => entry.manifest.when !== undefined && applets.fitsHere(entry) === true);
  const rest = entries.filter((entry) => !forHere.includes(entry));
  const categories = Object.keys(CATEGORY_LABELS) as Array<keyof typeof CATEGORY_LABELS>;
  const skipped = skippedWords(state.skipped);
  return (
    <ScrollView testID="applets" style={{ flex: 1, flexDirection: "column", gap: 18, padding: 22 }}>
      <AppletGroup title="Made for this computer" detail="They know this machine’s hardware" entries={forHere} testID="for-here" />
      {categories.map((category) => (
        <AppletGroup
          key={category}
          title={CATEGORY_LABELS[category]}
          entries={rest.filter((entry) => entry.manifest.categories[0] === category)}
          testID={`applets:${category}`}
        />
      ))}
      <AppletGroup title="Other" entries={rest.filter((entry) => entry.manifest.categories.length === 0)} testID="applets:other" />
      {skipped !== null && (
        <View testID="applets-skipped" style={{ flexShrink: 0, paddingHorizontal: 12 }}>
          <Text style={{ fontSize: 11, color: colors.textMuted }}>{skipped}</Text>
        </View>
      )}
    </ScrollView>
  );
}

/** One installed applet on Installed: its icon, version and maker (or why it is off), its page, Remove…; an app's row geometry (`ROW`), so the two lists line up. */
function InstalledAppletRow({ applet, entry }: { applet: InstalledApplet; entry: StoreApplet | undefined }) {
  const colors = useColors();
  const actions = useActions();
  const { applets } = useServices();
  const origin = applets.originOf(applet);
  const from =
    origin.kind === "local"
      ? "added by hand"
      : origin.kind === "removed"
        ? "catalog removed"
        : origin.source.builtIn
          ? applet.manifest.author.name
          : `${applet.manifest.author.name} · From ${origin.source.name}`;
  const pulled = applet.record.disabled?.reason === "pulled";
  const off = applet.record.disabled?.reason === "off";
  const detail = pulled
    ? `Turned off: ${applet.record.disabled?.detail ?? "pulled from the catalog"}`
    : [applet.manifest.version, from, off ? "turned off" : null].filter((part): part is string => part !== null).join(" · ");
  return (
    <View
      testID={`installed:${applet.manifest.id}`}
      style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: ROW.minHeight, paddingHorizontal: 12, paddingVertical: 8 }}
    >
      <View
        focusable
        accessibilityRole="button"
        accessibilityLabel={applet.manifest.name}
        onPress={() => actions.openApplet(applet.manifest.id)}
        style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 12 }}
      >
        <AppIcon url={entry?.icon ?? null} name={applet.manifest.name} size={ROW.icon} source="applets" />
        <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: 1 }}>
          <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>
            {applet.manifest.name}
          </Text>
          <Text numberOfLines={1} style={{ fontSize: 11, color: pulled ? colors.ume : colors.textMuted }}>
            {detail}
          </Text>
        </View>
      </View>
      <Button label="Remove…" testID={`remove:${applet.manifest.id}`} onPress={() => actions.removeApplet(applet)} />
    </View>
  );
}

/** One installed applet whose files no longer read: it doesn't run, and needs an update (from its page, when its catalog has one) or Remove…. */
function UnreadableAppletRow({ applet, entry }: { applet: UnreadableApplet; entry: StoreApplet | undefined }) {
  const colors = useColors();
  const actions = useActions();
  const name = entry?.manifest.name ?? applet.name ?? applet.id;
  return (
    <View
      testID={`installed:${applet.id}`}
      style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingHorizontal: 12, paddingVertical: 8 }}
    >
      <View
        testID={`installed:${applet.id}:open`}
        focusable
        accessibilityRole="button"
        accessibilityLabel={name}
        onPress={() => actions.openApplet(applet.id)}
        style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 12 }}
      >
        <AppIcon url={entry?.icon ?? null} name={name} size={36} source="applets" />
        <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: 1 }}>
          <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>
            {name}
          </Text>
          <Text numberOfLines={1} style={{ fontSize: 11, color: colors.textMuted }}>
            {[applet.record?.version, "Needs an update"].filter((part): part is string => part !== undefined).join(" · ")}
          </Text>
        </View>
      </View>
      <Button label="Remove…" testID={`remove:${applet.id}`} onPress={() => actions.removeApplet(applet)} />
    </View>
  );
}

/** The applets on Installed (filtered by `needle`); nothing when there are none. */
export function InstalledApplets({ needle }: { needle: string }) {
  const { applets } = useServices();
  const state = useAppletState();
  const shown = state.installed
    .filter((applet) => needle === "" || `${applet.manifest.name} ${applet.manifest.id}`.toLowerCase().includes(needle))
    .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  const unreadable = state.unreadable
    .filter((applet) => needle === "" || `${applet.name ?? ""} ${applet.id}`.toLowerCase().includes(needle))
    .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
  if (shown.length === 0 && unreadable.length === 0) return null;
  return (
    <Group testID="installed-applets">
      {shown.map((applet) => (
        <InstalledAppletRow key={applet.manifest.id} applet={applet} entry={applets.entry(applet.manifest.id)} />
      ))}
      {unreadable.map((applet) => (
        <UnreadableAppletRow key={applet.id} applet={applet} entry={applets.entry(applet.id)} />
      ))}
    </Group>
  );
}
