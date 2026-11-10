/**
 * What a file chooser is asked for and what it answers, the same whoever
 * asks: the portal's FileChooser calls (apps/portal/file-chooser/options.ts
 * reads them off the bus), `dashi-dialog --file-selection`, and Dashi's own
 * apps' Open and Save As (Text Editor).
 */

export type PatternKind = "glob" | "mime";

export interface Filter {
  name: string;
  patterns: Array<{ kind: PatternKind; pattern: string }>;
}

export interface Choice {
  id: string;
  label: string;
  /** Empty: a check box, whose value is "true" or "false". */
  options: Array<{ id: string; label: string }>;
  initial: string;
}

export type ChooserMode = "open" | "save" | "save-files";

export interface ChooserRequest {
  mode: ChooserMode;
  appId: string;
  parent: string;
  title: string;
  acceptLabel: string | null;
  multiple: boolean;
  /** Choose folders, not files. */
  directory: boolean;
  filters: Filter[];
  /** The filter to start with: one of `filters`, or one the app gave alone. */
  currentFilter: Filter | null;
  choices: Choice[];
  currentFolder: string | null;
  /** SaveFile: the name to suggest. */
  currentName: string | null;
  /** SaveFile: the file being saved again (its folder and name). */
  currentFile: string | null;
  /** SaveFiles: the names of the files that will be written into the folder chosen. */
  files: string[];
}

export interface ChooserAnswer {
  paths: string[];
  choices: Array<[string, string]>;
  filter: Filter | null;
}

/** A request with everything not given left empty: an app's own Open or Save As. */
export function chooserRequest(mode: ChooserMode, given: Partial<Omit<ChooserRequest, "mode">> = {}): ChooserRequest {
  return {
    mode,
    appId: "",
    parent: "",
    title: mode === "open" ? "Open" : "Save",
    acceptLabel: null,
    multiple: false,
    directory: false,
    filters: [],
    currentFilter: given.filters?.[0] ?? null,
    choices: [],
    currentFolder: null,
    currentName: null,
    currentFile: null,
    files: [],
    ...given,
  };
}
