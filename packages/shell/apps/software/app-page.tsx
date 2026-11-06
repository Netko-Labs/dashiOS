/**
 * An app's page: icon, name, who made it (and whether Flathub verified them),
 * the one-line summary, the button that fits (Install, Open, Update, Remove)
 * with its progress, the screenshots, the description as plain paragraphs, and
 * the facts (version, size, license).
 */

import { Button, Group, Loading, ProgressBar, useColors } from "@dashi/ui";
import { ScrollView, Text, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import type { AppDetails } from "../../src/software/flathub-types.ts";
import { formatBytes } from "../../src/software/text.ts";
import { useAppState } from "./cards.tsx";
import { Gallery } from "./gallery.tsx";
import { useLoad } from "./hooks.ts";
import { busyLabel } from "./model.ts";
import { AppIcon, useActions, VerifiedBadge } from "./parts.tsx";
import { useServices } from "./services.ts";
import { Failed, StaleNote } from "./states.tsx";

function Fact({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View
      style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, minHeight: 34, paddingHorizontal: 12, paddingVertical: 6 }}
    >
      <Text style={{ fontSize: 13, color: colors.text }}>{label}</Text>
      <View style={{ flexShrink: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, color: colors.textMuted }}>
          {value}
        </Text>
      </View>
    </View>
  );
}

const day = (seconds: number): string => new Date(seconds * 1000).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

function facts(app: AppDetails): Array<[string, string]> {
  const rows: Array<[string, string | null]> = [
    ["Version", app.version],
    ["Updated", app.released === null ? null : day(app.released)],
    ["License", app.license === null ? null : app.license.replace(/^LicenseRef-/, "")],
    ["Download size", app.downloadSize === null ? null : formatBytes(app.downloadSize)],
    ["Size on disk", app.installedSize === null ? null : formatBytes(app.installedSize)],
    ["Developer", app.developer],
    ["Website", app.homepage === null ? null : app.homepage.replace(/^https:\/\//, "").replace(/\/$/, "")],
    ["Source", "Flathub"],
    ["Application ID", app.id],
  ];
  return rows.filter((row): row is [string, string] => row[1] !== null);
}

function Buttons({ id, name }: { id: string; name: string }) {
  const colors = useColors();
  const actions = useActions();
  const state = useAppState(id);
  if (state.kind === "busy") {
    const { operation } = state;
    const running = operation.status === "running" && operation.kind !== "remove";
    return (
      <View testID="app-busy" style={{ minWidth: 190, flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
        <Text style={{ fontSize: 12, color: colors.textMuted }}>{busyLabel(operation)}</Text>
        <ProgressBar value={operation.status === "running" ? (operation.progress?.fraction ?? null) : null} width={190} />
        {(running || operation.status === "queued") && <Button label="Cancel" testID="cancel" onPress={() => actions.cancel(operation.key)} />}
      </View>
    );
  }
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
      {state.kind === "get" && <Button label="Install" testID="install" primary onPress={() => actions.install(id, name)} />}
      {state.kind !== "get" && <Button label="Remove" testID="remove" onPress={() => actions.remove(state.installed)} />}
      {state.kind === "update" && <Button label="Update" testID="update" primary onPress={() => actions.update(state.installed, name)} />}
      {state.kind !== "get" && <Button label="Open" testID="open" primary={state.kind === "open"} onPress={() => actions.launch(id)} />}
    </View>
  );
}

function Page({ app, stale }: { app: AppDetails; stale: boolean }) {
  const colors = useColors();
  const state = useAppState(app.id);
  const installedNote =
    state.kind === "open" || state.kind === "update" ? (state.installed.installation === "system" ? "Installed for everyone" : "Installed for you") : null;
  const sections: ReactNode[] = [];
  if (app.screenshots.length > 0) sections.push(<Gallery key="gallery" shots={app.screenshots} />);
  if (app.description.length > 0) {
    sections.push(
      <View key="about" testID="description" style={{ flexShrink: 0, flexDirection: "column", gap: 8 }}>
        <Text style={{ fontSize: 17, fontWeight: "bold", color: colors.text }}>About</Text>
        {app.description.map((block, index) => (
          // Paragraphs never reorder.
          <Text key={index} style={{ fontSize: 13, lineHeight: 19, color: colors.text }}>
            {block}
          </Text>
        ))}
      </View>,
    );
  }
  return (
    <ScrollView testID="app-page" style={{ flex: 1, flexDirection: "column", gap: 20, padding: 24 }}>
      {stale && <StaleNote />}
      <View style={{ flexShrink: 0, flexDirection: "row", alignItems: "flex-start", gap: 18 }}>
        <AppIcon url={app.icon} name={app.name} size={96} />
        <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: 4 }}>
          <Text style={{ fontSize: 24, fontWeight: "bold", color: colors.text }}>{app.name}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {app.developer !== null && <Text style={{ fontSize: 13, color: colors.textMuted }}>{app.developer}</Text>}
            {app.verified && <VerifiedBadge size={14} />}
            {app.verified && <Text style={{ fontSize: 12, color: colors.textMuted }}>Verified</Text>}
          </View>
          <Text style={{ fontSize: 14, color: colors.text, lineHeight: 19 }}>{app.summary}</Text>
          {installedNote !== null && <Text style={{ fontSize: 12, color: colors.textMuted }}>{installedNote}</Text>}
          {app.eol && <Text style={{ fontSize: 12, color: colors.critical }}>This app is no longer maintained.</Text>}
        </View>
        <Buttons id={app.id} name={app.name} />
      </View>
      {sections}
      <Group testID="facts">
        {facts(app).map(([label, value]) => (
          <Fact key={label} label={label} value={value} />
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
  return <Page app={state.value} stale={state.stale} />;
}
