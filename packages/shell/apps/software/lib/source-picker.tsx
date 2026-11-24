/**
 * The Source pop-up on an app's page (flows/store frame 3): every source the
 * app is in, the one shown chosen, and under it why that one ("From Flathub:
 * apps there run in a sandbox…"). Choosing another shows the app from there.
 * When the app is installed from one source, the others say so instead of
 * offering a second copy (D323).
 */

import { PopUpButton, SPACE, TYPE, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import type { CatalogEntry, Offer } from "../../../src/shared/software/index.ts";
import { useCatalog } from "./catalog-hooks.ts";
import { useActions } from "./parts.tsx";
import { offerLabel, sourceOf, whyLine } from "./source-words.ts";

export function SourcePicker({ entry, offer }: { entry: CatalogEntry; offer: Offer }) {
  const colors = useColors();
  const actions = useActions();
  const sources = useCatalog()?.sources ?? [];
  const installedElsewhere = entry.offers.find((each) => each.installed && each !== offer);
  const options = entry.offers.map((each) => ({ value: each.source, label: offerLabel(sources, each) }));
  return (
    <View testID="source-picker" style={{ flexShrink: 0, flexDirection: "column", alignItems: "flex-end", gap: SPACE.xs }}>
      {entry.offers.length > 1 ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.s }}>
          <Text style={{ fontSize: TYPE.secondary.size, color: colors.textMuted }}>From</Text>
          <PopUpButton testID="source-pop-up" options={options} value={offer.source} onChange={(source) => actions.openEntry(entry.key, source)} />
        </View>
      ) : (
        <Text style={{ fontSize: TYPE.secondary.size, color: colors.textMuted }}>{`From ${sourceOf(sources, offer)?.label ?? "its source"}`}</Text>
      )}
      <View testID="source-why" style={{ maxWidth: 320 }}>
        <Text style={{ fontSize: TYPE.caption.size, lineHeight: TYPE.caption.line, color: colors.textMuted, textAlign: "right" }}>
          {installedElsewhere
            ? `Installed from ${sourceOf(sources, installedElsewhere)?.label ?? "another source"}. Remove that one first to get it from here.`
            : whyLine(sources, entry, offer)}
        </Text>
      </View>
    </View>
  );
}

/** Whether Get is offered for this source: not when the app is already installed from another. */
export const getAllowed = (entry: CatalogEntry, offer: Offer): boolean => !entry.offers.some((each) => each.installed && each !== offer);
