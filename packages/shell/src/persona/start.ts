/**
 * Keeps who Dashi is current while the session runs: settings.json and the characters folder are
 * read at start and again whenever either changes, and each time the hub's `persona` cell (what the
 * capsule, the bar and the voice loop read) and the assistant's prompt style are set anew. A choice
 * made in Settings shows without logging out.
 */

import { mkdirSync, watch } from "node:fs";
import type { PromptStyle } from "../agents/ask/index.ts";
import type { Persona } from "../shared/pill/index.ts";
import type { Character } from "./lib/characters.ts";
import { type CharacterFiles, charactersDir, readCharacters } from "./lib/files.ts";
import { promptLanguage } from "./lib/language.ts";
import { hubPersona, type PersonaSection, type PersonaView, personaStyle, resolvePersona } from "./lib/resolve.ts";

export interface PersonaSource {
  /** Who Dashi is now, for the pane. */
  view(): PersonaView;
  files(): CharacterFiles;
  /** The language a character's text is in now. */
  language(): "en" | "es";
  /** The characters folder; made when the person first makes a file. */
  dir: string;
  subscribe(listener: () => void): () => void;
  /** Read the folder again now (the pane just wrote a file). */
  refresh(): void;
  stop(): void;
}

export interface PersonaOptions {
  settings: {
    getSnapshot(): { data: { persona: PersonaSection; voice: { voice?: string }; region: { formats?: string } } };
    subscribe(listener: () => void): () => void;
  };
  /** The hub's cell. */
  set(persona: Persona): void;
  /** The assistant's prompt style (agents/ask `promptStyle.set`). */
  style(style: PromptStyle): void;
  dir?: string;
  lang?: string | undefined;
  /** False in tests: read the folder only when told. */
  watch?: boolean;
}

export function startPersona(options: PersonaOptions): PersonaSource {
  const dir = options.dir ?? charactersDir();
  const listeners = new Set<() => void>();
  let files = readCharacters(dir);
  let view: PersonaView;
  let language: "en" | "es" = "en";
  let last = "";
  const apply = (): void => {
    const data = options.settings.getSnapshot().data;
    const characters: readonly Character[] = files.characters;
    view = resolvePersona(data, characters);
    language = promptLanguage(view.language, data.region.formats, options.lang ?? process.env.LANG);
    const persona = hubPersona(view, language);
    const style = personaStyle(view, language);
    // The same choices are not told twice: the cell's readers compare by identity.
    const now = JSON.stringify([persona, style, files, view.missing]);
    if (now === last) return;
    last = now;
    options.set(persona);
    options.style(style);
    for (const listener of [...listeners]) listener();
  };
  view = resolvePersona(options.settings.getSnapshot().data, files.characters);
  apply();
  const refresh = (): void => {
    files = readCharacters(dir);
    apply();
  };
  const offSettings = options.settings.subscribe(apply);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watcher: ReturnType<typeof watch> | null = null;
  const follow = (): void => {
    if (watcher || options.watch === false) return;
    try {
      watcher = watch(dir, () => {
        clearTimeout(timer);
        timer = setTimeout(refresh, 150);
      });
      watcher.on("error", () => {});
    } catch {
      watcher = null;
    }
  };
  follow();
  return {
    view: () => view,
    files: () => files,
    language: () => language,
    dir,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    refresh() {
      // The folder may be new: the pane just made the first file.
      try {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
      } catch {
        // No folder is no characters.
      }
      follow();
      refresh();
    },
    stop() {
      offSettings();
      clearTimeout(timer);
      watcher?.close();
    },
  };
}
