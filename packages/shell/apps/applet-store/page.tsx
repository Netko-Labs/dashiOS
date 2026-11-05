/**
 * An applet's page: who made it and whether Dashi's maintainers reviewed it,
 * the button that fits, its screenshots, what it can do in the manifest's
 * words, whether it fits this machine, where its source is, and the facts.
 * A pulled version says why, and offers the newest good one.
 */

import { cannotDo, describeWhen, type IndexApplet } from "@dashi/applet";
import { Button, EmptyState, Group, glyphs, useColors, useSurface } from "@dashi/ui";
import { Image, ScrollView, Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { abilityLines } from "../../src/applets/consent-sheet.tsx";
import { formatBytes } from "../../src/software/text.ts";
import { VerifiedBadge } from "../software/parts.tsx";
import { AppletIcon, StatusButton, useActions, useStoreState } from "./rows.tsx";
import { useServices, useStoreImage } from "./services.ts";

function Fact({ label, value, tone }: { label: string; value: string; tone?: "good" | "muted" }) {
  const colors = useColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 16,
        minHeight: 34,
        paddingHorizontal: 12,
        paddingVertical: 8,
      }}
    >
      <Text style={{ fontSize: 13, color: colors.text }}>{label}</Text>
      <View style={{ flexShrink: 1, minWidth: 0, alignItems: "flex-end" }}>
        <Text style={{ fontSize: 13, color: tone === "good" ? colors.selection : colors.textMuted, textAlign: "right" }}>{value}</Text>
      </View>
    </View>
  );
}

function Shot({ url }: { url: string }) {
  const colors = useColors();
  const surface = useSurface();
  const file = useStoreImage(url);
  const [width, setWidth] = useState(560);
  return (
    <View
      onLayout={(bounds) => setWidth(Math.max(200, Math.floor(bounds.width)))}
      style={{
        height: 300,
        flexShrink: 0,
        borderRadius: 10,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: surface.field,
        borderWidth: 1,
        borderColor: colors.separator,
      }}
    >
      {file ? (
        <Image source={file} resizeMode="contain" style={{ width: width - 2, height: 298 }} />
      ) : (
        <Text style={{ fontSize: 12, color: colors.textDisabled }}>Loading…</Text>
      )}
    </View>
  );
}

function Screenshots({ urls }: { urls: readonly string[] }) {
  const [index, setIndex] = useState(0);
  const colors = useColors();
  const url = urls[Math.min(index, urls.length - 1)];
  if (!url) return null;
  return (
    <View testID="screenshots" style={{ flexShrink: 0, flexDirection: "column", gap: 8 }}>
      <Shot url={url} />
      {urls.length > 1 && (
        <View style={{ flexDirection: "row", gap: 6, justifyContent: "center" }}>
          {urls.map((each, at) => (
            <View
              key={each}
              testID={`shot:${at}`}
              onPress={() => setIndex(at)}
              style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: at === index ? colors.selection : colors.separator }}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const day = (date: string): string => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

function AppletPageBody({ entry }: { entry: IndexApplet }) {
  const colors = useColors();
  const actions = useActions();
  const { store } = useServices();
  useStoreState();
  const { manifest } = entry;
  const status = store.status(entry);
  const newest = entry.versions[0];
  const here = store.fitsHere(entry);
  const lines = abilityLines(manifest);
  const cannot = cannotDo(manifest.permissions);
  const worksOn = `${describeWhen(manifest.when)}${here === true ? " · this one ✓" : here === false ? " · not this one" : ""}`;
  const byline = [manifest.author.name, newest?.version, newest ? formatBytes(newest.size) : null].filter((part): part is string => !!part).join(" · ");
  return (
    <ScrollView testID="applet-page" style={{ flex: 1, flexDirection: "column", gap: 20, padding: 24 }}>
      <View style={{ flexShrink: 0, flexDirection: "row", alignItems: "flex-start", gap: 18 }}>
        <AppletIcon url={entry.icon} name={manifest.name} size={80} />
        <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: 4 }}>
          <Text style={{ fontSize: 22, fontWeight: "bold", color: colors.text }}>{manifest.name}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={{ fontSize: 13, color: colors.textMuted }}>{byline}</Text>
            {entry.reviewed && <VerifiedBadge size={14} />}
            {entry.reviewed && <Text style={{ fontSize: 12, color: colors.textMuted }}>Reviewed</Text>}
          </View>
          <Text style={{ fontSize: 14, color: colors.text, lineHeight: 19 }}>{manifest.summary}</Text>
          {status.kind === "pulled" && (
            <View testID="pulled-note">
              <Text
                style={{ fontSize: 12, color: colors.critical }}
              >{`Version ${status.installed.record.version} was pulled and is turned off: ${status.reason}`}</Text>
            </View>
          )}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {status.kind !== "get" && <Button label="Remove" testID="remove" onPress={() => actions.remove(status.installed)} />}
          <StatusButton entry={entry} status={status} testID="get" wide />
        </View>
      </View>
      {entry.screenshots.length > 0 && <Screenshots urls={entry.screenshots} />}
      {manifest.description !== undefined && (
        <View testID="description" style={{ flexShrink: 0 }}>
          <Text style={{ fontSize: 13, lineHeight: 19, color: colors.text }}>{manifest.description}</Text>
        </View>
      )}
      <Group testID="facts">
        <Fact label="It can" value={lines.length > 0 ? lines.join("\n") : "Show itself in the menu bar, nothing more"} />
        {cannot !== null && <Fact label="It can't" value={cannot.replace(/^It can't /, "").replace(/\.$/, "")} tone="muted" />}
        <Fact label="Works on" value={worksOn} tone={here === true ? "good" : "muted"} />
        <Fact label="Source" value={entry.source.url.replace(/^https:\/\//, "")} />
        {newest && <Fact label="Updated" value={`${day(newest.released)}${newest.notes ? ` · ${newest.notes}` : ""}`} />}
        {manifest.license !== undefined && <Fact label="License" value={manifest.license} />}
        <Fact label="Applet ID" value={manifest.id} />
      </Group>
    </ScrollView>
  );
}

export function AppletPage({ id }: { id: string }) {
  const state = useStoreState();
  const entry = state.index?.applets.find((each) => each.manifest.id === id);
  if (!entry) return <EmptyState testID="gone" glyph={glyphs.WARNING} title="Not in the catalog" message="This applet isn't in the catalog any more." />;
  return <AppletPageBody entry={entry} />;
}
