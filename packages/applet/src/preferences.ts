/**
 * An extension's preferences and where it shows (applet.json `preferences`,
 * `shows`; docs/launcher-extensions.md, "Preferences"). Dashi draws them and
 * keeps them: words and switches in the extension's data folder's
 * neighbour (`applet-data/<id>.prefs.json`, outside its sandbox), a `secret`
 * in the Secret Service under the extension's id. The extension reads them
 * as `open` gives them, and hears `prefs` when the person changes one.
 *
 *   "preferences": [
 *     { "name": "token", "type": "secret", "title": "GitHub token", "description": "Only for your private repositories." },
 *     { "name": "repo", "type": "text", "title": "Repository", "default": "Netko-Labs/dashiOS" },
 *     { "name": "open_in", "type": "dropdown", "title": "Open pull requests in", "options": [{ "title": "Helium", "value": "browser" }, { "title": "Dashi", "value": "dashi" }], "default": "browser" }
 *   ]
 */

import { isRefusal, list, optionalText, type Refusal, record, refuse, text } from "@dashi/shape/kit";

export const PREFERENCE_TYPES = ["text", "secret", "checkbox", "dropdown"] as const;
export type PreferenceType = (typeof PREFERENCE_TYPES)[number];

export interface Preference {
  name: string;
  type: PreferenceType;
  title: string;
  description?: string;
  required: boolean;
  default?: string | boolean;
  /** A dropdown's choices: what it shows, and the value kept. */
  options?: { title: string; value: string }[];
}

/** Where an extension shows: its shelves in the store, known before it ever runs. */
export const SHOWS = ["menu-bar", "launcher", "widgets"] as const;
export type Shows = (typeof SHOWS)[number];

const NAME = /^[a-z][a-z0-9_]{0,31}$/;

function parsePreference(value: unknown, where: string): Preference | Refusal {
  const fields = record(value, where, ["name", "type", "title", "description", "required", "default", "options"]);
  if (isRefusal(fields)) return fields;
  if (typeof fields.name !== "string" || !NAME.test(fields.name)) return refuse(`${where}: name must be lowercase letters, digits and _ (32 at most)`);
  const type = PREFERENCE_TYPES.find((each) => each === fields.type);
  if (!type) return refuse(`${where}: type must be one of ${PREFERENCE_TYPES.join(", ")}`);
  const title = text(fields.title, `${where}: title`, 40);
  if (isRefusal(title)) return title;
  const description = optionalText(fields.description, `${where}: description`, 120);
  if (isRefusal(description)) return description;
  if (fields.required !== undefined && typeof fields.required !== "boolean") return refuse(`${where}: required must be true or false`);
  const options = type === "dropdown" ? parseOptions(fields.options, `${where}: options`) : fields.options === undefined ? undefined : refuse(`${where}: only a dropdown has options`);
  if (isRefusal(options)) return options;
  const fallback = fields.default;
  if (options && typeof fallback === "string" && !options.some((each) => each.value === fallback)) return refuse(`${where}: default must be one of its options`);
  if (fallback !== undefined) {
    if (type === "secret") return refuse(`${where}: a secret has no default`);
    if (type === "checkbox" ? typeof fallback !== "boolean" : typeof fallback !== "string" || fallback.length > 200)
      return refuse(`${where}: default must be ${type === "checkbox" ? "true or false" : "words (200 at most)"}`);
  }
  return {
    name: fields.name,
    type,
    title,
    ...(description === undefined ? {} : { description }),
    required: fields.required === true,
    ...(typeof fallback === "string" || typeof fallback === "boolean" ? { default: fallback } : {}),
    ...(options ? { options } : {}),
  };
}

function parseOptions(value: unknown, where: string): { title: string; value: string }[] | Refusal {
  return list(value, where, 24, (entry, at) => {
    const fields = record(entry, at, ["title", "value"]);
    if (isRefusal(fields)) return fields;
    const title = text(fields.title, `${at}: title`, 40);
    if (isRefusal(title)) return title;
    const kept = text(fields.value, `${at}: value`, 60);
    return isRefusal(kept) ? kept : { title, value: kept };
  });
}

/** applet.json's `preferences`: up to 12, each named once. */
export function parsePreferences(value: unknown): Preference[] | Refusal {
  const preferences = list(value, "preferences", 12, parsePreference);
  if (isRefusal(preferences)) return preferences;
  const names = preferences.map((each) => each.name);
  const twice = names.find((each, at) => names.indexOf(each) !== at);
  return twice ? refuse(`preferences names “${twice}” twice`) : preferences;
}

/** applet.json's `shows`: each of menu-bar, launcher, widgets at most once. */
export function parseShows(value: unknown): Shows[] | Refusal {
  const shows = list(
    value,
    "shows",
    SHOWS.length,
    (entry, where) => SHOWS.find((each) => each === entry) ?? refuse(`${where} must be one of ${SHOWS.join(", ")}`),
  );
  if (isRefusal(shows)) return shows;
  return new Set(shows).size === shows.length ? shows : refuse("shows names one place twice");
}

/** Where it shows when the manifest doesn't say: the launcher when it has commands and nothing else, else the menu bar (as every applet before). */
export function showsOf(manifest: { shows?: readonly Shows[]; commands: readonly unknown[]; controls: readonly unknown[] }): readonly Shows[] {
  if (manifest.shows && manifest.shows.length > 0) return manifest.shows;
  return manifest.commands.length > 0 && manifest.controls.length === 0 ? ["menu-bar", "launcher"] : ["menu-bar"];
}

/** Whether it runs only for the launcher: started when a command opens, stopped a minute after (docs/launcher-extensions.md, "When it runs"). */
export const launcherOnly = (manifest: { shows?: readonly Shows[] }): boolean => manifest.shows?.length === 1 && manifest.shows[0] === "launcher";
