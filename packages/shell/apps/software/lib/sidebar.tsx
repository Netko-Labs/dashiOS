/**
 * The Store's sidebar (store-v2 S1): the shelves (Discover, Apps, Menu bar
 * applets, Widgets, Launcher extensions; Themes waits for the themes
 * release), then Yours: Installed and Updates (one badge for Dashi, the
 * system, the apps and the add-ons). Flathub's categories are chips on the
 * Apps page. The rows scroll in their own column, under the
 * window controls' strip, so a short window still reaches every category.
 */

import { SidebarItem, SidebarSection, SPACE } from "@dashi/ui";
import { ScrollView } from "@mirinjs/metal";
import { APPLETS, APPS, DISCOVER, EXTENSIONS, INSTALLED, UPDATES, WIDGETS } from "./glyphs.ts";
import type { Nav, Page } from "./nav.ts";

/** The sidebar row a page belongs to stays lit on the pages under it (hunt finding 173): an app's page under Apps, a category under Apps. */
function placeOf(nav: Nav): Page["kind"] {
  const kind = nav.page.kind;
  if (kind === "category" || kind === "collection") return "apps";
  if (kind === "app" || kind === "entry" || kind === "search") {
    const from = [...nav.back].reverse().find((page) => ["discover", "apps", "applets", "extensions", "widgets", "installed", "updates"].includes(page.kind));
    return from?.kind ?? "discover";
  }
  if (kind === "applet") return "applets";
  return kind;
}

const inSidebar = (nav: Nav, page: Page): boolean => placeOf(nav) === page.kind;

export function SoftwareSidebar({ nav, updates, go }: { nav: Nav; updates: number; go: (page: Page) => void }) {
  const item = (page: Page, label: string, glyph: string) => (
    <SidebarItem
      testID={`nav:${page.kind}`}
      label={label}
      glyph={glyph}
      tileColumn
      selected={inSidebar(nav, page)}
      {...(page.kind === "updates" && updates > 0 ? { badge: String(updates) } : {})}
      onPress={() => go(page)}
    />
  );
  return (
    // The sidebar's 10 of side padding moves inside the scroll, so a row's focus ring isn't clipped.
    <ScrollView
      testID="sidebar-rows"
      style={{ flex: 1, minHeight: 0, flexDirection: "column", gap: SPACE.xxs, marginLeft: -SPACE.gap, marginRight: -SPACE.gap, paddingHorizontal: SPACE.gap }}
    >
      <SidebarSection>
        {item({ kind: "discover" }, "Discover", DISCOVER)}
        {item({ kind: "apps" }, "Apps", APPS)}
        {item({ kind: "applets" }, "Menu bar applets", APPLETS)}
        {item({ kind: "widgets" }, "Widgets", WIDGETS)}
        {item({ kind: "extensions" }, "Launcher extensions", EXTENSIONS)}
      </SidebarSection>
      <SidebarSection title="Yours">
        {item({ kind: "installed" }, "Installed", INSTALLED)}
        {item({ kind: "updates" }, "Updates", UPDATES)}
      </SidebarSection>
    </ScrollView>
  );
}
