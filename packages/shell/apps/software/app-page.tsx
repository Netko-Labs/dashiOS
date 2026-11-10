/**
 * An app's page: the place you decide whether to trust it. Its icon, name,
 * maker and the buttons that fit; then the trust card (who made it and
 * whether Flathub verified them, what it can reach, what changed, how many
 * use it); then the screenshots, what it is, and the facts, with a website
 * and a source you can open. Get stays one click unless the app reaches far,
 * when it becomes Get… and asks first.
 */

import { Button, Group, Loading, useColors } from "@dashi/ui";
import { ScrollView, Text, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import type { AppDetails } from "../../src/shared/software/flathub-types.ts";
import { formatBytes } from "../../src/shared/software/text.ts";
import { StateChip } from "./chip.tsx";
import { Gallery } from "./gallery.tsx";
import { SectionHeader } from "./heading.tsx";
import { useAppState, useLoad } from "./hooks.ts";
import { VerifiedBadge } from "./marks.tsx";
import { whereInstalled } from "./model.ts";
import { AppIcon, ROW, useActions } from "./parts.tsx";
import { useServices } from "./services.ts";
import { Failed } from "./states.tsx";
import { TrustCard } from "./trust.tsx";
import { appTrust, askReasons, licenseWords, releaseHeading } from "./trust-words.ts";

interface FactRow {
  label: string;
  value: string;
  /** Opens this address in the browser. */
  link?: string;
}

function Fact({ fact }: { fact: FactRow }) {
  const colors = useColors();
  const actions = useActions();
  const { link } = fact;
  return (
    <View
      style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, minHeight: 34, paddingHorizontal: 12, paddingVertical: 6 }}
    >
      <Text style={{ fontSize: 13, color: colors.text }}>{fact.label}</Text>
      <View style={{ flexShrink: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View
          {...(link ? { testID: `link:${fact.label}`, focusable: true, accessibilityRole: "link" as const, onPress: () => actions.openUrl(link) } : {})}
          style={{ flexShrink: 1, minWidth: 0 }}
        >
          <Text numberOfLines={1} style={{ fontSize: 13, color: link ? colors.accentInk : colors.textMuted }}>
            {fact.value}
          </Text>
        </View>
      </View>
    </View>
  );
}

const shortUrl = (url: string): string => url.replace(/^https:\/\//, "").replace(/\/$/, "");

export function facts(app: AppDetails): FactRow[] {
  const rows: Array<FactRow | null> = [
    app.version === null ? null : { label: "Version", value: app.version },
    app.released === null ? null : { label: "Updated", value: releaseHeading(null, new Date(app.released * 1000)) },
    app.license === null ? null : { label: "License", ...licenseWords(app.license) },
    app.downloadSize === null ? null : { label: "Download size", value: formatBytes(app.downloadSize) },
    app.installedSize === null ? null : { label: "Size on disk", value: formatBytes(app.installedSize) },
    app.homepage === null ? null : { label: "Website", value: shortUrl(app.homepage), link: app.homepage },
    { label: "Source", value: "Flathub", link: `https://flathub.org/apps/${app.id}` },
    { label: "Application ID", value: app.id },
  ];
  return rows.filter((row): row is FactRow => row !== null);
}

function Buttons({ app, asks }: { app: AppDetails; asks: boolean }) {
  const actions = useActions();
  const state = useAppState(app.id);
  if (state.kind === "busy")
    return <StateChip chip={{ kind: "busy", operation: state.operation }} testID="app" wide onCancel={() => actions.cancel(state.operation.key)} />;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
      {state.kind === "get" && <Button label={asks ? "Get…" : "Get"} testID="install" primary onPress={() => actions.install(app.id, app.name)} />}
      {state.kind !== "get" && <Button label="Remove…" testID="remove" onPress={() => actions.remove(state.installed)} />}
      {state.kind === "update" && <Button label="Update" testID="update" primary onPress={() => actions.update(state.installed, app.name)} />}
      {state.kind !== "get" && <Button label="Open" testID="open" primary={state.kind === "open"} onPress={() => actions.launch(app.id)} />}
    </View>
  );
}

function Page({ app }: { app: AppDetails }) {
  const colors = useColors();
  const state = useAppState(app.id);
  const reasons = askReasons(app);
  const installedNote = state.kind === "open" || state.kind === "update" ? whereInstalled(state.installed) : null;
  const sections: ReactNode[] = [];
  if (app.screenshots.length > 0) sections.push(<Gallery key="gallery" shots={app.screenshots} />);
  if (app.description.length > 0) {
    sections.push(
      <View key="about" testID="description" style={{ flexShrink: 0, flexDirection: "column", gap: 8 }}>
        <SectionHeader title="About" />
        {/* Inset as the heading and the facts' rows are. */}
        <View style={{ flexShrink: 0, flexDirection: "column", gap: 8, paddingHorizontal: ROW.inset }}>
          {app.description.map((block, index) => (
            // Paragraphs never reorder.
            <Text key={index} style={{ fontSize: 13, lineHeight: 19, color: colors.text }}>
              {block}
            </Text>
          ))}
        </View>
      </View>,
    );
  }
  return (
    <ScrollView testID="app-page" style={{ flex: 1, flexDirection: "column", gap: 20, padding: 24 }}>
      <View style={{ flexShrink: 0, flexDirection: "row", alignItems: "flex-start", gap: 18 }}>
        <AppIcon url={app.icon} name={app.name} size={80} />
        <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: 4 }}>
          <Text style={{ fontSize: 20, fontWeight: "bold", color: colors.text }}>{app.name}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {app.developer !== null && <Text style={{ fontSize: 13, color: colors.textMuted }}>{app.developer}</Text>}
            {app.verified && <VerifiedBadge size={14} />}
          </View>
          <Text style={{ fontSize: 13, color: colors.text, lineHeight: 18 }}>{app.summary}</Text>
          {installedNote !== null && <Text style={{ fontSize: 12, color: colors.textMuted }}>{installedNote}</Text>}
          {app.eol && <Text style={{ fontSize: 12, color: colors.ume }}>This app is no longer maintained.</Text>}
        </View>
        <Buttons app={app} asks={reasons.length > 0} />
      </View>
      <TrustCard facts={appTrust(app)} strong={reasons} />
      {sections}
      <Group testID="facts">
        {facts(app).map((fact) => (
          <Fact key={fact.label} fact={fact} />
        ))}
      </Group>
    </ScrollView>
  );
}

export function AppPage({ id }: { id: string }) {
  const { catalog } = useServices();
  const { state, reload } = useLoad<AppDetails>(`app:${id}`, () => catalog.details(id));
  if (state.status === "loading") return <Loading label="Loading…" />;
  if (state.status === "failed") return <Failed state={state} onRetry={reload} />;
  return <Page app={state.value} />;
}
