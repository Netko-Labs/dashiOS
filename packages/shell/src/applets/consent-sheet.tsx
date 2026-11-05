/**
 * The question before an applet runs for the first time, or after an update
 * that asks for more: who it is and what it will be able to do, in the
 * manifest's permissions put in plain words (@dashi/applet's permissions.ts),
 * and what it can't. Asked once; the answer is kept with the installed
 * applet (installed.ts). The Applet Store shows the same sheet when it adds
 * one, and the shell when an applet arrives another way.
 */

import { asksForPassword, cannotDo, describePermission, type Manifest } from "@dashi/applet";
import { Button, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";

/** The sheet's surface, with room for its shadow and a long list. */
export const APPLET_CONSENT = { width: 460, height: 520 } as const;

/** The lines under "It will be able to", each once, in the manifest's order. */
export function abilityLines(manifest: Manifest): string[] {
  const lines = manifest.permissions.map((permission) => `${describePermission(permission)}${asksForPassword(permission) ? " (asks for your password)" : ""}`);
  return [...new Set(lines)];
}

export interface AppletConsentProps {
  manifest: Manifest;
  /** "reviewed" when Dashi's maintainers checked it (the catalog says so). */
  reviewed?: boolean;
  /** An update asking for more: the title says so. */
  update?: boolean;
  onAnswer(yes: boolean): void;
}

export function AppletConsentSheet({ manifest, reviewed, update, onAnswer }: AppletConsentProps) {
  const colors = useColors();
  const lines = abilityLines(manifest);
  const cannot = cannotDo(manifest.permissions);
  const byline = [`by ${manifest.author.name}`, reviewed ? "reviewed" : null].filter(Boolean).join(" · ");
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <View
        occlude
        testID="applet-consent"
        style={{
          width: 400,
          flexDirection: "column",
          gap: 6,
          padding: 22,
          borderRadius: 18,
          backgroundColor: colors.launcher,
          borderWidth: 1,
          borderColor: colors.dockBorder,
          shadow: "xl",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ width: 42, height: 42, borderRadius: 10, backgroundColor: colors.selection, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 20, fontWeight: "bold", color: "#ffffff" }}>{([...manifest.name][0] ?? "?").toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: 2 }}>
            <Text style={{ fontSize: 15, fontWeight: "bold", color: colors.text }}>
              {update ? `“${manifest.name}” wants to do more` : `Add “${manifest.name}”?`}
            </Text>
            <Text style={{ fontSize: 12, color: colors.textMuted }}>{byline}</Text>
          </View>
        </View>
        <View style={{ marginTop: 10, flexDirection: "column", gap: 6 }}>
          <Text style={{ fontSize: 12, fontWeight: "semibold", color: colors.textMuted }}>
            {lines.length > 0 ? "It will be able to" : "It asks for nothing"}
          </Text>
          {lines.map((line) => (
            <View key={line} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
              <Text style={{ fontSize: 13, color: colors.selection }}>•</Text>
              <View style={{ flexShrink: 1 }}>
                <Text style={{ fontSize: 13, color: colors.text }}>{line}</Text>
              </View>
            </View>
          ))}
          {cannot !== null && (
            <View style={{ marginTop: 4 }}>
              <Text style={{ fontSize: 12, color: colors.textMuted }}>{cannot}</Text>
            </View>
          )}
        </View>
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <Button label={update ? "Not Now" : "Cancel"} testID="consent-cancel" onPress={() => onAnswer(false)} />
          <Button label={update ? "Allow" : "Add Applet"} testID="consent-add" primary onPress={() => onAnswer(true)} />
        </View>
      </View>
    </View>
  );
}
