/**
 * "Recommended for Dashi" on Discover: the apps the Setup Assistant offers
 * (src/shared/software/recommended.ts), as cards with the usual Get / Open pill.
 * The list is local, so the cards show at once, offline too. The catalog
 * (cached for hours) adds each card's icon, publisher and verified mark;
 * the name and the line stay Dashi's own, which are written to fit a card.
 */

import { type AppSummary, type Flathub, RECOMMENDED_APPS, type RecommendedApp } from "../../../src/shared/software/index.ts";
import { CardGrid } from "./cards.tsx";
import { useLoad } from "./hooks.ts";
import { useServices } from "./services.ts";

/** A card for an app the catalog did not describe: the list's words, no icon (its letter stands in). */
export function summaryOf(app: RecommendedApp): AppSummary {
  return {
    id: app.id,
    name: app.name,
    summary: app.summary,
    developer: null,
    icon: null,
    verified: false,
    category: null,
    license: null,
    installsLastMonth: null,
    updatedAt: null,
  };
}

/** Every recommended app as a card, in the list's order, with Dashi's name and line; one the catalog fails on is `summaryOf` alone. */
export async function loadRecommended(
  catalog: Pick<Flathub, "details">,
  apps: readonly RecommendedApp[] = RECOMMENDED_APPS,
): Promise<{ value: AppSummary[]; stale: boolean }> {
  const results = await Promise.allSettled(apps.map((app) => catalog.details(app.id)));
  const value = apps.map((app, index) => {
    const result = results[index];
    if (result?.status !== "fulfilled") return summaryOf(app);
    // Only the summary's fields (a card holds no description or screenshots), and Dashi's words over Flathub's.
    const { developer, icon, verified, category, license, installsLastMonth, updatedAt } = result.value.value;
    return { ...summaryOf(app), developer, icon, verified, category, license, installsLastMonth, updatedAt };
  });
  return { value, stale: results.some((result) => result.status === "fulfilled" && result.value.stale) };
}

/** The cards; Discover puts them under their heading. */
export function RecommendedCards() {
  const { catalog } = useServices();
  const { state } = useLoad<AppSummary[]>("recommended", () => loadRecommended(catalog));
  // While loading, offline, or if Flathub fails, the list's own cards show: nothing here needs the network.
  const apps = state.status === "ready" ? state.value : RECOMMENDED_APPS.map(summaryOf);
  return <CardGrid apps={apps} />;
}
