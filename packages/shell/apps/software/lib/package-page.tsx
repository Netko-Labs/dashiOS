/**
 * An app or a command-line tool from a package source (Fedora, Terra, a
 * COPR, RPM Fusion): its icon, name and summary, the buttons that fit
 * (Get…, Open, Remove…), the Source pop-up, and the trust card's rows for a
 * package: who vouches for it, that it runs with the account's full access,
 * the version. A tool says how to use it ("Type ripgrep in Terminal").
 */

import { Button, Group, useColors } from "@dashi/ui";
import { ScrollView, Svg, Text, View } from "@mirinjs/metal";
import type { CatalogEntry, Offer } from "../../../src/shared/software/index.ts";
import { useCatalog, useOfferState } from "./catalog-hooks.ts";
import { StateChip } from "./chip.tsx";
import { TERMINAL } from "./glyphs.ts";
import { AppIcon, useActions } from "./parts.tsx";
import { getAllowed, SourcePicker } from "./source-picker.tsx";
import { packageMaker, packageRuns } from "./source-words.ts";

function TrustRow({ label, name, line, testID }: { label: string; name: string; line: string; testID: string }) {
  const colors = useColors();
  return (
    <View testID={testID} style={{ flexDirection: "row", gap: 16, paddingHorizontal: 14, paddingVertical: 10 }}>
      <View style={{ width: 110, flexShrink: 0 }}>
        <Text style={{ fontSize: 12, color: colors.textMuted }}>{label}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: 2 }}>
        <Text style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>{name}</Text>
        <Text style={{ fontSize: 12, lineHeight: 17, color: colors.textMuted }}>{line}</Text>
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
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <Button label="Remove…" testID="remove-package" onPress={() => actions.removePackage(entry, offer)} />
        {entry.kind === "app" && entry.desktopId !== null && <Button label="Open" testID="open-package" primary onPress={() => actions.openPackage(entry)} />}
      </View>
    );
  }
  return <Button label="Get…" testID="get-package" primary disabled={!getAllowed(entry, offer)} onPress={() => actions.getPackage(entry, offer)} />;
}

export function PackagePage({ entry, offer }: { entry: CatalogEntry; offer: Offer }) {
  const colors = useColors();
  const sources = useCatalog()?.sources ?? [];
  const maker = packageMaker(sources, offer);
  const tool = entry.kind === "tool";
  const icon = entry.icon?.startsWith("/") ? { file: entry.icon } : { url: entry.icon };
  return (
    <ScrollView testID="package-page" style={{ flex: 1, flexDirection: "column", gap: 20, padding: 24 }}>
      <View style={{ flexShrink: 0, flexDirection: "row", alignItems: "flex-start", gap: 18 }}>
        {tool ? (
          <View style={{ width: 80, height: 80, borderRadius: 18, backgroundColor: "#1f1f1f", alignItems: "center", justifyContent: "center" }}>
            <Svg markup={TERMINAL} size={36} color="#ffffff" />
          </View>
        ) : (
          <AppIcon {...icon} name={entry.name} size={80} />
        )}
        <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: 4 }}>
          <Text style={{ fontSize: 20, fontWeight: "bold", color: colors.text }}>{entry.name}</Text>
          <Text style={{ fontSize: 13, color: colors.textMuted }}>
            {[entry.developer, tool ? "Runs in Terminal" : null].filter(Boolean).join(" · ") || offer.ref}
          </Text>
          <Text style={{ fontSize: 13, color: colors.text, lineHeight: 18 }}>{entry.summary}</Text>
          {offer.installed && tool && <Text style={{ fontSize: 12, color: colors.textMuted }}>{"Installed. It runs in Terminal."}</Text>}
        </View>
        <View style={{ flexShrink: 0, flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          <Buttons entry={entry} offer={offer} />
          <SourcePicker entry={entry} offer={offer} />
        </View>
      </View>
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
