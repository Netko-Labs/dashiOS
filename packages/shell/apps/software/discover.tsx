/** Discover: Trending, Popular, and Recently Updated apps from Flathub, a few of each. */

import { ScrollView, Text, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import type { Answer, Collection, Flathub } from "../../src/software/flathub.ts";
import type { Page } from "../../src/software/flathub-types.ts";
import { useColors } from "@dashi/ui";
import { CardGrid } from "./cards.tsx";
import { useLoad } from "./hooks.ts";
import { Failed, Loading, StaleNote } from "./states.tsx";
import { useServices } from "./services.ts";

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

export function Discover({ banner }: { banner?: ReactNode }) {
  const { catalog } = useServices();
  const { state, reload } = useLoad<Loaded>("discover", () => loadSections(catalog));
  if (state.status === "loading") return <Loading what="Loading apps…" />;
  if (state.status === "failed") return <Failed state={state} onRetry={reload} />;
  return (
    <ScrollView testID="discover" style={{ flex: 1, flexDirection: "column", gap: 18, padding: 22 }}>
      {banner}
      {state.stale && <StaleNote />}
      {state.value.map((entry) =>
        entry === null ? null : (
          <View key={entry.section.kind} testID={`section:${entry.section.kind}`} style={{ flexShrink: 0, flexDirection: "column", gap: 10 }}>
            <SectionHeader title={entry.section.title} detail={entry.section.detail} />
            <CardGrid apps={entry.page.apps.slice(0, SHOWN)} />
          </View>
        ),
      )}
    </ScrollView>
  );
}
