/**
 * Profiles (src/dictation/lib/profiles.ts, compose.ts, rules-code.ts,
 * rules-style.ts; lexicon.ts): one is chosen by the field, the site and the
 * app with no setup, the same sentence lands differently in each, the
 * Developer profile's casing and symbols are exact, and the person's files
 * are read, seeded and edited.
 */

import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentUnder, Lexicon, NO_WORDS, wordsFrom } from "../src/dictation/index.ts";
import { compose } from "../src/dictation/lib/compose.ts";
import { PROFILES, pickProfile } from "../src/dictation/lib/profiles.ts";
import { applyCode, backticks } from "../src/dictation/lib/rules-code.ts";
import { finalPeriod, greeting, lowerStart } from "../src/dictation/lib/rules-style.ts";
import type { FieldRead } from "../src/dictation/types.ts";
import { dictating } from "./support/dictation.ts";
import { settle } from "./support/time.ts";

const field = (over: Partial<FieldRead> = {}): FieldRead => ({ kind: "text", role: "text", site: null, before: null, after: null, ...over });
const front = (appId: string) => ({ window: 1, pid: 10, appId });
const pick = (appId: string, over: Partial<FieldRead> | null = {}, chosen?: string) => pickProfile(PROFILES, front(appId), over ? field(over) : null, chosen);

test("the profile is chosen by the field's role, then the site, then the app, else Writing", () => {
  expect(pick("dev.dashi.terminal", null)).toMatchObject({ profile: { id: "developer" }, terminal: true });
  expect(pick("something", { role: "terminal" })).toMatchObject({ profile: { id: "developer" }, terminal: true });
  expect(pick("dev.zed.Zed").profile.id).toBe("developer");
  expect(pick("helium", { site: "github.com" }).profile.id).toBe("developer");
  expect(pick("helium", { site: "web.whatsapp.com" }).profile.id).toBe("chat");
  expect(pick("helium", { site: "mail.google.com" }).profile.id).toBe("email");
  // A page nobody claims is Writing, whatever the browser; so is an app nobody claims.
  expect(pick("helium", { site: "example.org" }).profile.id).toBe("writing");
  expect(pick("dev.dashi.editor").profile.id).toBe("writing");
  expect(pick("org.unknown.App", null).profile.id).toBe("writing");
  expect(pick("org.mozilla.Thunderbird", null).profile.id).toBe("email");
  // The person's own pick for the window wins, and a terminal stays a terminal.
  expect(pick("dev.dashi.terminal", null, "verbatim")).toMatchObject({ profile: { id: "verbatim" }, terminal: true });
});

const lexicon = new Lexicon({ memory: true }).getSnapshot();
const land = (heard: string, appId: string, over: Partial<FieldRead> | null = {}, agent = false) =>
  compose(heard, { place: pick(appId, over), lexicon, words: NO_WORDS, tidy: true, agent }).text;

test("the same sentence lands differently in a terminal, a document, a chat and a mail", () => {
  const said = "Hi Alex, um, open cloud code and run dash dash help.";
  expect(land(said, "dev.dashi.terminal", null)).toBe("hi Alex, open Claude Code and run --help");
  expect(land(said, "dev.dashi.editor")).toBe("Hi Alex, open Claude Code and run dash dash help.");
  expect(land(said, "helium", { site: "web.whatsapp.com" })).toBe("Hi Alex, open Claude Code and run dash dash help");
  expect(land(said, "helium", { site: "mail.google.com" })).toBe("Hi Alex,\n\nOpen Claude Code and run dash dash help.");
  expect(land(said, "helium", { site: "github.com" })).toBe("Hi Alex, open Claude Code and run `--help`.");
  expect(compose(said, { place: pick("x", {}, "verbatim"), lexicon, words: NO_WORDS, tidy: true, agent: false }).text).toBe(said);
});

test("an agent's prompt in a terminal takes prose; a bare shell takes a command", () => {
  expect(land("Git status.", "dev.dashi.terminal", null)).toBe("git status");
  // A flag of two words said is written as one (D302); a word after it that is not part of it stays.
  expect(land("git log dash dash one line", "dev.dashi.terminal", null)).toBe("git log --oneline");
  expect(land("git log dash dash one line dash dash graph", "dev.dashi.terminal", null)).toBe("git log --oneline --graph");
  expect(land("git push dash dash force with lease", "dev.dashi.terminal", null)).toBe("git push --force-with-lease");
  expect(land("git commit dash dash no verify", "dev.dashi.terminal", null)).toBe("git commit --no-verify");
  expect(land("git diff dash dash name dash only", "dev.dashi.terminal", null)).toBe("git diff --name-only");
  expect(land("git commit dash dash amend message", "dev.dashi.terminal", null)).toBe("git commit --amend message");
  expect(land("Please run the tests.", "dev.dashi.terminal", null, true)).toBe("Please run the tests.");
  expect(land("GitHub is down.", "dev.dashi.terminal", null)).toBe("GitHub is down");
});

test("casing by voice: the words up to a mark or a joining word are the identifier", () => {
  const code = (text: string, terminal = false) => applyCode(text, terminal).text;
  expect(code("camel case user id")).toBe("userId");
  expect(code("set snake case max retry count to five")).toBe("set max_retry_count to five");
  expect(code("Pascal case http client, then kebab case side bar")).toBe("HttpClient, then side-bar");
  expect(code("constant case api key")).toBe("API_KEY");
  expect(code("dot case app config name")).toBe("app.config.name");
  // Talking about it is not using it.
  expect(code("we use snake case for names")).toBe("we use snake case for names");
});

test("symbols and flags by voice, only by their unmistakable names", () => {
  const code = (text: string, terminal = false) => applyCode(text, terminal).text;
  expect(code("git commit dash dash amend")).toBe("git commit --amend");
  expect(code("ls dash la")).toBe("ls -la");
  expect(code("a dash of salt")).toBe("a dash of salt");
  expect(code("user underscore id")).toBe("user_id");
  expect(code("call foo open paren bar close paren")).toBe("call foo (bar)");
  expect(code("x equals sign five")).toBe("x = five");
  expect(code("src forward slash main")).toBe("src/main");
  expect(code("cat log pipe grep error", true)).toBe("cat log | grep error");
  expect(code("the pipe is broken")).toBe("the pipe is broken");
});

test("backticks go round identifiers, not names or addresses", () => {
  const names = new Set(["github", "typescript"]);
  expect(backticks("rename userId to user_id in src/main.ts", names).text).toBe("rename `userId` to `user_id` in `src/main.ts`");
  expect(backticks("run it with --dry-run or call render()", names).text).toBe("run it with `--dry-run` or call `render()`");
  expect(backticks("GitHub and TypeScript, see example.com/docs", names).fixes).toBe(0);
  expect(backticks("already `userId` here", names).fixes).toBe(0);
});

test("style: a shell's words start small, a chat's single sentence has no full stop, a mail greets on its own line", () => {
  const names = new Set(["dashi"]);
  expect(lowerStart("Git status", names)).toBe("git status");
  expect(lowerStart("Dashi is on", names)).toBe("Dashi is on");
  expect(lowerStart("I think so", names)).toBe("I think so");
  expect(lowerStart("API keys", names)).toBe("API keys");
  expect(finalPeriod("See you there.", "drop-single")).toBe("See you there");
  expect(finalPeriod("See you there. Bring it.", "drop-single")).toBe("See you there. Bring it.");
  expect(finalPeriod("Are you there?", "drop")).toBe("Are you there?");
  expect(finalPeriod("Wait...", "drop")).toBe("Wait...");
  expect(greeting("Hello Alex Kim, thanks for the notes.")).toBe("Hello Alex Kim,\n\nThanks for the notes.");
  expect(greeting("Hola Alex, gracias.")).toBe("Hola Alex,\n\nGracias.");
  expect(greeting("Hi there.")).toBe("Hi there.");
});

function folder() {
  const dir = join(mkdtempSync(join(tmpdir(), "dashi-lexicon-")), "dictation");
  const words = wordsFrom(["notes\nfiles\ncalculator\ntext\neditor"]);
  const make = () => new Lexicon({ dir, words, seed: () => ({ apps: ["Notes", "Helium", "LibreOffice Writer", "Kdenlive", "Files"], person: "Alex Kim" }) });
  return { dir, make };
}

test("the first run seeds files a person can read: Dashi's words, their name, apps that are names", () => {
  const { dir, make } = folder();
  const view = make().getSnapshot();
  const terms = view.vocabulary.map((each) => each.term);
  expect(terms).toEqual(expect.arrayContaining(["Dashi", "Claude Code", "Wispr Flow", "Helium", "Siri", "Alex", "Kim", "LibreOffice Writer", "Kdenlive"]));
  expect(terms).not.toContain("Notes");
  expect(terms).not.toContain("Files");
  expect(view.replacements).toEqual([{ from: "cloud code", to: "Claude Code" }]);
  expect(view.profiles.map((profile) => profile.name)).toEqual(["Developer", "Writing", "Chat", "Email", "Verbatim"]);
  expect(readFileSync(join(dir, "vocabulary"), "utf8")).toContain("Dashi: dashy, dashie, dead dash");
  for (const name of ["replacements", "snippets", "profiles/developer", "profiles/verbatim"]) expect(existsSync(join(dir, name))).toBe(true);
});

test("words and replacements are added and removed, and a file the person edits is read again", () => {
  const { dir, make } = folder();
  const lexicon = make();
  lexicon.addWord("Kubernetes", ["cooper netties"]);
  lexicon.addReplacement("t three code", "T3 Code");
  expect(make().getSnapshot().vocabulary).toContainEqual({ term: "Kubernetes", heard: ["cooper netties"] });
  expect(make().getSnapshot().replacements).toContainEqual({ from: "t three code", to: "T3 Code" });
  lexicon.removeWord("kubernetes");
  lexicon.removeReplacement("T Three Code");
  expect(lexicon.getSnapshot().vocabulary.map((each) => each.term)).not.toContain("Kubernetes");
  expect(lexicon.getSnapshot().replacements).toHaveLength(1);
  // The person's own edit: a profile's file, and a snippet.
  writeFileSync(join(dir, "profiles/chat"), "name: Messages\nfinal period: keep\nword: Yuzu\nreplace: bee are bee -> brb\n");
  writeFileSync(join(dir, "snippets"), "my address -> 12 Example Street\\nSpringfield\n");
  lexicon.refresh();
  const chat = lexicon.getSnapshot().profiles.find((profile) => profile.id === "chat");
  expect(chat).toMatchObject({ name: "Messages", period: "keep", breaks: "soft", words: ["Yuzu"], replacements: [{ from: "bee are bee", to: "brb" }] });
  expect(lexicon.getSnapshot().snippets).toEqual([{ from: "my address", to: "12 Example Street\nSpringfield" }]);
});

test("a snippet's words become its text, and the profile's own words are known first", () => {
  const place = pick("dev.dashi.editor");
  const view = { ...lexicon, snippets: [{ from: "my address", to: "12 Example Street" }] };
  expect(compose("Send it to my address please.", { place, lexicon: view, words: NO_WORDS, tidy: true, agent: false }).text).toBe(
    "Send it to 12 Example Street please.",
  );
  expect(land("i like typescript and github", "dev.zed.Zed")).toBe("I like TypeScript and GitHub");
});

test("an agent's program under a terminal's process is found; a bare shell has none", () => {
  const all = [
    { pid: 10, parent: 1, name: "bun", args: ["bun", "terminal"] },
    { pid: 11, parent: 10, name: "zsh", args: ["zsh"] },
    { pid: 12, parent: 11, name: "node", args: ["node", "/usr/bin/claude"] },
    { pid: 20, parent: 1, name: "bun", args: ["bun", "terminal"] },
    { pid: 21, parent: 20, name: "zsh", args: ["zsh"] },
  ];
  expect(agentUnder(10, all)).toBe(true);
  expect(agentUnder(20, all)).toBe(false);
});

test("the landing says its profile, and a press on it takes the next for this window", async () => {
  const { hub, world, typed, hold, key, state } = dictating({ heard: "Git status." });
  world.front = { window: 7, pid: 70, appId: "dev.dashi.terminal" };
  await hold();
  expect(state()).toMatchObject({ phase: "listening", profile: "Developer" });
  await key("up");
  expect(typed).toEqual(["7:git status "]);
  expect(state()).toMatchObject({ phase: "landed", profile: "Developer", typed: "git status" });
  hub.dictationCommands.send({ do: "profile" });
  await settle();
  expect(state()).toMatchObject({ phase: "told", line: "Writing. For this window." });
  await hold();
  expect(state()).toMatchObject({ phase: "listening", profile: "Writing" });
});
