/**
 * Discover: Dashi's recommended apps first (local, so they show at once and
 * offline), a few menu bar applets (the ones made for this computer first),
 * then Flathub's Trending, Popular, Recently updated and New, a few of each
 * with "See all". While Flathub's sections load, or when Flathub can't be
 * reached, one quiet line stands in their place.
 */

import { Button, useColors } from "@dashi/ui";
import { ScrollView, Text, View } from "@mirinjs/metal";
import type { Answer, Collection, Flathub } from "../../src/shared/software/flathub.ts";
import type { Page } from "../../src/shared/software/flathub-types.ts";
import { AppletGroup, useAppletState } from "./applets/rows.tsx";
import { CardGrid } from "./cards.tsx";
import { HeadingLink, SectionHeader } from "./heading.tsx";
import { type Load, useLoad } from "./hooks.ts";
import { RecommendedCards } from "./recommended.tsx";
import { useServices } from "./services.ts";

export const SECTIONS: ReadonlyArray<{ kind: Collection; title: string; detail: string }> = [
  { kind: "trending", title: "Trending", detail: "What people are installing right now" },
  { kind: "popular", title: "Popular", detail: "Loved over the last month" },
  { kind: "recently-updated", title: "Recently updated", detail: "Fresh releases" },
  { kind: "recently-added", title: "New on Flathub", detail: "Just arrived" },
];

const SHOWN = 6;
const SHOWN_APPLETS = 3;

type Loaded = Array<{ section: (typeof SECTIONS)[number]; page: Page } | null>;

/** The collections at once; one failing leaves its section out, all failing is the page's error. */
async function loadSections(catalog: Flathub): Promise<Answer<Loaded>> {
  const results = await Promise.allSettled(SECTIONS.map((section) => catalog.collection(section.kind, 1, SHOWN)));
  const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed && results.every((result) => result.status === "rejected")) throw failed.reason;
  const value: Loaded = results.map((result, index) =>
    result.status === "fulfilled" && SECTIONS[index] ? { section: SECTIONS[index], page: result.value.value } : null,
  );
  return { value, stale: results.some((result) => result.status === "fulfilled" && result.value.stale) };
}

/** Where Flathub's sections would be, while they load or when they can't: one quiet line, and Try again when it may help. */
function SectionsState({ state, onRetry }: { state: Exclude<Load<Loaded>, { status: "ready" }>; onRetry: () => void }) {
  const colors = useColors();
  const text =
    state.status === "loading"
      ? "Loading what’s trending, popular, and new…"
      : state.offline
        ? "You’re offline. What’s trending, popular, and new comes back when you’re online."
        : "Flathub isn’t responding, so what’s trending, popular, and new can’t be shown. Try again in a minute.";
  return (
    <View testID={`sections:${state.status}`} style={{ flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 12, minHeight: 28 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 12, color: colors.textMuted }}>{text}</Text>
      </View>
      {state.status === "failed" && <Button label="Try again" testID="retry" onPress={onRetry} />}
    </View>
  );
}

/** A few applets, the ones for this computer first; nothing without a catalog. */
function AppletsTeaser({ onSeeAll }: { onSeeAll: () => void }) {
  const { applets } = useServices();
  const state = useAppletState();
  if (state.index === null || state.index.applets.length === 0) return null;
  const forHere = (entry: (typeof state.index.applets)[number]): number => (entry.manifest.when !== undefined && applets.fitsHere(entry) === true ? 0 : 1);
  const shown = [...state.index.applets].sort((a, b) => forHere(a) - forHere(b) || a.manifest.name.localeCompare(b.manifest.name)).slice(0, SHOWN_APPLETS);
  return (
    <View testID="section:applets" style={{ flexShrink: 0, flexDirection: "column", gap: 10 }}>
      <SectionHeader
        title="Menu bar applets"
        detail="Small tools that live in the menu bar"
        action={<HeadingLink label="See all" testID="see-all:applets" onPress={onSeeAll} />}
      />
      <AppletGroup entries={shown} testID="applets-teaser" />
    </View>
  );
}

export function Discover({ onSeeAll }: { onSeeAll: (place: Collection | "applets") => void }) {
  const { catalog } = useServices();
  const { state, reload } = useLoad<Loaded>("discover", () => loadSections(catalog));
  return (
    <ScrollView testID="discover" style={{ flex: 1, flexDirection: "column", gap: 18, padding: 22 }}>
      <View testID="section:recommended" style={{ flexShrink: 0, flexDirection: "column", gap: 10 }}>
        <SectionHeader title="Recommended for Dashi" detail="Apps that work well here, picked by Dashi" />
        <RecommendedCards />
      </View>
      <AppletsTeaser onSeeAll={() => onSeeAll("applets")} />
      {state.status === "ready" ? (
        state.value.map((entry) =>
          entry === null ? null : (
            <View key={entry.section.kind} testID={`section:${entry.section.kind}`} style={{ flexShrink: 0, flexDirection: "column", gap: 10 }}>
              <SectionHeader
                title={entry.section.title}
                detail={entry.section.detail}
                action={<HeadingLink label="See all" testID={`see-all:${entry.section.kind}`} onPress={() => onSeeAll(entry.section.kind)} />}
              />
              <CardGrid apps={entry.page.apps.slice(0, SHOWN)} />
            </View>
          ),
        )
      ) : (
        <SectionsState state={state} onRetry={reload} />
      )}
    </ScrollView>
  );
}
