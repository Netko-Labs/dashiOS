/**
 * The GitHub extension's words fit a launcher row (extensions/github/lib/api.ts):
 * a row's words longer than the tree takes, or an empty subtitle, are refused,
 * and one refused row hides the whole view ("This view can't be shown": the VM,
 * searching renovatebot/renovate, whose renovate-approve-bot has no description).
 */

import { afterEach, expect, test } from "bun:test";
import { parseTree } from "@dashi/applet";
import { fit, pullRequests, searchRepositories } from "../extensions/github/lib/api.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
const answer = (body: unknown): void => {
  globalThis.fetch = (async () => Response.json(body)) as unknown as typeof fetch;
};

test("fit: one line, at most the letters asked, cut with an ellipsis", () => {
  expect(fit("  Fix the\n dock\t now ", 120)).toBe("Fix the dock now");
  expect(fit("a".repeat(130), 120)).toBe(`${"a".repeat(119)}…`);
  expect([...fit("é".repeat(200), 120)]).toHaveLength(120);
  expect(fit("", 120)).toBe("");
});

test("a repository without a description, or with a long one, still makes a row the tree takes", async () => {
  answer({
    items: [
      { full_name: "renovatebot/renovate-approve-bot", description: null, stargazers_count: 3, html_url: "https://github.com/x" },
      { full_name: "renovatebot/renovate", description: "x".repeat(300), stargazers_count: 20000, html_url: "https://github.com/y" },
    ],
  });
  const repos = await searchRepositories("renovatebot/renovate", undefined);
  expect(repos.map((repo) => [...repo.description].length)).toEqual([0, 120]);
  const items = repos.map((repo, at) => ({
    t: "Item",
    i: `k:${at}`,
    p: { title: repo.fullName, ...(repo.description ? { subtitle: repo.description } : {}) },
  }));
  expect("error" in parseTree({ t: "List", i: "root", c: items })).toBe(false);
  // An empty subtitle is what the view refused.
  expect(parseTree({ t: "List", i: "root", c: [{ t: "Item", i: "k", p: { title: "a", subtitle: "" } }] })).toHaveProperty("error");
});

test("a pull request's title and labels are cut to what a row takes", async () => {
  answer([{ number: 7, title: `Bump ${"x".repeat(200)}`, user: { login: "alexk" }, head: { ref: "b", sha: "s" }, labels: [{ name: "l".repeat(80) }] }]);
  const [pr] = await pullRequests("alexk/dots", undefined);
  expect([...(pr?.title ?? "")]).toHaveLength(120);
  expect([...(pr?.labels[0] ?? "")]).toHaveLength(60);
});
