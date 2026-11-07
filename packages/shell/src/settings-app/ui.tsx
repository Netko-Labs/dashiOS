/**
 * What the panes are built from, in the way System Settings on the Mac
 * looks: a page with a title, then grouped cards of rows, choices as pills,
 * sliders, and buttons. The cards, rows, pills, sliders, and buttons are
 * @dashi/ui's, which the first-party apps use too; the page is Settings'
 * own. Everything paints with the shell's live palette, so Dark Mode
 * repaints Settings too.
 */

import { Group as Card, useColors } from "@dashi/ui";
import { type Bounds, ScrollView, Text, View } from "@mirinjs/metal";
import { createContext, type ReactNode, useContext, useMemo, useRef } from "react";
import { PAGE_GAP, PageContext, SpotLit } from "./spot.tsx";

/**
 * A row whose label is data, not a setting: a login, a card, a device, a
 * notice with its action. Settings' own rows are `Setting`s, from the
 * registry; a pane draws no plain row with a fixed label.
 */
/** A field of a form (adding a login, a card, a token); the form itself is a registered row, wrapped in its `Spot`. */
export { Button, Caption, type Choice, Choices, Note, Row as Item, Row as FormRow, Slider, type Surface, Tile, useSurface } from "@dashi/ui";
export { Setting } from "./setting.tsx";
export { Spot } from "./spot.tsx";

/** A card of rows (@dashi/ui's), lit while a link to its section (a `cards` Spot) shows it. */
export function Group({ children, testID }: { children: ReactNode; testID?: string }) {
  const colors = useColors();
  const lit = useContext(SpotLit);
  return (
    <Card {...(testID !== undefined ? { testID } : {})} {...(lit ? { wash: colors.switcherSelection } : {})}>
      {children}
    </Card>
  );
}

/** The settings file couldn't be written just now (view.tsx provides it; the page says so at its top). */
export const SaveError = createContext(false);

/** A page's content is at most this wide, centered in a wider window (LA-2). */
export const PAGE_MAX_WIDTH = 680;

/**
 * A pane: its content scrolling under the header strip when it is taller than the window (its
 * title is in the strip: view.tsx), at most `PAGE_MAX_WIDTH` wide. When the last change couldn't
 * be saved, the page says so first, in plain words (PA-6), instead of a bar of its own.
 */
export function Page({ title, children }: { title: string; children: ReactNode }) {
  const colors = useColors();
  const unsaved = useContext(SaveError);
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
        style={{ flex: 1, flexDirection: "column", padding: 24, paddingTop: 8 }}
      >
        <View style={{ width: "100%", maxWidth: PAGE_MAX_WIDTH, alignSelf: "center", flexDirection: "column", gap: PAGE_GAP }}>
          {unsaved && (
            <View testID="settings-error" style={{ paddingHorizontal: 4 }}>
              <Text style={{ fontSize: 12, color: colors.critical }}>
                Your last change couldn't be saved. Check that your home folder has free space, then try again.
              </Text>
            </View>
          )}
          {children}
        </View>
      </ScrollView>
    </PageContext.Provider>
  );
}
