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
import {
  AlertSheet,
  AppWindow,
  Button,
  glyphs,
  Note,
  PopUpButton,
  SearchField,
  Switch,
  TextField,
  ToolbarButton,
  useColors,
  useSurface,
  useTitleBarInset,
} from "@dashi/ui";
import { Text, View, type WindowKeyInfo } from "@mirinjs/metal";
import { type ReactNode, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { BrowserKeys, Listing } from "../browser.tsx";
import { Files, quietActions } from "../context.ts";
import type { Env } from "../env.ts";
import { BACK, FOLDER_PLUS, sidebarGlyph } from "../glyphs.ts";
import type { BrowserKey } from "../keys.ts";
import { intentOf } from "../omnibox.ts";
import { Peek } from "../peek.tsx";
import { recordRecents } from "../recent-file.ts";
import { Sidebar } from "../sidebar.tsx";
import { ViewSwitch } from "../toolbar.tsx";
import { filterExtension, withExtension } from "./filters.ts";
import { type ChooserModel, folderName, folderTrail, useChooser } from "./model.ts";
import type { ChooserAnswer, ChooserRequest } from "./request.ts";
import { openChooser } from "./start.ts";

const UP = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M8 13V3.6M3.8 7.6L8 3.4l4.2 4.2" fill="none" stroke="#000" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export interface ChooserViewProps {
  model: ChooserModel;
  exists: (path: string) => boolean;
  answer: (value: ChooserAnswer | null) => void;
}

/** Whether a key is ⇧❖. (Show Hidden Files), as it reaches a window with no menus: Ctrl+Shift with the period. */
export const isHiddenChord = (info: WindowKeyInfo): boolean =>
  (info.ctrl || info.meta) && info.shift && (info.key === "." || info.key === "period" || info.key === ">");

/** Everything both frames draw, worked out once. */
function useChooserParts({ model, exists, answer }: ChooserViewProps) {
  const colors = useColors();
  const state = useChooser(model);
  const files = useSyncExternalStore(model.store.subscribe, model.store.getSnapshot);
  const { store, request } = model;
  const [focus, setFocus] = useState(0);
  const [peek, setPeek] = useState(false);
  // A path typed in the search (`~/…`, `/…`), as Files' path field takes one: Return goes there.
  const [typedPath, setTypedPath] = useState<string | null>(null);
  const refocus = useCallback(() => setFocus((n) => n + 1), []);
  const actions = useMemo(() => quietActions(refocus), [refocus]);
  const saving = request.mode === "save";
  const folder = model.folder();

  const go = (): void => {
    const outcome = model.decide(exists);
    if (outcome.kind !== "done") return;
    // Files picked or saved are used: Recents lists them next time (a folder chosen isn't a file used).
    if (!(request.mode === "open" && request.directory)) void recordRecents(outcome.paths, request.appId || request.title);
    answer(model.answer(outcome.paths));
  };
  // A double-click or Return on a file is Open.
  useEffect(() => {
    model.onAccept = go;
    return () => {
      model.onAccept = null;
    };
  });

  const onKey = (key: BrowserKey): void => {
    switch (key.kind) {
      case "open":
        return go();
      case "clear":
        return answer(null);
      case "back":
        return store.goBack();
      case "enclosing":
        return store.goUp();
      case "peek":
        if (store.selectedItems().length > 0) setPeek(true);
        return;
      case "text":
        if (key.text.trim() !== "") store.typeAhead(key.text);
        return;
      default:
        return;
    }
  };
  const fieldKeys = (key: "Escape" | "ArrowUp" | "ArrowDown"): void => {
    if (key === "Escape") {
      if (files.query !== "") store.setQuery("");
      else answer(null);
      return;
    }
    store.move(key === "ArrowUp" ? "up" : "down");
    refocus();
  };
  const searchKeys = (key: "Escape" | "ArrowUp" | "ArrowDown"): void => {
    if (key === "Escape" && typedPath !== null) return setTypedPath(null);
    fieldKeys(key);
  };
  const search = (text: string): void => {
    const isPath = intentOf(text) === "path";
    setTypedPath(isPath ? text : null);
    // A path isn't a name to look for: the folder stays listed while it is typed.
    store.setQuery(isPath ? "" : text);
  };
  const submitSearch = (text: string): void => {
    if (intentOf(text) !== "path") return go();
    const problem = store.goToPath(text);
    model.say(problem);
    if (problem !== null) return;
    setTypedPath(null);
    refocus();
  };
  const acceptLabel = request.acceptLabel ?? (request.mode === "open" ? (request.directory ? "Choose" : "Open") : "Save");
  const filterOptions = request.filters.map((filter, index) => ({ value: index, label: filter.name }));
  const filterIndex = state.filter ? Math.max(0, request.filters.indexOf(state.filter)) : 0;
  const busy = state.replace !== null || peek || files.renaming !== null;

  // ⇧❖. shows hidden files: the chooser has no menu bar to take it, so it arrives as a key.
  const hiddenChord = (info: WindowKeyInfo): boolean => {
    if (!isHiddenChord(info)) return false;
    store.toggleHidden();
    return true;
  };
  // The search field (or a save's name) has the keyboard at first; the listing takes it once it is clicked or ↓ leaves the field.
  const keys = !busy && focus > 0 && <BrowserKeys focusKey={focus} onKey={onKey} onChord={hiddenChord} />;
  const leading = (
    <>
      <ToolbarButton testID="chooser:back" glyph={BACK} disabled={!files.canBack} onPress={() => store.goBack()} />
      <ToolbarButton testID="chooser:up" glyph={UP} disabled={files.location.kind === "folder" && files.location.path === "/"} onPress={() => store.goUp()} />
    </>
  );
  const tools = (
    <>
      {folder !== null && (
        // The folder showing; its menu is the folder and each folder it is in, the one showing ticked.
        <PopUpButton
          testID="chooser:folder"
          glyph={sidebarGlyph("folder")}
          options={folderTrail(folder, model.home).map((each) => ({ value: each.path, label: each.name }))}
          value={folder}
          onChange={(path) => store.go({ kind: "folder", path })}
        />
      )}
      <ViewSwitch />
      {model.canMakeFolder() && <ToolbarButton testID="chooser:new-folder" glyph={FOLDER_PLUS} onPress={() => void model.newFolder()} />}
      <SearchField
        testID="chooser:search"
        autoFocus={!saving}
        placeholder="Search"
        width={200}
        value={typedPath ?? files.query}
        onChangeText={search}
        onKeyPress={searchKeys}
        onSubmit={submitSearch}
      />
    </>
  );
  const sidebar = <Sidebar recents={request.mode === "open" && !request.directory} />;
  const nameRow = saving && (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
      <View style={{ flexShrink: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, color: colors.text }}>
          Save as
        </Text>
      </View>
      {/* The field takes the row's room, never less than a name's worth (it collapsed to a sliver in a row of fixed parts). */}
      <View testID="chooser:name-box" style={{ flex: 1, minWidth: 160, flexDirection: "row" }}>
        <TextField testID="chooser:name" value={state.name} autoFocus onChangeText={(text) => model.setName(text)} onSubmit={go} onKeyPress={fieldKeys} />
      </View>
      <Text numberOfLines={1} style={{ fontSize: 12, color: colors.textMuted }}>{`in ${folderName(folder ?? model.store.env.home, model.home)}`}</Text>
    </View>
  );
  const problem = state.problem && <Note testID="chooser:problem">{state.problem}</Note>;
  const footer = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flexShrink: 0, minWidth: 0 }}>
      {filterOptions.length > 1 && (
        // File types are a list of unknown length: a pop-up button (UI-2).
        <PopUpButton
          testID="chooser:filter"
          options={filterOptions}
          value={filterIndex}
          onChange={(index) => {
            const filter = request.filters[index] ?? null;
            model.setFilter(filter);
            if (saving && state.name !== "") model.setName(withExtension(state.name, filterExtension(filter)));
          }}
        />
      )}
      {request.choices.map((choice) =>
        choice.options.length === 0 ? (
          <View key={choice.id} style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <Switch
              testID={`chooser:choice:${choice.id}`}
              on={state.choices[choice.id] === "true"}
              onChange={(on) => model.setChoice(choice.id, on ? "true" : "false")}
            />
            <Text style={{ fontSize: 12, color: colors.text }}>{choice.label}</Text>
          </View>
        ) : (
          <PopUpButton
            key={choice.id}
            testID={`chooser:choice:${choice.id}`}
            options={choice.options.map((option) => ({ value: option.id, label: option.label }))}
            value={state.choices[choice.id] ?? choice.initial}
            onChange={(value) => model.setChoice(choice.id, value)}
          />
        ),
      )}
      <View style={{ flex: 1 }} />
      <Button label="Cancel" testID="chooser:cancel" onPress={() => answer(null)} />
      <Button label={acceptLabel} testID="chooser:accept" primary onPress={go} />
    </View>
  );
  const overlay: ReactNode = state.replace ? (
    // Replacing is a question, with the safe answer the default and Replace in ume (UI-6).
    <AlertSheet
      testID="chooser:replace"
      glyph={glyphs.WARNING}
      tone="danger"
      question={`“${state.replace.split("/").pop()}” already exists in ${folderName(state.replace.slice(0, state.replace.lastIndexOf("/")) || "/", model.home)}.`}
      message="Replacing it overwrites what’s in it."
      buttons={[
        { label: "Cancel", testID: "chooser:replace:cancel", onPress: () => model.dismiss(), cancel: true, isDefault: true },
        {
          label: "Replace",
          testID: "chooser:replace:ok",
          kind: "danger",
          onPress: () => {
            model.confirmReplace();
            go();
          },
        },
      ]}
    />
  ) : peek ? (
    <Peek
      onClose={() => {
        setPeek(false);
        refocus();
      }}
    />
  ) : undefined;
  const context = { store, ops: null, actions };
  return { context, keys, leading, tools, sidebar, nameRow, problem, footer, overlay };
}

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
