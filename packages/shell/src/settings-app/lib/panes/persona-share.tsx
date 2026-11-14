/**
 * Sharing a character (persona.tsx; docs/decisions.md D61, D74): "Add a File…" reads a file
 * somebody sent, and before anything is copied a sheet shows all of what the assistant would be
 * told; "Export…" writes this Dashi, with its name and look as they are now, as one small file.
 * A file is text and ids only, and only the person's own press adds or writes one.
 */

import { writeFileSync } from "node:fs";
import type { Confirm } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { useState, useSyncExternalStore } from "react";
import { addCharacterFile, type Character, type PersonaSource, readCharacterFile, shareFileText } from "../../../persona/index.ts";
import { markSvg } from "../../../shared/pill/index.ts";
import { chooseFile, chooseSaveFile } from "../../../shared/portal/index.ts";
import type { SettingsStore } from "../../store.ts";
import { ONLY_YOU, type PersonOnly } from "../person-only.ts";
import { Setting } from "../setting.tsx";
import { MiniButton } from "./parts.tsx";

const JSON_FILES = { name: "Characters", types: ["application/json"] } as const;

/** The desktop's own file dialogs; a test, or a session with no portal, gives its own. */
export interface ShareDialogs {
  /** The file to add; null when the person cancelled. */
  choose(): Promise<string | null>;
  /** Where to write `name`; null when the person cancelled. */
  save(name: string): Promise<string | null>;
}

const PORTAL: ShareDialogs = {
  choose: () => chooseFile({ title: "Add a Character", filter: JSON_FILES, accept: (path) => path.endsWith(".json") }),
  save: (name) => chooseSaveFile({ title: "Export This Dashi", name, filter: JSON_FILES }),
};

/** All of what a file would tell the assistant, for the sheet: who it is, then its text in both languages. */
export function addSheetWords(character: Character): string {
  const { en, es } = character.prompt;
  const told = en === es ? en : `${en}\n\n${es}`;
  return `${character.about.en}\n\nThis is what your agent will be told:\n\n${told}\n\nIt changes how Dashi sounds and looks, never what it may do.`;
}

export interface ShareProps {
  settings: SettingsStore;
  persona: { source: PersonaSource; openFile(path: string): void; dialogs?: ShareDialogs };
  guard: PersonOnly;
  /** Opens the pane's sheet (it hangs from the window, so the pane draws it). */
  ask: Confirm["ask"];
  /** "Make a File", which sits in the same row. */
  onMake(): void;
  /** What the row says instead of its own line (the file could not be made). */
  problem?: string | undefined;
}

export function Share({ settings, persona, guard, ask, onMake, problem }: ShareProps) {
  const view = useSyncExternalStore(persona.source.subscribe, persona.source.view);
  const [said, setSaid] = useState<string | null>(null);
  const dialogs = persona.dialogs ?? PORTAL;
  const add = (): void =>
    guard.mine("persona/own", () => {
      setSaid(null);
      void dialogs
        .choose()
        .then((path) => {
          if (path === null) return;
          const check = readCharacterFile(path);
          if (!check.ok) return setSaid(`This file is not a character: ${check.why}.`);
          const { character } = check;
          // Somebody else's words: read in full before anything is copied.
          ask({
            testID: "persona-add",
            title: `Add “${character.name}”?`,
            message: addSheetWords(character),
            confirmLabel: "Add",
            glyph: markSvg(character.mark),
            onConfirm: () => {
              const added = addCharacterFile(character, persona.source.dir);
              if (!added.ok) return setSaid(`“${character.name}” was not added: ${added.why}.`);
              persona.source.refresh();
              settings.patch("persona", { character: character.id });
            },
          });
        })
        .catch(() => setSaid("There is no file chooser here. Put the file in the folder instead."));
    });
  const exportIt = (): void =>
    guard.mine("persona/share", () => {
      setSaid(null);
      const file = shareFileText(view);
      void dialogs
        .save(file.name)
        .then((path) => {
          if (path === null) return;
          writeFileSync(path, file.text, { mode: 0o644 });
          setSaid(`Exported “${view.name}”.`);
        })
        .catch(() => setSaid("The file could not be written."));
    });
  const quiet = (row: string, line?: string | null): { detail?: string } => (guard.refused === row ? { detail: ONLY_YOU } : line ? { detail: line } : {});
  return (
    <>
      <Setting id="persona/own" testID="persona-own-row" {...quiet("persona/own", problem ?? (said?.startsWith("Exported") ? null : said))} stack>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <MiniButton testID="persona-open-folder" label="Show Folder" onPress={() => persona.openFile(persona.source.dir)} />
          <MiniButton testID="persona-make-file" label="Make a File" onPress={onMake} />
          <MiniButton testID="persona-add-file" label="Add a File…" onPress={add} />
        </View>
      </Setting>
      <Setting id="persona/share" testID="persona-share-row" {...quiet("persona/share", said?.startsWith("Exported") ? said : null)}>
        <MiniButton testID="persona-export" label="Export…" onPress={exportIt} />
      </Setting>
    </>
  );
}
