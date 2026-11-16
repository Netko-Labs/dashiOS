/**
 * The person's vocabulary, replacements, snippets and profiles (docs/voice.md,
 * "Vocabulary and profiles"): plain-text files in `~/.config/dashi/dictation/`
 * that they can read and edit (lib/lexicon-files.ts), read again whenever one
 * changed. Seeded at the first run with the installed apps' names, the
 * person's own name and Dashi's own words. Settings › Voice adds and removes
 * words and replacements through it.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pairsText, parsePairs, parseProfile, parseVocabulary, profileText, vocabularyText } from "./lib/lexicon-files.ts";
import { PROFILE_ABOUT, PROFILES } from "./lib/profiles.ts";
import { seedTerms } from "./lib/seed.ts";
import type { Pair, Profile, Term } from "./types.ts";
import type { Words } from "./words.ts";

export interface LexiconView {
  vocabulary: readonly Term[];
  replacements: readonly Pair[];
  snippets: readonly Pair[];
  profiles: readonly Profile[];
}

export interface LexiconOptions {
  dir?: string;
  /** Nothing is read or written: Dashi's own words and profiles (a test, or a session with no home). */
  memory?: boolean;
  /** What the first run seeds the vocabulary with: the installed apps' names and the person's own. */
  seed?(): { apps: readonly string[]; person: string };
  /** Which words are ordinary words: an app called "Notes" is not seeded as a name. */
  words?: Words;
}

export const lexiconDir = (): string => join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "dashi", "dictation");

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

export class Lexicon {
  readonly dir: string;
  private view: LexiconView | null = null;
  private stamp = "";
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: LexiconOptions = {}) {
    this.dir = options.dir ?? lexiconDir();
  }

  private path(name: string): string {
    return join(this.dir, name);
  }

  private text(name: string): string {
    try {
      return readFileSync(this.path(name), "utf8");
    } catch {
      return "";
    }
  }

  private write(name: string, text: string): void {
    try {
      mkdirSync(join(this.path(name), ".."), { recursive: true });
      writeFileSync(this.path(name), text);
    } catch (error) {
      console.error(`dashi-shell: dictation's ${name} could not be written:`, error);
    }
  }

  /** The files as they are on disk now, in a word: when any changes, so does this. */
  private stampNow(): string {
    return ["vocabulary", "replacements", "snippets", ...PROFILES.map((profile) => `profiles/${profile.id}`)]
      .map((name) => {
        try {
          const stat = statSync(this.path(name));
          return `${stat.mtimeMs}:${stat.size}`;
        } catch {
          return "-";
        }
      })
      .join("|");
  }

  /** The first run: the folder, with the files a person can read and edit. A file that is there is never written over. */
  private seed(): void {
    const fresh = !existsSync(this.dir);
    const missing = (name: string): boolean => !existsSync(this.path(name));
    if (missing("vocabulary")) {
      const given = fresh ? this.options.seed?.() : undefined;
      this.write("vocabulary", vocabularyText(seedTerms(given?.apps ?? [], given?.person ?? "", this.options.words)));
    }
    if (missing("replacements")) this.write("replacements", pairsText("replacements", [{ from: "cloud code", to: "Claude Code" }]));
    if (missing("snippets")) this.write("snippets", pairsText("snippets", []));
    for (const profile of PROFILES) {
      const name = `profiles/${profile.id}`;
      if (missing(name)) this.write(name, profileText(profile, PROFILE_ABOUT[profile.id] ?? profile.name));
    }
  }

  private read(): LexiconView {
    if (this.options.memory) {
      return { vocabulary: seedTerms([], "", this.options.words), replacements: [{ from: "cloud code", to: "Claude Code" }], snippets: [], profiles: PROFILES };
    }
    this.seed();
    this.stamp = this.stampNow();
    return {
      vocabulary: parseVocabulary(this.text("vocabulary")),
      replacements: parsePairs(this.text("replacements")),
      snippets: parsePairs(this.text("snippets"), true),
      profiles: PROFILES.map((profile) => parseProfile(this.text(`profiles/${profile.id}`), profile)),
    };
  }

  /** Read again if a file changed (the person edited one); cheap enough for every press of the key. */
  refresh(): void {
    if (this.view && (this.options.memory || this.stampNow() === this.stamp)) return;
    this.view = this.read();
    for (const listener of [...this.listeners]) listener();
  }

  getSnapshot = (): LexiconView => {
    if (!this.view) this.view = this.read();
    return this.view;
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  private save(name: "vocabulary" | "replacements", text: string): void {
    if (this.options.memory) return;
    this.write(name, text);
    this.view = null;
    this.refresh();
  }

  /** A word to write this way from now on; `heard` is what the recogniser gives instead, when known. */
  addWord(term: string, heard: readonly string[] = []): void {
    const word = term.trim();
    if (word === "") return;
    const terms = this.getSnapshot().vocabulary.filter((each) => !same(each.term, word));
    this.save("vocabulary", vocabularyText([...terms, { term: word, heard: heard.map((each) => each.trim()).filter(Boolean) }]));
  }

  removeWord(term: string): void {
    this.save("vocabulary", vocabularyText(this.getSnapshot().vocabulary.filter((each) => !same(each.term, term))));
  }

  addReplacement(from: string, to: string): void {
    const pair = { from: from.trim(), to: to.trim() };
    if (pair.from === "" || pair.to === "") return;
    const pairs = this.getSnapshot().replacements.filter((each) => !same(each.from, pair.from));
    this.save("replacements", pairsText("replacements", [...pairs, pair]));
  }

  removeReplacement(from: string): void {
    this.save(
      "replacements",
      pairsText(
        "replacements",
        this.getSnapshot().replacements.filter((each) => !same(each.from, from)),
      ),
    );
  }
}
