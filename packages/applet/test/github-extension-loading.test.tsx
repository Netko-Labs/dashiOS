/**
 * Pass 43, in the VM: ↩ on a repository pushed its pull requests, and while
 * they loaded the view said "This view can't be shown: Section “n1”: subtitle
 * is empty": the section's count was "" until the list came, and the tree
 * refuses an empty subtitle. Each tree the view sends, loading and loaded, is
 * one the shell takes.
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTree, type ViewMessage } from "../src/index.ts";
import { LauncherViews } from "../src/launcher/views.ts";
import { flush } from "./support/time.ts";

/** Dashi's own GitHub extension, written on this package's SDK (packages/shell/extensions/github). */
const GITHUB = join(import.meta.dir, "../../shell/extensions/github");
const realFetch = globalThis.fetch;
let answer: (body: unknown) => void = () => {};

beforeAll(() => {
  // Nothing here reaches a real shell: the extension's client is pointed at a socket that isn't there.
  process.env.DASHI_APPLETS_SOCKET = join(mkdtempSync(join(tmpdir(), "dashi-github-")), "none.sock");
  process.env.DASHI_APPLET_MANIFEST = join(GITHUB, "applet.json");
  // GitHub answers when the test says.
  globalThis.fetch = (() => new Promise<Response>((resolve) => (answer = (body) => resolve(Response.json(body))))) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

test("the pull requests' view is taken while it loads and once it has loaded", async () => {
  const { PullRequests } = await import("../../shell/extensions/github/main.tsx");
  const sent: ViewMessage[] = [];
  const views = new LauncherViews({ prs: () => <PullRequests repo="renovatebot/renovate" /> }, (message) => sent.push(message), {
    set: (fn) => {
      const handle = setImmediate(fn);
      return () => clearImmediate(handle);
    },
    now: () => 0,
  });
  views.receive({ type: "open", seq: 1, command: "prs", args: {}, query: "", preferences: { token: "ghp_example" } });
  await flush(30);
  const trees = () => sent.flatMap((message) => (message.type === "tree" ? [message.root] : []));
  const loading = trees().at(-1);
  expect(loading).toBeDefined();
  expect(parseTree(JSON.parse(JSON.stringify(loading)))).not.toHaveProperty("error");
  expect(JSON.stringify(loading)).not.toContain("can't be shown");
  answer([
    {
      number: 47608,
      title: "build(deps): update dependency glob",
      user: { login: "renovate" },
      draft: true,
      labels: [],
      head: { ref: "renovate/glob", sha: "abc" },
      html_url: "https://github.com/x",
      body: "",
      updated_at: "2026-11-16T10:00:00Z",
    },
  ]);
  await flush(60);
  const patched = sent.some((message) => message.type === "patch");
  const last = trees().at(-1);
  expect(patched || last !== loading).toBe(true);
  for (const root of trees()) {
    expect(parseTree(JSON.parse(JSON.stringify(root)))).not.toHaveProperty("error");
    // A tree the SDK itself refused goes as its problem view: none here.
    expect(JSON.stringify(root)).not.toContain("can't be shown");
  }
  expect(JSON.stringify(trees().at(-1))).toContain("47608");
  views.closeAll();
});
