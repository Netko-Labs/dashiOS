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
import { AppWindow, SHEET_MARGIN, Sheet, SPACE, TYPE, useColors, useSurface, WEIGHT } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useEffect, useMemo } from "react";
import type { ChooserRequest } from "../files/index.ts";
import { Listing } from "./browser.tsx";
import { openChooser } from "./chooser.ts";
import { Files } from "./context.ts";
import type { Env } from "./env.ts";
import { useChooserParts } from "./lib/chooser/parts.tsx";
import type { ChooserViewProps } from "./types.ts";

/** The chooser as a whole window: the portal's (hung from the asking app) and `dashi-dialog`'s. */
export function ChooserView(props: ChooserViewProps & { title: string }) {
  const parts = useChooserParts(props);
  return (
    <Files.Provider value={parts.context}>
      <AppWindow
        title={props.title}
        leading={parts.leading}
        toolbar={parts.tools}
        sidebar={parts.sidebar}
        sidebarWidth={CHOOSER_SHEET.sidebar}
        overlay={parts.overlay}
      >
        {parts.keys}
        <View style={{ flex: 1, flexDirection: "column", gap: SPACE.gap, padding: SPACE.button, paddingTop: SPACE.gap, minHeight: 0 }}>
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
 * The chooser as a sheet: the kit's `Sheet`, at most this big, and always 16 inside its window at
 * each side and the foot. It hangs below the window's title bar (8 under its buttons), so the
 * window's own buttons never sit on the chooser's Back and Up. Its toolbar is a window's (38, the
 * title 13 Bold), and both forms keep one sidebar width.
 */
export const CHOOSER_SHEET = { width: 760, height: 470, inset: SHEET_MARGIN, below: SPACE.m, toolbar: 38, sidebar: 180 } as const;

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

/** The chooser over an app's own window (pass it as `AppWindow`'s overlay): Text Editor's and Preview's Open, Save As and Export. */
export function ChooserSheet(props: ChooserViewProps & { title: string }) {
  const colors = useColors();
  const surface = useSurface();
  const parts = useChooserParts(props);
  const m = CHOOSER_SHEET;
  return (
    <Files.Provider value={parts.context}>
      <Sheet testID="chooser" width={m.width} height={m.height} bare>
        {parts.keys}
        {/* The window's own toolbar row: 38 tall, its title 13 Bold (VS-1). */}
        <View style={{ height: m.toolbar, flexShrink: 0, flexDirection: "row", alignItems: "center", gap: SPACE.s, paddingHorizontal: SPACE.gap }}>
          {parts.leading}
          <View style={{ flex: 1, minWidth: 0, paddingHorizontal: SPACE.s }}>
            <Text numberOfLines={1} style={{ fontSize: TYPE.body.size, fontWeight: WEIGHT.bold, color: colors.text }}>
              {props.title}
            </Text>
          </View>
          {parts.tools}
        </View>
        <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
          <View style={{ width: m.sidebar, flexShrink: 0, flexDirection: "column", paddingHorizontal: SPACE.m, backgroundColor: surface.sidebar }}>
            {parts.sidebar}
          </View>
          <View style={{ flex: 1, flexDirection: "column", gap: SPACE.gap, padding: SPACE.inset, minWidth: 0, minHeight: 0 }}>
            {parts.nameRow}
            {parts.problem}
            <Listing />
            {parts.footer}
          </View>
        </View>
        {parts.overlay}
      </Sheet>
    </Files.Provider>
  );
}
