/**
 * The chooser's rows around the listing: Back and Up, the folder pop-up and
 * the search in the toolbar, the name field of a save, and the foot with the
 * file types, the app's choices, Cancel and Open or Save; and the question
 * a save that would replace a file asks.
 */

import { AlertSheet, Button, glyphs, Note, PopUpButton, SearchField, Switch, TextField, ToolbarButton, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { filterExtension, withExtension } from "../../../../src/shared/files/index.ts";
import { BACK, FOLDER_PLUS, sidebarGlyph } from "../../lib/glyphs.ts";
import { ViewSwitch } from "../../lib/views/toolbar.tsx";
import { type ChooserModel, folderName, folderTrail } from "../model.ts";
import type { ChooserInput } from "./use-chooser-input.ts";

const UP = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M8 13V3.6M3.8 7.6L8 3.4l4.2 4.2" fill="none" stroke="#000" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export function ChooserLeading({ model, input }: { model: ChooserModel; input: ChooserInput }) {
  const { store } = model;
  const { files } = input;
  return (
    <>
      <ToolbarButton testID="chooser:back" glyph={BACK} disabled={!files.canBack} onPress={() => store.goBack()} />
      <ToolbarButton testID="chooser:up" glyph={UP} disabled={files.location.kind === "folder" && files.location.path === "/"} onPress={() => store.goUp()} />
    </>
  );
}

export function ChooserTools({ model, input }: { model: ChooserModel; input: ChooserInput }) {
  const { store } = model;
  const folder = model.folder();
  return (
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
        autoFocus={model.request.mode !== "save"}
        placeholder="Search"
        // It shares the header's room, so a small window's sheet keeps it inside, clear of the edge.
        width={200}
        minWidth={100}
        value={input.typedPath ?? input.files.query}
        onChangeText={input.search}
        onKeyPress={input.searchKeys}
        onSubmit={input.submitSearch}
      />
    </>
  );
}

/** A save's name field, over the listing. */
export function NameRow({ model, input }: { model: ChooserModel; input: ChooserInput }) {
  const colors = useColors();
  const folder = model.folder();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
      <View style={{ flexShrink: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, color: colors.text }}>
          Save as
        </Text>
      </View>
      {/* The field takes the row's room, never less than a name's worth (it collapsed to a sliver in a row of fixed parts). */}
      <View testID="chooser:name-box" style={{ flex: 1, minWidth: 160, flexDirection: "row" }}>
        <TextField
          testID="chooser:name"
          value={input.state.name}
          autoFocus
          onChangeText={(text) => model.setName(text)}
          onSubmit={input.go}
          onKeyPress={input.fieldKeys}
        />
      </View>
      <Text numberOfLines={1} style={{ fontSize: 12, color: colors.textMuted }}>{`in ${folderName(folder ?? model.store.env.home, model.home)}`}</Text>
    </View>
  );
}

export function ProblemNote({ problem }: { problem: string }) {
  return <Note testID="chooser:problem">{problem}</Note>;
}

export function ChooserFooter({ model, input, cancel }: { model: ChooserModel; input: ChooserInput; cancel: () => void }) {
  const colors = useColors();
  const { request } = model;
  const { state } = input;
  const saving = request.mode === "save";
  const acceptLabel = request.acceptLabel ?? (request.mode === "open" ? (request.directory ? "Choose" : "Open") : "Save");
  const filterOptions = request.filters.map((filter, index) => ({ value: index, label: filter.name }));
  const filterIndex = state.filter ? Math.max(0, request.filters.indexOf(state.filter)) : 0;
  return (
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
      <Button label="Cancel" testID="chooser:cancel" onPress={cancel} />
      <Button label={acceptLabel} testID="chooser:accept" primary onPress={input.go} />
    </View>
  );
}

/** Replacing is a question, with the safe answer the default and Replace in ume (UI-6). */
export function ReplaceQuestion({ model, input, path }: { model: ChooserModel; input: ChooserInput; path: string }) {
  return (
    <AlertSheet
      testID="chooser:replace"
      glyph={glyphs.WARNING}
      tone="danger"
      question={`“${path.split("/").pop()}” already exists in ${folderName(path.slice(0, path.lastIndexOf("/")) || "/", model.home)}.`}
      message="Replacing it overwrites what’s in it."
      buttons={[
        { label: "Cancel", testID: "chooser:replace:cancel", onPress: () => model.dismiss(), cancel: true, isDefault: true },
        {
          label: "Replace",
          testID: "chooser:replace:ok",
          kind: "danger",
          onPress: () => {
            model.confirmReplace();
            input.go();
          },
        },
      ]}
    />
  );
}
