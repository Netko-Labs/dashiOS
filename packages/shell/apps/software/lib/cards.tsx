/**
 * An app in a list: its icon, name, a line about it, who made it, and the
 * state chip; a click (or Return) opens its page. Cards sit in a grid that
 * fits its width (1 column below 600 px, so a narrow window keeps every
 * card's words; 2 below 900, 3 below 1300, then 4), one Tab
 * stop whose arrows move from card to card. Each card follows its own app's
 * state, so a progress tick redraws one card, not the grid.
 */

import { useColors, useSurface } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useState } from "react";
import type { AppSummary } from "../../../src/shared/software/index.ts";
import { StateChip } from "./chip.tsx";
import { useAppState } from "./hooks.ts";
import { VerifiedBadge } from "./marks.tsx";
import { appChip } from "./model.ts";
import { AppIcon, useActions } from "./parts.tsx";
import { useServices } from "./services.ts";
import { askReasons, isProprietary } from "./trust-words.ts";

/** How many columns a grid `width` px wide holds. */
export function columnsFor(width: number): number {
  if (width < 600) return 1;
  if (width < 900) return 2;
  if (width < 1300) return 3;
  return 4;
}

export function AppCard({ app }: { app: AppSummary }) {
  const colors = useColors();
  const surface = useSurface();
  const actions = useActions();
  const state = useAppState(app.id);
  const { catalog } = useServices();
  // Get… when its page's Get asks first: closed code is in the list's answer; far reach is known once its page was read.
  const read = catalog.detailsRead(app.id);
  const asks = isProprietary(app.license) || (read !== null && askReasons(read).length > 0);
  return (
    <View
      testID={`card:${app.id}`}
      focusable
      accessibilityRole="button"
      accessibilityLabel={app.name}
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
      {/* Each line ends in an ellipsis where it runs out of room (numberOfLines 1). */}
      <View style={{ flex: 1, flexDirection: "column", gap: 2, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5, minWidth: 0 }}>
          <View style={{ flexShrink: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>
              {app.name}
            </Text>
          </View>
          {app.verified && <VerifiedBadge size={12} />}
        </View>
        <Text numberOfLines={1} style={{ fontSize: 12, color: colors.textMuted }}>
          {app.summary || app.developer || ""}
        </Text>
        {app.developer !== null && app.summary !== "" && (
          <Text numberOfLines={1} style={{ fontSize: 11, color: colors.textMuted }}>
            {app.developer}
          </Text>
        )}
      </View>
      <StateChip
        chip={appChip(state, asks)}
        testID={`pill:${app.id}`}
        onPress={() =>
          state.kind === "get"
            ? actions.install(app.id, app.name)
            : state.kind === "open"
              ? actions.launch(app.id)
              : state.kind === "update"
                ? actions.update(state.installed, app.name)
                : undefined
        }
        onCancel={state.kind === "busy" ? () => actions.cancel(state.operation.key) : undefined}
      />
    </View>
  );
}

/** Cards in a grid as wide as its room allows; `columns` fixes the count. */
export function CardGrid({ apps, columns }: { apps: readonly AppSummary[]; columns?: number }) {
  const [width, setWidth] = useState(800);
  const count = columns ?? columnsFor(width);
  return (
    <View
      testID="card-grid"
      focusGroup
      onLayout={(bounds) => setWidth(bounds.width)}
      style={{ display: "grid", gridTemplateColumns: Array.from({ length: count }, () => "1fr" as const), gap: 12, flexShrink: 0 }}
    >
      {apps.map((app) => (
        <AppCard key={app.id} app={app} />
      ))}
    </View>
  );
}
