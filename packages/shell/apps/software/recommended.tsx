/**
 * "Recommended for Dashi" on Discover: the apps the Setup Assistant offers
 * (src/software/recommended.ts), as cards with the usual Get / Open pill.
 * Each card's icon and line come from the catalog (cached for hours); an app
 * the catalog can't answer for keeps the list's own name and summary.
 */

import type { Flathub } from "../../src/software/flathub.ts";
import type { AppSummary } from "../../src/software/flathub-types.ts";
import { RECOMMENDED_APPS, type RecommendedApp } from "../../src/software/recommended.ts";
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

/** Every recommended app as a card, in the list's order; one the catalog fails on falls back to `summaryOf`. */
export async function loadRecommended(
  catalog: Pick<Flathub, "details">,
  apps: readonly RecommendedApp[] = RECOMMENDED_APPS,
): Promise<{ value: AppSummary[]; stale: boolean }> {
  const results = await Promise.allSettled(apps.map((app) => catalog.details(app.id)));
  const value = apps.map((app, index) => {
    const result = results[index];
    if (result?.status !== "fulfilled") return summaryOf(app);
    // Only the summary's fields: a card holds no description or screenshots.
    const { id, name, summary, developer, icon, verified, category, license, installsLastMonth, updatedAt } = result.value.value;
    return { id, name, summary, developer, icon, verified, category, license, installsLastMonth, updatedAt };
  });
  return { value, stale: results.some((result) => result.status === "fulfilled" && result.value.stale) };
}

/** The cards; Discover puts them under their heading. */
export function RecommendedCards() {
  const { catalog } = useServices();
  const { state } = useLoad<AppSummary[]>("recommended", () => loadRecommended(catalog));
  // While loading (or if it somehow fails) the list's own cards show at once: nothing here needs the network.
  const apps = state.status === "ready" ? state.value : RECOMMENDED_APPS.map(summaryOf);
  return <CardGrid apps={apps} />;
}
