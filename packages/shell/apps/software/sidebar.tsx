/**
 * Software's sidebar: Discover, Installed, Updates (one badge for the
 * system, the apps and the applets), Menu bar applets (only while there is
 * a catalog to show: a store with no shelves isn't shown), and Flathub's
 * categories.
 */

import { SidebarItem, SidebarSection, TINTS } from "@dashi/ui";
import { CATEGORIES } from "../../src/software/flathub.ts";
import { APPLETS, CATEGORY_GLYPHS, CATEGORY_TINTS, DISCOVER, INSTALLED, UPDATES } from "./glyphs.ts";
import type { Nav, Page } from "./nav.ts";

const inSidebar = (nav: Nav, page: Page): boolean => JSON.stringify(nav.page) === JSON.stringify(page);

export function SoftwareSidebar({ nav, updates, appletsReady, go }: { nav: Nav; updates: number; appletsReady: boolean; go: (page: Page) => void }) {
  return (
    <>
      <SidebarSection>
        <SidebarItem
          testID="nav:discover"
          label="Discover"
          glyph={DISCOVER}
          selected={inSidebar(nav, { kind: "discover" })}
          onPress={() => go({ kind: "discover" })}
        />
        <SidebarItem
          testID="nav:installed"
          label="Installed"
          glyph={INSTALLED}
          selected={inSidebar(nav, { kind: "installed" })}
          onPress={() => go({ kind: "installed" })}
        />
        <SidebarItem
          testID="nav:updates"
          label="Updates"
          glyph={UPDATES}
          badge={updates > 0 ? String(updates) : undefined}
          selected={inSidebar(nav, { kind: "updates" })}
          onPress={() => go({ kind: "updates" })}
        />
        {appletsReady && (
          <SidebarItem
            testID="nav:applets"
            label="Menu bar applets"
            glyph={APPLETS}
            selected={inSidebar(nav, { kind: "applets" })}
            onPress={() => go({ kind: "applets" })}
          />
        )}
      </SidebarSection>
      <SidebarSection title="Categories">
        {CATEGORIES.map((category) => (
          <SidebarItem
            key={category.id}
            testID={`nav:category:${category.id}`}
            label={category.label}
            tile={{ glyph: CATEGORY_GLYPHS[category.id] ?? DISCOVER, tint: CATEGORY_TINTS[category.id] ?? TINTS.goma }}
            selected={inSidebar(nav, { kind: "category", id: category.id })}
            onPress={() => go({ kind: "category", id: category.id })}
          />
        ))}
      </SidebarSection>
    </>
  );
}
