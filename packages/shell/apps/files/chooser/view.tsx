/**
 * The file chooser (PA-12): Files in a frame with Open or Save at its foot.
 * Files' sidebar (favorites, drives; Recents when opening), Files' listing
 * with its icons, keys and selection (browser.tsx), and in the one toolbar
 * row Back and Up, the folder pop-up (the folder, and every folder it is
 * in), the view switch, New Folder when saving, and the search field. A
 * save puts the name field over the listing. A click selects; a
 * double-click or Return opens (a folder: goes in); Esc cancels; ⇧❖. shows
 * hidden files; Space peeks. A file a save would replace is a question,
 * with Replace in ume. `ChooserView` is a whole window (the portal's sheet,
 * `dashi-dialog --file-selection`); `ChooserSheet` sits over an app's own
 * window (Text Editor's Open and Save As).
 */

import { existsSync } from "node:fs";
import { AppWindow, useColors, useSurface, useTitleBarInset } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useEffect, useMemo } from "react";
import type { ChooserRequest } from "../../../src/shared/files/chooser/request.ts";
import type { Env } from "../env.ts";
import { Files } from "../lib/context.ts";
import { Listing } from "../lib/views/browser.tsx";
import { useChooserParts } from "./lib/parts.tsx";
import { openChooser } from "./start.ts";
import type { ChooserViewProps } from "./types.ts";

/** The chooser as a whole window: the portal's (hung from the asking app) and `dashi-dialog`'s. */
export function ChooserView(props: ChooserViewProps & { title: string }) {
  const parts = useChooserParts(props);
  return (
    <Files.Provider value={parts.context}>
      <AppWindow title={props.title} leading={parts.leading} toolbar={parts.tools} sidebar={parts.sidebar} sidebarWidth={180} overlay={parts.overlay}>
        {parts.keys}
        <View style={{ flex: 1, flexDirection: "column", gap: 10, padding: 14, paddingTop: 10, minHeight: 0 }}>
          {parts.nameRow}
          {parts.problem}
          <Listing />
          {parts.footer}
        </View>
      </AppWindow>
    </Files.Provider>
  );
}

/**
 * The chooser as a sheet: at most this big, and always 16 inside its window at each side and the
 * foot. It hangs below the window's title bar (8 under its buttons, as `@dashi/ui`'s `Sheet` does),
 * so the window's own buttons never sit on the chooser's Back and Up.
 */
export const CHOOSER_SHEET = { width: 760, height: 470, inset: 16, below: 8 } as const;

/**
 * An app's own Open or Save As: the chooser for `request` over the app's
 * window, listing from when it appears until it goes. `answer` gets the
 * paths chosen, or null for Cancel.
 */
export function AppChooser({ request, answer, env }: { request: ChooserRequest; answer: (paths: string[] | null) => void; env?: Env }) {
  const model = useMemo(() => openChooser(request, env), [request, env]);
  useEffect(() => () => model.stop(), [model]);
  return (
    <ChooserSheet
      model={model}
      title={request.title}
      exists={existsSync}
      answer={(chosen) => answer(chosen && chosen.paths.length > 0 ? chosen.paths : null)}
    />
  );
}

/** The chooser over an app's own window (pass it as `AppWindow`'s overlay): Text Editor's Open and Save As. */
export function ChooserSheet(props: ChooserViewProps & { title: string }) {
  const colors = useColors();
  const surface = useSurface();
  const inset = useTitleBarInset();
  const parts = useChooserParts(props);
  return (
    <Files.Provider value={parts.context}>
      <View
        occlude
        testID="chooser:scrim"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          right: 0,
          bottom: 0,
          flexDirection: "column",
          alignItems: "center",
          paddingTop: Math.max(inset.top, 0) + CHOOSER_SHEET.below,
          paddingHorizontal: CHOOSER_SHEET.inset,
          paddingBottom: CHOOSER_SHEET.inset,
          backgroundColor: "#00000026",
        }}
      >
        <View
          testID="chooser"
          occlude
          focusTrap
          accessibilityRole="dialog"
          accessibilityLabel={props.title}
          style={{
            // As wide as it may be, never wider than the window leaves it; shorter when the window is.
            width: "100%",
            maxWidth: CHOOSER_SHEET.width,
            height: CHOOSER_SHEET.height,
            flexShrink: 1,
            minHeight: 0,
            flexDirection: "column",
            borderRadius: 12,
            backgroundColor: surface.window,
            borderWidth: 1,
            borderColor: colors.separator,
            shadow: "xl",
            overflow: "hidden",
            focusRingColor: colors.focusRing,
          }}
        >
          {parts.keys}
          <View style={{ height: 44, flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10 }}>
            {parts.leading}
            <View style={{ flex: 1, minWidth: 0, paddingHorizontal: 6 }}>
              <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>
                {props.title}
              </Text>
            </View>
            {parts.tools}
          </View>
          <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
            <View style={{ width: 170, flexShrink: 0, flexDirection: "column", paddingHorizontal: 8, backgroundColor: surface.sidebar }}>{parts.sidebar}</View>
            <View style={{ flex: 1, flexDirection: "column", gap: 10, padding: 12, minWidth: 0, minHeight: 0 }}>
              {parts.nameRow}
              {parts.problem}
              <Listing />
              {parts.footer}
            </View>
          </View>
          {parts.overlay}
        </View>
      </View>
    </Files.Provider>
  );
}
