/** An app in a list: its icon, name, a line about it, and the pill; a click opens its page. */

import { Text, View } from "@mirinjs/metal";
import { useState, useSyncExternalStore } from "react";
import type { AppSummary } from "../../src/software/flathub-types.ts";
import { useColors, useSurface } from "@dashi/ui";
import { fitText } from "./format.ts";
import { appState } from "./model.ts";
import { ActionPill, AppIcon, useActions, VerifiedBadge } from "./parts.tsx";
import { useServices } from "./services.ts";

/** The state of one app's button, live from the store. */
export function useAppState(id: string) {
  const { store } = useServices();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return appState(id, state.installed ?? [], state.appUpdates ?? [], state.operations);
}

export function AppCard({ app }: { app: AppSummary }) {
  const colors = useColors();
  const surface = useSurface();
  const actions = useActions();
  const state = useAppState(app.id);
  // Metal cuts a line that runs out of room but draws no ellipsis, so the lines are fitted to the column's width here.
  const [room, setRoom] = useState(180);
  return (
    <View
      testID={`card:${app.id}`}
      onPress={() => actions.openApp(app.id)}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: 12,
        minWidth: 0,
        borderRadius: 10,
        backgroundColor: surface.card,
        borderWidth: 1,
        borderColor: colors.separator,
        hoverBackgroundColor: colors.tileHover,
      }}
    >
      <AppIcon url={app.icon} name={app.name} size={52} />
      <View onLayout={(bounds) => setRoom(bounds.width)} style={{ flex: 1, flexDirection: "column", gap: 2, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5, minWidth: 0 }}>
          <View style={{ flexShrink: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>
              {app.name}
            </Text>
          </View>
          {app.verified && <VerifiedBadge size={12} />}
        </View>
        <Text numberOfLines={1} style={{ fontSize: 12, color: colors.textMuted }}>
          {fitText(app.summary || app.developer || "", room, 12)}
        </Text>
        {app.developer !== null && app.summary !== "" && (
          <Text numberOfLines={1} style={{ fontSize: 11, color: colors.textDisabled }}>
            {fitText(app.developer, room, 11)}
          </Text>
        )}
      </View>
      <ActionPill state={state} testID={`pill:${app.id}`} onGet={() => actions.install(app.id, app.name)} />
    </View>
  );
}

/** Cards in a grid of `columns`. */
export function CardGrid({ apps, columns = 2 }: { apps: readonly AppSummary[]; columns?: number }) {
  return (
    <View style={{ display: "grid", gridTemplateColumns: Array.from({ length: columns }, () => "1fr" as const), gap: 12, flexShrink: 0 }}>
      {apps.map((app) => (
        <AppCard key={app.id} app={app} />
      ))}
    </View>
  );
}
