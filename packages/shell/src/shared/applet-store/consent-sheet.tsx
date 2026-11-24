/**
 * The question before an applet gets what it asks for: when Software gets
 * one from the catalog, when an update asks for more, and when one arrives
 * another way and is about to run for the first time (the shell asks then).
 * Its real icon, who made it and who vouches for it ("Reviewed by Dashi",
 * "Signed by its author"), and what it will be able to do in the plain lines
 * Software's trust card and Settings use (@dashi/applet's permissions.ts).
 * For an update, what is new comes first and what was already allowed folds
 * away. The alert frame (UI-5) with the applet's icon as its tile:
 * `AlertSheet` hung in Software's window, centred on the shell's own surface.
 * A grant: Enter never says yes, only a click does (UI-6).
 */

import { asksForPassword, COMMANDS_CONSENT, cannotDo, describePermission, type Manifest, permissionName } from "@dashi/applet";
import {
  ALERT_TILE,
  type AlertButton,
  AlertSheet,
  type AlertSheetProps,
  MoreButton,
  ON_TINT,
  RADIUS,
  SPACE,
  TYPE,
  tintFor,
  useColors,
  WEIGHT,
} from "@dashi/ui";
import { Image, Text, View } from "@mirinjs/metal";
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
  get: "It goes in the menu bar. You can turn it off or remove it in the Store.",
  update: "The new version asks for more than you allowed before.",
  allow: "It was added to this computer and asks before it runs for the first time.",
};

/** Its icon on the tile's 40 square, or its first letter on its tint until there is one. */
function Icon({ file, name }: { file: string | null | undefined; name: string }) {
  const square = { width: ALERT_TILE.size, height: ALERT_TILE.size, borderRadius: RADIUS.card } as const;
  if (file) return <Image source={file} style={square} />;
  return (
    <View style={{ ...square, alignItems: "center", justifyContent: "center", backgroundColor: tintFor(name) }}>
      <Text style={{ fontSize: TYPE.title.size, fontWeight: WEIGHT.bold, color: ON_TINT }}>{([...name.trim()][0] ?? "?").toUpperCase()}</Text>
    </View>
  );
}

function Lines({ lines, testID }: { lines: readonly string[]; testID: string }) {
  const colors = useColors();
  return (
    <View testID={testID} style={{ flexDirection: "column", gap: SPACE.xs }}>
      {lines.map((line) => (
        <View key={line} style={{ flexDirection: "row", gap: SPACE.m, alignItems: "flex-start" }}>
          <Text style={{ fontSize: TYPE.body.size, color: colors.textMuted }}>•</Text>
          <View style={{ flexShrink: 1 }}>
            <Text style={{ fontSize: TYPE.body.size, lineHeight: TYPE.body.line, color: colors.text }}>{line}</Text>
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

/** The sheet's words and buttons: the icon and the question, who vouches for it, what it can do. Esc says no; Enter says nothing. */
function useAppletConsent({ manifest, kind, reviewed, signed = false, granted, icon, onAnswer }: AppletConsentProps): AlertSheetProps {
  const colors = useColors();
  const [showKept, setShowKept] = useState(false);
  const { fresh, kept } = splitAsks(manifest, kind === "update" ? granted : []);
  const cannot = cannotDo(manifest.permissions);
  const caption = { fontSize: TYPE.caption.size, lineHeight: TYPE.caption.line, fontWeight: WEIGHT.semibold, color: colors.textMuted } as const;
  return {
    testID: "applet-consent",
    width: WIDTH,
    question: QUESTION[kind](manifest.name),
    message: MESSAGE[kind],
    glyph: "",
    icon: <Icon file={icon} name={manifest.name} />,
    buttons: consentButtons(kind, onAnswer),
    children: (
      <>
        <Text style={{ fontSize: TYPE.secondary.size, lineHeight: TYPE.secondary.line, color: colors.textMuted }}>{trustLine(manifest, reviewed, signed)}</Text>
        <View style={{ flexDirection: "column", gap: SPACE.s }}>
          <Text style={caption}>
            {fresh.length === 0 ? "It asks for nothing more than showing itself in the menu bar" : kind === "update" ? "New" : "It will be able to"}
          </Text>
          <Lines lines={fresh} testID="applet-consent:new" />
          {kept.length > 0 && (
            <MoreButton
              testID="applet-consent:kept-toggle"
              open={showKept}
              more={`Already allowed (${kept.length})`}
              less="Hide what is allowed"
              onPress={() => setShowKept((now) => !now)}
            />
          )}
          {showKept && <Lines lines={kept} testID="applet-consent:kept" />}
          {cannot !== null && <Text style={{ fontSize: TYPE.secondary.size, color: colors.textMuted }}>{cannot}</Text>}
        </View>
      </>
    ),
  };
}

/** In a window (Software): a sheet hung from its toolbar. */
export function AppletConsentSheet(props: AppletConsentProps) {
  return <AlertSheet {...useAppletConsent(props)} />;
}

/** On the shell's own surface (an applet added another way): the same sheet, centred. */
export function AppletConsentCard(props: AppletConsentProps) {
  return <AlertSheet {...useAppletConsent(props)} place="screen" />;
}
