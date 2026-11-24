/**
 * What the chooser does with the keyboard: accept the choice, keys on the
 * listing and in a save's name field, and ⇧❖. for hidden files (the path and
 * the search are Files' omnibox's). Which of the frames draws it does not matter.
 */

import type { WindowKeyInfo } from "@mirinjs/metal";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { ChooserAnswer } from "../../../files/index.ts";
import type { ChooserModel, ChooserState } from "../../chooser-model.ts";
import { useChooser } from "../../chooser-model.ts";
import type { BrowserKey } from "../../keys.ts";
import { recordRecents } from "../recent-file.ts";

/** Whether a key is ⇧❖. (Show Hidden Files), as it reaches a window with no menus: Ctrl+Shift with the period. */
export const isHiddenChord = (info: WindowKeyInfo): boolean =>
  (info.ctrl || info.meta) && info.shift && (info.key === "." || info.key === "period" || info.key === ">");

type FieldKey = "Escape" | "ArrowUp" | "ArrowDown";

export interface ChooserInput {
  state: ChooserState;
  files: ReturnType<ChooserModel["store"]["getSnapshot"]>;
  focus: number;
  refocus: () => void;
  peek: boolean;
  setPeek: (peek: boolean) => void;
  /** The choice is made: answer with it (a file that a save would replace asks first). */
  go: () => void;
  onKey: (key: BrowserKey) => void;
  fieldKeys: (key: FieldKey) => void;
  hiddenChord: (info: WindowKeyInfo) => boolean;
}

/** A key the listing did not take: Open, Cancel, back, up a folder, a peek, or a name typed ahead. */
function browserKey(
  key: BrowserKey,
  { go, answer, store, setPeek }: { go: () => void; answer: (value: null) => void; store: ChooserModel["store"]; setPeek: (on: boolean) => void },
): void {
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
}

export function useChooserInput({
  model,
  exists,
  answer,
}: {
  model: ChooserModel;
  exists: (path: string) => boolean;
  answer: (value: ChooserAnswer | null) => void;
}): ChooserInput {
  const state = useChooser(model);
  const files = useSyncExternalStore(model.store.subscribe, model.store.getSnapshot);
  const { store, request } = model;
  // The listing takes the keyboard from the start, but in a save, where the name field has it.
  const [focus, setFocus] = useState(model.request.mode === "save" ? 0 : 1);
  const [peek, setPeek] = useState(false);
  const refocus = useCallback(() => setFocus((n) => n + 1), []);

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

  const onKey = (key: BrowserKey): void => browserKey(key, { go, answer, store, setPeek });
  const fieldKeys = (key: FieldKey): void => {
    if (key === "Escape") {
      if (files.query !== "") store.setQuery("");
      else answer(null);
      return;
    }
    store.move(key === "ArrowUp" ? "up" : "down");
    refocus();
  };
  // ⇧❖. shows hidden files: the chooser has no menu bar to take it, so it arrives as a key.
  const hiddenChord = (info: WindowKeyInfo): boolean => {
    if (!isHiddenChord(info)) return false;
    store.toggleHidden();
    return true;
  };
  return { state, files, focus, refocus, peek, setPeek, go, onKey, fieldKeys, hiddenChord };
}
