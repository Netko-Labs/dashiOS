/** A category's apps or search results: cards in a grid, a page at a time ("Show More"). */

import { ScrollView, View } from "@mirinjs/metal";
import { useEffect, useRef, useState } from "react";
import type { Answer, CategoryId, Flathub } from "../../src/software/flathub.ts";
import type { AppSummary, Page } from "../../src/software/flathub-types.ts";
import { Button, EmptyState, glyphs } from "@dashi/ui";
import { CardGrid } from "./cards.tsx";
import { SectionHeader } from "./discover.tsx";
import { useLoad } from "./hooks.ts";
import { useServices } from "./services.ts";
import { Failed, Loading, StaleNote } from "./states.tsx";

const PER_PAGE = 24;

export type Source = { kind: "category"; id: CategoryId; label: string } | { kind: "search"; query: string };

const fetchPage = (catalog: Flathub, source: Source, page: number): Promise<Answer<Page>> =>
  source.kind === "category" ? catalog.category(source.id, page, PER_PAGE) : catalog.search(source.query, page, PER_PAGE);

export function Listing({ source }: { source: Source }) {
  const { catalog } = useServices();
  const key = source.kind === "category" ? `category:${source.id}` : `search:${source.query}`;
  const first = useLoad<Page>(key, () => fetchPage(catalog, source, 1));
  const [more, setMore] = useState<{ key: string; apps: AppSummary[]; page: number; loading: boolean }>({ key, apps: [], page: 1, loading: false });
  const current = useRef(key);
  current.current = key;
  useEffect(() => setMore({ key, apps: [], page: 1, loading: false }), [key]);

  if (first.state.status === "loading") return <Loading what={source.kind === "search" ? "Searching…" : "Loading…"} />;
  if (first.state.status === "failed") return <Failed state={first.state} onRetry={first.reload} />;
  const page = first.state.value;
  const extra = more.key === key ? more : { key, apps: [], page: 1, loading: false };
  const seen = new Set(page.apps.map((app) => app.id));
  const apps = [...page.apps, ...extra.apps.filter((app) => !seen.has(app.id))];
  const hasMore = extra.page < page.totalPages;
  const title = source.kind === "category" ? source.label : `Results for “${source.query}”`;

  const showMore = (): void => {
    if (extra.loading) return;
    const next = extra.page + 1;
    setMore({ ...extra, loading: true });
    void fetchPage(catalog, source, next)
      .then((answer) => current.current === key && setMore({ key, apps: [...extra.apps, ...answer.value.apps], page: next, loading: false }))
      .catch(() => current.current === key && setMore({ ...extra, loading: false }));
  };

  if (apps.length === 0) {
    return (
      <EmptyState
        testID="no-results"
        glyph={glyphs.SEARCH}
        title="No Results"
        message={
          source.kind === "search"
            ? `Nothing in Flathub matches “${source.query}”. Check the spelling or try fewer words.`
            : "There are no apps in this category yet."
        }
      />
    );
  }
  return (
    <ScrollView testID="listing" style={{ flex: 1, flexDirection: "column", gap: 14, padding: 22 }}>
      {first.state.stale && <StaleNote />}
      <SectionHeader title={title} detail={page.total > 0 ? `${page.total.toLocaleString("en-US")} ${page.total === 1 ? "app" : "apps"}` : undefined} />
      <CardGrid apps={apps} />
      {hasMore && (
        <View style={{ flexShrink: 0, alignItems: "center", padding: 8 }}>
          <Button label={extra.loading ? "Loading…" : "Show More"} testID="show-more" onPress={showMore} disabled={extra.loading} />
        </View>
      )}
    </ScrollView>
  );
}
