import { EditorModel } from "../../apps/editor/lib/model.ts";
import { DEFAULT_PREFS, type EditorPrefs } from "../../apps/editor/lib/prefs.ts";

let clock = 0;

/** An editor on the default prefs; each save of its prefs lands in `saved`. */
export function editorModel(saved: EditorPrefs[] = []): EditorModel {
  return new EditorModel({
    loadPrefs: () => DEFAULT_PREFS,
    savePrefs: (prefs) => saved.push(prefs),
    now: () => (clock += 10_000),
  });
}
