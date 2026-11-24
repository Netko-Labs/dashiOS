/**
 * The Store's shelves (store-v2 §1.1, slice 1): Apps, with Flathub's
 * categories as chips on the page instead of rows in the sidebar; Launcher
 * extensions, the add-ons in Dashi's catalog whose point is their commands
 * (today's v3 `commands`); and Widgets, an empty shelf until the widgets
 * release. Every add-on is one kind of signed package and appears on every
 * shelf it contributes to (its manifest's `shows`, D352's `showsOf`). Themes stay hidden until the themes release (D326).
 */

import { Choices, EmptyState, Loading, SPACE } from "@dashi/ui";
import { ScrollView, View } from "@mirinjs/metal";
import type { StoreApplet } from "../../../src/shared/applet-store/index.ts";
import { CATEGORIES, type CategoryId } from "../../../src/shared/software/index.ts";
import { AppletsProblem } from "./applets/pages.tsx";
import { AppletGroup, useAppletState } from "./applets/rows.tsx";
import { isExtension } from "./applets/words.ts";
import { EXTENSIONS, WIDGETS } from "./glyphs.ts";
import { useReportStale } from "./hooks.ts";
import { Listing } from "./listing.tsx";

/** "6 commands": what an extension adds, for its row. */
export const commandsWords = (entry: StoreApplet): string =>
  `${entry.manifest.commands.length} ${entry.manifest.commands.length === 1 ? "command" : "commands"}`;

const POPULAR = "popular";

/** Apps: Flathub's categories as chips, Popular first; the page under them is the chosen one's. */
export function AppsPage({ category, onCategory }: { category: CategoryId | undefined; onCategory: (category: CategoryId | undefined) => void }) {
  const options = [{ value: POPULAR, label: "Popular" }, ...CATEGORIES.map((each) => ({ value: each.id as string, label: each.label }))];
  const chosen = CATEGORIES.find((each) => each.id === category);
  return (
    <View testID="apps-page" style={{ flex: 1, minHeight: 0, flexDirection: "column" }}>
      <View style={{ flexShrink: 0, paddingHorizontal: SPACE.sheet, paddingTop: SPACE.page }}>
        <Choices
          testID="apps-chips"
          options={options}
          value={chosen?.id ?? POPULAR}
          onChange={(value) => onCategory(CATEGORIES.find((each) => each.id === value)?.id)}
        />
      </View>
      <View style={{ flex: 1, minHeight: 0 }}>
        <Listing source={chosen ? { kind: "category", id: chosen.id, label: chosen.label } : { kind: "collection", id: "popular", label: "Popular" }} />
      </View>
    </View>
  );
}

export function ExtensionsPage() {
  const state = useAppletState();
  useReportStale(state.stale);
  if (state.index === null) return state.loading ? <Loading label="Loading the extensions…" /> : <AppletsProblem />;
  const entries = state.index.applets.filter(isExtension).sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  if (entries.length === 0) {
    return (
      <EmptyState
        testID="no-extensions"
        glyph={EXTENSIONS}
        title="No launcher extensions yet"
        message="Extensions add commands to the launcher. Dashi’s catalog has none yet; the ones it reviews will be here, and in the launcher’s Store."
      />
    );
  }
  return (
    <ScrollView testID="extensions-page" style={{ flex: 1, flexDirection: "column", gap: SPACE.button, padding: SPACE.sheet }}>
      <AppletGroup
        title="Launcher extensions"
        detail="Commands for the launcher, each reviewed by Dashi and run in its own sandbox"
        entries={entries}
        testID="extensions"
      />
    </ScrollView>
  );
}

export function WidgetsPage() {
  return (
    <EmptyState
      testID="widgets-shelf"
      glyph={WIDGETS}
      title="Widgets are coming"
      message="Widgets for the notification area, the lock screen and the desktop arrive with the widgets release. They will install from here, signed and reviewed like applets."
    />
  );
}
