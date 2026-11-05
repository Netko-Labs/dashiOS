/** Discover: Dashi's recommended apps (local, always shown), then Trending, Popular, and Recently Updated from Flathub, a few of each. */

import { Button, useColors } from "@dashi/ui";
import { ScrollView, Text, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import type { Answer, Collection, Flathub } from "../../src/software/flathub.ts";
import type { Page } from "../../src/software/flathub-types.ts";
import { CardGrid } from "./cards.tsx";
import { type Load, useLoad } from "./hooks.ts";
import { RecommendedCards } from "./recommended.tsx";
import { useServices } from "./services.ts";
import { StaleNote } from "./states.tsx";

const SECTIONS: ReadonlyArray<{ kind: Collection; title: string; detail: string }> = [
  { kind: "trending", title: "Trending", detail: "What people are installing right now" },
  { kind: "popular", title: "Popular", detail: "Loved over the last month" },
  { kind: "recently-updated", title: "Recently Updated", detail: "Fresh releases" },
];

const SHOWN = 6;

export function SectionHeader({ title, detail }: { title: string; detail?: string }) {
  const colors = useColors();
  return (
    <View style={{ flexShrink: 0, flexDirection: "column", gap: 1, marginTop: 6 }}>
      <Text style={{ fontSize: 17, fontWeight: "bold", color: colors.text }}>{title}</Text>
      {detail !== undefined && <Text style={{ fontSize: 12, color: colors.textMuted }}>{detail}</Text>}
    </View>
  );
}

type Loaded = Array<{ section: (typeof SECTIONS)[number]; page: Page } | null>;

/** The three collections at once; one failing leaves its section out, all failing is the page's error. */
async function loadSections(catalog: Flathub): Promise<Answer<Loaded>> {
  const results = await Promise.allSettled(SECTIONS.map((section) => catalog.collection(section.kind, 1, SHOWN)));
  const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed && results.every((result) => result.status === "rejected")) throw failed.reason;
  const value: Loaded = results.map((result, index) =>
    result.status === "fulfilled" && SECTIONS[index] ? { section: SECTIONS[index], page: result.value.value } : null,
  );
  return { value, stale: results.some((result) => result.status === "fulfilled" && result.value.stale) };
}

/** Where Flathub's sections would be, while they load or when they can't: one quiet line, and Try Again when it may help. */
function SectionsState({ state, onRetry }: { state: Exclude<Load<Loaded>, { status: "ready" }>; onRetry: () => void }) {
  const colors = useColors();
  const text =
    state.status === "loading"
      ? "Loading Trending, Popular, and Recently Updated…"
      : state.offline
        ? "You're offline. Trending, Popular, and Recently Updated come back when you're online."
        : "Flathub didn't answer, so Trending, Popular, and Recently Updated can't be shown right now.";
  return (
    <View testID={`sections:${state.status}`} style={{ flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 12, minHeight: 28 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 12, color: colors.textMuted }}>{text}</Text>
      </View>
      {state.status === "failed" && <Button label="Try Again" testID="retry" onPress={onRetry} />}
    </View>
  );
}

/**
 * Dashi's recommended apps come first and always show, at once and offline:
 * the list is local. Flathub's sections follow once they load; while they
 * load, or when Flathub can't be reached, a line says so in their place.
 */
export function Discover({ banner }: { banner?: ReactNode }) {
  const { catalog } = useServices();
  const { state, reload } = useLoad<Loaded>("discover", () => loadSections(catalog));
  return (
    <ScrollView testID="discover" style={{ flex: 1, flexDirection: "column", gap: 18, padding: 22 }}>
      {banner}
      {state.status === "ready" && state.stale && <StaleNote />}
      <View testID="section:recommended" style={{ flexShrink: 0, flexDirection: "column", gap: 10 }}>
        <SectionHeader title="Recommended for Dashi" detail="Apps that work well here, picked by Dashi" />
        <RecommendedCards />
      </View>
      {state.status === "ready" ? (
        state.value.map((entry) =>
          entry === null ? null : (
            <View key={entry.section.kind} testID={`section:${entry.section.kind}`} style={{ flexShrink: 0, flexDirection: "column", gap: 10 }}>
              <SectionHeader title={entry.section.title} detail={entry.section.detail} />
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
