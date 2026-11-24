/**
 * An app's page: the place you decide whether to trust it. Its icon, name,
 * maker and the buttons that fit; then the trust card (who made it and
 * whether Flathub verified them, what it can reach, what changed, how many
 * use it); then the screenshots, what it is, and the facts, with a website
 * and a source you can open. Get stays one click unless the app reaches far,
 * when it becomes Get… and asks first.
 */

import { Button, Group, Loading, SPACE, TextLink, TYPE, useColors } from "@dashi/ui";
import { ScrollView, Text, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { type AppDetails, formatBytes } from "../../../src/shared/software/index.ts";
import { useCatalog } from "./catalog-hooks.ts";
import { StateChip } from "./chip.tsx";
import { Gallery } from "./gallery.tsx";
import { SectionHeader } from "./heading.tsx";
import { useAppState, useLoad } from "./hooks.ts";
import { VerifiedMark } from "./marks.tsx";
import { whereInstalled } from "./model.ts";
import { HeaderLine, ITEM_PAGE, PAGE_ICON, PageHeader } from "./page-header.tsx";
import { AppIcon, ROW, useActions } from "./parts.tsx";
import { useServices } from "./services.ts";
import { getAllowed, SourcePicker } from "./source-picker.tsx";
import { Failed } from "./states.tsx";
import { TrustCard } from "./trust.tsx";
import { appTrust, askReasons, licenseWords, releaseHeading } from "./trust-words.ts";

interface FactRow {
  label: string;
  value: string;
  /** Opens this address in the browser. */
  link?: string;
}

/** A fact's row in the facts card: its least height. */
export const FACT_ROW = 34;

function Fact({ fact }: { fact: FactRow }) {
  const colors = useColors();
  const actions = useActions();
  const { link } = fact;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: SPACE.page,
        minHeight: FACT_ROW,
        paddingHorizontal: SPACE.inset,
        paddingVertical: SPACE.s,
      }}
    >
      <Text style={{ fontSize: TYPE.body.size, color: colors.text }}>{fact.label}</Text>
      <View style={{ flexShrink: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: SPACE.s }}>
        {/* A link is ink and underlined (Q3), never the accent. */}
        {link ? (
          <TextLink testID={`link:${fact.label}`} label={fact.value} onPress={() => actions.openUrl(link)} />
        ) : (
          <View style={{ flexShrink: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: TYPE.body.size, color: colors.textMuted }}>
              {fact.value}
            </Text>
          </View>
        )}
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

/** The catalog's row for a Flathub app, and its Flathub offer, when the catalog has it. */
function useFlathubEntry(id: string) {
  const data = useCatalog();
  const entry = data?.entries.find((each) => each.offers.some((offer) => offer.kind === "flatpak" && offer.ref === id));
  const offer = entry?.offers.find((each) => each.kind === "flatpak" && each.ref === id);
  return entry && offer ? { entry, offer } : null;
}

function Buttons({ app, asks }: { app: AppDetails; asks: boolean }) {
  const actions = useActions();
  const state = useAppState(app.id);
  const found = useFlathubEntry(app.id);
  const allowed = found === null || getAllowed(found.entry, found.offer);
  if (state.kind === "busy")
    return <StateChip chip={{ kind: "busy", operation: state.operation }} testID="app" wide onCancel={() => actions.cancel(state.operation.key)} />;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.m, flexShrink: 0 }}>
      {state.kind === "get" && (
        <Button label={asks ? "Get…" : "Get"} testID="install" primary disabled={!allowed} onPress={() => actions.install(app.id, app.name)} />
      )}
      {state.kind !== "get" && <Button label="Remove…" testID="remove" onPress={() => actions.remove(state.installed)} />}
      {state.kind === "update" && <Button label="Update" testID="update" primary onPress={() => actions.update(state.installed, app.name)} />}
      {state.kind !== "get" && <Button label="Open" testID="open" primary={state.kind === "open"} onPress={() => actions.launch(app.id)} />}
    </View>
  );
}

function Page({ app }: { app: AppDetails }) {
  const colors = useColors();
  const state = useAppState(app.id);
  const found = useFlathubEntry(app.id);
  const reasons = askReasons(app);
  const installedNote = state.kind === "open" || state.kind === "update" ? whereInstalled(state.installed) : null;
  const sections: ReactNode[] = [];
  if (app.screenshots.length > 0) sections.push(<Gallery key="gallery" shots={app.screenshots} />);
  if (app.description.length > 0) {
    sections.push(
      <View key="about" testID="description" style={{ flexShrink: 0, flexDirection: "column", gap: SPACE.m }}>
        <SectionHeader title="About" />
        {/* Inset as the heading and the facts' rows are. */}
        <View style={{ flexShrink: 0, flexDirection: "column", gap: SPACE.m, paddingHorizontal: ROW.inset }}>
          {app.description.map((block, index) => (
            // Paragraphs never reorder.
            <Text key={index} style={{ fontSize: TYPE.body.size, lineHeight: TYPE.body.line, color: colors.text }}>
              {block}
            </Text>
          ))}
        </View>
      </View>,
    );
  }
  return (
    <ScrollView testID="app-page" style={{ flex: 1, flexDirection: "column", gap: ITEM_PAGE.gap, padding: ITEM_PAGE.padding }}>
      <PageHeader
        icon={<AppIcon url={app.icon} name={app.name} size={PAGE_ICON} />}
        title={app.name}
        byline={app.developer ?? ""}
        {...(app.verified ? { mark: <VerifiedMark size={TYPE.body.size} /> } : {})}
        summary={app.summary}
        actions={
          <>
            <Buttons app={app} asks={reasons.length > 0} />
            {found && <SourcePicker entry={found.entry} offer={found.offer} />}
          </>
        }
      >
        {installedNote !== null && <HeaderLine>{installedNote}</HeaderLine>}
        {app.eol && <HeaderLine warning>This app is no longer maintained.</HeaderLine>}
      </PageHeader>
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
