/**
 * The Applet Store's lists: Discover (the ones for this computer first, then
 * the rest), a category, search results, Installed, and Updates. Each is
 * compact rows (rows.tsx).
 */

import type { IndexApplet } from "@dashi/applet";
import { Button, EmptyState, Group, glyphs, useColors } from "@dashi/ui";
import { ScrollView, Text, View } from "@mirinjs/metal";
import { DISCOVER, INSTALLED, OFFLINE, UPDATES } from "../software/glyphs.ts";
import { Loading } from "../software/states.tsx";
import { CATEGORY_LABELS, matches, type Page } from "./nav.ts";
import { AppletIcon, RowGroup, useActions, useStoreState } from "./rows.tsx";
import { useServices } from "./services.ts";

const byName = (a: IndexApplet, b: IndexApplet): number => a.manifest.name.localeCompare(b.manifest.name);

function Problem() {
  const { store } = useServices();
  const { problem } = useStoreState();
  if (!problem) return null;
  const title = problem.kind === "offline" ? "You're offline" : problem.kind === "no-key" ? "The Applet Store isn't set up yet" : "The catalog didn't check";
  const message =
    problem.kind === "offline"
      ? "The Applet Store needs the internet to look for applets. Your installed applets keep working."
      : problem.kind === "unsigned"
        ? `Nothing from it is shown: ${problem.message}`
        : problem.message;
  return (
    <EmptyState
      testID="problem"
      glyph={problem.kind === "offline" ? OFFLINE : glyphs.WARNING}
      title={title}
      message={message}
      action={<Button label="Try Again" testID="retry" onPress={() => void store.refresh()} />}
    />
  );
}

function Note({ text, testID }: { text: string; testID: string }) {
  const colors = useColors();
  return (
    <View testID={testID} style={{ flexShrink: 0, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.button }}>
      <Text style={{ fontSize: 11, color: colors.textMuted }}>{text}</Text>
    </View>
  );
}

export function ListPage({ page }: { page: Extract<Page, { kind: "all" | "category" | "search" }> }) {
  const { store } = useServices();
  const state = useStoreState();
  if (state.index === null) return state.loading ? <Loading what="Loading the catalog…" /> : <Problem />;
  let entries = [...state.index.applets].sort(byName);
  if (page.kind === "category") entries = entries.filter((entry) => entry.manifest.categories.includes(page.id));
  if (page.kind === "search")
    entries = entries.filter((entry) =>
      matches(page.query, { name: entry.manifest.name, summary: entry.manifest.summary, author: entry.manifest.author.name, id: entry.manifest.id }),
    );
  if (entries.length === 0) {
    return (
      <EmptyState
        testID="no-results"
        glyph={page.kind === "search" ? glyphs.SEARCH : DISCOVER}
        title={page.kind === "search" ? "No Results" : "Nothing here yet"}
        message={page.kind === "search" ? `No applet matches “${page.query}”.` : "There are no applets in this category yet."}
      />
    );
  }
  // On Discover, the applets made for this computer come first.
  const forHere = page.kind === "all" ? entries.filter((entry) => entry.manifest.when !== undefined && store.fitsHere(entry) === true) : [];
  const rest = entries.filter((entry) => !forHere.includes(entry));
  return (
    <ScrollView testID="list" style={{ flex: 1, flexDirection: "column", gap: 16, padding: 22 }}>
      {state.stale && <Note testID="stale" text="The catalog can't be reached, so this is the one from earlier." />}
      <RowGroup title={forHere.length > 0 ? "For This Computer" : undefined} entries={forHere} testID="for-here" />
      <RowGroup title={forHere.length > 0 ? "All Applets" : page.kind === "category" ? CATEGORY_LABELS[page.id] : undefined} entries={rest} testID="applets" />
    </ScrollView>
  );
}

/** Installed: what is on this machine, from the catalog or by hand, with Remove; a pulled one says why. */
export function InstalledPage({ query }: { query: string }) {
  const colors = useColors();
  const actions = useActions();
  const state = useStoreState();
  const installed = state.installed.filter((each) =>
    matches(query, { name: each.manifest.name, summary: each.manifest.summary, author: each.manifest.author.name, id: each.manifest.id }),
  );
  if (installed.length === 0) {
    return (
      <EmptyState
        testID="installed-empty"
        glyph={INSTALLED}
        title={query.trim() ? "No Results" : "No applets yet"}
        message={query.trim() ? `None of your applets match “${query.trim()}”.` : "Applets you get show up here, and in the menu bar."}
      />
    );
  }
  return (
    <ScrollView testID="installed" style={{ flex: 1, flexDirection: "column", gap: 12, padding: 22 }}>
      {state.justPulled.length > 0 && (
        <Note testID="just-pulled" text="An applet was pulled from the catalog and is turned off. Its page offers a good version." />
      )}
      <Group testID="installed-list">
        {installed.map((each) => {
          const entry = state.index?.applets.find((applet) => applet.manifest.id === each.manifest.id);
          const pulled = each.record.disabled?.reason === "pulled";
          const detail = pulled
            ? `Turned off: ${each.record.disabled?.detail ?? "pulled from the catalog"}`
            : [each.manifest.version, each.record.source === "local" ? "installed by hand" : each.manifest.author.name].join(" · ");
          return (
            <View
              key={each.manifest.id}
              testID={`installed:${each.manifest.id}`}
              style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingHorizontal: 12, paddingVertical: 8 }}
            >
              <View
                onPress={entry ? () => actions.openApplet(each.manifest.id) : undefined}
                style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 12 }}
              >
                <AppletIcon url={entry?.icon} name={each.manifest.name} size={36} />
                <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: 1 }}>
                  <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>
                    {each.manifest.name}
                  </Text>
                  <Text numberOfLines={1} style={{ fontSize: 11, color: pulled ? colors.critical : colors.textMuted }}>
                    {detail}
                  </Text>
                </View>
              </View>
              <Button
                label="Remove"
                testID={`remove:${each.manifest.id}`}
                onPress={() => actions.remove(each)}
                disabled={state.busy[each.manifest.id] !== undefined}
              />
            </View>
          );
        })}
      </Group>
    </ScrollView>
  );
}

export function UpdatesPage() {
  const { store } = useServices();
  const actions = useActions();
  const state = useStoreState();
  const updates = store.updates();
  if (state.index === null && !state.loading) return <Problem />;
  if (updates.length === 0) {
    return (
      <EmptyState
        testID="no-updates"
        glyph={UPDATES}
        title="Up to date"
        message="Your applets are the newest versions. The Applet Store looks again each time it opens."
      />
    );
  }
  return (
    <ScrollView testID="updates" style={{ flex: 1, flexDirection: "column", gap: 12, padding: 22 }}>
      <View style={{ flexShrink: 0, flexDirection: "row", justifyContent: "flex-end" }}>
        <Button
          label="Update All"
          testID="update-all"
          primary
          onPress={() => {
            for (const entry of updates) actions.get(entry);
          }}
        />
      </View>
      <RowGroup entries={updates} testID="update-list" />
    </ScrollView>
  );
}
