/**
 * The file chooser as a sheet: Places on the left (Recents first, then the
 * folders), and in the one toolbar row Back and Up before the title, the
 * folder pop-up (the folder, and every folder it is in) and the search
 * field after it; then the rows, and at the bottom the filter and the app's
 * choices beside Cancel and Open (or Save). Saving puts the name field above
 * the rows. It opens on Recents with the search field focused: usually a
 * keystroke and Return. A click only selects; a real double-click (clicks.ts)
 * or Return opens.
 */

import { Choices, Note, PopUpButton, rowLook, SearchField, SelectionBar, SidebarItem, SidebarSection, TextField, ToolbarButton, useColors } from "@dashi/ui";
import { ScrollView, Svg, Text, View } from "@mirinjs/metal";
import { useEffect, useRef } from "react";
import { CheckBox, type FrameButton, PortalFrame } from "../ui/frame.tsx";
import { BACK, CLOCK, FILE, FOLDER, HOME, UP } from "../ui/glyphs.ts";
import { accept } from "./accept.ts";
import { ClickCounter } from "./clicks.ts";
import { filterExtension, withExtension } from "./filters.ts";
import { type ChooserModel, folderTrail, type Row, useChooser } from "./model.ts";
import type { ChooserAnswer } from "./options.ts";
import type { PlaceLink } from "./sources.ts";

const formatDate = (ms: number): string => {
  if (!ms) return "";
  const date = new Date(ms);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }) });
};

/** A row; `onPress` gets where the button went down, so a double-click can be told from two slow clicks. */
function FileRow({ row, selected, onPress }: { row: Row; selected: boolean; onPress: (x: number, y: number) => void }) {
  const colors = useColors();
  const look = rowLook(colors, selected);
  return (
    <View
      testID={`chooser:row:${row.name}`}
      onPointer={(event) => event.phase === "down" && onPress(event.x, event.y)}
      style={{
        height: 30,
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 8,
        borderRadius: 6,
        backgroundColor: look.ground,
        hoverBackgroundColor: look.hover,
      }}
    >
      {selected && <SelectionBar rowHeight={30} />}
      {/* Kombu marks the selected row only: a glyph is muted at rest (CO-2). */}
      <Svg markup={row.folder ? FOLDER : FILE} size={16} color={look.glyph} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, color: look.ink }}>
          {row.name}
        </Text>
      </View>
      {row.where !== undefined && (
        <View style={{ maxWidth: 200, flexShrink: 1 }}>
          <Text numberOfLines={1} style={{ fontSize: 12, color: look.quiet }}>
            {row.where}
          </Text>
        </View>
      )}
      <View style={{ width: 70, flexShrink: 0 }}>
        <Text style={{ fontSize: 12, color: look.quiet, textAlign: "right" }}>{formatDate(row.mtime)}</Text>
      </View>
    </View>
  );
}

export interface ChooserViewProps {
  model: ChooserModel;
  places: readonly PlaceLink[];
  saveFolder: string;
  exists: (path: string) => boolean;
  answer: (value: ChooserAnswer | null) => void;
}

export function ChooserView({ model, places, saveFolder, exists, answer }: ChooserViewProps) {
  const colors = useColors();
  const state = useChooser(model);
  const { request } = model;
  const rows = model.visible();
  const folder = state.place.kind === "folder" ? state.place.path : null;
  const saving = request.mode === "save";
  // The rows' clicks; a new place starts over, so a click there is never the second of a double-click.
  const clicks = useRef(new ClickCounter());
  // biome-ignore lint/correctness/useExhaustiveDependencies: the place changing is what resets the clicks
  useEffect(() => clicks.current.reset(), [state.place]);

  const go = () => {
    // The model's state as it is now: a double-click picks a row an instant before this runs.
    const now = model.getSnapshot();
    const here = now.place.kind === "folder" ? now.place.path : null;
    const outcome = accept(
      request,
      { folder: here, saveFolder: now.lastFolder ?? saveFolder, selected: model.picked(), name: now.name, replacing: now.replace },
      exists,
    );
    switch (outcome.kind) {
      case "done":
        return answer({ paths: outcome.paths, choices: Object.entries(now.choices), filter: now.filter });
      case "open-folder":
        return model.go({ kind: "folder", path: outcome.path });
      case "replace":
        return model.ask({ replace: outcome.path });
      case "problem":
        return model.ask({ problem: outcome.text });
      case "nothing":
        return;
    }
  };
  const acceptLabel = state.replace ? "Replace" : (request.acceptLabel ?? (request.mode === "open" ? (request.directory ? "Choose" : "Open") : "Save"));
  const buttons: FrameButton[] = [
    { label: "Cancel", testID: "chooser:cancel", onPress: () => answer(null) },
    { label: acceptLabel, testID: "chooser:accept", onPress: go, primary: true },
  ];
  const onKeyPress = (key: "Escape" | "ArrowUp" | "ArrowDown") => (key === "Escape" ? answer(null) : model.step(key === "ArrowUp" ? -1 : 1));
  const filterOptions = request.filters.map((filter, index) => ({ value: index, label: filter.name }));
  const filterIndex = state.filter ? Math.max(0, request.filters.indexOf(state.filter)) : 0;

  /** A press on a row: a first click selects; the second of a real double-click opens it (a folder: goes in). */
  const pressRow = (row: Row, x: number, y: number): void => {
    if (clicks.current.press({ target: row.path, x, y, time: Date.now() })) {
      model.pick(row.path);
      return go();
    }
    model.pick(row.path, request.multiple);
  };
  return (
    <PortalFrame
      title={request.title}
      keys={false}
      onCancel={() => answer(null)}
      leading={
        <>
          <ToolbarButton testID="chooser:back" glyph={BACK} disabled={!model.canGoBack()} onPress={() => model.back()} />
          <ToolbarButton testID="chooser:up" glyph={UP} disabled={!model.canGoUp()} onPress={() => model.up()} />
        </>
      }
      buttons={buttons}
      toolbar={
        <>
          {folder !== null && (
            // The folder showing; its menu is the folder and each folder it is in, the one showing ticked.
            <PopUpButton
              testID="chooser:folder"
              glyph={FOLDER}
              options={folderTrail(folder, model.home).map((each) => ({ value: each.path, label: each.name }))}
              value={folder}
              onChange={(path) => model.go({ kind: "folder", path })}
            />
          )}
          <SearchField
            testID="chooser:search"
            autoFocus={!saving}
            placeholder="Search"
            width={220}
            onChangeText={(text) => model.search(text)}
            value={state.query}
            onKeyPress={onKeyPress}
            onSubmit={go}
          />
        </>
      }
      footer={
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap", minWidth: 0 }}>
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
              <CheckBox
                key={choice.id}
                testID={`chooser:choice:${choice.id}`}
                label={choice.label}
                checked={state.choices[choice.id] === "true"}
                onChange={(on) => model.setChoice(choice.id, on ? "true" : "false")}
              />
            ) : (
              <Choices
                key={choice.id}
                testID={`chooser:choice:${choice.id}`}
                options={choice.options.map((option) => ({ value: option.id, label: option.label }))}
                value={state.choices[choice.id] ?? choice.initial}
                onChange={(value) => model.setChoice(choice.id, value)}
              />
            ),
          )}
        </View>
      }
    >
      <View style={{ flex: 1, flexDirection: "row", gap: 12, minHeight: 0 }}>
        <View style={{ width: 150, flexShrink: 0, flexDirection: "column" }}>
          <SidebarSection title="Places">
            {request.mode === "open" && (
              <SidebarItem
                compact
                testID="chooser:recents"
                label="Recents"
                glyph={CLOCK}
                selected={state.place.kind === "recents"}
                onPress={() => model.go({ kind: "recents" })}
              />
            )}
            {places.map((place) => (
              <SidebarItem
                compact
                key={place.path}
                testID={`chooser:place:${place.label}`}
                label={place.label}
                glyph={place.label === "Home" ? HOME : FOLDER}
                selected={folder === place.path}
                onPress={() => model.go({ kind: "folder", path: place.path })}
              />
            ))}
          </SidebarSection>
        </View>
        <View style={{ flex: 1, flexDirection: "column", gap: 8, minWidth: 0 }}>
          {saving && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={{ fontSize: 13, color: colors.text }}>Save as</Text>
              <TextField
                testID="chooser:name"
                value={state.name}
                autoFocus
                onChangeText={(text) => model.setName(text)}
                onSubmit={go}
                onKeyPress={onKeyPress}
              />
            </View>
          )}
          {state.replace && <Note testID="chooser:replace">{`“${state.replace.split("/").pop()}” already exists. Replace it?`}</Note>}
          {state.problem && <Note testID="chooser:problem">{state.problem}</Note>}
          <ScrollView testID="chooser:rows" style={{ flex: 1, flexDirection: "column", gap: 1, minHeight: 0 }}>
            {rows.map((row) => (
              <FileRow key={row.path} row={row} selected={state.selected.includes(row.path)} onPress={(x, y) => pressRow(row, x, y)} />
            ))}
            {!state.loading && rows.length === 0 && (
              <View style={{ padding: 12 }}>
                <Text style={{ fontSize: 13, color: colors.textMuted }}>
                  {state.error ?? (state.place.kind === "recents" ? "Nothing used lately that this app opens. Search, or pick a folder." : "Nothing here.")}
                </Text>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </PortalFrame>
  );
}
