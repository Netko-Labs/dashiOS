/**
 * The file chooser as a sheet: Places on the left (Recents first, then the
 * folders), the search field in the one toolbar row, the rows, and at the
 * bottom the filter and the app's choices beside Cancel and Open (or Save).
 * Saving puts the name field above the rows. It opens on Recents with the
 * search field focused: usually a keystroke and Return.
 */

import { Choices, Note, SearchField, SidebarItem, SidebarSection, TextField, useColors } from "@dashi/ui";
import { ScrollView, Svg, Text, View } from "@mirinjs/metal";
import { CheckBox, type FrameButton, PortalFrame } from "../ui/frame.tsx";
import { CLOCK, FILE, FOLDER, HOME } from "../ui/glyphs.ts";
import { accept } from "./accept.ts";
import { filterExtension, withExtension } from "./filters.ts";
import { type ChooserModel, type Row, useChooser } from "./model.ts";
import type { ChooserAnswer } from "./options.ts";
import type { PlaceLink } from "./sources.ts";

const formatDate = (ms: number): string => {
  if (!ms) return "";
  const date = new Date(ms);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }) });
};

function FileRow({ row, selected, onPress }: { row: Row; selected: boolean; onPress: () => void }) {
  const colors = useColors();
  const ink = selected ? "#ffffff" : colors.text;
  return (
    <View
      testID={`chooser:row:${row.name}`}
      onPress={onPress}
      style={{
        height: 30,
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 8,
        borderRadius: 6,
        backgroundColor: selected ? colors.selection : "#00000000",
        hoverBackgroundColor: selected ? colors.selection : colors.button,
      }}
    >
      <Svg markup={row.folder ? FOLDER : FILE} size={16} color={selected ? "#ffffff" : colors.selection} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, color: ink }}>
          {row.name}
        </Text>
      </View>
      {row.where !== undefined && (
        <View style={{ maxWidth: 200, flexShrink: 1 }}>
          <Text numberOfLines={1} style={{ fontSize: 12, color: selected ? "#ffffffcc" : colors.textMuted }}>
            {row.where}
          </Text>
        </View>
      )}
      <View style={{ width: 70, flexShrink: 0 }}>
        <Text style={{ fontSize: 12, color: selected ? "#ffffffcc" : colors.textMuted, textAlign: "right" }}>{formatDate(row.mtime)}</Text>
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

  const go = () => {
    const outcome = accept(
      request,
      { folder, saveFolder: state.lastFolder ?? saveFolder, selected: model.picked(), name: state.name, replacing: state.replace },
      exists,
    );
    switch (outcome.kind) {
      case "done":
        return answer({ paths: outcome.paths, choices: Object.entries(state.choices), filter: state.filter });
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

  return (
    <PortalFrame
      title={request.title}
      keys={false}
      onCancel={() => answer(null)}
      buttons={buttons}
      toolbar={
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
      }
      footer={
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap", minWidth: 0 }}>
          {filterOptions.length > 1 && (
            <Choices
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
              <Text style={{ fontSize: 13, color: colors.text }}>Save As:</Text>
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
          {folder && (
            <Text numberOfLines={1} style={{ fontSize: 12, color: colors.textMuted }}>
              {folder}
            </Text>
          )}
          {state.replace && <Note testID="chooser:replace">{`“${state.replace.split("/").pop()}” already exists. Replace it?`}</Note>}
          {state.problem && <Note testID="chooser:problem">{state.problem}</Note>}
          <ScrollView testID="chooser:rows" style={{ flex: 1, flexDirection: "column", gap: 1, minHeight: 0 }}>
            {rows.map((row) => (
              <FileRow
                key={row.path}
                row={row}
                selected={state.selected.includes(row.path)}
                onPress={() => {
                  // A second press on a picked row is Open (a folder: go in).
                  if (state.selected.length === 1 && state.selected[0] === row.path) return go();
                  model.pick(row.path, request.multiple);
                }}
              />
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
