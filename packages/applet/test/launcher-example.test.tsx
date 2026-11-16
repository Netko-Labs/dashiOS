/**
 * docs/launcher-extensions.md's example, as written there
 * (fixtures/example-github/): it builds as `dashi-applet pack` builds it, and
 * its view renders to a tree the shell accepts, rows and all.
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTree, type ViewMessage } from "../src/index.ts";
import { LauncherViews } from "../src/launcher/views.ts";
import { flush } from "./support/time.ts";

const DIR = join(import.meta.dir, "fixtures/example-github");
const realFetch = globalThis.fetch;

beforeAll(() => {
  // Nothing here may reach a real shell: the example's client is pointed at a socket that isn't there.
  process.env.DASHI_APPLETS_SOCKET = join(mkdtempSync(join(tmpdir(), "dashi-example-")), "none.sock");
  process.env.DASHI_APPLET_MANIFEST = join(DIR, "applet.json");
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

test("the guide's example builds", async () => {
  const out = mkdtempSync(join(tmpdir(), "dashi-example-build-"));
  const built = await Bun.build({ entrypoints: [join(DIR, "main.tsx")], target: "bun", outdir: out });
  expect(built.success).toBe(true);
});

test("the guide's example draws its pull requests", async () => {
  globalThis.fetch = (async (url: string) => {
    const review = decodeURIComponent(String(url)).includes("review-requested");
    const item = {
      number: review ? 7 : 42,
      title: review ? "Speed up the grid" : "Fix the dock",
      repository_url: "https://api.github.com/repos/alexk/dashi",
      html_url: "https://github.com/alexk/dashi/pull/42",
      body: "",
    };
    return new Response(JSON.stringify({ items: [item] }), { status: 200 });
  }) as typeof fetch;
  const { MyPullRequests } = await import("./fixtures/example-github/main.tsx");
  const sent: ViewMessage[] = [];
  const views = new LauncherViews({ "my-prs": MyPullRequests }, (message) => sent.push(message), {
    set: (fn) => {
      const handle = setImmediate(fn);
      return () => clearImmediate(handle);
    },
    now: () => 0,
  });
  views.receive({ type: "open", seq: 1, command: "my-prs", args: {}, query: "", preferences: { token: "ghp_example" } });
  await flush(60);
  const last = sent.filter((message) => message.type === "tree").at(-1);
  if (last?.type !== "tree") throw new Error("no tree");
  expect("error" in parseTree(JSON.parse(JSON.stringify(last.root)))).toBe(false);
  const text = JSON.stringify(last.root);
  expect(text).toContain("Review requested");
  expect(text).toContain("Fix the dock");
  expect(text).toContain("Speed up the grid");
  views.closeAll();
});
