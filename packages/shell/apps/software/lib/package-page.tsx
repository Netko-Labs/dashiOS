/**
 * An app or a command-line tool from a package source (Fedora, Terra, a
 * COPR, RPM Fusion): its icon, name and summary, the buttons that fit
 * (Get…, Open, Remove…), the Source pop-up, and the trust card's rows for a
 * package: who vouches for it, that it runs with the account's full access,
 * the version. A tool says how to use it ("Type ripgrep in Terminal").
 */

import { Button, Group, INK_TILE, ON_TINT, SPACE, TYPE, useColors, WEIGHT } from "@dashi/ui";
import { ScrollView, Svg, Text, View } from "@mirinjs/metal";
import type { CatalogEntry, Offer } from "../../../src/shared/software/index.ts";
import { useCatalog, useOfferState } from "./catalog-hooks.ts";
import { StateChip } from "./chip.tsx";
import { TERMINAL } from "./glyphs.ts";
import { HeaderLine, ITEM_PAGE, PAGE_ICON, PageHeader } from "./page-header.tsx";
import { AppIcon, iconRadius, useActions } from "./parts.tsx";
import { getAllowed, SourcePicker } from "./source-picker.tsx";
import { packageMaker, packageRuns } from "./source-words.ts";

/** A trust row's label column, and a tool's tile glyph on the page. */
const TRUST_LABEL = 110;
const TOOL_GLYPH = 36;

function TrustRow({ label, name, line, testID }: { label: string; name: string; line: string; testID: string }) {
  const colors = useColors();
  return (
    <View testID={testID} style={{ flexDirection: "row", gap: SPACE.page, paddingHorizontal: SPACE.button, paddingVertical: SPACE.gap }}>
      <View style={{ width: TRUST_LABEL, flexShrink: 0 }}>
        <Text style={{ fontSize: TYPE.secondary.size, color: colors.textMuted }}>{label}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: SPACE.xxs }}>
        <Text style={{ fontSize: TYPE.body.size, fontWeight: WEIGHT.semibold, color: colors.text }}>{name}</Text>
        <Text style={{ fontSize: TYPE.secondary.size, lineHeight: TYPE.secondary.line, color: colors.textMuted }}>{line}</Text>
      </View>
    </View>
  );
}

function Buttons({ entry, offer }: { entry: CatalogEntry; offer: Offer }) {
  const actions = useActions();
  const { rpm } = useOfferState(offer);
  if (rpm?.kind === "busy")
    return <StateChip chip={{ kind: "busy", operation: rpm.operation }} testID="package" wide onCancel={() => actions.cancel(rpm.operation.key)} />;
  if (rpm?.kind === "installed") {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.m, flexShrink: 0 }}>
        <Button label="Remove…" testID="remove-package" onPress={() => actions.removePackage(entry, offer)} />
        {entry.kind === "app" && entry.desktopId !== null && <Button label="Open" testID="open-package" primary onPress={() => actions.openPackage(entry)} />}
      </View>
    );
  }
  return <Button label="Get…" testID="get-package" primary disabled={!getAllowed(entry, offer)} onPress={() => actions.getPackage(entry, offer)} />;
}

export function PackagePage({ entry, offer }: { entry: CatalogEntry; offer: Offer }) {
  const sources = useCatalog()?.sources ?? [];
  const maker = packageMaker(sources, offer);
  const tool = entry.kind === "tool";
  const icon = entry.icon?.startsWith("/") ? { file: entry.icon } : { url: entry.icon };
  return (
    <ScrollView testID="package-page" style={{ flex: 1, flexDirection: "column", gap: ITEM_PAGE.gap, padding: ITEM_PAGE.padding }}>
      <PageHeader
        icon={
          tool ? (
            <View
              style={{
                width: PAGE_ICON,
                height: PAGE_ICON,
                borderRadius: iconRadius(PAGE_ICON),
                backgroundColor: INK_TILE,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Svg markup={TERMINAL} size={TOOL_GLYPH} color={ON_TINT} />
            </View>
          ) : (
            <AppIcon {...icon} name={entry.name} size={PAGE_ICON} />
          )
        }
        title={entry.name}
        byline={[entry.developer, tool ? "Runs in Terminal" : null].filter(Boolean).join(" · ") || offer.ref}
        summary={entry.summary}
        actions={
          <>
            <Buttons entry={entry} offer={offer} />
            <SourcePicker entry={entry} offer={offer} />
          </>
        }
      >
        {offer.installed && tool && <HeaderLine>Installed. It runs in Terminal.</HeaderLine>}
      </PageHeader>
      <Group testID="package-trust">
        <TrustRow testID="trust:made-by" label="Made by" name={maker.name} line={maker.line} />
        <TrustRow testID="trust:runs" label="Runs" name={packageRuns.name} line={packageRuns.line} />
        <TrustRow
          testID="trust:version"
          label="Version"
          name={offer.version ?? "Not known"}
          line={[`The ${offer.ref} package`, offer.repoId ? `from the ${offer.repoId} repository` : null, entry.license].filter(Boolean).join(" · ")}
        />
      </Group>
    </ScrollView>
  );
}
