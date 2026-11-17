/**
 * Dashi's GitHub extension's Create Issue (frame L8), on this package's SDK:
 * its form is one the shell takes; without an account a send is a dry run
 * (the request shown, nothing POSTed); with one, the issue is POSTed with
 * the form's values and the launcher closes. GitHub is a stand-in here.
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findNode, parseTree, type ViewMessage, type ViewNode } from "../src/index.ts";
import { LauncherViews } from "../src/launcher/views.ts";
import { flush } from "./support/time.ts";

const GITHUB = join(import.meta.dir, "../../shell/extensions/github");
const realFetch = globalThis.fetch;
const realHome = process.env.HOME;
const asked: { url: string; method: string; body: string }[] = [];

beforeAll(() => {
  // The extension's home is its data folder in its sandbox; here, a folder of the test's (it keeps the last repository there).
  process.env.HOME = mkdtempSync(join(tmpdir(), "dashi-github-home-"));
  process.env.DASHI_APPLETS_SOCKET = join(mkdtempSync(join(tmpdir(), "dashi-github-")), "none.sock");
  process.env.DASHI_APPLET_MANIFEST = join(GITHUB, "applet.json");
  // The stand-in GitHub: labels for any repository, the person's repositories, and an issue made.
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    asked.push({ url, method: init?.method ?? "GET", body: String(init?.body ?? "") });
    if (url.includes("/labels")) return Response.json([{ name: "bug" }, { name: "launcher" }]);
    if (url.includes("/user/repos")) return Response.json([{ full_name: "alexk/dotfiles" }]);
    if (url.endsWith("/issues")) return Response.json({ number: 7, html_url: "https://github.com/alexk/dotfiles/issues/7" }, { status: 201 });
    return Response.json([]);
  }) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  process.env.HOME = realHome;
});

function open(accounts: Record<string, { login: string; token: string }>) {
  const sent: ViewMessage[] = [];
  return import("../../shell/extensions/github/lib/create-issue.tsx").then(({ CreateIssue }) => {
    const views = new LauncherViews({ issue: () => <CreateIssue /> }, (message) => sent.push(message), {
      set: (fn) => {
        const handle = setImmediate(fn);
        return () => clearImmediate(handle);
      },
      now: () => 0,
    });
    views.receive({ type: "open", seq: 1, command: "issue", args: {}, query: "", preferences: { repo: "alexk/notes" }, accounts });
    return { views, sent };
  });
}

const lastTree = (sent: ViewMessage[]): ViewNode => {
  const tree = sent.findLast((message) => message.type === "tree" || message.type === "push");
  if (tree?.type !== "tree" && tree?.type !== "push") throw new Error("no tree");
  return tree.root;
};

const submitOf = (root: ViewNode): string => {
  const find = (node: ViewNode): string | undefined => (node.t === "Action" && node.p.kind === "submit" ? node.i : node.c.map(find).find(Boolean));
  const id = find(root);
  if (!id) throw new Error("no submit");
  return id;
};

test("without an account: the form is taken by the shell, and a send is a dry run that POSTs nothing", async () => {
  const { views, sent } = await open({});
  await flush(40);
  const form = lastTree(sent);
  expect(form.t).toBe("Form");
  expect(parseTree(JSON.parse(JSON.stringify(form)))).not.toHaveProperty("error");
  expect(findNode(form, "k:title") ?? form.c.find((node) => node.p.name === "title")).toBeDefined();
  expect(JSON.stringify(form)).toContain("Create Issue (Dry Run)");
  views.receive({ type: "event", seq: 1, on: "submit", node: submitOf(form), values: { repo: "alexk/notes", title: "The filter forgets", body: "", labels: ["bug"] } });
  await flush(40);
  const pushed = sent.findLast((message) => message.type === "push");
  expect(pushed?.type === "push" && pushed.root.t).toBe("Detail");
  expect(JSON.stringify(pushed)).toContain("POST https://api.github.com/repos/alexk/notes/issues");
  expect(asked.some((each) => each.method === "POST")).toBe(false);
  views.closeAll();
});

test("with an account: the issue is POSTed with the form's values, and the launcher closes", async () => {
  const { views, sent } = await open({ "github.com": { login: "alexk", token: "gho_example" } });
  await flush(40);
  views.receive({
    type: "event",
    seq: 1,
    on: "submit",
    node: submitOf(lastTree(sent)),
    values: { repo: "alexk/dotfiles", title: "The filter forgets", body: "Steps.", labels: ["launcher"] },
  });
  await flush(40);
  const post = asked.find((each) => each.method === "POST");
  expect(post?.url).toBe("https://api.github.com/repos/alexk/dotfiles/issues");
  expect(JSON.parse(post?.body ?? "{}")).toEqual({ title: "The filter forgets", body: "Steps.", labels: ["launcher"] });
  expect(sent.some((message) => message.type === "close")).toBe(true);
  expect(sent.some((message) => message.type === "toast" && message.title === "#7 filed")).toBe(true);
  views.closeAll();
});
