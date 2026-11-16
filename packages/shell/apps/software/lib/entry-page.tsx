/** A catalog row's page, on the source asked for or its default: Flathub's page for a Flatpak, the package page otherwise. */

import { EmptyState, glyphs, Loading } from "@dashi/ui";
import { AppPage } from "./app-page.tsx";
import { useCatalog } from "./catalog-hooks.ts";
import { PackagePage } from "./package-page.tsx";

export function EntryPage({ entryKey, source }: { entryKey: string; source?: string | undefined }) {
  const data = useCatalog();
  if (data === null) return <Loading label="Reading the catalog…" />;
  const entry = data.entries.find((each) => each.key === entryKey);
  const offer = entry?.offers.find((each) => each.source === source) ?? entry?.offers[0];
  if (!entry || !offer) {
    return (
      <EmptyState
        testID="entry-gone"
        glyph={glyphs.SEARCH}
        title="Not in your sources now"
        message="None of the sources that are on has it. A source you turned off in Sources… may have had it."
      />
    );
  }
  if (offer.kind === "flatpak") return <AppPage id={offer.ref} />;
  return <PackagePage entry={entry} offer={offer} />;
}
