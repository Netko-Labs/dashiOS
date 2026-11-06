/**
 * What the panes are built from, in the way System Settings on the Mac
 * looks: a page with a title, then grouped cards of rows, choices as pills,
 * sliders, and buttons. The cards, rows, pills, sliders, and buttons are
 * @dashi/ui's, which the first-party apps use too; the page is Settings'
 * own. Everything paints with the shell's live palette, so Dark Mode
 * repaints Settings too.
 */

import { useColors } from "@dashi/ui";
import { type Bounds, ScrollView, Text, useWindowChrome } from "@mirinjs/metal";
import { type ReactNode, useMemo, useRef } from "react";
import { PageContext } from "./spot.tsx";

/**
 * A row whose label is data, not a setting: a login, a card, a device, a
 * notice with its action. Settings' own rows are `Setting`s, from the
 * registry; a pane draws no plain row with a fixed label.
 */
/** A field of a form (adding a login, a card, a token); the form itself is a registered row, wrapped in its `Spot`. */
export { Button, Caption, type Choice, Choices, Group, Note, Row as Item, Row as FormRow, Slider, type Surface, Tile, useSurface } from "@dashi/ui";
export { Setting } from "./setting.tsx";
export { Spot } from "./spot.tsx";

/**
 * A pane: its title, then its content scrolling under it when it is taller than the window. With
 * the unified title bar the title lives in the window's toolbar (view.tsx), so the page starts
 * with its content.
 */
export function Page({ title, children }: { title: string; children: ReactNode }) {
  const colors = useColors();
  const unified = useWindowChrome().titleBar === "unified";
  const testID = `pane:${title}`;
  // Where the page is, so a row asked for by its address can be scrolled to (spot.tsx).
  const bounds = useRef<Bounds | null>(null);
  const page = useMemo(() => ({ testID, bounds }), [testID]);
  return (
    <PageContext.Provider value={page}>
      <ScrollView
        testID={testID}
        onLayout={(laid) => {
          bounds.current = laid;
        }}
        style={{ flex: 1, flexDirection: "column", gap: 16, padding: 24, paddingTop: unified ? 8 : 20 }}
      >
        {!unified && <Text style={{ fontSize: 20, fontWeight: "bold", color: colors.text }}>{title}</Text>}
        {children}
      </ScrollView>
    </PageContext.Provider>
  );
}
