/**
 * An applet's page, shaped like an app's: its name and the chip, then the
 * trust card (who made it, Dashi's review, the author's signature, what it
 * can do, what changed), its screenshots, what it is, whether it fits this
 * machine, and the facts with a source you can open. Once installed, Manage:
 * on or off in the menu bar, what it was allowed, and Remove….
 */

import { describeWhen, type InstalledApplet, permissionName, type UnreadableApplet } from "@dashi/applet";
import { Button, EmptyState, Group, glyphs, Switch, useColors } from "@dashi/ui";
import { ScrollView, Svg, Text, View } from "@mirinjs/metal";
import type { StoreApplet } from "../../../src/applet-store/merge.ts";
import { abilityLines } from "../../../src/applets/consent-sheet.tsx";
import { formatBytes } from "../../../src/software/text.ts";
import { Gallery } from "../gallery.tsx";
import { CHECK_MARK } from "../glyphs.ts";
import { SectionHeader } from "../heading.tsx";
import { AppIcon, useActions } from "../parts.tsx";
import { useServices } from "../services.ts";
import { TrustCard } from "../trust.tsx";
import { appletTrust } from "../trust-words.ts";
import { AppletChip, useAppletState } from "./rows.tsx";
import type { AppletOrigin } from "./store.ts";

function Fact({ label, value, onPress, testID }: { label: string; value: string; onPress?: () => void; testID?: string }) {
  const colors = useColors();
  return (
    <View
      style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, minHeight: 34, paddingHorizontal: 12, paddingVertical: 6 }}
    >
      <Text style={{ fontSize: 13, color: colors.text }}>{label}</Text>
      <View
        {...(testID ? { testID } : {})}
        {...(onPress ? { onPress, focusable: true, accessibilityRole: "link" as const } : {})}
        style={{ flexShrink: 1, minWidth: 0 }}
      >
        <Text numberOfLines={1} style={{ fontSize: 13, color: onPress ? colors.accentInk : colors.textMuted }}>
          {value}
        </Text>
      </View>
    </View>
  );
}

/** On or off, what it was allowed, Remove…. */
function Manage({ applet }: { applet: InstalledApplet }) {
  const colors = useColors();
  const actions = useActions();
  const { applets } = useServices();
  const pulled = applet.record.disabled?.reason === "pulled";
  const allowed = applet.manifest.permissions.filter((permission) => applet.record.consent.includes(permissionName(permission)));
  const lines = abilityLines({ permissions: allowed });
  return (
    <View testID="manage" style={{ flexShrink: 0, flexDirection: "column", gap: 8 }}>
      <SectionHeader title="Manage" />
      <Group>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44, paddingHorizontal: 12 }}>
          <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: 1 }}>
            <Text style={{ fontSize: 13, color: colors.text }}>In the menu bar</Text>
            <Text style={{ fontSize: 11, color: colors.textMuted }}>
              {pulled ? "Turned off: it was pulled from the catalog" : "Off, it doesn’t run at all; it stays installed"}
            </Text>
          </View>
          <Switch testID="manage:on" on={applet.record.disabled === undefined} disabled={pulled} onChange={(on) => applets.setOn(applet, on)} />
        </View>
        <View style={{ flexDirection: "column", gap: 4, paddingHorizontal: 12, paddingVertical: 10 }}>
          <Text style={{ fontSize: 13, color: colors.text }}>Allowed</Text>
          {lines.length === 0 ? (
            <Text style={{ fontSize: 12, color: colors.textMuted }}>Nothing beyond showing itself in the menu bar</Text>
          ) : (
            lines.map((line) => <Text key={line} style={{ fontSize: 12, color: colors.textMuted }}>{`• ${line}`}</Text>)
          )}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", minHeight: 44, paddingHorizontal: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 12, color: colors.textMuted }}>Removing it can also delete what it saved.</Text>
          </View>
          <Button label="Remove…" testID="remove" onPress={() => actions.removeApplet(applet)} />
        </View>
      </Group>
    </View>
  );
}

/** One installed that no longer reads: it doesn't run until an update mends it; Remove…. */
function Mend({ applet }: { applet: UnreadableApplet }) {
  const colors = useColors();
  const actions = useActions();
  return (
    <View testID="mend" style={{ flexShrink: 0, flexDirection: "column", gap: 8 }}>
      <SectionHeader title="Manage" />
      <Group>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44, paddingHorizontal: 12 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 12, color: colors.textMuted }}>The copy you have needs an update, and doesn’t run until it has one.</Text>
          </View>
          <Button label="Remove…" testID="remove" onPress={() => actions.removeApplet(applet)} />
        </View>
      </Group>
    </View>
  );
}

function AppletPageBody({ entry }: { entry: StoreApplet }) {
  const colors = useColors();
  const actions = useActions();
  const { applets } = useServices();
  const state = useAppletState();
  const { manifest } = entry;
  const status = applets.status(entry);
  const newest = entry.versions[0];
  const here = applets.fitsHere(entry);
  const installed = state.installed.find((each) => each.manifest.id === manifest.id);
  const byline = [manifest.author.name, newest?.version, newest ? formatBytes(newest.size) : null, entry.from.builtIn ? null : `From ${entry.from.name}`]
    .filter((part): part is string => !!part)
    .join(" · ");
  return (
    <ScrollView testID="applet-page" style={{ flex: 1, flexDirection: "column", gap: 20, padding: 24 }}>
      <View style={{ flexShrink: 0, flexDirection: "row", alignItems: "flex-start", gap: 18 }}>
        <AppIcon url={entry.icon ?? null} name={manifest.name} size={80} source="applets" />
        <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: 4 }}>
          <Text style={{ fontSize: 20, fontWeight: "bold", color: colors.text }}>{manifest.name}</Text>
          <Text style={{ fontSize: 12, color: colors.textMuted }}>{byline}</Text>
          <Text style={{ fontSize: 13, color: colors.text, lineHeight: 18 }}>{manifest.summary}</Text>
          {status.kind === "pulled" && (
            <Text style={{ fontSize: 12, color: colors.ume }}>
              {`Version ${status.installed.record.version} was pulled and is turned off: ${status.reason}`}
            </Text>
          )}
        </View>
        <AppletChip entry={entry} testID="get" wide />
      </View>
      <TrustCard facts={appletTrust(entry)} />
      {entry.screenshots.length > 0 && <Gallery shots={entry.screenshots.map((url) => ({ caption: null, thumb: url, large: url }))} source="applets" />}
      {manifest.description !== undefined && (
        <View testID="description" style={{ flexShrink: 0 }}>
          <Text style={{ fontSize: 13, lineHeight: 19, color: colors.text }}>{manifest.description}</Text>
        </View>
      )}
      {installed && <Manage applet={installed} />}
      {status.kind === "unreadable" && <Mend applet={status.unreadable} />}
      <Group testID="facts">
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, minHeight: 34, paddingHorizontal: 12 }}>
          <View style={{ flexShrink: 0 }}>
            <Text style={{ fontSize: 13, color: colors.text }}>Works on</Text>
          </View>
          {/* One line: the machines it is for give way (cut short), never "this computer". */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1, minWidth: 0 }}>
            <View style={{ flexShrink: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: 13, color: colors.textMuted }}>
                {describeWhen(manifest.when)}
              </Text>
            </View>
            {here === true && <Svg markup={CHECK_MARK} size={11} color={colors.moss} />}
            {here !== null && (
              <View style={{ flexShrink: 0 }}>
                <Text numberOfLines={1} style={{ fontSize: 13, color: here ? colors.moss : colors.textMuted }}>
                  {here ? "this computer" : "· not this computer"}
                </Text>
              </View>
            )}
          </View>
        </View>
        <Fact label="Source" value={entry.source.url.replace(/^https:\/\//, "")} onPress={() => actions.openUrl(entry.source.url)} testID="source" />
        {manifest.license !== undefined && <Fact label="License" value={manifest.license} />}
        <Fact label="Applet ID" value={manifest.id} />
      </Group>
    </ScrollView>
  );
}

/** Where an installed applet that the store has no entry for came from, in words. */
function originWords(origin: AppletOrigin): string {
  switch (origin.kind) {
    case "local":
      return "added by hand";
    case "removed":
      return "catalog removed · no updates";
    case "catalog":
      return origin.source.builtIn ? "no longer in the catalog" : `no longer in ${origin.source.name}`;
  }
}

/** One added by hand, no longer in its catalog, or whose catalog was removed: what it is, and Manage. */
function LocalAppletPage({ applet }: { applet: InstalledApplet }) {
  const colors = useColors();
  const { applets } = useServices();
  const { manifest } = applet;
  return (
    <ScrollView testID="applet-page" style={{ flex: 1, flexDirection: "column", gap: 20, padding: 24 }}>
      <View style={{ flexShrink: 0, flexDirection: "row", alignItems: "flex-start", gap: 18 }}>
        <AppIcon file={manifest.icon ? `${applet.dir}/${manifest.icon}` : null} name={manifest.name} size={80} />
        <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: 4 }}>
          <Text style={{ fontSize: 20, fontWeight: "bold", color: colors.text }}>{manifest.name}</Text>
          <Text
            style={{ fontSize: 12, color: colors.textMuted }}
          >{`${manifest.author.name} · ${manifest.version} · ${originWords(applets.originOf(applet))}`}</Text>
          <Text style={{ fontSize: 13, color: colors.text, lineHeight: 18 }}>{manifest.summary}</Text>
        </View>
      </View>
      <Manage applet={applet} />
    </ScrollView>
  );
}

/** One installed that no longer reads, which no catalog in the list has: its name, and Remove…. */
function UnreadableAppletPage({ applet }: { applet: UnreadableApplet }) {
  const colors = useColors();
  const { applets } = useServices();
  const state = useAppletState();
  const name = applet.name ?? applet.id;
  // Its catalog still lists it, in a form this Dashi can't read either: a newer Dashi mends it, not the catalog.
  const listed = state.catalogs.some((load) => load.index?.skipped.some((each) => each.id === applet.id));
  const byline = [applet.record?.version, ...(listed ? ["Needs a newer Dashi"] : ["Needs an update", originWords(applets.originOf(applet))])].filter(
    (part): part is string => part !== undefined,
  );
  return (
    <ScrollView testID="applet-page" style={{ flex: 1, flexDirection: "column", gap: 20, padding: 24 }}>
      <View style={{ flexShrink: 0, flexDirection: "row", alignItems: "flex-start", gap: 18 }}>
        <AppIcon url={null} name={name} size={80} />
        <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: 4 }}>
          <Text style={{ fontSize: 20, fontWeight: "bold", color: colors.text }}>{name}</Text>
          <Text style={{ fontSize: 12, color: colors.textMuted }}>{byline.join(" · ")}</Text>
        </View>
      </View>
      <Mend applet={applet} />
    </ScrollView>
  );
}

export function AppletPage({ id }: { id: string }) {
  const { applets } = useServices();
  const state = useAppletState();
  const entry = applets.entry(id);
  const installed = state.installed.find((each) => each.manifest.id === id);
  const unreadable = state.unreadable.find((each) => each.id === id);
  if (!entry && installed) return <LocalAppletPage applet={installed} />;
  if (!entry && unreadable) return <UnreadableAppletPage applet={unreadable} />;
  if (!entry) {
    return state.loading ? null : (
      <EmptyState
        testID="gone"
        glyph={glyphs.WARNING}
        title="Not in the catalog"
        message="This applet isn’t in the catalog any more. Installed still lists it if you have it."
      />
    );
  }
  return <AppletPageBody entry={entry} />;
}
