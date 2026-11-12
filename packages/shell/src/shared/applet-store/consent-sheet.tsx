/**
 * The question before an applet gets what it asks for: when Software gets
 * one from the catalog, when an update asks for more, and when one arrives
 * another way and is about to run for the first time (the shell asks then).
 * Its real icon, who made it and who vouches for it ("Reviewed by Dashi",
 * "Signed by its author"), and what it will be able to do in the plain lines
 * Software's trust card and Settings use (@dashi/applet's permissions.ts).
 * For an update, what is new comes first and what was already allowed folds
 * away. Built on @dashi/ui's sheet (radius 12, padding 20, a 40 px icon):
 * `Sheet` in Software's window, `SheetCard` on the shell's own surface. A
 * grant: Enter never says yes, only a click does (UI-6).
 */

import { asksForPassword, COMMANDS_CONSENT, cannotDo, describePermission, type Manifest, permissionName } from "@dashi/applet";
import { type AlertButton, AlertButtons, CHEVRON_DOWN, CHEVRON_UP, KeySink, Sheet, SheetCard, tintFor, useColors } from "@dashi/ui";
import { Image, Svg, Text, View } from "@mirinjs/metal";
import { useState } from "react";

/** The sheet's surface on the shell, with room for its shadow and a long list. */
export const APPLET_CONSENT = { width: 460, height: 560 } as const;
const WIDTH = 420;

/** The line for what it adds to the launcher ("Adds 3 commands to the launcher"), or null when it adds none. */
export function commandsLine(manifest: Pick<Manifest, "commands">): string | null {
  const count = manifest.commands.length;
  return count === 0 ? null : `Adds ${count === 1 ? "1 command" : `${count} commands`} to the launcher`;
}

/** One line per permission, each once, in the manifest's order. */
export function abilityLines(manifest: Pick<Manifest, "permissions">): string[] {
  const lines = manifest.permissions.map((permission) => `${describePermission(permission)}${asksForPassword(permission) ? " (asks for your password)" : ""}`);
  return [...new Set(lines)];
}

/** What it asks for, split into what is new and what `granted` already allows (none granted: all new). */
export function splitAsks(manifest: Pick<Manifest, "permissions" | "commands">, granted: readonly string[] = []): { fresh: string[]; kept: string[] } {
  const had = new Set(granted);
  const line = (permission: Manifest["permissions"][number]): string =>
    `${describePermission(permission)}${asksForPassword(permission) ? " (asks for your password)" : ""}`;
  const fresh = new Set<string>();
  const kept = new Set<string>();
  for (const permission of manifest.permissions) (had.has(permissionName(permission)) ? kept : fresh).add(line(permission));
  const commands = commandsLine(manifest);
  if (commands) (had.has(COMMANDS_CONSENT) ? kept : fresh).add(commands);
  return { fresh: [...fresh], kept: [...kept] };
}

/** "By Netko Labs · Reviewed by Dashi · Signed by its author": who made it and who vouches for it (`reviewed` undefined: not known here). */
export function trustLine(manifest: Pick<Manifest, "author">, reviewed: boolean | undefined, signed: boolean): string {
  const review = reviewed === undefined ? null : reviewed ? "Reviewed by Dashi" : "Not reviewed by Dashi";
  return [`By ${manifest.author.name}`, review, signed ? "Signed by its author" : "Added by hand, not signed"]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

export type ConsentKind = "get" | "update" | "allow";

export interface AppletConsentProps {
  manifest: Manifest;
  /** "get" from the store, "update" when a new version asks for more, "allow" before one added another way first runs. */
  kind: ConsentKind;
  /** Dashi's maintainers checked it (the catalog says so); undefined where that isn't known (the shell). */
  reviewed?: boolean;
  /** It comes from the catalog, signed by its author (checked before it is installed). */
  signed?: boolean;
  /** Permission names already allowed: an update lists only what is new up front. */
  granted?: readonly string[];
  /** Its icon's file; its first letter on a tile until there is one. */
  icon?: string | null;
  onAnswer(yes: boolean): void;
}

const QUESTION: Record<ConsentKind, (name: string) => string> = {
  get: (name) => `Get “${name}”?`,
  update: (name) => `Update “${name}”?`,
  allow: (name) => `Allow “${name}”?`,
};

const MESSAGE: Record<ConsentKind, string> = {
  get: "It goes in the menu bar. You can turn it off or remove it in Software.",
  update: "The new version asks for more than you allowed before.",
  allow: "It was added to this computer and asks before it runs for the first time.",
};

function Icon({ file, name }: { file: string | null | undefined; name: string }) {
  if (file) return <Image source={file} style={{ width: 40, height: 40, borderRadius: 10 }} />;
  return (
    <View style={{ width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: tintFor(name) }}>
      <Text style={{ fontSize: 18, fontWeight: "bold", color: "#ffffffee" }}>{([...name.trim()][0] ?? "?").toUpperCase()}</Text>
    </View>
  );
}

function Lines({ lines, testID }: { lines: readonly string[]; testID: string }) {
  const colors = useColors();
  return (
    <View testID={testID} style={{ flexDirection: "column", gap: 4 }}>
      {lines.map((line) => (
        <View key={line} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
          <Text style={{ fontSize: 13, color: colors.textMuted }}>•</Text>
          <View style={{ flexShrink: 1 }}>
            <Text style={{ fontSize: 13, color: colors.text }}>{line}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function consentButtons(kind: ConsentKind, onAnswer: (yes: boolean) => void): AlertButton[] {
  return [
    { label: kind === "update" ? "Not now" : "Cancel", testID: "consent-cancel", onPress: () => onAnswer(false), cancel: true },
    {
      label: kind === "get" ? "Get" : kind === "update" ? "Update" : "Allow",
      testID: "consent-add",
      onPress: () => onAnswer(true),
      kind: "primary",
      isDefault: false,
    },
  ];
}

/** The sheet's insides: the icon and the question, who vouches for it, what it can do, the buttons. */
export function AppletConsentBody({ manifest, kind, reviewed, signed = false, granted, icon, onAnswer }: AppletConsentProps) {
  const colors = useColors();
  const [showKept, setShowKept] = useState(false);
  const { fresh, kept } = splitAsks(manifest, kind === "update" ? granted : []);
  const cannot = cannotDo(manifest.permissions);
  return (
    <>
      <View style={{ flexDirection: "row", gap: 14, alignItems: "flex-start" }}>
        <Icon file={icon} name={manifest.name} />
        <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: 4 }}>
          <Text style={{ fontSize: 13, fontWeight: "bold", color: colors.text, lineHeight: 17 }}>{QUESTION[kind](manifest.name)}</Text>
          <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 16 }}>{MESSAGE[kind]}</Text>
          <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 16 }}>{trustLine(manifest, reviewed, signed)}</Text>
        </View>
      </View>
      <View style={{ flexDirection: "column", gap: 6, paddingLeft: 54, flexShrink: 0 }}>
        <Text style={{ fontSize: 11, fontWeight: "semibold", color: colors.textMuted }}>
          {fresh.length === 0 ? "It asks for nothing more than showing itself in the menu bar" : kind === "update" ? "New" : "It will be able to"}
        </Text>
        <Lines lines={fresh} testID="applet-consent:new" />
        {kept.length > 0 && (
          <View
            testID="applet-consent:kept-toggle"
            focusable
            accessibilityRole="button"
            onPress={() => setShowKept((now) => !now)}
            style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}
          >
            <Text style={{ fontSize: 11, fontWeight: "semibold", color: colors.textMuted }}>{`Already allowed (${kept.length})`}</Text>
            <Svg markup={showKept ? CHEVRON_UP : CHEVRON_DOWN} size={10} color={colors.textMuted} />
          </View>
        )}
        {showKept && <Lines lines={kept} testID="applet-consent:kept" />}
        {cannot !== null && <Text style={{ fontSize: 12, color: colors.textMuted }}>{cannot}</Text>}
      </View>
      <AlertButtons buttons={consentButtons(kind, onAnswer)} />
    </>
  );
}

/** In a window (Software): a sheet hung from its toolbar. Esc says no; Enter says nothing. */
export function AppletConsentSheet(props: AppletConsentProps) {
  return (
    <Sheet testID="applet-consent" width={WIDTH} onCancel={() => props.onAnswer(false)}>
      <AppletConsentBody {...props} />
    </Sheet>
  );
}

/** On the shell's own surface (an applet added another way): the same card, centered, Esc says no. */
export function AppletConsentCard(props: AppletConsentProps) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <KeySink testID="applet-consent:keys" onKey={(key) => key.kind === "escape" && props.onAnswer(false)} />
      <SheetCard testID="applet-consent" width={WIDTH}>
        <AppletConsentBody {...props} />
      </SheetCard>
    </View>
  );
}
