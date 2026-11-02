/** Small pieces the pages share: an app's icon, the verified badge, the progress bar, and the Get / Open / Update pill. */

import { darkColors, useColors } from "@dashi/ui";
import { Image, Svg, Text, View } from "@mirinjs/metal";
import { createContext, useContext, useEffect, useState } from "react";
import type { InstalledApp } from "../../src/software/flatpak-parse.ts";
import type { Installation } from "../../src/software/ids.ts";
import { VERIFIED, VERIFIED_CHECK } from "./glyphs.ts";
import { useImage } from "./hooks.ts";
import { type AppState, busyLabel } from "./model.ts";

/** What a click on an app's button does; the window provides it. */
export interface Actions {
  openApp(id: string): void;
  install(id: string, name: string): void;
  launch(id: string): void;
  update(app: InstalledApp, name: string): void;
  /** Updates every app in an installation. */
  updateAll(installation: Installation): void;
  remove(app: InstalledApp): void;
  cancel(key: string): void;
}

export const ActionsContext = createContext<Actions | null>(null);

export function useActions(): Actions {
  const actions = useContext(ActionsContext);
  if (!actions) throw new Error("Software's actions are not provided");
  return actions;
}

const LETTER_TINTS = ["#5b6ad0", "#3b8fd0", "#2f9d8f", "#4f8f4f", "#c7892b", "#d97a2c", "#d0527f", "#6E56CF", "#7a7a82"];

function tintFor(name: string): string {
  let sum = 0;
  for (const char of name) sum = (sum * 31 + char.charCodeAt(0)) % 9973;
  return LETTER_TINTS[sum % LETTER_TINTS.length] ?? "#7a7a82";
}

/** An app's icon from a file or a URL in the image cache; until it is here, its first letter on a tinted tile. */
export function AppIcon({ url, file, name, size }: { url?: string | null; file?: string | null; name: string; size: number }) {
  const downloaded = useImage(file ? null : (url ?? null));
  const path = file ?? downloaded;
  if (path) return <Image source={path} style={{ width: size, height: size, borderRadius: size * 0.22 }} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.22, alignItems: "center", justifyContent: "center", backgroundColor: tintFor(name) }}>
      <Text style={{ fontSize: size * 0.46, fontWeight: "semibold", color: "#ffffffee" }}>{(name.trim()[0] ?? "?").toUpperCase()}</Text>
    </View>
  );
}

/** A check in a seal: Flathub has verified who publishes the app. */
export function VerifiedBadge({ size = 14 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center", position: "relative" }}>
      <Svg markup={VERIFIED} size={size} color="#3b8fd0" />
      <View style={{ position: "absolute", left: 0, top: 0, width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <Svg markup={VERIFIED_CHECK} size={size * 0.8} color="#ffffff" />
      </View>
    </View>
  );
}

/** A bar of `fraction` (0 to 1); without one, a segment that slides, so the person can see it is working. */
export function ProgressBar({ fraction, width = 120 }: { fraction: number | null; width?: number }) {
  const colors = useColors();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (fraction !== null) return;
    const timer = setInterval(() => setTick((n) => (n + 1) % 20), 120);
    return () => clearInterval(timer);
  }, [fraction]);
  const segment = Math.round(width * 0.3);
  const left = fraction === null ? Math.round(((width - segment) * (tick <= 10 ? tick : 20 - tick)) / 10) : 0;
  return (
    <View style={{ width, height: 4, borderRadius: 2, backgroundColor: colors.track, overflow: "hidden", position: "relative" }}>
      <View
        style={{
          position: "absolute",
          left,
          top: 0,
          height: 4,
          borderRadius: 2,
          width: fraction === null ? segment : Math.max(4, Math.round(width * fraction)),
          backgroundColor: colors.selection,
        }}
      />
    </View>
  );
}

/**
 * The small button on a card or row: Get, Open, or Update; while something is
 * being done it shows the progress instead (stopping it is on the app's page).
 */
export function ActionPill({ state, onGet, testID, wide }: { state: AppState; onGet: () => void; testID: string; wide?: boolean }) {
  const colors = useColors();
  const actions = useActions();
  const minWidth = wide ? 84 : 64;
  // The accent on the pill's gray: lighter in Dark Mode, where kombu alone is too quiet.
  const ink = colors === darkColors ? "#7fd1b2" : colors.selection;
  if (state.kind === "busy") {
    const { operation } = state;
    return (
      <View testID={`${testID}:busy`} style={{ minWidth, flexShrink: 0, flexDirection: "column", alignItems: "center", gap: 4 }}>
        <Text numberOfLines={1} style={{ fontSize: 11, color: colors.textMuted }}>
          {busyLabel(operation)}
        </Text>
        <ProgressBar fraction={operation.status === "queued" ? null : (operation.progress?.fraction ?? null)} width={minWidth} />
      </View>
    );
  }
  const label = state.kind === "get" ? "Get" : state.kind === "open" ? "Open" : "Update";
  const press = (): void => {
    if (state.kind === "get") onGet();
    else if (state.kind === "open") actions.launch(state.installed.id);
    else actions.update(state.installed, state.installed.name);
  };
  return (
    <View
      testID={testID}
      onPress={press}
      style={{
        minWidth,
        height: 26,
        flexShrink: 0,
        paddingHorizontal: 12,
        borderRadius: 13,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.button,
        hoverBackgroundColor: colors.separator,
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: "bold", color: ink }}>{label}</Text>
    </View>
  );
}
